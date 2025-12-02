# Plan — ROS1 Integration with DeepStream USB (Jetson, X11)

## Objectives
- Use ROS1 Melodic as transport for DeepStream outputs and control.
- Publish detections and OSD preview to ROS topics.
- Implement controllable snapshots that save both clean and overlay images paired with metadata.

## Architecture
- DeepStream pipeline handles camera, inference, OSD, and display.
- ROS publishers/subscribers embedded in the Python app.
- Branch the pipeline with tees:
  - Pre‑OSD branch for clean JPEG snapshots.
  - Post‑OSD branch for JPEG snapshots and ROS preview images.

## Pipeline Changes
- Insert `tee` before and after `nvdsosd`.
- Clean branch: `nvvideoconvert -> caps(video/x-raw,format=BGR) -> jpegenc -> appsink`.
- OSD branch: `nvvideoconvert -> caps(video/x-raw,format=BGR) -> jpegenc -> appsink` and GPU sink remains.
- Keep RGBA caps before OSD: `video/x-raw(memory:NVMM), format=RGBA`.
- Maintain `nvstreammux live-source=1`, `batch-size=1`, and `get_request_pad("sink_0")`.
- References:
  - RGBA caps, OSD, sink chain: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:220-247, 292-296`
  - Pad request/link: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:285-291`

## ROS Interfaces
- Publishers:
  - `/deepstream/detections_json` (`std_msgs/String`) — per‑frame JSON `{frame, detections}`.
  - `/deepstream/image_osd/compressed` (`sensor_msgs/CompressedImage`) — JPEG preview at reduced FPS.
- Subscribers:
  - `/deepstream/snapshot/start` (`std_msgs/Empty`) — enable periodic snapshots.
  - `/deepstream/snapshot/stop` (`std_msgs/Empty`) — disable periodic snapshots.
  - `/deepstream/snapshot/period_ms` (`std_msgs/Int32`) — set snapshot interval in milliseconds.

## Snapshots & Metadata
- Save both:
  - Clean image (pre‑OSD) → `..._clean.jpg`.
  - OSD image (post‑OSD) → `..._osd.jpg`.
- Metadata per frame → `..._meta.json` with:
  - `image`: basename, width/height, timestamp, frame number.
  - `annotations`: array of `{bbox:[x,y,w,h], category_id, score}`.
  - `categories`: mapping `{0:'vehicle',1:'bicycle',2:'person',3:'roadsign'}`.
- Use DeepStream `frame_meta.frame_num` and buffer timestamp for sync.
- File naming: `device-frameNum-pts_{clean|osd|meta}.ext` under `/data/ds/datasets/<project>/YYYY/MM/DD/HH/`.

## Throttling & Performance
- ROS preview: throttle to 3–10 FPS using `videorate` or probe‑level throttling.
- Snapshots: typical 0.2–2 Hz; controlled via ROS topic.
- Prefer `nvjpegenc` when available; `jpegenc` acceptable at low rates.
- Avoid heavy work in probes; publish/write from worker thread/queue.
- Bounded queues; drop/coalesce when overloaded.

## Runtime & Ops
- Image: `deepstream-usb-dev:6.0.1` with GI installed, persistent CMD.
- Start dev container and run the app with `scripts/deepstream_usb_run.sh`.
- X11: `DISPLAY=:0`, `xhost +si:localuser:root`, mount `/tmp/.X11-unix`.
- ROS core: run `roscore` on Jetson; app initializes `rospy` node.

## Validation Checklist
- X11 window renders video with OSD at full rate.
- `/deepstream/detections_json` publishes JSON detections.
- `/deepstream/image_osd/compressed` publishes JPEG frames at reduced FPS.
- Snapshot control:
  - Start/stop via ROS topics; images and metadata saved in pairs.
  - Files written atomically; timestamps/frame numbers align with detections.

## Next Steps
- Implement publishers/subscribers and appsink callbacks in the app.
- Add throttling caps or timers and configurable snapshot settings.
- Test end‑to‑end on Jetson; measure CPU, disk, and ROS bandwidth.

