$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$hermesRoot = Join-Path $repoRoot 'Hermes'
$python = Join-Path $hermesRoot 'venv\Scripts\python.exe'
$profileRoot = Join-Path $hermesRoot '.hermes'

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw 'Hermes Python executable is unavailable.'
}
if (-not (Test-Path -LiteralPath (Join-Path $profileRoot 'config.yaml') -PathType Leaf)) {
  throw 'Hermes default profile is unavailable.'
}
if ([string]::IsNullOrWhiteSpace($env:HERMES_DASHBOARD_SESSION_TOKEN)) {
  throw 'Hermes Gateway credential is unavailable.'
}

$env:HERMES_HOME = $profileRoot
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

& $python -m hermes_cli.main -p default serve --host 127.0.0.1 --port 9119 --skip-build
exit $LASTEXITCODE
