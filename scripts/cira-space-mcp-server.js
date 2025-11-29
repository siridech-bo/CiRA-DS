import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import axios from "axios";

const BASE = process.env.CIRA_SPACE_BASE || "http://192.168.1.200:3000";

const server = new McpServer({ name: "CiRA SPACE", version: "0.2.0" });

async function post(path, body) {
  const url = `${BASE}${path}`;
  const res = await axios.post(url, body, { headers: { "Content-Type": "application/json" } });
  return res.data;
}
async function get(path) {
  const url = `${BASE}${path}`;
  const res = await axios.get(url);
  return res.data;
}

server.registerTool(
  "upload_file",
  {
    title: "Upload file to container",
    description: "Atomic write under allowed root",
    inputSchema: {
      path: z.string(),
      content: z.string(),
      sha256: z.string().optional(),
      mode: z.string().optional()
    },
    outputSchema: { status: z.string().optional() }
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
    description: "py_compile a Python file in the container",
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
    title: "Test Python file",
    description: "Upload (optional), validate, run DeepStream app and return RTSP",
    inputSchema: {
      path: z.string(),
      content: z.string().optional(),
      sha256: z.string().optional(),
      validate: z.boolean().optional(),
      input: z.string().optional(),
      codec: z.string().optional()
    },
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
    const text = await get(`/api/mcp/tail_logs?tail=${tail}`);
    const data = typeof text === "string" ? text : JSON.stringify(text);
    return { content: [{ type: "text", text: data }], structuredContent: { text: data } };
  }
);

server.registerTool(
  "stop_python",
  {
    title: "Stop Python app",
    description: "Stop running app by filename",
    inputSchema: { path: z.string() },
    outputSchema: { status: z.string().optional() }
  },
  async ({ path }) => {
    const data = await post("/api/mcp/stop_python", { path });
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
