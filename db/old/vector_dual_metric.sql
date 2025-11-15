-- vector_dual_metric.sql
-- Dual-metric ANN for pgvector on rag_embeddings(emb) + simple helper funcs.
-- Cosine = default for text; L2 = optional when you encode magnitude.

BEGIN;

-- 0) Ensure helper schema
CREATE SCHEMA IF NOT EXISTS api;

-- 1) Indexes (IVF + HNSW) — use the correct pgvector opclasses
-- Cosine (recommended default for text RAG)
CREATE INDEX IF NOT EXISTS idx_rag_embeddings_ivf_cos
  ON rag_embeddings USING ivfflat (emb vector_cosine_ops) WITH (lists = 200);

CREATE INDEX IF NOT EXISTS idx_rag_embeddings_hnsw_cos
  ON rag_embeddings USING hnsw (emb vector_cosine_ops) WITH (m = 16, ef_construction = 128);

-- L2 (use only when vector norm has meaning)
CREATE INDEX IF NOT EXISTS idx_rag_embeddings_ivf_l2
  ON rag_embeddings USING ivfflat (emb vector_l2_ops) WITH (lists = 200);

CREATE INDEX IF NOT EXISTS idx_rag_embeddings_hnsw_l2
  ON rag_embeddings USING hnsw (emb vector_l2_ops) WITH (m = 16, ef_construction = 128);

-- 2) Helper functions
-- Cosine Top-K
CREATE OR REPLACE FUNCTION api.rag_topk_cosine(q vector, k int DEFAULT 8)
RETURNS TABLE(
  chunk_id   bigint,
  doc_id     text,
  src        text,
  chunk      text,
  model      text,
  dist       real,
  sim_cosine real,
  created_at timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT
    e.chunk_id,
    c.doc_id,
    c.src,
    c.chunk,
    e.model,
    (q <=> e.emb)::real                                 AS dist,         -- cosine distance (smaller is better)
    (1.0 - (q <=> e.emb))::real                         AS sim_cosine,   -- convenience similarity
    c.created_at
  FROM rag_embeddings e
  JOIN rag_chunks     c ON c.id = e.chunk_id
  ORDER BY q <=> e.emb
  LIMIT k;
$$;

-- L2 Top-K
CREATE OR REPLACE FUNCTION api.rag_topk_l2(q vector, k int DEFAULT 8)
RETURNS TABLE(
  chunk_id   bigint,
  doc_id     text,
  src        text,
  chunk      text,
  model      text,
  dist       real,
  created_at timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT
    e.chunk_id,
    c.doc_id,
    c.src,
    c.chunk,
    e.model,
    (q <-> e.emb)::real AS dist,      -- L2 distance (smaller is better)
    c.created_at
  FROM rag_embeddings e
  JOIN rag_chunks     c ON c.id = e.chunk_id
  ORDER BY q <-> e.emb
  LIMIT k;
$$;

-- Hybrid (cosine + recency in days) – smaller score is better
CREATE OR REPLACE FUNCTION api.rag_topk_hybrid_cosine(
  q vector,
  k int DEFAULT 8,
  w_dist real DEFAULT 0.8,
  w_recency real DEFAULT 0.2
)
RETURNS TABLE(
  chunk_id   bigint,
  doc_id     text,
  src        text,
  chunk      text,
  model      text,
  score      real,
  dist       real,
  days_old   real,
  created_at timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT
    e.chunk_id,
    c.doc_id,
    c.src,
    c.chunk,
    e.model,
    ( w_dist   * (q <=> e.emb)
    + w_recency* (EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400.0)
    )::real AS score,
    (q <=> e.emb)::real AS dist,
    (EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400.0)::real AS days_old,
    c.created_at
  FROM rag_embeddings e
  JOIN rag_chunks     c ON c.id = e.chunk_id
  ORDER BY 1
  LIMIT k;
$$;

-- 3) Permissions for your 'mcp' role (if present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp') THEN
    GRANT EXECUTE ON FUNCTION api.rag_topk_cosine(vector,int)                    TO mcp;
    GRANT EXECUTE ON FUNCTION api.rag_topk_l2(vector,int)                        TO mcp;
    GRANT EXECUTE ON FUNCTION api.rag_topk_hybrid_cosine(vector,int,real,real)   TO mcp;
  END IF;
END$$;

COMMIT;
