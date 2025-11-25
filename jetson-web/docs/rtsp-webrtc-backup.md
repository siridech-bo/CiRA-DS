# DeepStream Web RTSP + WebRTC (MediaMTX) Setup — Backup

## Overview
- Goal: Stream RTSP from Jetson and play in browser via WebRTC (WHEP) using MediaMTX.
- Outcome: RTSP at `rtsp://192.168.1.200:8554/ds-test` and WHEP at `http://192.168.1.200:8889/ds-test/whep` both working.
- Web app runs on Jetson at `http://192.168.1.200:3000/`.

## Final Ports and Paths
- Web app port: `3000` (`jetson-web/server.js:15`).
- RTSP port: `8554` (MediaMTX).
- WHEP HTTP port: `8889` (MediaMTX).
- Stream path: `ds-test`.

## Canonical MediaMTX Config (saved on Jetson)
```yaml
webrtc: yes
webrtcAddress: :8889
rtspAddress: :8554

paths:
  ds-test:
    source: rtsp://192.168.1.200:8554/ds-test
```
- Saved to `/data/mediamtx.yml` using API `POST /api/mediamtx/save_host`.
- Read back with `GET /api/mediamtx/read_host`.
- MediaMTX container mounts this file and starts with `Cmd: ["/mediamtx.yml"]` (`jetson-web/server.js:361–377`).

## Web App APIs Used
- Save config to Jetson host: `POST /api/mediamtx/save_host` (body: `{ content: <yaml> }`).
- Read config from Jetson host: `GET /api/mediamtx/read_host`.
- Start MediaMTX (RTSP/WebRTC): `POST /api/rtsp/start`.

## WebRTC Native Player Behavior
- WHEP URL format: `http://<jetson-ip>:8889/<path>/whep`.
- Implementation builds `http://<host>:8889/ds-test/whep` (`jetson-web/public/index.html:1077–1078`).
- Error handling shows status text if response is not OK (`jetson-web/public/index.html:1085–1087`).

## UI Helpers
- Button “Apply ds-test config” writes canonical YAML and starts MediaMTX (`jetson-web/public/index.html:485–491`, `applyMediaMtxConfigDsTest`).
- Quick Commands includes container FFmpeg publish example.

## Quick Publish (FFmpeg)
```
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -c:v libx264 -tune zerolatency -f rtsp -rtsp_transport tcp rtsp://192.168.1.200:8554/ds-test
```
- Added to “Quick Commands” block (`jetson-web/public/index.html:468–482`).

## Start/Restart Sequence
1. Ensure RTSP publisher pushing to `rtsp://192.168.1.200:8554/ds-test` (DeepStream sample or FFmpeg).
2. Save config via `POST /api/mediamtx/save_host` (canonical YAML above).
3. Start MediaMTX via `POST /api/rtsp/start`.
4. Open web app `http://192.168.1.200:3000/`.
5. In “RTSP WebRTC Player (Native)”, use path `ds-test`, click “Play”.

## Troubleshooting Notes
- WHEP 404: Use `/<path>/whep` (not `/whep/<path>`). Confirm path mapping exists in config and RTSP publisher is live.
- Container config: MediaMTX must mount `/data/mediamtx.yml` and start with it (`jetson-web/server.js:361–377`).
- IP vs localhost: Web app logs Jetson IP at startup (`jetson-web/server.js:663–665`); UI derives host via `location.hostname`.
- HLS bind: Host `/data/hls` mounted to app `/app/public/video` (`jetson-web/server.js:490`).

## Change Log (files/lines)
- Port default to `3000`: `jetson-web/server.js:15`.
- Startup log prints device IP: `jetson-web/server.js:663–665`.
- MediaMTX container mounts host config and starts with `Cmd ["/mediamtx.yml"]`: `jetson-web/server.js:361–377`.
- WHEP URL corrected to `/<path>/whep`: `jetson-web/public/index.html:1077–1078`.
- Native WebRTC error handling improved: `jetson-web/public/index.html:1085–1087`.
- UI button to apply config/start server: `jetson-web/public/index.html:485–491`.
- Quick Commands updated with FFmpeg publish: `jetson-web/public/index.html:468–482`.

## Verification
- RTSP confirmed in VLC: `rtsp://192.168.1.200:8554/ds-test`.
- WebRTC native player renders via WHEP: `http://192.168.1.200:8889/ds-test/whep`.
