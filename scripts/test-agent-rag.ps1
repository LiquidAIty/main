#!/usr/bin/env pwsh
# Test Agent-0 with RAG tool

$url = "http://localhost:4000/api/agents/boss"
$body = @{
    goal = "Use the rag_search tool to find information about LiquidAIty in the knowledge base and summarize what you find."
} | ConvertTo-Json

Write-Host "Testing Agent-0 with RAG tool..."
Write-Host "URL: $url"
Write-Host "Body: $body"
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri $url `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -ErrorAction Stop

    Write-Host "✓ Response Status: $($response.StatusCode)"
    Write-Host ""
    
    $data = $response.Content | ConvertFrom-Json
    Write-Host "Response:"
    $data | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        Write-Host "Status Code: $($_.Exception.Response.StatusCode)"
        Write-Host "Response Body:"
        $_.Exception.Response.Content.ToString() | Write-Host
    }
}
