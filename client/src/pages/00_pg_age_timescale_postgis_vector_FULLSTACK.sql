-- 00_pg_age_timescale_postgis_vector_FULLSTACK.sql
-- One-file, repeatable setup: Extensions + App schemas + RAG + System/User/Project + Agent Docs + Seed + Smoke
BEGIN;

-- ===== Extensions (kept idempotent) =====
CREATE EXTENSION IF NOT EXISTS age;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ===== Schemas =====
CREATE SCHEMA IF NOT EXISTS api;
CREATE SCHEMA IF NOT EXISTS app;

-- ===== App data =====
CREATE TABLE IF NOT EXISTS app.system_info (
  key   TEXT PRIMARY KEY,
  val   JSONB NOT NULL,
  ts    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.user_info (
  user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  handle  TEXT UNIQUE,
  profile JSONB,
  ts      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.project_info (
  project_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id   UUID REFERENCES app.user_info(user_id) ON DELETE SET NULL,
  name       TEXT,
  meta       JSONB,
  ts         TIMESTAMPTZ DEFAULT now()
);

-- Optional: where to store agent prompts/instructions/docs the UI can read
CREATE TABLE IF NOT EXISTS app.agent_docs (
  doc_key   TEXT PRIMARY KEY,     -- e.g., 'rag.search/usage'
  title     TEXT NOT NULL,
  markdown  TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE VIEW app.v_projects AS
SELECT p.project_id, p.name, p.meta, u.handle AS owner
FROM app.project_info p
LEFT JOIN app.user_info u ON u.user_id = p.owner_id;

-- ===== RAG core (kept under ag_catalog to match your existing layout) =====
CREATE TABLE IF NOT EXISTS ag_catalog.rag_chunks (
  chunk_id   BIGSERIAL PRIMARY KEY,
  doc_id     TEXT NOT NULL,
  src        TEXT,
  chunk      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ag_catalog.rag_embeddings (
  id         BIGSERIAL PRIMARY KEY,
  chunk_id   BIGINT NOT NULL REFERENCES ag_catalog.rag_chunks(chunk_id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  emb        VECTOR(1536) NOT NULL,
  volume     REAL DEFAULT 1.0,
  confidence REAL DEFAULT 1.0,
  scale      REAL GENERATED ALWAYS AS (GREATEST(0.0, volume * confidence)) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- updated_at trigger helper (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_updated_at') THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $f$
    BEGIN NEW.updated_at := now(); RETURN NEW; END $f$;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='rag_embeddings_touch') THEN
    CREATE TRIGGER rag_embeddings_touch
    BEFORE UPDATE ON ag_catalog.rag_embeddings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END$$;

-- ===== RAG functions =====
-- Ingest (append history)
CREATE OR REPLACE FUNCTION api.ingest_embedding(
  p_chunk_id BIGINT,
  p_model    TEXT,
  p_emb      VECTOR,
  p_volume   REAL,
  p_conf     REAL
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ag_catalog.rag_embeddings(chunk_id, model, emb, volume, confidence)
  VALUES (p_chunk_id, p_model, p_emb, GREATEST(0,p_volume), GREATEST(0,p_conf));
END$$;

-- Cosine top-k
CREATE OR REPLACE FUNCTION api.rag_topk_cosine(
  q VECTOR, k INT
) RETURNS TABLE(chunk_id BIGINT, doc_id TEXT, cos_dist REAL, sim_cosine REAL) LANGUAGE sql AS $$
  SELECT e.chunk_id, c.doc_id,
         (e.emb <=> q)::REAL               AS cos_dist,     -- pgvector cosine distance
         (1.0 - (e.emb <=> q))::REAL       AS sim_cosine
  FROM ag_catalog.rag_embeddings e
  JOIN ag_catalog.rag_chunks c ON c.chunk_id = e.chunk_id
  ORDER BY e.emb <=> q ASC
  LIMIT k;
$$;

-- L2 with magnitude-awareness (scale from volume*confidence)
CREATE OR REPLACE FUNCTION api.rag_topk_l2_mag(
  q VECTOR, k INT
) RETURNS TABLE(chunk_id BIGINT, doc_id TEXT, l2_dist REAL, scale REAL, adj REAL) LANGUAGE sql AS $$
  WITH base AS (
    SELECT e.chunk_id, c.doc_id,
           (e.emb <-> q)::REAL AS l2_dist,
           e.scale
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks c ON c.chunk_id = e.chunk_id
  )
  SELECT chunk_id, doc_id, l2_dist, scale, (l2_dist / GREATEST(0.1, scale))::REAL AS adj
  FROM base
  ORDER BY adj ASC
  LIMIT k;
$$;

-- Weighted (cosine + recency + signal)
CREATE OR REPLACE FUNCTION api.rag_topk_weighted(
  q VECTOR, k INT, w_cos REAL, w_rec REAL, w_sig REAL
) RETURNS TABLE(
  chunk_id BIGINT, doc_id TEXT, src TEXT, chunk TEXT, model TEXT,
  score REAL, cos_dist REAL, l2_dist REAL, scale REAL, days_old REAL, created_at TIMESTAMPTZ
) LANGUAGE sql AS $$
  WITH base AS (
    SELECT
      e.chunk_id, c.doc_id, c.src, c.chunk, e.model, e.created_at,
      (e.emb <=> q)::REAL AS cos_dist,      -- lower better
      (e.emb <-> q)::REAL AS l2_dist,       -- lower better
      e.scale,
      EXTRACT(EPOCH FROM (now() - e.created_at))/86400.0 AS days_old
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks c ON c.chunk_id = e.chunk_id
  ),
  norms AS (
    SELECT *,
      (1.0 - cos_dist)                      AS sem_score,         -- 0..1 (higher better)
      GREATEST(0.0, 1.0 - (days_old/30.0))  AS recency_score,     -- ~30d fade
      LEAST(1.0, scale)                     AS signal_score       -- cap 0..1
    FROM base
  )
  SELECT
    chunk_id, doc_id, src, chunk, model,
    (w_cos*sem_score + w_rec*recency_score + w_sig*signal_score)::REAL AS score,
    cos_dist, l2_dist, scale, days_old, created_at
  FROM norms
  ORDER BY score DESC
  LIMIT k;
$$;

-- ===== Minimal seed (deterministic) =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.rag_chunks LIMIT 1) THEN
    INSERT INTO ag_catalog.rag_chunks(doc_id, src, chunk) VALUES
      ('doc_1','seed://doc1','hello world one'),
      ('doc_2','seed://doc2','hello world two'),
      ('doc_3','seed://doc3','good morning three'),
      ('doc_4','seed://doc4','good evening four'),
      ('doc_5','seed://doc5','good night five');

    -- zero vector baseline
    INSERT INTO ag_catalog.rag_embeddings(chunk_id, model, emb, volume, confidence)
    SELECT chunk_id, 'seed-emb',
           to_vector(ARRAY_FILL(0.0::float8, ARRAY[1536]))::VECTOR, 1.0, 1.0
    FROM ag_catalog.rag_chunks;

    -- make doc_1 distinctly nearest
    UPDATE ag_catalog.rag_embeddings
    SET emb = to_vector(ARRAY[1.0]::float8[]) || to_vector(ARRAY_FILL(0.0::float8, ARRAY[1535]))::VECTOR
    WHERE chunk_id = (SELECT chunk_id FROM ag_catalog.rag_chunks WHERE doc_id='doc_1' LIMIT 1);

    -- signal scales
    UPDATE ag_catalog.rag_embeddings SET volume=4.8 WHERE chunk_id=(SELECT chunk_id FROM ag_catalog.rag_chunks WHERE doc_id='doc_1');
    UPDATE ag_catalog.rag_embeddings SET volume=3.0 WHERE chunk_id=(SELECT chunk_id FROM ag_catalog.rag_chunks WHERE doc_id='doc_5');
    UPDATE ag_catalog.rag_embeddings SET volume=1.35 WHERE chunk_id=(SELECT chunk_id FROM ag_catalog.rag_chunks WHERE doc_id='doc_2');
    UPDATE ag_catalog.rag_embeddings SET volume=0.84 WHERE chunk_id=(SELECT chunk_id FROM ag_catalog.rag_chunks WHERE doc_id='doc_3');
    UPDATE ag_catalog.rag_embeddings SET volume=0.60 WHERE chunk_id=(SELECT chunk_id FROM ag_catalog.rag_chunks WHERE doc_id='doc_4');

    -- an agent doc to bootstrap UI/help
    INSERT INTO app.agent_docs(doc_key, title, markdown) VALUES
    ('rag.search/usage',
     'RAG Weighted Search – How to Call',
     'Use tool **rag.search** with {embedding:number[], k?:int, w_rec?:0..0.5, w_sig?:0..0.5}. The server computes w_cos = 1 - (w_rec + w_sig). Increase **w_rec** for freshness; **w_sig** for signal (volume×confidence). Returns: doc_id, src, chunk, score, cos_dist, l2_dist, scale, days_old.');
  END IF;
END$$;

-- ===== SMOKE (NOTICEs only) =====
DO $$
DECLARE cnt_c INT; cnt_e INT; r RECORD;
BEGIN
  SELECT COUNT(*) INTO cnt_c FROM ag_catalog.rag_chunks;
  SELECT COUNT(*) INTO cnt_e FROM ag_catalog.rag_embeddings;
  RAISE NOTICE 'SMOKE counts -> chunks=%, embeddings=%', cnt_c, cnt_e;

  SELECT * INTO r FROM api.rag_topk_cosine((SELECT emb FROM ag_catalog.rag_embeddings LIMIT 1), 5) LIMIT 1;
  RAISE NOTICE 'SMOKE cosine -> top chunk_id=%, cos_dist=%', r.chunk_id, r.cos_dist;

  SELECT * INTO r FROM api.rag_topk_l2_mag((SELECT emb FROM ag_catalog.rag_embeddings LIMIT 1), 5) LIMIT 1;
  RAISE NOTICE 'SMOKE l2_mag -> top chunk_id=%, adj=%', r.chunk_id, r.adj;

  SELECT * INTO r FROM api.rag_topk_weighted((SELECT emb FROM ag_catalog.rag_embeddings LIMIT 1), 5, 0.8, 0.1, 0.1) LIMIT 1;
  RAISE NOTICE 'SMOKE weighted -> top chunk_id=%, score=%', r.chunk_id, r.score;
END$$;

COMMIT;
