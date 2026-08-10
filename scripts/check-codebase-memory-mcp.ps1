$ErrorActionPreference = "Stop"

$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$exePath = Join-Path $repoPath ".tools\codebase-memory-mcp\bin\codebase-memory-mcp.exe"
$expectedVersion = "codebase-memory-mcp 0.9.1-rc.1"
$repoConfigPath = Join-Path $repoPath ".mcp.json"
$backendConfigPath = Join-Path $repoPath "apps\backend\mcp.config.json"
$cursorConfigPath = Join-Path $repoPath ".cursor\mcp.json"
$zcodeConfigPath = Join-Path $repoPath ".zcode\config.json"

Write-Host "[mcp:check] Repo: $repoPath"

if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Repo-owned native CBM binary is missing. Run npm run mcp:setup."
}

foreach ($configPath in @($repoConfigPath, $backendConfigPath, $cursorConfigPath, $zcodeConfigPath)) {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $serialized = $config | ConvertTo-Json -Depth 20 -Compress
    if ($serialized -match 'codebase-memory') {
        throw "Alternate CBM registration remains in $configPath"
    }
}

if ($env:CBM_CACHE_DIR) {
    throw "CBM_CACHE_DIR override remains active: $env:CBM_CACHE_DIR"
}

$codexConfigPath = Join-Path $env:USERPROFILE ".codex\config.toml"
if (Test-Path -LiteralPath $codexConfigPath -PathType Leaf) {
    $codexLines = Get-Content -LiteralPath $codexConfigPath
    $section = [Array]::IndexOf($codexLines, '[mcp_servers.codebase-memory-mcp]')
    if ($section -lt 0) {
        throw "Codex native CBM registration is missing from $codexConfigPath"
    }
    $commandLine = $codexLines[($section + 1)..([Math]::Min($section + 4, $codexLines.Count - 1))] |
        Where-Object { $_ -match '^command\s*=' } |
        Select-Object -First 1
    if (-not $commandLine -or $commandLine -notmatch [Regex]::Escape('C:/Projects/main/.tools/codebase-memory-mcp/bin/codebase-memory-mcp.exe')) {
        throw "Codex native CBM command does not resolve to the repo-owned executable."
    }
}

$version = ((& $exePath --version 2>&1) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne $expectedVersion) {
    throw "Repo-owned native CBM binary failed version verification. Expected '$expectedVersion', got '$version'."
}

Write-Host "[mcp:check] Binary: $version"
Write-Host "[mcp:check] Cache: native daemon/default cache; no CBM_CACHE_DIR override"
Write-Host "[mcp:check] PASS: Codex is the only configured native CBM launcher."
Write-Host "[mcp:check] Index health must be proved through native MCP list_projects/index_status."
