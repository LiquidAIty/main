$ErrorActionPreference = "Stop"

$exePath = "C:\cbm\codebase-memory-mcp.exe"
$repoPath = (Resolve-Path ".\").Path
$configPath = Join-Path $repoPath ".mcp.json"

Write-Host "[mcp:check] Repo: $repoPath"

# 1. Executable exists
if (-not (Test-Path $exePath)) {
    Write-Error "[mcp:check] FAIL: Executable not found at $exePath"
    exit 1
}
Write-Host "[mcp:check] Executable: $exePath"

# 2. .mcp.json config exists and is valid JSON
if (-not (Test-Path $configPath)) {
    Write-Error "[mcp:check] FAIL: .mcp.json not found at $configPath"
    exit 1
}
try {
    $json = Get-Content $configPath -Raw | ConvertFrom-Json
    Write-Host "[mcp:check] .mcp.json: valid"
} catch {
    Write-Error "[mcp:check] FAIL: .mcp.json invalid JSON: $_"
    exit 1
}

# 3. Version check
try {
    $ver = & $exePath --version 2>&1
    Write-Host "[mcp:check] Version: $ver"
} catch {
    Write-Host "[mcp:check] WARN: --version not supported"
}

# 4. Verify the configured server and the canonical indexed project.
$projectName = "C-Projects-main"
$server = $json.mcpServers.'codebase-memory'
if (-not $server) {
    Write-Error "[mcp:check] FAIL: .mcp.json has no codebase-memory server"
    exit 1
}
if ([IO.Path]::GetFullPath([string]$server.command) -ne [IO.Path]::GetFullPath($exePath)) {
    Write-Error "[mcp:check] FAIL: .mcp.json command does not match $exePath"
    exit 1
}
if ([IO.Path]::GetFullPath([string]$server.env.CODEBASE_ROOT) -ne [IO.Path]::GetFullPath($repoPath)) {
    Write-Error "[mcp:check] FAIL: CODEBASE_ROOT does not match $repoPath"
    exit 1
}

try {
    $statusRaw = & $exePath cli index_status --project $projectName
    if ($LASTEXITCODE -ne 0) {
        throw "index_status exited $LASTEXITCODE"
    }
    $status = $statusRaw | ConvertFrom-Json
    if ($status.status -ne "ready") {
        throw "canonical project status is '$($status.status)'"
    }
    if ([IO.Path]::GetFullPath([string]$status.root_path) -ne [IO.Path]::GetFullPath($repoPath)) {
        throw "canonical project root '$($status.root_path)' does not match '$repoPath'"
    }
    Write-Host "[mcp:check] Project: $projectName ready ($($status.nodes) nodes, $($status.edges) edges)"
} catch {
    Write-Error "[mcp:check] FAIL: canonical project check failed: $_"
    exit 1
}

Write-Host "[mcp:check] PASS"
exit 0
