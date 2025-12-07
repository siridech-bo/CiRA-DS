# DeepStream USB App Startup Procedure

## Image And Container
- Use image: `siridech2/deepstream-usb-dev:20251205-090843`
- Recreate container with required mounts and flags:
```
ssh jetson "bash -lc 'docker stop ds_usb_dev || true; docker rm ds_usb_dev || true; \
  docker run -d --name ds_usb_dev --network host --privileged -e DISPLAY=:0 \
  -v /home/datasets:/data/ds/datasets \
  -v /usr/lib/aarch64-linux-gnu/tegra:/usr/lib/aarch64-linux-gnu/tegra:ro \
  -v /usr/lib/aarch64-linux-gnu/tegra-egl:/usr/lib/aarch64-linux-gnu/tegra-egl:ro \
  -v /usr/lib/aarch64-linux-gnu:/usr/lib/aarch64-linux-gnu:ro \
  -v /usr/local/cuda/lib64:/usr/local/cuda/lib64:ro \
  -v /tmp/.X11-unix:/tmp/.X11-unix:rw \
  -v /data/ds/share:/app/share \
  -v /data/ds/common:/app/common \
  --device /dev/video0:/dev/video0 \
  siridech2/deepstream-usb-dev:20251205-090843 sleep infinity'"
```

## X11 Access
- Grant X11 access to root before starting:
```
ssh jetson "bash -lc 'export DISPLAY=:0; xhost +SI:localuser:root || xhost +local:root || true'"
```

## One-Line Reliable Start
- Run preflight inside the container to validate and start the app:
```
ssh jetson "docker exec -e DISPLAY=:0 \
  -e DS_OUTPUT_MODE=display \
  -e DS_CAM_CAPS=image/jpeg \
  -e DS_CAM_WIDTH=640 \
  -e DS_CAM_HEIGHT=480 \
  -e DS_CAM_FPS=30/1 \
  -e DS_DISABLE_INFER=0 \
  -e DS_SNAPSHOT_PERIOD_MS=1000 \
  -e DS_MQTT_HOST=127.0.0.1 \
  -e DS_MQTT_PORT=1883 \
  -e DS_ROS_HOST=192.168.1.200 \
  -e DS_ROS_PORT=9090 \
  ds_usb_dev sh -lc '/app/share/preflight_and_start.sh >/tmp/preflight_and_start.out 2>&1'"
```

## What Preflight Does
- Validates X11 socket and sets `DISPLAY` and `QT_X11_NO_MITSHM`
- Ensures `LD_LIBRARY_PATH` and `GST_PLUGIN_PATH` for DeepStream 6.0
- Checks MQTT and rosbridge connectivity via inline Python
- Sets `DS_ENABLE_MSG` automatically based on MQTT adapter library presence
- Probes EGL sink and sets `DS_USE_EGL=1` only if validated, otherwise uses X11 (`nv3dsink`)
- Starts the app with `nohup`, logs to `/tmp/ds_usb_dev_app.log`, writes status to `/tmp/preflight.log`

## Quick Verification
- Preflight status:
```
ssh jetson "docker exec ds_usb_dev sh -lc 'tail -n 80 /tmp/preflight.log'"
```
- App logs:
```
ssh jetson "docker exec ds_usb_dev sh -lc 'tail -n 160 /tmp/ds_usb_dev_app.log'"
```
- Process check:
```
ssh jetson "docker exec ds_usb_dev sh -lc 'ps -eo pid,ppid,cmd | sed -n "/deepstream_test_1_usb_ros.py/p"'"
```

## Common Notes
- First start may rebuild TensorRT engine; warnings followed by `Trying to create engine from model files` are expected
- If `ROS_FAIL`, start rosbridge at `DS_ROS_HOST:DS_ROS_PORT` or update envs accordingly
- Keep image naming aligned: timestamp tag for immutability (`YYYYMMDD-HHMMSS`) and `latest` for convenience under `siridech2/deepstream-usb-dev`

