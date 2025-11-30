#!/usr/bin/env python3
import argparse
import sys
sys.path.append('../')
import os
import subprocess
import gi
gi.require_version('Gst', '1.0')
gi.require_version('GstRtspServer', '1.0')
from gi.repository import GLib, Gst, GstRtspServer
import platform
def bus_call(bus, message, loop):
    t = message.type
    if t == Gst.MessageType.EOS:
        try:
            print("EOS")
        except Exception:
            pass
        try:
            loop.quit()
        except Exception:
            pass
        return True
    elif t == Gst.MessageType.ERROR:
        try:
            err, dbg = message.parse_error()
        except Exception:
            err = None
            dbg = None
        try:
            print("ERROR", err, dbg)
        except Exception:
            pass
        try:
            loop.quit()
        except Exception:
            pass
        return True
    return True
try:
    import pyds
except Exception:
    import pyds_ext as pyds

PGIE_CLASS_ID_VEHICLE = 0
PGIE_CLASS_ID_BICYCLE = 1
PGIE_CLASS_ID_PERSON = 2
PGIE_CLASS_ID_ROADSIGN = 3
MUXER_BATCH_TIMEOUT_USEC = 33000

def _is_aarch64():
    try:
        return platform.machine().lower() in ("aarch64", "arm64")
    except Exception:
        return False

def osd_sink_pad_buffer_probe(pad,info,u_data):
    frame_number=0
    obj_counter = { PGIE_CLASS_ID_VEHICLE:0, PGIE_CLASS_ID_PERSON:0, PGIE_CLASS_ID_BICYCLE:0, PGIE_CLASS_ID_ROADSIGN:0 }
    gst_buffer = info.get_buffer()
    if not gst_buffer:
        return
    batch_meta = pyds.gst_buffer_get_nvds_batch_meta(hash(gst_buffer))
    l_frame = batch_meta.frame_meta_list
    while l_frame is not None:
        try:
            frame_meta = pyds.NvDsFrameMeta.cast(l_frame.data)
        except StopIteration:
            break
        frame_number=frame_meta.frame_num
        l_obj=frame_meta.obj_meta_list
        while l_obj is not None:
            try:
                obj_meta=pyds.NvDsObjectMeta.cast(l_obj.data)
            except StopIteration:
                break
            obj_counter[obj_meta.class_id] += 1
            try:
                l_obj=l_obj.next
            except StopIteration:
                break
        display_meta=pyds.nvds_acquire_display_meta_from_pool(batch_meta)
        display_meta.num_labels = 1
        py_nvosd_text_params = display_meta.text_params[0]
        py_nvosd_text_params.display_text = "Frame Number={} Number of Objects={} Vehicle_count={} Person_count={}".format(frame_number, frame_meta.num_obj_meta, obj_counter[PGIE_CLASS_ID_VEHICLE], obj_counter[PGIE_CLASS_ID_PERSON])
        py_nvosd_text_params.x_offset = 10
        py_nvosd_text_params.y_offset = 12
        py_nvosd_text_params.font_params.font_name = "Serif"
        py_nvosd_text_params.font_params.font_size = 10
        py_nvosd_text_params.font_params.font_color.set(1.0, 1.0, 1.0, 1.0)
        py_nvosd_text_params.set_bg_clr = 1
        py_nvosd_text_params.text_bg_clr.set(0.0, 0.0, 0.0, 1.0)
        pyds.nvds_add_display_meta_to_frame(frame_meta, display_meta)
        try:
            l_frame=l_frame.next
        except StopIteration:
            break
    return Gst.PadProbeReturn.OK

def build_pipeline(stream_path, codec, bitrate, enc_type, width_hint, height_hint):
    platform_is_integrated = _is_aarch64()
    pipeline = Gst.Pipeline()
    source = Gst.ElementFactory.make("filesrc", "file-source")
    h264parser = Gst.ElementFactory.make("h264parse", "h264-parser")
    decoder = Gst.ElementFactory.make("nvv4l2decoder", "nvv4l2-decoder")
    streammux = Gst.ElementFactory.make("nvstreammux", "Stream-muxer")
    pgie = Gst.ElementFactory.make("nvinfer", "primary-inference")
    nvvidconv = Gst.ElementFactory.make("nvvideoconvert", "convertor")
    nvosd = Gst.ElementFactory.make("nvdsosd", "onscreendisplay")
    nvvidconv_postosd = Gst.ElementFactory.make("nvvideoconvert", "convertor_postosd")
    caps = Gst.ElementFactory.make("capsfilter", "filter")
    if enc_type == 0:
        caps.set_property("caps", Gst.Caps.from_string("video/x-raw(memory:NVMM), format=I420"))
    else:
        caps.set_property("caps", Gst.Caps.from_string("video/x-raw, format=I420"))
    if codec == "H264":
        encoder = Gst.ElementFactory.make("nvv4l2h264enc" if enc_type==0 else "x264enc", "encoder")
    else:
        encoder = Gst.ElementFactory.make("nvv4l2h265enc" if enc_type==0 else "x265enc", "encoder")
    encoder.set_property('bitrate', bitrate)
    if platform_is_integrated and enc_type == 0:
        encoder.set_property('preset-level', 1)
        encoder.set_property('insert-sps-pps', 1)
    parse_out = Gst.ElementFactory.make("h264parse" if codec=="H264" else "h265parse", "parser-out")
    try:
        parse_out.set_property('config-interval', -1)
    except Exception:
        pass
    mux = Gst.ElementFactory.make("mpegtsmux", "ts-mux")
    q1 = Gst.ElementFactory.make("queue", "q1")
    q2 = Gst.ElementFactory.make("queue", "q2")
    sink = Gst.ElementFactory.make("hlssink", "hls-sink")
    try:
        sink.set_property('playlist-location', '/app/public/video/out.m3u8')
        sink.set_property('location', '/app/public/video/out_%05d.ts')
        sink.set_property('max-files', int(hls_list_size))
        sink.set_property('target-duration', int(hls_time))
        sink.set_property('playlist-length', int(hls_list_size))
    except Exception:
        pass
    source.set_property('location', stream_path)
    streammux.set_property('width', int(width_hint or 1920))
    streammux.set_property('height', int(height_hint or 1080))
    streammux.set_property('batch-size', 1)
    streammux.set_property('batched-push-timeout', MUXER_BATCH_TIMEOUT_USEC)
    pgie.set_property('config-file-path', "dstest1_pgie_config.txt")
    pipeline.add(source)
    pipeline.add(h264parser)
    pipeline.add(decoder)
    pipeline.add(streammux)
    pipeline.add(pgie)
    pipeline.add(nvvidconv)
    pipeline.add(nvosd)
    pipeline.add(nvvidconv_postosd)
    pipeline.add(caps)
    pipeline.add(encoder)
    pipeline.add(parse_out)
    pipeline.add(q1)
    pipeline.add(mux)
    pipeline.add(q2)
    pipeline.add(sink)
    source.link(h264parser)
    h264parser.link(decoder)
    sinkpad = streammux.get_request_pad("sink_0")
    srcpad = decoder.get_static_pad("src")
    srcpad.link(sinkpad)
    streammux.link(pgie)
    pgie.link(nvvidconv)
    nvvidconv.link(nvosd)
    nvosd.link(nvvidconv_postosd)
    nvvidconv_postosd.link(caps)
    caps.link(encoder)
    encoder.link(parse_out)
    parse_out.link(q1)
    q1.link(mux)
    mux.link(q2)
    q2.link(sink)
    osdsinkpad = nvosd.get_static_pad("sink")
    osdsinkpad.add_probe(Gst.PadProbeType.BUFFER, osd_sink_pad_buffer_probe, 0)
    try:
        print("PIPELINE_READY")
    except Exception:
        pass
    return pipeline


def main(args):
    Gst.init(None)
    width_hint = None
    height_hint = None
    loop = GLib.MainLoop()
    while True:
        pipeline = build_pipeline(stream_path, codec, bitrate, enc_type, width_hint, height_hint)
        bus = pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", bus_call, loop)
        pipeline.set_state(Gst.State.PLAYING)
        try:
            print("PIPELINE_PLAYING")
        except Exception:
            pass
        try:
            loop.run()
        except Exception:
            pass
        try:
            pipeline.set_state(Gst.State.NULL)
        except Exception:
            pass
        if not loop_forever:
            break
        try:
            GLib.usleep(100000)
        except Exception:
            pass
    try:
        pass
    except Exception:
        pass

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input", required=True)
    parser.add_argument("-c", "--codec", default="H264", choices=['H264','H265'])
    parser.add_argument("-b", "--bitrate", default=4000000, type=int)
    parser.add_argument("-e", "--enc_type", default=0, choices=[0, 1], type=int)
    parser.add_argument("--loop", default=True, action='store_true')
    parser.add_argument("--hls_time", default=2, type=int)
    parser.add_argument("--hls_list_size", default=5, type=int)
    if len(sys.argv)==1:
        parser.print_help(sys.stderr)
        sys.exit(1)
    args = parser.parse_args()
    global codec, bitrate, stream_path, enc_type, loop_forever, hls_time, hls_list_size
    codec = args.codec
    bitrate = args.bitrate
    stream_path = args.input
    enc_type = args.enc_type
    loop_forever = bool(args.loop)
    hls_time = int(args.hls_time)
    hls_list_size = int(args.hls_list_size)
    return 0

if __name__ == '__main__':
    parse_args()
    sys.exit(main(sys.argv))
