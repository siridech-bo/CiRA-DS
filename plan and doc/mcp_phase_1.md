# MCP Phase 1 — Web App Terminal + Upload File

## Goals
- Use the web app’s terminal as the only place to run tests and capture errors; keep existing container, mounts, and `pyds` setup unchanged.
- Implement `upload_file` in the web app (Container File Editor) so edits from IDE/LLM write directly to the already bind-mounted paths.
- Provide `tail_logs` so the LLM can read the same terminal output and summarize issues.

## Scope (Phase 1)
- Endpoints: `upload_file`, `tail_logs` (+ optional `validate_python`).
- No Docker lifecycle changes from IDE; start/stop happens via the web UI buttons you already have.
- No changes to mounts or `pyds` shims.

## Endpoints
- `POST /mcp/upload_file`
  - Body: `{ path: string, content: base64|string, sha256?: string, mode?: "0644" }`
  - Rules:
    - Path must be under allowed roots (e.g., `/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/`).
    - Normalize path and reject traversal.
  - Behavior:
    - If `sha256` provided, verify content hash.
    - Atomic write: temp file in same dir → fsync → rename.
    - Return: `{ status: "ok", artifact_path: path }` or `{ status: "error", message }`.

- `GET /mcp/tail_logs`
  - Query: `label`, `since?`, `limit?`
  - Behavior:
    - Read from the same stream/ring buffer the web terminal uses.
    - Return: `{ status: "ok", lines: string[], next_since: number }`.
    - Provide polling-friendly output (no WebSocket required for the LLM).

- `POST /mcp/validate_python` (optional)
  - Body: `{ path }`
  - Behavior:
    - Run `python3 -m py_compile <path>` inside the container or host (whichever your terminal uses).
    - Return: `{ status: "ok" }` or `{ status: "error", message }`.

## Server Behavior
- Allowed roots: whitelist directories the Container File Editor already supports; deny writes outside.
- Atomic updates: write to `*.tmp` then `rename()` to avoid partial reads.
- Idempotency: if `sha256` equals current file, skip write and return `ok`.
- Audit: log user, path, hash, and timestamp.

## IDE/LLM Flow
- Edit file in IDE.
- Call `upload_file` with the exact path shown/used by the Container File Editor.
- Optionally call `validate_python` to catch syntax errors.
- Use the web app button to start/stop preview (unchanged).
- Poll `tail_logs` to retrieve the same terminal output for summarization and error triage.

## Testing Procedure
- Use a known Python example (e.g., `deepstream_test1_rtsp_out.py`).
- Make a small edit (add log, tweak param).
- `upload_file` to `/opt/nvidia/deepstream/.../deepstream_test1_rtsp_out.py`.
- Click "Start Preview" in the web app.
- Poll `tail_logs` to confirm the change and capture any errors; iterate.

## Safety
- Path restriction and normalization to prevent traversal.
- Content hash verification to avoid corrupted writes.
- Rate limit uploads to protect the terminal/log storage and container.
- Auth/RBAC on endpoints; never echo secrets.

## Notes
- This phase avoids mount/debug cycles and leverages your proven container + `pyds` environment.
- Later phases can add config rendering (`render_deepstream_configs`) and controlled restarts if desired.

