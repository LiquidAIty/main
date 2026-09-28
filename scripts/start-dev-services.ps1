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
# Supervised startup must never pause the backend build for an editor-extension
# installation prompt. The extension is optional and unrelated to runtime
# readiness; keep all Nx prompts disabled inside this service process tree.
$env:NX_SKIP_VSCODE_EXTENSION_INSTALL = 'true'
$env:NX_INTERACTIVE = 'false'

& npm.cmd run dev:services
exit $LASTEXITCODE
