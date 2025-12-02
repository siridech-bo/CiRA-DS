# SSH Setting for Remote Debugging with Jetson

## OpenSSH Key-Based, Non-Interactive Setup
- Generate an ed25519 key:
  - `ssh-keygen -t ed25519 -f C:\Users\<you>\.ssh\id_ed25519 -N ""`
- Harden the SSH config entry:
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

## Windows Notes
- Use single quotes around remote commands to prevent PowerShell from expanding env vars: `ssh jetson 'echo $DISPLAY'`.
- `ssh-agent` is optional; OpenSSH uses `IdentityFile` directly. To use agent:
  - `Start-Service ssh-agent` and `ssh-add C:\Users\<you>\.ssh\id_ed25519`.

## Example SSH Config (reference)
```
Host jetson
  HostName 192.168.1.200
  User user
  Port 22
  IdentityFile C:\Users\bmwsb\.ssh\id_rsa
  StrictHostKeyChecking accept-new
  IdentitiesOnly yes
```


