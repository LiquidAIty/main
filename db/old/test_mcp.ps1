# Test MCP AutoWrap server
Write-Host "Testing MCP AutoWrap server..."

# Test 1: List tools
Write-Host "`nTest 1: List tools"
$process = Start-Process -FilePath "npm" -ArgumentList "run", "mcp:auto:smoke" -NoNewWindow -PassThru -RedirectStandardInput
Start-Sleep 1
"{'jsonrpc':'2.0','id':1,'method':'tools/list'}" | Out-File -FilePath temp_input.json -Encoding utf8
Get-Content temp_input.json | & $process
Start-Sleep 2
$process.Kill()
Remove-Item temp_input.json -ErrorAction SilentlyContinue

Write-Host "Test complete."
