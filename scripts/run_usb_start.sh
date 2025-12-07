#!/bin/sh
export DISPLAY=${DISPLAY:-:0}
export QT_X11_NO_MITSHM=1
export PYTHONPATH=/app:/app/common
export LD_LIBRARY_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib:${LD_LIBRARY_PATH}
export GST_PLUGIN_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/gst-plugins:${GST_PLUGIN_PATH}
export DS_OUTPUT_MODE=${DS_OUTPUT_MODE:-display}
export DS_CAM_CAPS=${DS_CAM_CAPS:-image/jpeg}
export DS_CAM_WIDTH=${DS_CAM_WIDTH:-640}
export DS_CAM_HEIGHT=${DS_CAM_HEIGHT:-480}
export DS_CAM_FPS=${DS_CAM_FPS:-30/1}
export DS_DISABLE_INFER=${DS_DISABLE_INFER:-0}
export DS_ENABLE_MSG=${DS_ENABLE_MSG:-1}
export DS_SNAPSHOT_PERIOD_MS=${DS_SNAPSHOT_PERIOD_MS:-1000}
export DS_MQTT_HOST=${DS_MQTT_HOST:-127.0.0.1}
export DS_MQTT_PORT=${DS_MQTT_PORT:-1883}
export DS_ROS_HOST=${DS_ROS_HOST:-192.168.1.200}
export DS_ROS_PORT=${DS_ROS_PORT:-9090}
nohup python3 /app/share/deepstream_test_1_usb_ros.py /dev/video0 > /tmp/ds_usb_dev_app.log 2>&1 &
echo OK
