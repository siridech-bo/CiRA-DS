# DeepStream USB Cam Debug Summary

- Outcome: Live X11 video with OSD and bounding boxes working.
- Scope: Fixes applied to camera caps, display path, OSD, and inference.

## Problems Observed

- No startup logs, silent foreground execution due to quoting/env usage.
- Permission denied in container when accessing bind-mounted app files.
- Crash: `AttributeError: 'NoneType' object has no attribute 'set_property'` when inference disabled.
- Caps negotiation failure: `reason not-negotiated (-4)` from `v4l2src`.
- Black X11 window and single-frame freeze with no errors.
- No OSD and no bounding boxes when display was live.

## Fixes Applied

- Execution and logging:
  - Use `docker exec -e VAR=...` for env; avoid nested quoted `env ... | tee ...`.
  - Run foreground with `stdbuf -oL -eL python3 -u` to unbuffer stdout.
  - Tail `/tmp/ds_usb_dev_app.log` inside the container.

- Permissions:
  - Execute as root inside container: `docker exec -u 0 ...`.
  - Allow X11 for root: `xhost +si:localuser:root` or `xhost +local:root`.

- Inference guard:
  - `if use_infer and pgie is not None:` protects `config-file-path` set when `DS_DISABLE_INFER=1`.
  - Location: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:327–329`.

- Camera caps and decode:
  - MJPG path via `image/jpeg` adds `jpegdec`:
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:342–347`.
  - Safe caps: MJPG `640x480@30` or `1280x720@30`; YUYV `640x480@30`.

- Upstream NVMM surface format:
  - Set `video/x-raw(memory:NVMM), format=NV12` before `streammux`:
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:303`.

- Live scheduling and backpressure:
  - `v4l2src.do-timestamp=true`: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:305–309`.
  - `nvstreammux` live tuning: `attach-sys-ts=1`, `sync-inputs=0`:
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:319–323`.
  - Insert leaky queues around OSD and sink:
    - `q_pre_osd` and `q_post_display` with `leaky=2`, `max-size-buffers=1`:
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:358–363, 365–370`.
  - Sink properties: `sync=false`, `async=false`:
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:329–333`.

- Display chain rewiring:
  - `caps_rgba → q_pre_osd → nvosd → q_post_display → (egltransform) → sink`:
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:434–444`.

- OSD enable:
  - `nvosd.process-mode=0`, `nvosd.display-text=1`:
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:273–277`.
  - Pad probe adds `NvDsDisplayMeta` every frame:
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:81–145`.

- Inference enable and config:
  - New FP16 config `pgie_config_fp16.txt` pointing to sample models:
    - `data/apps/deepstream-test1-usbcam/pgie_config_fp16.txt:1–21`.
  - Set `DS_DISABLE_INFER=0` and `DS_PGIE_CONFIG=/app/share/pgie_config_fp16.txt` when starting.

## Known-Good Start Commands (Jetson)

- MJPG 640x480@30 with inference:
  - `sudo docker exec -u 0 ds_usb_dev pkill -f deepstream_test_1_usb_ros.py || true`
  - `sudo docker exec -u 0 -d -e DISPLAY=:0 -e PYTHONPATH=/app:/app/common -e DS_OUTPUT_MODE=display -e DS_CAM_CAPS=image/jpeg -e DS_CAM_WIDTH=640 -e DS_CAM_HEIGHT=480 -e DS_CAM_FPS=30/1 -e DS_DISABLE_INFER=0 -e DS_PGIE_CONFIG=/app/share/pgie_config_fp16.txt ds_usb_dev sh -lc "stdbuf -oL -eL python3 -u /app/share/deepstream_test_1_usb_ros.py /dev/video0 > /tmp/ds_usb_dev_app.log 2>&1"`
  - `sudo docker exec -u 0 ds_usb_dev tail -n 200 /tmp/ds_usb_dev_app.log`

## Rationale

- NV12 NVMM surfaces and live timestamps keep streammux and downstream stages flowing.
- Leaky queues isolate display path from upstream backpressure.
- FP16 config avoids missing INT8 engines and uses sample models available in the container.
- OSD properties and pad probe ensure overlay text and boxes render on the live stream.
