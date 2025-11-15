BEGIN;

-- 1) Make doc_id upserts legal
CREATE UNIQUE INDEX IF NOT EXISTS rag_chunks_doc_id_uniq
  ON ag_catalog.rag_chunks(doc_id);

-- 2) Insert 8 seed chunks if missing
WITH to_ins AS (
  SELECT
    'doc_'||gs        AS doc_id,
    'seed'::text      AS src,
    'seed chunk '||gs AS chunk,
    now() - (gs||' min')::interval AS created_at
  FROM generate_series(1,8) gs
)
INSERT INTO ag_catalog.rag_chunks (doc_id, src, chunk, created_at)
SELECT t.doc_id, t.src, t.chunk, t.created_at
FROM to_ins t
LEFT JOIN ag_catalog.rag_chunks c USING (doc_id)
WHERE c.doc_id IS NULL;

-- 3) Dimension of the vector column
WITH dim AS (
  SELECT
    regexp_replace(format_type(a.atttypid,a.atttypmod),'^vector\((\d+)\)$','\1')::int AS d
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='ag_catalog'
    AND c.relname='rag_embeddings'
    AND a.attname='emb'
),
targets AS (
  -- chunks that have no embedding yet
  SELECT c.id
  FROM ag_catalog.rag_chunks c
  LEFT JOIN ag_catalog.rag_embeddings e ON e.chunk_id = c.id
  WHERE e.chunk_id IS NULL
  ORDER BY c.created_at DESC
  LIMIT 16
),
vec AS (
  -- build a random vector per target id with correct length
  SELECT t.id,
         ('[' || string_agg(to_char(random(),'FM0D0000'), ',') || ']')::vector AS emb
  FROM targets t, dim, LATERAL generate_series(1, (SELECT d FROM dim))
  GROUP BY t.id
)
INSERT INTO ag_catalog.rag_embeddings (chunk_id, model, emb)
SELECT v.id, 'seed-model', v.emb
FROM vec v
ON CONFLICT (chunk_id) DO NOTHING;

COMMIT;
