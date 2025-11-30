# MCP JSON — LLM IDE Quick Reference

## Gateway Endpoint
- MCP HTTP: `http://<jetson-host>:3001/mcp`
- Jetson Web App Base: `http://<jetson-host>:3000`

## Tools and JSON Requests
- upload_file
```
{
  "path": "/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py",
  "content": "<python source as string>",
  "sha256": "<optional sha256 hex>",
  "mode": "0644"
}
```

- validate_python
```
{
  "path": "/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py"
}
```

- test_python
```
{
  "path": "/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py",
  "validate": true,
  "input": "/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264",
  "codec": "H264"
}
```

- tail_logs
```
{
  "tail": 600
}
```

- stop_python
```
{
  "path": "/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/deepstream-test1-rtsp-out/deepstream_test1_rtsp_out.py"
}
```

## Typical Flow
1. `upload_file` (optional if file already exists)
2. `validate_python`
3. `test_python` (returns RTSP URL)
4. `tail_logs` to view runtime output

## RTSP URL
- `rtsp://<jetson-host>:8554/ds-test`
- Use TCP transport in clients when needed: `-rtsp_transport tcp`

## Canonical Pipeline Spec (Preview)
- Use this high-level JSON to render DeepStream INI configs (future agent):
```
{
  "version": 1,
  "sources": [
    { "type": "file", "uri": "/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264", "codec": "H264" }
  ],
  "inference": {
    "primary": {
      "model": "peoplenet",
      "precision": "fp16",
      "config": "/data/weight_config/peoplenet_primary.txt"
    }
  },
  "tracking": { "type": "nvtracker", "config": "/data/weight_config/tracker_config.yml" },
  "osd": { "bbox": true, "text": true },
  "sinks": [
    { "type": "rtsp", "name": "ds-test", "port": 8554, "codec": "H264", "bitrate": 4000000 }
  ]
}
```

## FFmpeg Interop (Examples)
- Publish test source to RTSP:
```
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -c:v libx264 -tune zerolatency -f rtsp -rtsp_transport tcp rtsp://<jetson-host>:8554/ds-test
```
- Play RTSP:
```
ffplay -rtsp_transport tcp rtsp://<jetson-host>:8554/ds-test
```
- HLS from UDP MPEG‑TS (browser):
```
ffmpeg -i udp://127.0.0.1:5600 -fflags nobuffer -flags low_delay -tune zerolatency -codec copy -hls_time 1 -hls_list_size 4 -hls_delete_threshold 1 -hls_flags delete_segments+append_list -y /app/public/video/out.m3u8
```

## LLM IDE Setup (MCP)
- Endpoint: `http://<jetson-host>:3001/mcp` (HTTP POST)
- Health check (optional): `http://<jetson-host>:3001/health`
- Tools available via MCP:
  - `upload_file`, `validate_python`, `test_python`, `tail_logs`, `stop_python`
- Minimal provider config (example shape; adapt to your IDE):
```
{
  "mcp": {
    "providers": [
      {
        "name": "CiRA SPACE",
        "type": "http",
        "endpoint": "http://<jetson-host>:3001/mcp"
      }
    ]
  }
}
```
- Quick test flow from IDE:
  - Call `validate_python` with the container path
  - Call `test_python` with `validate=true`, `input` sample, and `codec`
  - Call `tail_logs` to fetch recent lines
  - Open `rtsp://<jetson-host>:8554/ds-test` in your player (use `-rtsp_transport tcp` if needed)
