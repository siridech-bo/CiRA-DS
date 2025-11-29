param(
  [string]$Base = "http://192.168.1.200:3000",
  [string]$Local,
  [string]$ContainerRel,
  [string]$ContainerPath,
  [string]$Input = "/opt/nvidia/deepstream/deepstream-6.0/samples/streams/sample_720p.h264",
  [string]$Codec = "H264",
  [switch]$Validate
)

if (-not $Local) { Write-Error "Local required"; exit 1 }
$allowedRoot = '/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/apps/'
$path = $null
if ($ContainerRel) { $path = "$allowedRoot$ContainerRel" }
elseif ($ContainerPath) { $path = $ContainerPath }
else { Write-Error "ContainerRel or ContainerPath required"; exit 1 }
if (-not ($path.StartsWith($allowedRoot))) { Write-Error "Path must start with allowed root"; exit 1 }

$content = Get-Content -Raw -LiteralPath $Local
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $Local).Hash.ToLower()
$body = @{ path = $path; content = $content; sha256 = $sha; validate = ($Validate.IsPresent -or $true); input = $Input; codec = $Codec } | ConvertTo-Json -Depth 6
$resp = Invoke-RestMethod -Uri ($Base.TrimEnd('/') + '/api/mcp/test_python') -Method Post -ContentType 'application/json' -Body $body
$resp | ConvertTo-Json -Depth 6 | Write-Output
try { $logs = Invoke-RestMethod -Uri ($Base.TrimEnd('/') + '/api/mcp/tail_logs?tail=800') -Method Get; $logs | Out-String | Write-Output } catch {}
