$ErrorActionPreference = "Stop"

$version = "v0.9.1-rc.1"
$expectedVersion = "0.9.1-rc.1"
$assetName = "codebase-memory-mcp-windows-amd64.zip"
$expectedSha256 = "c6f65d94ac039e3a8fdc7bffac2e20fb0b0bc1d2d8d36de72ef34c531b8d4cbd"
$downloadUrl = "https://github.com/DeusData/codebase-memory-mcp/releases/download/$version/$assetName"
$checksumsUrl = "https://github.com/DeusData/codebase-memory-mcp/releases/download/$version/checksums.txt"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$installPath = Join-Path $repoPath ".tools\codebase-memory-mcp\bin"
$exePath = Join-Path $installPath "codebase-memory-mcp.exe"
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempPath = Join-Path $tempRoot ("liquidaity-cbm-" + [Guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $tempPath $assetName
$checksumsPath = Join-Path $tempPath "checksums.txt"
$extractPath = Join-Path $tempPath "extract"

if (Test-Path -LiteralPath $exePath -PathType Leaf) {
    $installedVersion = ((& $exePath --version 2>&1) | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $installedVersion -eq "codebase-memory-mcp $expectedVersion") {
        Write-Host "[mcp:setup] Repo-owned native CBM is already installed: $installedVersion"
        exit 0
    }
}

New-Item -ItemType Directory -Path $tempPath -Force | Out-Null

try {
    Write-Host "[mcp:setup] Downloading native CBM $version from the official release."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
    Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath -UseBasicParsing

    $publishedChecksums = @(
        Get-Content -LiteralPath $checksumsPath |
            ForEach-Object {
                if ($_ -match "^(?<digest>[0-9A-Fa-f]{64})\s+\*?$([Regex]::Escape($assetName))$") {
                    $Matches.digest.ToLowerInvariant()
                }
            } |
            Select-Object -Unique
    )
    if ($publishedChecksums.Count -ne 1) {
        throw "Official checksums.txt did not contain exactly one valid SHA-256 for $assetName."
    }
    if ($publishedChecksums[0] -ne $expectedSha256) {
        throw "Pinned checksum for $assetName does not match the official $version metadata. Expected $expectedSha256, published $($publishedChecksums[0])."
    }

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

    $installedVersion = ((& $exePath --version 2>&1) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $installedVersion -ne "codebase-memory-mcp $expectedVersion") {
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
