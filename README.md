# DeepStream Web UI (Option A)

This repository provides a lightweight web server and UI that runs on Jetson (Nano/Orin) and controls an existing DeepStream REST server. The UI is responsive (desktop/mobile), proxies `/api/*` calls to DeepStream, and can serve HLS video segments for browser playback.

## Prerequisites
- Jetson with Docker and Compose plugin installed
- DeepStream container installed and running REST on `:8080`
- LAN access to Jetson on port `80`

## Installation

### A. Build on Dev Machine and Load on Jetson (recommended)
1. Build ARM64 tar on dev machine (Docker Desktop with Buildx):
   - `docker buildx create --use`
   - `docker run --privileged --rm tonistiigi/binfmt --install all`
   - `docker buildx build --platform linux/arm64 -t jetson-web:local ./jetson-web --output type=tar,dest=jetson-web.tar`
2. Transfer to Jetson and load:
   - `scp jetson-web.tar <jetson-user>@<jetson-ip>:/tmp/`
   - `ssh <jetson-user>@<jetson-ip>`
   - `sudo docker load -i /tmp/jetson-web.tar`
3. Start web UI with Compose:
   - `sudo docker compose up -d`
4. Open the UI:
   - `http://<jetson-ip>/`

### B. Use Compose Build on Jetson (if Docker Hub pulls are reliable)
1. Ensure DeepStream REST is reachable:
   - `curl http://localhost:8080/api/v1/health`
2. Start web UI:
   - `sudo docker compose up -d`

## Configuration
- `DEEPSTREAM_URL` default: `http://localhost:8080/api/v1`
  - Change in `docker-compose.yml` if DeepStream isn’t on host networking
- HLS mapping (optional): `/data/hls` on Jetson → `/app/public/video` in container
  - `volumes: - /data/hls:/app/public/video`

## Using the UI
- Health: status of DeepStream connectivity
- Stream: add/remove a source
- Inference: update `infer_name`, `batch_size`, `interval`, `gpu_id`
- ROI: set `stream_id`, `roi_id`, `left`, `top`, `width`, `height`
- Video: enter `/video/stream.m3u8` and click “Play” if HLS is produced

## Troubleshooting
- DeepStream health: `curl http://localhost:8080/api/v1/health`
- Logs: `sudo docker compose logs -f web`
- Firewall: ensure Jetson port `80` is accessible
- `DEEPSTREAM_URL` mismatch: update in `docker-compose.yml`
- Credential helper timeout on Jetson:
  - `mkdir -p /tmp/docker-config`
  - `printf '{"auths":{}}' > /tmp/docker-config/config.json`
  - `sudo docker --config /tmp/docker-config compose up -d`

## Stopping/Updating
- Stop: `sudo docker compose down`
- Update with prebuild: rebuild tar on dev, reload on Jetson, then `sudo docker compose up -d`

## Files
- `jetson-web/server.js`
- `jetson-web/public/index.html`
- `jetson-web/Dockerfile`
- `docker-compose.yml`