$ErrorActionPreference = "Stop"

$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$exePath = Join-Path $repoPath ".tools\codebase-memory-mcp\bin\codebase-memory-mcp.exe"
$indexPath = Join-Path $repoPath ".codebase-memory\index"
$repoConfigPath = Join-Path $repoPath ".mcp.json"
$backendConfigPath = Join-Path $repoPath "apps\backend\mcp.config.json"

function Assert-EqualPath {
    param(
        [Parameter(Mandatory = $true)][string]$Actual,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ([IO.Path]::GetFullPath($Actual) -ne [IO.Path]::GetFullPath($Expected)) {
        throw "$Label '$Actual' does not match '$Expected'"
    }
}

Write-Host "[mcp:check] Repo: $repoPath"

if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Repo-owned native CBM binary is missing. Run npm run mcp:setup."
}

$repoConfig = Get-Content -LiteralPath $repoConfigPath -Raw | ConvertFrom-Json
$backendConfig = Get-Content -LiteralPath $backendConfigPath -Raw | ConvertFrom-Json
$repoServer = $repoConfig.mcpServers.'codebase-memory'
$backendServer = $backendConfig.mcpServers.'codebase-memory'

if (-not $repoServer -or -not $backendServer) {
    throw "Both repo MCP configurations must contain the codebase-memory server."
}

Assert-EqualPath -Actual ([string]$repoServer.command) -Expected $exePath -Label ".mcp.json command"
Assert-EqualPath -Actual ([string]$backendServer.command) -Expected $exePath -Label "backend command"
Assert-EqualPath -Actual ([string]$repoServer.env.CBM_ALLOWED_ROOT) -Expected $repoPath -Label ".mcp.json allowed root"
Assert-EqualPath -Actual ([string]$backendServer.env.CBM_ALLOWED_ROOT) -Expected $repoPath -Label "backend allowed root"
Assert-EqualPath -Actual ([string]$repoServer.env.CBM_CACHE_DIR) -Expected $indexPath -Label ".mcp.json index store"
Assert-EqualPath -Actual ([string]$backendServer.env.CBM_CACHE_DIR) -Expected $indexPath -Label "backend index store"

$version = & $exePath --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Repo-owned native CBM binary failed its version check."
}

Write-Host "[mcp:check] Binary: $version"
Write-Host "[mcp:check] Index store: $indexPath"
Write-Host "[mcp:check] PASS: installation and ownership are isolated."
Write-Host "[mcp:check] Index health must be proved through native MCP list_projects/index_status."
