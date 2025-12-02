#!/usr/bin/env python3
import sys
import gi
gi.require_version('Gst', '1.0')
gi.require_version('GstRtspServer', '1.0')
from gi.repository import Gst, GLib, GstRtspServer

MUXER_BATCH_TIMEOUT_USEC = 33000

def main(args):
    if len(args) != 2:
        sys.stderr.write("usage: %s <v4l2-device-path>\n" % args[0])
        sys.exit(1)
    device = args[1]
    Gst.init(None)
    launch = (
        f"( v4l2src device={device} ! videoconvert ! nvvidconv ! "
        "video/x-raw(memory:NVMM), format=I420, framerate=30/1 ! "
        "mux.sink_0 nvstreammux name=mux width=1280 height=720 batch-size=1 "
        f"batched-push-timeout={MUXER_BATCH_TIMEOUT_USEC} ! "
        "nvinfer config-file-path=dstest1_pgie_config.txt ! nvvidconv ! nvdsosd ! nvvidconv ! "
        "nvv4l2h264enc insert-sps-pps=true preset-level=1 bitrate=4000000 ! h264parse config-interval=-1 ! rtph264pay name=pay0 pt=96 )"
    )
    server = GstRtspServer.RTSPServer()
    server.set_service("8556")
    factory = GstRtspServer.RTSPMediaFactory()
    factory.set_launch(launch)
    factory.set_shared(True)
    mounts = server.get_mount_points()
    mounts.add_factory("/cam", factory)
    server.attach(None)
    print("rtsp://0.0.0.0:8556/cam")
    loop = GLib.MainLoop()
    loop.run()

if __name__ == '__main__':
    sys.exit(main(sys.argv))
