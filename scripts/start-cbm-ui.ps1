param(
  [string]$Binary = 'C:\cbm\codebase-memory-mcp.exe',
  [int]$Port = 9749,
  [switch]$KillExisting
)

$ErrorActionPreference = 'Stop'

if ($KillExisting) {
  Get-Process | Where-Object { $_.ProcessName -like 'codebase-memory-mcp*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
}

if (-not (Test-Path $Binary)) {
  throw "Binary not found: $Binary"
}

Write-Host "Starting CBM UI: $Binary --ui=true --port=$Port"
$proc = Start-Process -FilePath $Binary -ArgumentList @('--ui=true', "--port=$Port") -PassThru
Start-Sleep -Seconds 2

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($null -eq $listening) {
  Write-Host "CBM process started (PID=$($proc.Id)) but no listener on port $Port yet."
} else {
  Write-Host "CBM UI listening on http://127.0.0.1:$Port (PID=$($proc.Id))"
}

try {
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
  Write-Host "HTTP / =>" $resp.StatusCode
} catch {
  Write-Host "HTTP check failed:" $_.Exception.Message
}
