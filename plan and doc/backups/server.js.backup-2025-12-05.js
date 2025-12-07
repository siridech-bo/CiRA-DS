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
import WebSocket from "ws";
import mqtt from "mqtt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('etag', false);
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

let DS_IMAGE = process.env.DEEPSTREAM_IMAGE || "siridech2/deepstream-l4t:pyds-dev";
let DS_IMAGE_PINNED = null;
async function resolveDeepstreamImageDigest() {
  try {
    const envDigest = String(process.env.DEEPSTREAM_IMAGE_DIGEST || "").trim();
    if (envDigest && /^sha256:[0-9a-fA-F]{64}$/.test(envDigest)) {
      const repo = DS_IMAGE.includes("@sha256:") ? DS_IMAGE.split("@")[0] : DS_IMAGE.split(":")[0];
      DS_IMAGE_PINNED = `${repo}@${envDigest}`;
      return DS_IMAGE_PINNED;
    }
    if (DS_IMAGE.includes("@sha256:")) { DS_IMAGE_PINNED = DS_IMAGE; return DS_IMAGE_PINNED; }
    let info = await dockerRequest("GET", `/images/${encodeURIComponent(DS_IMAGE)}/json`);
    try {
      if (info.statusCode >= 200 && info.statusCode < 300) {
        const j = JSON.parse(info.body || "{}");
        const digests = Array.isArray(j.RepoDigests) ? j.RepoDigests : [];
        const baseRepo = DS_IMAGE.split(":")[0];
        const preferred = digests.find((d) => d.startsWith(baseRepo + "@sha256:")) || digests[0];
        if (preferred) { DS_IMAGE_PINNED = preferred; }
      }
    } catch {}
    if (!DS_IMAGE_PINNED) {
      await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(DS_IMAGE)}`);
      info = await dockerRequest("GET", `/images/${encodeURIComponent(DS_IMAGE)}/json`);
      try {
        const j = JSON.parse(info.body || "{}");
        const digests = Array.isArray(j.RepoDigests) ? j.RepoDigests : [];
        const baseRepo = DS_IMAGE.split(":")[0];
        const preferred = digests.find((d) => d.startsWith(baseRepo + "@sha256:")) || digests[0];
        if (preferred) { DS_IMAGE_PINNED = preferred; }
      } catch {}
    }
    return DS_IMAGE_PINNED || DS_IMAGE;
  } catch { return DS_IMAGE_PINNED || DS_IMAGE; }
}
function _getDsImage() { return DS_IMAGE_PINNED || DS_IMAGE; }
try { resolveDeepstreamImageDigest().then(() => { try { console.log(`DeepStream image pinned: ${_getDsImage()}`); } catch {} }); } catch {}

export default {};
