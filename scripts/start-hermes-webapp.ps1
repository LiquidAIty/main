# Entity: Hermes Webapp Integration
# Relationship: Installs only the repo-owned native plugin runtime, builds the existing LiquidAIty UI once in its existing dist directory, then starts the official Hermes browser host against that exact bundle.

param([switch]$SignInOnly)

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
$railsPython = Join-Path $repoRoot 'apps\python-models\.venv\Scripts\python.exe'
$webappDist = Join-Path $repoRoot 'client\dist'
$nativePluginSource = Join-Path $repoRoot 'apps\hermes-liquidaity-plugin'
$nativePluginFiles = @(
  '__init__.py',
  'card_script_runtime.py',
  'plugin.yaml',
  'taskgraph_runtime.py'
)
$retiredNativePluginFiles = @('navigation_map.py')

if (-not (Test-Path -LiteralPath $hermesPython -PathType Leaf)) {
  throw "Hermes Python runtime is unavailable: $hermesPython"
}
foreach ($name in $nativePluginFiles) {
  $source = Join-Path $nativePluginSource $name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "The native LiquidAIty Hermes plugin source is unavailable: $source"
  }
}

$profileDiscovery = @'
import json, pathlib, sys, yaml
root = pathlib.Path(sys.argv[1])
homes = [root]
for profile in sorted((root / 'profiles').iterdir()):
    config = profile / 'config.yaml'
    if not config.is_file():
        continue
    plugins = (yaml.safe_load(config.read_text(encoding='utf-8')) or {}).get('plugins', {})
    if 'liquidaity' in plugins.get('enabled', []) and 'liquidaity' not in plugins.get('disabled', []):
        homes.append(profile)
print(json.dumps([str(home) for home in homes]))
'@
$pluginHomes = & $railsPython -X utf8 -c $profileDiscovery $hermesHome
if ($LASTEXITCODE -ne 0) {
  throw 'Could not read the profiles that enable the application plugin.'
}
foreach ($pluginHome in $(if ($SignInOnly) { @() } else { $pluginHomes | ConvertFrom-Json })) {
  $nativePluginRoot = Join-Path $pluginHome 'plugins\liquidaity'
  New-Item -ItemType Directory -Path $nativePluginRoot -Force | Out-Null
  if (Test-Path -LiteralPath (Join-Path $nativePluginRoot 'dashboard')) {
    throw "Rejected Hermes Dashboard residue is present under $nativePluginRoot."
  }
  foreach ($name in $retiredNativePluginFiles) {
    $retired = Join-Path $nativePluginRoot $name
    if (Test-Path -LiteralPath $retired -PathType Leaf) {
      Remove-Item -LiteralPath $retired -Force
    }
  }
  foreach ($name in $nativePluginFiles) {
    $source = Join-Path $nativePluginSource $name
    $destination = Join-Path $nativePluginRoot $name
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
      if ((Get-Sha256 -Path $source) -eq (Get-Sha256 -Path $destination)) {
        continue
      }
    }
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
}

Push-Location $repoRoot
try {
  if (-not $SignInOnly) {
    & npm.cmd --workspace client run build
    if ($LASTEXITCODE -ne 0) {
      throw "LiquidAIty UI builds failed with exit code $LASTEXITCODE."
    }
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
  if (-not $SignInOnly) {
    $gatewayOutput = & $hermesPython -X utf8 -m hermes_cli.main gateway ensure --timeout 180
    if ($LASTEXITCODE -ne 0) {
      throw "Hermes Gateway did not become ready within 180 seconds."
    }
  }
  # Mint only after build/readiness. The raw application URL cannot authorize
  # a fresh Preview tab; Hermes's one-use fragment must reach that same tab.
  $launchOutput = & $hermesPython -X utf8 -m hermes_cli.main webapp --no-open --skip-build
  if ($LASTEXITCODE -ne 0) { throw 'Hermes Webapp sign-in link creation failed.' }
  $launchUrl = @($launchOutput | ForEach-Object {
    if ($_ -match '(https?://\S+)') { $Matches[1] }
  }) | Select-Object -Last 1
  if ([string]::IsNullOrWhiteSpace($launchUrl)) {
    throw 'Hermes Webapp did not return a sign-in URL. Preview is not ready.'
  }
  $launchUri = [Uri]$launchUrl
  if ($launchUri.AbsolutePath.EndsWith('/webapp/launch') -and
      $launchUri.Fragment -notmatch '(^#|&)ticket=[A-Za-z0-9_-]{43}(&|$)') {
    throw 'Hermes Webapp returned an incomplete launch link. Preview is not ready.'
  }
  if ($launchUri.AbsolutePath.EndsWith('/webapp/launch')) {
    # A fragment-only change in an already-open launch page does not execute
    # Hermes's handoff script again. Force a fresh document in that same tab;
    # Hermes still owns and consumes the unchanged one-use ticket.
    $freshPage = [UriBuilder]$launchUri
    $freshPage.Query = 'launch=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $launchUrl = $freshPage.Uri.AbsoluteUri
  }
  Write-Output 'Open this fresh Hermes sign-in link in the SAME visible Codex Preview tab; keep its complete fragment.'
  Write-Output 'For an expired or used link, refresh sign-in without rebuilding: npm run dev:hermes-webapp -- -SignInOnly'
  Write-Output $launchUrl
  exit 0
} finally {
  Pop-Location
}
