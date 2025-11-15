BEGIN;

-- =======================
-- Extensions (idempotent)
-- =======================
-- You already have these installed; keeping them here makes the file portable.
CREATE EXTENSION IF NOT EXISTS age;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============
-- API schema
-- ============
CREATE SCHEMA IF NOT EXISTS api;

-- ===========================
-- Core RAG tables (AGE space)
-- Keep tables under ag_catalog to match your current install
-- ===========================
-- Chunks (unique doc_id)
CREATE TABLE IF NOT EXISTS ag_catalog.rag_chunks (
  id         BIGSERIAL PRIMARY KEY,
  doc_id     TEXT NOT NULL UNIQUE,
  src        TEXT,
  chunk      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Embeddings (one embedding row per chunk_id)
CREATE TABLE IF NOT EXISTS ag_catalog.rag_embeddings (
  chunk_id    BIGINT PRIMARY KEY REFERENCES ag_catalog.rag_chunks(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  emb         vector(1536) NOT NULL,
  volume      REAL,
  confidence  REAL,
  scale       REAL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ
);

-- Indexes (idempotent)
DO $$
BEGIN
  -- created_at sort helper
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_rag_embeddings_created_at'
      AND n.nspname='ag_catalog'
  ) THEN
    EXECUTE 'CREATE INDEX idx_rag_embeddings_created_at ON ag_catalog.rag_embeddings USING btree (created_at)';
  END IF;

  -- HNSW cosine on emb
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_rag_embeddings_hnsw_cos'
      AND n.nspname='ag_catalog'
  ) THEN
    EXECUTE 'CREATE INDEX idx_rag_embeddings_hnsw_cos ON ag_catalog.rag_embeddings USING hnsw (emb vector_cosine_ops) WITH (m=16, ef_construction=128)';
  END IF;

  -- HNSW L2 on emb
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_rag_embeddings_hnsw_l2'
      AND n.nspname='ag_catalog'
  ) THEN
    EXECUTE 'CREATE INDEX idx_rag_embeddings_hnsw_l2 ON ag_catalog.rag_embeddings USING hnsw (emb vector_l2_ops) WITH (m=16, ef_construction=128)';
  END IF;
END$$;

-- ===================================================
-- Minimal ingest helper (no vector-scalar math)
-- Stores emb and magnitude proxy "scale" = confidence*(1+volume)
-- ===================================================
CREATE OR REPLACE FUNCTION api.ingest_embedding(
  p_chunk_id   BIGINT,
  p_model      TEXT,
  p_emb        vector,
  p_volume     REAL DEFAULT 1.0,
  p_confidence REAL DEFAULT 1.0
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  l_volume REAL := GREATEST(0.0, COALESCE(p_volume, 0.0));
  l_conf   REAL := GREATEST(0.0, COALESCE(p_confidence, 0.0));
  l_scale  REAL := l_conf * (1.0 + l_volume);
BEGIN
  UPDATE ag_catalog.rag_embeddings
     SET model      = p_model,
         emb        = p_emb,
         volume     = l_volume,
         confidence = l_conf,
         scale      = l_scale,
         updated_at = now()
   WHERE chunk_id   = p_chunk_id;

  IF NOT FOUND THEN
    INSERT INTO ag_catalog.rag_embeddings
      (chunk_id, model, emb, volume, confidence, scale, created_at, updated_at)
    VALUES
      (p_chunk_id, p_model, p_emb, l_volume, l_conf, l_scale, now(), now());
  END IF;
END
$$;

-- =======================================
-- Query helpers (cosine, L2-mag, hybrid)
-- =======================================
-- Cosine: length-invariant semantic similarity
CREATE OR REPLACE FUNCTION api.rag_topk_cosine(q vector, k int)
RETURNS TABLE (
  chunk_id BIGINT,
  doc_id   TEXT,
  src      TEXT,
  chunk    TEXT,
  model    TEXT,
  dist     REAL,
  sim_cosine REAL,
  created_at TIMESTAMPTZ
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

-- L2 with magnitude weighting via "scale" (lower adj is better)
CREATE OR REPLACE FUNCTION api.rag_topk_l2_mag(q vector, k int)
RETURNS TABLE (
  chunk_id BIGINT,
  doc_id   TEXT,
  src      TEXT,
  chunk    TEXT,
  model    TEXT,
  dist     REAL,
  scale    REAL,
  adj      REAL,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SET search_path = ag_catalog, public, api
AS $$
  SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
         (e.emb <-> q) AS dist,
         COALESCE(e.scale, 0.0) AS scale,
         (e.emb <-> q) / GREATEST(COALESCE(e.scale, 0.0), 1e-6) AS adj,
         c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks     c ON c.id = e.chunk_id
   ORDER BY adj
   LIMIT k
$$;

-- Hybrid: cosine + recency (days_old)
CREATE OR REPLACE FUNCTION api.rag_topk_hybrid_cosine(
  q vector, k int, w_dist real, w_recency real
)
RETURNS TABLE (
  chunk_id BIGINT,
  doc_id   TEXT,
  src      TEXT,
  chunk    TEXT,
  model    TEXT,
  score    REAL,
  dist     REAL,
  days_old REAL,
  created_at TIMESTAMPTZ
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

-- =========================
-- Smoke seed (optional)
-- Only seeds when tables are empty
-- =========================
DO $$
DECLARE
  need_seed BOOLEAN;
BEGIN
  SELECT (SELECT COUNT(*) FROM ag_catalog.rag_chunks)=0
     AND (SELECT COUNT(*) FROM ag_catalog.rag_embeddings)=0
    INTO need_seed;

  IF need_seed THEN
    INSERT INTO ag_catalog.rag_chunks(doc_id, src, chunk, created_at)
    SELECT 'doc_'||gs, 'seed', 'seed chunk '||gs, now() - (gs||' min')::interval
    FROM generate_series(1,5) gs
    ON CONFLICT (doc_id) DO NOTHING;

    -- synth 1536-d vectors and store with varying volume/confidence
    WITH ids AS (
      SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM ag_catalog.rag_chunks
      ORDER BY id
      LIMIT 5
    ),
    vec AS (
      SELECT rn,
             ('[' || string_agg(to_char(random(),'FM0D0000'), ',') || ']')::vector AS v
      FROM ids, LATERAL generate_series(1,1536)
      GROUP BY rn
    )
    INSERT INTO ag_catalog.rag_embeddings(chunk_id, model, emb, volume, confidence, scale, created_at, updated_at)
    SELECT i.id,
           'seed-model',
           v.v,
           CASE rn WHEN 1 THEN 3.8 WHEN 2 THEN 0.35 WHEN 3 THEN  -0.16 WHEN 4 THEN -0.4 ELSE -0.5 END + 1.0, -- mapped later by scale formula
           CASE rn WHEN 1 THEN 0.95 WHEN 2 THEN 0.90 WHEN 3 THEN   0.80 WHEN 4 THEN 0.75 ELSE 0.60 END,
           NULL, now(), now()
    FROM ids i
    JOIN vec v USING (rn);

    -- backfill scale from volume + confidence for the seeds
    UPDATE ag_catalog.rag_embeddings
       SET scale = GREATEST(0.0, COALESCE(confidence,1.0)) * (1.0 + GREATEST(0.0, COALESCE(volume,0.0)))
     WHERE scale IS NULL;
  END IF;
END$$;

-- =========================
-- Single-file SMOKE TESTS
-- (keep in transaction so it rolls back on failure)
-- =========================

-- 1) counts
DO $$
DECLARE c1 INT; c2 INT;
BEGIN
  SELECT COUNT(*) INTO c1 FROM ag_catalog.rag_chunks;
  SELECT COUNT(*) INTO c2 FROM ag_catalog.rag_embeddings;
  RAISE NOTICE 'SMOKE counts -> chunks=%, embeddings=%', c1, c2;
END$$;

-- 2) cosine
DO $$
DECLARE r RECORD;
BEGIN
  WITH q AS (
    SELECT emb AS v
    FROM ag_catalog.rag_embeddings
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  )
  SELECT * INTO r
  FROM api.rag_topk_cosine((SELECT v FROM q), 1);
  RAISE NOTICE 'SMOKE cosine -> top chunk_id=%, dist=%, sim=%', r.chunk_id, r.dist, r.sim_cosine;
END$$;

-- 3) L2 magnitude-aware
DO $$
DECLARE r RECORD;
BEGIN
  WITH q AS (
    SELECT emb AS v
    FROM ag_catalog.rag_embeddings
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  )
  SELECT * INTO r
  FROM api.rag_topk_l2_mag((SELECT v FROM q), 1);
  RAISE NOTICE 'SMOKE l2_mag -> top chunk_id=%, dist=%, scale=%, adj=%', r.chunk_id, r.dist, r.scale, r.adj;
END$$;

-- 4) hybrid
DO $$
DECLARE r RECORD;
BEGIN
  WITH q AS (
    SELECT emb AS v
    FROM ag_catalog.rag_embeddings
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  )
  SELECT * INTO r
  FROM api.rag_topk_hybrid_cosine((SELECT v FROM q), 1, 0.9, 0.1);
  RAISE NOTICE 'SMOKE hybrid -> top chunk_id=%, score=%, dist=%, days_old=%', r.chunk_id, r.score, r.dist, r.days_old;
END$$;

COMMIT;
