@'
BEGIN;

CREATE SCHEMA IF NOT EXISTS api;

-- Drop first so OUT signatures can change safely
DROP FUNCTION IF EXISTS api.rag_topk_l2_mag(vector,int) CASCADE;
DROP FUNCTION IF EXISTS api.rag_topk_cosine(vector,int) CASCADE;
DROP FUNCTION IF EXISTS api.rag_topk_hybrid_cosine(vector,int,real,real) CASCADE;

-- Ingest: store emb and a magnitude scale = confidence * (1 + volume)
CREATE OR REPLACE FUNCTION api.ingest_embedding(
  p_chunk_id   bigint,
  p_model      text,
  p_emb        vector,
  p_volume     real DEFAULT 1.0,
  p_confidence real DEFAULT 1.0
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  l_volume real := GREATEST(0.0, COALESCE(p_volume, 0.0));
  l_conf   real := GREATEST(0.0, COALESCE(p_confidence, 0.0));
  l_scale  real := l_conf * (1.0 + l_volume);
BEGIN
  ALTER TABLE ag_catalog.rag_embeddings
    ADD COLUMN IF NOT EXISTS volume     real,
    ADD COLUMN IF NOT EXISTS confidence real,
    ADD COLUMN IF NOT EXISTS scale      real,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

  UPDATE ag_catalog.rag_embeddings
     SET model       = p_model,
         emb         = p_emb,
         volume      = l_volume,
         confidence  = l_conf,
         scale       = l_scale,
         updated_at  = NOW()
   WHERE chunk_id = p_chunk_id;

  IF NOT FOUND THEN
    INSERT INTO ag_catalog.rag_embeddings
      (chunk_id, model, emb, volume, confidence, scale, created_at, updated_at)
    VALUES
      (p_chunk_id, p_model, p_emb, l_volume, l_conf, l_scale, NOW(), NOW());
  END IF;
END;
$$;

-- Cosine (length-invariant)
CREATE OR REPLACE FUNCTION api.rag_topk_cosine(q vector, k int)
RETURNS TABLE (
  chunk_id bigint, doc_id text, src text, chunk text, model text,
  dist real, sim_cosine real, created_at timestamptz
)
LANGUAGE sql
SET search_path = ag_catalog, public, api
AS $$
  SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
         (e.emb <=> q)      AS dist,
         1 - (e.emb <=> q)  AS sim_cosine,
         c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks     c ON c.id = e.chunk_id
   ORDER BY e.emb <=> q
   LIMIT k
$$;

-- L2 with magnitude awareness via scale (no vector/real ops)
CREATE OR REPLACE FUNCTION api.rag_topk_l2_mag(q vector, k int)
RETURNS TABLE (
  chunk_id bigint, doc_id text, src text, chunk text, model text,
  dist real, scale real, adj real, created_at timestamptz
)
LANGUAGE sql
SET search_path = ag_catalog, public, api
AS $$
  SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
         (e.emb <-> q)                                        AS dist,
         COALESCE(e.scale, 0.0)                               AS scale,
         (e.emb <-> q) / GREATEST(COALESCE(e.scale,0.0),1e-6) AS adj,
         c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks     c ON c.id = e.chunk_id
   ORDER BY adj
   LIMIT k
$$;

-- Hybrid cosine + recency
CREATE OR REPLACE FUNCTION api.rag_topk_hybrid_cosine(
  q vector, k int, w_dist real, w_recency real
)
RETURNS TABLE (
  chunk_id bigint, doc_id text, src text, chunk text, model text,
  score real, dist real, days_old real, created_at timestamptz
)
LANGUAGE sql
SET search_path = ag_catalog, public, api
AS $$
  WITH base AS (
    SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
           (e.emb <=> q) AS dist,
           EXTRACT(EPOCH FROM (now() - c.created_at))/86400.0 AS days_old,
           c.created_at
      FROM ag_catalog.rag_embeddings e
      JOIN ag_catalog.rag_chunks     c ON c.id = e.chunk_id
  )
  SELECT chunk_id, doc_id, src, chunk, model,
         (w_dist * (1 - dist)) + (w_recency * (1.0 / (1.0 + days_old))) AS score,
         dist, days_old, created_at
    FROM base
   ORDER BY score DESC
   LIMIT k
$$;

COMMIT;
'@ | Set-Content -Encoding UTF8 .\patch_no_scalar_ops.sql
