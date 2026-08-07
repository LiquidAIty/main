$ErrorActionPreference = "Stop"

$version = "v0.9.0"
$assetName = "codebase-memory-mcp-windows-amd64.zip"
$expectedSha256 = "92f96896f952e539f0d6cb34d7892a25064b677ccbf808b8f8310ad897e86f2c"
$downloadUrl = "https://github.com/DeusData/codebase-memory-mcp/releases/download/$version/$assetName"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$installPath = Join-Path $repoPath ".tools\codebase-memory-mcp\bin"
$exePath = Join-Path $installPath "codebase-memory-mcp.exe"
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempPath = Join-Path $tempRoot ("liquidaity-cbm-" + [Guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $tempPath $assetName
$extractPath = Join-Path $tempPath "extract"

if (Test-Path -LiteralPath $exePath -PathType Leaf) {
    $installedVersion = & $exePath --version 2>&1
    if ($LASTEXITCODE -eq 0 -and $installedVersion -match "0\.9\.0") {
        Write-Host "[mcp:setup] Repo-owned native CBM is already installed: $installedVersion"
        exit 0
    }
}

New-Item -ItemType Directory -Path $tempPath -Force | Out-Null

try {
    Write-Host "[mcp:setup] Downloading native CBM $version from the official release."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath

    $actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $expectedSha256) {
        throw "Checksum mismatch for $assetName. Expected $expectedSha256, got $actualSha256."
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
    $downloadedExe = Get-ChildItem -LiteralPath $extractPath -Recurse -File -Filter "codebase-memory-mcp.exe" |
        Select-Object -First 1
    if (-not $downloadedExe) {
        throw "The official archive did not contain codebase-memory-mcp.exe."
    }

    New-Item -ItemType Directory -Path $installPath -Force | Out-Null
    Copy-Item -LiteralPath $downloadedExe.FullName -Destination $exePath -Force
    Unblock-File -LiteralPath $exePath

    $installedVersion = & $exePath --version 2>&1
    if ($LASTEXITCODE -ne 0 -or $installedVersion -notmatch "0\.9\.0") {
        throw "Installed repo-owned CBM failed version verification: $installedVersion"
    }

    Write-Host "[mcp:setup] Installed: $exePath"
    Write-Host "[mcp:setup] Version: $installedVersion"
    Write-Host "[mcp:setup] This script does not run CBM's broad install command or edit user-level agent registrations."
}
finally {
    $resolvedTempPath = [IO.Path]::GetFullPath($tempPath)
    if ($resolvedTempPath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTempPath).StartsWith("liquidaity-cbm-")) {
        Remove-Item -LiteralPath $resolvedTempPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}
