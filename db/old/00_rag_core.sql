-- 00_rag_core.sql
-- Single-file, idempotent core + seed + smoke test.
-- Works with your current tables in ag_catalog and avoids vector/scalar ops.

BEGIN;

-- 0) Prereq
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS api;

-- 1) Tables (create if missing; never drop)
CREATE TABLE IF NOT EXISTS ag_catalog.rag_chunks (
  id          BIGSERIAL PRIMARY KEY,
  doc_id      TEXT,
  src         TEXT,
  chunk       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ag_catalog.rag_embeddings (
  chunk_id    BIGINT PRIMARY KEY REFERENCES ag_catalog.rag_chunks(id),
  model       TEXT,
  emb         VECTOR,            -- keeps whatever dim you already have (e.g., vector(1536))
  volume      REAL,
  confidence  REAL,
  scale       REAL,              -- = confidence * (1 + volume)
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ
);

-- Ensure columns exist (no-ops if already present)
ALTER TABLE ag_catalog.rag_embeddings
  ADD COLUMN IF NOT EXISTS model       TEXT,
  ADD COLUMN IF NOT EXISTS emb         VECTOR,
  ADD COLUMN IF NOT EXISTS volume      REAL,
  ADD COLUMN IF NOT EXISTS confidence  REAL,
  ADD COLUMN IF NOT EXISTS scale       REAL,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ;

-- 2) Indexes (only if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='ag_catalog' AND indexname='idx_rag_embeddings_hnsw_cos'
  ) THEN
    EXECUTE 'CREATE INDEX idx_rag_embeddings_hnsw_cos
               ON ag_catalog.rag_embeddings
            USING hnsw (emb vector_cosine_ops) WITH (m=16, ef_construction=128)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='ag_catalog' AND indexname='idx_rag_embeddings_hnsw_l2'
  ) THEN
    EXECUTE 'CREATE INDEX idx_rag_embeddings_hnsw_l2
               ON ag_catalog.rag_embeddings
            USING hnsw (emb vector_l2_ops) WITH (m=16, ef_construction=128)';
  END IF;
END$$;

-- 3) API functions

-- Upsert + magnitude signals (scale = confidence * (1 + volume))
CREATE OR REPLACE FUNCTION api.ingest_embedding(
  p_chunk_id   BIGINT,
  p_model      TEXT,
  p_emb        VECTOR,
  p_volume     REAL DEFAULT 1.0,
  p_confidence REAL DEFAULT 1.0
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_volume REAL := GREATEST(0.0, COALESCE(p_volume, 0.0));
  v_conf   REAL := GREATEST(0.0, COALESCE(p_confidence, 0.0));
  v_scale  REAL := v_conf * (1.0 + v_volume);
BEGIN
  UPDATE ag_catalog.rag_embeddings
     SET model      = p_model,
         emb        = p_emb,
         volume     = v_volume,
         confidence = v_conf,
         scale      = v_scale,
         updated_at = now()
   WHERE chunk_id = p_chunk_id;

  IF NOT FOUND THEN
    INSERT INTO ag_catalog.rag_embeddings
      (chunk_id, model, emb, volume, confidence, scale, created_at, updated_at)
    VALUES
      (p_chunk_id, p_model, p_emb, v_volume, v_conf, v_scale, now(), now());
  END IF;
END
$$;

-- Cosine (length-invariant)
CREATE OR REPLACE FUNCTION api.rag_topk_cosine(q VECTOR, k INT)
RETURNS TABLE (
  chunk_id BIGINT, doc_id TEXT, src TEXT, chunk TEXT, model TEXT,
  dist REAL, sim_cosine REAL, created_at TIMESTAMPTZ
)
LANGUAGE sql
SET search_path = ag_catalog, public, api
AS $$
  SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
         (e.emb <=> q)      AS dist,
         1 - (e.emb <=> q)  AS sim_cosine,
         c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks c ON c.id = e.chunk_id
   ORDER BY e.emb <=> q
   LIMIT k
$$;

-- L2 with magnitude awareness: adj = (L2 distance) / max(scale, 1e-6)
CREATE OR REPLACE FUNCTION api.rag_topk_l2_mag(q VECTOR, k INT)
RETURNS TABLE (
  chunk_id BIGINT, doc_id TEXT, src TEXT, chunk TEXT, model TEXT,
  dist REAL, scale REAL, adj REAL, created_at TIMESTAMPTZ
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
    JOIN ag_catalog.rag_chunks c ON c.id = e.chunk_id
   ORDER BY adj
   LIMIT k
$$;

-- Hybrid cosine + recency
CREATE OR REPLACE FUNCTION api.rag_topk_hybrid_cosine(
  q VECTOR, k INT, w_dist REAL, w_recency REAL
)
RETURNS TABLE (
  chunk_id BIGINT, doc_id TEXT, src TEXT, chunk TEXT, model TEXT,
  score REAL, dist REAL, days_old REAL, created_at TIMESTAMPTZ
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
      JOIN ag_catalog.rag_chunks c ON c.id = e.chunk_id
  )
  SELECT chunk_id, doc_id, src, chunk, model,
         (w_dist * (1 - dist)) + (w_recency * (1.0 / (1.0 + days_old))) AS score,
         dist, days_old, created_at
    FROM base
   ORDER BY score DESC
   LIMIT k
$$;

-- 4) Seed only if empty (uses current emb dimension if typmod is set; defaults to 1536)
DO $$
DECLARE
  v_cnt  BIGINT;
  v_dim  INT;
BEGIN
  SELECT COUNT(*) INTO v_cnt FROM ag_catalog.rag_chunks;
  IF v_cnt = 0 THEN
    SELECT COALESCE(
             NULLIF(regexp_replace(format_type(a.atttypid,a.atttypmod),'^vector\((\d+)\)$','\1'),'')::INT,
             1536
           )
      INTO v_dim
      FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='ag_catalog' AND c.relname='rag_embeddings' AND a.attname='emb'
     LIMIT 1;

    INSERT INTO ag_catalog.rag_chunks(doc_id, src, chunk, created_at)
    SELECT 'doc_'||i, 'seed', 'seed chunk '||i, now() - (i||' min')::interval
    FROM generate_series(1,5) AS i;

    WITH dim AS (SELECT v_dim AS d),
    mk AS (
      SELECT ('['||string_agg(to_char(random(),'FM0D0000'), ',')||']')::vector AS v
      FROM dim, LATERAL generate_series(1, v_dim)
    ),
    rows AS (
      SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM ag_catalog.rag_chunks
      ORDER BY id DESC
      LIMIT 5
    )
    SELECT api.ingest_embedding(
             p_chunk_id   := r.id,
             p_model      := 'seed-model',
             p_emb        := (SELECT v FROM mk),
             p_volume     := 1.0 + (rn * 0.1),
             p_confidence := 0.9
           )
    FROM rows r;
  END IF;

  UPDATE ag_catalog.rag_embeddings
     SET scale = COALESCE(scale, GREATEST(0.0, COALESCE(confidence,1.0)) * (1.0 + GREATEST(0.0, COALESCE(volume,1.0))))
   WHERE scale IS NULL;
END$$;

-- 5) SMOKE TEST (prints 4 result sets)
-- 5a) Counts
SELECT 'chunks' AS what, COUNT(*) FROM ag_catalog.rag_chunks
UNION ALL
SELECT 'embeddings', COUNT(*) FROM ag_catalog.rag_embeddings;

-- 5b) Cosine top-k
WITH q AS (
  SELECT emb AS v
    FROM ag_catalog.rag_embeddings
   ORDER BY updated_at DESC NULLS LAST, created_at DESC
   LIMIT 1
)
SELECT chunk_id, doc_id,
       ROUND(dist::numeric,6) AS cos_dist,
       ROUND(sim_cosine::numeric,6) AS sim
FROM api.rag_topk_cosine((SELECT v FROM q), 5);

-- 5c) L2 magnitude-aware
WITH q AS (
  SELECT emb AS v
    FROM ag_catalog.rag_embeddings
   ORDER BY updated_at DESC NULLS LAST, created_at DESC
   LIMIT 1
)
SELECT chunk_id, doc_id,
       ROUND(dist::numeric,6)  AS l2_dist,
       ROUND(scale::numeric,3) AS scale,
       ROUND(adj::numeric,6)   AS adj
FROM api.rag_topk_l2_mag((SELECT v FROM q), 5);

-- 5d) Hybrid (cosine + recency)
WITH q AS (
  SELECT emb AS v
    FROM ag_catalog.rag_embeddings
   ORDER BY updated_at DESC NULLS LAST, created_at DESC
   LIMIT 1
)
SELECT chunk_id, doc_id,
       ROUND(score::numeric,6)    AS score,
       ROUND(dist::numeric,6)     AS cos_dist,
       ROUND(days_old::numeric,3) AS days_old
FROM api.rag_topk_hybrid_cosine((SELECT v FROM q), 5, 0.9, 0.1);

COMMIT;
