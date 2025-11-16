# DeepStream Web Application Development Guide

## Overview

Develop a web application on your PC to control DeepStream running in Docker on Jetson Nano via REST API.

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────┐
│   Development PC        │         │   Jetson Nano            │
│                         │         │                          │
│  ┌──────────────────┐   │         │  ┌────────────────────┐  │
│  │  Web Frontend    │   │  HTTP   │  │  DeepStream Docker │  │
│  │  (React/HTML)    │───┼────────→│  │                    │  │
│  │  localhost:3000  │   │         │  │  REST API :8080    │  │
│  └──────────────────┘   │         │  │  RTSP Out :8554    │  │
│                         │         │  └────────────────────┘  │
│  ┌──────────────────┐   │         │                          │
│  │  Backend         │   │         │                          │
│  │  (Flask/Node.js) │───┼────────→│                          │
│  │  localhost:5000  │   │ Optional│                          │
│  └──────────────────┘   │         │                          │
└─────────────────────────┘         └──────────────────────────┘
```

## Network Configuration

### 1. Jetson Nano Setup

#### Find Jetson IP Address
```bash
# On Jetson Nano
ifconfig
# or
ip addr show
# Look for: 192.168.1.100 (example)
```

#### Start DeepStream Docker with Network Access
```bash
# Option 1: Host networking (simplest)
docker run -it --rm \
  --net=host \
  --runtime nvidia \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -e DISPLAY=$DISPLAY \
  nvcr.io/nvidia/deepstream:7.0-samples

# Option 2: Port mapping
docker run -it --rm \
  -p 8080:8080 \
  -p 8554:8554 \
  --runtime nvidia \
  nvcr.io/nvidia/deepstream:7.0-samples
```

#### Start DeepStream Server App
```bash
# Inside Docker container
cd /opt/nvidia/deepstream/deepstream/sources/apps/sample_apps/deepstream-server
./deepstream-server-app -c <config-file>
```

### 2. Development PC Setup

#### Environment Variables
```bash
# Create .env file
JETSON_IP=192.168.1.100
DEEPSTREAM_API_PORT=8080
RTSP_PORT=8554
```

## Communication Options

### Option 1: Direct Frontend → DeepStream (Simple)

**Pros:** Simple, no middleware needed  
**Cons:** CORS issues, no backend logic  

```javascript
// config.js
const JETSON_IP = '192.168.1.100';
const API_BASE_URL = `http://${JETSON_IP}:8080`;

export { API_BASE_URL };
```

### Option 2: Frontend → Backend → DeepStream (Recommended)

**Pros:** Handles CORS, add authentication, logging  
**Cons:** Additional layer to maintain  

```
Frontend (Port 3000) → Backend (Port 5000) → DeepStream (Jetson:8080)
```

## DeepStream REST API Endpoints

### Base URL
```
http://<JETSON_IP>:8080/api/v1
```

### Available Endpoints

#### Stream Management
```http
# Add Stream
POST /api/v1/stream
Content-Type: application/json

{
  "stream_id": "stream_0",
  "uri": "rtsp://camera-ip/stream",
  "source_id": 0,
  "batch_size": 1
}

# Remove Stream
DELETE /api/v1/stream/{stream_id}

# Update Stream
PUT /api/v1/stream/{stream_id}
```

#### Inference Configuration
```http
# Update Inference Settings
PUT /api/v1/infer
Content-Type: application/json

{
  "infer_name": "primary-detector",
  "batch_size": 4,
  "interval": 1,
  "gpu_id": 0
}
```

#### ROI (Region of Interest)
```http
# Add/Update ROI
POST /api/v1/roi
Content-Type: application/json

{
  "stream_id": "stream_0",
  "roi_id": "roi_0",
  "left": 100,
  "top": 100,
  "width": 500,
  "height": 400
}
```

#### Decoder Settings
```http
# Update Decoder
PUT /api/v1/dec
Content-Type: application/json

{
  "stream_id": "stream_0",
  "drop_frame_interval": 0,
  "skip_frames": 0
}
```

## Implementation Examples

### Frontend (React/JavaScript)

#### API Service (api.js)
```javascript
const API_BASE_URL = 'http://192.168.1.100:8080/api/v1';

class DeepStreamAPI {
  async addStream(streamConfig) {
    const response = await fetch(`${API_BASE_URL}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(streamConfig)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  }

  async removeStream(streamId) {
    const response = await fetch(`${API_BASE_URL}/stream/${streamId}`, {
      method: 'DELETE'
    });
    return await response.json();
  }

  async updateInference(inferConfig) {
    const response = await fetch(`${API_BASE_URL}/infer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inferConfig)
    });
    return await response.json();
  }

  async addROI(roiConfig) {
    const response = await fetch(`${API_BASE_URL}/roi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roiConfig)
    });
    return await response.json();
  }
}

export default new DeepStreamAPI();
```

#### React Component Example
```jsx
import React, { useState } from 'react';
import DeepStreamAPI from './api';

function StreamControl() {
  const [streamUri, setStreamUri] = useState('');
  const [status, setStatus] = useState('');

  const handleAddStream = async () => {
    try {
      const config = {
        stream_id: "stream_0",
        uri: streamUri,
        source_id: 0
      };
      
      const result = await DeepStreamAPI.addStream(config);
      setStatus(`Success: ${JSON.stringify(result)}`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleRemoveStream = async () => {
    try {
      await DeepStreamAPI.removeStream("stream_0");
      setStatus('Stream removed successfully');
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div>
      <h2>DeepStream Control</h2>
      <input 
        type="text" 
        value={streamUri} 
        onChange={(e) => setStreamUri(e.target.value)}
        placeholder="rtsp://camera-ip/stream"
      />
      <button onClick={handleAddStream}>Add Stream</button>
      <button onClick={handleRemoveStream}>Remove Stream</button>
      <div>Status: {status}</div>
    </div>
  );
}

export default StreamControl;
```

### Backend (Python Flask)

#### app.py
```python
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for development

# Configuration
JETSON_IP = os.getenv('JETSON_IP', '192.168.1.100')
DEEPSTREAM_API = f"http://{JETSON_IP}:8080/api/v1"

# Stream Management
@app.route('/api/stream', methods=['POST'])
def add_stream():
    try:
        response = requests.post(
            f"{DEEPSTREAM_API}/stream",
            json=request.json,
            timeout=5
        )
        return jsonify(response.json()), response.status_code
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stream/<stream_id>', methods=['DELETE'])
def remove_stream(stream_id):
    try:
        response = requests.delete(
            f"{DEEPSTREAM_API}/stream/{stream_id}",
            timeout=5
        )
        return jsonify(response.json()), response.status_code
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 500

# Inference Management
@app.route('/api/infer', methods=['PUT'])
def update_inference():
    try:
        response = requests.put(
            f"{DEEPSTREAM_API}/infer",
            json=request.json,
            timeout=5
        )
        return jsonify(response.json()), response.status_code
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 500

# ROI Management
@app.route('/api/roi', methods=['POST'])
def add_roi():
    try:
        response = requests.post(
            f"{DEEPSTREAM_API}/roi",
            json=request.json,
            timeout=5
        )
        return jsonify(response.json()), response.status_code
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 500

# Health Check
@app.route('/api/health', methods=['GET'])
def health_check():
    try:
        response = requests.get(f"{DEEPSTREAM_API}/health", timeout=5)
        return jsonify({
            'status': 'connected',
            'deepstream': response.json()
        })
    except:
        return jsonify({
            'status': 'disconnected',
            'error': 'Cannot reach DeepStream'
        }), 503

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
```

#### requirements.txt
```
Flask==3.0.0
flask-cors==4.0.0
requests==2.31.0
python-dotenv==1.0.0
```

### Backend (Node.js/Express)

#### server.js
```javascript
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JETSON_IP = process.env.JETSON_IP || '192.168.1.100';
const DEEPSTREAM_API = `http://${JETSON_IP}:8080/api/v1`;

app.use(cors());
app.use(express.json());

// Stream Management
app.post('/api/stream', async (req, res) => {
  try {
    const response = await axios.post(`${DEEPSTREAM_API}/stream`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/stream/:streamId', async (req, res) => {
  try {
    const response = await axios.delete(
      `${DEEPSTREAM_API}/stream/${req.params.streamId}`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Inference Management
app.put('/api/infer', async (req, res) => {
  try {
    const response = await axios.put(`${DEEPSTREAM_API}/infer`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ROI Management
app.post('/api/roi', async (req, res) => {
  try {
    const response = await axios.post(`${DEEPSTREAM_API}/roi`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const response = await axios.get(`${DEEPSTREAM_API}/health`);
    res.json({ status: 'connected', deepstream: response.data });
  } catch (error) {
    res.status(503).json({ 
      status: 'disconnected', 
      error: 'Cannot reach DeepStream' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`DeepStream API: ${DEEPSTREAM_API}`);
});
```

#### package.json
```json
{
  "name": "deepstream-backend",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1"
  }
}
```

## Handling CORS Issues

### Option 1: Backend Proxy (Recommended)
Use the Flask or Node.js backend examples above - they handle CORS automatically.

### Option 2: Chrome with CORS Disabled (Dev Only)
```bash
# Windows
chrome.exe --disable-web-security --user-data-dir="C:/tmp/chrome_dev"

# Mac
open -a Google\ Chrome --args --disable-web-security --user-data-dir="/tmp/chrome_dev"

# Linux
google-chrome --disable-web-security --user-data-dir="/tmp/chrome_dev"
```

### Option 3: Modify DeepStream REST Server
Edit the source code in:
```
/opt/nvidia/deepstream/deepstream/sources/libs/nvds_rest_server/nvds_rest_server.cpp
```

Add CORS headers to responses.

## Video Streaming

### RTSP Stream Display

#### HTML5 Video Player (Limited Browser Support)
```html
<video id="videoPlayer" width="640" height="480" autoplay>
  <source src="rtsp://192.168.1.100:8554/stream" type="rtsp/h264">
</video>
```

#### Using video.js with RTSP Plugin
```html
<!DOCTYPE html>
<html>
<head>
  <link href="https://vjs.zencdn.net/8.0.4/video-js.css" rel="stylesheet" />
</head>
<body>
  <video id="videoPlayer" class="video-js" controls preload="auto">
    <source src="rtsp://192.168.1.100:8554/stream" type="rtsp/h264">
  </video>
  
  <script src="https://vjs.zencdn.net/8.0.4/video.min.js"></script>
  <script>
    var player = videojs('videoPlayer');
  </script>
</body>
</html>
```

#### WebRTC (Recommended for Low Latency)
Requires additional GStreamer WebRTC setup on Jetson.

### HTTP Snapshot Endpoint (Simple Alternative)
```python
# Flask backend - capture snapshots periodically
@app.route('/api/snapshot', methods=['GET'])
def get_snapshot():
    # Implement snapshot capture from DeepStream
    # Return as base64 or image file
    pass
```

## Development Workflow

### 1. Start DeepStream on Jetson Nano
```bash
# SSH into Jetson
ssh username@192.168.1.100

# Start Docker container
docker run --net=host --runtime nvidia \
  nvcr.io/nvidia/deepstream:7.0-samples

# Start DeepStream server app
cd /opt/nvidia/deepstream/deepstream/sources/apps/sample_apps/deepstream-server
./deepstream-server-app -c config.txt
```

### 2. Start Backend on PC (Optional)
```bash
# Python Flask
python app.py

# Node.js
npm install
node server.js
```

### 3. Start Frontend on PC
```bash
# React
npm start

# Vue
npm run serve

# Simple HTML
python -m http.server 3000
```

### 4. Test API Connection
```bash
# Test from PC
curl http://192.168.1.100:8080/api/v1/health

# Test through backend
curl http://localhost:5000/api/health
```

## Testing Commands

### Using curl
```bash
# Add stream
curl -X POST http://192.168.1.100:8080/api/v1/stream \
  -H "Content-Type: application/json" \
  -d '{
    "stream_id": "stream_0",
    "uri": "file:///opt/nvidia/deepstream/samples/streams/sample_720p.mp4"
  }'

# Remove stream
curl -X DELETE http://192.168.1.100:8080/api/v1/stream/stream_0

# Update inference
curl -X PUT http://192.168.1.100:8080/api/v1/infer \
  -H "Content-Type: application/json" \
  -d '{
    "infer_name": "primary-detector",
    "batch_size": 4,
    "interval": 1
  }'

# Add ROI
curl -X POST http://192.168.1.100:8080/api/v1/roi \
  -H "Content-Type: application/json" \
  -d '{
    "stream_id": "stream_0",
    "roi_id": "roi_0",
    "left": 100,
    "top": 100,
    "width": 500,
    "height": 400
  }'
```

### Using Postman
1. Import the API endpoints as a collection
2. Set base URL: `http://192.168.1.100:8080/api/v1`
3. Test each endpoint with sample payloads

## Common Stream URIs

```javascript
// File
"file:///opt/nvidia/deepstream/samples/streams/sample_720p.mp4"

// RTSP Camera
"rtsp://username:password@camera-ip:554/stream"

// USB Camera
"v4l2:///dev/video0"

// HTTP Stream
"http://example.com/stream.mp4"
```

## Model Configuration Example

```json
{
  "infer_name": "primary-detector",
  "model_path": "/opt/nvidia/deepstream/samples/models/Primary_Detector/resnet10.caffemodel",
  "proto_file": "/opt/nvidia/deepstream/samples/models/Primary_Detector/resnet10.prototxt",
  "model_engine_file": "/opt/nvidia/deepstream/samples/models/Primary_Detector/resnet10.caffemodel_b1_gpu0_fp16.engine",
  "batch_size": 4,
  "network_mode": 1,
  "confidence_threshold": 0.5
}
```

## Troubleshooting

### Cannot Connect to DeepStream API
```bash
# Check if DeepStream is running
docker ps

# Check if port is accessible
telnet 192.168.1.100 8080

# Check firewall on Jetson
sudo ufw status
sudo ufw allow 8080
```

### CORS Errors in Browser
- Use backend proxy (recommended)
- Disable CORS in development browser
- Modify DeepStream REST server source

### Video Stream Not Displaying
- Verify RTSP port is exposed (8554)
- Check video codec compatibility
- Use VLC to test RTSP stream first:
  ```
  vlc rtsp://192.168.1.100:8554/stream
  ```

### Performance Issues
- Reduce inference frequency (increase interval)
- Lower video resolution
- Use DLA instead of GPU for some models
- Reduce number of concurrent streams

## Security Considerations

### Development
- Use local network only
- No authentication required

### Production
- Add authentication (JWT, OAuth)
- Use HTTPS instead of HTTP
- Implement rate limiting
- Add input validation
- Use firewall rules

## Project Structure Recommendation

```
deepstream-webapp/
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── StreamControl.jsx
│   │   │   ├── InferenceConfig.jsx
│   │   │   └── ROIManager.jsx
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── app.py (or server.js)
│   ├── requirements.txt (or package.json)
│   └── .env
│
├── docs/
│   └── API.md
│
└── README.md
```

## Next Steps

1. **Set up network connection** between PC and Jetson Nano
2. **Test DeepStream REST API** with curl commands
3. **Create simple HTML test page** to verify connectivity
4. **Build backend API** (if using middleware approach)
5. **Develop frontend UI** with React/Vue/HTML
6. **Add video streaming** capability
7. **Implement error handling** and logging
8. **Add authentication** for production

## Useful Resources

- [DeepStream Documentation](https://docs.nvidia.com/metropolis/deepstream/dev-guide/)
- [DeepStream REST API Guide](https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_RestServer.html)
- [Sample Applications](https://github.com/NVIDIA-AI-IOT/deepstream_python_apps)
- [DeepStream Forum](https://forums.developer.nvidia.com/c/accelerated-computing/intelligent-video-analytics/deepstream-sdk/)

## Sample Configuration Files

### DeepStream Config (config.txt)
```ini
[application]
enable-perf-measurement=1
perf-measurement-interval-sec=5

[source0]
enable=1
type=3
uri=file:///opt/nvidia/deepstream/samples/streams/sample_720p.mp4
num-sources=1

[sink0]
enable=1
type=4
rtsp-port=8554
codec=1

[primary-gie]
enable=1
model-engine-file=/path/to/model.engine
batch-size=1
interval=1
```

### Environment Variables (.env)
```bash
JETSON_IP=192.168.1.100
DEEPSTREAM_API_PORT=8080
RTSP_PORT=8554
BACKEND_PORT=5000
FRONTEND_PORT=3000
```

---

**Note:** This guide assumes DeepStream 6.2+ which includes REST API support. Adjust configurations based on your DeepStream version.
