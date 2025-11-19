# Test Memory Stack Integration
Write-Host "Testing Memory Stack Integration..." -ForegroundColor Green

$baseUrl = "http://localhost:4000/api"

Write-Host "`n1. Testing RAG Search endpoint..." -ForegroundColor Yellow
$ragPayload = @{
    embedding = @(1..1536 | ForEach-Object { Get-Random -Minimum -0.01 -Maximum 0.01 })
    k = 5
    w_rec = 0.1
    w_sig = 0.1
} | ConvertTo-Json -Depth 3

try {
    $ragResponse = Invoke-RestMethod -Uri "$baseUrl/rag/search" -Method POST -Body $ragPayload -ContentType "application/json"
    Write-Host "✅ RAG Search: Found $($ragResponse.rows.Count) chunks" -ForegroundColor Green
} catch {
    Write-Host "❌ RAG Search failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n2. Testing KG Neighborhood endpoint..." -ForegroundColor Yellow
$kgPayload = @{
    uid = "LiquidAIty"
    depth = 1
    limit = 10
} | ConvertTo-Json

try {
    $kgResponse = Invoke-RestMethod -Uri "$baseUrl/kg/neighborhood" -Method POST -Body $kgPayload -ContentType "application/json"
    Write-Host "✅ KG Neighborhood: Found $($kgResponse.nodes.Count) nodes, $($kgResponse.edges.Count) edges" -ForegroundColor Green
} catch {
    Write-Host "❌ KG Neighborhood failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n3. Testing Agent-0 with memory tools..." -ForegroundColor Yellow
$agentPayload = @{
    goal = "Search your memory for information about 'LiquidAIty architecture' and explore the knowledge graph around any entities you find. Use both rag_search and kg_neighborhood tools."
} | ConvertTo-Json

try {
    $agentResponse = Invoke-RestMethod -Uri "$baseUrl/agents/boss" -Method POST -Body $agentPayload -ContentType "application/json"
    Write-Host "✅ Agent-0 Response: $($agentResponse.answer.Length) characters" -ForegroundColor Green
    Write-Host "Agent said: $($agentResponse.answer)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Agent-0 failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nMemory stack test complete!" -ForegroundColor Green
