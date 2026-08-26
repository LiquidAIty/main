$ErrorActionPreference = 'Stop'

$expectedImage = 'liquidaity-codegraph:0.10.8'
$expectedVersion = 'codebase-memory-mcp 0.10.8'
$expectedVolume = 'liquidaity-cbm-cache'
$cacheDestination = '/root/.cache/codebase-memory-mcp'

& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'CodeGraph startup failed: Docker is unavailable.'
}

# Compose interpolates required secrets for services that are not selected. Give
# those unused services temporary parse-only values without changing their runtime.
$composeOnlyVariables = @('POSTGRES_PASSWORD', 'NEO4J_PASSWORD')
$savedComposeVariables = @{}
foreach ($name in $composeOnlyVariables) {
  $savedComposeVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ([string]::IsNullOrWhiteSpace($savedComposeVariables[$name])) {
    [Environment]::SetEnvironmentVariable($name, '__codegraph_service_not_selected__', 'Process')
  }
}
try {
  & docker compose up --detach --build --no-deps codegraph
  if ($LASTEXITCODE -ne 0) {
    throw "CodeGraph startup failed: docker compose exited with $LASTEXITCODE."
  }
} finally {
  foreach ($name in $composeOnlyVariables) {
    [Environment]::SetEnvironmentVariable($name, $savedComposeVariables[$name], 'Process')
  }
}

$deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
$lastCodeGraphState = 'container unavailable'
$codeGraphReady = $false
while ([DateTimeOffset]::UtcNow -lt $deadline) {
  $inspectionJson = & docker inspect codegraph 2>$null
  if ($LASTEXITCODE -eq 0) {
    $inspection = @($inspectionJson | ConvertFrom-Json)[0]
    $health = [string]$inspection.State.Health.Status
    $image = [string]$inspection.Config.Image
    $cacheMount = @($inspection.Mounts | Where-Object {
      [string]$_.Destination -eq $cacheDestination
    })
    $volumeReady = (
      $cacheMount.Count -eq 1 -and
      [string]$cacheMount[0].Type -eq 'volume' -and
      [string]$cacheMount[0].Name -eq $expectedVolume
    )
    $binaryVersion = ''
    if ($health -eq 'healthy') {
      $binaryVersion = (& docker exec codegraph /opt/cbm/codebase-memory-mcp --version).Trim()
    }
    $lastCodeGraphState = (
      "health=$health image=$image volume=$($cacheMount[0].Name) " +
      "binary=$binaryVersion"
    )
    $codeGraphReady = (
      [bool]$inspection.State.Running -and
      $health -eq 'healthy' -and
      $image -eq $expectedImage -and
      $volumeReady -and
      $binaryVersion -eq $expectedVersion
    )
    if ($codeGraphReady) {
      break
    }
    if ($health -eq 'unhealthy') {
      throw "CodeGraph startup failed: $lastCodeGraphState"
    }
  }
  Start-Sleep -Seconds 1
}
if (-not $codeGraphReady) {
  throw "CodeGraph startup timed out: $lastCodeGraphState"
}
Write-Host "CodeGraph container ready: $lastCodeGraphState"

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
