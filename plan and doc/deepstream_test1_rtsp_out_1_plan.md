# DeepStream Test1 RTSP Out — MCP End-to-End Plan

- Goal: Run `deepstream_test1_rtsp_out_1.py` to loop video input and stream detections continuously to the web app Output tab, controllable via MCP.
- Base file: `D:/CiRA DS app/data/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py`
- Target file: `D:/CiRA DS app/data/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out_1.py`
- Output playlist: `/data/hls/out.m3u8` served at `/video/out.m3u8`

## Artifacts
- Script: `deepstream_test1_rtsp_out_1.py` (OpenCV + GStreamer + DeepStream)
- Logs: `/data/ds/configs/ds_py_rtsp_out.txt`
- HLS: `/data/hls/out.m3u8`, `/data/hls/out_%05d.ts`

## Preconditions
- Jetson web app running and serving `/video/*` from `/data/hls`
- MCP endpoints available: `/api/mcp/upload_raw`, `/api/mcp/validate_python`, `/api/mcp/test_python`, `/api/hls/start`, `/api/hls/stop`, `/api/dspython/stop`

## Steps and Status
1. Prepare target script from base (copy, headers, args)
   - Status: finished
2. Implement looping video input using OpenCV `cv2.VideoCapture` (reopen on EOF)
   - Status: finished
3. Build OpenCV → GStreamer → DeepStream pipeline
   - Status: finished
4. Add HLS output using GStreamer `hlssink` on Jetson; avoid ffmpeg unless an ARM64 image is provided; write to `/data/hls/out.m3u8`; ensure web Output tab loads `/video/out.m3u8`
   - Status: finished
5. Add start/stop control integration: run until explicit stop via MCP (`/api/dspython/stop`) or stop flag in `/data/ds/configs`
   - Status: finished
6. Write runtime logs to `/data/ds/configs/ds_py_rtsp_out.txt`; add health checks
   - Status: finished
7. Upload, validate, start via MCP; verify Output tab plays continuously; stop and cleanly tear down
   - Status: finished (GStreamer path)

## Control and Verification
- Start script: `POST /api/mcp/test_python` with path `.../deepstream_test1_rtsp_out_1.py` and input `'/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264'`
- Start HLS: `POST /api/hls/start` with `uri='udp://127.0.0.1:5600'` (GStreamer hlssink). For RTSP-out, use `uri='rtsp://<host>:8554/ds-test'`.
- Output tab reads `/video/out.m3u8`
- Stop script: `POST /api/dspython/stop`
- Stop HLS: `POST /api/hls/stop`
- Logs: tail `/data/ds/configs/ds_py_rtsp_out.txt`

## Notes
- The pipeline must keep running until user stops; no auto-exit on EOF.
- Use OpenCV for capture and frame pacing; GStreamer for streaming/encode; DeepStream for inference/OSD.
- After each completed step above, update the Status to "finished" with a timestamp.
