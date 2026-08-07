$ErrorActionPreference = 'Stop'

$metadataUrl = 'http://127.0.0.1:8765/.well-known/oauth-protected-resource/mcp'
Write-Host '[dev] tunnel: waiting for authenticated HTTP MCP on 8765...'

$mcpReady = $false
for ($attempt = 1; $attempt -le 120; $attempt++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $metadataUrl -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $mcpReady = $true
      break
    }
  } catch {
    # The HTTP MCP process is still initializing its authenticated catalog.
  }
  Start-Sleep -Seconds 1
}

if (-not $mcpReady) {
  throw 'authenticated HTTP MCP did not become ready on port 8765'
}

Write-Host '[dev] tunnel: HTTP MCP ready; exposing the authenticated transport'
& ngrok http --url=https://exemption-unstable-wolverine.ngrok-free.dev 8765
exit $LASTEXITCODE
