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

# WorldSignals persists its direct-agent HMAC inside the existing Docker volume.
# Start the product first, then read that already-established credential through
# its trusted frontend operator proxy so Python rails inherits it in memory.
# Bootstrap only when the product confirms no credential exists; never rotate,
# print, or persist a second copy here.
& npm.cmd run dev:worldsignals
$worldSignalsExitCode = $LASTEXITCODE
if ($worldSignalsExitCode -ne 0) {
  Write-Warning "WorldSignals startup stopped with exit code $worldSignalsExitCode; Python rails will report the provider as unavailable."
} else {
  $connectInfoUrl = 'http://127.0.0.1:3000/api/ai/connect-info'
  $revealUrl = 'http://127.0.0.1:3000/api/ai/connect-info/reveal'
  $connectInfo = $null
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(2)

  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    try {
      $candidate = Invoke-RestMethod -Uri $connectInfoUrl -Method Get -TimeoutSec 3
      if ([bool]$candidate.ok) {
        $connectInfo = $candidate
        break
      }
    } catch {
      # The Docker health check may still be warming; retry within the bound.
    }
    Start-Sleep -Seconds 1
  }

  if ($null -eq $connectInfo) {
    Write-Warning 'WorldSignals operator proxy did not become ready; Python rails will report the provider as unavailable.'
  } else {
    try {
      if (-not [bool]$connectInfo.hmac_secret_set) {
        $bootstrapped = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/ai/connect-info/bootstrap' -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 5
        if (-not [bool]$bootstrapped.ok -or -not [bool]$bootstrapped.hmac_secret_set) {
          throw 'WorldSignals credential bootstrap readback failed.'
        }
      }
      $revealed = Invoke-RestMethod -Uri $revealUrl -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 5
      $secret = [string]$revealed.hmac_secret
      if (-not [bool]$revealed.ok -or $secret.Length -lt 32) {
        throw 'WorldSignals returned an invalid credential readback.'
      }
      $env:WORLDSIGNALS_HMAC_SECRET = $secret
      Write-Host 'WorldSignals existing HMAC credential is loaded for dependent services.'
    } catch {
      Write-Warning 'WorldSignals credential readback failed; Python rails will report the provider as unavailable.'
    }
  }
}

& npm.cmd run dev:dependent-services
exit $LASTEXITCODE
