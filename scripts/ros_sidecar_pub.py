import os
import json
import time
import sys

try:
    import roslibpy
except Exception as e:
    sys.stdout.write(json.dumps({"error": "roslibpy_missing", "detail": str(e)}) + "\n")
    sys.exit(0)

host = os.getenv('DS_ROS_HOST', '192.168.1.200')
port = int(os.getenv('DS_ROS_PORT', '9090'))
ros = roslibpy.Ros(host=host, port=port)

try:
    ros.run()
except Exception as e:
    sys.stdout.write(json.dumps({"error": "rosbridge_connect_failed", "detail": str(e), "host": host, "port": port}) + "\n")
    sys.exit(0)

pub_det = roslibpy.Topic(ros, '/deepstream/detections_json', 'std_msgs/String')
pub_img = roslibpy.Topic(ros, '/deepstream/image_osd_jpeg_b64', 'std_msgs/String')

try:
    pub_det.advertise()
    pub_img.advertise()
    while True:
        now_ms = int(time.time() * 1000)
        det = {"source": "sidecar", "ts": now_ms, "detections": []}
        msg_det = roslibpy.Message({"data": json.dumps(det)})
        msg_img = roslibpy.Message({"data": "sidecar-heartbeat-" + str(now_ms)})
        try:
            pub_det.publish(msg_det)
            pub_img.publish(msg_img)
        except Exception:
            pass
        time.sleep(1.0)
except KeyboardInterrupt:
    pass
finally:
    try:
        pub_det.unadvertise()
    except Exception:
        pass
    try:
        pub_img.unadvertise()
    except Exception:
        pass
    try:
        ros.terminate()
    except Exception:
        pass
