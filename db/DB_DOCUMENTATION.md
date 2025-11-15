# LiquidAIty DB – RAG Core (AGE + TimescaleDB + PostGIS + vector)

## Purpose
One-file, idempotent install of a minimal RAG substrate:
- Chunk store (`ag_catalog.rag_chunks`)
- Embeddings (`ag_catalog.rag_embeddings`) with dual metric indexes
- Canonical view `ag_catalog.rag_chunks_pk` that *always* exposes `chunk_id`
- Query functions (cosine, magnitude-aware L2, weighted hybrid)
- Embedded SMOKE checks

## Schemas
- api         → public functions for ingest & search
- ag_catalog  → storage tables, views, indexes

## Tables
- ag_catalog.rag_chunks
  - `chunk_id BIGINT PK` (or `id` remapped via view)
  - `doc_id TEXT`, `src TEXT`, `chunk TEXT`, `created_at TIMESTAMPTZ`
- ag_catalog.rag_embeddings
  - PK (`chunk_id`, `model`)
  - `emb vector`, `volume REAL`, `confidence REAL`, `scale REAL`
  - `created_at`, `updated_at`

`scale = volume * confidence` (computed at ingest)

## Views
- ag_catalog.rag_chunks_pk
  - Unifies primary key as `chunk_id` even if base table uses `id`
- ag_catalog.rag_docs
  - `(chunk_id, doc_id, src, chunk, chunk_created_at)`

## Indexes
- `idx_rag_embeddings_emb_l2`  (ivfflat, vector_l2_ops)
- `idx_rag_embeddings_emb_cos` (ivfflat, vector_cosine_ops)

## API Functions
- `api.ingest_embedding(p_chunk_id BIGINT, p_model TEXT, p_emb vector, p_volume REAL, p_confidence REAL) RETURNS void`
  - Upserts embedding; recomputes `scale`
- `api.rag_topk_cosine(q vector, k int)` → `(chunk_id, doc_id, src, chunk, model, cos_dist, sim_cosine, created_at)`
- `api.rag_topk_l2_mag(q vector, k int)` → `(chunk_id, doc_id, src, chunk, model, l2_dist, scale, adj, created_at)`
- `api.rag_topk_weighted(q vector, k int, w_cos real, w_rec real, w_sig real)` →
  `(chunk_id, doc_id, src, chunk, model, score, cos_dist, l2_dist, scale, days_old, created_at)`

## Weight Semantics (weighted)
- `sem = 1 - cos_dist`
- `rec = 1/(1+days_old)` (fresh = higher)
- `sig = min(1, scale/5)` (volume·confidence scale)
- `score = w_cos*sem + w_rec*rec + w_sig*sig`

## Repeatability
- All objects created with `IF NOT EXISTS` and `DROP FUNCTION/VIEW` as needed
- Safe to re-run; SMOKE prints 4 NOTICE lines

## Minimal ingest workflow
1. Insert chunk rows into `ag_catalog.rag_chunks`
2. For each chunk, call:
   `SELECT api.ingest_embedding($chunk_id, $model, $embedding, $volume, $confidence);`
3. At query time, build embedding and call one of:
   - `api.rag_topk_cosine(q,k)`
   - `api.rag_topk_l2_mag(q,k)`
   - `api.rag_topk_weighted(q,k,w_cos,w_rec,w_sig)`

## Ops
- Reindex after large ingest if recall is low
- `pg_dump` to version schema/data if desired
