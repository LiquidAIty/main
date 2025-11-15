param([int]$K=5,[double]$w_rec=0.1,[double]$w_sig=0.1)
$emb = docker exec -i sim-pg psql -U postgres -d liquidaity -t -P pager=off -c "SELECT emb FROM ag_catalog.rag_embeddings LIMIT 1" | Out-String
$emb = $emb.Trim(); if (-not $emb.StartsWith("[")) { throw "No embedding fetched" }
$body = @{ embedding=(ConvertFrom-Json $emb); k=$K; w_rec=$w_rec; w_sig=$w_sig } | ConvertTo-Json -Depth 5
$resp = Invoke-WebRequest -Uri "http://localhost:3000/api/rag/search" -Method POST -ContentType "application/json" -Body $body
if ($resp.StatusCode -ne 200) { throw "HTTP $($resp.StatusCode)" }
$data = $resp.Content | ConvertFrom-Json
if (-not $data.ok) { throw "Response not ok" }
"✓ Test PASSED"; $data.rows | Select-Object -First 1 | Format-List
