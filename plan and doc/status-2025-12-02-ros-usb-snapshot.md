# ROS DeepStream USB Snapshot Status — 2025-12-02

## Status Overview

- ROS-enabled app: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py`
- Run script targets ROS app for dev/prod execution: `scripts/deepstream_usb_run.sh`
- Fixed detection publish scoping and snapshot pairing to ensure clean+OSD images and single metadata per snapshot base
- PGIE config resolved via env `DS_PGIE_CONFIG`, falls back to DeepStream sample or local `dstest1_pgie_config.txt`

## Configuration

- ROS bridge: `localhost:9090` (start with `roslaunch rosbridge_server rosbridge_websocket.launch`)
- USB source device: pass v4l2 path (e.g., `/dev/video0`) via run script
- Display sink: `nveglglessink` on dGPU, `nv3dsink` preferred on Jetson; `sync=false`, `qos=0`

## ROS Topics

- Publish detections: `/deepstream/detections_json` (`std_msgs/String` JSON: `{frame, detections[]}`)
- Publish JPEG base64 snapshots: `/deepstream/image_osd_jpeg_b64` (`std_msgs/String` JSON: `{stamp, kind, data_b64}`)
- Snapshot control:
  - Start: `/deepstream/snapshot/start` (`std_msgs/Empty`)
  - Stop: `/deepstream/snapshot/stop` (`std_msgs/Empty`)
  - Period (ms): `/deepstream/snapshot/period_ms` (`std_msgs/Int32`)

## Pipeline Branching

- Pre‑OSD clean branch: `tee_presave → nvvideoconvert → caps(BGR) → jpegenc → appsink`
- Post‑OSD branch: `nvosd → tee_postosd → nvvideoconvert → caps(BGR) → jpegenc → appsink`
- Display path: `tee_postosd → nveglglessink`

## Snapshot Behavior

- Interval controlled via ROS (`period_ms`); 0 disables
- Each trigger opens a 500 ms pairing window to collect both `clean` and `osd` JPEGs
- Metadata written once per base (`*_meta.json`), images saved atomically (`*_clean.jpg`, `*_osd.jpg`)
- Save directory: `/data/ds/datasets/autocap`

## Run and Test (20s interval for 60s window)

```bash
# Start dev container
./scripts/deepstream_usb_run.sh dev-start

# Run the app
./scripts/deepstream_usb_run.sh dev-run

# Configure snapshots (20 seconds)
rostopic pub /deepstream/snapshot/period_ms std_msgs/Int32 "data: 20000" -1
rostopic pub /deepstream/snapshot/start std_msgs/Empty -1

# Wait ~60 seconds, then stop
rostopic pub /deepstream/snapshot/stop std_msgs/Empty -1
```

## Validation

```bash
# Expect ~3 snapshots (bases)
ls /data/ds/datasets/autocap/*_meta.json | wc -l
ls /data/ds/datasets/autocap/*_clean.jpg | wc -l
ls /data/ds/datasets/autocap/*_osd.jpg | wc -l

# Per-base completeness
cd /data/ds/datasets/autocap
for b in $(ls *_meta.json | sed 's/_meta.json//'); do
  test -f "${b}_clean.jpg" && test -f "${b}_osd.jpg" || echo "missing: ${b}"
done

# Detect zero-size images
find /data/ds/datasets/autocap -name "*.jpg" -size 0 -print

# Inspect latest metadata
python3 - <<'PY'
import glob, json, os
files = sorted(glob.glob('/data/ds/datasets/autocap/*_meta.json'), key=os.path.getmtime)
print(json.dumps(json.load(open(files[-1],'r')), indent=2))
PY
```

## Code References

- Detection publish: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:70-79`
- Snapshot pairing window and saves: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:375-399`
- Atomic write helper: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:203-209`
- PGIE config resolution: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:286-289`
- Run script entries: `scripts/deepstream_usb_run.sh:11`, `scripts/deepstream_usb_run.sh:16`

