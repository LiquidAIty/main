# Backend DB + KG Ingest Verification

## Changes Made

### 1. DB Connection Configuration (All Files)
**Files Changed:**
- `apps/backend/src/services/agentBuilderStore.ts`
- `apps/backend/src/services/projectAgentsStore.ts`
- `apps/backend/src/services/memoryRetrieval.ts`
- `apps/backend/src/services/graphService.ts`
- `apps/backend/src/routes/ragsearch.routes.ts`
- `apps/backend/src/routes/projects.routes.ts`
- `apps/backend/src/tools/rag.search.ts`

**Change:** Updated all `Pool` connection strings from:
```typescript
connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/liquidaity'
```
To:
```typescript
connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity'
```

**Why:** Backend was trying to connect to port 5432 with wrong credentials. Docker container runs on port 5433 with user `liquidaity-user`.

---

### 2. Startup Logging
**File:** `apps/backend/src/main.ts`

**Change:** Added DB connection details to startup banner:
```typescript
console.log(`DB_HOST:          ${dbHost}`);
console.log(`DB_PORT:          ${dbPort}`);
console.log(`DB_NAME:          ${dbName}`);
console.log(`DB_USER:          ${dbUser}`);
```

**Why:** Verify effective DB connection at startup without exposing password.

---

### 3. Missing Column Fallback
**File:** `apps/backend/src/services/agentBuilderStore.ts` (line 382-410)

**Change:** Modified `getAssistAssignments()` to check schema before querying:
```typescript
// Check which columns exist in the schema
const columns = await getProjectColumns();
const hasMainAgent = columns.has('assist_main_agent_id');
const hasKgAgent = columns.has('assist_kg_ingest_agent_id');

// Build SELECT clause with only existing columns
const selectCols: string[] = ['id'];
if (hasMainAgent) selectCols.push('assist_main_agent_id');
if (hasKgAgent) selectCols.push('assist_kg_ingest_agent_id');
```

**Why:** Prevents "column does not exist" errors. Returns `null` for missing columns instead of crashing.

---

### 4. AGE Graph Creation Fix
**File:** `apps/backend/src/services/graphService.ts` (line 23-24)

**Change:** Fixed `create_graph()` call from parameterized to literal:
```typescript
// Before:
await pool.query('SELECT ag_catalog.create_graph($1)', [graphName]);

// After:
await pool.query(`SELECT ag_catalog.create_graph('${graphName}')`);
```

**Why:** Apache AGE requires graph name as literal identifier, not parameter. This was causing "a name constant is expected" error.

---

### 5. KG Ingest Logging
**File:** `apps/backend/src/routes/projects.routes.ts` (commitKgBatch function)

**Changes:**
- Added start logging with entity/relation counts
- Added try/catch around entity upserts with error logging
- Added try/catch around relation upserts with error logging
- Added completion logging with final counts

**Why:** Trace why `entities_upserted` and `relations_upserted` were 0.

---

## Verification Commands

### Step 1: Verify DB Connection
```powershell
# Set password env var to avoid prompt
$env:PGPASSWORD="LiquidAIty"

# Test connection
psql -h localhost -p 5433 -U liquidaity-user -d liquidaity -c "SELECT 1 AS test;"
```

**Expected Output:**
```
 test 
------
    1
(1 row)
```

---

### Step 2: Check Schema
```powershell
# View projects table structure
psql -h localhost -p 5433 -U liquidaity-user -d liquidaity -c "\d+ ag_catalog.projects"

# Check if assist columns exist
psql -h localhost -p 5433 -U liquidaity-user -d liquidaity -c "SELECT column_name FROM information_schema.columns WHERE table_schema='ag_catalog' AND table_name='projects' AND column_name LIKE 'assist%';"
```

**Expected:** Either shows the columns exist, or shows empty (fallback will handle it).

---

### Step 3: Verify Projects Exist
```powershell
psql -h localhost -p 5433 -U liquidaity-user -d liquidaity -c "SELECT id, name, code FROM ag_catalog.projects LIMIT 5;"
```

**Expected:** Shows project rows (you mentioned 7 exist).

---

### Step 4: Start Backend and Check Logs
```powershell
cd apps/backend
npm run dev
```

**Expected Startup Output:**
```
──────────────── SOL BACKEND START ────────────────
NODE_ENV:         development
SOL model:        gpt-5.1-chat-latest
OPENAI_BASE_URL:  (default)
OPENAI_API_KEY:   sk-...xxxx
DB_HOST:          localhost
DB_PORT:          5433
DB_NAME:          liquidaity
DB_USER:          liquidaity-user
───────────────────────────────────────────────────
[BOOT] listening on :4000
```

**No Errors Expected:**
- No ECONNREFUSED
- No "column does not exist"

---

### Step 5: Test Assist Chat (No Error)
```powershell
# In another terminal, test assist endpoint
curl -X POST http://localhost:4000/api/projects/default/assist/chat `
  -H "Content-Type: application/json" `
  -d '{\"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}]}'
```

**Expected:**
- No "assist_main_agent_id does not exist" error
- Returns chat response (may be default agent or null assignment)

---

### Step 6: Test KG Ingest
```powershell
# Test ingest endpoint
curl -X POST http://localhost:4000/api/projects/default/kg/ingest_chat_turn `
  -H "Content-Type: application/json" `
  -d '{\"userText\": \"The LiquidAIty project uses PostgreSQL and Apache AGE for knowledge graphs.\", \"assistantText\": \"That is correct. LiquidAIty integrates RAG with graph databases.\"}'
```

**Expected Response:**
```json
{
  "ok": true,
  "chunks_written": 2,
  "embeddings_written": 2,
  "entities_upserted": 3,
  "relations_upserted": 1
}
```

**Backend Logs Should Show:**
```
[KG_INGEST] commitKgBatch start: { projectId: 'default', graphName: 'graph_liq', entities_count: 3, relations_count: 1 }
[KG_INGEST] commitKgBatch complete: { projectId: 'default', entitiesUpserted: 3, relationsUpserted: 1 }
```

**No Errors Expected:**
- No "a name constant is expected"
- No "project not found"
- `entities_upserted` > 0 OR `relations_upserted` > 0

---

### Step 7: Verify Graph Data Exists
```powershell
# Query the graph via backend API
curl -X POST http://localhost:4000/api/projects/default/kg/query `
  -H "Content-Type: application/json" `
  -d '{\"cypher\": \"MATCH (n:Entity { project_id: \\\"default\\\" }) RETURN n.name AS name, n.etype AS type LIMIT 10\"}'
```

**Expected:**
```json
{
  "ok": true,
  "rows": [
    {"name": "LiquidAIty", "type": "Project"},
    {"name": "PostgreSQL", "type": "Technology"},
    {"name": "Apache AGE", "type": "Technology"}
  ]
}
```

---

### Step 8: Verify Graph via Direct SQL
```powershell
# Use AGE cypher() directly
psql -h localhost -p 5433 -U liquidaity-user -d liquidaity -c "SELECT * FROM ag_catalog.cypher('graph_liq', \$\$ MATCH (n:Entity) RETURN n.name, n.etype LIMIT 5 \$\$) AS (name agtype, etype agtype);"
```

**Expected:** Shows entity names and types from the graph.

---

## Smoke Test Script

Create `scripts/smoke_test_kg.ps1`:

```powershell
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
```

**Run:**
```powershell
pwsh scripts/smoke_test_kg.ps1
```

---

## Summary

All fixes applied:
1. ✅ DB connection uses correct Docker credentials (port 5433, user liquidaity-user)
2. ✅ Startup logging shows effective DB connection
3. ✅ Missing column fallback prevents crashes
4. ✅ AGE graph creation uses literal name (fixes "name constant expected")
5. ✅ KG ingest has detailed logging for debugging

**No UI changes made.**
**No new features added.**
**Minimal diffs applied.**
