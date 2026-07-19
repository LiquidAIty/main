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

# 4. Verify project registration in .mcp.json
$projectName = "C-Projects-main"
$found = $false
foreach ($server in $json.mcpServers.PSObject.Properties.Value) {
    if ($server.env.PROJECT_NAME -eq $projectName) {
        $found = $true
        break
    }
}
if (-not $found) {
    Write-Host "[mcp:check] WARN: Project '$projectName' not found in .mcp.json"
}

Write-Host "[mcp:check] PASS"
exit 0
