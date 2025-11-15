WITH dim AS (SELECT 1536::int AS d),
vec AS (
  SELECT ('[' || string_agg(to_char(random(),'FM0D0000'), ',') || ']')::vector AS v
  FROM dim, LATERAL generate_series(1, (SELECT d FROM dim))
)
SELECT api.ingest_embedding(
  p_chunk_id   := (SELECT id FROM ag_catalog.rag_chunks ORDER BY id LIMIT 1),
  p_model      := 'node-embed-001',
  p_emb        := (SELECT v FROM vec),
  p_volume     := 5.0,
  p_confidence := 0.8
);
