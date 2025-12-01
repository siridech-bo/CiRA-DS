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
try:
    import cv2
except Exception:
    cv2 = None
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
    use_appsrc = False
    try:
        use_appsrc = bool(globals().get('opencv_appsrc', False)) and cv2 is not None
    except Exception:
        use_appsrc = False
    simple_hls = False
    try:
        simple_hls = bool(globals().get('simple_hls', False))
    except Exception:
        simple_hls = False
    pipeline = Gst.Pipeline()
    source = Gst.ElementFactory.make("filesrc", "file-source")
    h264parser = Gst.ElementFactory.make("h264parse" if codec=="H264" else "h265parse", "parser-in")
    try:
        h264parser.set_property('config-interval', -1)
    except Exception:
        pass
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
    if use_appsrc:
        encoder = Gst.ElementFactory.make("x264enc" if codec=="H264" else "x265enc", "encoder")
    else:
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
        import os
        os.makedirs('/app/public/video', exist_ok=True)
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
    try:
        import os
        base = os.environ.get('NVDS_PATH', '/opt/nvidia/deepstream/deepstream-6.0')
        local_cfg = "dstest1_pgie_config.txt"
        cfg1 = os.path.join(base, 'sources', 'deepstream_python_apps', 'apps', 'deepstream-test1', 'dstest1_pgie_config.txt')
        cfg = local_cfg if os.path.isfile(local_cfg) else cfg1
        pgie.set_property('config-file-path', cfg)
    except Exception:
        pgie.set_property('config-file-path', "dstest1_pgie_config.txt")
    pipeline.add(caps)
    pipeline.add(encoder)
    pipeline.add(parse_out)
    pipeline.add(q1)
    pipeline.add(mux)
    pipeline.add(q2)
    pipeline.add(sink)
    if not use_appsrc:
        pipeline.add(source)
        pipeline.add(h264parser)
        pipeline.add(decoder)
        pipeline.add(streammux)
        pipeline.add(pgie)
        pipeline.add(nvvidconv)
        pipeline.add(nvosd)
        pipeline.add(nvvidconv_postosd)
    demux = None
    try:
        ext = os.path.splitext(stream_path)[1].lower()
        if ext in (".mp4", ".mov", ".m4v"):
            demux = Gst.ElementFactory.make("qtdemux", "demux")
        elif ext in (".mkv", ".webm"):
            demux = Gst.ElementFactory.make("matroskademux", "demux")
    except Exception:
        demux = None
    if simple_hls:
        source.set_property('location', stream_path)
        pipeline.add(source)
        ext = None
        try:
            ext = os.path.splitext(stream_path)[1].lower()
        except Exception:
            ext = None
        dem = None
        if ext in ('.mp4','.mov','.m4v'):
            dem = Gst.ElementFactory.make('qtdemux','qtdemux')
        elif ext in ('.mkv','.webm'):
            dem = Gst.ElementFactory.make('matroskademux','matroskademux')
        if dem is not None:
            qd = Gst.ElementFactory.make('queue','qd')
            pipeline.add(dem)
            pipeline.add(qd)
            source.link(dem)
            qd.link(parse_out)
            def _pad_added(_d, pad):
                try:
                    caps = pad.get_current_caps()
                    s = caps.to_string() if caps is not None else ''
                    if ('video/x-h264' in s and codec=='H264') or ('video/x-h265' in s and codec=='H265'):
                        sinkpad = qd.get_static_pad('sink')
                        if not sinkpad.is_linked():
                            pad.link(sinkpad)
                except Exception:
                    pass
            dem.connect('pad-added', _pad_added)
            try:
                parse_out.set_property('config-interval', -1)
            except Exception:
                pass
            parse_out.link(q1)
            q1.link(mux)
            mux.link(q2)
            q2.link(sink)
        else:
            dec = Gst.ElementFactory.make('decodebin','dec')
            vc2 = Gst.ElementFactory.make('videoconvert','vc2')
            qd = Gst.ElementFactory.make('queue','qd')
            pipeline.add(dec)
            pipeline.add(vc2)
            pipeline.add(qd)
            source.link(dec)
            def _pad_added2(_d, pad):
                try:
                    if pad.get_current_caps() is not None:
                        sinkpad = vc2.get_static_pad('sink')
                        if not sinkpad.is_linked():
                            pad.link(sinkpad)
                except Exception:
                    pass
            dec.connect('pad-added', _pad_added2)
            vc2.link(caps)
            caps.link(encoder)
            try:
                encoder.set_property('speed-preset', 'ultrafast')
                encoder.set_property('tune', 'zerolatency')
                encoder.set_property('key-int-max', 30)
                encoder.set_property('bframes', 0)
            except Exception:
                pass
            encoder.link(parse_out)
            try:
                parse_out.set_property('config-interval', -1)
            except Exception:
                pass
            parse_out.link(q1)
            q1.link(mux)
            mux.link(q2)
            q2.link(sink)
    elif use_appsrc:
        appsrc = Gst.ElementFactory.make("appsrc", "opencv-src")
        vc = Gst.ElementFactory.make("videoconvert", "opencv-vc")
        qsrc = Gst.ElementFactory.make("queue", "q-src")
        qenc = Gst.ElementFactory.make("queue", "q-enc")
        pipeline.add(appsrc)
        pipeline.add(vc)
        pipeline.add(qsrc)
        pipeline.add(qenc)
        try:
            cap = cv2.VideoCapture(stream_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
        except Exception:
            fps = 30.0
            w = int(width_hint or 1920)
            h = int(height_hint or 1080)
        appsrc.set_property("is-live", False)
        appsrc.set_property("block", True)
        appsrc.set_property("format", Gst.Format.TIME)
        try:
            appsrc.set_property("do-timestamp", True)
        except Exception:
            pass
        appsrc.set_property("caps", Gst.Caps.from_string("video/x-raw,format=BGR,width=%d,height=%d,framerate=%d/1" % (w, h, int(fps or 30))))
        if platform_is_integrated and enc_type == 0 and codec == "H264":
            nvvconv_in = Gst.ElementFactory.make("nvvideoconvert", "opencv-nvv")
            pipeline.add(nvvconv_in)
            caps.set_property("caps", Gst.Caps.from_string("video/x-raw(memory:NVMM), format=I420"))
            encoder = Gst.ElementFactory.make("nvv4l2h264enc", "encoder")
            encoder.set_property('bitrate', bitrate)
            try:
                encoder.set_property('preset-level', 1)
                encoder.set_property('insert-sps-pps', 1)
            except Exception:
                pass
            pipeline.add(encoder)
            appsrc.link(qsrc)
            qsrc.link(vc)
            vc.link(nvvconv_in)
            nvvconv_in.link(caps)
            caps.link(qenc)
            qenc.link(encoder)
        else:
            caps.set_property("caps", Gst.Caps.from_string("video/x-raw, format=I420"))
            appsrc.link(qsrc)
            qsrc.link(vc)
            vc.link(caps)
            caps.link(qenc)
            qenc.link(encoder)
        try:
            encoder.set_property('speed-preset', 'ultrafast')
            encoder.set_property('tune', 'zerolatency')
            encoder.set_property('key-int-max', int(fps or 30))
            encoder.set_property('bframes', 0)
            encoder.set_property('byte-stream', True)
        except Exception:
            pass
        encoder.link(parse_out)
        parse_out.link(q1)
        q1.link(mux)
        mux.link(q2)
        q2.link(sink)
        ts = 0
        dur = int(Gst.SECOND / int(fps or 30))
        fcnt = 0
        def _need_data(src, length):
            nonlocal ts
            nonlocal fcnt
            try:
                ret, frame = cap.read()
            except Exception:
                ret = False
                frame = None
            if not ret:
                try:
                    src.end_of_stream()
                except Exception:
                    pass
                return
            try:
                data = frame.tobytes()
                buf = Gst.Buffer.new_allocate(None, len(data), None)
                buf.fill(0, data)
                buf.pts = ts
                buf.dts = ts
                buf.duration = dur
                ts += dur
                src.emit("push-buffer", buf)
                fcnt += 1
                if (fcnt % 60) == 0:
                    try:
                        print("APP_SRC_FRAMES", fcnt)
                    except Exception:
                        pass
            except Exception:
                try:
                    src.end_of_stream()
                except Exception:
                    pass
        appsrc.connect("need-data", _need_data)
    else:
        if demux is not None:
            qdemux = Gst.ElementFactory.make("queue", "demux_q")
            pipeline.add(demux)
            pipeline.add(qdemux)
            source.link(demux)
            qdemux.link(h264parser)
            def _on_pad_added(_demux, pad):
                try:
                    caps = pad.get_current_caps()
                    ok = False
                    if caps is not None:
                        try:
                            s = caps.to_string()
                            if ("audio/" in s):
                                ok = False
                            elif ("video/x-h264" in s and codec=="H264") or ("video/x-h265" in s and codec=="H265"):
                                ok = True
                        except Exception:
                            ok = False
                    if ok:
                        sinkpad = qdemux.get_static_pad("sink")
                        if not sinkpad.is_linked():
                            pad.link(sinkpad)
                except Exception:
                    pass
            demux.connect("pad-added", _on_pad_added)
        else:
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
    parser.add_argument("--opencv_preconvert", default=False, action='store_true')
    parser.add_argument("--opencv_appsrc", default=False, action='store_true')
    parser.add_argument("--simple_hls", default=False, action='store_true')
    if len(sys.argv)==1:
        parser.print_help(sys.stderr)
        sys.exit(1)
    args = parser.parse_args()
    global codec, bitrate, stream_path, enc_type, loop_forever, hls_time, hls_list_size, opencv_appsrc, simple_hls
    codec = args.codec
    bitrate = args.bitrate
    stream_path = args.input
    enc_type = args.enc_type
    loop_forever = bool(args.loop)
    hls_time = int(args.hls_time)
    hls_list_size = int(args.hls_list_size)
    opencv_appsrc = bool(args.opencv_appsrc)
    simple_hls = bool(args.simple_hls)
    try:
        ext = os.path.splitext(stream_path)[1].lower()
        need_convert = args.opencv_preconvert and cv2 is not None and ext in (".mp4",".mov",".m4v",".mkv",".webm")
    except Exception:
        need_convert = False
    if need_convert:
        try:
            cap = cv2.VideoCapture(stream_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
            fourcc = None
            try:
                fourcc = cv2.VideoWriter_fourcc(*'H264')
            except Exception:
                pass
            if not fourcc:
                try:
                    fourcc = cv2.VideoWriter_fourcc(*'avc1')
                except Exception:
                    fourcc = 0
            out_path_raw = "/data/videos/_preconvert.h264"
            out_path_mp4 = "/data/videos/_preconvert.mp4"
            dst_path = out_path_raw
            writer = cv2.VideoWriter(dst_path, fourcc, fps, (w, h))
            if not writer.isOpened():
                dst_path = out_path_mp4
                writer = cv2.VideoWriter(dst_path, fourcc, fps, (w, h))
            ok_total = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                writer.write(frame)
                ok_total += 1
            try:
                writer.release()
                cap.release()
            except Exception:
                pass
            if ok_total > 0:
                stream_path = dst_path
                codec = "H264"
        except Exception:
            pass
    return 0

if __name__ == '__main__':
    parse_args()
    sys.exit(main(sys.argv))
