param(
  [Parameter(Mandatory=$true)][string]$JetsonHost,
  [Parameter(Mandatory=$true)][string]$JetsonUser,
  [string]$Device = "/dev/video0",
  [int]$SnapshotPeriodMs = 20000,
  [string]$RosDistro = "melodic",
  [int]$RosBridgePort = 9090,
  [string]$RosBridgeHost = "127.0.0.1"
)

$localShare = (Resolve-Path -LiteralPath "data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py").Path
$localCommon = (Resolve-Path -LiteralPath "data/apps/common").Path

$scpBaseArgs = @('scp','-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null')
& $scpBaseArgs $localShare ($JetsonUser + '@' + $JetsonHost + ':/data/ds/share/') | ForEach-Object { $_ }
& $scpBaseArgs '-r' $localCommon ($JetsonUser + '@' + $JetsonHost + ':/data/ds/common/') | ForEach-Object { $_ }

$remoteCmds = @(
  'set -e',
  'export DISPLAY=:0',
  'xhost +si:localuser:root || xhost +local:root || true',
  'sudo mkdir -p /data/ds/share /data/ds/common',
  'sudo chown ${USER}:${USER} /data/ds/share /data/ds/common || true',
  'sudo mkdir -p /data/ds/datasets/autocap',
  'sudo chown ${USER}:${USER} /data/ds/datasets/autocap || true',
  'docker rm -f ds_usb_dev || true',
  (
    'docker run -d --name ds_usb_dev --runtime nvidia --network host --privileged ' +
    '-e DISPLAY=:0 -e PYTHONPATH=/app:/app/common ' +
    '-e DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt ' +
    ('-e DS_ROS_HOST=' + $RosBridgeHost + ' ') +
    ('-e DS_ROS_PORT=' + $RosBridgePort + ' ') +
    '-v /tmp/.X11-unix:/tmp/.X11-unix:rw -v /data/ds/share:/app/share -v /data/ds/common:/app/common -v /data/ds/datasets:/data/ds/datasets ' +
    ('--device=' + $Device + ' ') +
    'deepstream-usb-dev:6.0.1'
  ),
  (
    'nohup bash -lc "source /opt/ros/' + $RosDistro + '/setup.bash && roslaunch rosbridge_server rosbridge_websocket.launch" > /tmp/rosbridge.log 2>&1 & echo RB=$!'
  ),
  (
    'docker exec ds_usb_dev /usr/bin/env DISPLAY=:0 PYTHONPATH=/app:/app/common ' +
    'DS_PGIE_CONFIG=/opt/nvidia/deepstream/deepstream-6.0/samples/configs/deepstream-app/config_infer_primary.txt ' +
    ('DS_ROS_HOST=' + $RosBridgeHost + ' ') +
    ('DS_ROS_PORT=' + $RosBridgePort + ' ') +
    ('python3 /app/share/deepstream_test_1_usb_ros.py ' + $Device + ' ') +
    '> /tmp/ds_usb_dev_app.log 2>&1 & echo DS_APP=$!'
  ),
  'sleep 3',
  (
    'bash -lc "source /opt/ros/' + $RosDistro + '/setup.bash && rostopic pub -1 /deepstream/snapshot/period_ms std_msgs/Int32 \"{data: ' + $SnapshotPeriodMs + '}\""'
  ),
  (
    'bash -lc "source /opt/ros/' + $RosDistro + '/setup.bash && rostopic pub -1 /deepstream/snapshot/start std_msgs/Empty \"{}\""'
  ),
  'sleep 12',
  'ls -la /data/ds/datasets/autocap | tail -n 20'
)

$joined = ($remoteCmds -join ' && ')

$sshCmd = @(
  'ssh',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  ($JetsonUser + '@' + $JetsonHost),
  ('bash -lc ' + "'" + $joined.Replace("'", "'\"'\"'") + "'")
)

Write-Output ("[INFO] Connecting to {0}@{1} and running workflow..." -f $JetsonUser, $JetsonHost)

& $sshCmd | ForEach-Object { $_ }
