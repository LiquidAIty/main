$ErrorActionPreference = "Stop"

$exePath = "C:\cbm\codebase-memory-mcp.exe"
$repoPath = (Resolve-Path ".\").Path
$configPath = Join-Path $repoPath ".mcp.json"

Write-Host "Repo path: $repoPath"
Write-Host "Checking executable: $exePath"

if (-not (Test-Path $exePath)) {
    Write-Error "Executable not found: $exePath"
    exit 1
}
Write-Host "Executable exists: Yes"

Write-Host "Checking MCP config: $configPath"
if (-not (Test-Path $configPath)) {
    Write-Error "MCP config not found: $configPath"
    exit 1
}

Write-Host "Config exists. Validating JSON..."
try {
    $json = Get-Content $configPath -Raw | ConvertFrom-Json
    Write-Host "JSON parse valid: Yes"
} catch {
    Write-Error "Failed to parse JSON in $($configPath): $_"
    exit 1
}

Write-Host "Testing executable with --help..."
try {
    & $exePath --help | Out-Null
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq $null) {
        Write-Host "Executable ran successfully with --help."
    } else {
        Write-Host "Executable returned exit code $LASTEXITCODE with --help."
    }
} catch {
    Write-Host "Executable failed to run with --help or returned error (ignoring if not supported)."
}

Write-Host "MCP check passed."
