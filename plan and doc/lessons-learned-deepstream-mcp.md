# Lessons Learned — DeepStream MCP Upload/Run on Jetson

## Summary
- Goal: run dev machine’s `deepstream_test1_rtsp_out.py` and `deepstream_test_2.py` on Jetson via the Jetson-hosted MCP/Web App.
- Constraints: no dev-side services; use Jetson endpoints; avoid ffmpeg-incompatible default scripts.
- Result: end-to-end succeeded using a chunked base64 upload via `/api/dspython/exec`, server-side validation, and `test_python` execution with RTSP streaming.

## Key Symptoms and Errors
- 413 `PayloadTooLargeError` when posting script content to `/api/mcp/test_python` despite small file sizes (~13–16 KB).
- `ds_python not running` from endpoints that require `docker exec` when the container had exited after setup.
- PowerShell `PSReadLine` `ArgumentOutOfRangeException` during interactive multi-line entry caused by console rendering quirks.

## Root Causes
- JSON body parsing limits: although `express.json({ limit: "5mb" })` was present (`jetson-web/server.js:41`), practical requests to certain endpoints still hit `raw-body` size thresholds or upstream middleware; chunked transfers avoid these limits by not sending large JSON bodies.
- Container lifecycle: `/api/dspython/start` ran a finite setup command that exited; all `/api/mcp/*` exec-based operations require a running container.
- Interactive console nuances: PSReadLine can throw cursor-position exceptions if command blocks are pasted or partially rendered; prefer non-interactive, single-shot request scripts.

## Fixes Applied
- Increased JSON limit: `jetson-web/server.js:41` → `express.json({ limit: "5mb" })`.
- Keep container alive: appended `tail -f /dev/null` to the start command so `ds_python` remains running (`jetson-web/server.js:826`).
- Upload workaround: used chunked base64 via `/api/dspython/exec` to write files server-side, bypassing JSON body limits entirely.

## Final Procedure (Step-by-Step)
1. Start container
   - POST `/api/dspython/start` with `{}`; image defaults to `siridech2/deepstream-l4t:pyds-dev` (`jetson-web/server.js:145`).
   - Keep-alive behavior at `jetson-web/server.js:826–847` ensures the container stays running.
2. Upload scripts via chunked exec
   - Create temp files in `/tmp` and append base64 chunks using repeated `/api/dspython/exec` calls.
   - Decode on Jetson to target paths:
     - `/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py`
     - `/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test2/deepstream_test_2.py`
3. Validate
   - POST `/api/mcp/validate_python` with `path` (`jetson-web/server.js:976–997`).
4. Run RTSP-out app
   - POST `/api/mcp/test_python` with `path`, `validate=true`, `input="/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264"`, `codec="H264"` (`jetson-web/server.js:999–1058`).
   - Omit `content` because the file is already uploaded (avoids JSON size limits).
5. Tail logs
   - GET `/api/mcp/tail_logs?tail=600` (file-tail with fallback: `jetson-web/server.js:951–974`).
   - GET `/api/dspython/logs?tail=1600` for general container logs (`jetson-web/server.js:853–861`).
6. RTSP URL
   - Internal response uses `rtsp://127.0.0.1:8554/ds-test`; map to Jetson LAN IP: `rtsp://<jetson-ip>:8554/ds-test`.

## Verification Artifacts
- Upload decode output returned OK sizes (base64-encoded responses):
  - `deepstream_test1_rtsp_out.py` → `OK 13686` (upload1)
  - `deepstream_test_2.py` → `OK 16831` (upload2)
- Validation: `{ status: "ok" }` for both scripts.
- Run: `{ status: "ok", rtsp: "rtsp://127.0.0.1:8554/ds-test" }`; external clients use Jetson IP.

## Operational Notes
- Image: `siridech2/deepstream-l4t:pyds-dev` (`jetson-web/server.js:145`).
- Binds: media/configs/log paths are mounted; logs file written at `/data/ds/configs/ds_py_rtsp_out.txt` (`jetson-web/server.js:1046–1048`).
- UI uses `location.hostname` for RTSP URL; direct clients should use `rtsp://<jetson-ip>:8554/ds-test` (`jetson-web/public/index.html:848–852`).
- Prefer `/api/dspython/exec` for transferring larger content to avoid body-parser constraints.

## Troubleshooting Tips
- `ds_python not running` → restart via `/api/dspython/start`; ensure keep-alive change is deployed (`jetson-web/server.js:826`).
- 413 Payload Too Large → confirm server rebuild with `express.json({ limit: "5mb" })` (`jetson-web/server.js:41`); if limits persist, use chunked exec upload.
- PowerShell `PSReadLine` exceptions → avoid interactive pastes; run non-interactive scripts or single-line commands.
- RTSP unreachable → verify Jetson firewall and client path; use TCP transport in clients where applicable.

## Security Hygiene
- Do not log or echo credentials; use Docker registry auth headers (`jetson-web/server.js:548–557`, `jetson-web/server.js:632–649`).
- Keep uploads atomic and contained under allowed root (`jetson-web/server.js:921–945`).

## Next Improvements
- Integrate canonical pipeline JSON rendering to DeepStream INI from the config builder agent.
- Automate model stack resolution and deterministic config generation.
- Add preflight validation gates before container restarts and runs.

## Network Tuning for RTSP
- Port binding: use `--network host` to expose `8554` directly from the container; confirm no host firewall blocks.
- RTP transport: prefer TCP for lossy networks. Client flags: `-rtsp_transport tcp` in ffmpeg/ffplay/VLC.
- Encoder latency: set `insert-sps-pps=true` and `iframeinterval=30` on `nvv4l2h264enc`; tune `bitrate` per network capacity.
- Jitter and sync: for UDP pipelines, set `udpsink sync=false` to avoid stalls when a receiver is slow.
- RTSP URL mapping: replace `127.0.0.1` with Jetson LAN IP for external clients; UI already does this (`jetson-web/public/index.html:848–852`).

## FFmpeg Interop Details
- Generate HLS from DeepStream via UDP MPEG‑TS (alternative to RTSP for browsers):
  - Pipeline: `encoder -> h264parse -> mpegtsmux -> udpsink host=127.0.0.1 port=5600 sync=false`.
  - ffmpeg HLS: `ffmpeg -i udp://127.0.0.1:5600 -fflags nobuffer -flags low_delay -tune zerolatency -codec copy -hls_time 1 -hls_list_size 4 -hls_delete_threshold 1 -hls_flags delete_segments+append_list -y /app/public/video/out.m3u8`.
- RTSP publishing from ffmpeg (test source): `ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -c:v libx264 -tune zerolatency -f rtsp -rtsp_transport tcp rtsp://<jetson-ip>:8554/ds-test` (see `jetson-web/public/index.html:513`).
- Client playback tips:
  - ffplay: `ffplay -rtsp_transport tcp rtsp://<jetson-ip>:8554/ds-test`.
  - VLC: set network caching low (e.g., 100–300 ms) for minimal latency.
  - Browser HLS: open `http://<jetson-ip>:3000/video/out.m3u8` if HLS pipeline is enabled.

## Quick Command Appendix
- Start DS Python container:
  - `POST /api/dspython/start` body `{}`
- Upload via chunked exec (sketch):
  - `POST /api/dspython/exec` body `{ cmd: ": > /tmp/up_<name>.b64", wait_ms: 50 }`
  - Repeat appends: `{ cmd: "cat >> /tmp/up_<name>.b64 <<'CHUNK'\n<base64chunk>\nCHUNK", wait_ms: 50 }`
  - Decode: `{ cmd: "python3 - <<'PY'\nimport base64,os\np='<target>'\nt='/tmp/up_<name>.b64'\nos.makedirs(os.path.dirname(p),exist_ok=True)\nopen(p,'wb').write(base64.b64decode(open(t,'rb').read()))\nos.chmod(p,0o644)\nprint('OK',os.path.getsize(p))\nPY", wait_ms: 300 }`
- Validate script:
  - `POST /api/mcp/validate_python` body `{ "path": "<container-path>" }`
- Run RTSP-out:
  - `POST /api/mcp/test_python` body `{ "path": "<container-path>", "validate": true, "input": "/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264", "codec": "H264" }`
- Tail logs:
  - `GET /api/mcp/tail_logs?tail=600`
  - `GET /api/dspython/logs?tail=1600`
