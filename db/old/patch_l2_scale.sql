BEGIN;

CREATE SCHEMA IF NOT EXISTS api;

-- Ensure columns exist on ag_catalog.rag_embeddings
ALTER TABLE ag_catalog.rag_embeddings
  ADD COLUMN IF NOT EXISTS volume      real,
  ADD COLUMN IF NOT EXISTS confidence  real,
  ADD COLUMN IF NOT EXISTS scale       real,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz;

-- Backfill scale if NULL: scale = confidence * (1 + volume)
UPDATE ag_catalog.rag_embeddings
SET scale = COALESCE(scale,
                     GREATEST(0.0, COALESCE(confidence, 1.0)) * (1.0 + GREATEST(0.0, COALESCE(volume, 0.0))))
WHERE scale IS NULL;

-- Drop & recreate the L2 function with scale in the OUTs
DROP FUNCTION IF EXISTS api.rag_topk_l2_mag(vector,int) CASCADE;

CREATE OR REPLACE FUNCTION api.rag_topk_l2_mag(q vector, k int)
RETURNS TABLE (
  chunk_id  bigint,
  doc_id    text,
  src       text,
  chunk     text,
  model     text,
  dist      real,     -- raw L2 distance
  scale     real,     -- magnitude weight (confidence*(1+volume))
  adj       real,     -- distance / scale
  created_at timestamptz
)
LANGUAGE sql
SET search_path = ag_catalog, public, api
AS $$
  SELECT
    e.chunk_id,
    c.doc_id,
    c.src,
    c.chunk,
    e.model,
    (e.emb <-> q)                                        AS dist,
    COALESCE(e.scale, 0.0)                               AS scale,
    (e.emb <-> q) / GREATEST(COALESCE(e.scale, 0.0), 1e-6) AS adj,
    c.created_at
  FROM ag_catalog.rag_embeddings e
  JOIN ag_catalog.rag_chunks     c ON c.id = e.chunk_id
  ORDER BY adj
  LIMIT k
$$;

COMMIT;
