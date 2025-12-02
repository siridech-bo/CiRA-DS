# USB Cam → DeepStream RTSP (No-Auth) — Session Log

## Environment
- SSH alias: `jetson` in `C:\Users\bmwsb\.ssh\config` (`HostName 192.168.1.200`, `User user`, `Port 22`, `StrictHostKeyChecking accept-new`)
- Host ↔ container mapping: host `/data/ds` → container `/app`
- USB app files (host):
  - `D:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py`
  - `D:\CiRA DS app\data\apps\deepstream-test1-usbcam\dstest1_pgie_config.txt`
  - `D:\CiRA DS app\data\apps\common\*` → used by imports

## File Uploads
```powershell
# Ensure write permissions (done by user):
# sudo mkdir -p /data/ds/common
# sudo chown -R user:user /data/ds/share /data/ds/common

scp -F C:\Users\bmwsb\.ssh\config "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py" jetson:/data/ds/share/deepstream_test_1_usb.py
scp -F C:\Users\bmwsb\.ssh\config "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\dstest1_pgie_config.txt" jetson:/data/ds/share/dstest1_pgie_config.txt
scp -r -F C:\Users\bmwsb\.ssh\config "D:\CiRA DS app\data\apps\common" jetson:/data/ds/common
```

## Orchestrator
```powershell
# Start DeepStream orchestrator
Invoke-RestMethod -Method POST -Uri "http://192.168.1.200:3000/api/dspython/start_example" -ContentType "application/json" -Body "{}"

# Validate & run USB app in container
Invoke-RestMethod -Method POST -Uri "http://192.168.1.200:3000/api/mcp/test_python" -ContentType "application/json" -Body '{"path":"/app/share/deepstream_test_1_usb.py","input":"/dev/video0","validate":true}'
Invoke-RestMethod -Method POST -Uri "http://192.168.1.200:3000/api/mcp/test_python" -ContentType "application/json" -Body '{"path":"/app/share/deepstream_test_1_usb.py","input":"/dev/video0","validate":false}'
```

## USB App Edit (HLS attempt)
- Added HLS segment writing to host share (`/app/share/video`) to enable HTTP viewing; later determined segments not created (likely container plugins).
- Reference edits in `deepstream_test_1_usb.py`:
  - `d:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py:188-241` pipeline elements
  - HLS sink config and path: `:218-229`

## No-Auth RTSP (Host-Level)
- Created minimal RTSP server on Jetson host (not container) to avoid auth and X11 requirements.
- Script: `D:\CiRA DS app\data\apps\deepstream-test1-usbcam\rtsp_usb_noauth.py` → uploaded to `/data/ds/share/rtsp_usb_noauth.py`
- Launch:
```powershell
ssh -F C:\Users\bmwsb\.ssh\config jetson "nohup python3 /data/ds/share/rtsp_usb_noauth.py /dev/video0 >/tmp/rtsp_noauth.log 2>&1 & echo $!"
```
- Listening ports verified:
```powershell
ssh -F C:\Users\bmwsb\.ssh\config jetson "ss -tulnp | sed -n '1,200p'"
# Shows LISTEN on *:8555 (no-auth RTSP), and *:8554 (container RTSP)
Test-NetConnection -ComputerName 192.168.1.200 -Port 8555 # True
```
- VLC URL: `rtsp://192.168.1.200:8555/cam`

## VLC Tips
- Media → Open Network Stream → `rtsp://192.168.1.200:8555/cam`
- Preferences → Input/Codecs:
  - Network caching: 1000 ms
  - Enable “Use RTP over RTSP (TCP)” if packet loss

## Observations
- Container RTSP (`8554/ds-test`) requires auth; VLC showed “Unable to open MRL” without credentials.
- Host RTSP server started; logs minimal (`/tmp/rtsp_noauth.log`), port reachable; VLC still reported error — likely RTP mode or pipeline caps mismatch.
- `nvvidconv` and `nvv4l2h264enc` available on Jetson, `nvvideoconvert` not; pipeline uses `videoconvert ! nvvidconv` for NVMM + encoder.

## Next Debug Steps
- Try VLC with TCP: Preferences → Input/Codecs → “RTP over RTSP (TCP)”.
- Reduce encoder bitrate and resolution to 1280x720 and 2 Mbps for stability.
- If needed, switch to container-side `GstRtspServer` with full DeepStream pipeline and public mount `/cam` (no auth), driven via orchestrator.
- Verify USB camera format; add `v4l2src ! video/x-raw,format=YUY2` if required.
- Confirm `/dev/video0` has frames: `ssh jetson "v4l2-ctl --stream-mmap --stream-count=50 --stream-to=/tmp/out.raw"`.

## Reference Code
- USB app OSD and pipeline: `d:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py:36-118`, `:218-261`
- No-auth RTSP script: `d:\CiRA DS app\data\apps\deepstream-test1-usbcam\rtsp_usb_noauth.py:1-29`

## Useful Checks
```powershell
# Confirm files on Jetson
ssh -F C:\Users\bmwsb\.ssh\config jetson "ls -l /data/ds/share; ls -l /data/ds/common"

# Stop no-auth RTSP
ssh -F C:\Users\bmwsb\.ssh\config jetson "pkill -f rtsp_usb_noauth.py"
```

## Summary
- USB app uploaded, dependencies placed, orchestrator start succeeded.
- Container RTSP validated but uses auth (`8554/ds-test`).
- Host no-auth RTSP started (`8555/cam`), port reachable; continue VLC tuning and pipeline adjustments tomorrow.

