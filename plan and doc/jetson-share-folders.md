# Jetson Shared Folders for DeepStream Docker (cira-space MCP)

## Overview
- Use shared host directories mounted into the DeepStream containers to avoid HTTP upload limits and enable direct file access.
- Python apps are loaded from the share and executed inside the `ds_python` container with `PYTHONPATH` including the share.

## Host → Container Mounts
- HLS output: `/data/hls` → `/app/public/video`
  - Writes `out.m3u8` and `out_%05d.ts` segments
  - Configured in server: `jetson-web/server.js:238–248`, `598`, `948`, `1274`, `1554`
- Configs: `/app/configs` → `/app/configs`
  - Read/write via API: `openapi.json:47–51`
  - Included in binds for app runs: `jetson-web/server.js:592–600`
- Media: `/data/videos` → `/data/videos`
  - Listed via API and used by pipelines: `jetson-web/server.js:580–600`, admin env `openapi.json:57–60`
- DS Python share (primary for custom scripts): `/data/ds/share` → `/app/share`
  - Python path includes `/app/share`: `jetson-web/server.js:609–611`, `1288–1290`
  - Upload helper: `SHARE_ROOT` defined for host writes: `jetson-web/server.js:1349–1356`
- DS Python apps mirror (optional): `/data/ds/apps/deepstream_python_apps` → `/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps`
  - Used when running built-in examples: `jetson-web/server.js:1275`
- pyds shim (optional): `/data/ds/apps/pyds_ext` → `/workspace/pyds_ext`
  - Shim setup and `PYDS_SHIM`: `jetson-web/server.js:1292–1295`
- DS runtime logs: `/data/ds/configs` → `/data/ds/configs`
  - Python app logs: `ds_py_rtsp_out.txt`
  - Referenced in `jetson-web/server.js:1225–1227`, `592–600`

## Recommended Locations for Custom Apps
- Place Python apps under the host share:
  - Host: `/data/ds/share/<your_app>.py`
  - Container: `/app/share/<your_app>.py`
  - Validated and run by MCP with `PYTHONPATH=/app/share`
- Alternatively mirror to the DS sources tree:
  - Host: `/data/ds/apps/deepstream_python_apps/apps/<sample>/<file>.py`
  - Container: `/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/<sample>/<file>.py`

## MCP Endpoints (Reference)
- Start DS Python orchestrator: `POST /api/dspython/start_example` (sets binds and `PYTHONPATH`)
- Test Python app: `POST /api/mcp/test_python` (path under container, optional content upload)
- Tail logs: `GET /api/mcp/tail_logs?tail=600`
- Stop Python app: `POST /api/mcp/stop_python`

## Notes
- RTSP→HLS uses UDP MPEG‑TS to HLS with output under `/app/public/video` mapped to `/data/hls`.
- Admin env exposes configured dirs: `GET /api/admin/env` reports `MEDIA_DIR`, `CONFIGS_DIR`, `DS_IMAGE`.
