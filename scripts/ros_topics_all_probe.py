import os
import json
import sys

try:
    import roslibpy
except Exception as e:
    print(json.dumps({"error": "roslibpy_missing", "detail": str(e)}))
    sys.exit(0)

host = os.getenv('DS_ROS_HOST', '192.168.1.200')
port = int(os.getenv('DS_ROS_PORT', '9090'))
ros = roslibpy.Ros(host=host, port=port)

try:
    ros.run()
except Exception as e:
    print(json.dumps({"error": "rosbridge_connect_failed", "detail": str(e), "host": host, "port": port}))
    sys.exit(0)

out = []
try:
    svc_topics = roslibpy.Service(ros, "/rosapi/topics", "rosapi/Topics")
    resp = svc_topics.call(roslibpy.ServiceRequest({}))
    topics = resp.get("topics", [])
    svc_type = roslibpy.Service(ros, "/rosapi/topic_type", "rosapi/TopicType")
    for t in topics:
        ty = ""
        try:
            ty = svc_type.call(roslibpy.ServiceRequest({"topic": t})).get("type", "")
        except Exception:
            pass
        out.append({"topic": t, "type": ty})
except Exception as e:
    print(json.dumps({"error": "rosapi_failed", "detail": str(e)}))
    try:
        ros.terminate()
    except Exception:
        pass
    sys.exit(0)

print(json.dumps(out))
try:
    ros.terminate()
except Exception:
    pass
