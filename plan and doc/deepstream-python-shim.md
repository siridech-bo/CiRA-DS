# DeepStream Python RTSP-out with pyds_ext Shim (Jetson)

## Overview
- Keep one stable DeepStream image.
- Mount your local `deepstream_python_apps` into the `ds_python` container.
- Mount your `pyds_ext` shim into the container.
- Alias `import pyds` to `pyds_ext` at runtime; do not install `pyds`.
- Edit Python locally and re‑run inside the container; no image rebuilds.

## Prerequisites
- Stable image: `siridech2/deepstream-l4t:pyds-dev`.
- Jetson host directories: `/data/ds/apps`, `/data/videos`.
- VLC on your laptop to view `rtsp://<jetson-ip>:8554/ds-test`.

## Step 1 — Prepare host repos
- Create persistent directories:
  - `sudo mkdir -p /data/ds/apps /data/videos`
  - `sudo chown -R $USER:$USER /data/ds/apps /data/videos`
- Clone DeepStream Python apps:
  - `git clone https://github.com/NVIDIA-AI-IOT/deepstream_python_apps.git /data/ds/apps/deepstream_python_apps`
- Place your shim:
  - Ensure `pyds_ext` exists at `/data/ds/apps/pyds_ext`.
- Verify sample exists:
  - `/data/ds/apps/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py`

## Step 2 — Bind mounts in backend
- The backend creates `ds_python` with fixed binds in `jetson-web/server.js:757`.
- DeepStream root is discovered in `jetson-web/server.js:718`.
- Add binds:
  - Host → Container
    - `/data/ds/apps/deepstream_python_apps` → `$DS_ROOT/sources/deepstream_python_apps`
    - `/data/ds/apps/pyds_ext` → `/workspace/pyds_ext`
- Example bind entry:
  - `"/data/ds/apps/deepstream_python_apps:/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps"`

## Step 3 — Start backend without auto‑clone
- Start using mounted repos (no clone/build):
  - `POST /api/dspython/start` body: `{"install":false,"useGit":false}`
- Alternative CLI (manual run, no backend):
  - `sudo docker rm -f ds_python`
  - `sudo docker run -d --name ds_python --network host --gpus all \
    -v /data/videos:/data/videos \
    -v /data/ds/apps/deepstream_python_apps:/workspace/deepstream_python_apps \
    -v /data/ds/apps/pyds_ext:/workspace/pyds_ext \
    siridech2/deepstream-l4t:pyds-dev tail -f /dev/null`

## Step 4 — Alias pyds → pyds_ext
- Enter the container:
  - `sudo docker exec -it ds_python bash`
- Create runtime alias and expose path:
  - `ln -s /workspace/pyds_ext /workspace/pyds`
  - `export PYTHONPATH=/workspace:$PYTHONPATH`
- Ensure `pyds` is not installed:
  - `python3 -m pip uninstall -y pyds || true`
- Quick import test:
  - `python3 -c "import gi; gi.require_version('Gst','1.0'); from gi.repository import Gst; Gst.init(None); import pyds; print('PYDS_SHIM_OK')"`

## Step 5 — Run the RTSP-out sample
- Use mounted apps:
  - `cd $DS_ROOT/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out`
- Stop previous run:
  - `pkill -f deepstream_test1_rtsp_out.py || true`
- Run from a local file:
  - `python3 deepstream_test1_rtsp_out.py "file:///data/videos/Bird.mp4"`
- Play in VLC:
  - `rtsp://<jetson-ip>:8554/ds-test`
  - If stutter, use RTP over TCP and set network caching to 1000–2000 ms.

## Step 6 — Iterate quickly
- Edit on host:
  - `/data/ds/apps/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py`
- Re‑run inside container:
  - `python3 deepstream_test1_rtsp_out.py "file:///data/videos/Bird.mp4"`
- No image rebuilds or reinstall for pure Python edits.

## One‑shot alias alternative
- Run without symlink, inline alias:
  - `python3 - <<'PY'\nimport sys, importlib, runpy\nsys.modules['pyds']=importlib.import_module('pyds_ext')\nrunpy.run_path('deepstream_test1_rtsp_out.py', run_name='__main__')\nPY`
- Ensure `PYTHONPATH=/workspace` if `pyds_ext` is mounted under `/workspace/pyds_ext`.

## Checks and tips
- RTSP server listening:
  - `ss -tunlp | grep 8554` or `netstat -tunlp | grep 8554`
- Avoid port conflicts:
  - Stop other RTSP services using port `8554`.
- DeepStream/GStreamer presence:
  - `gst-inspect-1.0 nvds_rtsp_bin` should list RTSP components.
- Sample expects `rtsp://` or `file:///` inputs, not HLS playlists.

## Notes
- Upstream `deepstream_python_apps` bindings currently target newer Python (e.g., `>=3.12`). On Jetson with Python 3.6, use `pyds_ext` and do not install `pyds`.

## Verified Quickstart (Working Setup)
- Prepare host repos:
  - `sudo mkdir -p /data/ds/apps /data/videos`
  - `sudo chown -R $USER:$USER /data/ds/apps /data/videos`
  - `git clone https://github.com/NVIDIA-AI-IOT/deepstream_python_apps.git /data/ds/apps/deepstream_python_apps`
  - `test -d /data/ds/apps/pyds_ext || echo "Place your pyds_ext at /data/ds/apps/pyds_ext"`
- Start container (mount under DeepStream ROOT for sample-relative paths):
  - `sudo docker rm -f ds_python || true`
  - `sudo docker run -d --name ds_python --network host --runtime nvidia \
    -v /data/videos:/data/videos \
    -v /data/ds/apps/deepstream_python_apps:/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps \
    -v /data/ds/apps/pyds_ext:/workspace/pyds_ext \
    siridech2/deepstream-l4t:pyds-dev`
- Alias `pyds` → `pyds_ext` and expose path:
  - `sudo docker exec -it ds_python bash`
  - `ln -s /workspace/pyds_ext /workspace/pyds`
  - `export PYTHONPATH=/workspace:$PYTHONPATH`
  - `python3 -m pip uninstall -y pyds || true`
  - `python3 -c "import gi; gi.require_version('Gst','1.0'); from gi.repository import Gst; Gst.init(None); import pyds; print('PYDS_SHIM_OK')"`
- Run RTSP-out sample and force engine rebuild:
  - `cd /opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out`
  - `rm -f ../../../../samples/models/Primary_Detector/*.engine`
  - `python3 deepstream_test1_rtsp_out.py -i /opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264 -c H264`
- Play in VLC:
  - `rtsp://<jetson-ip>:8554/ds-test`
- Iterate:
  - Edit: `/data/ds/apps/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py`
  - Re-run in container: `sudo docker exec -it ds_python bash -lc 'export PYTHONPATH=/workspace:$PYTHONPATH; cd /opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out; python3 deepstream_test1_rtsp_out.py -i /opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264 -c H264'`

## Current Status
- Working: `python3 deepstream_test1_rtsp_out.py -i /opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264 -c H264` streams to `rtsp://<jetson-ip>:8554/ds-test`.
- Pending: `/data/videos/Bird.mp4` input still fails; will debug later. No further changes implemented.