# Jetson Web UI — Run Command

Use this command on Jetson to run the web UI container:

```
docker run -d --name jetson-web --restart always \
   --network host \
   -e PORT=80 \
   -e DEEPSTREAM_URL=http://localhost:8080/api/v1 \
   -e CONFIGS_DIR=/app/configs/ \
   -v /var/run/docker.sock:/var/run/docker.sock \
   -v /data/ds/configs:/app/configs \
   -v /tmp/.X11-unix:/tmp/.X11-unix \
   jetson-web
```