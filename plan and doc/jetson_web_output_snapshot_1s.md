# Jetson Web App — Output Tab Snapshot Every Second

## Overview
- Goal: Show snapshot image in Output tab every second without ROS-routing for MQTT payloads.
- Web app runs on Jetson. No need to run `npm start` on the dev machine.
- Snapshot images are served from `AUTOCAP_DIR` via `/autocap` static route.

## Relevant Endpoints and Paths
- Autocap directory: `server.js:156` (`AUTOCAP_DIR`, defaults to `/data/ds/datasets/autocap`)
- Static serving for snapshots: `server.js:159` (`app.use("/autocap", express.static(AUTOCAP_DIR))`)
- List autocap files: `server.js:575` (`GET /api/autocap/list`)
- ROS snapshot control:
  - Period: `server.js:612` (`POST /api/ros/snapshot/period`)
  - Start: `server.js:598` (`POST /api/ros/snapshot/start`)
- MQTT payloads via SSE (no ROS): `server.js:1744` (`GET /sse/mqtt`)

## UI Controls (Output Tab)
- Period input default: `index.html:239` set to `1000` ms.
- Start capture triggers ROS period then start: `index.html:865`.
- Polling refresh interval for images: `index.html:865` set to `1000` ms.
- Image src updates to latest file from `/autocap`: `index.html:861` and `index.html:862`.

## Deploy to Jetson
1. Replace `jetson-web/public/index.html` on Jetson with the updated file.
2. Rebuild/restart your Docker compose stack as usual.
3. Ensure container env has access to `/data/ds/datasets/autocap` or set `AUTOCAP_DIR` accordingly.

## Use
- In Output tab:
  - Set Period to `1000` ms (default).
  - Click `Start Capture`.
  - The image displayed will refresh every second from `/autocap`.
  - Click `Stop Capture` to stop backend snapshot and UI polling.

## Verification
- Open Output tab and observe that the snapshot image updates once per second.
- Optionally call `GET /api/autocap/list?kind=any&limit=50` to confirm new files appear.
- If snapshots do not appear, verify `AUTOCAP_DIR` and ROS bridge connectivity.

## Notes
- Web app is deployed and runs on Jetson; do not run `npm start` on dev.
- MQTT payloads are displayed via SSE endpoint `/sse/mqtt` and are independent of ROS.
- Snapshot capture cadence on the USB app defaults to 1000 ms; can be adjusted via `POST /api/ros/snapshot/period`.
