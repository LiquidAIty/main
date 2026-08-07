$ErrorActionPreference = 'Stop'

$env:LIQUIDAITY_MCP_TRANSPORT = 'streamable-http'
$env:LIQUIDAITY_HTTP_MCP_PORT = '8765'
$env:LIQUIDAITY_PUBLIC_MCP_RESOURCE_URL = 'https://exemption-unstable-wolverine.ngrok-free.dev/mcp'
$env:LIQUIDAITY_AUTH0_ISSUER_URL = 'https://dev-7up6xippkmhecz1j.us.auth0.com/'
$env:LIQUIDAITY_AUTH0_AUDIENCE = 'https://exemption-unstable-wolverine.ngrok-free.dev/mcp'
$env:LIQUIDAITY_AUTH0_CLIENT_ID = 'xBb72662qIvqibSf7SdCJZm8G4cL28ud'
$env:LIQUIDAITY_AUTH0_REQUIRED_SCOPE = 'liquidaity.main'
$env:LIQUIDAITY_MCP_OAUTH_ENFORCED = 'true'
$env:LIQUIDAITY_CBM_UI_ENABLED = 'true'
$env:LIQUIDAITY_CBM_UI_PORT = '9749'

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot 'apps\python-models\.venv\Scripts\python.exe'
$hostScript = Join-Path $repoRoot 'apps\python-models\app\mcp_host.py'

function Test-TcpListener([string]$HostName, [int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.ConnectAsync($HostName, $Port)
    if (-not $connect.Wait(1000)) {
      return $false
    }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw "Official Python MCP interpreter not found: $python"
}
if (-not (Test-Path -LiteralPath $hostScript -PathType Leaf)) {
  throw "Official Python MCP host not found: $hostScript"
}

Write-Host '[dev] external HTTP MCP: waiting for canonical OpenClaude gRPC on 50051...'
$grpcReady = $false
for ($attempt = 1; $attempt -le 120; $attempt++) {
  if (Test-TcpListener '127.0.0.1' 50051) {
    $grpcReady = $true
    break
  }
  Start-Sleep -Seconds 1
}
if (-not $grpcReady) {
  throw 'canonical OpenClaude gRPC did not become ready on port 50051'
}
Write-Host '[dev] external HTTP MCP: gRPC ready; starting authenticated plugin host on 8765'

& $python $hostScript
exit $LASTEXITCODE
