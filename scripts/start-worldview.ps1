$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$providerEnvPath = Join-Path $repoRoot 'apps/backend/.env'

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $escapedName = [Regex]::Escape($Name)
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch "^\s*$escapedName\s*=\s*(.*)$") { continue }
    $value = $Matches[1].Trim()
    if ($value.Length -ge 2) {
      $first = $value[0]
      $last = $value[$value.Length - 1]
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    return $value
  }
  return $null
}

# The former client-Vite import injected these existing provider settings while
# compiling the WorldView module graph. The public :4174 module doorway must inherit
# the same values so moving that graph does not silently downgrade the renderer.
foreach ($name in @('GOOGLE_MAPS_API_KEY', 'CESIUM_ION_TOKEN')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
    $value = Get-DotEnvValue -Path $providerEnvPath -Name $name
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
}

Push-Location $repoRoot
try {
  & npm.cmd --prefix agent-products/gods-eye-view run dev -- --host 127.0.0.1 --port 4174 --strictPort
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
