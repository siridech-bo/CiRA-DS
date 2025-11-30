import express from "express";
import http from "http";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import { spawnSync, spawn } from "child_process";
import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000; // fallback for local runs; compose sets PORT=3000
console.log("Starting Jetson Web backend, node=" + process.version + ", PORT=" + PORT);
function isJetsonHost() {
  try {
    if (os.platform() !== "linux") return false;
    try { if (fs.existsSync("/opt/nvidia/deepstream/deepstream-6.0")) return true; } catch {}
    if (fs.existsSync("/etc/nv_tegra_release")) return true;
    try {
      const m = fs.readFileSync("/proc/device-tree/model", "utf8").toLowerCase();
      if (m.includes("jetson")) return true;
    } catch {}
    try { if (process.arch === "arm64") return true; } catch {}
  } catch {}
  return false;
}
const JETSON_ONLY = String(process.env.JETSON_ONLY || "false").toLowerCase() === "true";
const IS_JETSON = String(process.env.IS_JETSON || "false").toLowerCase() === "true";
if (JETSON_ONLY && !(isJetsonHost() || IS_JETSON)) {
  console.error("JETSON_ONLY=true: Jetson not detected, continuing startup");
}
const BLOCK_LOCAL = String(process.env.BLOCK_LOCAL || "").toLowerCase() === "1";
function devBlocked() { return BLOCK_LOCAL && !(isJetsonHost() || IS_JETSON); }
const DEEPSTREAM_URL = process.env.DEEPSTREAM_URL || "http://localhost:8080/api/v1";
let messages = [];

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/video", express.static("/data/hls"));


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

import https from "https";

const DOCKER_HOST_HTTP = process.env.DOCKER_HOST_HTTP || "";

function dockerRequest(method, reqPath, body, headers) {
  return new Promise((resolve) => {
    let opts = { method, headers: {} };
    let requester = http;
    if (DOCKER_HOST_HTTP) {
      try {
        const u = new URL(DOCKER_HOST_HTTP);
        requester = u.protocol === "https:" ? https : http;
        opts = { protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: reqPath, method, headers: {} };
      } catch {}
    } else {
      opts = { socketPath: "/var/run/docker.sock", path: reqPath, method, headers: {} };
    }
    let payload = null;
    if (body) {
      payload = Buffer.from(JSON.stringify(body));
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = String(payload.length);
    }
    if (headers && typeof headers === "object") {
      for (const k of Object.keys(headers)) { opts.headers[k] = headers[k]; }
    }
    const req = requester.request(opts, (resp) => {
      let data = "";
      resp.on("data", (c) => { data += c; });
      resp.on("end", () => { resolve({ statusCode: resp.statusCode || 0, body: data }); });
    });
    req.on("error", (e) => { resolve({ statusCode: 0, body: String(e) }); });
    if (payload) req.write(payload);
    req.end();
  });
}

const DS_IMAGE = process.env.DEEPSTREAM_IMAGE || "siridech2/deepstream-l4t:pyds-dev";
const SNAP_DIR = process.env.SNAP_DIR || "/data/snapshots";
const CONFIGS_DIR = process.env.CONFIGS_DIR || "/app/configs/";
const MEDIA_DIR = process.env.MEDIA_DIR || "/data/videos";
app.use("/snapshots", express.static(SNAP_DIR));
app.use("/media", express.static(MEDIA_DIR));

app.post("/api/snapshot/start", async (req, res) => {
  let uri = (req.body && req.body.uri) || "";
  const rate = Number((req.body && req.body.rate) || 1);
  if (!uri) return res.status(400).json({ error: "uri required" });
  await fs.promises.mkdir(SNAP_DIR, { recursive: true });
  if (uri.startsWith("/media/")) { uri = "/data/videos/" + uri.slice(7); }
  const isRtsp = uri.startsWith("rtsp://");
  const ext = (() => { try { return (path.extname(uri) || "").toLowerCase(); } catch { return ""; } })();
  const cmds = [];
  if (isRtsp) {
    cmds.push(`gst-launch-1.0 rtspsrc location='${uri}' latency=200 ! rtph264depay ! h264parse ! nvv4l2decoder ! nvvidconv ! video/x-raw,format=I420 ! videorate drop-only=true max-rate=${rate} ! jpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg`);
    cmds.push(`gst-launch-1.0 rtspsrc location='${uri}' latency=200 ! rtph265depay ! h265parse ! nvv4l2decoder ! nvvidconv ! video/x-raw,format=I420 ! videorate drop-only=true max-rate=${rate} ! nvjpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg`);
  } else {
    cmds.push(`gst-launch-1.0 -vv playbin uri='file://${uri}' video-sink=\"videoconvert ! jpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg\" audio-sink=fakesink`);
    cmds.push(`gst-launch-1.0 uridecodebin uri='file://${uri}' ! videoconvert ! jpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg`);
    cmds.push(`gst-launch-1.0 filesrc location='${uri}' ! decodebin ! videoconvert ! jpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg`);
    cmds.push(`gst-launch-1.0 filesrc location='${uri}' ! qtdemux ! h264parse ! nvv4l2decoder ! nvvidconv ! video/x-raw,format=I420 ! videorate drop-only=true max-rate=${rate} ! jpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg`);
    cmds.push(`gst-launch-1.0 filesrc location='${uri}' ! qtdemux ! h265parse ! nvv4l2decoder ! nvvidconv ! video/x-raw,format=I420 ! videorate drop-only=true max-rate=${rate} ! jpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg`);
    cmds.push(`gst-launch-1.0 filesrc location='${uri}' ! decodebin ! nvvidconv ! video/x-raw,format=I420 ! videorate drop-only=true max-rate=${rate} ! nvjpegenc ! multifilesink location=${SNAP_DIR}/snap_%05d.jpg`);
  }
  await dockerRequest("DELETE", "/containers/ds_snapshot?force=true");
  const binds = [`${SNAP_DIR}:${SNAP_DIR}`];
  if (!isRtsp) { try { const dir = path.dirname(uri); binds.push(`${dir}:${dir}`); } catch {} }
  let ok = false, used = "";
  for (const c of cmds) {
    const body = { Image: DS_IMAGE, Entrypoint: ["bash"], Cmd: ["-lc", c], HostConfig: { NetworkMode: "host", Runtime: "nvidia", Binds: binds } };
    await dockerRequest("DELETE", "/containers/ds_snapshot?force=true");
    const created = await dockerRequest("POST", "/containers/create?name=ds_snapshot", body);
    if (created.statusCode < 200 || created.statusCode >= 300) continue;
    const start = await dockerRequest("POST", "/containers/ds_snapshot/start");
    if (start.statusCode >= 200 && start.statusCode < 300) { ok = true; used = c; break; }
  }
  // If started but no images produced shortly, fallback to ffmpeg snapshot
  if (ok) {
    try {
      await new Promise(r => setTimeout(r, 1500));
      const files = await fs.promises.readdir(SNAP_DIR);
      const count = files.filter(f => f.toLowerCase().endsWith(".jpg")).length;
      if (count === 0) {
        await dockerRequest("POST", "/containers/ds_snapshot/stop");
        await dockerRequest("DELETE", "/containers/ds_snapshot?force=true");
        ok = false; used = "";
      }
    } catch {}
  }
  if (!ok) return res.status(500).json({ error: "failed to start snapshot" });
  let count = 0;
  try { const files = await fs.promises.readdir(SNAP_DIR); count = files.filter(f => f.toLowerCase().endsWith('.jpg')).length; } catch {}
  res.json({ ok: true, pipeline: used, count });
});

app.get("/api/snapshot/logs", async (_req, res) => {
  const logs = await dockerRequest("GET", "/containers/ds_snapshot/logs?stdout=1&stderr=1&tail=200");
  res.type("text/plain").send(logs.body || "");
});

app.post("/api/snapshot/stop", async (_req, res) => {
  await dockerRequest("POST", "/containers/ds_snapshot/stop");
  await dockerRequest("DELETE", "/containers/ds_snapshot?force=true");
  res.json({ ok: true });
});

app.delete("/api/snapshot/clear", async (_req, res) => {
  try {
    await fs.promises.mkdir(SNAP_DIR, { recursive: true });
    const files = await fs.promises.readdir(SNAP_DIR);
    let deleted = 0;
    await Promise.all(files.map(async (f) => {
      if (f.toLowerCase().endsWith(".jpg")) {
        try { await fs.promises.unlink(path.join(SNAP_DIR, f)); deleted++; } catch {}
      }
    }));
    res.json({ ok: true, deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/hls/start", async (req, res) => {
  let uri = (req.body && req.body.uri) || "";
  const hlsTime = Number((req.body && req.body.hls_time) || 2);
  const hlsListSize = Number((req.body && req.body.hls_list_size) || 5);
  const target = "/app/public/video/out.m3u8";
  const hostTarget = "/data/hls/out.m3u8";
  if (devBlocked()) return res.status(403).json({ error: "blocked_on_dev" });
  if (!uri) return res.status(400).json({ error: "uri required" });
  if (uri.startsWith("/media/")) { uri = "/data/videos/" + uri.slice(7); }
  const isRtsp = uri.startsWith("rtsp://");
  const isUdp = uri.startsWith("udp://");
  const binds = ["/data/hls:/app/public/video"];
  if (!isRtsp && !isUdp) { try { const dir = path.dirname(uri); binds.push(`${dir}:${dir}`); } catch {}
  }
  const baseSink = `hlssink max-files=${Math.max(1,hlsListSize)} target-duration=${Math.max(1,hlsTime)} playlist-location=${target} location=/app/public/video/out_%05d.ts`;
  await dockerRequest("DELETE", "/containers/ds_hls?force=true");
  let ok = false, used = "";
  const ffimg = String((req.body && req.body.image) || "lscr.io/linuxserver/ffmpeg:latest");
  let ffCmd = [];
  if (isRtsp) {
    ffCmd = [
      "-hide_banner","-nostats","-loglevel","warning","-fflags","nobuffer","-flags","low_delay",
      "-rtsp_transport","tcp","-i", uri,
      "-c:v","copy",
      "-f","hls","-hls_time", String(Math.max(1,hlsTime)), "-hls_list_size", String(Math.max(1,hlsListSize)), "-hls_flags","delete_segments",
      target
    ];
  } else if (isUdp) {
    ffCmd = [
      "-hide_banner","-nostats","-loglevel","warning","-fflags","nobuffer","-flags","low_delay",
      "-i", uri,
      "-c:v","copy",
      "-f","hls","-hls_time", String(Math.max(1,hlsTime)), "-hls_list_size", String(Math.max(1,hlsListSize)), "-hls_flags","delete_segments",
      target
    ];
  } else {
    ffCmd = [
      "-hide_banner","-nostats","-loglevel","warning","-re",
      "-i", uri,
      "-c:v","copy",
      "-f","hls","-hls_time", String(Math.max(1,hlsTime)), "-hls_list_size", String(Math.max(1,hlsListSize)), "-hls_flags","delete_segments",
      target
    ];
  }
  if (isUdp) {
    try {
      const cmd = `nohup gst-launch-1.0 -vv udpsrc uri='${uri}' ! tsdemux ! h264parse config-interval=-1 ! mpegtsmux ! ${baseSink} &`;
      const created = await dockerRequest("POST", "/containers/ds_python/exec", { AttachStdout: true, AttachStderr: true, Cmd: ["bash","-lc", cmd] });
      const id = JSON.parse(created.body || "{}").Id || "";
      if (id) {
        await dockerRequest("POST", `/exec/${id}/start`, { Detach: true, Tty: false });
        await new Promise(r => setTimeout(r, 15000));
        await fs.promises.access(hostTarget, fs.constants.R_OK);
        ok = true; used = cmd;
      }
    } catch {}
  }
  await dockerRequest("DELETE", "/containers/ds_hls?force=true");
  let created = await dockerRequest("POST", "/containers/create?name=ds_hls", { Image: ffimg, Cmd: ffCmd, HostConfig: { NetworkMode: "host", Binds: binds } });
  if (!(created.statusCode >= 200 && created.statusCode < 300)) {
    await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(ffimg)}`);
    await dockerRequest("DELETE", "/containers/ds_hls?force=true");
    created = await dockerRequest("POST", "/containers/create?name=ds_hls", { Image: ffimg, Cmd: ffCmd, HostConfig: { NetworkMode: "host", Binds: binds } });
  }
  if (created.statusCode >= 200 && created.statusCode < 300) {
    const start = await dockerRequest("POST", "/containers/ds_hls/start");
    if (start.statusCode >= 200 && start.statusCode < 300) {
      ok = true; used = `ffmpeg ${ffCmd.join(" ")}`;
      try {
        let found = false;
        for (let i = 0; i < 30; i++) { try { await fs.promises.access(hostTarget, fs.constants.R_OK); found = true; break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
        if (!found) throw new Error("playlist_missing");
      } catch {
        try { await dockerRequest("POST", "/containers/ds_hls/stop"); } catch {}
        try { await dockerRequest("DELETE", "/containers/ds_hls?force=true"); } catch {}
        ok = false; used = "";
      }
    }
  }
  if (!ok) {
    const cmds = [];
    if (isRtsp) {
      cmds.push(`gst-launch-1.0 -vv rtspsrc location='${uri}' latency=500 ! rtph264depay ! h264parse config-interval=-1 ! mpegtsmux ! ${baseSink}`);
      cmds.push(`gst-launch-1.0 -vv rtspsrc location='${uri}' latency=500 ! rtph265depay ! h265parse ! mpegtsmux ! ${baseSink}`);
    } else if (isUdp) {
      cmds.push(`gst-launch-1.0 -vv udpsrc uri='${uri}' ! tsdemux ! h264parse config-interval=-1 ! mpegtsmux ! ${baseSink}`);
      cmds.push(`gst-launch-1.0 -vv udpsrc uri='${uri}' ! tsdemux ! h265parse ! mpegtsmux ! ${baseSink}`);
    } else {
      cmds.push(`gst-launch-1.0 -vv filesrc location='${uri}' ! qtdemux ! h264parse config-interval=-1 ! mpegtsmux ! ${baseSink}`);
      cmds.push(`gst-launch-1.0 -vv filesrc location='${uri}' ! qtdemux ! h265parse ! mpegtsmux ! ${baseSink}`);
      cmds.push(`gst-launch-1.0 -vv filesrc location='${uri}' ! matroskademux ! h264parse config-interval=-1 ! mpegtsmux ! ${baseSink}`);
    }
    for (const c of cmds) {
      const body = { Image: DS_IMAGE, Entrypoint: ["bash"], Cmd: ["-lc", c], HostConfig: { NetworkMode: "host", Binds: binds } };
      await dockerRequest("DELETE", "/containers/ds_hls?force=true");
      const created2 = await dockerRequest("POST", "/containers/create?name=ds_hls", body);
      if (created2.statusCode < 200 || created2.statusCode >= 300) continue;
      const start2 = await dockerRequest("POST", "/containers/ds_hls/start");
      if (start2.statusCode >= 200 && start2.statusCode < 300) {
        ok = true; used = c;
        try {
          await new Promise(r => setTimeout(r, 15000));
          await fs.promises.access(hostTarget, fs.constants.R_OK);
          break;
        } catch {
          try { await dockerRequest("POST", "/containers/ds_hls/stop"); } catch {}
          try { await dockerRequest("DELETE", "/containers/ds_hls?force=true"); } catch {}
          ok = false; used = "";
        }
      }
    }
  }
  if (!ok) {
    const ffimg = String((req.body && req.body.image) || "jrottenberg/ffmpeg:4.4-alpine");
    let ffCmd = [];
    if (isRtsp) {
      ffCmd = [
        "-hide_banner","-nostats","-loglevel","warning","-fflags","nobuffer","-flags","low_delay",
        "-rtsp_transport","tcp","-i", uri,
        "-c:v","copy",
        "-f","hls","-hls_time", String(Math.max(1,hlsTime)), "-hls_list_size", String(Math.max(1,hlsListSize)), "-hls_flags","delete_segments",
        target
      ];
    } else if (isUdp) {
      ffCmd = [
        "-hide_banner","-nostats","-loglevel","warning","-fflags","nobuffer","-flags","low_delay",
        "-i", uri,
        "-c:v","copy",
        "-f","hls","-hls_time", String(Math.max(1,hlsTime)), "-hls_list_size", String(Math.max(1,hlsListSize)), "-hls_flags","delete_segments",
        target
      ];
    } else {
      ffCmd = [
        "-hide_banner","-nostats","-loglevel","warning","-re",
        "-i", uri,
        "-c:v","copy",
        "-f","hls","-hls_time", String(Math.max(1,hlsTime)), "-hls_list_size", String(Math.max(1,hlsListSize)), "-hls_flags","delete_segments",
        target
      ];
    }
    await dockerRequest("DELETE", "/containers/ds_hls?force=true");
    let created = await dockerRequest("POST", "/containers/create?name=ds_hls", { Image: ffimg, Cmd: ffCmd, HostConfig: { NetworkMode: "host", Binds: binds } });
    if (!(created.statusCode >= 200 && created.statusCode < 300)) {
      await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(ffimg)}`);
      await dockerRequest("DELETE", "/containers/ds_hls?force=true");
      created = await dockerRequest("POST", "/containers/create?name=ds_hls", { Image: ffimg, Cmd: ffCmd, HostConfig: { NetworkMode: "host", Binds: binds } });
    }
  if (created.statusCode >= 200 && created.statusCode < 300) {
    const start = await dockerRequest("POST", "/containers/ds_hls/start");
    if (start.statusCode >= 200 && start.statusCode < 300) {
      ok = true; used = `ffmpeg ${ffCmd.join(" ")}`;
      try {
        let found = false;
        for (let i = 0; i < 30; i++) { try { await fs.promises.access(hostTarget, fs.constants.R_OK); found = true; break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
        if (!found) throw new Error("playlist_missing");
      } catch {
        try { await dockerRequest("POST", "/containers/ds_hls/stop"); } catch {}
        try { await dockerRequest("DELETE", "/containers/ds_hls?force=true"); } catch {}
        ok = false; used = "";
      }
    }
  }
  }
  if (!ok) return res.status(500).json({ error: "failed to start hls" });
  res.json({ ok: true, pipeline: used, playlist: "/video/out.m3u8" });
});

app.post("/api/hls/stop", async (_req, res) => {
  await dockerRequest("POST", "/containers/ds_hls/stop");
  await dockerRequest("DELETE", "/containers/ds_hls?force=true");
  res.json({ ok: true });
});

app.get("/api/hls/logs", async (_req, res) => {
  const logs = await dockerRequest("GET", "/containers/ds_hls/logs?stdout=1&stderr=1&tail=200");
  res.type("text/plain").send(logs.body || "");
});
app.post("/api/hls/clear", async (_req, res) => {
  const IS_JETSON = String(process.env.IS_JETSON || "false").toLowerCase() === "true";
  if (!(isJetsonHost() || IS_JETSON)) { return res.status(403).json({ error: "jetson-only" }); }
  try {
    await dockerRequest("POST", "/containers/ds_hls/stop");
    await dockerRequest("DELETE", "/containers/ds_hls?force=true");
  } catch {}
  try {
    const dir = path.join(__dirname, "public", "video");
    await fs.promises.mkdir(dir, { recursive: true });
    const files = await fs.promises.readdir(dir);
    let deleted = 0;
    await Promise.all(files.map(async (f) => {
      const low = f.toLowerCase();
      if (low.endsWith(".m3u8") || low.endsWith(".ts")) {
        try { await fs.promises.unlink(path.join(dir, f)); deleted++; } catch {}
      }
    }));
    res.json({ ok: true, deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/e2e/rtsp_out_1", async (req, res) => {
  try {
    if (devBlocked()) return res.status(403).json({ error: "blocked_on_dev" });
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    let running = false; try { const st = JSON.parse(info.body || "{}").State || null; running = !!(st && st.Running); } catch {}
    if (!running) {
      try { await axios.post(`http://127.0.0.1:${PORT}/api/dspython/start`, { install: false, useGit: false }); } catch {}
      await new Promise(r => setTimeout(r, 6000));
    }
    const pathPy = "/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out_1.py";
    const input = "/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264";
    let rtsp = null;
    try {
      const r = await axios.post(`http://127.0.0.1:${PORT}/api/mcp/test_python`, { path: pathPy, validate: true, input, codec: "H264" });
      rtsp = (r.data && r.data.rtsp) || null;
    } catch (e) {
      return res.status(500).json({ error: "python_start_failed", detail: String(e && e.message || e) });
    }
    let hls = null, pipeline = null;
    try {
      const r = await axios.post(`http://127.0.0.1:${PORT}/api/hls/start`, { uri: "udp://127.0.0.1:5600", hls_time: Number((req.body && req.body.hls_time) || 2), hls_list_size: Number((req.body && req.body.hls_list_size) || 5), image: (req.body && req.body.image) || undefined });
      hls = (r.data && r.data.playlist) || null; pipeline = (r.data && r.data.pipeline) || null;
    } catch (e) {
      return res.status(500).json({ error: "hls_start_failed", detail: String(e && e.message || e) });
    }
    let ok = false;
    for (let i = 0; i < 30; i++) { try { await fs.promises.access("/data/hls/out.m3u8", fs.constants.R_OK); ok = true; break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    if (!ok) return res.status(500).json({ error: "playlist_missing" });
    res.json({ ok: true, playlist: hls || "/video/out.m3u8", pipeline, rtsp });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/rtsp/start", async (_req, res) => {
  const image = process.env.RTSP_IMAGE || "bluenviron/mediamtx:latest";
  await dockerRequest("DELETE", "/containers/rtsp_server?force=true");
  const body = { Image: image, Cmd: ["/mediamtx.yml"], HostConfig: { NetworkMode: "host", Binds: ["/data/mediamtx.yml:/mediamtx.yml", "/data:/data"] } };
  let created = await dockerRequest("POST", "/containers/create?name=rtsp_server", body);
  if (!(created.statusCode >= 200 && created.statusCode < 300)) {
    await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(image)}`);
    await dockerRequest("DELETE", "/containers/rtsp_server?force=true");
    created = await dockerRequest("POST", "/containers/create?name=rtsp_server", body);
  }
  if (created.statusCode >= 200 && created.statusCode < 300) {
    const start = await dockerRequest("POST", "/containers/rtsp_server/start");
    if (start.statusCode >= 200 && start.statusCode < 300) {
      return res.json({ ok: true, uri: "rtsp://127.0.0.1:8554/ds-test" });
    }
  }
  res.status(500).json({ ok: false });
});

app.post("/api/rtsp/stop", async (_req, res) => {
  await dockerRequest("POST", "/containers/rtsp_server/stop");
  await dockerRequest("DELETE", "/containers/rtsp_server?force=true");
  res.json({ ok: true });
});

app.get("/api/rtsp/logs", async (_req, res) => {
  const logs = await dockerRequest("GET", "/containers/rtsp_server/logs?stdout=1&stderr=1&tail=200");
  res.type("text/plain").send(logs.body || "");
});

function toNumber(v) { try { return Number(v) || 0; } catch { return 0; } }

app.get("/api/local-health", async (_req, res) => {
  let snapCount = 0;
  try { const files = await fs.promises.readdir(SNAP_DIR); snapCount = files.filter(f => f.endsWith(".jpg")).length; } catch {}
  const info = await dockerRequest("GET", "/containers/ds_snapshot/json");
  let state = null;
  try { state = JSON.parse(info.body).State || null; } catch {}
  const statsResp = await dockerRequest("GET", "/containers/ds_snapshot/stats?stream=false");
  let cpuPercent = 0, memUsage = 0, memLimit = 0, gpu = null;
  try {
    const s = JSON.parse(statsResp.body);
    const cpuDelta = toNumber(s.cpu_stats && s.cpu_stats.cpu_usage && s.cpu_stats.cpu_usage.total_usage) - toNumber(s.precpu_stats && s.precpu_stats.cpu_usage && s.precpu_stats.cpu_usage.total_usage);
    const sysDelta = toNumber(s.cpu_stats && s.cpu_stats.system_cpu_usage) - toNumber(s.precpu_stats && s.precpu_stats.system_cpu_usage);
    const cpus = (s.cpu_stats && s.cpu_stats.online_cpus) || (s.cpu_stats && s.cpu_stats.cpu_usage && s.cpu_stats.cpu_usage.percpu_usage && s.cpu_stats.cpu_usage.percpu_usage.length) || 1;
    cpuPercent = sysDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
    memUsage = toNumber(s.memory_stats && s.memory_stats.usage);
    memLimit = toNumber(s.memory_stats && s.memory_stats.limit);
    gpu = s.gpu_stats || null;
  } catch {}
  const load = os.loadavg();
  const uptime = os.uptime();
  res.json({ snap: { state, cpuPercent, memUsage, memLimit, gpu, snapCount }, system: { load, uptime } });
});

app.get("/api/snapshot/list", async (req, res) => {
  try {
    const files = await fs.promises.readdir(SNAP_DIR);
    const jpgs = files.filter(f => f.toLowerCase().endsWith(".jpg"));
    const stats = await Promise.all(jpgs.map(async f => {
      const s = await fs.promises.stat(path.join(SNAP_DIR, f));
      return { f, t: s.mtimeMs };
    }));
    stats.sort((a, b) => b.t - a.t);
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 100000));
    res.json({ files: stats.slice(0, limit).map(x => x.f) });
  } catch (e) {
    res.json({ files: [] });
  }
});

app.get("/api/media/list", async (_req, res) => {
  try {
    function pickExistingDir() {
      const candidates = [MEDIA_DIR, "/data/videos", path.join(__dirname, "public", "media")];
      for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
      return MEDIA_DIR;
    }
    const base = pickExistingDir();
    const exts = new Set([".mp4", ".mkv", ".avi", ".mov", ".ts", ".h264", ".h265", ".webm"]);
    async function walk(p, depth, out) {
      const ents = await fs.promises.readdir(p, { withFileTypes: true });
      for (const e of ents) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) { if (depth < 3) { await walk(full, depth + 1, out); } }
        else {
          const ext = (path.extname(full) || "").toLowerCase();
          if (exts.has(ext)) {
            const rel = path.relative(base, full).split(path.sep).join("/");
            out.push("/media/" + rel);
          }
        }
      }
    }
    const out = [];
    await walk(base, 0, out);
    out.sort();
    res.json({ dir: "/media/", files: out });
  } catch (e) {
    res.status(500).json({ error: e.message, files: [] });
  }
});

app.get("/api/admin/env", (_req, res) => {
  res.json({
    isJetson: isJetsonHost(),
    PORT,
    DEEPSTREAM_URL,
    CONFIGS_DIR,
    JETSON_ONLY,
    IS_JETSON: String(process.env.IS_JETSON || "false").toLowerCase() === "true",
    MEDIA_DIR,
    DS_IMAGE,
    DOCKER_HOST_HTTP
  });
});

app.post("/api/debug/run", async (req, res) => {
  try {
    const cmd = String((req.body && req.body.cmd) || "").trim();
    if (!cmd) return res.status(400).json({ error: "cmd required" });
    const image = String((req.body && req.body.image) || DS_IMAGE);
    const waitMs = Math.max(0, Math.min(1800000, Number((req.body && req.body.wait_ms) || 180000)));
    const binds = [
      `${MEDIA_DIR}:${MEDIA_DIR}`,
      `${CONFIGS_DIR}:${CONFIGS_DIR}`,
      "/data/ds/configs:/data/ds/configs",
      "/data/weight_config:/data/weight_config",
      "/app/configs:/host_app_configs",
      "/data/hls:/app/public/video"
    ];
    const env = [
      `DISPLAY=${process.env.DISPLAY || ":0"}`,
      "CUDA_VER=10.2",
      "PLATFORM_TEGRA=1",
      "NVDS_PATH=/opt/nvidia/deepstream/deepstream-6.0",
      "GST_PLUGIN_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/gst-plugins:/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
      "GST_PLUGIN_SYSTEM_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/gst-plugins:/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
      "GI_TYPELIB_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/girepository-1.0",
      "LD_LIBRARY_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib:/usr/local/cuda-10.2/lib64:/usr/lib/aarch64-linux-gnu:/usr/lib/arm-linux-gnueabihf"
    ];
    await dockerRequest("DELETE", "/containers/ds_debug?force=true");
    const body = { Image: image, Entrypoint: ["bash"], Cmd: ["-lc", cmd], Env: env, HostConfig: { NetworkMode: "host", Runtime: "nvidia", Binds: binds } };
    const created = await dockerRequest("POST", "/containers/create?name=ds_debug", body);
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "create_failed", detail: created.body });
    const start = await dockerRequest("POST", "/containers/ds_debug/start");
    if (!(start.statusCode >= 200 && start.statusCode < 300)) return res.status(500).json({ error: "start_failed", detail: start.body });
    await new Promise(r => setTimeout(r, waitMs));
    const logs = await dockerRequest("GET", "/containers/ds_debug/logs?stdout=1&stderr=1&tail=20000");
    await dockerRequest("POST", "/containers/ds_debug/stop");
    await dockerRequest("DELETE", "/containers/ds_debug?force=true");
    res.type("text/plain").send(logs.body || "");
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get("/api/admin/containers", async (_req, res) => {
  const names = ["ds_app","ds_hls","ds_snapshot","rtsp_server"];
  const out = {};
  for (const n of names) {
    const info = await dockerRequest("GET", `/containers/${n}/json`);
    try { out[n] = JSON.parse(info.body).State || null; } catch { out[n] = null; }
  }
  res.json(out);
});

app.post("/api/docker/pull", async (req, res) => {
  try {
    const image = (req.body && req.body.image) || "";
    const tag = (req.body && req.body.tag) || "latest";
    if (!image) return res.status(400).json({ error: "image required" });
    const fromImage = encodeURIComponent(image);
    const tagParam = encodeURIComponent(tag);
    let headers = undefined;
    const auth = (req.body && req.body.auth) || null;
    if (auth && typeof auth === "object") {
      const payload = Buffer.from(JSON.stringify(auth)).toString("base64");
      headers = { "X-Registry-Auth": payload };
    }
    const r = await dockerRequest("POST", `/images/create?fromImage=${fromImage}&tag=${tagParam}`, undefined, headers);
    if (r.statusCode >= 200 && r.statusCode < 300) return res.type("text/plain").send(r.body || "");
    return res.status(500).json({ error: "pull_failed", detail: r.body, status: r.statusCode });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/docker/login", async (req, res) => {
  try {
    const username = (req.body && req.body.username) || "";
    const password = (req.body && req.body.password) || "";
    const serveraddress = (req.body && req.body.serveraddress) || "";
    if (!username || !password || !serveraddress) return res.status(400).json({ error: "username, password, serveraddress required" });
    const body = { username, password, serveraddress, email: (req.body && req.body.email) || "" };
    const r = await dockerRequest("POST", "/auth", body);
    return res.status(r.statusCode || 200).type("text/plain").send(r.body || "");
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get("/api/docker/images", async (_req, res) => {
  try {
    const r = await dockerRequest("GET", "/images/json");
    let data = [];
    try { data = JSON.parse(r.body || "[]"); } catch {}
    res.status(r.statusCode || 200).json(Array.isArray(data) ? data : []);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get("/api/docker/image/inspect", async (req, res) => {
  try {
    const name = String((req.query && req.query.name) || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const r = await dockerRequest("GET", `/images/${encodeURIComponent(name)}/json`);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      try { return res.status(200).json(JSON.parse(r.body || "{}")); } catch { return res.status(200).type("text/plain").send(r.body || ""); }
    }
    return res.status(404).json({ error: "not_found", status: r.statusCode, detail: r.body || "" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get("/api/docker/image/exists", async (req, res) => {
  try {
    const name = String((req.query && req.query.name) || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const r = await dockerRequest("GET", `/images/${encodeURIComponent(name)}/json`);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      let obj = null;
      try { obj = JSON.parse(r.body || "{}"); } catch {}
      const tags = (obj && obj.RepoTags) || [];
      return res.json({ exists: true, name, tags });
    }
    return res.json({ exists: false, name, status: r.statusCode });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get("/api/docker/container/inspect", async (req, res) => {
  try {
    const name = String((req.query && req.query.name) || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const r = await dockerRequest("GET", `/containers/${encodeURIComponent(name)}/json`);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      try { return res.status(200).json(JSON.parse(r.body || "{}")); } catch { return res.status(200).type("text/plain").send(r.body || ""); }
    }
    return res.status(404).json({ error: "not_found", status: r.statusCode, detail: r.body || "" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/docker/tag", async (req, res) => {
  try {
    const source = String((req.body && req.body.source) || "").trim();
    const repo = String((req.body && req.body.repo) || "").trim();
    const tag = String((req.body && req.body.tag) || "latest").trim();
    if (!source || !repo) return res.status(400).json({ error: "source and repo required" });
    const r = await dockerRequest("POST", `/images/${encodeURIComponent(source)}/tag?repo=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`);
    if (r.statusCode >= 200 && r.statusCode < 300) return res.json({ ok: true, source, target: `${repo}:${tag}` });
    return res.status(500).json({ error: "tag_failed", status: r.statusCode, detail: r.body || "" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/docker/push", async (req, res) => {
  try {
    const image = String((req.body && req.body.image) || "").trim();
    const tag = String((req.body && req.body.tag) || "latest").trim();
    if (!image) return res.status(400).json({ error: "image required" });
    let headers = undefined;
    const auth = (req.body && req.body.auth) || null;
    if (auth && typeof auth === "object") {
      const payload = Buffer.from(JSON.stringify(auth)).toString("base64");
      headers = { "X-Registry-Auth": payload };
    }
    const r = await dockerRequest("POST", `/images/${encodeURIComponent(image)}/push?tag=${encodeURIComponent(tag)}`, undefined, headers);
    if (r.statusCode >= 200 && r.statusCode < 300) return res.type("text/plain").send(r.body || "");
    return res.status(500).json({ error: "push_failed", status: r.statusCode, detail: r.body || "" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/docker/tag", async (req, res) => {
  try {
    const source = String((req.body && req.body.source) || "").trim();
    const repo = String((req.body && req.body.repo) || "").trim();
    const tag = String((req.body && req.body.tag) || "latest").trim();
    if (!source || !repo) return res.status(400).json({ error: "source and repo required" });
    const r = await dockerRequest("POST", `/images/${encodeURIComponent(source)}/tag?repo=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`);
    if (r.statusCode >= 200 && r.statusCode < 300) return res.json({ ok: true, source, repo, tag });
    return res.status(500).json({ error: "tag_failed", detail: r.body || "", status: r.statusCode });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

const server = http.createServer(app);
server.listen(PORT, () => {
  try {
    const nets = os.networkInterfaces();
    let ip = "localhost";
    for (const k of Object.keys(nets)) {
      const arr = nets[k] || [];
      for (const a of arr) { if (a && a.family === "IPv4" && !a.internal) { ip = a.address; break; } }
      if (ip !== "localhost") break;
    }
    console.log(`Web server running at http://${ip}:${PORT}/`);
  } catch {
    console.log(`Web server running on port ${PORT}`);
  }
});

let WebSocketServer = null; let nodePty = null;
try {
  const wsMod = await import("ws");
  WebSocketServer = wsMod.WebSocketServer || wsMod.Server || null;
} catch {}
if (!WebSocketServer) {
  try {
    const req = createRequire(import.meta.url);
    const wsMod = req("ws");
    WebSocketServer = wsMod.WebSocketServer || wsMod.Server || null;
  } catch {}
}
const TERM_PTY_ENABLED = String(process.env.TERM_PTY_ENABLED || "").toLowerCase() === "1";
if (TERM_PTY_ENABLED) {
  try { nodePty = await import("node-pty"); } catch {}
}
let TERM_MODE = "disabled";
if (WebSocketServer && nodePty && nodePty.spawn) {
  const wssHost = new WebSocketServer({ server, path: "/ws/terminal" });
  console.log("Web terminal: PTY fallback container/host at /ws/terminal");
  TERM_MODE = "pty";
  wssHost.on("connection", (ws) => {
    const shell = process.platform === "win32" ? "powershell.exe" : "bash";
    const args = process.platform === "win32" ? [] : ["-lc", "docker exec -it ds_python bash -l || bash -il"];
    const p = nodePty.spawn(shell, args, { name: "xterm-color", cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
    p.onData((d) => { try { ws.send(d); } catch {} });
    p.onExit(() => { try { ws.close(); } catch {} });
    const iv = setInterval(() => { try { ws.ping(); } catch {} }, 30000);
    ws.on("message", (msg) => {
      let obj = null; try { obj = JSON.parse(String(msg)); } catch {}
      if (obj && obj.type === "input" && typeof obj.data === "string") { p.write(obj.data); return; }
      if (obj && obj.type === "resize" && obj.cols && obj.rows) { try { p.resize(Number(obj.cols), Number(obj.rows)); } catch {} return; }
      p.write(String(msg));
    });
    ws.on("close", () => { try { p.kill(); } catch {} try { clearInterval(iv); } catch {} });
  });
}
else if (WebSocketServer) {
  const wssHost = new WebSocketServer({ server, path: "/ws/terminal" });
  console.log("Web terminal: stdio fallback container/host at /ws/terminal");
  TERM_MODE = "stdio";
  wssHost.on("connection", (ws) => {
    const shell = process.platform === "win32" ? "powershell.exe" : "bash";
    const cmd = process.platform === "win32" ? shell : shell;
    const args = process.platform === "win32" ? [] : ["-lc", "docker exec -i ds_python bash -il || bash -il"];
    const ch = spawn(cmd, args, { cwd: process.cwd(), env: process.env });
    try { ws.send("\r\n[WebTerminal] Connected (non-pty mode).\r\n"); } catch {}
    ch.stdout.on("data", (d) => { try { ws.send(d.toString()); } catch {} });
    ch.stderr.on("data", (d) => { try { ws.send(d.toString()); } catch {} });
    ch.on("close", () => { try { ws.close(); } catch {} });
    const iv = setInterval(() => { try { ws.ping(); } catch {} }, 30000);
    ws.on("message", (msg) => {
      let obj = null; try { obj = JSON.parse(String(msg)); } catch {}
      const data = (obj && obj.type === "input") ? String(obj.data || "") : String(msg || "");
      try { ch.stdin.write(data); } catch {}
    });
    ws.on("close", () => { try { ch.kill("SIGTERM"); } catch {} try { clearInterval(iv); } catch {} });
  });
}
else {
  console.log("Web terminal: disabled (ws missing)");
}

app.get("/api/terminal/health", (_req, res) => {
  res.json({ ws: !!WebSocketServer, mode: TERM_MODE, endpoints: ["/ws/terminal", "/ws/terminal/container"] });
});

const DS_APP_IMAGE = process.env.DS_APP_IMAGE || DS_IMAGE;
function buildSampleCmd(sample, uris) {
  const base = "/opt/nvidia/deepstream/deepstream-6.0";
  const bins = {
    test1: `${base}/sources/apps/sample_apps/deepstream-test1/deepstream-test1-app`,
    test2: `${base}/sources/apps/sample_apps/deepstream-test2/deepstream-test2-app`,
    test3: `${base}/sources/apps/sample_apps/deepstream-test3/deepstream-test3-app`,
    test5: `${base}/sources/apps/sample_apps/deepstream-test5/deepstream-test5-app`,
    testsr: `${base}/sources/apps/sample_apps/deepstream-testsr/deepstream-testsr-app`,
  };
  const streams = {
    h264: `${base}/samples/streams/sample_720p.h264`,
    h265: `${base}/samples/streams/sample_720p.h265`,
  };
  if (sample === "app_source1") {
    return `cd ${base}/samples/configs/deepstream-app && (deepstream-app -c source1_1080p_dec_infer-resnet_int8.txt || deepstream-app -c source1_1080p_dec_infer-resnet.txt)`;
  }
  if (sample === "app_source30") {
    return `cd ${base}/samples/configs/deepstream-app && (deepstream-app -c source30_1080p_dec_infer-resnet_tiled_display_int8.txt || deepstream-app -c source30_1080p_dec_infer-resnet_tiled_display_fp16.txt)`;
  }
  if (sample === "app_custom_ini") {
    const ini = Array.isArray(uris) && uris.length ? uris[0] : "";
    if (ini.startsWith("/app/configs/")) {
      const dir = path.dirname(ini);
      const file = path.basename(ini);
      return `cd ${dir} && deepstream-app -c ${file}`;
    }
    return `deepstream-app -c ${ini}`;
  }
  const bin = bins[sample] || bins.test1;
  const args = Array.isArray(uris) && uris.length ? uris.map(u => u.startsWith("file://") ? u.replace(/^file:\/\//, "") : u) : [streams.h264];
  const dir = path.dirname(bin);
  const exe = path.basename(bin);
  return `cd ${dir} && ./${exe} ${args.join(" ")}`;
}

app.get("/api/dsapp/samples", (_req, res) => {
  res.json({ samples: [
    { id: "test1", label: "Test1 Single Source" },
    { id: "test2", label: "Test2 Multi Source" },
    { id: "test3", label: "Test3 SGIE" },
    { id: "test5", label: "Test5 Analytics" },
    { id: "testsr", label: "Smart Record" },
    { id: "app_source1", label: "deepstream-app Source1" },
    { id: "app_source30", label: "deepstream-app Source30 Tiled" },
    { id: "app_custom_ini", label: "deepstream-app Custom INI" }
  ]});
});

  app.post("/api/dspython/start", async (req, res) => {
    try {
      const forceParam = String(((req.query && req.query.force) || (req.body && req.body.force) || (req.headers && req.headers["x-allow-dev"]) || "")).trim();
      const allowOverride = forceParam === "1" || forceParam.toLowerCase() === "true";
      if (devBlocked() && !allowOverride) return res.status(403).json({ error: "blocked_on_dev" });
      const shouldInstall = !!(req.body && req.body.install);
      const useGit = !!(req.body && req.body.useGit);
      const image = (req.body && req.body.image) || DS_IMAGE;
      const parts = [];
      parts.push("DS_ROOT=$(ls -d /opt/nvidia/deepstream/deepstream-* | head -n 1)");
      parts.push("[ -f \"$DS_ROOT/setup-env.sh\" ] && source \"$DS_ROOT/setup-env.sh\" || true");
      if (shouldInstall) {
        parts.push("apt-get update");
        parts.push("DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip python3-gi gir1.2-gstreamer-1.0 libgirepository1.0-dev gstreamer1.0-plugins-base gstreamer1.0-tools libglib2.0-dev python3-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev build-essential pkg-config cmake libtool autoconf automake m4" + (useGit ? " git" : ""));
      }
      parts.push("python3 -c \"import gi; gi.require_version('Gst','1.0'); from gi.repository import Gst; import sys; print('GI_OK'); print(sys.version)\"");
      if (useGit) {
        parts.push("pip3 install --upgrade pip setuptools wheel || true");
        parts.push("pip3 install --no-cache-dir git+https://github.com/NVIDIA-AI-IOT/deepstream_python_apps.git#subdirectory=bindings || echo PYDS_INSTALL_FAILED");
        parts.push("mkdir -p $DS_ROOT/sources && cd $DS_ROOT/sources && (test -d deepstream_python_apps || git clone https://github.com/NVIDIA-AI-IOT/deepstream_python_apps.git)");
        parts.push("cd $DS_ROOT/sources/deepstream_python_apps && git submodule update --init || true");
        parts.push("mkdir -p $DS_ROOT/sources/deepstream_python_apps/bindings/build");
        parts.push("cd $DS_ROOT/sources/deepstream_python_apps/bindings/build && cmake .. -DPYTHON_MAJOR_VERSION=3 -DPYTHON_MINOR_VERSION=$(python3 -c 'import sys; print(sys.version_info.minor)') -DPIP_PLATFORM=linux_aarch64 -DDS_PATH=$DS_ROOT/ && make -j$(nproc) || echo PYDS_CMAKE_FAILED");
        parts.push("python3 -c \"import glob,subprocess,sys; import os; ws=glob.glob('$DS_ROOT/sources/deepstream_python_apps/bindings/build/pyds-*.whl'); print('WHEELS', ws); sys.exit(0 if (len(ws)>0 and subprocess.call(['pip3','install',ws[0]])==0) else 1)\" || echo PYDS_WHEEL_INSTALL_FAILED");
      } else {
        parts.push("if [ -d $DS_ROOT/sources/deepstream_python_apps ]; then cd $DS_ROOT/sources/deepstream_python_apps/bindings && pip3 install . || echo PYDS_INSTALL_FAILED; else echo DS_PY_SOURCES_MISSING; fi");
        parts.push("if [ -f $DS_ROOT/lib/setup.py ]; then cd $DS_ROOT/lib && python3 setup.py install || echo SETUPPY_FAILED; fi");
      }
      parts.push("pip3 install --no-cache-dir pyds_ext || echo PYDS_EXT_FAILED");
      parts.push("python3 -c \"import site, os; pkgs = site.getsitepackages();\npkg = (pkgs[0] if pkgs else site.getusersitepackages());\nf = os.path.join(pkg, 'pyds.py');\nopen(f, 'w').write('from pyds_ext import *\\n');\nprint('PYDS_SHIM', f)\"");
      parts.push("pip3 install --no-cache-dir cuda-python || echo CUDA_PY_FAILED");
      parts.push("python3 -c \"import cuda; import sys; print('CUDA_PY_OK', getattr(cuda,'__version__','?'))\"");
      parts.push("TRIES=15; OK=0; for i in $(seq 1 $TRIES); do python3 -c \"import sys; import pyds; print('PYDS_OK', getattr(pyds,'__file__','?'))\" && OK=1 && break || true; echo \"PYDS_RETRY $i\"; sleep 1; done; if [ \"$OK\" = \"0\" ]; then python3 -c \"import sys; print('PYDS_ERR','No module named pyds')\"; fi; echo DONE $OK");
    const cmd = parts.join(" && ") + " && tail -f /dev/null";
    const binds = [
      `${MEDIA_DIR}:${MEDIA_DIR}`,
      `${CONFIGS_DIR}:${CONFIGS_DIR}`,
      "/data/ds/configs:/data/ds/configs",
      "/data/weight_config:/data/weight_config",
      "/app/configs:/host_app_configs",
      "/data/hls:/app/public/video"
    ];
    const env = [
      `DISPLAY=${process.env.DISPLAY || ":0"}`,
      "CUDA_VER=10.2",
      "PLATFORM_TEGRA=1",
      "NVDS_PATH=/opt/nvidia/deepstream/deepstream-6.0",
      "GST_PLUGIN_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/gst-plugins:/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
      "GST_PLUGIN_SYSTEM_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/gst-plugins:/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
      "GI_TYPELIB_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/girepository-1.0",
      "LD_LIBRARY_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib:/usr/local/cuda-10.2/lib64:/usr/lib/aarch64-linux-gnu:/usr/lib/arm-linux-gnueabihf"
    ];
    await dockerRequest("DELETE", "/containers/ds_python?force=true");
    const body = { Image: image, Entrypoint: ["bash"], Cmd: ["-lc", cmd], Env: env, HostConfig: { NetworkMode: "host", Runtime: "nvidia", Binds: binds } };
    const created = await dockerRequest("POST", "/containers/create?name=ds_python", body);
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "create_failed", detail: created.body });
    const start = await dockerRequest("POST", "/containers/ds_python/start");
    if (!(start.statusCode >= 200 && start.statusCode < 300)) return res.status(500).json({ error: "start_failed", detail: start.body });
    res.json({ status: "started" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get("/api/dspython/logs", async (req, res) => {
  try {
    const tail = Math.max(100, Math.min(20000, Number((req.query && req.query.tail) || 1600) || 1600));
    const logs = await dockerRequest("GET", `/containers/ds_python/logs?stdout=1&stderr=1&tail=${tail}`);
    res.type("text/plain").send(logs.body || "");
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/dspython/stop", async (_req, res) => {
  try {
    await dockerRequest("POST", "/containers/ds_python/stop");
    await dockerRequest("DELETE", "/containers/ds_python?force=true");
    res.json({ status: "stopped" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/dspython/remove", async (_req, res) => {
  try {
    try { await dockerRequest("POST", "/containers/ds_python/stop"); } catch {}
    try { await dockerRequest("DELETE", "/containers/ds_python?force=true"); } catch {}
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/dspython/exec", async (req, res) => {
  try {
    const cmd = String((req.body && req.body.cmd) || "").trim();
    const waitMs = Math.max(0, Math.min(1800000, Number((req.body && req.body.wait_ms) || 0)));
    if (!cmd) return res.status(400).json({ error: "cmd required" });
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    try {
      const st = JSON.parse(info.body || "{}" ).State || null;
      if (!st || !st.Running) return res.status(400).json({ error: "ds_python not running" });
    } catch {}
    const createBody = { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", cmd] };
    const created = await dockerRequest("POST", "/containers/ds_python/exec", createBody);
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: created.body });
    let id = "";
    try { id = JSON.parse(created.body || "{}" ).Id || ""; } catch {}
    if (!id) return res.status(500).json({ error: "exec_id_missing", detail: created.body });
    const started = await dockerRequest("POST", `/exec/${id}/start`, { Detach: false, Tty: true });
    if (!(started.statusCode >= 200 && started.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: started.body });
    if (waitMs > 0) { await new Promise(r => setTimeout(r, waitMs)); }
  const encoded = Buffer.from(started.body || "", "binary").toString("base64");
  res.type("text/plain").send(encoded);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

const MCP_ALLOWED_ROOT = "/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/";
const HOST_DS_APPS_ROOT = "/data/ds/apps/deepstream_python_apps/apps/";
function _normalizeContainerPath(p) {
  try {
    const s = String(p || "").trim();
    if (!s || !s.startsWith(MCP_ALLOWED_ROOT)) return null;
    if (s.includes("..")) return null;
    return s;
  } catch { return null; }
}

app.put("/api/mcp/upload_raw", async (req, res) => {
  try {
    const qp = (req.query && req.query.path) || "";
    const p = _normalizeContainerPath(String(qp || ""));
    if (!p) return res.status(400).json({ error: "invalid path", allowed_root: MCP_ALLOWED_ROOT });
    const hostPath = p.replace(MCP_ALLOWED_ROOT, HOST_DS_APPS_ROOT);
    const dir = path.dirname(hostPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.upload_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const hasSha = typeof req.headers["x-sha256"] === "string" && String(req.headers["x-sha256"]).trim().length > 0;
    const shaExpect = hasSha ? String(req.headers["x-sha256"]).trim() : "";
    const modeHdr = String(req.headers["x-mode"] || "").trim();
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      req.on("data", (chunk) => { try { bytes += chunk.length; hash.update(chunk); } catch {} });
      req.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
      req.pipe(out);
    });
    await fs.promises.rename(tmp, hostPath).catch(async () => { try { await fs.promises.copyFile(tmp, hostPath); await fs.promises.unlink(tmp); } catch {} });
    if (modeHdr) { try { await fs.promises.chmod(hostPath, parseInt(modeHdr.replace(/[^0-7]/g, ""), 8)); } catch {} }
    if (hasSha) {
      const digest = hash.digest("hex");
      if (digest.toLowerCase() !== shaExpect.toLowerCase()) return res.status(400).json({ status: "error", error: "sha256 mismatch", expected: shaExpect, got: digest, bytes });
    } else { hash.digest(); }
    res.json({ status: "ok", artifact_path: p, bytes });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/mcp/upload_file", async (req, res) => {
  try {
    const p = _normalizeContainerPath((req.body && req.body.path) || "");
    let content = (req.body && req.body.content);
    const sha256 = String((req.body && req.body.sha256) || "").trim();
    const mode = String((req.body && req.body.mode) || "").trim();
    if (!p) return res.status(400).json({ error: "invalid path", allowed_root: MCP_ALLOWED_ROOT });
    if (content === undefined || content === null) return res.status(400).json({ error: "content required" });
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    let running = false; try { const st = JSON.parse(info.body || "{}").State || null; running = !!(st && st.Running); } catch {}
    if (!running) return res.status(400).json({ error: "ds_python not running" });
    const enc = Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(String(content), "utf8").toString("base64");
    const ps = p.replace(/'/g, "'\"'\"'");
    const shaExpr = sha256 ? `\nimport hashlib\nassert hashlib.sha256(d).hexdigest()==\'${sha256.replace(/'/g,"'\"'\"'")}\', 'sha256 mismatch'\n` : "\n";
    const chmodExpr = mode ? `\nos.chmod(p, int('${mode.replace(/[^0-7]/g,'')}', 8))\n` : "\n";
    const py = `python3 - <<'PY'\nimport base64, os, tempfile\np='${ps}'\nd=base64.b64decode('${enc}')\n${shaExpr}dir=os.path.dirname(p) or '.'\nos.makedirs(dir, exist_ok=True)\nfd,tmp=tempfile.mkstemp(prefix='.upload_', dir=dir)\nos.write(fd,d); os.close(fd)\nos.replace(tmp,p)\n${chmodExpr}print('OK', len(d))\nPY`;
    const createBody = { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", py] };
    const created = await dockerRequest("POST", "/containers/ds_python/exec", createBody);
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: created.body });
    let id = ""; try { id = JSON.parse(created.body || "{}").Id || ""; } catch {}
    if (!id) return res.status(500).json({ error: "exec_id_missing", detail: created.body });
    const started = await dockerRequest("POST", `/exec/${id}/start`, { Detach: false, Tty: true });
    if (!(started.statusCode >= 200 && started.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: started.body });
    const out = Buffer.from(started.body || "", "binary").toString();
    const ok = /\bOK\b/.test(out);
    if (!ok) return res.status(500).json({ error: "write_failed", output: out });
    res.json({ status: "ok", artifact_path: p, bytes: Buffer.from(String(content), "utf8").length });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.get("/api/mcp/tail_logs", async (req, res) => {
  try {
    const tail = Math.max(1, Math.min(Number((req.query && req.query.tail) || 600), 5000));
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    let running = false; try { const st = JSON.parse(info.body || "{}").State || null; running = !!(st && st.Running); } catch {}
    if (!running) return res.status(400).json({ error: "ds_python not running" });
    const cmd = "p=/app/configs/ds_py_rtsp_out.txt; q=/data/ds/configs/ds_py_rtsp_out.txt; if [ -f \"$p\" ]; then tail -n " + String(tail) + " \"$p\"; elif [ -f \"$q\" ]; then tail -n " + String(tail) + " \"$q\"; else echo NO_LOG; fi";
    const created = await dockerRequest("POST", "/containers/ds_python/exec", { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", cmd] });
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: created.body });
    let id = ""; try { id = JSON.parse(created.body || "{}").Id || ""; } catch {}
    if (!id) return res.status(500).json({ error: "exec_id_missing", detail: created.body });
    const started = await dockerRequest("POST", `/exec/${id}/start`, { Detach: false, Tty: true });
    if (!(started.statusCode >= 200 && started.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: started.body });
    let text = Buffer.from(started.body || "", "binary").toString();
    if (!text || /NO_LOG/.test(text) || !text.trim().length) {
      const logs = await dockerRequest("GET", `/containers/ds_python/logs?stdout=1&stderr=1&tail=${tail}`);
      const fallback = logs.body || "";
      text = fallback || text;
    }
    res.type("text/plain").send(text || "");
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/mcp/validate_python", async (req, res) => {
  try {
    const p = _normalizeContainerPath((req.body && req.body.path) || "");
    if (!p) return res.status(400).json({ error: "invalid path", allowed_root: MCP_ALLOWED_ROOT });
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    let running = false; try { const st = JSON.parse(info.body || "{}").State || null; running = !!(st && st.Running); } catch {}
    if (!running) return res.status(400).json({ error: "ds_python not running" });
    const ps = p.replace(/'/g, "'\"'\"'");
    const cmd = `python3 -m py_compile '${ps}' && echo OK || echo ERR`;
    const created = await dockerRequest("POST", "/containers/ds_python/exec", { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", cmd] });
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: created.body });
    let id = ""; try { id = JSON.parse(created.body || "{}").Id || ""; } catch {}
    if (!id) return res.status(500).json({ error: "exec_id_missing", detail: created.body });
    const started = await dockerRequest("POST", `/exec/${id}/start`, { Detach: false, Tty: true });
    if (!(started.statusCode >= 200 && started.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: started.body });
    const out = Buffer.from(started.body || "", "binary").toString();
    if (/\bOK\b/.test(out)) return res.json({ status: "ok" });
    return res.status(400).json({ status: "error", output: out });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/mcp/test_python", async (req, res) => {
  try {
    const p = _normalizeContainerPath((req.body && req.body.path) || "");
    let content = (req.body && req.body.content);
    const sha256 = String((req.body && req.body.sha256) || "").trim();
    const validate = !!(req.body && req.body.validate !== false);
    const input = String((req.body && req.body.input) || "/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264");
    const codec = String((req.body && req.body.codec) || "H264");
    if (!p) return res.status(400).json({ error: "invalid path", allowed_root: MCP_ALLOWED_ROOT });
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    let running = false; try { const st = JSON.parse(info.body || "{}").State || null; running = !!(st && st.Running); } catch {}
    if (!running) return res.status(400).json({ error: "ds_python not running" });
    let bytes = 0;
    if (content !== undefined && content !== null) {
      const enc = Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(String(content), "utf8").toString("base64");
      const ps = p.replace(/'/g, "'\"'\"'");
      const shaExpr = sha256 ? `\nimport hashlib\nassert hashlib.sha256(d).hexdigest()==\'${sha256.replace(/'/g,"'\"'\"'")}\', 'sha256 mismatch'\n` : "\n";
      const py = `python3 - <<'PY'\nimport base64, os, tempfile\np='${ps}'\nd=base64.b64decode('${enc}')\n${shaExpr}dir=os.path.dirname(p) or '.'\nos.makedirs(dir, exist_ok=True)\nfd,tmp=tempfile.mkstemp(prefix='.upload_', dir=dir)\nos.write(fd,d); os.close(fd)\nos.replace(tmp,p)\nprint('OK', len(d))\nPY`;
      const created = await dockerRequest("POST", "/containers/ds_python/exec", { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", py] });
      if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: created.body });
      let id = ""; try { id = JSON.parse(created.body || "{}").Id || ""; } catch {}
      if (!id) return res.status(500).json({ error: "exec_id_missing", detail: created.body });
      const started = await dockerRequest("POST", `/exec/${id}/start`, { Detach: false, Tty: true });
      if (!(started.statusCode >= 200 && started.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: started.body });
      const out = Buffer.from(started.body || "", "binary").toString();
      const m = out.match(/OK\s+(\d+)/); if (m) { bytes = Number(m[1]||0) };
    }
    if (validate) {
      const ps = p.replace(/'/g, "'\"'\"'");
      const vcmd = `python3 -m py_compile '${ps}' && echo OK || echo ERR`;
      const vcreated = await dockerRequest("POST", "/containers/ds_python/exec", { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", vcmd] });
      if (!(vcreated.statusCode >= 200 && vcreated.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: vcreated.body });
      let vid = ""; try { vid = JSON.parse(vcreated.body || "{}").Id || ""; } catch {}
      if (!vid) return res.status(500).json({ error: "exec_id_missing", detail: vcreated.body });
      const vstarted = await dockerRequest("POST", `/exec/${vid}/start`, { Detach: false, Tty: true });
      if (!(vstarted.statusCode >= 200 && vstarted.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: vstarted.body });
      const vout = Buffer.from(vstarted.body || "", "binary").toString();
      if (!/\bOK\b/.test(vout)) return res.status(400).json({ status: "error", output: vout });
    }
    const dir = p.replace(/\/[^/]+$/, "");
    const base = p.split("/").pop();
    let args = "";
    if (/deepstream_test1_rtsp_out\.py$/.test(base)) args = ` -i ${input} -c ${codec}`;
    else if (/deepstream_test_2\.py$/.test(base)) args = ` ${input}`;
    const cmd = [
      `cd '${dir.replace(/'/g,"'\"'\"'")}'`,
      `pkill -f '${base.replace(/'/g,"'\"'\"'")}' || true`,
      "mkdir -p /data/ds/configs",
      ": > /data/ds/configs/ds_py_rtsp_out.txt",
      `nohup env PYTHONUNBUFFERED=1 python3 '${base.replace(/'/g,"'\"'\"'")}'${args} 2>&1 | tee -a /data/ds/configs/ds_py_rtsp_out.txt & echo STARTED=$!`
    ].join(" && ");
    const created = await dockerRequest("POST", "/containers/ds_python/exec", { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", cmd] });
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: created.body });
    let id = ""; try { id = JSON.parse(created.body || "{}").Id || ""; } catch {}
    if (!id) return res.status(500).json({ error: "exec_id_missing", detail: created.body });
    const started = await dockerRequest("POST", `/exec/${id}/start`, { Detach: false, Tty: true });
    if (!(started.statusCode >= 200 && started.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: started.body });
    const host = "127.0.0.1";
    const rtsp = `rtsp://${host}:8554/ds-test`;
    res.json({ status: "ok", artifact_path: p, bytes, rtsp });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/mcp/stop_python", async (req, res) => {
  try {
    const p = _normalizeContainerPath((req.body && req.body.path) || "");
    if (!p) return res.status(400).json({ error: "invalid path", allowed_root: MCP_ALLOWED_ROOT });
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    let running = false; try { const st = JSON.parse(info.body || "{}").State || null; running = !!(st && st.Running); } catch {}
    if (!running) return res.status(400).json({ error: "ds_python not running" });
    const base = p.split("/").pop();
    const cmd = `pkill -f '${base.replace(/'/g,"'\"'\"'")}' || true && echo STOPPED`;
    const created = await dockerRequest("POST", "/containers/ds_python/exec", { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", cmd] });
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: created.body });
    let id = ""; try { id = JSON.parse(created.body || "{}").Id || ""; } catch {}
    if (!id) return res.status(500).json({ error: "exec_id_missing", detail: created.body });
    const started = await dockerRequest("POST", `/exec/${id}/start`, { Detach: false, Tty: true });
    if (!(started.statusCode >= 200 && started.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: started.body });
    const out = Buffer.from(started.body || "", "binary").toString();
    res.json({ status: /STOPPED/.test(out) ? "ok" : "unknown", output: out });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/dspython/start_example", async (req, res) => {
  try {
    const image = (req.body && req.body.image) || DS_APP_IMAGE;
    const binds = [
      `${MEDIA_DIR}:${MEDIA_DIR}`,
      `${CONFIGS_DIR}:${CONFIGS_DIR}`,
      "/data/ds/configs:/data/ds/configs",
      "/data/weight_config:/data/weight_config",
      "/app/configs:/host_app_configs",
      "/data/hls:/app/public/video",
      "/data/ds/apps/deepstream_python_apps:/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps",
      "/data/ds/apps/pyds_ext:/workspace/pyds_ext"
    ];
    const env = [
      `DISPLAY=${process.env.DISPLAY || ":0"}`,
      "CUDA_VER=10.2",
      "PLATFORM_TEGRA=1",
      "NVDS_PATH=/opt/nvidia/deepstream/deepstream-6.0",
      "GST_PLUGIN_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/gst-plugins:/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
      "GST_PLUGIN_SYSTEM_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/gst-plugins:/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
      "GI_TYPELIB_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/girepository-1.0",
      "LD_LIBRARY_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib:/usr/local/cuda-10.2/lib64:/usr/lib/aarch64-linux-gnu:/usr/lib/arm-linux-gnueabihf",
      "PYTHONPATH=/workspace",
      "PYTHONUNBUFFERED=1"
    ];
    const cmd = [
      "(test -L /workspace/pyds || rm -rf /workspace/pyds) && ln -s /workspace/pyds_ext /workspace/pyds || true",
      "python3 -c \"import site,os; pkgs=site.getsitepackages() or [site.getusersitepackages()]; f=os.path.join(pkgs[0],'pyds.py'); open(f,'w').write('from pyds_ext import *\\n'); print('PYDS_SHIM', f)\"",
      "echo READY",
      "sleep infinity"
    ].join(" && ");
    await dockerRequest("DELETE", "/containers/ds_python?force=true");
    const body = { Image: image, Entrypoint: ["bash"], Cmd: ["-lc", cmd], Env: env, HostConfig: { NetworkMode: "host", Runtime: "nvidia", Binds: binds } };
    const created = await dockerRequest("POST", "/containers/create?name=ds_python", body);
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "create_failed", detail: created.body });
    const start = await dockerRequest("POST", "/containers/ds_python/start");
    if (!(start.statusCode >= 200 && start.statusCode < 300)) return res.status(500).json({ error: "start_failed", detail: start.body });
    res.json({ status: "started" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/dspython/run_example", async (req, res) => {
  try {
    const input = String((req.body && req.body.input) || "/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264");
    const codec = String((req.body && req.body.codec) || "H264");
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    let running = false;
    try { const st = JSON.parse(info.body || "{}").State || null; running = !!(st && st.Running); } catch {}
    if (!running) return res.status(400).json({ error: "ds_python not running" });
    const cmd = [
      "DS_ROOT=$(ls -d /opt/nvidia/deepstream/deepstream-* | head -n 1)",
      "cd $DS_ROOT/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out",
      "pkill -f deepstream_test1_rtsp_out_1.py || true",
      "mkdir -p /data/ds/configs",
      ": > /data/ds/configs/ds_py_rtsp_out.txt",
      `nohup env PYTHONUNBUFFERED=1 python3 deepstream_test1_rtsp_out_1.py -i ${input} -c ${codec} 2>&1 | tee -a /data/ds/configs/ds_py_rtsp_out.txt & echo STARTED=$!`
    ].join(" && ");
    const createBody = { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ["bash","-lc", cmd] };
    const created = await dockerRequest("POST", "/containers/ds_python/exec", createBody);
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "exec_create_failed", detail: created.body });
    let id = ""; try { id = JSON.parse(created.body || "{}").Id || ""; } catch {}
    if (!id) return res.status(500).json({ error: "exec_id_missing", detail: created.body });
    const started = await dockerRequest("POST", `/exec/${id}/start`, { Detach: false, Tty: true });
    if (!(started.statusCode >= 200 && started.statusCode < 300)) return res.status(500).json({ error: "exec_start_failed", detail: started.body });
    try {
      await axios.post(`http://127.0.0.1:${PORT}/api/hls/start`, { uri: "udp://127.0.0.1:5600", hls_time: Number((req.body && req.body.hls_time) || 2), hls_list_size: Number((req.body && req.body.hls_list_size) || 5), image: (req.body && req.body.image) || undefined });
    } catch {}
    const udp = "udp://127.0.0.1:5600";
    const hls = "/video/out.m3u8";
    res.json({ status: "ok", udp, hls });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/dspython/commit", async (req, res) => {
  try {
    const repo = String((req.body && req.body.repo) || "").trim();
    const tag = String((req.body && req.body.tag) || "latest").trim();
    if (!repo) return res.status(400).json({ error: "repo required" });
    const info = await dockerRequest("GET", "/containers/ds_python/json");
    let st = null;
    try { st = JSON.parse(info.body || "{}" ).State || null; } catch {}
    if (!st || !st.Running) return res.status(400).json({ error: "ds_python not running" });
    const r = await dockerRequest("POST", `/commit?container=ds_python&repo=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`);
    if (r.statusCode >= 200 && r.statusCode < 300) return res.type("application/json").send(r.body || "{}");
    return res.status(500).json({ error: "commit_failed", detail: r.body, status: r.statusCode });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/docker/save", async (req, res) => {
  try {
    const name = String((req.body && req.body.name) || "").trim();
    let outPath = String((req.body && req.body.path) || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    if (!outPath) outPath = path.join("/data/ds/configs", `${name.replace(/[:/]/g, "_")}.tar`);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    const reqPath = `/images/${encodeURIComponent(name)}/get`;
    let opts = { method: "GET", headers: {} };
    let requester = http;
    if (DOCKER_HOST_HTTP) {
      try {
        const u = new URL(DOCKER_HOST_HTTP);
        requester = u.protocol === "https:" ? https : http;
        opts = { protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: reqPath, method: "GET", headers: {} };
      } catch {}
    } else {
      opts = { socketPath: "/var/run/docker.sock", path: reqPath, method: "GET", headers: {} };
    }
    const file = fs.createWriteStream(outPath);
    const req2 = requester.request(opts, (resp) => {
      if (!(resp.statusCode >= 200 && resp.statusCode < 300)) {
        let errText = "";
        resp.on("data", (c) => { errText += c; });
        resp.on("end", () => { try { file.close(); } catch {} res.status(500).json({ error: "save_failed", detail: errText, status: resp.statusCode }); });
        return;
      }
      resp.pipe(file);
      file.on("finish", () => { try { file.close(); } catch {} res.json({ ok: true, path: outPath }); });
      file.on("error", (fe) => { try { file.close(); } catch {} res.status(500).json({ error: String(fe && fe.message || fe) }); });
    });
    req2.on("error", (e) => { try { file.close(); } catch {} res.status(500).json({ error: String(e && e.message || e) }); });
    req2.end();
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.post("/api/dsapp/start", async (req, res) => {
  const sample = (req.body && req.body.sample) || "test1";
  const uris = (req.body && req.body.uris) || [];
  const image = (req.body && req.body.image) || DS_APP_IMAGE;
  const autoEngine = !!(req.body && req.body.autoEngine);
  try {
    if (sample === "app_custom_ini") {
      const ini = Array.isArray(uris) && uris.length ? uris[0] : "";
      if (ini && ini.startsWith("/app/configs/")) {
        const hostIni = ini.replace("/app/configs/", "/data/ds/configs/");
        try {
          const txt = await fs.promises.readFile(hostIni, "utf8");
          try {
            const lines0 = txt.split(/\r?\n/);
            let patched0 = [];
            let inSink0 = false;
            let modified0 = false;
            for (const l0 of lines0) {
              const s0 = l0.trim();
              if (s0.startsWith("[") && s0.endsWith("]")) {
                inSink0 = /\[\s*sink\d+\s*\]/i.test(s0);
                patched0.push(l0);
                continue;
              }
              if (inSink0 && /^\s*rtsp-path\s*=\s*/i.test(s0)) { modified0 = true; continue; }
              patched0.push(l0);
            }
            if (modified0) { await fs.promises.writeFile(hostIni, patched0.join("\n"), "utf8"); }
          } catch {}
          let inSrc = false; let uriVal = "";
          let inPg = false; let cfgVal = "";
          const lines = txt.split(/\r?\n/);
          for (const l of lines) {
            const s = l.trim();
            if (s.startsWith("[") && s.endsWith("]")) { inSrc = /\[\s*source0\s*\]/i.test(s); continue; }
            if (inSrc && /^\s*uri\s*=\s*/i.test(s)) { uriVal = s.split("=").slice(1).join("=").trim(); break; }
          }
          if (uriVal && /^file:\/\/\/app\/public\/video\//i.test(uriVal)) {
            const fname = uriVal.replace(/^file:\/\/\/app\/public\/video\//i, "");
            const hostPath = path.join("/data/hls", fname);
            try { await fs.promises.access(hostPath, fs.constants.R_OK); }
            catch { return res.status(400).json({ ok: false, error: "playlist-missing", path: hostPath }); }
          }
          for (const l of lines) {
            const s = l.trim();
            if (s.startsWith("[") && s.endsWith("]")) { inPg = /\[\s*primary-gie\s*\]/i.test(s); continue; }
            if (inPg && /^\s*config-file\s*=\s*/i.test(s)) { cfgVal = s.split("=").slice(1).join("=").trim(); break; }
          }
          if (cfgVal && /^\/app\/configs\//.test(cfgVal)) {
            const hostCfg = cfgVal.replace("/app/configs/", "/data/ds/configs/");
            try { await fs.promises.access(hostCfg, fs.constants.R_OK); }
            catch { return res.status(400).json({ ok: false, error: "pgie-missing", path: hostCfg }); }
          }
        } catch {}
      }
    }
  } catch {}
  if (sample === "app_custom_ini" && autoEngine) {
    try {
      const ini = Array.isArray(uris) && uris.length ? uris[0] : "";
      if (ini && ini.startsWith("/app/configs/")) {
        const hostIni = ini.replace("/app/configs/", "/data/ds/configs/");
        const txt = await fs.promises.readFile(hostIni, "utf8");
        let primaryCfgPath = "";
        const lines = txt.split(/\r?\n/);
        let inPrimary = false;
        for (const l of lines) {
          const s = l.trim();
          if (s.startsWith("[") && s.endsWith("]")) { inPrimary = s.toLowerCase() === "[primary-gie]"; continue; }
          if (inPrimary && s.toLowerCase().startsWith("config-file=")) { primaryCfgPath = s.split("=").slice(1).join("=").trim(); break; }
        }
        if (primaryCfgPath) {
          const resolved = primaryCfgPath.startsWith("/") ? primaryCfgPath.replace("/app/configs/", "/data/ds/configs/") : path.join(path.dirname(hostIni), primaryCfgPath);
          try {
            let cfg = await fs.promises.readFile(resolved, "utf8");
            const hasEngine = /\n\s*model-engine-file\s*=\s*/i.test("\n"+cfg);
            cfg = cfg.split(/\r?\n/).filter(line => !/^\s*model-engine-file\s*=/i.test(line)).join("\n");
            if (!/\n\s*network-mode\s*=\s*/i.test("\n"+cfg)) { cfg += "\nnetwork-mode=1\n"; }
            let changed = false;
            try {
              const isYolo = /\n\s*parse-bbox-func-name\s*=\s*NvDsInferParseCustomYolo/i.test("\n"+cfg) || /\n\s*parse-bbox-func-name\s*=\s*NvDsInferParseCustomYoloV\d+/i.test("\n"+cfg);
              if (isYolo) {
                const ycfg = "/data/videos/v3/v3/yolov3.cfg";
                const ywts = "/data/videos/v3/v3/yolov3.weights";
                const hasCfg = (() => { try { fs.accessSync(ycfg, fs.constants.R_OK); return true; } catch { return false; } })();
                const hasWts = (() => { try { fs.accessSync(ywts, fs.constants.R_OK); return true; } catch { return false; } })();
                const lines = cfg.split(/\r?\n/);
                function upsert(key, value) {
                  let found = false;
                  const re = new RegExp("^\\s*" + key.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "\\s*=\\s*", "i");
                  for (let i = 0; i < lines.length; i++) {
                    if (re.test(lines[i])) { lines[i] = key + "=" + value; found = true; break; }
                  }
                  if (!found) { lines.push(key + "=" + value); }
                  changed = true;
                }
                if (hasCfg && hasWts) {
                  upsert("model-file", ycfg);
                  upsert("model-weights", ywts);
                }
                if (!/\n\s*batch-size\s*=\s*/i.test("\n"+cfg)) { lines.push("batch-size=1"); changed = true; }
                if (!/\n\s*custom-lib-path\s*=\s*/i.test("\n"+cfg)) {
                  lines.push("custom-lib-path=/host_app_configs/yolo_custom/libnvdsinfer_custom_impl_Yolo.so");
                  changed = true;
                }
                cfg = lines.join("\n");
              }
            } catch {}
            if (hasEngine || changed) { await fs.promises.writeFile(resolved, cfg, "utf8"); }
          } catch {}
        }
      }
    } catch {}
  }
  const cmd = buildSampleCmd(sample, uris);
  await dockerRequest("DELETE", "/containers/ds_app?force=true");
  const binds = [
    "/tmp/.X11-unix:/tmp/.X11-unix",
    "/data/ds/configs:/app/configs",
    "/data/ds/configs:/data/ds/configs",
    "/data/weight_config:/data/weight_config",
    "/app/configs:/host_app_configs",
    "/data/hls:/app/public/video",
    "/data/videos:/data/videos"
  ];
  try {
    const libDir = "/opt/nvidia/deepstream/deepstream-6.0/sources/libs/nvdsinfer_custom_impl";
    const libPath = path.join(libDir, "libnvdsinfer_custom_impl.so");
    if (fs.existsSync(libPath)) {
      binds.push(`${libDir}:${libDir}`);
    }
  } catch {}
  const env = [
    `DISPLAY=${process.env.DISPLAY || ":0"}`,
    "CUDA_VER=10.2",
    "PLATFORM_TEGRA=1",
    "LD_LIBRARY_PATH=/usr/local/cuda-10.2/lib64:/usr/lib/aarch64-linux-gnu:/usr/lib/arm-linux-gnueabihf"
  ];
  const body = { Image: image, Entrypoint: ["bash"], Cmd: ["-lc", cmd], Env: env, HostConfig: { NetworkMode: "host", Runtime: "nvidia", Binds: binds } };
  let created = await dockerRequest("POST", "/containers/create?name=ds_app", body);
  if (!(created.statusCode >= 200 && created.statusCode < 300)) {
    await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(image)}`);
    await dockerRequest("DELETE", "/containers/ds_app?force=true");
    created = await dockerRequest("POST", "/containers/create?name=ds_app", body);
  }
  if (!(created.statusCode >= 200 && created.statusCode < 300)) {
    return res.status(500).json({ ok: false, cmd, image, error: created.body || "create_failed" });
  }
  const start = await dockerRequest("POST", "/containers/ds_app/start");
  if (!(start.statusCode >= 200 && start.statusCode < 300)) {
    let stateError = null;
    let logsTail = "";
    let matchedErrors = [];
    try {
      const info = await dockerRequest("GET", "/containers/ds_app/json");
      const obj = JSON.parse(info.body);
      stateError = (obj && obj.State && obj.State.Error) || null;
    } catch {}
    try {
      const logs = await dockerRequest("GET", "/containers/ds_app/logs?stdout=1&stderr=1&tail=600");
      logsTail = logs.body || "";
      try {
        const lines = logsTail.split(/\r?\n/);
        const patterns = [/NVDSINFER_CUSTOM_LIB_FAILED/i, /NvDsInfer/i, /nvinfer/i, /custom lib/i, /error/i, /failed/i, /No such file/i, /cannot open/i];
        matchedErrors = lines.filter(l => patterns.some(p => p.test(l)));
        matchedErrors = matchedErrors.slice(-100);
      } catch {}
    } catch {}
    return res.status(500).json({ ok: false, cmd, image, error: start.body || "start_failed", stateError, logsTail, matchedErrors });
  }
  res.json({ ok: true, cmd, image });
});

app.post("/api/dsapp/stop", async (_req, res) => {
  await dockerRequest("POST", "/containers/ds_app/stop");
  await dockerRequest("DELETE", "/containers/ds_app?force=true");
  res.json({ ok: true });
});

app.get("/api/dsapp/logs", async (_req, res) => {
  const logs = await dockerRequest("GET", "/containers/ds_app/logs?stdout=1&stderr=1&tail=200");
  res.type("text/plain").send(logs.body || "");
});

app.get("/api/dsapp/logs/search", async (req, res) => {
  try {
    const tail = Math.max(1, Math.min(Number(req.query.tail || 600), 5000));
    const logs = await dockerRequest("GET", `/containers/ds_app/logs?stdout=1&stderr=1&tail=${tail}`);
    const text = logs.body || "";
    const q = String(req.query.q || "");
    const defaultKeywords = "NvDsInfer|nvinfer|ERROR|PLAYING|pipeline";
    const kw = String(req.query.keywords || defaultKeywords);
    let out = text;
    if (q) {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(esc, "i");
      out = text.split(/\r?\n/).filter(l => re.test(l)).join("\n");
    } else if (kw) {
      const re = new RegExp(kw, "i");
      out = text.split(/\r?\n/).filter(l => re.test(l)).join("\n");
    }
    res.type("text/plain").send(out);
  } catch (e) {
    res.status(500).type("text/plain").send(String(e.message || e));
  }
});

app.get("/api/configs/read", async (req, res) => {
  try {
    const p = String(req.query.path || "");
    if (!p || !p.startsWith("/app/configs/") || p.includes("..")) return res.status(400).json({ error: "invalid path" });
    const t = await fs.promises.readFile(p, "utf8");
    res.json({ path: p, content: t });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/configs/save", async (req, res) => {
  try {
    const p = String((req.body && req.body.path) || "");
    const c = String((req.body && req.body.content) || "");
    if (!p || !p.startsWith("/app/configs/") || p.includes("..")) return res.status(400).json({ error: "invalid path" });
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, c, "utf8");
    res.json({ ok: true, path: p, bytes: Buffer.byteLength(c) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/configs/list", async (req, res) => {
  try {
    function pickExistingDir(pref) {
      const candidates = [pref, "/app/configs/", "/data/ds/configs/"];
      for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
      return pref;
    }
    const base = pickExistingDir(CONFIGS_DIR);
    let dirParam = String(req.query.dir || base);
    const extParam = String(req.query.ext || "ini").toLowerCase().replace(/[^a-z0-9]/g, "");
    const allowedExts = new Set(["ini", "txt", "cfg"]);
    const ext = allowedExts.has(extParam) ? extParam : "ini";
    if (!dirParam.startsWith(base) || dirParam.includes("..")) dirParam = base;
    const out = [];
    async function walk(p, depth) {
      const ents = await fs.promises.readdir(p, { withFileTypes: true });
      for (const e of ents) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) { if (depth < 4) { await walk(full, depth + 1); } }
        else { const f = full.toLowerCase(); if (f.endsWith("." + ext)) out.push(full); }
      }
    }
    await walk(dirParam, 0);
    out.sort();
    res.json({ dir: dirParam, files: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// MediaMTX config helpers
app.get("/api/mediamtx/read", async (_req, res) => {
  try {
    const p = "/data/mediamtx.yml";
    const t = await fs.promises.readFile(p, "utf8");
    res.type("text/plain").send(t);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post("/api/mediamtx/save", async (req, res) => {
  try {
    const c = String((req.body && req.body.content) || "");
    if (!c) return res.status(400).json({ error: "content required" });
    const p = "/data/mediamtx.yml";
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, c, "utf8");
    try { await fs.promises.chmod(p, 0o644); } catch {}
    res.json({ ok: true, path: p, bytes: Buffer.byteLength(c) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/mediamtx/save_host", async (req, res) => {
  try {
    const c = String((req.body && req.body.content) || "");
    if (!c) return res.status(400).json({ error: "content required" });
    const p = "/data/mediamtx.yml";
    const tmp = "/data/ds/configs/mediamtx.yml";
    await fs.promises.mkdir(path.dirname(tmp), { recursive: true });
    await fs.promises.writeFile(tmp, c, "utf8");
    await dockerRequest("DELETE", "/containers/mediamtx_write?force=true");
    const body = { Image: DS_IMAGE, Entrypoint: ["bash"], Cmd: ["-lc", `cp -f ${tmp} ${p} && chmod 644 ${p} && echo OK`], HostConfig: { NetworkMode: "host", Binds: ["/data:/data"] } };
    let created = await dockerRequest("POST", "/containers/create?name=mediamtx_write", body);
    if (!(created.statusCode >= 200 && created.statusCode < 300)) {
      await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(DS_IMAGE)}`);
      await dockerRequest("DELETE", "/containers/mediamtx_write?force=true");
      created = await dockerRequest("POST", "/containers/create?name=mediamtx_write", body);
    }
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "create_failed", detail: created.body });
    const start = await dockerRequest("POST", "/containers/mediamtx_write/start");
    if (!(start.statusCode >= 200 && start.statusCode < 300)) return res.status(500).json({ error: "start_failed", detail: start.body });
    const logs = await dockerRequest("GET", "/containers/mediamtx_write/logs?stdout=1&stderr=1&tail=200");
    await dockerRequest("POST", "/containers/mediamtx_write/stop");
    await dockerRequest("DELETE", "/containers/mediamtx_write?force=true");
    res.json({ ok: true, path: p, bytes: Buffer.byteLength(c), logs: logs.body || "" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/mediamtx/read_host", async (_req, res) => {
  try {
    await dockerRequest("DELETE", "/containers/mediamtx_read?force=true");
    const body = { Image: DS_IMAGE, Entrypoint: ["bash"], Cmd: ["-lc", "cat /data/mediamtx.yml"], HostConfig: { NetworkMode: "host", Binds: ["/data:/data"] } };
    let created = await dockerRequest("POST", "/containers/create?name=mediamtx_read", body);
    if (!(created.statusCode >= 200 && created.statusCode < 300)) {
      await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(DS_IMAGE)}`);
      await dockerRequest("DELETE", "/containers/mediamtx_read?force=true");
      created = await dockerRequest("POST", "/containers/create?name=mediamtx_read", body);
    }
    if (!(created.statusCode >= 200 && created.statusCode < 300)) return res.status(500).json({ error: "create_failed", detail: created.body });
    const start = await dockerRequest("POST", "/containers/mediamtx_read/start");
    if (!(start.statusCode >= 200 && start.statusCode < 300)) return res.status(500).json({ error: "start_failed", detail: start.body });
    const logs = await dockerRequest("GET", "/containers/mediamtx_read/logs?stdout=1&stderr=1&tail=200");
    await dockerRequest("POST", "/containers/mediamtx_read/stop");
    await dockerRequest("DELETE", "/containers/mediamtx_read?force=true");
    res.type("text/plain").send(logs.body || "");
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/openapi.json", async (_req, res) => {
  try {
    const p = path.join(__dirname, "openapi.json");
    if (!fs.existsSync(p)) return res.status(404).json({ error: "spec_not_found" });
    res.type("application/json").send(fs.readFileSync(p, "utf8"));
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

const mcpServer = new McpServer({ name: "CiRA SPACE", version: "0.2.0" });

mcpServer.registerTool(
  "upload_file",
  {
    title: "Upload file",
    description: "Atomic write to container under allowed root",
    inputSchema: { path: z.string(), content: z.string(), sha256: z.string().optional(), mode: z.string().optional() },
    outputSchema: { status: z.string().optional(), artifact_path: z.string().optional(), bytes: z.number().optional() }
  },
  async ({ path, content, sha256, mode }) => {
    const r = await axios.post(`http://127.0.0.1:${PORT}/api/mcp/upload_file`, { path, content, sha256, mode });
    const data = r.data;
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

mcpServer.registerTool(
  "validate_python",
  {
    title: "Validate Python",
    description: "py_compile a path in the container",
    inputSchema: { path: z.string() },
    outputSchema: { status: z.string().optional(), output: z.string().optional() }
  },
  async ({ path }) => {
    const r = await axios.post(`http://127.0.0.1:${PORT}/api/mcp/validate_python`, { path });
    const data = r.data;
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

mcpServer.registerTool(
  "test_python",
  {
    title: "Test Python",
    description: "Upload (optional), validate and run DeepStream app; return RTSP",
    inputSchema: { path: z.string(), content: z.string().optional(), sha256: z.string().optional(), validate: z.boolean().optional(), input: z.string().optional(), codec: z.string().optional() },
    outputSchema: { status: z.string().optional(), artifact_path: z.string().optional(), bytes: z.number().optional(), rtsp: z.string().optional() }
  },
  async (args) => {
    const r = await axios.post(`http://127.0.0.1:${PORT}/api/mcp/test_python`, args);
    const data = r.data;
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

mcpServer.registerTool(
  "tail_logs",
  {
    title: "Tail logs",
    description: "Fetch recent runtime lines",
    inputSchema: { tail: z.number().optional() },
    outputSchema: { text: z.string().optional() }
  },
  async ({ tail = 600 }) => {
    const r = await axios.get(`http://127.0.0.1:${PORT}/api/mcp/tail_logs?tail=${tail}`);
    const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    return { content: [{ type: "text", text }], structuredContent: { text } };
  }
);

mcpServer.registerTool(
  "stop_python",
  {
    title: "Stop Python",
    description: "Stop running app by filename",
    inputSchema: { path: z.string() },
    outputSchema: { status: z.string().optional() }
  },
  async ({ path }) => {
    const r = await axios.post(`http://127.0.0.1:${PORT}/api/mcp/stop_python`, { path });
    const data = r.data;
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

mcpServer.registerTool(
  "hls_start",
  {
    title: "Start HLS",
    description: "Start ffmpeg HLS sidecar",
    inputSchema: { uri: z.string(), hls_time: z.number().optional(), hls_list_size: z.number().optional(), image: z.string().optional() },
    outputSchema: { ok: z.boolean().optional(), playlist: z.string().optional(), pipeline: z.string().optional(), error: z.string().optional() }
  },
  async ({ uri, hls_time, hls_list_size, image }) => {
    const r = await axios.post(`http://127.0.0.1:${PORT}/api/hls/start`, { uri, hls_time, hls_list_size, image });
    const data = r.data;
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

mcpServer.registerTool(
  "hls_stop",
  {
    title: "Stop HLS",
    description: "Stop ffmpeg HLS sidecar",
    inputSchema: {},
    outputSchema: { ok: z.boolean().optional() }
  },
  async () => {
    const r = await axios.post(`http://127.0.0.1:${PORT}/api/hls/stop`);
    const data = r.data;
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

mcpServer.registerTool(
  "hls_logs",
  {
    title: "HLS logs",
    description: "Tail HLS sidecar logs",
    inputSchema: {},
    outputSchema: { text: z.string().optional() }
  },
  async () => {
    const r = await axios.get(`http://127.0.0.1:${PORT}/api/hls/logs`);
    const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    return { content: [{ type: "text", text }], structuredContent: { text } };
  }
);

mcpServer.registerTool(
  "start_python",
  {
    title: "Start Python backend",
    description: "Start ds_python container",
    inputSchema: { install: z.boolean().optional(), useGit: z.boolean().optional(), image: z.string().optional() },
    outputSchema: { status: z.string().optional(), error: z.string().optional() }
  },
  async ({ install = false, useGit = false, image }) => {
    const r = await axios.post(`http://127.0.0.1:${PORT}/api/dspython/start`, { install, useGit, image });
    const data = r.data;
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

mcpServer.registerTool(
  "e2e_rtsp_out_1",
  {
    title: "E2E: deepstream_test1_rtsp_out_1",
    description: "Start ds_python, run DS Python app, start HLS sidecar, return playlist",
    inputSchema: { path: z.string().optional(), input: z.string().optional(), codec: z.string().optional(), hls_time: z.number().optional(), hls_list_size: z.number().optional(), image: z.string().optional() },
    outputSchema: { ok: z.boolean().optional(), playlist: z.string().optional(), pipeline: z.string().optional(), rtsp: z.string().optional(), error: z.string().optional() }
  },
  async ({ path, input, codec = "H264", hls_time = 2, hls_list_size = 5, image }) => {
    const p = path || "/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out_1.py";
    const inp = input || "/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264";
    try { await axios.post(`http://127.0.0.1:${PORT}/api/dspython/start`, { install: false, useGit: false }); } catch {}
    await new Promise(r => setTimeout(r, 5000));
    const t = await axios.post(`http://127.0.0.1:${PORT}/api/mcp/test_python`, { path: p, validate: true, input: inp, codec });
    const rtsp = (t.data && t.data.rtsp) || null;
    const h = await axios.post(`http://127.0.0.1:${PORT}/api/hls/start`, { uri: "udp://127.0.0.1:5600", hls_time, hls_list_size, image });
    const playlist = (h.data && h.data.playlist) || "/video/out.m3u8";
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, playlist, pipeline: h.data && h.data.pipeline, rtsp }) }], structuredContent: { ok: true, playlist, pipeline: h.data && h.data.pipeline, rtsp } };
  }
);

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => { transport.close(); });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});
