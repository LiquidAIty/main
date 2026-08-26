$ErrorActionPreference = 'Stop'

$expectedImage = 'codegraph:0.10.8'
$expectedVersion = 'codebase-memory-mcp 0.10.8'
$expectedVolume = 'codegraph-cache'
$cacheDestination = '/root/.cache/codebase-memory-mcp'
$containerName = 'codegraph'
$composeFile = (Resolve-Path (Join-Path $PSScriptRoot '..\compose.codegraph.yaml')).Path

& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'CodeGraph startup failed: Docker is unavailable.'
}

& docker compose --file $composeFile up --detach --build codegraph
if ($LASTEXITCODE -ne 0) {
  throw "CodeGraph startup failed: docker compose exited with $LASTEXITCODE."
}

$lastCodeGraphState = 'container unavailable'
$lastLoggedCodeGraphState = ''
$lastReasonabilityNotice = [DateTimeOffset]::UtcNow
$codeGraphReady = $false
while ($true) {
  $inspectionJson = & docker inspect $containerName 2>$null
  if ($LASTEXITCODE -eq 0) {
    $inspection = @($inspectionJson | ConvertFrom-Json)[0]
    $running = [bool]$inspection.State.Running
    $containerStatus = [string]$inspection.State.Status
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
    if ($running) {
      $binaryVersionOutput = & docker exec $containerName /usr/local/bin/codebase-memory-mcp --version 2>$null
      if ($LASTEXITCODE -eq 0) {
        $binaryVersion = ($binaryVersionOutput | Out-String).Trim()
      }
    }
    $mountedVolume = if ($cacheMount.Count -eq 1) { [string]$cacheMount[0].Name } else { 'missing' }
    $lastCodeGraphState = (
      "status=$containerStatus image=$image volume=$mountedVolume " +
      "binary=$binaryVersion"
    )
    $codeGraphReady = (
      $running -and
      $image -eq $expectedImage -and
      $volumeReady -and
      $binaryVersion -eq $expectedVersion
    )
    if ($codeGraphReady) {
      break
    }
    if (-not $running -and $containerStatus -in @('dead', 'exited', 'removing')) {
      throw "CodeGraph startup failed: $lastCodeGraphState"
    }
  }
  if ($lastCodeGraphState -ne $lastLoggedCodeGraphState) {
    Write-Host "CodeGraph readiness: $lastCodeGraphState"
    $lastLoggedCodeGraphState = $lastCodeGraphState
  }
  $now = [DateTimeOffset]::UtcNow
  if (($now - $lastReasonabilityNotice).TotalMinutes -ge 1) {
    Write-Warning "CodeGraph is still starting; current state: $lastCodeGraphState"
    $lastReasonabilityNotice = $now
  }
  Start-Sleep -Seconds 1
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
