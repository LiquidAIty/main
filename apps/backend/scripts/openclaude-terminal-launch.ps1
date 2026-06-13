param(
  [string]$ModelKey = "",
  [string]$Provider = "",
  [string]$ProviderModelId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }
    $eqIndex = $line.IndexOf("=")
    if ($eqIndex -lt 1) {
      return
    }

    $name = $line.Substring(0, $eqIndex).Trim()
    $value = $line.Substring($eqIndex + 1).Trim()

    if (($value.StartsWith("'") -and $value.EndsWith("'")) -or ($value.StartsWith('"') -and $value.EndsWith('"'))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) {
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$backendEnvPath = Join-Path $repoRoot "apps\backend\.env"
$mcpConfigPath = Join-Path $repoRoot "apps\backend\mcp.config.json"
$openClaudeBin = Join-Path $repoRoot "localcoder\bin\openclaude"

Import-DotEnv -Path $backendEnvPath

if (-not $ModelKey) {
  throw "openclaude_terminal_model_key_required"
}
if (-not $Provider) {
  throw "openclaude_terminal_provider_required"
}
if (-not $ProviderModelId) {
  throw "openclaude_terminal_provider_model_id_required"
}

if (-not (Test-Path -LiteralPath $openClaudeBin)) {
  throw "openclaude_terminal_missing: expected $openClaudeBin"
}

# Force OpenClaude into OpenAI-compatible mode under backend-owned env.
$env:CLAUDE_CODE_USE_OPENAI = "1"
Remove-Item Env:CLAUDE_CODE_USE_GITHUB -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_USE_MISTRAL -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_USE_GEMINI -ErrorAction SilentlyContinue

$providerNormalized = ($Provider ?? "").Trim().ToLowerInvariant()
if ($providerNormalized -eq "openrouter") {
  if (-not $env:OPENROUTER_BASE_URL) {
    throw "openclaude_terminal_env_missing: OPENROUTER_BASE_URL"
  }
  $env:OPENAI_BASE_URL = $env:OPENROUTER_BASE_URL
  $env:OPENAI_API_KEY = $env:OPENROUTER_API_KEY
  $env:OPENAI_MODEL = $ProviderModelId
}
elseif ($providerNormalized -eq "openai") {
  if (-not $env:OPENAI_BASE_URL) {
    throw "openclaude_terminal_env_missing: OPENAI_BASE_URL"
  }
  $env:OPENAI_MODEL = $ProviderModelId
}
else {
  throw "openclaude_terminal_provider_unknown: $Provider"
}

if (-not $env:OPENAI_API_KEY -or -not $env:OPENAI_API_KEY.Trim()) {
  throw "openclaude_terminal_env_missing: OPENAI_API_KEY unresolved from backend env"
}

if (Test-Path -LiteralPath $mcpConfigPath) {
  & $openClaudeBin --mcp-config $mcpConfigPath
}
else {
  & $openClaudeBin
}
