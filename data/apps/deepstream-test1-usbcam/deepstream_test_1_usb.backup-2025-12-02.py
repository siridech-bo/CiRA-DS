#!/usr/bin/env python3

################################################################################
# SPDX-FileCopyrightText: Copyright (c) 2020-2023 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
################################################################################

import sys
sys.path.append('../')
import gi
import sys
import os
import time
import threading
sys.path.insert(0, '/data/ds')
sys.path.insert(0, '/data/ds/common')
import os
gi.require_version('Gst', '1.0')
from gi.repository import GLib, Gst
try:
    from common.platform_info import PlatformInfo
    try:
        platform_info = PlatformInfo()
    except Exception:
        pass
except Exception:
    class _PI:
        def is_integrated_gpu(self):
            return False
        def is_platform_aarch64(self):
            return True
    platform_info = _PI()
from common.bus_call import bus_call

try:
    import pyds as pyds
except Exception:
    try:
        import pyds_ext as pyds
    except Exception:
        pyds = None

try:
    import roslibpy
except Exception:
    roslibpy = None

PGIE_CLASS_ID_VEHICLE = 0
PGIE_CLASS_ID_BICYCLE = 1
PGIE_CLASS_ID_PERSON = 2
PGIE_CLASS_ID_ROADSIGN = 3
MUXER_BATCH_TIMEOUT_USEC = 33000

def osd_sink_pad_buffer_probe(pad,info,u_data):
    frame_number=0
    obj_counter = {
        PGIE_CLASS_ID_VEHICLE:0,
        PGIE_CLASS_ID_PERSON:0,
        PGIE_CLASS_ID_BICYCLE:0,
        PGIE_CLASS_ID_ROADSIGN:0
    }
    num_rects=0
    dets=[]
    if pyds is None:
        return Gst.PadProbeReturn.OK

    gst_buffer = info.get_buffer()
    if not gst_buffer:
        print("Unable to get GstBuffer ")
        return Gst.PadProbeReturn.OK

    batch_meta = pyds.gst_buffer_get_nvds_batch_meta(hash(gst_buffer))
    l_frame = batch_meta.frame_meta_list
    while l_frame is not None:
        try:
           frame_meta = pyds.NvDsFrameMeta.cast(l_frame.data)
        except StopIteration:
            break

        frame_number=frame_meta.frame_num
        num_rects = frame_meta.num_obj_meta
        l_obj=frame_meta.obj_meta_list
        while l_obj is not None:
            try:
                obj_meta=pyds.NvDsObjectMeta.cast(l_obj.data)
            except StopIteration:
                break
            obj_counter[obj_meta.class_id] += 1
            r = obj_meta.rect_params
            dets.append({"class_id": int(obj_meta.class_id), "left": float(r.left), "top": float(r.top), "width": float(r.width), "height": float(r.height), "confidence": float(obj_meta.confidence)})
            try: 
                l_obj=l_obj.next
            except StopIteration:
                break

        display_meta=pyds.nvds_acquire_display_meta_from_pool(batch_meta)
        display_meta.num_labels = 1
        py_nvosd_text_params = display_meta.text_params[0]
        py_nvosd_text_params.display_text = "Frame Number={} Number of Objects={} Vehicle_count={} Person_count={}".format(frame_number, num_rects, obj_counter[PGIE_CLASS_ID_VEHICLE], obj_counter[PGIE_CLASS_ID_PERSON])
        py_nvosd_text_params.x_offset = 10
        py_nvosd_text_params.y_offset = 12
        py_nvosd_text_params.font_params.font_name = "Serif"
        py_nvosd_text_params.font_params.font_size = 10
        py_nvosd_text_params.font_params.font_color.set(1.0, 1.0, 1.0, 1.0)
        py_nvosd_text_params.set_bg_clr = 1
        py_nvosd_text_params.text_bg_clr.set(0.0, 0.0, 0.0, 1.0)
        print(pyds.get_string(py_nvosd_text_params.display_text))
        pyds.nvds_add_display_meta_to_frame(frame_meta, display_meta)
        try:
            _publish_detections(frame_number, dets)
        except Exception:
            pass
        try:
            l_frame=l_frame.next
        except StopIteration:
            break

    return Gst.PadProbeReturn.OK 


def main(args):
    if len(args) != 2:
        sys.stderr.write("usage: %s <v4l2-device-path>\n" % args[0])
        sys.exit(1)

    global platform_info
    try:
        platform_info = PlatformInfo()
    except Exception:
        pass
    Gst.init(None)

    ros = None
    det_pub = None
    img_b64_pub = None
    snap_enabled = {"value": False}
    snap_period_ms = {"value": 1000}
    last_snap = {"ts": 0}
    out_dir = {"path": "/data/ds/datasets/autocap"}
    def _on_start(_):
        snap_enabled["value"] = True
    def _on_stop(_):
        snap_enabled["value"] = False
    def _on_period(msg):
        try:
            v = int(msg.data)
            snap_period_ms["value"] = max(0, v)
        except Exception:
            pass
    def _publish_img_b64(data_bytes, stamp, suffix):
        if img_b64_pub is None:
            return
        import base64
        payload = {"stamp": int(stamp*1000), "kind": suffix, "data_b64": base64.b64encode(data_bytes).decode("ascii")}
        try:
            img_b64_pub.publish(roslibpy.Message({"data": __import__("json").dumps(payload)}))
        except Exception:
            pass
    def _ensure_dir(path):
        try:
            os.makedirs(path, exist_ok=True)
        except Exception:
            pass
    def _now():
        return time.time()
    def _should_snap():
        if not snap_enabled["value"]:
            return False
        t = _now()
        if snap_period_ms["value"] == 0:
            return False
        if t*1000 - last_snap["ts"] >= snap_period_ms["value"]:
            last_snap["ts"] = t*1000
            return True
        return False
    def _write_file(path, data_bytes):
        try:
            tmp = path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data_bytes)
            os.replace(tmp, path)
        except Exception:
            pass
    def _save_pair(base_name, clean_bytes, osd_bytes, meta_json):
        _ensure_dir(out_dir["path"])
        _write_file(os.path.join(out_dir["path"], base_name + "_clean.jpg"), clean_bytes)
        _write_file(os.path.join(out_dir["path"], base_name + "_osd.jpg"), osd_bytes)
        _write_file(os.path.join(out_dir["path"], base_name + "_meta.json"), meta_json.encode("utf-8"))

    det_buf = {"frame": 0, "dets": []}
    def _publish_detections(frame_num, dets):
        det_buf["frame"] = int(frame_num)
        det_buf["dets"] = dets
        if det_pub is None:
            return
        payload = {"frame": det_buf["frame"], "detections": det_buf["dets"]}
        try:
            det_pub.publish(roslibpy.Message({"data": __import__("json").dumps(payload)}))
        except Exception:
            pass

    print("Creating Pipeline \n ")
    pipeline = Gst.Pipeline()

    if not pipeline:
        sys.stderr.write(" Unable to create Pipeline \n")

    print("Creating Source \n ")
    source = Gst.ElementFactory.make("v4l2src", "usb-cam-source")
    if not source:
        sys.stderr.write(" Unable to create Source \n")

    caps_v4l2src = Gst.ElementFactory.make("capsfilter", "v4l2src_caps")
    if not caps_v4l2src:
        sys.stderr.write(" Unable to create v4l2src capsfilter \n")

    print("Creating Video Converter \n")

    vidconvsrc = Gst.ElementFactory.make("videoconvert", "convertor_src1")
    if not vidconvsrc:
        sys.stderr.write(" Unable to create videoconvert \n")

    nvvidconvsrc = Gst.ElementFactory.make("nvvideoconvert", "convertor_src2")
    if not nvvidconvsrc:
        sys.stderr.write(" Unable to create Nvvideoconvert \n")

    caps_vidconvsrc = Gst.ElementFactory.make("capsfilter", "nvmm_caps")
    if not caps_vidconvsrc:
        sys.stderr.write(" Unable to create capsfilter \n")

    streammux = Gst.ElementFactory.make("nvstreammux", "Stream-muxer")
    if not streammux:
        sys.stderr.write(" Unable to create NvStreamMux \n")

    pgie = Gst.ElementFactory.make("nvinfer", "primary-inference")
    if not pgie:
        sys.stderr.write(" Unable to create pgie \n")

    nvvidconv = Gst.ElementFactory.make("nvvideoconvert", "convertor")
    if not nvvidconv:
        sys.stderr.write(" Unable to create nvvidconv \n")
    caps_rgba = Gst.ElementFactory.make("capsfilter", "caps_rgba")
    if not caps_rgba:
        sys.stderr.write(" Unable to create RGBA capsfilter \n")

    nvosd = Gst.ElementFactory.make("nvdsosd", "onscreendisplay")
    if not nvosd:
        sys.stderr.write(" Unable to create nvosd \n")

    if platform_info.is_integrated_gpu():
        sink = Gst.ElementFactory.make("nv3dsink", "nv3d-sink")
        if not sink:
            sink = Gst.ElementFactory.make("nveglglessink", "nvvideo-renderer")
    else:
        if platform_info.is_platform_aarch64():
            sink = Gst.ElementFactory.make("nv3dsink", "nv3d-sink")
            if not sink:
                sink = Gst.ElementFactory.make("nveglglessink", "nvvideo-renderer")
        else:
            sink = Gst.ElementFactory.make("nveglglessink", "nvvideo-renderer")
    if not sink:
        sys.stderr.write(" Unable to create display sink \n")

    print("Playing cam %s " %args[1])
    caps_v4l2src.set_property('caps', Gst.Caps.from_string("video/x-raw, framerate=30/1"))
    caps_vidconvsrc.set_property('caps', Gst.Caps.from_string("video/x-raw(memory:NVMM)"))
    caps_rgba.set_property('caps', Gst.Caps.from_string("video/x-raw(memory:NVMM), format=RGBA"))
    source.set_property('device', args[1])
    streammux.set_property('width', 1920)
    streammux.set_property('height', 1080)
    streammux.set_property('batch-size', 1)
    streammux.set_property('batched-push-timeout', MUXER_BATCH_TIMEOUT_USEC)
    streammux.set_property('live-source', 1)
    sample_pgie = "/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt"
    default_pgie = sample_pgie if os.path.exists(sample_pgie) else "dstest1_pgie_config.txt"
    pgie_config = os.getenv('DS_PGIE_CONFIG', default_pgie)
    pgie.set_property('config-file-path', pgie_config)
    sink.set_property('sync', False)
    try:
        sink.set_property('qos', 0)
    except Exception:
        pass

    print("Adding elements to Pipeline \n")
    pipeline.add(source)
    pipeline.add(caps_v4l2src)
    pipeline.add(vidconvsrc)
    pipeline.add(nvvidconvsrc)
    pipeline.add(caps_vidconvsrc)
    pipeline.add(streammux)
    pipeline.add(pgie)
    pipeline.add(nvvidconv)
    pipeline.add(caps_rgba)
    pipeline.add(nvosd)
    tee_presave = Gst.ElementFactory.make("tee", "tee_presave")
    tee_postosd = Gst.ElementFactory.make("tee", "tee_postosd")
    conv_clean = Gst.ElementFactory.make("nvvideoconvert", "conv_clean")
    caps_clean = Gst.ElementFactory.make("capsfilter", "caps_clean")
    caps_clean.set_property('caps', Gst.Caps.from_string("video/x-raw, format=BGR"))
    enc_clean = Gst.ElementFactory.make("jpegenc", "enc_clean")
    sink_clean = Gst.ElementFactory.make("appsink", "sink_clean")
    sink_clean.set_property("emit-signals", True)
    conv_osd = Gst.ElementFactory.make("nvvideoconvert", "conv_osd")
    caps_osd = Gst.ElementFactory.make("capsfilter", "caps_osd")
    caps_osd.set_property('caps', Gst.Caps.from_string("video/x-raw, format=BGR"))
    enc_osd = Gst.ElementFactory.make("jpegenc", "enc_osd")
    sink_osd = Gst.ElementFactory.make("appsink", "sink_osd")
    sink_osd.set_property("emit-signals", True)
    pipeline.add(sink)
    pipeline.add(tee_presave)
    pipeline.add(tee_postosd)
    pipeline.add(conv_clean)
    pipeline.add(caps_clean)
    pipeline.add(enc_clean)
    pipeline.add(sink_clean)
    pipeline.add(conv_osd)
    pipeline.add(caps_osd)
    pipeline.add(enc_osd)
    pipeline.add(sink_osd)

    print("Linking elements in the Pipeline \n")
    source.link(caps_v4l2src)
    caps_v4l2src.link(vidconvsrc)
    vidconvsrc.link(nvvidconvsrc)
    nvvidconvsrc.link(caps_vidconvsrc)

    sinkpad = streammux.get_request_pad("sink_0")
    if not sinkpad:
        sys.stderr.write(" Unable to get the sink pad of streammux \n")
    srcpad = caps_vidconvsrc.get_static_pad("src")
    if not srcpad:
        sys.stderr.write(" Unable to get source pad of caps_vidconvsrc \n")
    srcpad.link(sinkpad)
    streammux.link(pgie)
    pgie.link(nvvidconv)
    nvvidconv.link(caps_rgba)
    caps_rgba.link(tee_presave)
    tee_presave.link(nvosd)
    tee_presave.link(conv_clean)
    conv_clean.link(caps_clean)
    caps_clean.link(enc_clean)
    enc_clean.link(sink_clean)
    nvosd.link(tee_postosd)
    tee_postosd.link(sink)
    tee_postosd.link(conv_osd)
    conv_osd.link(caps_osd)
    caps_osd.link(enc_osd)
    enc_osd.link(sink_osd)

    def _on_new_sample(sink, kind):
        sample = sink.emit("pull-sample")
        if sample is None:
            return Gst.FlowReturn.OK
        buf = sample.get_buffer()
        ok, mapinfo = buf.map(Gst.MapFlags.READ)
        if not ok:
            return Gst.FlowReturn.OK
        data = mapinfo.data
        buf.unmap(mapinfo)
        if not _should_snap():
            return Gst.FlowReturn.OK
        ts = int(time.time()*1000)
        base = str(ts)
        meta_json = __import__("json").dumps({"frame": det_buf["frame"], "detections": det_buf["dets"]})
        if kind == "clean":
            _save_pair(base, data, b"", meta_json)
        else:
            _save_pair(base, b"", data, meta_json)
        try:
            _publish_img_b64(data, ts/1000.0, kind)
        except Exception:
            pass
        return Gst.FlowReturn.OK

    def _clean_cb(sink):
        return _on_new_sample(sink, "clean")
    def _osd_cb(sink):
        return _on_new_sample(sink, "osd")
    sink_clean.connect("new-sample", _clean_cb)
    sink_osd.connect("new-sample", _osd_cb)

    loop = GLib.MainLoop()
    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect ("message", bus_call, loop)

    osdsinkpad = nvosd.get_static_pad("sink")
    if not osdsinkpad:
        sys.stderr.write(" Unable to get sink pad of nvosd \n")

    osdsinkpad.add_probe(Gst.PadProbeType.BUFFER, osd_sink_pad_buffer_probe, 0)

    print("Starting pipeline \n")
    if roslibpy is not None:
        try:
            ros = roslibpy.Ros(host='localhost', port=9090)
            ros.run()
            det_pub = roslibpy.Topic(ros, '/deepstream/detections_json', 'std_msgs/String')
            img_b64_pub = roslibpy.Topic(ros, '/deepstream/image_osd_jpeg_b64', 'std_msgs/String')
            det_pub.advertise()
            img_b64_pub.advertise()
            sub_start = roslibpy.Topic(ros, '/deepstream/snapshot/start', 'std_msgs/Empty')
            sub_stop = roslibpy.Topic(ros, '/deepstream/snapshot/stop', 'std_msgs/Empty')
            sub_period = roslibpy.Topic(ros, '/deepstream/snapshot/period_ms', 'std_msgs/Int32')
            sub_start.subscribe(lambda msg: _on_start(None))
            sub_stop.subscribe(lambda msg: _on_stop(None))
            sub_period.subscribe(lambda msg: _on_period(type('M', (), {'data': msg.get('data', 0)})()))
        except Exception:
            pass
    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    except:
        pass
    pipeline.set_state(Gst.State.NULL)

if __name__ == '__main__':
    sys.exit(main(sys.argv))
