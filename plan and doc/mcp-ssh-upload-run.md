# MCP SSH Upload and Run (Jetson DeepStream USB Cam)

## Summary
- Use SSH/SCP to place app files on Jetson host share, mapped into the container at `/app/share`.
- Start the DeepStream Python orchestrator and run the script via MCP.
- Avoid HTTP upload limits and encoding issues by copying files verbatim over SSH.

## Shared Paths
- Host: `/data/ds/share` → Container: `/app/share`
- Host: `/data/hls` → Container: `/app/public/video`
- Host: `/app/configs` → Container: `/app/configs`
- Host: `/data/ds/configs` → Container: `/data/ds/configs`

## Files To Upload
- `D:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py` → `/data/ds/share/deepstream_test_2.py`
- `D:\CiRA DS app\data\apps\deepstream-test1-usbcam\dstest1_pgie_config.txt` → `/data/ds/share/dstest1_pgie_config.txt`
- `D:\CiRA DS app\data\apps\common\platform_info.py` → `/data/ds/share/common/platform_info.py`
- `D:\CiRA DS app\data\apps\common\bus_call.py` → `/data/ds/share/common/bus_call.py`

## Windows OpenSSH SCP (recommended)
- Credentials: `user@192.168.1.200`, port `22`
- Commands:
```
scp -P 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py" \
  user@192.168.1.200:/data/ds/share/deepstream_test_2.py

scp -P 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\dstest1_pgie_config.txt" \
  user@192.168.1.200:/data/ds/share/dstest1_pgie_config.txt

scp -P 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "D:\CiRA DS app\data\apps\common\platform_info.py" \
  user@192.168.1.200:/data/ds/share/common/platform_info.py

scp -P 22 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "D:\CiRA DS app\data\apps\common\bus_call.py" \
  user@192.168.1.200:/data/ds/share/common/bus_call.py
```

## PuTTY PSCP (alternative)
```
pscp.exe -P 22 -batch -pw aaaa \
  "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py" \
  user@192.168.1.200:/data/ds/share/deepstream_test_2.py

pscp.exe -P 22 -batch -pw aaaa \
  "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\dstest1_pgie_config.txt" \
  user@192.168.1.200:/data/ds/share/dstest1_pgie_config.txt

pscp.exe -P 22 -batch -pw aaaa \
  "D:\CiRA DS app\data\apps\common\platform_info.py" \
  user@192.168.1.200:/data/ds/share/common/platform_info.py

pscp.exe -P 22 -batch -pw aaaa \
  "D:\CiRA DS app\data\apps\common\bus_call.py" \
  user@192.168.1.200:/data/ds/share/common/bus_call.py
```

## Start Orchestrator (MCP)
```
curl -X POST "http://192.168.1.200:3000/api/dspython/start_example" \
  -H "Content-Type: application/json" -d "{}"
```

## Run App (MCP)
```
curl -X POST "http://192.168.1.200:3000/api/mcp/test_python" \
  -H "Content-Type: application/json" \
  -d '{
        "path": "/app/share/deepstream_test_2.py",
        "input": "/dev/video0",
        "validate": true
      }'
```

## Monitor Logs
```
curl -X GET "http://192.168.1.200:3000/api/mcp/tail_logs?tail=600"
```

## Stop App
```
curl -X POST "http://192.168.1.200:3000/api/mcp/stop_python" \
  -H "Content-Type: application/json" \
  -d '{ "path": "/app/share/deepstream_test_2.py" }'
```

## Notes
- Keep file encoding as UTF-8 and LF line endings; SCP preserves contents verbatim.
- The name `deepstream_test_2.py` lets MCP auto-pass the `/dev/video0` argument.
- Display renders on Jetson Desktop via `nv3dsink` or `nveglglessink` depending on availability.
