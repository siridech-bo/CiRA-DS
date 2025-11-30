# MCP-Managed DeepStream E2E System

- Objective: Edit DeepStream Python apps on the IDE dev machine, transmit to Jetson via MCP, validate, run, and verify end-to-end streaming.
- Scope: Support all DeepStream Python examples under `deepstream_python_apps/apps/*`, not limited to a single script.

## Roles
- IDE Dev Machine: Code editing only; issues MCP calls; does not run DeepStream.
- Jetson Host: Executes DeepStream Python apps and HLS sidecar; serves `/video/out.m3u8`.

## Paths and Safety
- Allowed container root for Python apps: `/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/`.
- Host-side mirror for raw uploads: `/data/ds/apps/deepstream_python_apps/apps/`.
- HLS output directory on host: `/data/hls` (published as `/video/*`).
- Dev machine guard: `BLOCK_LOCAL=1` blocks start actions on non‑Jetson.

## MCP Tools (Jetson)
- `upload_file`: Atomic write a Python file to container under the allowed root.
- `validate_python`: Compile check via `python3 -m py_compile`.
- `test_python`: Optional upload, validate, then run the Python app; returns RTSP URL.
- `tail_logs`: Tail recent runtime logs from the DeepStream Python app.
- `stop_python`: Stop a running Python app by filename.
- `start_python`: Start the DeepStream Python backend container if not running.
- `hls_start`: Start ffmpeg HLS sidecar; returns playlist `/video/out.m3u8` and pipeline string.
- `hls_logs`: Tail HLS sidecar logs.
- `hls_stop`: Stop the HLS sidecar.

## End-to-End Flow (Any Example)
- Edit locally; keep file under the examples tree when targeting Jetson.
- Upload to Jetson: use `upload_file` with `path` under the allowed root and `content`.
- Validate: use `validate_python` with the container `path`.
- Run: use `test_python` with `path`, `input` (media URI), and `codec`.
- Package stream: use `hls_start` with `uri` (e.g., `udp://127.0.0.1:5600`), timings, and optional ffmpeg image.
- Verify playback: open `/video/out.m3u8`; use `hls_logs` and `tail_logs` for diagnostics.
- Stop: use `stop_python` and `hls_stop`.

## HLS Sidecar
- Host network with bind: `/data/hls:/app/public/video`.
- Low-latency flags: `-fflags nobuffer`, `-flags low_delay`, `-nostats`.
- Source types: RTSP (`-rtsp_transport tcp`), UDP, file; each mapped to ffmpeg args.
- Playlist served at `/video/out.m3u8`.

## Extensibility
- Path-driven design allows running any `apps/*` example by changing `path`.
- Inputs and codecs are provided per example via MCP tool args.
- Config Builder Agent can render DeepStream INI from canonical pipeline specs when needed.

## Example Invocation (Illustrative)
- Start backend: `start_python`.
- Upload: `upload_file { path: "/opt/.../apps/<example>/main.py", content: "..." }`.
- Validate: `validate_python { path: "/opt/.../apps/<example>/main.py" }`.
- Run: `test_python { path, input: "/opt/.../samples/streams/sample_720p.h264", codec: "H264" }` → returns `rtsp`.
- HLS: `hls_start { uri: "udp://127.0.0.1:5600", hls_time: 2, hls_list_size: 5 }` → returns `playlist`.
- Play: `/video/out.m3u8`.
- Logs: `tail_logs`, `hls_logs`.
- Stop: `stop_python`, `hls_stop`.

## Policy
- No execution on the dev machine; all runs occur on Jetson.
- Use MCP for all artifact transfer, validation, and lifecycle management.
