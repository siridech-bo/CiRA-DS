# DeepStream Web App — Usage and Problem Fixes (2025-11-18)

## Quick Test: OSD With Text
- Labels: open Labels card, path `/app/configs/labels.txt`, add one label per line (e.g., person, bicycle, car, motorbike), click Save
- INI: open INI Editor, click List to browse `/app/configs`, select your INI, click Patch Labels, then Save
- Run: in DeepStream Samples, choose `deepstream-app Custom INI`, set the INI path, enable Auto-build engine, click Run
- HLS: in Video, set Stream `rtsp://127.0.0.1:8554/ds-test`, click Start HLS, Play `/video/out.m3u8`

## Labels Editor
- Path: `/app/configs/labels.txt`
- Actions: Load reads via `/api/configs/read`; Save writes via `/api/configs/save`
- Purpose: nvdsosd uses class names from this file when `labelfile-path=/app/configs/labels.txt` is set in the primary detector config
- Code: UI at `jetson-web/public/index.html:218–228`; handlers at `jetson-web/public/index.html:330–332`

## Patch Labels Helper
- Button: Patch Labels in INI Editor updates `[primary-gie]` to `config-file=/app/configs/pgie_primary.txt`, ensures `[osd] enable=1`, `display-text=1`, and writes `/app/configs/pgie_primary.txt` with `labelfile-path=/app/configs/labels.txt`
- Code: `jetson-web/public/index.html:332–384`

## INI Listing
- Button: List shows all `.ini` files under `/app/configs/` recursively (depth 4), populates selector, and loads selected file
- Server: `GET /api/configs/list?dir=/app/configs/` at `jetson-web/server.js:351–371`
- UI: selector and actions at `jetson-web/public/index.html:219–227`, `jetson-web/public/index.html:329–332`

## HLS Controls
- Start: `POST /api/hls/start` creates `ds_hls` and writes `/video/out.m3u8` (served from `/data/hls`)
- Stop: `POST /api/hls/stop`
- Logs: `GET /api/hls/logs`
- First run note: ffmpeg image pull can take 1–2 minutes; afterward playlist appears in 2–5 seconds
- Code: `jetson-web/server.js:168–221` (plus ffmpeg-first logic `jetson-web/server.js:183–212`); UI buttons `jetson-web/public/index.html:118–127`, start wait loop `jetson-web/public/index.html:311–331`

## DeepStream Samples Runner
- Custom INI: Run with path `/app/configs/...` set in the Samples panel; Auto-build removes stale engines for fresh optimization
- Built-ins: Source1 and Source30 shortcuts for quick overlays and tiled output
- Code: runner `jetson-web/server.js:263–319`; built-in shortcuts `jetson-web/server.js:229–233`

## Problem Fixes Implemented
- HLS end-to-end added: server start/stop/logs routes and Video UI controls
  - Server endpoints: `jetson-web/server.js:168–221`, ffmpeg image fixed to ARM64 `jetson-web/server.js:197`
  - UI controls and playlist wait: `jetson-web/public/index.html:118–127`, `jetson-web/public/index.html:311–331`
- Labels workflow: Labels card to manage `/app/configs/labels.txt` and Patch Labels helper to wire `labelfile-path`
  - Labels UI: `jetson-web/public/index.html:218–228`; Patch helper: `jetson-web/public/index.html:332–384`
- INI browsing: added `GET /api/configs/list` and editor selector to quickly choose configs
  - Server: `jetson-web/server.js:351–371`; UI: `jetson-web/public/index.html:219–227`, `jetson-web/public/index.html:329–332`
- Path validation: preserved secure INI path checks
  - Read/Save APIs: `jetson-web/server.js:332–350`
- RTSP streaming path clarity: use exactly the path printed by DeepStream logs (commonly `rtsp://localhost:8554/ds-test`)
- Architecture mismatch fix: replaced x86 ffmpeg image with multi-arch ARM64 image to avoid `exec format error`

## Troubleshooting
- No overlays: ensure `[osd] enable=1`, `display-text=1`; primary detector config includes `labelfile-path` pointing to `/app/configs/labels.txt`
- 404 on `/video/out.m3u8`: first start may pull ffmpeg; after pull, playlist appears quickly
- Health 503: DeepStream REST connectivity is optional for HLS; set `DEEPSTREAM_URL` correctly in compose if you need Health card
- Camera warnings (Argus) and plugin-scan messages are harmless for file/RTSP pipelines

## Notes
- Access the web UI on Jetson at `http://<jetson-ip>/`; the server printing `http://localhost:<PORT>` refers to inside-container address
- Volumes:
  - `/data/hls` → `/app/public/video` (HLS serving)
  - `/data/videos` → `/app/public/media` (File playback)
  - `/data/ds/configs` → `/app/configs` (INI editing)