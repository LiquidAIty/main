BEGIN;

-- Recreate only the ingest function (no other changes)
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
  l_norm   real;
  l_unit   vector;
  l_scale  real;
  l_mag    vector;
BEGIN
  -- Norm via pgvector: v <#> v = -||v||^2
  l_norm := sqrt( GREATEST( 0.0, - (p_emb <#> p_emb) ) )::real;

  -- unit vector for cosine search (protect against zero)
  IF l_norm > 0 THEN
    l_unit := p_emb / l_norm;
  ELSE
    l_unit := p_emb;  -- degenerate, but avoids division by zero
  END IF;

  -- magnitude scaling (encode intensity): confidence * (1 + volume)
  l_scale := GREATEST(0.0, COALESCE(p_confidence, 0.0)) * (1.0 + GREATEST(0.0, COALESCE(p_volume, 0.0)));
  l_mag   := p_emb * GREATEST(l_scale, 1e-6);  -- tiny floor keeps nonzero

  UPDATE ag_catalog.rag_embeddings
     SET model     = p_model,
         emb       = p_emb,
         emb_unit  = l_unit,
         emb_mag   = l_mag,
         updated_at = NOW()
   WHERE chunk_id = p_chunk_id;

  IF NOT FOUND THEN
    INSERT INTO ag_catalog.rag_embeddings (chunk_id, model, emb, emb_unit, emb_mag, created_at, updated_at)
    VALUES (p_chunk_id, p_model, p_emb, l_unit, l_mag, NOW(), NOW());
  END IF;
END;
$$;

COMMIT;
