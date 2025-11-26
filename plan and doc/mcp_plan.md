# MCP Integration Plan for CiRA DeepStream Web App

## Overview
- Goal: Enable LLM-driven edits in Trae IDE to be pushed to the Jetson-hosted web app (MCP server), which applies updates to the DeepStream bind-mounted application directory and controls container lifecycle.
- Control Plane: The web app exposes MCP tools (HTTP/gRPC endpoints) for file upload, config rendering, container run/restart, and log streaming.
- Outcome: One-click or automated loop from IDE → Web App → Jetson DeepStream container, with validation, auditability, and immediate feedback.

## Core MCP Tools
- upload_file
  - Inputs: `repo_path`, `content`, `sha256`, `mode`
  - Behavior: Write to temp, verify hash, atomic rename into allowed mount path; deny writes outside configured roots; return artifact path and status.
- upload_dir
  - Inputs: `base_path`, `archive` (tar/zip), `manifest`, `excludes`
  - Behavior: Extract atomically into mount path; ignore `.git`, `__pycache__`, large artifacts; return file list and status.
- render_deepstream_configs
  - Inputs: `pipeline_spec_json`
  - Behavior: Normalize canonical pipeline spec → resolve base/add-on stacks and model selections via `stack_loader.py` → emit DeepStream INI and related files under `configs/`.
- run_deepstream_container
  - Inputs: `image_tag`, `entrypoint`, `args`, `env`, `mounts`, `network_mode`, `labels`
  - Behavior: Start container with `--runtime nvidia`, `--network host`, `-e DISPLAY=:0`, `-v /tmp/.X11-unix:/tmp/.X11-unix`, bind app path; return `container_id`, `logs_url`, and preview endpoints.
- restart_container
  - Inputs: `container_name_or_label`
  - Behavior: Stop and start with last known config; fast apply after file uploads/config changes.
- tail_logs
  - Inputs: `container_id`, `since`, `follow`
  - Behavior: Stream logs/events to IDE; supports backpressure and filters.
- validate_python
  - Inputs: `file_path`
  - Behavior: Syntax/static checks server-side (e.g., `python -m pyflakes` or `ruff` if available); reject broken uploads early.
- dry_run_pipeline
  - Inputs: `pipeline_spec_json`
  - Behavior: Generate configs only; no container start; returns diff/paths for review.

## Canonical Pipeline → Config Rendering
- Responsibilities
  - Normalize high-level pipeline JSON into internal structure across sources, inference, tracking, OSD, sinks.
  - Resolve base/add-on stacks and selected models via `stack_loader.py`.
  - Render DeepStream INI configs (and any auxiliary files) deterministically from the spec.
- Outputs
  - DeepStream INI files per component; path layout under `configs/` within the mounted app directory.
  - Model artifacts references and version pins (do not store secrets; use server-side credentials for downloads if required).

## Container Execution
- Preconditions
  - App directory bind-mounted (e.g., `/home/nvidia/apps:/apps`).
  - X11 mapping: `-v /tmp/.X11-unix:/tmp/.X11-unix`, `-e DISPLAY=:0`; include `~/.Xauthority` mapping if environment requires.
- Run flags
  - `--runtime nvidia`, `--network host`, resource limits as needed.
  - Entry point: `python3 /apps/<your_app>.py` or `deepstream-app -c /apps/configs/<ini>.txt` depending on workflow.
- Image management
  - `docker login` (server-side) → `docker pull nvcr.io/nvidia/deepstream:<tag>` prior to start; cache tags and last successful runs.

## Security & Reliability
- Auth/RBAC: Token-based access; restrict edits to configured mount roots; audit user and request IDs.
- Atomicity: Write to temp, fsync, then rename; avoid partial reads from the running container.
- Idempotency: Use content hashes; skip redundant uploads; deterministic config rendering.
- Rate limiting: Guard against rapid restarts; debounce watcher-driven updates.
- Secret hygiene: Never echo secrets; use server env/vault for credentials; mask logs.
- Validation gates: `validate_python` and `dry_run_pipeline` before container restart.

## Request/Response Shapes (Sketch)
- upload_file (request)
  - `{ repo_path: string, content: base64|string, sha256: string, mode?: "0644" }`
- upload_file (response)
  - `{ status: "ok"|"error", artifact_path?: string, message?: string }`
- render_deepstream_configs (response)
  - `{ status: "ok", outputs: { files: string[] }, diagnostics?: object }`
- run_deepstream_container (response)
  - `{ status: "ok", container_id: string, logs_url: string, preview_urls?: string[] }`

## Operational Flow
- Edit in Trae IDE → call `upload_file`/`upload_dir` → optional `validate_python` → optional `render_deepstream_configs` → `restart_container` (or `run_deepstream_container` first time) → `tail_logs` for feedback.
- For pipeline changes, always render configs before restart.

## Implementation Notes
- Allowed paths: Configure a single application root (e.g., `/home/nvidia/apps`) that is bind-mounted; deny writes outside this root.
- Exclusions: `.git`, `__pycache__`, build artifacts; large model files handled via server-side download if needed.
- Observability: Attach labels to containers; expose `logs_url` endpoints and last run metadata.
- Error handling: Clear error codes/messages; provide remediation hints (e.g., missing model, invalid INI).

## Extensibility
- Add tools for dataset ingestion, model download/verification, and batch validations.
- Support gRPC MCP if your agent stack prefers streaming and multiplexing.
- Introduce webhooks for GitOps alternative flows (commit-based) alongside direct MCP operations.

