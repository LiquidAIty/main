# Copy the ONE file
docker cp ".\db\00_pg_age_timescale_postgis_vector_FULLSTACK.sql" sim-pg:/tmp/liq_fullstack.sql

# Apply it (prints embedded NOTICE smokelines)
docker exec -it sim-pg psql -U postgres -d liquidaity -v ON_ERROR_STOP=1 -P pager=off -f /tmp/liq_fullstack.sql

# Sanity: signatures
docker exec -it sim-pg psql -U postgres -d liquidaity -P pager=off -c `
"SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='api'
   AND proname IN ('ingest_embedding','rag_topk_cosine','rag_topk_l2_mag','rag_topk_weighted')
 ORDER BY 1;"

# Sanity: cosine
docker exec -it sim-pg psql -U postgres -d liquidaity -P pager=off -c `
"WITH q AS (
   SELECT emb AS v FROM ag_catalog.rag_embeddings
   ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1
)
SELECT chunk_id, doc_id,
       round(cos_dist::numeric,6)  AS cos_dist,
       round(sim_cosine::numeric,6) AS sim
FROM api.rag_topk_cosine((SELECT v FROM q), 5);"

# Sanity: weighted
docker exec -it sim-pg psql -U postgres -d liquidaity -P pager=off -c `
"WITH q AS (
   SELECT emb AS v FROM ag_catalog.rag_embeddings
   ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1
)
SELECT chunk_id, doc_id,
       round(score::numeric,6)    AS score,
       round(cos_dist::numeric,6) AS cos_dist,
       round(l2_dist::numeric,6)  AS l2_dist,
       round(scale::numeric,3)    AS scale,
       round(days_old::numeric,3) AS days_old
FROM api.rag_topk_weighted((SELECT v FROM q), 5, 0.8, 0.1, 0.1)
ORDER BY score DESC;"
