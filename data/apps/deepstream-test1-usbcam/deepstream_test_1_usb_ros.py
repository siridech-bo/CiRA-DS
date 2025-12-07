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
sys.path.insert(0, '/opt/nvidia/deepstream/deepstream/lib/python')
import os
gi.require_version('Gst', '1.0')
from gi.repository import GLib, Gst
try:
    from common.platform_info import PlatformInfo
    try:
        platform_info = PlatformInfo()
    except Exception:
        platform_info = None
except Exception:
    class _PI:
        def is_integrated_gpu(self):
            return True
        def is_platform_aarch64(self):
            return True
    platform_info = _PI()
from common.bus_call import bus_call
from common.utils import long_to_uint64

try:
    import pyds_ext as pyds
except Exception:
    try:
        import pyds as pyds
    except Exception:
        pyds = None

try:
    import roslibpy
except Exception:
    roslibpy = None
try:
    import paho.mqtt.client as mqtt
except Exception:
    mqtt = None

PGIE_CLASS_ID_VEHICLE = 0
PGIE_CLASS_ID_BICYCLE = 1
PGIE_CLASS_ID_PERSON = 2
PGIE_CLASS_ID_ROADSIGN = 3
MUXER_BATCH_TIMEOUT_USEC = 33000
MAX_TIME_STAMP_LEN = 32

det_buf = {"frame": 0, "dets": []}
det_pub = None
mqtt_client = None
mqtt_side = None
def _mqtt_publish(topic, payload):
    if mqtt_client is None:
        return
    try:
        mqtt_client.publish(topic, payload, qos=0, retain=False)
    except Exception:
        pass
def _mqtt_heartbeat_start():
    if mqtt_client is None:
        return
    topic = os.getenv('DS_MQTT_TOPIC', 'deepstream/detections')
    stop_flag = {'v': False}
    def _run():
        import json
        while not stop_flag['v']:
            try:
                _mqtt_publish(topic, json.dumps({'type':'heartbeat','ts':int(time.time()*1000)}))
            except Exception:
                pass
            time.sleep(1)
    try:
        t = threading.Thread(target=_run, daemon=True)
        t.start()
    except Exception:
        pass
snap_state = {"base": None, "deadline": 0, "meta": "", "meta_saved": False, "saved_kinds": set()}
def _publish_snap_mqtt(image_bytes, ts_ms, suffix):
    try:
        if mqtt_side is None:
            return
        if suffix != "osd":
            return
        import base64
        j = __import__("json")
        cam = {
            "device": os.getenv('DS_CAM_DEVICE', '/dev/video0'),
            "width": int(os.getenv('DS_CAM_WIDTH', '640')),
            "height": int(os.getenv('DS_CAM_HEIGHT', '480')),
            "fps": os.getenv('DS_CAM_FPS', '30/1'),
            "caps": os.getenv('DS_CAM_CAPS', 'image/jpeg')
        }
        payload = {
            "ts_ms": int(ts_ms),
            "frame_id": int(det_buf["frame"]),
            "cam": cam,
            "image_b64": base64.b64encode(image_bytes).decode("ascii"),
            "detections": det_buf["dets"],
            "meta": {"osd": True}
        }
        topic = os.getenv('DS_MQTT_SNAP_TOPIC', 'deepstream/snap')
        mqtt_side.publish(topic, j.dumps(payload), qos=0, retain=False)
    except Exception:
        pass

def _publish_detections(frame_num, dets):
    det_buf["frame"] = int(frame_num)
    det_buf["dets"] = dets
    payload = {"frame": det_buf["frame"], "detections": det_buf["dets"]}
    try:
        det_pub.publish(roslibpy.Message({"data": __import__("json").dumps(payload)}))
    except Exception:
        pass
    try:
        j = __import__("json").dumps(payload)
        print(j, flush=True)
        print("JSON_DET:" + j, flush=True)
        if mqtt_client is not None:
            try:
                mqtt_client.publish(os.getenv('DS_MQTT_TOPIC', 'deepstream/detections'), j, qos=0, retain=False)
            except Exception:
                pass
    except Exception:
        pass
    try:
        line = __import__("json").dumps(payload) + "\n"
        with open("/tmp/ds_usb_detections.jsonl", "a") as f:
            f.write(line)
    except Exception:
        pass

def osd_sink_pad_buffer_probe(pad,info,u_data):
    frame_number=0
    obj_counter = {
        PGIE_CLASS_ID_VEHICLE:0,
        PGIE_CLASS_ID_PERSON:0,
        PGIE_CLASS_ID_BICYCLE:0,
        PGIE_CLASS_ID_ROADSIGN:0
    }
    num_rects=0
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
        dets = []
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

        try:
            is_first_object = True
            l_obj=frame_meta.obj_meta_list
            while l_obj is not None:
                try:
                    obj_meta=pyds.NvDsObjectMeta.cast(l_obj.data)
                except StopIteration:
                    break
                if is_first_object and (frame_number % 30) == 0:
                    user_event_meta = pyds.nvds_acquire_user_meta_from_pool(batch_meta)
                    if user_event_meta:
                        msg_meta = pyds.alloc_nvds_event_msg_meta(user_event_meta)
                        msg_meta.bbox.top = obj_meta.rect_params.top
                        msg_meta.bbox.left = obj_meta.rect_params.left
                        msg_meta.bbox.width = obj_meta.rect_params.width
                        msg_meta.bbox.height = obj_meta.rect_params.height
                        msg_meta.frameId = frame_number
                        msg_meta.trackingId = long_to_uint64(obj_meta.object_id)
                        msg_meta.confidence = obj_meta.confidence
                        meta = pyds.NvDsEventMsgMeta.cast(msg_meta)
                        meta.sensorId = 0
                        meta.placeId = 0
                        meta.moduleId = 0
                        meta.sensorStr = "sensor-0"
                        meta.ts = pyds.alloc_buffer(MAX_TIME_STAMP_LEN + 1)
                        pyds.generate_ts_rfc3339(meta.ts, MAX_TIME_STAMP_LEN)
                        if obj_meta.class_id == PGIE_CLASS_ID_VEHICLE:
                            meta.type = pyds.NvDsEventType.NVDS_EVENT_MOVING
                            meta.objType = pyds.NvDsObjectType.NVDS_OBJECT_TYPE_VEHICLE
                            meta.objClassId = PGIE_CLASS_ID_VEHICLE
                            obj = pyds.alloc_nvds_vehicle_object()
                            vobj = pyds.NvDsVehicleObject.cast(obj)
                            vobj.type = "sedan"
                            vobj.color = "blue"
                            vobj.make = "Bugatti"
                            vobj.model = "M"
                            vobj.license = "XX1234"
                            vobj.region = "CA"
                            meta.extMsg = vobj
                            meta.extMsgSize = sys.getsizeof(pyds.NvDsVehicleObject)
                        elif obj_meta.class_id == PGIE_CLASS_ID_PERSON:
                            meta.type = pyds.NvDsEventType.NVDS_EVENT_ENTRY
                            meta.objType = pyds.NvDsObjectType.NVDS_OBJECT_TYPE_PERSON
                            meta.objClassId = PGIE_CLASS_ID_PERSON
                            obj = pyds.alloc_nvds_person_object()
                            pobj = pyds.NvDsPersonObject.cast(obj)
                            pobj.age = 45
                            pobj.cap = "none"
                            pobj.hair = "black"
                            pobj.gender = "male"
                            pobj.apparel = "formal"
                            meta.extMsg = pobj
                            meta.extMsgSize = sys.getsizeof(pyds.NvDsPersonObject)
                        user_event_meta.user_meta_data = meta
                        user_event_meta.base_meta.meta_type = pyds.NvDsMetaType.NVDS_EVENT_MSG_META
                        pyds.nvds_add_user_meta_to_frame(frame_meta, user_event_meta)
                    is_first_object = False
                try:
                    l_obj=l_obj.next
                except StopIteration:
                    break
        except Exception:
            pass

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

    global ros, det_pub, img_b64_pub
    ros = None
    img_b64_pub = None
    snap_enabled = {"value": False}
    snap_period_ms = {"value": 1000}
    last_snap = {"ts": 0}
    snap_dir_env = os.getenv('DS_SNAPSHOT_DIR', '/data/ds/datasets/autocap')
    out_dir = {"path": snap_dir_env}
    try:
        env_ms = int(os.getenv('DS_SNAPSHOT_PERIOD_MS', '0'))
        snap_period_ms["value"] = max(0, env_ms)
        snap_enabled["value"] = snap_period_ms["value"] > 0
    except Exception:
        pass
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
    def _save_meta_once(base_name, meta_json):
        _ensure_dir(out_dir["path"])
        _write_file(os.path.join(out_dir["path"], base_name + "_meta.json"), meta_json.encode("utf-8"))


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

    use_infer = os.getenv('DS_DISABLE_INFER', '0') != '1'
    pgie = None
    if use_infer:
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
    try:
        nvosd.set_property('process-mode', 0)
        nvosd.set_property('display-text', 1)
        nvosd.set_property('display-bbox', 1)
        nvosd.set_property('border-width', 3)
    except Exception:
        pass

    use_egl = os.getenv('DS_USE_EGL', '0') == '1'
    if use_egl:
        sink = Gst.ElementFactory.make("nveglglessink", "nvvideo-renderer")
    else:
        if platform_info.is_integrated_gpu():
            sink = Gst.ElementFactory.make("nv3dsink", "nv3d-sink")
            if not sink:
                sink = Gst.ElementFactory.make("nveglglessink", "nvvideo-renderer")
        else:
            if platform_info.is_platform_aarch64():
                sink = Gst.ElementFactory.make("nveglglessink", "nvvideo-renderer")
            else:
                sink = Gst.ElementFactory.make("nveglglessink", "nvvideo-renderer")
    if not sink:
        sys.stderr.write(" Unable to create display sink \n")

    print("Playing cam %s " %args[1])
    cam_caps = os.getenv('DS_CAM_CAPS', 'video/x-raw')
    out_mode = os.getenv('DS_OUTPUT_MODE', 'display').strip().lower()
    enable_display = (out_mode == 'display')
    enable_caption = (out_mode == 'ros_caption') or (os.getenv('DS_ENABLE_CAPTION', '0') == '1') or (int(os.getenv('DS_SNAPSHOT_PERIOD_MS', '0') or '0') > 0)
    cam_w = int(os.getenv('DS_CAM_WIDTH', '1280'))
    cam_h = int(os.getenv('DS_CAM_HEIGHT', '720'))
    cam_fps = os.getenv('DS_CAM_FPS', '30/1')
    try:
        caps_v4l2src.set_property('caps', Gst.Caps.from_string(f"{cam_caps}, width={cam_w}, height={cam_h}, framerate={cam_fps}"))
    except Exception:
        caps_v4l2src.set_property('caps', Gst.Caps.from_string("video/x-raw, framerate=30/1"))
    caps_vidconvsrc.set_property('caps', Gst.Caps.from_string("video/x-raw(memory:NVMM), format=NV12"))
    caps_rgba.set_property('caps', Gst.Caps.from_string("video/x-raw(memory:NVMM), format=RGBA"))
    source.set_property('device', args[1])
    try:
        source.set_property('do-timestamp', True)
    except Exception:
        pass
    try:
        streammux.set_property('width', cam_w)
        streammux.set_property('height', cam_h)
    except Exception:
        streammux.set_property('width', 1920)
        streammux.set_property('height', 1080)
    streammux.set_property('batch-size', 1)
    streammux.set_property('batched-push-timeout', MUXER_BATCH_TIMEOUT_USEC)
    streammux.set_property('live-source', 1)
    try:
        streammux.set_property('attach-sys-ts', 1)
        streammux.set_property('sync-inputs', 0)
    except Exception:
        pass
    sample_pgie = "/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt"
    default_pgie = sample_pgie if os.path.exists(sample_pgie) else "dstest1_pgie_config.txt"
    pgie_config = os.getenv('DS_PGIE_CONFIG', default_pgie)
    if use_infer and pgie is not None:
        pgie.set_property('config-file-path', pgie_config)
    sink.set_property('sync', False)
    try:
        sink.set_property('async', False)
    except Exception:
        pass
    try:
        sink.set_property('qos', 0)
    except Exception:
        pass

    print("Adding elements to Pipeline \n")
    pipeline.add(source)
    pipeline.add(caps_v4l2src)
    mjpg_dec = None
    if 'image/jpeg' in cam_caps:
        mjpg_dec = Gst.ElementFactory.make("jpegdec", "mjpg_dec")
        if mjpg_dec:
            pipeline.add(mjpg_dec)
    pipeline.add(vidconvsrc)
    pipeline.add(nvvidconvsrc)
    pipeline.add(caps_vidconvsrc)
    pipeline.add(streammux)
    if use_infer and pgie is not None:
        pipeline.add(pgie)
    pipeline.add(nvvidconv)
    pipeline.add(caps_rgba)
    pipeline.add(nvosd)
    tee_presave = Gst.ElementFactory.make("tee", "tee_presave")
    tee_postosd = Gst.ElementFactory.make("tee", "tee_postosd")
    q_pre_osd = Gst.ElementFactory.make("queue", "q_pre_osd")
    try:
        q_pre_osd.set_property('leaky', 2)
        q_pre_osd.set_property('max-size-buffers', 1)
    except Exception:
        pass
    q_pre_clean = Gst.ElementFactory.make("queue", "q_pre_clean")
    q_post_display = Gst.ElementFactory.make("queue", "q_post_display")
    try:
        q_post_display.set_property('leaky', 2)
        q_post_display.set_property('max-size-buffers', 1)
    except Exception:
        pass
    q_post_osd = Gst.ElementFactory.make("queue", "q_post_osd")
    conv_clean = Gst.ElementFactory.make("nvvideoconvert", "conv_clean")
    caps_clean = Gst.ElementFactory.make("capsfilter", "caps_clean")
    caps_clean.set_property('caps', Gst.Caps.from_string("video/x-raw, format=BGR"))
    enc_clean = Gst.ElementFactory.make("jpegenc", "enc_clean")
    sink_clean = Gst.ElementFactory.make("appsink", "sink_clean")
    sink_clean.set_property("emit-signals", True)
    try:
        sink_clean.set_property("max-buffers", 1)
        sink_clean.set_property("drop", True)
    except Exception:
        pass
    conv_osd = Gst.ElementFactory.make("nvvideoconvert", "conv_osd")
    caps_osd = Gst.ElementFactory.make("capsfilter", "caps_osd")
    caps_osd.set_property('caps', Gst.Caps.from_string("video/x-raw, format=BGR"))
    enc_osd = Gst.ElementFactory.make("jpegenc", "enc_osd")
    sink_osd = Gst.ElementFactory.make("appsink", "sink_osd")
    sink_osd.set_property("emit-signals", True)
    try:
        sink_osd.set_property("max-buffers", 1)
        sink_osd.set_property("drop", True)
    except Exception:
        pass
    egltransform = Gst.ElementFactory.make("nvegltransform", "egl_xform")
    pipeline.add(egltransform)
    pipeline.add(sink)
    pipeline.add(tee_presave)
    pipeline.add(tee_postosd)
    pipeline.add(q_pre_osd)
    pipeline.add(q_pre_clean)
    pipeline.add(conv_clean)
    pipeline.add(caps_clean)
    pipeline.add(enc_clean)
    pipeline.add(sink_clean)
    pipeline.add(q_post_osd)
    pipeline.add(conv_osd)
    pipeline.add(caps_osd)
    pipeline.add(enc_osd)
    pipeline.add(q_post_display)
    pipeline.add(sink_osd)
    enable_msg = os.getenv('DS_ENABLE_MSG', '1') != '0'
    if enable_msg:
        try:
            proto_lib_path = os.getenv('DS_MQTT_PROTO_LIB', '/opt/nvidia/deepstream/deepstream-6.0/lib/libnvds_mqtt_proto.so')
            dep_ok = False
            exists_ok = False
            try:
                exists_ok = os.path.exists(proto_lib_path)
            except Exception:
                exists_ok = False
            try:
                import ctypes
                ctypes.CDLL('libmosquitto.so.1')
                dep_ok = True
            except Exception:
                dep_ok = False
            if (not exists_ok) or (not dep_ok):
                enable_msg = False
        except Exception:
            enable_msg = False
    if enable_msg:
        msgconv = Gst.ElementFactory.make("nvmsgconv", "nvmsg-converter")
        msgbroker = Gst.ElementFactory.make("nvmsgbroker", "nvmsg-broker")
        q_post_msg = Gst.ElementFactory.make("queue", "q_post_msg")
        pipeline.add(q_post_msg)
        pipeline.add(msgconv)
        pipeline.add(msgbroker)

    print("Linking elements in the Pipeline \n")
    source.link(caps_v4l2src)
    if mjpg_dec is not None:
        caps_v4l2src.link(mjpg_dec)
        mjpg_dec.link(vidconvsrc)
    else:
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
    if use_infer and pgie is not None:
        streammux.link(pgie)
        pgie.link(nvvidconv)
    else:
        streammux.link(nvvidconv)
    nvvidconv.link(caps_rgba)
    caps_rgba.link(tee_presave)
    tp_src1 = tee_presave.get_request_pad('src_%u')
    tp_sink1 = q_pre_osd.get_static_pad('sink')
    tp_src1.link(tp_sink1)
    q_pre_osd.link(nvosd)
    tp_src2 = tee_presave.get_request_pad('src_%u')
    tp_sink2 = conv_clean.get_static_pad('sink')
    tp_src2.link(tp_sink2)
    conv_clean.link(caps_clean)
    caps_clean.link(enc_clean)
    enc_clean.link(sink_clean)

    nvosd.link(tee_postosd)
    tpo_src1 = tee_postosd.get_request_pad('src_%u')
    tpo_sink1 = q_post_display.get_static_pad('sink')
    tpo_src1.link(tpo_sink1)
    if sink.get_name() == "nv3d-sink":
        q_post_display.link(sink)
    else:
        q_post_display.link(egltransform)
        egltransform.link(sink)
    tpo_src2 = tee_postosd.get_request_pad('src_%u')
    tpo_sink2 = conv_osd.get_static_pad('sink')
    tpo_src2.link(tpo_sink2)
    conv_osd.link(caps_osd)
    caps_osd.link(enc_osd)
    enc_osd.link(sink_osd)

    if enable_msg:
        tpo_src3 = tee_postosd.get_request_pad('src_%u')
        tpo_sink3 = q_post_msg.get_static_pad('sink')
        tpo_src3.link(tpo_sink3)
        q_post_msg.link(msgconv)
        msgconv.link(msgbroker)

    def _on_new_sample(sink, kind):
        global snap_state
        sample = sink.emit("pull-sample")
        if sample is None:
            return Gst.FlowReturn.OK
        buf = sample.get_buffer()
        ok, mapinfo = buf.map(Gst.MapFlags.READ)
        if not ok:
            return Gst.FlowReturn.OK
        data = mapinfo.data
        buf.unmap(mapinfo)
        ts_ms = int(time.time()*1000)
        meta_json = __import__("json").dumps({"frame": det_buf["frame"], "detections": det_buf["dets"]})
        try:
            print(meta_json, flush=True)
            print("JSON_DET:" + meta_json, flush=True)
        except Exception:
            pass
        triggered = _should_snap()
        if triggered:
            snap_state["base"] = str(int(last_snap["ts"]))
            snap_state["deadline"] = ts_ms + 500
            snap_state["meta"] = meta_json
            snap_state["meta_saved"] = False
            snap_state["saved_kinds"] = set()
        if snap_state["base"] is None or ts_ms > snap_state["deadline"]:
            return Gst.FlowReturn.OK
        base = snap_state["base"]
        _ensure_dir(out_dir["path"])
        _write_file(os.path.join(out_dir["path"], base + f"_{kind}.jpg"), data)
        if not snap_state["meta_saved"]:
            _save_meta_once(base, snap_state["meta"]) 
            snap_state["meta_saved"] = True
        snap_state["saved_kinds"].add(kind)
        try:
            _publish_img_b64(data, ts_ms/1000.0, kind)
        except Exception:
            pass
        try:
            _publish_snap_mqtt(data, ts_ms, kind)
        except Exception:
            pass
        if "clean" in snap_state["saved_kinds"] and "osd" in snap_state["saved_kinds"]:
            snap_state["base"] = None
        return Gst.FlowReturn.OK

    def _osd_cb(sink):
        return _on_new_sample(sink, "osd")
    if enable_caption:
        sink_osd.connect("new-sample", _osd_cb)
        try:
            def _clean_cb_bridge(sink):
                return _on_new_sample(sink, "clean")
            sink_clean.connect("new-sample", _clean_cb_bridge)
        except Exception:
            pass

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
            ros_host = os.getenv('DS_ROS_HOST', 'localhost')
            ros_port = int(os.getenv('DS_ROS_PORT', '9090'))
            ros = roslibpy.Ros(host=ros_host, port=ros_port)
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
    global mqtt_client, mqtt_side
    if mqtt is not None:
        try:
            host = os.getenv('DS_MQTT_HOST', '127.0.0.1')
            port = int(os.getenv('DS_MQTT_PORT', '1883'))
            client = mqtt.Client()
            client.connect(host, port, 60)
            client.loop_start()
            mqtt_client = client
            _mqtt_heartbeat_start()
            side = mqtt.Client()
            side.connect(host, port, 60)
            side.loop_start()
            mqtt_side = side
        except Exception:
            mqtt_client = None
            mqtt_side = None
    if enable_msg:
        mcfg = os.getenv('DS_MSGCONV_CONFIG', '/app/share/dstest4_msgconv_config.txt')
        pload = int(os.getenv('DS_MSGCONV_PAYLOAD_TYPE', '0'))
        proto_lib = os.getenv('DS_MQTT_PROTO_LIB', '/opt/nvidia/deepstream/deepstream-6.0/lib/libnvds_mqtt_proto.so')
        conn_str = os.getenv('DS_MQTT_CONN_STR', '127.0.0.1;1883')
        topic = os.getenv('DS_MQTT_TOPIC', 'deepstream/detections')
        try:
            msgconv.set_property('config', mcfg)
            msgconv.set_property('payload-type', pload)
            msgbroker.set_property('proto-lib', proto_lib)
            msgbroker.set_property('conn-str', conn_str)
            msgbroker.set_property('topic', topic)
            msgbroker.set_property('sync', False)
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
