param(
  [string]$ModelKey = "gpt-5.3-codex",
  [string]$Provider = "openai",
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
  $env:OPENAI_BASE_URL = if ($env:OPENROUTER_BASE_URL) { $env:OPENROUTER_BASE_URL } else { "https://api.openrouter.ai/v1" }
  $env:OPENAI_API_KEY = $env:OPENROUTER_API_KEY
  $env:OPENAI_MODEL = if ($ProviderModelId) { $ProviderModelId } else { "openai/gpt-5.3-codex" }
}
else {
  $env:OPENAI_BASE_URL = if ($env:OPENAI_BASE_URL) { $env:OPENAI_BASE_URL } else { "https://api.openai.com/v1" }
  if ($ProviderModelId) {
    $env:OPENAI_MODEL = $ProviderModelId
  }
  elseif (-not $env:OPENAI_MODEL) {
    $env:OPENAI_MODEL = $ModelKey
  }
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
