$ErrorActionPreference = 'Stop'

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
