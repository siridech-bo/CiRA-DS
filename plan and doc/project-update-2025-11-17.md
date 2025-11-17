# Project Update — DeepStream Web UI on Jetson

Date: 2025-11-17

## Summary
- Web UI (`jetson-web`) runs on Jetson at `http://192.168.1.200/` on port `80`.
- UI proxies DeepStream REST at `http://192.168.1.200:8080/api/v1` using `DEEPSTREAM_URL`.
- UI can start/stop classic DeepStream C/C++ samples via Jetson’s Docker socket.
- Prebuilt DeepStream image includes compiled C/C++ sample apps for Jetson.

## Components
- DeepStream Prebuilt Image
  - Base: `nvcr.io/nvidia/deepstream-l4t:6.0.1-triton` (`deepstream-prebuilt/Dockerfile:1`).
  - Compiles `deepstream-test*` sample apps (`deepstream-prebuilt/Dockerfile:12–16`).
  - Entry keeps container idle (`deepstream-prebuilt/Dockerfile:19`).
- Web App
  - Server routes for REST proxy and local controls (`jetson-web/server.js:17–60`, `jetson-web/server.js:108–167`, `jetson-web/server.js:171–192`).
  - DeepStream sample runner API (`jetson-web/server.js:239–249`, `jetson-web/server.js:251–268`, `jetson-web/server.js:270–278`).
  - Static UI (`jetson-web/public/index.html:1–294`).
  - Container build with port `80` (`jetson-web/Dockerfile:7–9`).
- Deployment Orchestration
  - Compose service `web` using image `jetson-web:local` (`docker-compose.yml:4`).
  - Environment wires REST: `DEEPSTREAM_URL=http://192.168.1.200:8080/api/v1` (`docker-compose.yml:6`).
  - Volumes: HLS, videos, snapshots, Docker socket, bind mounts for `server.js` and `index.html` (`docker-compose.yml:12–17`).

## Deployment Executed
1. Built ARM64 tar of web app on dev machine using Buildx (per README).
2. Transferred `jetson-web.tar` to Jetson and loaded with `docker load`.
3. Launched via `docker compose up -d` (service `web`).
4. Accessed UI at `http://192.168.1.200/` and verified panels.

## Configuration State
- `DEEPSTREAM_URL` points to Jetson REST (`docker-compose.yml:6`).
- Default DeepStream runtime image for snapshot pipelines: `DEEPSTREAM_IMAGE=nvcr.io/nvidia/deepstream-l4t:6.0.1-samples` (`docker-compose.yml:7`).
- Sample runner uses `DS_APP_IMAGE` if provided; otherwise falls back to `DS_IMAGE` (`jetson-web/server.js:104`, `jetson-web/server.js:214`).

## Verified Functionality
- Health
  - `GET /api/health` proxies to DeepStream REST (`jetson-web/server.js:53–60`).
  - Local system health and snapshot stats (`jetson-web/server.js:171–192`).
- Stream/Inference/ROI
  - Add/remove stream (`jetson-web/server.js:17–24`, `jetson-web/server.js:26–33`).
  - Update inference (`jetson-web/server.js:35–42`).
  - ROI management (`jetson-web/server.js:44–51`).
- DeepStream Samples
  - Samples list endpoint (`jetson-web/server.js:239–249`).
  - Dropdown auto-load on page load (`jetson-web/public/index.html:111`, `jetson-web/public/index.html:288`).
  - Run/Stop/Logs handlers (`jetson-web/public/index.html:289–291`) calling server routes (`jetson-web/server.js:251`, `jetson-web/server.js:270`, `jetson-web/server.js:276`).
- Snapshots
  - Start/Logs/Stop/Clear/List (`jetson-web/server.js:108–167`, `jetson-web/server.js:194–208`).
  - Static serving via `/snapshots` (`jetson-web/server.js:106–107`).

## Resolved Issues
- Docker Hub push failures:
  - Credential helper timeout avoided; used password-stdin login.
  - Access denied fixed by creating repo and retagging to correct namespace.

## Notes
- UI shows “localhost” when referencing the Jetson host itself; this is expected since `jetson-web` runs on Jetson.
- X11 bind and `DISPLAY` environment are used when launching sample containers (`jetson-web/server.js:257–265`).

## Next Steps
- Optionally set `DS_APP_IMAGE` to `siridech2/deepstream-l4t:6.0.1-triton-prebuilt` for sample runner consistency.
- Confirm X11 permissions on Jetson desktop (`xhost +local:`) for GUI paths when required.
- Add model/config rendering for `deepstream-app` INI generation from canonical pipeline specs.
- Extend UI to manage sources/inference/tracking/OSD/sinks from a normalized pipeline JSON.