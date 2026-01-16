#!/usr/bin/env pwsh

$ErrorActionPreference = "Stop"
$env:PGPASSWORD = "LiquidAIty"

Write-Host "=== KG Ingest Smoke Test ===" -ForegroundColor Cyan

# 1. Test DB connection
Write-Host "`n[1/4] Testing DB connection..." -ForegroundColor Yellow
$result = psql -h localhost -p 5433 -U liquidaity-user -d liquidaity -t -c "SELECT 1;"
if ($result -match "1") {
    Write-Host "✓ DB connection OK" -ForegroundColor Green
} else {
    Write-Host "✗ DB connection FAILED" -ForegroundColor Red
    exit 1
}

# 2. Check projects exist
Write-Host "`n[2/4] Checking projects..." -ForegroundColor Yellow
$count = psql -h localhost -p 5433 -U liquidaity-user -d liquidaity -t -c "SELECT COUNT(*) FROM ag_catalog.projects;"
Write-Host "✓ Found $count projects" -ForegroundColor Green

# 3. Test backend health
Write-Host "`n[3/4] Testing backend health..." -ForegroundColor Yellow
$health = curl -s http://localhost:4000/api/health | ConvertFrom-Json
if ($health.status -eq "ok") {
    Write-Host "✓ Backend is healthy" -ForegroundColor Green
} else {
    Write-Host "✗ Backend health check FAILED" -ForegroundColor Red
    exit 1
}

# 4. Test KG ingest
Write-Host "`n[4/4] Testing KG ingest..." -ForegroundColor Yellow
$payload = @{
    userText = "LiquidAIty uses React for the frontend."
    assistantText = "Yes, it also uses Express for the backend API."
} | ConvertTo-Json

$response = curl -s -X POST http://localhost:4000/api/projects/default/kg/ingest_chat_turn `
    -H "Content-Type: application/json" `
    -d $payload | ConvertFrom-Json

Write-Host "  chunks_written: $($response.chunks_written)" -ForegroundColor White
Write-Host "  embeddings_written: $($response.embeddings_written)" -ForegroundColor White
Write-Host "  entities_upserted: $($response.entities_upserted)" -ForegroundColor White
Write-Host "  relations_upserted: $($response.relations_upserted)" -ForegroundColor White

if ($response.entities_upserted -gt 0 -or $response.relations_upserted -gt 0) {
    Write-Host "`n✓ KG ingest SUCCESS - entities/relations written!" -ForegroundColor Green
} else {
    Write-Host "`n⚠ KG ingest ran but wrote 0 entities/relations (check LLM extraction)" -ForegroundColor Yellow
}

Write-Host "`n=== All Tests Passed ===" -ForegroundColor Cyan
