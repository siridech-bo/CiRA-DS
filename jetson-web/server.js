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

app.listen(PORT, () => {
  console.log(`Web server running at http://localhost:${PORT}/`);
});