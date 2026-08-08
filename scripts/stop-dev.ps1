$ErrorActionPreference = 'Stop'

# `dev:fresh` owns only the processes launched by this repository's canonical
# dev stack. Stop those exact command lines before starting the foreground
# concurrently tree again; do not touch Docker or unrelated Python/Node tools.
$ownedPatterns = @(
  'concurrently(?:\.js)? .*--names rails,backend,grpc,frontend,graphiti,mcp,tunnel',
  'uvicorn app\.main:app --host 127\.0\.0\.1 --port 8003',
  'uvicorn app:app --host 127\.0\.0\.1 --port 8001',
  'localcoder.*(?:start-grpc\.ts|dev:grpc)',
  'vite(?:\.js)? dev',
  'apps[\\/]python-models[\\/]app[\\/]mcp_host\.py',
  'ngrok(?:\.exe)? http .*exemption-unstable-wolverine\.ngrok-free\.dev'
)

$processes = @(Get-CimInstance Win32_Process)
$ownedIds = [System.Collections.Generic.HashSet[int]]::new()

foreach ($process in $processes) {
  $commandLine = [string]$process.CommandLine
  if (-not $commandLine) { continue }
  foreach ($pattern in $ownedPatterns) {
    if ($commandLine -match $pattern) {
      [void]$ownedIds.Add([int]$process.ProcessId)
      break
    }
  }
}

# Include descendants so npm/cmd/python launcher wrappers cannot survive and
# retain a port after their owned service process is stopped.
$added = $true
while ($added) {
  $added = $false
  foreach ($process in $processes) {
    if ($ownedIds.Contains([int]$process.ParentProcessId) -and
        -not $ownedIds.Contains([int]$process.ProcessId)) {
      [void]$ownedIds.Add([int]$process.ProcessId)
      $added = $true
    }
  }
}

$currentPid = $PID
$targets = @($ownedIds | Where-Object { $_ -ne $currentPid } | Sort-Object -Descending)
if ($targets.Count -gt 0) {
  Stop-Process -Id $targets -Force -ErrorAction SilentlyContinue
  foreach ($target in $targets) {
    Wait-Process -Id $target -Timeout 5 -ErrorAction SilentlyContinue
  }
}

$ownedPorts = @(4000, 50051, 5173, 8001, 8003, 8765, 9749)
$remaining = @(
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $ownedPorts -contains $_.LocalPort } |
    Select-Object -ExpandProperty LocalPort -Unique |
    Sort-Object
)
if ($remaining.Count -gt 0) {
  throw "dev_fresh_ports_still_owned: $($remaining -join ',')"
}
