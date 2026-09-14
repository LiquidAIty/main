param(
  [switch]$WaitForMcpReadiness
)

$ErrorActionPreference = 'Stop'

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
  # not terminate the canonical MCP host, native CBM, or application services.
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
