BEGIN;

CREATE SCHEMA IF NOT EXISTS api;

-- drop old versions if present
DROP FUNCTION IF EXISTS api.rag_topk_cosine(vector,int) CASCADE;
DROP FUNCTION IF EXISTS api.rag_topk_l2(vector,int) CASCADE;
DROP FUNCTION IF EXISTS api.rag_topk_hybrid_cosine(vector,int,real,real) CASCADE;

-- COSINE (text default)
CREATE OR REPLACE FUNCTION api.rag_topk_cosine(q vector, k int)
RETURNS TABLE (
  chunk_id bigint, doc_id text, src text, chunk text, model text,
  dist real, sim_cosine real, created_at timestamptz
) LANGUAGE sql AS $$
  SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
         (e.emb <=> q)       AS dist,
         1 - (e.emb <=> q)   AS sim_cosine,
         c.created_at
  FROM ag_catalog.rag_embeddings e
  JOIN ag_catalog.rag_chunks   c ON c.id = e.chunk_id
  ORDER BY e.emb <=> q
  LIMIT k
$$;

-- L2 (only when magnitude matters)
CREATE OR REPLACE FUNCTION api.rag_topk_l2(q vector, k int)
RETURNS TABLE (
  chunk_id bigint, doc_id text, src text, chunk text, model text,
  dist real, created_at timestamptz
) LANGUAGE sql AS $$
  SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
         (e.emb <-> q) AS dist,
         c.created_at
  FROM ag_catalog.rag_embeddings e
  JOIN ag_catalog.rag_chunks   c ON c.id = e.chunk_id
  ORDER BY e.emb <-> q
  LIMIT k
$$;

-- COSINE + recency hybrid
CREATE OR REPLACE FUNCTION api.rag_topk_hybrid_cosine(
  q vector, k int, w_dist real, w_recency real
)
RETURNS TABLE (
  chunk_id bigint, doc_id text, src text, chunk text, model text,
  score real, dist real, days_old real, created_at timestamptz
) LANGUAGE sql AS $$
  WITH base AS (
    SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
           (e.emb <=> q) AS dist,
           EXTRACT(EPOCH FROM (now() - c.created_at))/86400.0 AS days_old,
           c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks   c ON c.id = e.chunk_id
  )
  SELECT chunk_id, doc_id, src, chunk, model,
         (w_dist * (1 - dist)) + (w_recency * (1.0 / (1.0 + days_old))) AS score,
         dist, days_old, created_at
  FROM base
  ORDER BY score DESC
  LIMIT k
$$;

-- keep them stable regardless of caller search_path
ALTER FUNCTION api.rag_topk_cosine(vector,int)
  SET search_path = ag_catalog, public, api;
ALTER FUNCTION api.rag_topk_l2(vector,int)
  SET search_path = ag_catalog, public, api;
ALTER FUNCTION api.rag_topk_hybrid_cosine(vector,int,real,real)
  SET search_path = ag_catalog, public, api;

-- grant to the agent role if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp') THEN
    GRANT EXECUTE ON FUNCTION api.rag_topk_cosine(vector,int) TO mcp;
    GRANT EXECUTE ON FUNCTION api.rag_topk_l2(vector,int) TO mcp;
    GRANT EXECUTE ON FUNCTION api.rag_topk_hybrid_cosine(vector,int,real,real) TO mcp;
  END IF;
END$$;

COMMIT;
