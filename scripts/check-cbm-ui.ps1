param(
  [int]$Port = 9749
)

$ErrorActionPreference = 'Continue'

Write-Host "== Process =="
Get-Process | Where-Object { $_.ProcessName -like 'codebase-memory-mcp*' } | Select-Object Id, ProcessName, StartTime

Write-Host "`n== Port =="
Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, State, OwningProcess

Write-Host "`n== HTTP / =="
try {
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
  Write-Host "Status:" $resp.StatusCode
} catch {
  Write-Host "Failed:" $_.Exception.Message
}

Write-Host "`n== RPC list_projects =="
$body = @{
  jsonrpc = '2.0'
  id = 1
  method = 'tools/call'
  params = @{ name = 'list_projects'; arguments = @{} }
} | ConvertTo-Json -Depth 8

try {
  $rpc = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/rpc" -ContentType 'application/json' -Body $body -TimeoutSec 10
  $rpc | ConvertTo-Json -Depth 10
} catch {
  Write-Host "Failed:" $_.Exception.Message
}
