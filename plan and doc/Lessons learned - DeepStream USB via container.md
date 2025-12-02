# Lessons Learned — DeepStream USB via Container (Jetson, X11)

## Outcomes
- X11 displays live USB camera video via `nv3dsink`/`nveglglessink`.
- Bounding boxes and class labels render through `nvdsosd` with RGBA path.
- Fully non-interactive run over SSH using key-based auth.

## Root Causes
- Missing Python GI bindings in container (`python3-gi`, `python3-gst-1.0`).
- `pyds` binding absent or mismatched; require `pyds_ext` shim.
- X11 not prepared: need `DISPLAY=:0`, `/tmp/.X11-unix` mount, `xhost +local:root`.
- PGIE config and model paths wrong for container; use sample config by default.
- Container exits immediately with one-off runs; use persistent container for execs.
- Pipeline specifics: enforce RGBA before `nvdsosd`, `live-source=1`, correct pad API.

## Reliable Run Procedure
- Prepare display on Jetson: `export DISPLAY=:0` and allow root: `xhost +local:root`.
- Launch container persistently to avoid immediate exit: use `--entrypoint sleep` or a long-running shell loop.
- Install GI introspection in container: `python3-gi`, `python3-gst-1.0` (GI + GStreamer bindings required for Python).
- Mounts required:
  - `/tmp/.X11-unix:/tmp/.X11-unix` for X11
  - `share:/app/share` for app script and configs
  - `common:/app/common` for helpers
  - `--device=/dev/video0` for the USB camera
- Env required:
  - `DISPLAY=:0`, `PYTHONPATH=/app:/app/common`
  - `DS_PGIE_CONFIG` optional; defaults to container sample config

## App Settings That Made It Work
- Default PGIE config resolves to container sample if present:
  - `config_infer_primary.txt` in `deepstream-6.0/samples/configs/deepstream-app`
  - Fallback to local `dstest1_pgie_config.txt` if sample path missing
- Force RGBA before `nvdsosd`:
  - Caps: `video/x-raw(memory:NVMM), format=RGBA`
- Camera stability:
  - `nvstreammux` `live-source=1`, width/height set to 1920x1080, batch-size=1
- Correct pad request API:
  - `streammux.get_request_pad("sink_0")`
- Sink selection on Jetson:
  - Prefer `nv3dsink`, fallback to `nveglglessink` if unavailable
- OSD probe returns proper value to avoid TypeError:
  - Always return `Gst.PadProbeReturn.OK` in probe function
- pyds shim:
  - Fallback import to `pyds_ext` when official `pyds` is unavailable

## Commands (Non-Interactive)
- Start container and run app:
  - `docker run -d --name ds_usb_run --entrypoint sleep --runtime nvidia --network host --privileged -e DISPLAY=:0 -e PYTHONPATH=/app:/app/common -e DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt -v /tmp/.X11-unix:/tmp/.X11-unix:rw -v /data/ds/share:/app/share -v /data/ds/common:/app/common --device=/dev/video0 nvcr.io/nvidia/deepstream-l4t:6.0.1-samples 9999999`
  - `docker exec ds_usb_run /usr/bin/env DISPLAY=:0 PYTHONPATH=/app:/app/common DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt python3 /app/share/deepstream_test_1_usb.py /dev/video0`

## Pitfalls and Fixes
- Missing GI modules (`ModuleNotFoundError: gi`): install `python3-gi` and `python3-gst-1.0` inside the container.
- ETLT/ONNX model paths: switching to built-in sample `config_infer_primary.txt` avoids missing model/cache issues.
- Pad probe TypeError: ensure probe returns `Gst.PadProbeReturn.OK` in all branches.
- Container exits immediately: keep it alive with a sleep entrypoint and then `docker exec` the run.
- X11 permission denied: run `xhost +local:root` prior to container startup.

## Code References
- PGIE config resolution: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:253-256`
- RGBA capsfilter: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:220-247`
- Streammux live-source: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:248-252`
- Pad request/link: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:285-291`
- Sink selection: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:229-241`
- OSD pad probe return: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:69-75, 143`
- pyds_ext fallback: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:45-51`

## SSH Prereq
- Use the SSH guide at `plan and doc/SSH setting.md` for key-based, non-interactive SSH/scp.

## Permanent Fix Strategy
- Container image:
  - Base `nvcr.io/nvidia/deepstream-l4t:6.0.1-samples` pinned to Jetson/L4T.
  - Install GI: `python3-gi`, `python3-gst-1.0`, `gir1.2-gstreamer-1.0`, `gir1.2-gst-plugins-base-1.0`.
  - Vendor `pyds_ext` and include `/app:/app/common` in `PYTHONPATH`.
  - Dev entrypoint: `sleep infinity`; production entrypoint runs the app.
- X11 setup:
  - Host: `DISPLAY=:0` and `xhost +si:localuser:root` (preferred) or `+local:root`.
  - Mount `/tmp/.X11-unix` and set `DISPLAY` in container.
- PGIE config resolution:
  - Default to sample `config_infer_primary.txt`; fallback to `dstest1_pgie_config.txt`.
  - Keep runtime detection in code for portability across images.
- pyds shim and OSD probe:
  - Try `pyds`, fallback `pyds_ext`, else `pyds=None`.
  - Guard probe logic and always return `Gst.PadProbeReturn.OK`.
- Pipeline stability:
  - Enforce RGBA before `nvdsosd`.
  - `nvstreammux live-source=1`; use `get_request_pad("sink_0")`.
  - Prefer `nv3dsink`, fallback `nveglglessink`.
- Lifecycle:
  - Persistent dev container for iteration via `docker exec`.
  - Separate production run target with clean exit statuses.
- Acceptance criteria:
  - GI imports succeed in container; X11 renders reliably; detections show with sample PGIE; overrides via `DS_PGIE_CONFIG` work; no probe errors.

## Recommended Plan
- Objectives
  - Standardize DeepStream image (GI + `pyds_ext`).
  - Robust X11 rendering on Jetson.
  - PGIE config resolution stable across images.
  - Persistent dev container; clean prod run target.
- Phase 1 — Image
  - Build from `nvcr.io/nvidia/deepstream-l4t:6.0.1-samples`.
  - Install GI packages; vendor `pyds_ext`; set `PYTHONPATH`.
  - Dev entrypoint `sleep infinity`; prod entrypoint runs app.
- Phase 2 — Host X11 Setup
  - `export DISPLAY=:0`; `xhost +si:localuser:root` (preferred).
  - Mount `/tmp/.X11-unix` in container.
- Phase 3 — Runtime Definition
  - Runtime NVIDIA, host network, privileged, `/dev/video0`.
  - Mount app `share` and `common`; set `DISPLAY`, `PYTHONPATH`, optional `DS_PGIE_CONFIG`.
- Phase 4 — App Conventions
  - PGIE default to sample config with fallback.
  - `pyds_ext` shim and guarded OSD probe returns.
  - Enforce RGBA before `nvdsosd`; `live-source=1`; `get_request_pad("sink_0")`.
  - Prefer `nv3dsink`, fallback `nveglglessink`.
- Phase 5 — Dev Run Procedure
  - Start persistent container; install GI; `docker exec` the app.
- Phase 6 — Validation
  - X11 renders; detections with sample PGIE; override works; no probe errors.
- Phase 7 — Production Run
  - Service/entrypoint that starts app with env; logs and statuses propagate.
- Risks and Mitigations
  - DeepStream path drift mitigated by runtime detection and fallback.
  - X11 policy variance mitigated with `localuser:root` and documentation.
- GPU access issues mitigated by running container as root.

## Conclusion
- Phases 1–3 completed:
  - Built `deepstream-usb-dev:6.0.1` with GI bindings and persistent CMD.
  - Prepared Jetson X11 and launched persistent dev container.
  - Standardized dev/prod runs via `scripts/deepstream_usb_run.sh`.
- Phases 5–6 completed:
  - Dev run successful; X11 video renders with bounding boxes and captions.
  - Validation passed: PGIE sample config loaded; engine serialized; OSD overlays stable; pipeline healthy.
- Phase 7 not required:
  - Production run target defined in the script, but not executed per request.
- Current state is stable and repeatable using the dev script.
