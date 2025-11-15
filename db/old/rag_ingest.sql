BEGIN;

-- 0) Safety: make sure schema exists
CREATE SCHEMA IF NOT EXISTS api;

-- 1) Columns you’ll actually use during ingestion
ALTER TABLE ag_catalog.rag_embeddings
  ADD COLUMN IF NOT EXISTS volume      real,
  ADD COLUMN IF NOT EXISTS confidence  real,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz;

-- 2) Ingest helper
-- - Accepts a raw embedding (model output)
-- - Computes unit vector for cosine search
-- - Applies magnitude = unit * (volume * confidence) for L2 search
-- - Upserts by chunk_id (idempotent)
CREATE OR REPLACE FUNCTION api.ingest_embedding(
  p_chunk_id   bigint,
  p_model      text,
  p_emb        vector,
  p_volume     real DEFAULT NULL,
  p_confidence real DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SET search_path = ag_catalog, public, api
AS $fn$
DECLARE
  v_norm   real;
  v_unit   vector;
  v_scale  real;
  v_mag    vector;
BEGIN
  -- guard: null emb
  IF p_emb IS NULL THEN
    RAISE EXCEPTION 'p_emb cannot be NULL';
  END IF;

  -- norm and unit (avoid div-by-zero)
  SELECT sqrt(sum(x*x))::real
  INTO v_norm
  FROM (
    SELECT unnest(p_emb)::real AS x
  ) t;

  IF v_norm IS NULL OR v_norm = 0 THEN
    RAISE EXCEPTION 'embedding norm is zero';
  END IF;

  v_unit  := p_emb / v_norm;
  v_scale := COALESCE(p_volume, 1.0) * COALESCE(p_confidence, 1.0);
  v_mag   := v_unit * v_scale;

  INSERT INTO ag_catalog.rag_embeddings (chunk_id, model, emb, emb_unit, emb_mag, volume, confidence, created_at, updated_at)
  VALUES (p_chunk_id, p_model, p_emb, v_unit, v_mag, p_volume, p_confidence, now(), now())
  ON CONFLICT (chunk_id) DO UPDATE
  SET model      = EXCLUDED.model,
      emb        = EXCLUDED.emb,
      emb_unit   = EXCLUDED.emb_unit,
      emb_mag    = EXCLUDED.emb_mag,
      volume     = EXCLUDED.volume,
      confidence = EXCLUDED.confidence,
      updated_at = now();
END
$fn$;

-- 3) Convenience: insert chunk + embedding in one call (optional)
--    Creates a chunk row if it doesn't exist; then calls ingest_embedding.
CREATE OR REPLACE FUNCTION api.upsert_chunk_with_embedding(
  p_doc_id     text,
  p_src        text,
  p_chunk      text,
  p_model      text,
  p_emb        vector,
  p_volume     real DEFAULT NULL,
  p_confidence real DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SET search_path = ag_catalog, public, api
AS $f$
DECLARE
  v_id bigint;
BEGIN
  -- upsert chunk by doc_id (doc_id is unique)
  INSERT INTO ag_catalog.rag_chunks (doc_id, src, chunk, created_at)
  VALUES (p_doc_id, p_src, p_chunk, now())
  ON CONFLICT (doc_id) DO UPDATE
  SET src   = EXCLUDED.src,
      chunk = EXCLUDED.chunk
  RETURNING id INTO v_id;

  PERFORM api.ingest_embedding(v_id, p_model, p_emb, p_volume, p_confidence);

  RETURN v_id;
END
$f$;

-- 4) Read helpers already exist (rag_topk_cosine / rag_topk_l2 / rag_topk_hybrid_cosine / rag_topk_l2_mag)
--    Ensure search_path so callers don’t break them with their own path
ALTER FUNCTION api.rag_topk_cosine(vector,int)                    SET search_path = ag_catalog, public, api;
ALTER FUNCTION api.rag_topk_l2(vector,int)                        SET search_path = ag_catalog, public, api;
ALTER FUNCTION api.rag_topk_hybrid_cosine(vector,int,real,real)   SET search_path = ag_catalog, public, api;
ALTER FUNCTION api.rag_topk_l2_mag(vector,int)                    SET search_path = ag_catalog, public, api;

COMMIT;
