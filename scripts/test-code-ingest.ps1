# Test code ingest through existing KnowGraph path
$projectId = "local-dev"
$testFile = "services/knowgraph/schema.py"
$codeText = Get-Content "c:\Projects\LiquidAIty\main\$testFile" -Raw

$form = @{
    project_id = $projectId
    document_id = "test_schema_py"
    code_text = $codeText
    file_path = $testFile
    language = "python"
}

Write-Host "[TEST] Ingesting $testFile to KnowGraph..."
$response = Invoke-RestMethod -Uri "http://localhost:8001/ingest_code" `
    -Method POST `
    -Form $form

Write-Host "[RESULT]" -ForegroundColor Green
$response | ConvertTo-Json -Depth 3

Write-Host "`n[VERIFY] Querying Neo4j for ingested code..."
$query = @{
    projectId = $projectId
} | ConvertTo-Json

try {
    $graphData = Invoke-RestMethod -Uri "http://localhost:4000/api/knowgraph/graph?projectId=$projectId" `
        -Method GET
    
    $codeNodes = $graphData.nodes | Where-Object { $_.properties.source_type -eq 'code' }
    Write-Host "[FOUND] $($codeNodes.Count) code-related nodes in Neo4j" -ForegroundColor Cyan
    
    if ($codeNodes.Count -gt 0) {
        Write-Host "`nSample nodes:" -ForegroundColor Yellow
        $codeNodes | Select-Object -First 3 | ForEach-Object {
            Write-Host "  - $($_.label) ($($_.type))"
        }
    }
} catch {
    Write-Host "[ERROR] Failed to query graph: $_" -ForegroundColor Red
}
