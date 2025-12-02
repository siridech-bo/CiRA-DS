#!/bin/bash
set -e
ACTION=${1:-dev-start}
if [ "$ACTION" = "dev-start" ]; then
  export DISPLAY=:0
  xhost +si:localuser:root || xhost +local:root || true
  docker rm -f ds_usb_dev || true
  docker run -d --name ds_usb_dev --runtime nvidia --network host --privileged -e DISPLAY=:0 -e PYTHONPATH=/app:/app/common -e DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt -v /tmp/.X11-unix:/tmp/.X11-unix:rw -v /data/ds/share:/app/share -v /data/ds/common:/app/common --device=/dev/video0 deepstream-usb-dev:6.0.1
fi
if [ "$ACTION" = "dev-run" ]; then
  docker exec ds_usb_dev /usr/bin/env DISPLAY=:0 PYTHONPATH=/app:/app/common DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt python3 /app/share/deepstream_test_1_usb_ros.py /dev/video0
fi
if [ "$ACTION" = "prod-run" ]; then
  export DISPLAY=:0
  xhost +si:localuser:root || xhost +local:root || true
  docker run --rm --runtime nvidia --network host --privileged -e DISPLAY=:0 -e PYTHONPATH=/app:/app/common -e DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt -v /tmp/.X11-unix:/tmp/.X11-unix:rw -v /data/ds/share:/app/share -v /data/ds/common:/app/common --device=/dev/video0 deepstream-usb-dev:6.0.1 python3 /app/share/deepstream_test_1_usb_ros.py /dev/video0
fi
