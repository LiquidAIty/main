BEGIN;

-- === Extensions =============================================================
CREATE EXTENSION IF NOT EXISTS age;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- === Schemas ================================================================
CREATE SCHEMA IF NOT EXISTS api;
CREATE SCHEMA IF NOT EXISTS ag_catalog;

-- === Core Tables (create-if-missing; do NOT alter existing shapes) ==========
CREATE TABLE IF NOT EXISTS ag_catalog.rag_chunks (
  chunk_id   BIGINT PRIMARY KEY,
  doc_id     TEXT        NOT NULL,
  src        TEXT,
  chunk      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ag_catalog.rag_embeddings (
  chunk_id    BIGINT      NOT NULL REFERENCES ag_catalog.rag_chunks(chunk_id) ON DELETE CASCADE,
  model       TEXT        NOT NULL,
  emb         vector      NOT NULL,
  volume      REAL        NOT NULL DEFAULT 0,
  confidence  REAL        NOT NULL DEFAULT 0,
  scale       REAL        NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, model)
);

-- === Canonical view that ALWAYS exposes chunk_id ============================
-- (Handles DBs where rag_chunks primary key is named `id` instead of `chunk_id`)
DROP VIEW IF EXISTS ag_catalog.rag_chunks_pk;
DO $$
DECLARE
  has_chunk_id boolean;
  has_id       boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ag_catalog' AND table_name='rag_chunks' AND column_name='chunk_id'
  ) INTO has_chunk_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ag_catalog' AND table_name='rag_chunks' AND column_name='id'
  ) INTO has_id;

  IF has_chunk_id THEN
    EXECUTE $v$
      CREATE VIEW ag_catalog.rag_chunks_pk AS
      SELECT c.chunk_id, c.doc_id, c.src, c.chunk, c.created_at
      FROM ag_catalog.rag_chunks c
    $v$;
  ELSIF has_id THEN
    EXECUTE $v$
      CREATE VIEW ag_catalog.rag_chunks_pk AS
      SELECT c.id AS chunk_id, c.doc_id, c.src, c.chunk, c.created_at
      FROM ag_catalog.rag_chunks c
    $v$;
  ELSE
    RAISE EXCEPTION 'rag_chunks has neither column "chunk_id" nor "id"';
  END IF;
END
$$ LANGUAGE plpgsql;

-- For convenience (optional doc-view)
DROP VIEW IF EXISTS ag_catalog.rag_docs;
CREATE VIEW ag_catalog.rag_docs AS
SELECT chunk_id, doc_id, src, chunk, created_at AS chunk_created_at
FROM ag_catalog.rag_chunks_pk;

-- === Vector indexes (dual metric) ==========================================
CREATE INDEX IF NOT EXISTS idx_rag_embeddings_emb_l2
  ON ag_catalog.rag_embeddings USING ivfflat (emb vector_l2_ops) WITH (lists=100);
CREATE INDEX IF NOT EXISTS idx_rag_embeddings_emb_cos
  ON ag_catalog.rag_embeddings USING ivfflat (emb vector_cosine_ops) WITH (lists=100);

-- === Ingest/upsert ==========================================================
DROP FUNCTION IF EXISTS api.ingest_embedding(BIGINT, TEXT, vector, REAL, REAL);
CREATE FUNCTION api.ingest_embedding(
  p_chunk_id   BIGINT,
  p_model      TEXT,
  p_emb        vector,
  p_volume     REAL,
  p_confidence REAL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_scale REAL;
BEGIN
  IF p_emb IS NULL THEN
    RAISE EXCEPTION 'p_emb cannot be NULL';
  END IF;

  v_scale := GREATEST(0, COALESCE(p_volume,0) * COALESCE(p_confidence,0));

  INSERT INTO ag_catalog.rag_embeddings(chunk_id, model, emb, volume, confidence, scale, created_at, updated_at)
  VALUES (p_chunk_id, p_model, p_emb, COALESCE(p_volume,0), COALESCE(p_confidence,0), v_scale, now(), now())
  ON CONFLICT (chunk_id, model) DO UPDATE
    SET emb        = EXCLUDED.emb,
        volume     = EXCLUDED.volume,
        confidence = EXCLUDED.confidence,
        scale      = EXCLUDED.scale,
        updated_at = now();
END
$$;

-- === Cosine top-k ===========================================================
DROP FUNCTION IF EXISTS api.rag_topk_cosine(vector, INTEGER);
CREATE FUNCTION api.rag_topk_cosine(
  q vector,
  k INTEGER
) RETURNS TABLE (
  chunk_id   BIGINT,
  doc_id     TEXT,
  src        TEXT,
  chunk      TEXT,
  model      TEXT,
  cos_dist   REAL,
  sim_cosine REAL,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT
    e.chunk_id,
    c.doc_id,
    c.src,
    c.chunk,
    e.model,
    (e.emb <=> q)::REAL AS cos_dist,
    (1 - (e.emb <=> q))::REAL AS sim_cosine,
    c.created_at
  FROM ag_catalog.rag_embeddings e
  JOIN ag_catalog.rag_chunks_pk  c ON c.chunk_id = e.chunk_id
  ORDER BY e.emb <=> q
  LIMIT GREATEST(1, LEAST(k, 50));
$$;

-- === L2 magnitude-aware =====================================================
DROP FUNCTION IF EXISTS api.rag_topk_l2_mag(vector, INTEGER);
CREATE FUNCTION api.rag_topk_l2_mag(
  q vector,
  k INTEGER
) RETURNS TABLE (
  chunk_id BIGINT,
  doc_id   TEXT,
  src      TEXT,
  chunk    TEXT,
  model    TEXT,
  l2_dist  REAL,
  scale    REAL,
  adj      REAL,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  WITH base AS (
    SELECT
      e.chunk_id,
      c.doc_id,
      c.src,
      c.chunk,
      e.model,
      (e.emb <-> q)::REAL AS l2_dist,
      e.scale::REAL       AS scale,
      c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks_pk  c ON c.chunk_id = e.chunk_id
  )
  SELECT
    b.chunk_id, b.doc_id, b.src, b.chunk, b.model,
    b.l2_dist,
    b.scale,
    (b.l2_dist * (1.0 / GREATEST(0.1, b.scale)))::REAL AS adj,
    b.created_at
  FROM base b
  ORDER BY b.l2_dist ASC
  LIMIT GREATEST(1, LEAST(k, 50));
$$;

-- === Weighted hybrid (cosine + recency + signal) ===========================
DROP FUNCTION IF EXISTS api.rag_topk_weighted(vector, INTEGER, REAL, REAL, REAL);
CREATE FUNCTION api.rag_topk_weighted(
  q     vector,
  k     INTEGER,
  w_cos REAL,    -- semantic
  w_rec REAL,    -- recency
  w_sig REAL     -- signal
) RETURNS TABLE (
  chunk_id BIGINT,
  doc_id   TEXT,
  src      TEXT,
  chunk    TEXT,
  model    TEXT,
  score    REAL,
  cos_dist REAL,
  l2_dist  REAL,
  scale    REAL,
  days_old REAL,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  WITH base AS (
    SELECT
      e.chunk_id,
      c.doc_id,
      c.src,
      c.chunk,
      e.model,
      (e.emb <=> q)::REAL AS cos_dist,
      (e.emb <-> q)::REAL AS l2_dist,
      e.scale::REAL       AS scale,
      EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400.0::REAL AS days_old,
      c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks_pk  c ON c.chunk_id = e.chunk_id
  ), parts AS (
    SELECT
      b.*,
      (1 - b.cos_dist)::REAL           AS sem,
      (1.0 / (1.0 + b.days_old))::REAL AS rec,
      LEAST(1.0, b.scale / 5.0)::REAL  AS sig
    FROM base b
  )
  SELECT
    p.chunk_id, p.doc_id, p.src, p.chunk, p.model,
    (w_cos * p.sem + w_rec * p.rec + w_sig * p.sig)::REAL AS score,
    p.cos_dist,
    p.l2_dist,
    p.scale,
    p.days_old,
    p.created_at
  FROM parts p
  ORDER BY score DESC
  LIMIT GREATEST(1, LEAST(k, 50));
$$;

-- === Embedded SMOKE (prints 4 NOTICE lines) ================================
DO $smoke$
DECLARE
  v vector; r RECORD; c1 INT; c2 INT;
BEGIN
  SELECT emb INTO v
  FROM ag_catalog.rag_embeddings
  ORDER BY updated_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  SELECT COUNT(*) INTO c1 FROM ag_catalog.rag_chunks_pk;
  SELECT COUNT(*) INTO c2 FROM ag_catalog.rag_embeddings;
  RAISE NOTICE 'SMOKE counts -> chunks=%, embeddings=%', c1, c2;

  SELECT chunk_id, cos_dist, sim_cosine INTO r
  FROM api.rag_topk_cosine(v, 1)
  ORDER BY cos_dist ASC LIMIT 1;
  RAISE NOTICE 'SMOKE cosine  -> top chunk_id=%, cos_dist=%, sim=%',
    r.chunk_id, r.cos_dist, r.sim_cosine;

  SELECT chunk_id, l2_dist, scale INTO r
  FROM api.rag_topk_l2_mag(v, 1)
  ORDER BY l2_dist ASC LIMIT 1;
  RAISE NOTICE 'SMOKE l2_mag  -> top chunk_id=%, l2_dist=%, scale=%',
    r.chunk_id, r.l2_dist, r.scale;

  SELECT chunk_id, score, days_old INTO r
  FROM api.rag_topk_weighted(v, 1, 0.8, 0.1, 0.1)
  ORDER BY score DESC LIMIT 1;
  RAISE NOTICE 'SMOKE weighted-> top chunk_id=%, score=%, days_old=%',
    r.chunk_id, r.score, r.days_old;
END
$smoke$ LANGUAGE plpgsql;

COMMIT;
