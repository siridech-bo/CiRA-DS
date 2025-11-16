# DeepStream Web UI (Option A: Separate DeepStream Container)

This repository provides a lightweight web server and UI that runs on Jetson (Nano/Orin) and controls an existing DeepStream REST server. It serves a responsive browser UI and proxies `/api/*` calls to DeepStream to avoid CORS. It can also serve HLS video segments for playback in the browser.

## Prerequisites
- Jetson Nano/Orin with Docker and the Compose plugin installed
- DeepStream container already installed and able to run the REST server on `:8080`
- Local network access to Jetson for web UI (port `80`)

## Quick Start (Jetson)
1. Clone the repo on Jetson
   - `git clone <your-github-repo-url>`
   - `cd <repo-name>`

2. Ensure DeepStream REST is reachable
   - Start DeepStream the way you normally do (host networking recommended)
   - Verify: `curl http://localhost:8080/api/v1/health`

3. Start the web UI container
   - If DeepStream REST is available at `http://localhost:8080/api/v1` on Jetson:
     - `docker compose up -d`
   - If DeepStream REST is at a different address, set `DEEPSTREAM_URL`:
     - Edit `docker-compose.yml` and change `DEEPSTREAM_URL` accordingly, or
     - `DEEPSTREAM_URL=http://<jetson-ip>:8080/api/v1 docker compose up -d`

4. Open the UI
   - From your PC/phone: `http://<jetson-ip>/`
   - Health should show `connected` if DeepStream is reachable

## Using the UI
- Health: shows connection status to DeepStream
- Stream control:
  - Add: enter camera URI (e.g., `rtsp://username:password@camera-ip:554/stream`) and click “Add Stream”
  - Remove: click “Remove Stream” for `stream_0`
- Inference: set `infer_name`, `batch_size`, `interval`, `gpu_id` and click “Update Inference`
- ROI: set `stream_id`, `roi_id`, `left`, `top`, `width`, `height`, then click “Add/Update ROI`
- Video: provide an HLS manifest (e.g., `/video/stream.m3u8`) and click “Play`

## HLS Playback (Optional)
Browsers do not play RTSP directly. Use HLS for broad compatibility.

1. Configure DeepStream/GStreamer to write HLS segments (`.ts`) and a manifest (`.m3u8`) to a directory on Jetson, e.g., `/data/hls`.
2. Mount the directory into the web container so it’s served at `/video`:
   - Edit `docker-compose.yml` to add:
     - `volumes:`
     - `  - /data/hls:/app/public/video`
3. In the UI “Video” panel, enter `/video/stream.m3u8` and click “Play`.

## Configuration
- `DEEPSTREAM_URL`: base URL to DeepStream REST (default `http://localhost:8080/api/v1`).
- Web server port: mapped to `80` by default in `docker-compose.yml`.

## Troubleshooting
- DeepStream health:
  - `curl http://localhost:8080/api/v1/health` on Jetson should return JSON
- Web server logs:
  - `docker compose logs -f web`
- Network/firewall:
  - Ensure Jetson port `80` is accessible on your LAN
- Wrong `DEEPSTREAM_URL`:
  - Update the env var in `docker-compose.yml` or pass it on the command line

### Docker Hub credential helper timeout on Jetson
Some Jetson environments use `secretservice`/GNOME keyring which can time out when Docker pulls images. Workarounds:
- Temporary config bypass:
  - `mkdir -p /tmp/docker-config`
  - `printf '{"auths":{}}' > /tmp/docker-config/config.json`
  - `sudo -E DOCKER_CONFIG=/tmp/docker-config docker compose up -d`
- Remove credential store from `~/.docker/config.json` by ensuring it contains only `{ "auths": {} }`.

## Stopping/Updating
- Stop: `docker compose down`
- Update image after changes: `docker compose build web && docker compose up -d`

## Files of Interest
- `jetson-web/server.js`: Express server serving UI and proxying `/api/*` to DeepStream
- `jetson-web/public/index.html`: UI with Health, Stream, Inference, ROI forms, and HLS player
- `jetson-web/Dockerfile`: Container image for the web server
- `docker-compose.yml`: Compose service for the web server; set `DEEPSTREAM_URL` here