import express from "express";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const DEEPSTREAM_URL = process.env.DEEPSTREAM_URL || "http://localhost:8080/api/v1";
let messages = [];

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/stream", async (req, res) => {
  try {
    const r = await axios.post(`${DEEPSTREAM_URL}/stream`, req.body);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/stream/:id", async (req, res) => {
  try {
    const r = await axios.delete(`${DEEPSTREAM_URL}/stream/${req.params.id}`);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/infer", async (req, res) => {
  try {
    const r = await axios.put(`${DEEPSTREAM_URL}/infer`, req.body);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/roi", async (req, res) => {
  try {
    const r = await axios.post(`${DEEPSTREAM_URL}/roi`, req.body);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    const r = await axios.get(`${DEEPSTREAM_URL}/health`);
    res.json({ status: "connected", deepstream: r.data });
  } catch (e) {
    res.status(503).json({ status: "disconnected", error: "Cannot reach DeepStream" });
  }
});

app.post("/api/message", (req, res) => {
  const t = (req.body && req.body.text) || "";
  if (!t) return res.status(400).json({ error: "text required" });
  const m = { text: t, ts: Date.now() };
  messages.push(m);
  if (messages.length > 500) messages.shift();
  res.json({ ok: true });
});

app.get("/api/message", (_req, res) => {
  res.json({ messages });
});

app.delete("/api/message", (_req, res) => {
  messages = [];
  res.json({ ok: true });
});

import fs from "fs";
import http from "http";

function dockerRequest(method, path, body) {
  return new Promise((resolve) => {
    const opts = { socketPath: "/var/run/docker.sock", path, method, headers: {} };
    let payload = null;
    if (body) {
      payload = Buffer.from(JSON.stringify(body));
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = String(payload.length);
    }
    const req = http.request(opts, (resp) => {
      let data = "";
      resp.on("data", (c) => { data += c; });
      resp.on("end", () => { resolve({ statusCode: resp.statusCode || 0, body: data }); });
    });
    req.on("error", (e) => { resolve({ statusCode: 0, body: String(e) }); });
    if (payload) req.write(payload);
    req.end();
  });
}

const DS_IMAGE = process.env.DEEPSTREAM_IMAGE || "nvcr.io/nvidia/deepstream-l4t:6.0.1-samples";
const SNAP_DIR = process.env.SNAP_DIR || "/data/snapshots";

app.post("/api/snapshot/start", async (req, res) => {
  const uri = (req.body && req.body.uri) || "";
  const rate = Number((req.body && req.body.rate) || 1);
  if (!uri) return res.status(400).json({ error: "uri required" });
  await fs.promises.mkdir(SNAP_DIR, { recursive: true });
  const cmd = `gst-launch-1.0 rtspsrc location='${uri}' latency=200 ! rtph264depay ! h264parse ! nvv4l2decoder ! videorate drop-only=true max-rate=${rate} ! nvjpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg`;
  await dockerRequest("DELETE", "/containers/ds_snapshot?force=true");
  const createBody = {
    Image: DS_IMAGE,
    Entrypoint: ["bash"],
    Cmd: ["-lc", cmd],
    HostConfig: { NetworkMode: "host", Runtime: "nvidia", Binds: [`${SNAP_DIR}:${SNAP_DIR}`] }
  };
  const created = await dockerRequest("POST", "/containers/create?name=ds_snapshot", createBody);
  if (created.statusCode < 200 || created.statusCode >= 300) return res.status(500).json({ error: created.body });
  const start = await dockerRequest("POST", "/containers/ds_snapshot/start");
  if (start.statusCode < 200 || start.statusCode >= 300) return res.status(500).json({ error: start.body });
  res.json({ ok: true });
});

app.post("/api/snapshot/stop", async (_req, res) => {
  await dockerRequest("POST", "/containers/ds_snapshot/stop");
  await dockerRequest("DELETE", "/containers/ds_snapshot?force=true");
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Web server running at http://localhost:${PORT}/`);
});