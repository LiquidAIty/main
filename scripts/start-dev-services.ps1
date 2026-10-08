$ErrorActionPreference = 'Stop'

$secretBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $generator.GetBytes($secretBytes)
} finally {
  $generator.Dispose()
}

$env:LIQUIDAITY_INTERNAL_MCP_SECRET = [Convert]::ToBase64String($secretBytes)
$env:LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp'
$gatewayBytes = New-Object byte[] 32
$gatewayGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $gatewayGenerator.GetBytes($gatewayBytes)
} finally {
  $gatewayGenerator.Dispose()
}
$env:HERMES_DASHBOARD_SESSION_TOKEN = ([System.BitConverter]::ToString($gatewayBytes)).Replace('-', '').ToLowerInvariant()
$env:HERMES_GATEWAY_URL = 'ws://127.0.0.1:9119/api/ws'
# Supervised startup must never pause the backend build for an editor-extension
# installation prompt. The extension is optional and unrelated to runtime
# readiness; keep all Nx prompts disabled inside this service process tree.
$env:NX_SKIP_VSCODE_EXTENSION_INSTALL = 'true'
$env:NX_INTERACTIVE = 'false'

& npm.cmd run dev:services
exit $LASTEXITCODE
