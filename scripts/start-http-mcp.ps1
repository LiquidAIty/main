$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $repoRoot 'apps\python-models\.venv\Scripts\python.exe'
$hostScript = Join-Path $repoRoot 'apps\python-models\app\mcp_host.py'

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw "Python MCP interpreter not found: $python"
}
if (-not (Test-Path -LiteralPath $hostScript -PathType Leaf)) {
  throw "Python MCP host not found: $hostScript"
}

$env:LIQUIDAITY_MCP_TRANSPORT = 'streamable-http'
$env:LIQUIDAITY_HTTP_MCP_PORT = '8765'
$env:LIQUIDAITY_PUBLIC_MCP_RESOURCE_URL = 'https://exemption-unstable-wolverine.ngrok-free.dev/mcp'
$env:LIQUIDAITY_CBM_UI_ENABLED = 'true'
$env:LIQUIDAITY_CBM_UI_PORT = '9749'

& $python -X utf8 $hostScript
exit $LASTEXITCODE
