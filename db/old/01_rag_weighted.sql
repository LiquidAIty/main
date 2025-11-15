BEGIN;

-- Ensure schema exists
CREATE SCHEMA IF NOT EXISTS api;

-- Weighted tri-score: cosine (semantic) + recency + magnitude-aware signal
-- Inputs:
--   q: query embedding (vector)
--   k: top-k
--   w_cos: weight for cosine similarity
--   w_rec: weight for recency
--   w_sig: weight for signal strength (from volume/confidence scale)
-- Notes:
--   We normalize weights internally so sum=1 even if caller passes arbitrary values.
CREATE OR REPLACE FUNCTION api.rag_topk_weighted(
  q vector, k int,
  w_cos real, w_rec real, w_sig real
)
RETURNS TABLE (
  chunk_id   bigint,
  doc_id     text,
  src        text,
  chunk      text,
  model      text,
  score      real,
  cos_dist   real,
  l2_dist    real,
  scale      real,
  days_old   real,
  created_at timestamptz
)
LANGUAGE sql
SET search_path = ag_catalog, public, api
AS $$
  WITH weights AS (
    SELECT
      GREATEST(0.0, COALESCE(w_cos, 0.0)) AS w_cos_raw,
      GREATEST(0.0, COALESCE(w_rec, 0.0)) AS w_rec_raw,
      GREATEST(0.0, COALESCE(w_sig, 0.0)) AS w_sig_raw
  ),
  w AS (
    SELECT
      CASE WHEN (w_cos_raw + w_rec_raw + w_sig_raw) > 0
           THEN w_cos_raw / (w_cos_raw + w_rec_raw + w_sig_raw)
           ELSE 1.0 END AS w_cos,
      CASE WHEN (w_cos_raw + w_rec_raw + w_sig_raw) > 0
           THEN w_rec_raw / (w_cos_raw + w_rec_raw + w_sig_raw)
           ELSE 0.0 END AS w_rec,
      CASE WHEN (w_cos_raw + w_rec_raw + w_sig_raw) > 0
           THEN w_sig_raw / (w_cos_raw + w_rec_raw + w_sig_raw)
           ELSE 0.0 END AS w_sig
    FROM weights
  ),
  base AS (
    SELECT
      e.chunk_id, c.doc_id, c.src, c.chunk, e.model, c.created_at,
      (e.emb <=> q) AS cos_dist,      -- cosine distance (0 better)
      (e.emb <-> q) AS l2_dist,       -- L2 distance
      COALESCE(e.scale, 0.0) AS scale,
      EXTRACT(EPOCH FROM (now() - c.created_at))/86400.0 AS days_old
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks     c ON c.id = e.chunk_id
  ),
  parts AS (
    SELECT
      b.*,
      (1 - b.cos_dist) AS cos_part,                       -- higher is better
      (1.0 / (1.0 + b.days_old)) AS rec_part,             -- fresher → higher
      (1.0 / (1.0 + (b.l2_dist / GREATEST(b.scale,1e-6)))) AS sig_part -- more scale → higher
    FROM base b
  )
  SELECT
    p.chunk_id, p.doc_id, p.src, p.chunk, p.model,
    (w.w_cos * p.cos_part + w.w_rec * p.rec_part + w.w_sig * p.sig_part) AS score,
    p.cos_dist, p.l2_dist, p.scale, p.days_old, p.created_at
  FROM parts p CROSS JOIN w
  ORDER BY score DESC
  LIMIT k
$$;

-- ---------- Smoke: run a single query and print top row via NOTICE ----------
DO $$
DECLARE
  v_q   vector;
  v_rec RECORD;
BEGIN
  -- Use the newest embedding as a query (just like previous smokes)
  SELECT emb INTO v_q
  FROM ag_catalog.rag_embeddings
  ORDER BY updated_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  -- Example weights: 0.8 semantic, 0.1 recency, 0.1 signal
  SELECT *
  INTO v_rec
  FROM api.rag_topk_weighted(v_q, 5, 0.8, 0.1, 0.1)
  LIMIT 1;

  RAISE NOTICE 'SMOKE weighted -> top chunk_id=%, score=%, cos_dist=%, l2_dist=%, scale=%, days_old=%',
    v_rec.chunk_id, v_rec.score, v_rec.cos_dist, v_rec.l2_dist, v_rec.scale, v_rec.days_old;
END$$;

COMMIT;
