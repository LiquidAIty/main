# RAG Weighted Search: REST + MCP

Exposes `api.rag_topk_weighted()` via REST endpoint and MCP tool for semantic search with recency and signal weighting.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Client (React, Agent, IDE)                                  │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ├─ REST (HTTP)                 ├─ MCP (stdio)
         │                              │
    POST /api/rag/search            db.rag_search
         │                              │
    ┌────▼──────────────────────────────▼────┐
    │ apps/backend/src/routes/ragsearch.routes.ts
    │ apps/backend/agents/ragsearch.mcp.mjs
    └────┬──────────────────────────────────┬─┘
         │                                  │
         └──────────────────┬───────────────┘
                            │
                    ┌───────▼────────┐
                    │ PostgreSQL     │
                    │ api.rag_topk_  │
                    │ weighted()     │
                    └────────────────┘
```

## Files

### REST Route
**File:** `apps/backend/src/routes/ragsearch.routes.ts`
- Handles `POST /api/rag/search`
- Validates embedding, k, weights
- Normalizes weights (w_cos = 1 - w_rec - w_sig)
- Returns typed JSON response

### MCP Tool Server
**File:** `apps/backend/agents/ragsearch.mcp.mjs`
- Standalone Node.js script
- Exposes `db.rag_search` tool
- Runs on stdio (default MCP transport)
- Same logic as REST route

### Tool Configuration
**File:** `apps/backend/src/tools/ragsearch.tool.ts`
- TypeScript tool definition following SIM pattern
- Describes parameters, outputs, request/response
- Used by agent orchestrator for tool discovery

### Type Definitions
**File:** `apps/backend/src/types/tool.types.ts`
- Generic `ToolConfig<TParams, TResponse>` interface
- Reusable for other tools

## Setup

### 1. Install Dependencies

The `pg` package is required. Check `package.json`:

```bash
npm install pg
```

If using MCP SDK (optional, for advanced MCP features):

```bash
npm install @modelcontextprotocol/sdk
```

### 2. Environment

Add to `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/liquidaity
```

### 3. Database

Ensure PostgreSQL has:
- `api.rag_topk_weighted(vector, k, w_cos, w_rec, w_sig)` function
- `ag_catalog.rag_embeddings` table with embeddings

Run setup scripts:

```bash
docker exec -it sim-pg psql -U postgres -d liquidaity -f 00_rag_core.sql
docker exec -it sim-pg psql -U postgres -d liquidaity -f 01_rag_weighted.sql
```

## Usage

### REST API

**Endpoint:** `POST /api/rag/search`

**Request:**

```json
{
  "embedding": [0.0001, 0.034, 0.12, ..., 0.2],
  "k": 5,
  "w_rec": 0.1,
  "w_sig": 0.1
}
```

**Response:**

```json
{
  "ok": true,
  "k": 5,
  "weights": {
    "w_cos": 0.8,
    "w_rec": 0.1,
    "w_sig": 0.1
  },
  "rows": [
    {
      "chunk_id": "doc-123-chunk-0",
      "doc_id": "doc-123",
      "src": "https://example.com/doc",
      "chunk": "Content snippet...",
      "model": "text-embedding-3-small",
      "score": 0.92,
      "cos_dist": 0.08,
      "l2_dist": 0.15,
      "scale": 1.0,
      "days_old": 2,
      "created_at": "2025-11-09T10:44:00Z"
    }
  ]
}
```

### MCP Tool

**Tool Name:** `db.rag_search`

**Input Schema:**

```json
{
  "embedding": [number[], required],
  "k": [1-50, default 5],
  "w_rec": [0.0+, default 0.1],
  "w_sig": [0.0+, default 0.1]
}
```

**Output:** Same as REST response

**Register in MCP Client:**

```yaml
# Windsurf / VS Code settings
mcp:
  servers:
    rag-search:
      command: node
      args: [apps/backend/agents/ragsearch.mcp.mjs]
      env:
        DATABASE_URL: postgres://postgres:postgres@localhost:5432/liquidaity
```

## Weight Tuning

### Defaults (Balanced)
- `w_rec: 0.1` (10% recency)
- `w_sig: 0.1` (10% signal)
- `w_cos: 0.8` (80% semantic)

### Freshness-Focused
- `w_rec: 0.3` (30% recency)
- `w_sig: 0.1` (10% signal)
- `w_cos: 0.6` (60% semantic)

### Signal-Focused
- `w_rec: 0.1` (10% recency)
- `w_sig: 0.3` (30% signal)
- `w_cos: 0.6` (60% semantic)

### Pure Semantic
- `w_rec: 0.0`
- `w_sig: 0.0`
- `w_cos: 1.0`

## Testing

### REST Smoke Test (PowerShell)

```powershell
# Fetch a real embedding
$emb = docker exec -it sim-pg psql -U postgres -d liquidaity -P pager=off -t -c `
  "SELECT emb FROM ag_catalog.rag_embeddings ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1" | Out-String

# Build request
$body = @{
  embedding = (ConvertFrom-Json $emb)
  k = 5
  w_rec = 0.1
  w_sig = 0.1
} | ConvertTo-Json -Depth 5

# Call REST
curl.exe -s -X POST http://localhost:3000/api/rag/search `
  -H "Content-Type: application/json" `
  -d $body | ConvertFrom-Json | ConvertTo-Json
```

### PostgreSQL Sanity Check

```sql
WITH q AS (
  SELECT emb AS v FROM ag_catalog.rag_embeddings
  ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1
)
SELECT chunk_id, doc_id, ROUND(score::numeric, 6) AS score
FROM api.rag_topk_weighted((SELECT v FROM q), 5, 0.8, 0.1, 0.1);
```

### MCP Smoke Test

If using MCP client (Windsurf, VS Code):

1. Register the server in settings
2. Call tool `db.rag_search` with:

```json
{
  "embedding": [0.0001, 0.034, 0.12, 0.0, 0.002, 0.9, 0.1, 0.2],
  "k": 5,
  "w_rec": 0.1,
  "w_sig": 0.1
}
```

(Use a real 1536-dim vector from your embeddings table)

## Integration Examples

### React Component (Sliders)

```tsx
import { useState } from 'react';

export function RagSearchPanel() {
  const [wRec, setWRec] = useState(0.1);
  const [wSig, setWSig] = useState(0.1);
  const [results, setResults] = useState([]);

  const handleSearch = async (embedding: number[]) => {
    const res = await fetch('/api/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding, k: 5, w_rec: wRec, w_sig: wSig }),
    });
    const data = await res.json();
    setResults(data.rows);
  };

  return (
    <div>
      <label>Freshness: {wRec.toFixed(2)}</label>
      <input
        type="range"
        min="0"
        max="0.5"
        step="0.01"
        value={wRec}
        onChange={(e) => setWRec(Number(e.target.value))}
      />
      
      <label>Signal: {wSig.toFixed(2)}</label>
      <input
        type="range"
        min="0"
        max="0.5"
        step="0.01"
        value={wSig}
        onChange={(e) => setWSig(Number(e.target.value))}
      />

      <button onClick={() => handleSearch(/* embedding */)}>Search</button>

      <ul>
        {results.map((r) => (
          <li key={r.chunk_id}>
            <strong>{r.doc_id}</strong> (score: {r.score.toFixed(3)})
            <p>{r.chunk.substring(0, 100)}...</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### LangGraph Agent

```typescript
import { ragSearchTool } from '../tools/ragsearch.tool';

const tools = [ragSearchTool];

const agent = createReactAgent({
  llm: model,
  tools,
});

// Agent calls db.rag_search automatically
```

## Performance Notes

- **Connection Pool:** 5 connections max (tunable in route)
- **Query Time:** Typically <100ms for k=5 on indexed vectors
- **Memory:** Minimal; streaming results for large k
- **Caching:** Consider Redis for repeated queries

## Troubleshooting

### "embedding (number[]) required"
- Ensure body contains `embedding` array
- Check array is not empty

### "k must be 1..50"
- k out of range; clamp to [1, 50]

### "internal_error"
- Check PostgreSQL connection (DATABASE_URL)
- Verify `api.rag_topk_weighted()` exists
- Check logs: `console.error` output

### MCP not connecting
- Verify command path: `node apps/backend/agents/ragsearch.mcp.mjs`
- Check DATABASE_URL in MCP server env
- Test with: `node ragsearch.mcp.mjs` (should hang on stdio)

## Next Steps

1. **UI Panel:** Add React sliders + results display
2. **Auth:** Add bearer token validation (RLS role)
3. **Caching:** Redis layer for hot queries
4. **Metrics:** Log search latency, top queries
5. **Variants:** Add `db.rag_topk_cosine`, `db.rag_topk_l2_mag` tools
