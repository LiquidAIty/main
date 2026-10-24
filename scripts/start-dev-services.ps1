# Entity: Application Startup
# Relationship: This script starts the canonical local data and application services with process-scoped internal credentials and fails closed on missing required configuration.

$ErrorActionPreference = 'Stop'

function Read-SelectedEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required environment file is unavailable: $Path"
  }
  $prefix = "$Name="
  $line = Get-Content -LiteralPath $Path | Where-Object {
    $_.StartsWith($prefix, [System.StringComparison]::Ordinal)
  } | Select-Object -Last 1
  if ($null -eq $line) {
    return ''
  }
  $value = $line.Substring($prefix.Length).Trim()
  if ($value.Length -ge 2 -and (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  )) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

$backendEnvPath = 'apps/backend/.env'
if (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  $databaseUrl = $env:DATABASE_URL
} else {
  $databaseUrl = Read-SelectedEnvValue -Path $backendEnvPath -Name 'DATABASE_URL'
}
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw 'DATABASE_URL is required to start PostgreSQL.'
}
if ([string]::IsNullOrWhiteSpace($env:POSTGRES_PASSWORD)) {
  $databaseUri = [Uri]$databaseUrl
  $databaseIdentity = $databaseUri.UserInfo.Split(':', 2)
  if ($databaseIdentity.Count -ne 2 -or [string]::IsNullOrWhiteSpace($databaseIdentity[1])) {
    throw 'DATABASE_URL does not contain the PostgreSQL credential required by Compose.'
  }
  $env:POSTGRES_PASSWORD = [Uri]::UnescapeDataString($databaseIdentity[1])
}
if ([string]::IsNullOrWhiteSpace($env:NEO4J_PASSWORD)) {
  $env:NEO4J_PASSWORD = Read-SelectedEnvValue -Path $backendEnvPath -Name 'NEO4J_PASSWORD'
}
if ([string]::IsNullOrWhiteSpace($env:NEO4J_PASSWORD)) {
  throw 'NEO4J_PASSWORD is required to start Neo4j.'
}

& docker compose --env-file apps/backend/.env -f docker-compose.yml up -d --wait
if ($LASTEXITCODE -ne 0) {
  throw "Database services failed to start with exit code $LASTEXITCODE."
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
