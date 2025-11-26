# DeepStream Python RTSP-out → HLS via FFmpeg

## Checkpoint
- Working pipeline verified: DeepStream encodes video, sends UDP MPEG‑TS to `udp://127.0.0.1:5600`, and `ffmpeg` converts to HLS at `/app/public/video/out.m3u8`.
- Web app serves HLS from `http://<Jetson LAN IP>:3000/video/out.m3u8`.

## Problems Observed
- `ModuleNotFoundError: No module named 'common.platform_info'` in `deepstream_test1_rtsp_out.py` (`data/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py:28`).
- `AttributeError: GstNvStreamMux has no attribute request_pad_simple` when requesting `nvstreammux` sink pad (`line ~260`).
- RTSP output unreachable or VLC not capturing RTP payload.
- NVENC stall and timing issues with `udpsink` when `sync=true`.

## Fixes Applied
- Removed `PlatformInfo` usage and replaced with `_is_aarch64()` platform check using Python `platform` module (`lines ~22–25, ~38, ~125, ~202`).
- Replaced `streammux.request_pad_simple("sink_0")` with `streammux.get_request_pad("sink_0")` (`line ~260`).
- Switched pipeline output from RTP/RTSP to MPEG‑TS over UDP for ffmpeg compatibility:
  - Inserted `h264parse` (`parse_out`) and `mpegtsmux` (`mux`) after encoder.
  - Linked `caps -> encoder -> parse_out -> mux -> udpsink`.
  - Set `udpsink.host='127.0.0.1'`, `port=5600`, `sync=false`.
- Launched `ffmpeg` from Python via `subprocess.Popen` to generate HLS to `/app/public/video/out.m3u8`; process terminates on app exit (`lines ~290–318`).

## Current Outputs
- UDP MPEG‑TS: `udp://127.0.0.1:5600` (Jetson local)
- HLS playlist: `/app/public/video/out.m3u8`
- Web URL: `http://<Jetson LAN IP>:3000/video/out.m3u8`

## ffmpeg Installation
- Host (Jetson): `sudo apt-get update && sudo apt-get install -y ffmpeg`
- Container: `docker exec -it ds_python bash -lc "apt-get update && apt-get install -y ffmpeg"`

## Notes
- RTSP server code was removed in favor of UDP→HLS path that matches the web app; re‑enable RTSP only if external RTSP consumption is required.
- Keep `udpsink.sync=false` to avoid stalls; ensure NVMM path before encoder for Jetson.

## MediaMTX Usage
- Not required for the current HLS workflow. Use MediaMTX only if you need RTSP/RTMP/WebRTC distribution or protocol conversion beyond HLS.
