import express from "express";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const BASE = process.env.JETSON_WEB_BASE || "http://127.0.0.1:3000";

const server = new McpServer({ name: "CiRA SPACE", version: "0.2.0" });

async function post(path, body) {
  const url = `${BASE}${path}`;
  const r = await axios.post(url, body, { headers: { "Content-Type": "application/json" } });
  return r.data;
}
async function get(path) {
  const url = `${BASE}${path}`;
  const r = await axios.get(url);
  return r.data;
}

server.registerTool(
  "upload_file",
  {
    title: "Upload file",
    description: "Atomic write to container under allowed root",
    inputSchema: { path: z.string(), content: z.string(), sha256: z.string().optional(), mode: z.string().optional() },
    outputSchema: { status: z.string().optional(), artifact_path: z.string().optional(), bytes: z.number().optional() }
  },
  async ({ path, content, sha256, mode }) => {
    const data = await post("/api/mcp/upload_file", { path, content, sha256, mode });
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

server.registerTool(
  "validate_python",
  {
    title: "Validate Python",
    description: "py_compile a path in the container",
    inputSchema: { path: z.string() },
    outputSchema: { status: z.string().optional(), output: z.string().optional() }
  },
  async ({ path }) => {
    const data = await post("/api/mcp/validate_python", { path });
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

server.registerTool(
  "test_python",
  {
    title: "Test Python",
    description: "Upload (optional), validate and run DeepStream app; return RTSP",
    inputSchema: { path: z.string(), content: z.string().optional(), sha256: z.string().optional(), validate: z.boolean().optional(), input: z.string().optional(), codec: z.string().optional() },
    outputSchema: { status: z.string().optional(), artifact_path: z.string().optional(), bytes: z.number().optional(), rtsp: z.string().optional() }
  },
  async (args) => {
    const data = await post("/api/mcp/test_python", args);
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

server.registerTool(
  "tail_logs",
  {
    title: "Tail logs",
    description: "Fetch recent runtime lines",
    inputSchema: { tail: z.number().optional() },
    outputSchema: { text: z.string().optional() }
  },
  async ({ tail = 600 }) => {
    const text = await get(`/api/dspython/logs?tail=${tail}`);
    const data = typeof text === "string" ? text : JSON.stringify(text);
    return { content: [{ type: "text", text: data }], structuredContent: { text: data } };
  }
);

server.registerTool(
  "stop_python",
  {
    title: "Stop Python",
    description: "Stop running app by filename",
    inputSchema: { path: z.string() },
    outputSchema: { status: z.string().optional() }
  },
  async ({ path }) => {
    const data = await post("/api/mcp/stop_python", { path });
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", base: BASE });
});

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => { transport.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`CiRA SPACE MCP Gateway running on http://0.0.0.0:${PORT}/mcp -> ${BASE}`);
});
