$ErrorActionPreference = 'Stop'

$env:LIQUIDAITY_MCP_TRANSPORT = 'streamable-http'
$env:LIQUIDAITY_HTTP_MCP_PORT = '8765'
$env:LIQUIDAITY_PUBLIC_MCP_RESOURCE_URL = 'https://exemption-unstable-wolverine.ngrok-free.dev/mcp'
$env:LIQUIDAITY_AUTH0_ISSUER_URL = 'https://dev-7up6xippkmhecz1j.us.auth0.com/'
$env:LIQUIDAITY_AUTH0_AUDIENCE = 'https://exemption-unstable-wolverine.ngrok-free.dev/mcp'
$env:LIQUIDAITY_AUTH0_CLIENT_ID = 'xBb72662qIvqibSf7SdCJZm8G4cL28ud'
$env:LIQUIDAITY_AUTH0_REQUIRED_SCOPE = 'liquidaity.main'
$env:LIQUIDAITY_MCP_OAUTH_ENFORCED = 'true'

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot 'apps\python-models\.venv\Scripts\python.exe'
$hostScript = Join-Path $repoRoot 'apps\python-models\app\mcp_host.py'

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw "Official Python MCP interpreter not found: $python"
}
if (-not (Test-Path -LiteralPath $hostScript -PathType Leaf)) {
  throw "Official Python MCP host not found: $hostScript"
}

& $python $hostScript
exit $LASTEXITCODE
