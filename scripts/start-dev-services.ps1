$ErrorActionPreference = 'Stop'

$expectedVersion = 'codebase-memory-mcp 0.10.8'
$expectedSha256 = 'b4b403b1d7c4def3785f148b93f345ce8427858f4f5489ce28580c4387a336a6'
$cbmBinary = Join-Path $env:LOCALAPPDATA 'LiquidAIty\cbm\0.10.8\codebase-memory-mcp.exe'

if (-not (Test-Path -LiteralPath $cbmBinary -PathType Leaf)) {
  throw "Native CBM startup failed: AppData binary is missing at $cbmBinary"
}
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$binaryStream = [System.IO.File]::OpenRead($cbmBinary)
try {
  $actualSha256 = ([System.BitConverter]::ToString(
    $sha256.ComputeHash($binaryStream)
  ) -replace '-', '').ToLowerInvariant()
} finally {
  $binaryStream.Dispose()
  $sha256.Dispose()
}
if ($actualSha256 -ne $expectedSha256) {
  throw "Native CBM startup failed: checksum mismatch at $cbmBinary"
}
$actualVersion = (& $cbmBinary --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $actualVersion -ne $expectedVersion) {
  throw "Native CBM startup failed: expected $expectedVersion, received $actualVersion"
}
Write-Host "Native CBM binary ready: path=$cbmBinary version=$actualVersion"

$secretBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $generator.GetBytes($secretBytes)
} finally {
  $generator.Dispose()
}

$env:MCP_CBM_BINARY = $cbmBinary
$env:LIQUIDAITY_INTERNAL_MCP_SECRET = [Convert]::ToBase64String($secretBytes)
$env:LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp'

& npm.cmd run dev:services
exit $LASTEXITCODE
