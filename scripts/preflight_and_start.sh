#!/bin/sh
LOG=/tmp/preflight.log
echo "START $(date +%F-%T)" > "$LOG"
export DISPLAY=${DISPLAY:-:0}
export QT_X11_NO_MITSHM=${QT_X11_NO_MITSHM:-1}
export DS_USE_EGL=${DS_USE_EGL:-0}
export PYTHONPATH=${PYTHONPATH:-/app:/app/common}
export LD_LIBRARY_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib:${LD_LIBRARY_PATH}
export GST_PLUGIN_PATH=/opt/nvidia/deepstream/deepstream-6.0/lib/gst-plugins:${GST_PLUGIN_PATH}
export DS_OUTPUT_MODE=${DS_OUTPUT_MODE:-display}
export DS_CAM_CAPS=${DS_CAM_CAPS:-image/jpeg}
export DS_CAM_WIDTH=${DS_CAM_WIDTH:-640}
export DS_CAM_HEIGHT=${DS_CAM_HEIGHT:-480}
export DS_CAM_FPS=${DS_CAM_FPS:-30/1}
export DS_DISABLE_INFER=${DS_DISABLE_INFER:-0}
export DS_SNAPSHOT_PERIOD_MS=${DS_SNAPSHOT_PERIOD_MS:-1000}
export DS_MQTT_HOST=${DS_MQTT_HOST:-127.0.0.1}
export DS_MQTT_PORT=${DS_MQTT_PORT:-1883}
export DS_ROS_HOST=${DS_ROS_HOST:-127.0.0.1}
export DS_ROS_PORT=${DS_ROS_PORT:-9090}
MSG=1
if [ ! -f /opt/nvidia/deepstream/deepstream-6.0/lib/libnvds_mqtt_proto.so ]; then MSG=0; fi
export DS_ENABLE_MSG=${DS_ENABLE_MSG:-$MSG}
if [ -S /tmp/.X11-unix/X0 ]; then echo "X11_OK" >> "$LOG"; else echo "X11_FAIL" >> "$LOG"; fi
EGL_TRY=0
if [ "$DS_OUTPUT_MODE" = "display" ]; then
  if command -v gst-inspect-1.0 >/dev/null 2>&1 && gst-inspect-1.0 nveglglessink >/dev/null 2>&1; then
    if command -v gst-launch-1.0 >/dev/null 2>&1; then
      gst-launch-1.0 -q videotestsrc num-buffers=1 ! nveglglessink sync=false >/dev/null 2>&1 && EGL_TRY=1
    else
      EGL_TRY=1
    fi
  fi
fi
if [ "$EGL_TRY" = "1" ]; then export DS_USE_EGL=1; echo "EGL_OK" >> "$LOG"; else echo "EGL_SKIP" >> "$LOG"; fi
python3 - "$DS_MQTT_HOST" "$DS_MQTT_PORT" "$DS_ROS_HOST" "$DS_ROS_PORT" >> "$LOG" 2>&1 << 'PY'
import sys, socket
def check(host, port, name):
  s=socket.socket(); s.settimeout(1.5)
  try:
    s.connect((host, int(port))); print(name+"_OK")
  except Exception as e:
    print(name+"_FAIL:"+str(e))
  finally:
    try: s.close()
    except: pass
check(sys.argv[1], sys.argv[2], "MQTT")
check(sys.argv[3], sys.argv[4], "ROS")
PY
nohup python3 /app/share/deepstream_test_1_usb_ros.py /dev/video0 > /tmp/ds_usb_dev_app.log 2>&1 &
echo "OK" >> "$LOG"
echo OK
