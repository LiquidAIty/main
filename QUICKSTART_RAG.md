# RAG Search Quick Start

## What's New

Added weighted RAG search with two interfaces:

1. **REST API** (`POST /api/rag/search`) - for React, services, scripts
2. **MCP Tool** (`db.rag_search`) - for agents, IDEs, orchestrators

Both call the same PostgreSQL function: `api.rag_topk_weighted(vector, k, w_cos, w_rec, w_sig)`

## Setup (5 minutes)

### 1. Install Dependencies

```bash
cd apps/backend
npm install
```

This adds `pg` to the backend. The MCP SDK is already included.

### 2. Configure Environment

Add to `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/liquidaity
```

### 3. Verify Database

Ensure PostgreSQL has the RAG function:

```bash
docker exec -it sim-pg psql -U postgres -d liquidaity -c "
  SELECT chunk_id, score FROM api.rag_topk_weighted(
    (SELECT emb FROM ag_catalog.rag_embeddings LIMIT 1),
    5, 0.8, 0.1, 0.1
  ) LIMIT 1;
"
```

If it fails, run the setup scripts:

```bash
docker exec -it sim-pg psql -U postgres -d liquidaity -f /tmp/00_rag_core.sql
docker exec -it sim-pg psql -U postgres -d liquidaity -f /tmp/01_rag_weighted.sql
```

### 4. Start Backend

```bash
npm run serve
# or
npm run build && npm run start
```

Should see: `listening on :4000` (or your PORT)

## Test It

### REST API (PowerShell)

```powershell
.\scripts\test-rag-search.ps1
```

Expected output:
```
✓ Embedding fetched
✓ Request body prepared
✓ Request succeeded (HTTP 200)
✓ Test PASSED
```

### Manual cURL

```bash
curl -X POST http://localhost:3000/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{
    "embedding": [0.001, 0.002, ..., 0.999],
    "k": 5,
    "w_rec": 0.1,
    "w_sig": 0.1
  }'
```

### MCP in Windsurf

1. Open Windsurf settings (`Cmd+,` / `Ctrl+,`)
2. Search for "MCP"
3. Add server:

```json
{
  "mcpServers": {
    "rag-search": {
      "command": "node",
      "args": ["apps/backend/agents/ragsearch.mcp.mjs"],
      "env": {
        "DATABASE_URL": "postgres://postgres:postgres@localhost:5432/liquidaity"
      }
    }
  }
}
```

4. Restart Windsurf
5. In chat, ask: "Use the db.rag_search tool to find documents about X"

## Files

| File | Purpose |
|------|---------|
| `apps/backend/src/routes/ragsearch.routes.ts` | REST endpoint |
| `apps/backend/agents/ragsearch.mcp.mjs` | MCP tool server |
| `apps/backend/src/tools/ragsearch.tool.ts` | Tool config (SIM pattern) |
| `docs/RAG_SEARCH.md` | Full documentation |
| `scripts/test-rag-search.ps1` | Smoke test |

## API Reference

### POST /api/rag/search

**Request:**
```json
{
  "embedding": [number[], required],
  "k": [1-50, optional, default 5],
  "w_rec": [0.0+, optional, default 0.1],
  "w_sig": [0.0+, optional, default 0.1]
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
      "src": "https://...",
      "chunk": "Content...",
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

## Weight Tuning

| Scenario | w_rec | w_sig | w_cos |
|----------|-------|-------|-------|
| Balanced (default) | 0.1 | 0.1 | 0.8 |
| Freshness-focused | 0.3 | 0.1 | 0.6 |
| Signal-focused | 0.1 | 0.3 | 0.6 |
| Pure semantic | 0.0 | 0.0 | 1.0 |

## Next Steps

1. **React UI:** Add sliders for w_rec, w_sig in your chat component
2. **Agent Integration:** Use `ragSearchTool` in LangGraph workflows
3. **Caching:** Add Redis layer for hot queries
4. **Auth:** Add bearer token validation (RLS role)
5. **Variants:** Add `db.rag_topk_cosine`, `db.rag_topk_l2_mag` tools

## Troubleshooting

**"embedding (number[]) required"**
- Ensure body has `embedding` array

**"k must be 1..50"**
- Clamp k to [1, 50]

**"internal_error"**
- Check DATABASE_URL
- Verify `api.rag_topk_weighted()` exists
- Check logs

**MCP not connecting**
- Verify command path
- Check DATABASE_URL in MCP env
- Test: `node apps/backend/agents/ragsearch.mcp.mjs` (should hang)

## Documentation

Full docs: `docs/RAG_SEARCH.md`
