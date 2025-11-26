# Jetson Edge MCP Plan

## Goals
- Run MCP on Jetson; Agents call tools over LAN.
- One-call testing: upload → validate → run → HLS → logs.
- Keep existing container, mounts, and pyds unchanged.

## Phase 1 — Endpoints
- Add `POST /api/mcp/validate_python` to compile-check a path under the allowed root.
- Add `POST /api/mcp/test_python` orchestrator to upload (optional), validate, run, and tail logs.

## Phase 2 — Packaging
- Containerize `jetson-web` with MCP routes; serve `openapi.json`.
- Provide compose and environment (`DEEPSTREAM_URL`, bind mounts, ports).
- Auto-start on Jetson and expose over LAN.

## Phase 3 — IDE Integration
- Remote MCP entry with base URL and OpenAPI path.
- Optional CLI/SDK for one-call orchestrations.

## Phase 4 — Security
- AuthN via API key/JWT; AuthZ via roles.
- Path gating, atomic writes, `sha256`, rate limits, audit.
- HTTPS outside trusted LAN.

## Phase 5 — Verification
- Unit: path gating, atomic writes, validation.
- E2E: test2 upload and run; RTSP/HLS; tail logs.

## Acceptance
- Agent can say “Test this file in web app” and get `{ rtsp, hls, logs }`.
- Writes constrained to `/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/`.
- No lifecycle changes unless requested.
