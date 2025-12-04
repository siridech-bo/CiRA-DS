# DeepStream USB Cam MQTT Metadata Bridge

## Summary
- X11 rendering fixed and bounding boxes displayed via `nvdsosd`.
- Python pad-probe reads metadata using `pyds` and publishes detection JSON to MQTT.
- Broker runs as `eclipse-mosquitto:2` on Jetson; topic `deepstream/detections` verified.

## Display Fixes
- Set `DISPLAY=:0` and grant X11 ACL: `xhost +si:localuser:root`.
- Force `nveglglessink` with `DS_USE_EGL=1`.
- Enable OSD: `nvdsosd.process-mode=0`, `display-text=1`, `display-bbox=1`, `border-width=3`.
- Tee linking with explicit request pads for three branches: display, snapshot, msgconv.

## Inference and PGIE
- Use sample: `DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt`.
- Engine auto-rebuild logged; bounding boxes and per-frame caption appear.

## Python Metadata and MQTT
- Install `pyds` aarch64 wheel (v1.1.0) in container.
- Python pad-probe extracts frame/object meta and builds payload:
  - `{"frame": <id>, "detections": [{"class_id", "left", "top", "width", "height", "confidence"}]}`
- Python MQTT client (`paho-mqtt`) publishes to `deepstream/detections` when `DS_ENABLE_MSG=0`.
- Heartbeat publisher thread emits `{type:"heartbeat", ts:<ms>}` every second.

## DeepStream Message Components (optional)
- Elements: `nvmsgconv` → `nvmsgbroker` gated by `DS_ENABLE_MSG`.
- MQTT proto lib expected at `.../lib/libnvds_mqtt_proto.so`; if missing, use Python MQTT route.

## Environment Variables
- Display: `DS_USE_EGL=1`, `DS_OUTPUT_MODE=display`.
- Camera caps: `DS_CAM_CAPS=image/jpeg`, `DS_CAM_WIDTH=1280`, `DS_CAM_HEIGHT=720`, `DS_CAM_FPS=30/1`.
- Inference: `DS_DISABLE_INFER=0`, `DS_PGIE_CONFIG=<path>`.
- MQTT (Python route): `DS_ENABLE_MSG=0`, `DS_MQTT_HOST=127.0.0.1`, `DS_MQTT_PORT=1883`, `DS_MQTT_TOPIC=deepstream/detections`.
- Msg components: `DS_ENABLE_MSG=1`, `DS_MSGCONV_CONFIG=/app/share/dstest4_msgconv_config.txt`, `DS_MQTT_PROTO_LIB=.../libnvds_mqtt_proto.so`, `DS_MQTT_CONN_STR=127.0.0.1;1883`.

## Run and Verify
- Launch USB app in container with env above; tail `/tmp/ds_usb_dev_app.log` for model build and OSD messages.
- MQTT subscribe: `mosquitto_sub -h 127.0.0.1 -t deepstream/detections -v`.
- Clear retained: `mosquitto_pub -h 127.0.0.1 -t deepstream/detections -r -n`.

## Pitfalls and Fixes
- X11 ACL without `DISPLAY=:0` fails; ensure environment before `xhost`.
- `nv3dsink` may be finicky; prefer `nveglglessink` on Jetson.
- Tee must use `get_request_pad('src_%u')` for multiple branches.
- MQTT adapter library may be missing; use Python route until present.

## ROS Bridge
- Use `roslibpy` to publish detection JSON to `/deepstream/detections_json`.
- Sidecar MQTT→rosbridge is trivial with `paho-mqtt` and `roslibpy`.

