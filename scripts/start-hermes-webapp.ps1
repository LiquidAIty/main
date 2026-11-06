# Entity: Hermes Webapp Integration
# Relationship: Installs only the repo-owned native plugin runtime, builds the existing LiquidAIty UI once in its existing dist directory, then starts the official Hermes browser host against that exact bundle.

$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$Path) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '')
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$hermesRoot = Join-Path $repoRoot 'HermesLatest'
$hermesHome = Join-Path $hermesRoot '.hermes'
$hermesPython = Join-Path $hermesRoot '.venv\Scripts\python.exe'
$webappDist = Join-Path $repoRoot 'client\dist'
$nativePluginSource = Join-Path $repoRoot 'apps\hermes-liquidaity-plugin'
$nativePluginRoot = Join-Path $hermesHome 'plugins\liquidaity'
$nativePlugin = Join-Path $nativePluginRoot 'plugin.yaml'
$nativePluginFiles = @(
  '__init__.py',
  'card_script_runtime.py',
  'navigation_map.py',
  'plugin.yaml',
  'taskgraph_runtime.py'
)

if (-not (Test-Path -LiteralPath $hermesPython -PathType Leaf)) {
  throw "Hermes Python runtime is unavailable: $hermesPython"
}
foreach ($name in $nativePluginFiles) {
  $source = Join-Path $nativePluginSource $name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "The native LiquidAIty Hermes plugin source is unavailable: $source"
  }
}

New-Item -ItemType Directory -Path $nativePluginRoot -Force | Out-Null
if (Test-Path -LiteralPath (Join-Path $nativePluginRoot 'dashboard')) {
  throw "Rejected Hermes Dashboard residue is present under the native LiquidAIty plugin."
}
foreach ($name in $nativePluginFiles) {
  $source = Join-Path $nativePluginSource $name
  $destination = Join-Path $nativePluginRoot $name
  if (Test-Path -LiteralPath $destination -PathType Leaf) {
    $sourceHash = Get-Sha256 -Path $source
    $destinationHash = Get-Sha256 -Path $destination
    if ($sourceHash -eq $destinationHash) {
      continue
    }
  }
  Copy-Item -LiteralPath $source -Destination $destination -Force
}
if (-not (Test-Path -LiteralPath $nativePlugin -PathType Leaf)) {
  throw "The native LiquidAIty Hermes plugin install is unavailable: $nativePlugin"
}

Push-Location $repoRoot
try {
  & npm.cmd --workspace client run build
  if ($LASTEXITCODE -ne 0) {
    throw "LiquidAIty UI builds failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$env:HERMES_HOME = $hermesHome
$webappDist = (Resolve-Path -LiteralPath $webappDist).Path
$env:HERMES_WEBAPP_DIST = $webappDist
Write-Output "LiquidAIty Webapp renderer: $webappDist"

Push-Location $hermesRoot
try {
  & $hermesPython -X utf8 -m hermes_cli.main gateway ensure --timeout 180
  if ($LASTEXITCODE -ne 0) {
    throw "Hermes Gateway did not become ready within 180 seconds."
  }
  & $hermesPython -X utf8 -m hermes_cli.main webapp --no-open --skip-build
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
