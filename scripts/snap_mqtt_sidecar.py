import os
import time
import json
import threading

try:
    import paho.mqtt.client as mqtt
except Exception:
    mqtt = None

SNAP_DIR = os.getenv('DS_SNAPSHOT_DIR', '/data/ds/datasets/autocap')
HOST = os.getenv('DS_MQTT_HOST', '127.0.0.1')
PORT = int(os.getenv('DS_MQTT_PORT', '1883'))
DET_TOPIC = os.getenv('DS_MQTT_TOPIC', 'deepstream/detections')
SNAP_TOPIC = os.getenv('DS_MQTT_SNAP_TOPIC', 'deepstream/snap')

last_det = {"ts_ms": 0, "detections": [], "frame_id": None}

def det_cb(client, userdata, message):
    try:
        payload = message.payload.decode('utf-8', errors='ignore')
        j = json.loads(payload)
        last_det.update({
            "ts_ms": int(j.get("ts_ms", 0)),
            "detections": j.get("detections", []),
            "frame_id": j.get("frame_id")
        })
    except Exception:
        pass

def run():
    if mqtt is None:
        return
    client = mqtt.Client()
    client.on_message = det_cb
    try:
        client.connect(HOST, PORT, 60)
    except Exception:
        return
    client.subscribe(DET_TOPIC, qos=0)
    client.loop_start()
    seen = set()
    try:
        while True:
            try:
                files = [f for f in os.listdir(SNAP_DIR) if f.lower().endswith('.jpg')]
            except Exception:
                files = []
            files.sort()
            for name in files[-10:]:
                path = os.path.join(SNAP_DIR, name)
                if path in seen:
                    continue
                try:
                    with open(path, 'rb') as fh:
                        data = fh.read()
                    import base64
                    payload = {
                        "ts_ms": int(time.time()*1000),
                        "image_b64": base64.b64encode(data).decode('ascii'),
                        "detections": last_det.get("detections", []),
                        "frame_id": last_det.get("frame_id"),
                        "cam": {
                            "device": os.getenv('DS_CAM_DEVICE', '/dev/video0'),
                            "width": int(os.getenv('DS_CAM_WIDTH', '640')),
                            "height": int(os.getenv('DS_CAM_HEIGHT', '480')),
                            "fps": os.getenv('DS_CAM_FPS', '30/1'),
                            "caps": os.getenv('DS_CAM_CAPS', 'image/jpeg')
                        },
                        "meta": {"osd": True}
                    }
                    client.publish(SNAP_TOPIC, json.dumps(payload), qos=0, retain=False)
                    seen.add(path)
                except Exception:
                    pass
            time.sleep(1.0)
    finally:
        try:
            client.loop_stop()
        except Exception:
            pass

if __name__ == '__main__':
    run()
