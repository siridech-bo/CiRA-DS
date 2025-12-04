param(
  [Parameter(Mandatory=$true)][string]$JetsonHost,
  [Parameter(Mandatory=$true)][string]$JetsonUser,
  [string]$Device = "/dev/video0",
  [int]$SnapshotPeriodMs = 20000,
  [string]$RosDistro = "melodic",
  [int]$RosBridgePort = 9090,
  [string]$RosBridgeHost = "127.0.0.1",
  [string]$SshAlias = "jetson",
  [string]$SshConfigPath = "$env:USERPROFILE\.ssh\config"
)

$localShare = (Resolve-Path -LiteralPath "data/apps/deepstream-test1-usbcam/deepstream_test_1_usb_ros.py").Path
$localCommon = (Resolve-Path -LiteralPath "data/apps/common").Path
$localMsgConvCfg = (Resolve-Path -LiteralPath "data/apps/deepstream-test4/dstest4_msgconv_config.txt").Path

try {
  $scp = Get-Command scp -ErrorAction SilentlyContinue
  if ($scp) {
    $scpBaseArgs = @('scp','-F',$SshConfigPath,'-o','BatchMode=yes')
    & $scpBaseArgs $localShare ($SshAlias + ':/data/ds/share/') | ForEach-Object { $_ }
    & $scpBaseArgs '-r' $localCommon ($SshAlias + ':/data/ds/common/') | ForEach-Object { $_ }
    & $scpBaseArgs $localMsgConvCfg ($SshAlias + ':/data/ds/share/') | ForEach-Object { $_ }
  } else {
    Write-Output '[WARN] scp not found, skipping file copy'
  }
} catch { Write-Output ('[WARN] scp failed: ' + $_) }

$remoteCmds = @(
  'set -e',
  'export DISPLAY=:0',
  'xhost +si:localuser:root || xhost +local:root || true',
  'sudo mkdir -p /data/ds/share /data/ds/common',
  'sudo chown ${USER}:${USER} /data/ds/share /data/ds/common || true',
  'sudo mkdir -p /data/ds/datasets/autocap',
  'sudo chown ${USER}:${USER} /data/ds/datasets/autocap || true',
  'docker rm -f ds_usb_dev || true',
  'docker rm -f mosq || true',
  'docker pull eclipse-mosquitto:2',
  'docker run -d --name mosq --network host eclipse-mosquitto:2',
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
    'DS_MSGCONV_CONFIG=/app/share/dstest4_msgconv_config.txt ' +
    'DS_MQTT_PROTO_LIB=/opt/nvidia/deepstream/deepstream/lib/libnvds_mqtt_proto.so ' +
    'DS_MQTT_CONN_STR=127.0.0.1;1883 ' +
    'DS_MQTT_TOPIC=deepstream/detections ' +
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
$escaped = $joined.Replace('"','\"')

$sshCmd = @(
  'ssh','-F',$SshConfigPath,'-o','BatchMode=yes',
  $SshAlias,
  ('bash -lc "' + $escaped + '"')
)

Write-Output ("[INFO] Connecting to {0}@{1} and running workflow..." -f $JetsonUser, $JetsonHost)

& $sshCmd | ForEach-Object { $_ }
