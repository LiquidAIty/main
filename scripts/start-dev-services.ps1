$ErrorActionPreference = 'Stop'

$cbmCommand = Get-Command codebase-memory-mcp -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($null -eq $cbmCommand) {
  Write-Warning 'CBM unavailable: codebase-memory-mcp was not found on PATH; continuing LiquidAIty startup.'
} else {
  $cbmBinary = $cbmCommand.Source
  $env:MCP_CBM_BINARY = $cbmBinary
  Write-Host "CBM ready: path=$cbmBinary"
}

$secretBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $generator.GetBytes($secretBytes)
} finally {
  $generator.Dispose()
}

$env:LIQUIDAITY_INTERNAL_MCP_SECRET = [Convert]::ToBase64String($secretBytes)
$env:LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp'

& npm.cmd run dev:services
exit $LASTEXITCODE
