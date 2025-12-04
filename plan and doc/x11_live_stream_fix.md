# X11 Live Stream Fix Summary

- Outcome: X11 window now shows continuous live video; initial single-frame freeze resolved.

- See also: MQTT metadata bridge and ROS notes in `plan and doc/mqtt_metadata_bridge.md`.

## Code Changes

- Set upstream NVMM caps to NV12 to ensure valid DeepStream surfaces:
  - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:298`
- Enable timestamps on the camera source for live scheduling:
  - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:300`
- Tune `nvstreammux` for live sources and system timestamps:
  - `attach-sys-ts=1`, `sync-inputs=0` at `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:309–313`
- Configure queues to decouple OSD and sink backpressure:
  - `q_pre_osd` leaky, `max-size-buffers=1` at `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:340–343`
  - `q_post_display` leaky, `max-size-buffers=1` at `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:342–345`
- Rewire display chain to include both queues:
  - `caps_rgba → q_pre_osd → nvosd → q_post_display → (egltransform if needed) → sink` at `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:406–414`
- Set sink properties for non-blocking playback:
  - `sync=false`, `async=false` at `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:315–319`
- Previously added guard to avoid inference crash when disabled:
  - `if use_infer and pgie is not None:` at `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:313–314`

## Runtime Settings Used

- Prefer `docker exec -e ...` for environment rather than nested quoted `env` strings.
- Typical start (MJPG 640x480@30) and log tail:
  - `sudo docker exec -u 0 ds_usb_dev pkill -f deepstream_test_1_usb_ros.py || true`
  - `sudo docker exec -u 0 -d -e DISPLAY=:0 -e PYTHONPATH=/app:/app/common -e DS_OUTPUT_MODE=display -e DS_CAM_CAPS=image/jpeg -e DS_CAM_WIDTH=640 -e DS_CAM_HEIGHT=480 -e DS_CAM_FPS=30/1 -e DS_DISABLE_INFER=1 ds_usb_dev sh -lc "stdbuf -oL -eL python3 -u /app/share/deepstream_test_1_usb_ros.py /dev/video0 > /tmp/ds_usb_dev_app.log 2>&1"`
  - `sudo docker exec -u 0 ds_usb_dev tail -n 200 /tmp/ds_usb_dev_app.log`

## Camera Caps

- Verified formats via `v4l2-ctl --list-formats-ext` inside the container.
- Stable choices:
  - MJPG: `640x480@30` or `1280x720@30`
  - YUYV: `640x480@30` (with upstream NV12 conversion)

## Rationale

- NV12 caps upstream guarantee valid NVMM surfaces for `nvstreammux`.
- Timestamps and mux tuning treat the feed as live and avoid blocking on missing or unsynced timestamps.
- Queues before OSD and sink prevent backpressure from stalling upstream stages, resolving the single-frame freeze.

## Next Debug Target

- “NO OSD” while display is live. We will verify OSD inputs and ensure expected draw operations appear on the rendered stream.
