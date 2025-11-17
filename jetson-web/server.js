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

import { exec } from "child_process";
import fs from "fs";
import os from "os";

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout, stderr, error: err ? String(err) : "" });
    });
  });
}

const DS_IMAGE = process.env.DEEPSTREAM_IMAGE || "nvcr.io/nvidia/deepstream-l4t:6.0.1-samples";
const SNAP_DIR = process.env.SNAP_DIR || "/data/snapshots";

app.post("/api/snapshot/start", async (req, res) => {
  const uri = (req.body && req.body.uri) || "";
  const rate = Number((req.body && req.body.rate) || 1);
  if (!uri) return res.status(400).json({ error: "uri required" });
  await fs.promises.mkdir(SNAP_DIR, { recursive: true });
  const cmd = `docker rm -f ds_snapshot 2>NUL || true && docker run -d --name ds_snapshot --net=host --runtime nvidia -v ${SNAP_DIR}:${SNAP_DIR} ${DS_IMAGE} bash -lc "gst-launch-1.0 rtspsrc location='${uri}' latency=200 ! rtph264depay ! h264parse ! nvv4l2decoder ! videorate drop-only=true max-rate=${rate} ! nvjpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg"`;
  const r = await run(cmd);
  res.json(r);
});

app.post("/api/snapshot/stop", async (_req, res) => {
  const r = await run("docker rm -f ds_snapshot");
  res.json(r);
});

app.listen(PORT, () => {
  console.log(`Web server running at http://localhost:${PORT}/`);
});