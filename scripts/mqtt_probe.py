import os
import sys
import json
import time

try:
    import paho.mqtt.client as mqtt
except Exception as e:
    print(json.dumps({"error": "paho_missing", "detail": str(e)}))
    sys.exit(0)

host = os.getenv('DS_MQTT_HOST', '127.0.0.1')
port = int(os.getenv('DS_MQTT_PORT', '1883'))
topic = os.getenv('DS_MQTT_SNAP_TOPIC', 'deepstream/snap')
out = {"received": None}

def on_msg(client, userdata, message):
    try:
        payload = message.payload.decode('utf-8', errors='ignore')
    except Exception:
        payload = str(message.payload)
    out["received"] = {"topic": message.topic, "payload": payload[:500]}
    client.disconnect()

client = mqtt.Client()
client.on_message = on_msg
client.connect(host, port, 60)
client.subscribe(topic, qos=0)
client.loop_start()
ts = time.time()
while time.time() - ts < 5.0 and out["received"] is None:
    time.sleep(0.2)
client.loop_stop()
print(json.dumps(out))
