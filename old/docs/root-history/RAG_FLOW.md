# RAG Search Request/Response Flow

## REST API Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Client (React, cURL, etc.)                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ POST /api/rag/search
                            │ Content-Type: application/json
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Request Body                                                │
├─────────────────────────────────────────────────────────────┤
│ {                                                           │
│   "embedding": [0.001, 0.002, ..., 0.999],  // 1536-dim   │
│   "k": 5,                                    // optional   │
│   "w_rec": 0.1,                              // optional   │
│   "w_sig": 0.1                               // optional   │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Express Route Handler (ragsearch.routes.ts)                 │
├─────────────────────────────────────────────────────────────┤
│ 1. Extract & validate embedding (required, non-empty)      │
│ 2. Validate k (1-50, default 5)                            │
│ 3. Normalize weights:                                       │
│    - wRec = max(0, w_rec || 0)                             │
│    - wSig = max(0, w_sig || 0)                             │
│    - wCos = max(0, 1 - (wRec + wSig))                      │
│ 4. Build SQL query                                          │
│ 5. Execute via connection pool                             │
│ 6. Return typed JSON response                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ PostgreSQL Query                                            │
├─────────────────────────────────────────────────────────────┤
│ SELECT chunk_id, doc_id, src, chunk, model, score,        │
│        cos_dist, l2_dist, scale, days_old, created_at     │
│ FROM api.rag_topk_weighted(                                │
│   $1::vector,    -- embedding                              │
│   $2::int,       -- k                                       │
│   $3::real,      -- w_cos (semantic weight)                │
│   $4::real,      -- w_rec (recency weight)                 │
│   $5::real       -- w_sig (signal weight)                  │
│ )                                                           │
│ ORDER BY score DESC                                         │
│ LIMIT k                                                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Response Body (HTTP 200)                                    │
├─────────────────────────────────────────────────────────────┤
│ {                                                           │
│   "ok": true,                                               │
│   "k": 5,                                                   │
│   "weights": {                                              │
│     "w_cos": 0.8,                                           │
│     "w_rec": 0.1,                                           │
│     "w_sig": 0.1                                            │
│   },                                                        │
│   "rows": [                                                 │
│     {                                                       │
│       "chunk_id": "doc-123-chunk-0",                        │
│       "doc_id": "doc-123",                                  │
│       "src": "https://example.com/doc",                     │
│       "chunk": "Content snippet...",                        │
│       "model": "text-embedding-3-small",                    │
│       "score": 0.92,                                        │
│       "cos_dist": 0.08,                                     │
│       "l2_dist": 0.15,                                      │
│       "scale": 1.0,                                         │
│       "days_old": 2,                                        │
│       "created_at": "2025-11-09T10:44:00Z"                  │
│     },                                                      │
│     { ... 4 more results ... }                              │
│   ]                                                         │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Client receives response                                    │
│ - Parse JSON                                                │
│ - Render results                                            │
│ - Display scores, snippets, metadata                        │
└─────────────────────────────────────────────────────────────┘
```

## Error Handling

```
┌─────────────────────────────────────────────────────────────┐
│ Error Scenarios                                             │
├─────────────────────────────────────────────────────────────┤

1. Missing/Invalid Embedding
   HTTP 400
   {
     "error": "embedding (number[]) required"
   }

2. Invalid k
   HTTP 400
   {
     "error": "k must be 1..50"
   }

3. Database Error
   HTTP 500
   {
     "error": "internal_error",
     "detail": "connection refused at localhost:5432"
   }

4. Auth Failure
   HTTP 401
   {
     "error": "Unauthorized"
   }
```

## MCP Tool Flow

```
┌─────────────────────────────────────────────────────────────┐
│ IDE / Agent (Windsurf, LangGraph)                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Call tool: db.rag_search
                            │ Input: { embedding, k?, w_rec?, w_sig? }
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ MCP Server (ragsearch.mcp.mjs)                              │
├─────────────────────────────────────────────────────────────┤
│ 1. Receive tool call via stdio                              │
│ 2. Validate input schema                                    │
│ 3. Normalize weights                                        │
│ 4. Execute PostgreSQL query                                 │
│ 5. Return typed response                                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ PostgreSQL (same as REST)                                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ MCP Response                                                │
├─────────────────────────────────────────────────────────────┤
│ {                                                           │
│   "ok": true,                                               │
│   "k": 5,                                                   │
│   "weights": { ... },                                       │
│   "rows": [ ... ]                                           │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ IDE / Agent uses results                                    │
│ - Display in chat                                           │
│ - Pass to LLM for reasoning                                 │
│ - Chain with other tools                                    │
└─────────────────────────────────────────────────────────────┘
```

## Weight Normalization Logic

```
Input:
  w_rec = 0.1
  w_sig = 0.1

Processing:
  wRec = max(0, Number(0.1) || 0)  = 0.1
  wSig = max(0, Number(0.1) || 0)  = 0.1
  wCos = max(0, 1 - (0.1 + 0.1))    = 0.8

Output:
  w_cos: 0.8 (80% semantic)
  w_rec: 0.1 (10% recency)
  w_sig: 0.1 (10% signal)
  Total: 1.0 ✓

Example: Freshness-focused
  Input:  w_rec = 0.3, w_sig = 0.1
  Output: w_cos = 0.6, w_rec = 0.3, w_sig = 0.1
  Total:  1.0 ✓

Example: Invalid (sum > 1)
  Input:  w_rec = 0.6, w_sig = 0.6
  Output: w_cos = max(0, 1 - 1.2) = 0
          w_rec = 0.6, w_sig = 0.6
  Total:  1.2 (weights still sum to input, but w_cos clamped to 0)
```

## Connection Pool Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ Pool Initialization (ragsearch.routes.ts)                   │
├─────────────────────────────────────────────────────────────┤
│ const pool = new Pool({                                     │
│   connectionString: process.env.DATABASE_URL,               │
│   max: 5  // Max 5 concurrent connections                   │
│ })                                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Request Arrives                                             │
├─────────────────────────────────────────────────────────────┤
│ 1. Check available connection in pool                       │
│ 2. If available: use it                                     │
│ 3. If none available: wait (up to pool timeout)             │
│ 4. Execute query                                            │
│ 5. Return connection to pool                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Typical Timing                                              │
├─────────────────────────────────────────────────────────────┤
│ Connection acquire: ~1-5ms                                  │
│ Query execution:    ~50-100ms (indexed vectors)             │
│ Result transfer:    ~1-5ms                                  │
│ Total:              ~60-110ms                               │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Example

```
User Input (React):
  Embedding: [0.001, 0.002, ..., 0.999]  (1536 dims)
  k: 5
  Freshness slider: 0.2 (w_rec)
  Signal slider: 0.1 (w_sig)

                    │
                    ▼

REST Request:
  POST /api/rag/search
  {
    "embedding": [0.001, 0.002, ..., 0.999],
    "k": 5,
    "w_rec": 0.2,
    "w_sig": 0.1
  }

                    │
                    ▼

Server Processing:
  wRec = 0.2
  wSig = 0.1
  wCos = 1 - (0.2 + 0.1) = 0.7

  SQL Params:
    $1 = [0.001, 0.002, ..., 0.999]
    $2 = 5
    $3 = 0.7  (w_cos)
    $4 = 0.2  (w_rec)
    $5 = 0.1  (w_sig)

                    │
                    ▼

PostgreSQL:
  SELECT ... FROM api.rag_topk_weighted(
    $1::vector, $2::int, $3::real, $4::real, $5::real
  )

  Calculates:
    score = (0.7 * cos_sim) + (0.2 * recency_score) + (0.1 * signal_score)

  Returns top 5 by score

                    │
                    ▼

Response:
  {
    "ok": true,
    "k": 5,
    "weights": { "w_cos": 0.7, "w_rec": 0.2, "w_sig": 0.1 },
    "rows": [
      {
        "chunk_id": "doc-456-chunk-2",
        "score": 0.95,
        "days_old": 1,
        "chunk": "Recent important content..."
      },
      { ... 4 more ... }
    ]
  }

                    │
                    ▼

UI Rendering:
  Display 5 results ranked by score
  Highlight freshness (days_old)
  Show semantic similarity (cos_dist)
  Link to source (src)
```

## Performance Characteristics

```
Query Performance (typical):
  ┌─────────────────────────────────────────┐
  │ k=1   │ ~20ms  │ Single nearest neighbor │
  │ k=5   │ ~50ms  │ Default (recommended)   │
  │ k=10  │ ~80ms  │ Broader search          │
  │ k=50  │ ~150ms │ Maximum allowed         │
  └─────────────────────────────────────────┘

Concurrent Requests:
  ┌─────────────────────────────────────────┐
  │ 1 req  │ ~50ms  │ Single connection      │
  │ 5 reqs │ ~50ms  │ Pool (5 connections)   │
  │ 10 reqs│ ~100ms │ Queuing (max 5)        │
  │ 20 reqs│ ~200ms │ Queuing (max 5)        │
  └─────────────────────────────────────────┘

Memory Usage:
  ┌─────────────────────────────────────────┐
  │ Pool:        ~5MB (5 connections)       │
  │ Query:       ~1MB (k=5 result set)      │
  │ Per request: ~100KB (temporary)         │
  │ Total:       ~10MB baseline             │
  └─────────────────────────────────────────┘
```

---

**Visual Guide Created:** 2025-11-09
**Status:** Ready for implementation
