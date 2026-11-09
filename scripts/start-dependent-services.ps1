# Entity: Application Startup
# Relationship: Sequences frontend, Python rails, WorldView, and MCP readiness through the existing service commands; the dormant ShadowBroker product is not a startup dependency.

param(
  [switch]$WaitForMcpReadiness,
  [switch]$StartFrontendAfterApplicationReadiness
)

$ErrorActionPreference = 'Stop'

if (@(
  [bool]$WaitForMcpReadiness,
  [bool]$StartFrontendAfterApplicationReadiness
).Where({ $_ }).Count -gt 1) {
  throw 'Dependent-service startup modes are mutually exclusive.'
}

if ($StartFrontendAfterApplicationReadiness) {
  $pythonRailsHealthUrl = 'http://127.0.0.1:8003/health'
  $mcpReadinessUrl = 'http://127.0.0.1:8765/health/ready'
  $lastFrontendState = ''
  $lastFrontendNotice = [DateTimeOffset]::UtcNow

  while ($true) {
    $pythonRailsReady = $false
    $mcpReady = $false
    try {
      $pythonHealth = Invoke-RestMethod -Uri $pythonRailsHealthUrl -Method Get -TimeoutSec 2
      $pythonRailsReady = [string]$pythonHealth.status -eq 'ok'
    } catch {
      $pythonRailsReady = $false
    }
    try {
      $mcpResponse = Invoke-WebRequest -Uri $mcpReadinessUrl -Method Get -UseBasicParsing -TimeoutSec 2
      $mcpReady = [int]$mcpResponse.StatusCode -eq 200
    } catch {
      $mcpReady = $false
    }
    if ($pythonRailsReady -and $mcpReady) {
      break
    }

    $frontendState = "python-rails=$pythonRailsReady mcp=$mcpReady"
    if ($frontendState -ne $lastFrontendState) {
      Write-Host "Frontend readiness: $frontendState"
      $lastFrontendState = $frontendState
    }
    $now = [DateTimeOffset]::UtcNow
    if (($now - $lastFrontendNotice).TotalMinutes -ge 1) {
      Write-Warning "Frontend is waiting for application services: $frontendState"
      $lastFrontendNotice = $now
    }
    Start-Sleep -Seconds 1
  }

  Write-Host 'Python rails and MCP are ready; starting the frontend.'
  & npm.cmd --workspace client run dev -- --strictPort
  exit $LASTEXITCODE
}

if ($WaitForMcpReadiness) {
  $mcpReadinessUrl = 'http://127.0.0.1:8765/health/ready'
  $lastMcpState = ''
  $lastMcpNotice = [DateTimeOffset]::UtcNow

  while ($true) {
    $mcpState = 'MCP unavailable'
    try {
      $response = Invoke-WebRequest -Uri $mcpReadinessUrl -Method Get -UseBasicParsing -TimeoutSec 2
      if ([int]$response.StatusCode -eq 200) {
        break
      }
      $mcpState = "MCP responded with HTTP $([int]$response.StatusCode)"
    } catch {
      $statusCode = [int]$_.Exception.Response.StatusCode
      if ($statusCode -gt 0) {
        $mcpState = "MCP responded with HTTP $statusCode"
      }
    }

    if ($mcpState -ne $lastMcpState) {
      Write-Host "MCP publication readiness: $mcpState"
      $lastMcpState = $mcpState
    }
    $now = [DateTimeOffset]::UtcNow
    if (($now - $lastMcpNotice).TotalMinutes -ge 1) {
      Write-Warning "MCP is still starting; public tunnel remains unpublished: $mcpState"
      $lastMcpNotice = $now
    }
    Start-Sleep -Seconds 1
  }

  Write-Host 'MCP ready; starting the public tunnel.'
  & npm.cmd run dev:tunnel
  $tunnelExitCode = $LASTEXITCODE
  if ($tunnelExitCode -ne 0) {
    Write-Warning "Optional public MCP tunnel stopped with exit code $tunnelExitCode; the local MCP host and internal clients remain running."
  } else {
    Write-Host 'Optional public MCP tunnel stopped; the local MCP host and internal clients remain running.'
  }
  # This command is one optional sibling under concurrently. Its failure must
  # not terminate the canonical MCP host, CBM, or application services.
  exit 0
}

$backendHealthUrl = 'http://127.0.0.1:4000/api/health'
$lastState = ''
$lastReasonabilityNotice = [DateTimeOffset]::UtcNow

while ($true) {
  $state = 'backend unavailable'
  try {
    $health = Invoke-RestMethod -Uri $backendHealthUrl -Method Get
    if ([string]$health.status -eq 'ok') {
      break
    }
    $state = "backend responded with status=$([string]$health.status)"
  } catch {
    $state = 'backend unavailable'
  }

  if ($state -ne $lastState) {
    Write-Host "Backend readiness: $state"
    $lastState = $state
  }
  $now = [DateTimeOffset]::UtcNow
  if (($now - $lastReasonabilityNotice).TotalMinutes -ge 1) {
    Write-Warning "Backend is still starting; current state: $state"
    $lastReasonabilityNotice = $now
  }
  Start-Sleep -Seconds 1
}

Write-Host 'Backend ready; starting dependent services.'

& npm.cmd run dev:dependent-services
exit $LASTEXITCODE
