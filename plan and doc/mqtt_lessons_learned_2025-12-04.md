# MQTT Metadata — Lessons Learned (2025-12-04)

- Symptom: Web Output tab showed no detection JSON while DeepStream USB app had active OSD overlays.
- Root causes:
  - Python SSE bridge script in `server.js` hit an EOL string-literal error when building the here-doc.
  - Web app lacked a native MQTT client; relied on container-side Python.
- Fixes:
  - Restructured Python SSE bridge to read `DS_MQTT_HOST/PORT/TOPIC` from env and used a robust here-doc string list. See `jetson-web/server.js:1730–1798`.
  - Added a Node-based MQTT SSE endpoint using the `mqtt` package and wired the UI to prefer it, falling back to Python SSE. See `jetson-web/server.js:15` and `jetson-web/server.js:1801`.
  - Updated the JSON Output UI buttons to start `/sse/mqtt-node` first, then fallback to `/sse/mqtt`. See `jetson-web/public/index.html:859`.
- Build:
  - Rebuilt only the web app image via compose: `docker compose up -d --build web`.
  - Host networking allows `mqtt://127.0.0.1:1883` from the web container.
- Verification:
  - UI now streams detection payloads continuously.
  - Direct check: `curl "http://<jetson-ip>:3000/sse/mqtt-node?host=127.0.0.1&port=1883&topic=deepstream/detections"` shows `data: {...}` lines.
- References:
  - Python SSE bridge: `d:\CiRA DS app\jetson-web\server.js:1743`.
  - Node MQTT SSE: `d:\CiRA DS app\jetson-web\server.js:1801`.
  - UI wiring: `d:\CiRA DS app\jetson-web\public\index.html:859`.
  - Dependency addition: `d:\CiRA DS app\jetson-web\package.json:10–16`.

