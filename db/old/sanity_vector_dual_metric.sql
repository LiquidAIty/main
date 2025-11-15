-- sanity_vector_dual_metric.sql
-- Non-destructive checks: verifies indexes + functions are present.
SET client_min_messages = WARNING;

-- Show the four ANN indexes we expect:
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'rag_embeddings'
  AND indexname IN (
    'idx_rag_embeddings_ivf_cos',
    'idx_rag_embeddings_hnsw_cos',
    'idx_rag_embeddings_ivf_l2',
    'idx_rag_embeddings_hnsw_l2'
  )
ORDER BY indexname;

-- Confirm helper functions exist
SELECT n.nspname AS schema, p.proname AS func, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'api' AND p.proname LIKE 'rag_topk_%'
ORDER BY 2,3;

-- If you already have embeddings loaded, these return rows; if not, they just return 0 rows safely.
-- (They require q's dimension to match emb; use any existing emb to grab the dim.)
WITH any_emb AS (
  SELECT emb FROM rag_embeddings LIMIT 1
)
SELECT * FROM api.rag_topk_cosine( (SELECT emb FROM any_emb), 3 );

WITH any_emb AS (
  SELECT emb FROM rag_embeddings LIMIT 1
)
SELECT * FROM api.rag_topk_l2( (SELECT emb FROM any_emb), 3 );

WITH any_emb AS (
  SELECT emb FROM rag_embeddings LIMIT 1
)
SELECT * FROM api.rag_topk_hybrid_cosine( (SELECT emb FROM any_emb), 3, 0.9, 0.1 );
