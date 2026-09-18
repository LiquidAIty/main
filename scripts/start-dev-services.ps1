$ErrorActionPreference = 'Stop'

$cbmCommand = Get-Command codebase-memory-mcp -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($null -eq $cbmCommand) {
  throw 'Native CBM startup failed: codebase-memory-mcp is not installed on PATH'
}
$cbmBinary = $cbmCommand.Source
Write-Host "Native CBM command ready: path=$cbmBinary"

$secretBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $generator.GetBytes($secretBytes)
} finally {
  $generator.Dispose()
}

$env:MCP_CBM_BINARY = $cbmBinary
$env:LIQUIDAITY_INTERNAL_MCP_SECRET = [Convert]::ToBase64String($secretBytes)
$env:LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp'

& npm.cmd run dev:services
exit $LASTEXITCODE
