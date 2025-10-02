param(
  [ValidateSet("None","Next")]
  [string]$Scaffold = "None"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath ".\nx.json")) {
  Write-Error "Run this script from the repository root (where nx.json lives)."
}

$stamp   = (Get-Date).ToString("yyyyMMdd-HHmmss")
$outDir  = "audit-$stamp"
$treeOut = Join-Path $outDir "repo_tree.txt"
$snapDir = Join-Path $outDir "snapshot"
$mdOut   = Join-Path $outDir "audit_bundle.md"
$envOut  = Join-Path $outDir "env_check.txt"
New-Item -ItemType Directory -Force -Path $outDir,$snapDir | Out-Null

# 1) Folder tree
try {
  (tree /F /A) 2>$null |
    Select-String -Pattern "node_modules","\.git\\","\\dist\\","\\build\\","\\out\\","\\coverage\\" -NotMatch |
    Out-File -Encoding UTF8 $treeOut
} catch {
  Get-ChildItem -Recurse -Force |
    Where-Object { $_.FullName -notmatch "\\node_modules\\|\\\.git\\|\\dist\\|\\build\\|\\out\\|\\coverage\\" } |
    Select-Object FullName |
    Out-File -Encoding UTF8 $treeOut
}

# 2) Snapshot key files
$includeGlobs = @(
  # JS/TS
  "package.json","package-lock.json","pnpm-lock.yaml","yarn.lock",
  "nx.json","tsconfig.base.json","vite.config.*","tailwind.config.*",
  ".npmrc",".nvmrc",".tool-versions",".gitignore",
  # Docker
  "docker-compose.*","Dockerfile","docker\**\*",
  # Apps/Libs TS/JS
  "apps\**\project.json","apps\**\src\**\*.ts","apps\**\src\**\*.tsx","apps\**\src\**\*.js","apps\**\src\**\*.json",
  "libs\**\project.json","libs\**\src\**\*.ts","libs\**\src\**\*.tsx","libs\**\src\**\*.js","libs\**\src\**\*.json",
  # Prisma
  "prisma\schema.prisma","prisma\migrations\**\*.sql",
  # Python bolt-ons
  "python_models\**\*.py","python_boltons\**\*.py","scripts\**\*.py","scripts\**\*.sh",
  # VSCode / Windsurf
  ".vscode\**\*","windsurf\**\*",
  # Other config
  "*.env*","*.yml","*.yaml"
)
$exclusions = "\\node_modules\\|\\\.git\\|\\dist\\|\\build\\|\\out\\|\\coverage\\|\\\.next\\|\\tmp\\|\\\.cache\\"
$files = @()
foreach ($glob in $includeGlobs) {
  $files += Get-ChildItem -Recurse -File -Force -ErrorAction SilentlyContinue -Include $glob
}
$files = $files | Where-Object { $_.FullName -notmatch $exclusions } | Sort-Object FullName -Unique
foreach ($f in $files) {
  $rel  = $f.FullName.Substring($PWD.Path.Length).TrimStart('\','/','.')
  $dest = Join-Path $snapDir $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
}

# 3) Env presence (no secrets)
$envNames = @("N8N_BASE_URL","N8N_API_KEY","ALPACA_API_KEY_ID","ALPACA_API_SECRET_KEY",
              "OPENAI_API_KEY","DEEPSEEK_API_KEY","KIMI_API_KEY","POLYGON_API_KEY",
              "TIINGO_API_KEY","DATABASE_URL","PYTHON_MODELS_URL")
$lines = foreach ($name in $envNames) {
  $val = [Environment]::GetEnvironmentVariable($name,"Process")
  if (-not $val) { $val = [Environment]::GetEnvironmentVariable($name,"User") }
  if (-not $val) { $val = [Environment]::GetEnvironmentVariable($name,"Machine") }
  "{0} = {1}" -f $name, ($(if ($val) {"SET"} else {"MISSING"}))
}
$lines | Out-File -Encoding UTF8 $envOut

# 4) Collated markdown
"# Audit Bundle ($stamp)`n`n## Tree`n" | Out-File -Encoding UTF8 $mdOut
"````" | Out-File -Encoding UTF8 -Append $mdOut
Get-Content $treeOut | Out-File -Encoding UTF8 -Append $mdOut
"`````n" | Out-File -Encoding UTF8 -Append $mdOut
"## Environment Var Presence (no secrets)`n```txt" | Out-File -Encoding UTF8 -Append $mdOut
Get-Content $envOut | Out-File -Encoding UTF8 -Append $mdOut
"```" | Out-File -Encoding UTF8 -Append $mdOut

"## Key Files (first 400 lines each)`n" | Out-File -Encoding UTF8 -Append $mdOut
$maxLines = 400
foreach ($f in $files) {
  $rel = $f.FullName.Substring($PWD.Path.Length).TrimStart('\','/','.')
  "### $rel`n```$($f.Extension.TrimStart('.'))" | Out-File -Encoding UTF8 -Append $mdOut
  try {
    Get-Content -TotalCount $maxLines -LiteralPath $f.FullName | Out-File -Encoding UTF8 -Append $mdOut
    $len = (Get-Content -LiteralPath $f.FullName | Measure-Object -Line).Lines
    if ($len -gt $maxLines) { "`n... (truncated for audit)" | Out-File -Encoding UTF8 -Append $mdOut }
  } catch { "# (binary or unreadable)" | Out-File -Encoding UTF8 -Append $mdOut }
  "````n" | Out-File -Encoding UTF8 -Append $mdOut
}

# 5) Capture Python deps if pip installed
try {
    pip freeze | Out-File -Encoding UTF8 (Join-Path $snapDir "requirements.txt")
} catch { }

# 6) Zip result
$zip = "$outDir.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($outDir, $zip)

Write-Host "`n=== Audit bundle ready ==="
Write-Host "Tree:         $treeOut"
Write-Host "Snapshot dir: $snapDir"
Write-Host "Markdown:     $mdOut"
Write-Host "Env check:    $envOut"
Write-Host "ZIP:          $zip"
