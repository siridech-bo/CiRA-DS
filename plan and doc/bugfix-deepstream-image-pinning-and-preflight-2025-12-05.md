# Deployment Hardening: Image Pinning, Preflight, and Push

## Problems
- Mutable image tags caused drift between restarts; runtime depended on whatever the registry tag pointed to.
- Unnecessary pulls when resolving digests slowed startup and risked changing the base unexpectedly.
- Missing DeepStream MQTT adapter (`libnvds_mqtt_proto.so`) led to message pipeline failures without a graceful fallback.
- PowerShell console key handling occasionally broke long inline commands, making remote operations flaky.

## Fixes
- Pin the DeepStream image to a digest and use it for helper containers:
  - Digest resolver inspects local image first; pulls only if missing.
  - All launches use the pinned digest via `_getDsImage()`.
  - References:
    - `jetson-web/server.js:152–186` (digest resolve and pin)
    - `jetson-web/server.js:240`, `:386`, `:2027`, `:2049` (use pinned image)
    - `jetson-web/server.js:684` (admin env reports resolved image)

- Add startup preflight and MQTT fallback:
  - Run script checks adapter presence and sets `DS_ENABLE_MSG` accordingly.
  - DeepStream app auto-falls back to Python `paho-mqtt` when adapter or deps are missing.
  - References:
    - `scripts/deepstream_usb_run.sh:4–11`, `:12–28`, `:29–31`, `:32–47`
    - `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py:529–548`, `:699–708`, `:710–725`

- Push current working container without changing it:
  - Committed and pushed `ds_usb_dev` directly.
  - New tag: `siridech2/deepstream-usb-dev:20251205-090843`
  - Registry reported digest: `sha256:f2c3b53ea3db05ba386f8edb29b8feef86ee0fcdf75ab319ba47b5bf6276e5dc`
  - Use `siridech2/deepstream-usb-dev@sha256:f2c3b53e...` to guarantee immutability in deployments.

- Console reliability:
  - Avoid long inline commands in interactive shells; prefer file-based scripts or non-interactive exec.

## Operational Notes
- To push without affecting a running container, use commit → push:
  - Commit: `POST /api/dspython/commit` with `repo` and `tag`.
  - Push: `POST /api/docker/push` with `image`, `tag`, and registry auth.
- To run with pinned digest, set `DEEPSTREAM_IMAGE_DIGEST=sha256:<digest>` or rely on local-inspect-first resolver.
- Preflight sets `DS_ENABLE_MSG` automatically; the app handles ROS and MQTT publishing based on availability.

## Next Steps
- Update any external run docs to use the digest form of the image.
- Optionally add a small health check for rosbridge (`/api/ros/bridge/health`) in CI to catch connectivity issues early.
