# LiquidAIty Windows dependency bootstrap.
# Third-party runtimes are installed beneath this repository; this script does
# not add tools to PATH, edit global agent registrations, or modify ACLs.

$ErrorActionPreference = "Stop"

$repoPath = (Resolve-Path $PSScriptRoot).Path
$setupScript = Join-Path $repoPath "scripts\setup-codebase-memory-mcp.ps1"
$checkScript = Join-Path $repoPath "scripts\check-codebase-memory-mcp.ps1"

Write-Host "[install] Bootstrapping LiquidAIty repository dependencies."
& $setupScript
if ($LASTEXITCODE -ne 0) {
    throw "Repo-owned CBM setup failed with exit code $LASTEXITCODE."
}

& $checkScript
if ($LASTEXITCODE -ne 0) {
    throw "Repo-owned CBM ownership check failed with exit code $LASTEXITCODE."
}

Write-Host "[install] PASS: repo-owned dependencies are installed and verified."
