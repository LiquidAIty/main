<#
.SYNOPSIS
  Generate Deep Zoom Image (DZI) tiles from a source image using libvips.

.PARAMETER InputImage
  Path to the source image (TIF, PNG, JPEG, etc.).

.PARAMETER OutputBase
  Output base path. The script will create:
    <OutputBase>.dzi
    <OutputBase>_files/

.PARAMETER TileSize
  Tile size in pixels. Default: 256.

.PARAMETER Quality
  JPEG quality for output tiles (0-100). Default: 90.

.EXAMPLE
  .\generate-dzi.ps1 `
    -InputImage .\telescope\weic2328a.tif `
    -OutputBase .\client\public\telescope-tiles\sagittarius-c\sagittarius-c
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$InputImage,

    [Parameter(Mandatory = $true)]
    [string]$OutputBase,

    [int]$TileSize = 256,

    [int]$Quality = 90
)

$ErrorActionPreference = "Stop"

# Add the local libvips build to PATH if available
$localVipsPath = "C:\Projects\LiquidAIty\main\vendor\vips\vips-dev-8.18\bin"
if (Test-Path $localVipsPath) {
    $env:PATH = "$localVipsPath;" + $env:PATH
}

# --- Validate input --------------------------------------------------------

$resolvedInput = Resolve-Path $InputImage -ErrorAction SilentlyContinue
if (-not $resolvedInput -or -not (Test-Path $resolvedInput)) {
    Write-Error "Input image not found: $InputImage"
    exit 1
}
Write-Host "[generate-dzi] Input:  $resolvedInput"

# --- Delete stale output ---------------------------------------------------
$dziFile = "$OutputBase.dzi"
$tileDir = "${OutputBase}_files"

if (Test-Path $dziFile) {
    Write-Host "[generate-dzi] Removing stale DZI: $dziFile"
    Remove-Item -Path $dziFile -Force
}
if (Test-Path $tileDir) {
    Write-Host "[generate-dzi] Removing stale tile dir: $tileDir"
    Remove-Item -Path $tileDir -Recurse -Force
}

# --- Check for vips CLI ----------------------------------------------------

$vipsCmd = Get-Command "vips" -ErrorAction SilentlyContinue
if (-not $vipsCmd) {
    # Fall back to the Python pyvips wrapper in the same directory
    $pyScript = Join-Path $PSScriptRoot "tile-image.py"
    if (Test-Path $pyScript) {
        Write-Host "[generate-dzi] vips CLI not found, falling back to tile-image.py"
        python $pyScript `
            --input $resolvedInput `
            --output-base $OutputBase `
            --tile-size $TileSize `
            --quality $Quality
        if ($LASTEXITCODE -ne 0) {
            Write-Error "[generate-dzi] tile-image.py failed."
            exit 1
        }
    } else {
        Write-Error "Neither 'vips' CLI nor tile-image.py found. Install libvips or pyvips."
        exit 1
    }
} else {
    # --- Ensure output directory exists ------------------------------------
    $outputDir = Split-Path $OutputBase -Parent
    if ($outputDir -and -not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
        Write-Host "[generate-dzi] Created directory: $outputDir"
    }

    Write-Host "[generate-dzi] Running: vips dzsave `"$resolvedInput`" `"$OutputBase`" --layout dz --tile-size $TileSize --suffix `".jpg[Q=$Quality]`""

    & vips dzsave "$resolvedInput" "$OutputBase" --layout dz --tile-size $TileSize --suffix ".jpg[Q=$Quality]"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "[generate-dzi] vips dzsave failed with exit code $LASTEXITCODE"
        exit 1
    }
}

# --- Validate output -------------------------------------------------------

if (-not (Test-Path $dziFile)) {
    Write-Error "[generate-dzi] Expected .dzi file not found: $dziFile"
    exit 1
}

if (-not (Test-Path $tileDir)) {
    Write-Error "[generate-dzi] Expected tile folder not found: $tileDir"
    exit 1
}

$dziSize = (Get-Item $dziFile).Length
$tiles = Get-ChildItem -Path $tileDir -Recurse -File -Include *.jpg,*.jpeg,*.png
$tileCount = if ($null -eq $tiles) { 0 } else { @($tiles).Count }
$levelFolders = Get-ChildItem -Path $tileDir -Directory
$levelFolderCount = if ($null -eq $levelFolders) { 0 } else { @($levelFolders).Count }

Write-Host ""
Write-Host "[generate-dzi] SUCCESS"
Write-Host "[generate-dzi]   .dzi file:   $dziFile ($dziSize bytes)"
Write-Host "[generate-dzi]   tile folder: $tileDir"
Write-Host "[generate-dzi]   tile count:  $tileCount"
Write-Host "[generate-dzi]   levels:      $levelFolderCount folders"

# Extra validation counts based on typical sizing for Sagittarius C
if ($tileCount -lt 50) {
    Write-Warning "[generate-dzi] Tile count is unusually low ($tileCount). Tiling likely failed or wrong input was used."
} elseif ($tileCount -ge 250 -and $tileCount -le 350) {
    Write-Host "[generate-dzi] Tile count $tileCount is expected for 256px tiles on a 5733x2169 source."
}

# --- Print public URL hint if under client/public --------------------------

$absOutputBase = (Resolve-Path $OutputBase -ErrorAction SilentlyContinue)
if (-not $absOutputBase) {
    $absOutputBase = [System.IO.Path]::GetFullPath($OutputBase)
}
$publicMarker = [regex]::Escape("client\public\")
if ($absOutputBase -match $publicMarker) {
    $relative = ($absOutputBase -split $publicMarker, 2)[1]
    $publicUrl = "/" + ($relative -replace "\\", "/") + ".dzi"
    Write-Host "[generate-dzi]   public URL:  $publicUrl"
}

exit 0
