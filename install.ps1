# LiquidAIty Windows dependency bootstrap.
# Codebase Memory is installed only in the Docker image. This script never
# installs a host binary, edits PATH, or registers CBM with an agent.

$ErrorActionPreference = "Stop"

$repoPath = (Resolve-Path $PSScriptRoot).Path
$expectedImage = "liquidaity-codegraph:0.10.8"
$expectedVersion = "codebase-memory-mcp 0.10.8"

Write-Host "[install] Building the checksum-pinned Docker CodeGraph image."
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Docker is unavailable."
}

& docker build --tag $expectedImage --file (Join-Path $repoPath "Dockerfile.codegraph") $repoPath
if ($LASTEXITCODE -ne 0) {
    throw "CodeGraph image build failed with exit code $LASTEXITCODE."
}

$version = ((& docker run --rm --entrypoint /opt/cbm/codebase-memory-mcp $expectedImage --version 2>&1) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne $expectedVersion) {
    throw "Docker CBM version verification failed. Expected '$expectedVersion', got '$version'."
}

Write-Host "[install] PASS: $expectedImage contains $version."
Write-Host "[install] CBM remains unregistered and uninstalled on the Windows host."
