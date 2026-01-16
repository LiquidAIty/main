# Smoke test script for diagnosing backend issues
# Run this after backend is started

$BASE_URL = "http://localhost:4000/api"

Write-Host "=== LiquidAIty Backend Smoke Test ===" -ForegroundColor Cyan
Write-Host ""

# 1. DB Schema Check
Write-Host "1. Checking database schema..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/diagnostic/schema-check" -Method GET
    Write-Host "   DB Connection: $($response.db_connection.host):$($response.db_connection.port)/$($response.db_connection.database)" -ForegroundColor Green
    Write-Host "   User: $($response.db_connection.user)" -ForegroundColor Green
    Write-Host "   Diagnosis: $($response.diagnosis)" -ForegroundColor $(if ($response.diagnosis -eq 'SCHEMA_OK') { 'Green' } else { 'Red' })
    
    Write-Host "   Tables:" -ForegroundColor White
    foreach ($table in $response.tables) {
        $color = if ($table.exists) { 'Green' } else { 'Red' }
        Write-Host "     - $($table.table): $($table.exists)" -ForegroundColor $color
    }
    
    Write-Host "   Required Columns in ag_catalog.projects:" -ForegroundColor White
    foreach ($col in $response.projects_columns) {
        $color = if ($col.exists) { 'Green' } else { 'Red' }
        Write-Host "     - $($col.column): $($col.exists)" -ForegroundColor $color
    }
} catch {
    Write-Host "   ERROR: $_" -ForegroundColor Red
}
Write-Host ""

# 2. Assist Chat Test (will fail if no project/agent configured, but shows provider routing)
Write-Host "2. Testing Assist chat endpoint..." -ForegroundColor Yellow
try {
    $body = @{
        goal = "Hello, test message"
        projectId = "default"
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "$BASE_URL/agents/boss" -Method POST -Body $body -ContentType "application/json"
    Write-Host "   Status: OK" -ForegroundColor Green
    Write-Host "   Provider: $($response.provider)" -ForegroundColor Green
    Write-Host "   Model: $($response.model)" -ForegroundColor Green
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "   Status: FAILED" -ForegroundColor Red
    Write-Host "   Error: $($errorResponse.error)" -ForegroundColor Red
    Write-Host "   Message: $($errorResponse.message)" -ForegroundColor Yellow
}
Write-Host ""

# 3. KG Ingest Test
Write-Host "3. Testing KG ingest endpoint..." -ForegroundColor Yellow
try {
    $body = @{
        text = "LiquidAIty is an AI agent platform built with TypeScript and PostgreSQL."
        doc_id = "test:smoke:$(Get-Date -Format 'yyyyMMddHHmmss')"
        src = "smoke_test"
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "$BASE_URL/projects/default/kg/ingest" -Method POST -Body $body -ContentType "application/json"
    Write-Host "   Status: $($response.ok)" -ForegroundColor $(if ($response.ok) { 'Green' } else { 'Red' })
    Write-Host "   Chunks written: $($response.chunks_written)" -ForegroundColor Green
    Write-Host "   Entities upserted: $($response.entities_upserted)" -ForegroundColor Green
    Write-Host "   Relations upserted: $($response.relations_upserted)" -ForegroundColor Green
    if ($response.errors -and $response.errors.Count -gt 0) {
        Write-Host "   Errors:" -ForegroundColor Red
        foreach ($err in $response.errors) {
            Write-Host "     - [$($err.stage)] $($err.error)" -ForegroundColor Red
        }
    }
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "   Status: FAILED" -ForegroundColor Red
    Write-Host "   Error: $($errorResponse.error)" -ForegroundColor Red
    Write-Host "   Message: $($errorResponse.message)" -ForegroundColor Yellow
}
Write-Host ""

# 4. AGE Query Test
Write-Host "4. Testing AGE/Cypher query..." -ForegroundColor Yellow
try {
    $body = @{
        cypher = 'MATCH (n:Entity { project_id: $projectId }) RETURN count(n) as c'
        params = @{ projectId = "default" }
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "$BASE_URL/projects/default/kg/query" -Method POST -Body $body -ContentType "application/json"
    Write-Host "   Status: $($response.ok)" -ForegroundColor Green
    Write-Host "   Rows returned: $($response.rows.Count)" -ForegroundColor Green
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "   Status: FAILED" -ForegroundColor Red
    Write-Host "   Error: $($errorResponse.error)" -ForegroundColor Red
    Write-Host "   Message: $($errorResponse.message)" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "=== Smoke Test Complete ===" -ForegroundColor Cyan
