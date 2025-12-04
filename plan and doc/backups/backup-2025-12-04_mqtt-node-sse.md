# Backup — MQTT Node SSE Integration (2025-12-04)

- Files referenced and backed up snippets:
  - jetson-web/server.js
  - jetson-web/public/index.html
  - jetson-web/package.json

## jetson-web/server.js

- Import:
```
import mqtt from "mqtt";
```
- Node SSE endpoint:
```
app.get("/sse/mqtt-node", async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const host = String(req.query.host || process.env.DS_MQTT_HOST || "127.0.0.1");
    const port = Number(req.query.port || process.env.DS_MQTT_PORT || 1883);
    const topic = String(req.query.topic || process.env.DS_MQTT_TOPIC || "deepstream/detections");
    const url = `mqtt://${host}:${String(port)}`;
    const client = mqtt.connect(url, { reconnectPeriod: 0 });
    let open = true;
    req.on("close", () => { open = false; try { client.end(true); } catch {} });
    client.on("connect", () => { try { client.subscribe(topic, { qos: 0 }); } catch {} });
    client.on("message", (_t, payload) => { if (!open) return; try { const s = payload ? payload.toString("utf8") : ""; if (s) res.write(`data: ${s}\n\n`); } catch {} });
    client.on("error", (e) => { if (!open) return; try { res.write(`event: status\ndata: {"error":"${String(e && e.message || e)}"}\n\n`); } catch {} });
  } catch {
    try { res.status(500).end(); } catch {}
  }
});
```

## jetson-web/public/index.html

- UI wiring:
```
function startMqttStream() { try { if (window.esMqtt) { try { window.esMqtt.close(); } catch {} window.esMqtt = null; } const host = '127.0.0.1'; const port = 1883; const topic = 'deepstream/detections'; const urlNode = `/sse/mqtt-node?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&topic=${encodeURIComponent(topic)}`; const urlPy = `/sse/mqtt?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&topic=${encodeURIComponent(topic)}`; let used = 'node'; const es = new EventSource(urlNode); window.esMqtt = es; es.onmessage = (ev) => { try { const el = document.getElementById('jsonLogs'); const lines = (el.textContent || '').split(/\r?\n/).filter(Boolean); lines.push(ev.data); el.textContent = lines.slice(-50).join('\n'); } catch {} }; es.onerror = () => { try { if (used === 'node') { try { window.esMqtt.close(); } catch {} const es2 = new EventSource(urlPy); window.esMqtt = es2; used = 'py'; es2.onmessage = (ev) => { try { const el = document.getElementById('jsonLogs'); const lines = (el.textContent || '').split(/\r?\n/).filter(Boolean); lines.push(ev.data); el.textContent = lines.slice(-50).join('\n'); } catch {} }; es2.onerror = () => { try { const el = document.getElementById('jsonLogs'); el.textContent = (el.textContent||'') + '\n(mqtt error)'; } catch {} }; } catch {} else { const el = document.getElementById('jsonLogs'); el.textContent = (el.textContent||'') + '\n(mqtt error)'; } } catch {} } catch {} }
```

## jetson-web/package.json

```
{
  "name": "jetson-web",
  "version": "0.1.0",
  "private": true,
  "main": "server.js",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.23.0",
    "axios": "^1.6.0",
    "express": "^4.18.2",
    "mqtt": "^5.0.0",
    "ws": "^8.16.0",
    "zod": "^3.25.76"
  }
}
```
