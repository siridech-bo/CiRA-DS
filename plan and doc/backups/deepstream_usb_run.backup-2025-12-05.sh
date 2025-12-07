#!/bin/bash
set -e
ACTION=${1:-dev-start}
IMG=deepstream-usb-dev:6.0.1
export DISPLAY=${DISPLAY:-:0}
ROS_HOST_DEFAULT=127.0.0.1
ROS_PORT_DEFAULT=9090
DS_ROS_HOST=${DS_ROS_HOST:-$ROS_HOST_DEFAULT}
DS_ROS_PORT=${DS_ROS_PORT:-$ROS_PORT_DEFAULT}
MSG=1
if docker run --rm --network host $IMG bash -lc 'test -f /opt/nvidia/deepstream/deepstream-6.0/lib/libnvds_mqtt_proto.so'; then MSG=1; else MSG=0; fi
if [ "$ACTION" = "dev-start" ]; then
  xhost +si:localuser:root || xhost +local:root || true
  docker rm -f ds_usb_dev || true
  docker run -d --name ds_usb_dev --runtime nvidia --network host --privileged \
    -e DISPLAY=$DISPLAY \
    -e PYTHONPATH=/app:/app/common \
    -e DS_ENABLE_MSG=$MSG \
    -e DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt \
    -e DS_ROS_HOST=$DS_ROS_HOST \
    -e DS_ROS_PORT=$DS_ROS_PORT \
    -v /tmp/.X11-unix:/tmp/.X11-unix:rw \
    -v /data/ds/share:/app/share \
    -v /data/ds/common:/app/common \
    -v /data/ds/datasets:/data/ds/datasets \
    --device=/dev/video0 \
    $IMG
fi
if [ "$ACTION" = "dev-run" ]; then
  docker exec ds_usb_dev /usr/bin/env DISPLAY=$DISPLAY PYTHONPATH=/app:/app/common DS_ENABLE_MSG=$MSG DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt DS_ROS_HOST=$DS_ROS_HOST DS_ROS_PORT=$DS_ROS_PORT python3 /app/share/deepstream_test_1_usb_ros.py /dev/video0
fi
if [ "$ACTION" = "prod-run" ]; then
  xhost +si:localuser:root || xhost +local:root || true
  docker run --rm --runtime nvidia --network host --privileged \
    -e DISPLAY=$DISPLAY \
    -e PYTHONPATH=/app:/app/common \
    -e DS_ENABLE_MSG=$MSG \
    -e DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt \
    -e DS_ROS_HOST=$DS_ROS_HOST \
    -e DS_ROS_PORT=$DS_ROS_PORT \
    -v /tmp/.X11-unix:/tmp/.X11-unix:rw \
    -v /data/ds/share:/app/share \
    -v /data/ds/common:/app/common \
    -v /data/ds/datasets:/data/ds/datasets \
    --device=/dev/video0 \
    $IMG python3 /app/share/deepstream_test_1_usb_ros.py /dev/video0
fi
