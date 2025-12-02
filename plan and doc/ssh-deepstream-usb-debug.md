# SSH Upload, Debug, and Run: DeepStream USB App on Jetson

## Prerequisites
- SSH alias configured in `C:\Users\bmwsb\.ssh\config` with key and host policy.
- Jetson reachable over network; user password available.
- X11 on Jetson with local display: set `DISPLAY=:0` and allow root clients.

## OpenSSH Key-Based, Non-Interactive Setup (Reusable)
- Generate an ed25519 key (fast, secure):
  - `ssh-keygen -t ed25519 -f C:\Users\<you>\.ssh\id_ed25519 -N ""`
- Harden config entry for Jetson:
  - Edit `C:\Users\<you>\.ssh\config` and add:
    ```
    Host jetson
      HostName 192.168.1.200
      User user
      Port 22
      IdentityFile C:\Users\<you>\.ssh\id_ed25519
      IdentitiesOnly yes
      PubkeyAuthentication yes
      PasswordAuthentication no
      StrictHostKeyChecking accept-new
      ServerAliveInterval 30
      ServerAliveCountMax 3
    ```
- Install your public key on Jetson:
  - `scp -F C:\Users\<you>\.ssh\config C:\Users\<you>\.ssh\id_ed25519.pub jetson:/tmp/id_ed25519.pub`
  - `ssh -F C:\Users\<you>\.ssh\config jetson "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat /tmp/id_ed25519.pub >> ~/.ssh/authorized_keys && rm /tmp/id_ed25519.pub && chmod 600 ~/.ssh/authorized_keys"`
- Verify non-interactive SSH/scp:
  - `ssh -F C:\Users\<you>\.ssh\config -o BatchMode=yes jetson "echo NONINTERACTIVE_OK && hostname"`
  - `scp -F C:\Users\<you>\.ssh\config -o BatchMode=yes C:\Users\<you>\.ssh\config jetson:/tmp/ssh_config_copy_test`

### Notes (Windows)
- Use single quotes around remote commands to prevent PowerShell from expanding env vars: `ssh jetson 'echo $DISPLAY'`.
- `ssh-agent` is optional; OpenSSH picks up `IdentityFile` directly. For agent:
  - Start service: `Start-Service ssh-agent` and `ssh-add C:\Users\<you>\.ssh\id_ed25519`.

### Example SSH Config
```
Host jetson
  HostName 192.168.1.200
  User user
  Port 22
  IdentityFile C:\Users\bmwsb\.ssh\id_rsa
  StrictHostKeyChecking accept-new
  IdentitiesOnly yes
```

## Upload Files from Dev Machine
- Script: `deepstream_test_1_usb.py` → `/data/ds/share/deepstream_test_1_usb.py`
- Config: `dstest1_pgie_config.txt` → `/data/ds/share/dstest1_pgie_config.txt`
- Common helpers: `common/` → `/data/ds/common`

### Commands
- `scp -F C:\Users\bmwsb\.ssh\config "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py" jetson:/data/ds/share/deepstream_test_1_usb.py`
- `scp -F C:\Users\bmwsb\.ssh\config "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\dstest1_pgie_config.txt" jetson:/data/ds/share/dstest1_pgie_config.txt`
- `scp -r -F C:\Users\bmwsb\.ssh\config "D:\CiRA DS app\data\apps\common" jetson:/data/ds/common`

## Prepare Jetson Display and Camera
- `ssh -F C:\Users\bmwsb\.ssh\config jetson "export DISPLAY=:0; xhost +local:root || true"`
- `ssh -F C:\Users\bmwsb\.ssh\config jetson "sudo fuser -k /dev/video0 || true"`

## Run in NVIDIA DeepStream Container (recommended)
- Use `nvcr.io/nvidia/deepstream-l4t:6.0.1-samples` (or `-triton`) which runs reliably on Jetson.

### One-off Run (simplest)
- `ssh -F C:\Users\bmwsb\.ssh\config jetson "docker run --rm --name ds_usb_run --runtime nvidia --network host --privileged -e DISPLAY=:0 -e PYTHONPATH=/app:/app/common -v /tmp/.X11-unix:/tmp/.X11-unix:rw -v /data/ds/share:/app/share -v /data/ds/common:/app/common --device=/dev/video0 nvcr.io/nvidia/deepstream-l4t:6.0.1-samples bash -lc \"apt update && apt install -y python3-gi python3-gst-1.0 && python3 /app/share/deepstream_test_1_usb.py /dev/video0\""`

### Persistent Container (optional)
- Start:
  - `ssh -F C:\Users\bmwsb\.ssh\config jetson "docker rm -f ds_python_run || true; docker run -d --name ds_python_run --entrypoint /bin/sh --runtime nvidia --network host --privileged -e DISPLAY=:0 -e PYTHONPATH=/app:/app/common -v /tmp/.X11-unix:/tmp/.X11-unix:rw -v /data/ds/share:/app/share -v /data/ds/common:/app/common --device=/dev/video0 nvcr.io/nvidia/deepstream-l4t:6.0.1-samples -c \"sleep 9999999\""`
- Install GI and run:
  - `ssh -F C:\Users\bmwsb\.ssh\config jetson "docker exec ds_python_run bash -lc \"apt update && apt install -y python3-gi python3-gst-1.0 && python3 /app/share/deepstream_test_1_usb.py /dev/video0\""`

## Alternate Image (siridech2/deepstream-l4t:pyds-dev)
- Safe to use; image stays unchanged.
- If the container exits immediately with Exit 126, use `/bin/sh` entrypoint and `sleep` to keep it alive:
  - `ssh -F C:\Users\bmwsb\.ssh\config jetson "docker rm -f ds_python || true; docker run -d --name ds_python --entrypoint /bin/sh --runtime nvidia --network host --privileged -e DISPLAY=:0 -v /tmp/.X11-unix:/tmp/.X11-unix:rw -v /data/ds/share:/app/share -v /data/ds/common:/app/common --device=/dev/video0 siridech2/deepstream-l4t:pyds-dev -c \"sleep 9999999\""`

## pyds Shim (if needed)
- If the environment lacks the official `pyds`, the app falls back to `pyds_ext` automatically.
- In a container expecting `pyds`, alias the shim:
  - `docker exec ds_python bash -lc "ln -sfn /app/pyds_ext /app/pyds && python3 -m pip uninstall -y pyds || true"`
  - Ensure `PYTHONPATH` includes `/app`.

## Verifications
- Display:
  - `ssh -F C:\Users\bmwsb\.ssh\config jetson "echo \$DISPLAY"` → should be `:0`.
  - `ssh -F C:\Users\bmwsb\.ssh\config jetson "docker exec ds_python_run ls -l /tmp/.X11-unix"`.
- Mounts:
  - `ssh -F C:\Users\bmwsb\.ssh\config jetson "docker run --rm -v /data/ds/share:/app/share nvcr.io/nvidia/deepstream-l4t:6.0.1-samples ls -l /app/share"`.

## Troubleshooting
- `ModuleNotFoundError: No module named 'gi'`:
  - Install `python3-gi` and `python3-gst-1.0` in the container.
- Container exit `126`:
  - Use `/bin/sh` entrypoint and a long `sleep` command.
- “No such file or directory” for the script:
  - Confirm the mount: `-v /data/ds/share:/app/share` and file exists.
- No window appears:
  - Re-run `xhost +local:root`, ensure `DISPLAY=:0`, and verify `nv3dsink`/`nveglglessink` availability.

## Minimal One-Liners
- Upload all:
  - `scp -F C:\Users\<you>\.ssh\config "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\deepstream_test_1_usb.py" jetson:/data/ds/share/ && scp -F C:\Users\<you>\.ssh\config "D:\CiRA DS app\data\apps\deepstream-test1-usbcam\dstest1_pgie_config.txt" jetson:/data/ds/share/ && scp -r -F C:\Users\<you>\.ssh\config "D:\CiRA DS app\data\apps\common" jetson:/data/ds/common`
- Run now (samples image):
  - `ssh -F C:\Users\<you>\.ssh\config jetson "export DISPLAY=:0; xhost +local:root || true; docker run --rm --runtime nvidia --network host --privileged -e DISPLAY=:0 -e PYTHONPATH=/app:/app/common -v /tmp/.X11-unix:/tmp/.X11-unix:rw -v /data/ds/share:/app/share -v /data/ds/common:/app/common --device=/dev/video0 nvcr.io/nvidia/deepstream-l4t:6.0.1-samples bash -lc \"apt update && apt install -y python3-gi python3-gst-1.0 && python3 /app/share/deepstream_test_1_usb.py /dev/video0\""`

## Code References
- Live-source and pad request: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:241-246`, `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:270-276`
- RGBA capsfilter: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:213-216`, `236-240`, `256-281`
- PGIE config default and override: `data/apps/deepstream-test1-usbcam/deepstream_test_1_usb.py:245`, `241-246`
