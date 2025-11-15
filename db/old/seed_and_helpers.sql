BEGIN;

-- --- Helper: L2 over magnitude-encoded column (emb_mag) ---
CREATE SCHEMA IF NOT EXISTS api;

CREATE OR REPLACE FUNCTION api.rag_topk_l2_mag(q vector, k int)
RETURNS TABLE (
  chunk_id   bigint,
  doc_id     text,
  src        text,
  chunk      text,
  model      text,
  dist       real,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = ag_catalog, public, api
AS $fn$
  SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
         (e.emb_mag <-> q) AS dist,
         c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks     c ON c.id = e.chunk_id
ORDER BY e.emb_mag <-> q
   LIMIT k
$fn$;

-- --- Make sure magnitude + unit columns exist (safe if already there) ---
ALTER TABLE ag_catalog.rag_embeddings
  ADD COLUMN IF NOT EXISTS emb_unit vector(1536),
  ADD COLUMN IF NOT EXISTS emb_mag  vector(1536);

-- ANN indexes (no-op if exist)
CREATE INDEX IF NOT EXISTS idx_rag_emb_unit_hnsw_cos
  ON ag_catalog.rag_embeddings USING hnsw (emb_unit vector_cosine_ops) WITH (m=16, ef_construction=128);

CREATE INDEX IF NOT EXISTS idx_rag_emb_mag_hnsw_l2
  ON ag_catalog.rag_embeddings USING hnsw (emb_mag  vector_l2_ops)     WITH (m=16, ef_construction=128);

-- --- Seed embeddings for chunks that have none (random values; unblock testing) ---
-- Figure out vector dimension from the column type; default to 1536 when typmod isn’t set
WITH dim AS (
  SELECT COALESCE( (regexp_match(format_type(a.atttypid, a.atttypmod), '\d+'))[1]::int, 1536 ) AS d
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'ag_catalog' AND c.relname = 'rag_embeddings' AND a.attname = 'emb'
  LIMIT 1
),
todo AS (
  SELECT c.id, row_number() OVER (ORDER BY c.id) AS rn
  FROM ag_catalog.rag_chunks c
  LEFT JOIN ag_catalog.rag_embeddings e ON e.chunk_id = c.id
  WHERE e.chunk_id IS NULL
  ORDER BY c.id
  LIMIT 50
),
vecs AS (
  SELECT rn,
         (
           '[' ||
           string_agg(to_char(random(), 'FM0D0000'), ',') ||
           ']'
         )::vector AS v
  FROM todo
  CROSS JOIN dim
  CROSS JOIN LATERAL generate_series(1, (SELECT d FROM dim)) g
  GROUP BY rn
)
INSERT INTO ag_catalog.rag_embeddings (chunk_id, model, emb, emb_unit, emb_mag, created_at)
SELECT t.id,
       'seed-model',
       v.v,                      -- store same random vector as emb
       v.v,                      -- emb_unit (we'll treat as unit for this seed)
       v.v,                      -- emb_mag  (same for seed; real app will scale)
       now()
FROM todo t
JOIN vecs v USING (rn)
ON CONFLICT (chunk_id) DO NOTHING;

COMMIT;
