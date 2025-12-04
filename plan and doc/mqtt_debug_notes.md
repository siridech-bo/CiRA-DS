MQTT debug summary

Context
- Detector and OSD active; X11 shows bounding boxes and text.
- Web Output tab showed no JSON; MQTT payloads needed verification without restarting app.

Findings
- Broker listening on 0.0.0.0:1883 and ::1:1883.
- Container ds_usb_dev runs in host network mode.
- Live MQTT subscription received consecutive detection messages on topic deepstream/detections.

Verification commands
- timeout 8 mosquitto_sub -h 127.0.0.1 -t deepstream/detections -v -C 3
- mosquitto_pub -h 127.0.0.1 -t deepstream/detections -r -n
- ss -ltnp | grep 1883
- docker inspect ds_usb_dev --format {{.HostConfig.NetworkMode}}

Observed payloads
- deepstream/detections {"frame": 407391, "detections": [{"class_id": 2, "left": 1089.6743, "top": 488.1464, "width": 141.6577, "height": 229.8970, "confidence": 0.2095}]}
- deepstream/detections {"frame": 407392, "detections": []}
- deepstream/detections {"frame": 407393, "detections": [{"class_id": 2, "left": 1090.5630, "top": 490.1526, "width": 141.1792, "height": 227.8908, "confidence": 0.2692}]}

Cause of web tab empty
- Output tab reads JSON_DET from app log; MQTT messages are separate.
- App may have been launched without JSON_DET prints or without log redirection to /tmp/ds_usb_dev_app.log.

Action items
- Add backend MQTT subscriber and SSE endpoint; wire Output tab to display MQTT messages continuously.
