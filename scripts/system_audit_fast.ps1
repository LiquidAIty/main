$ErrorActionPreference = 'SilentlyContinue'

function Get-TopLevelFolderSizes($root){
  if(-not (Test-Path $root)){ return @() }
  $out = @()
  Get-ChildItem -LiteralPath $root -Force -Directory | ForEach-Object {
    $sum = (Get-ChildItem -LiteralPath $_.FullName -Recurse -Force -File | Measure-Object Length -Sum).Sum
    $out += [PSCustomObject]@{ Root=$root; Name=$_.Name; Path=$_.FullName; SizeGB=[math]::Round(($sum/1GB),2) }
  }
  return $out
}

Write-Host "== Drive free space =="
Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='UsedGB';E={[math]::Round((($_.Used)/1GB),2)}}, @{N='FreeGB';E={[math]::Round((($_.Free)/1GB),2)}} | Format-Table -AutoSize

Write-Host "`n== Top-level in USERPROFILE =="
Get-TopLevelFolderSizes $env:USERPROFILE | Sort-Object SizeGB -Descending | Select-Object -First 20 | Format-Table -AutoSize

Write-Host "`n== Top-level in LOCALAPPDATA =="
Get-TopLevelFolderSizes $env:LOCALAPPDATA | Sort-Object SizeGB -Descending | Select-Object -First 25 | Format-Table -AutoSize

Write-Host "`n== Top-level in APPDATA =="
Get-TopLevelFolderSizes $env:APPDATA | Sort-Object SizeGB -Descending | Select-Object -First 25 | Format-Table -AutoSize

Write-Host "`n== Largest files in Downloads/Desktop/Documents (top 20) =="
$roots = @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents")
$files = @()
foreach($r in $roots){
  if(Test-Path $r){
    $files += Get-ChildItem -LiteralPath $r -Recurse -Force -File |
      Select-Object FullName, @{N='SizeGB';E={[math]::Round(($_.Length/1GB),3)}}, LastWriteTime
  }
}
$files | Sort-Object SizeGB -Descending | Select-Object -First 20 | Format-Table -AutoSize

Write-Host "`n== Temp quick stats =="
if(Test-Path $env:TEMP){
  $tf = Get-ChildItem -LiteralPath $env:TEMP -Recurse -Force -File
  $sum = ($tf | Measure-Object Length -Sum).Sum
  [PSCustomObject]@{ TempPath=$env:TEMP; Files=$tf.Count; SizeGB=[math]::Round(($sum/1GB),2)} | Format-List
}
