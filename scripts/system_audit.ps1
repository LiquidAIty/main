$ErrorActionPreference = 'SilentlyContinue'

$targets = @(
  $env:TEMP,
  "$env:USERPROFILE\Downloads",
  "$env:USERPROFILE\Desktop",
  "$env:USERPROFILE\Documents",
  $env:LOCALAPPDATA,
  $env:APPDATA
)

Write-Host "== Top target sizes =="
$rows = foreach($t in $targets){
  if(Test-Path $t){
    $sum = (Get-ChildItem -LiteralPath $t -Recurse -Force -File | Measure-Object Length -Sum).Sum
    [PSCustomObject]@{ Path = $t; SizeGB = [math]::Round(($sum/1GB),2) }
  }
}
$rows | Sort-Object SizeGB -Descending | Format-Table -AutoSize

Write-Host "`n== Largest folders in Downloads/Desktop/Documents (top 20) =="
$roots = @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents")
$folderRows = @()
foreach($r in $roots){
  if(Test-Path $r){
    Get-ChildItem -LiteralPath $r -Force -Directory | ForEach-Object {
      $s = (Get-ChildItem -LiteralPath $_.FullName -Recurse -Force -File | Measure-Object Length -Sum).Sum
      $folderRows += [PSCustomObject]@{ Root = $r; Folder = $_.FullName; SizeGB = [math]::Round(($s/1GB),2) }
    }
  }
}
$folderRows | Sort-Object SizeGB -Descending | Select-Object -First 20 | Format-Table -AutoSize

Write-Host "`n== Largest files in Downloads/Desktop/Documents (top 30) =="
$fileRows = @()
foreach($r in $roots){
  if(Test-Path $r){
    $fileRows += Get-ChildItem -LiteralPath $r -Recurse -Force -File |
      Select-Object FullName, @{N='SizeGB';E={[math]::Round(($_.Length/1GB),3)}}, LastWriteTime
  }
}
$fileRows | Sort-Object SizeGB -Descending | Select-Object -First 30 | Format-Table -AutoSize

Write-Host "`n== Temp folder summary =="
if(Test-Path $env:TEMP){
  $tempFiles = Get-ChildItem -LiteralPath $env:TEMP -Recurse -Force -File
  $tempSize = ($tempFiles | Measure-Object Length -Sum).Sum
  [PSCustomObject]@{
    TempPath = $env:TEMP
    FileCount = $tempFiles.Count
    SizeGB = [math]::Round(($tempSize/1GB),2)
  } | Format-List
}

Write-Host "`n== Startup apps (Current User + Local Machine Run keys) =="
$runPaths = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
)
foreach($rp in $runPaths){
  if(Test-Path $rp){
    Write-Host "-- $rp"
    Get-ItemProperty -Path $rp | Select-Object * | Format-List
  }
}
