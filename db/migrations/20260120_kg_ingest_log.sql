CREATE TABLE IF NOT EXISTS ag_catalog.kg_ingest_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  doc_id text,
  src text,
  ts timestamptz DEFAULT now(),
  ok boolean NOT NULL,
  error_code text,
  error_message text,
  raw_len int DEFAULT 0,
  chunks int DEFAULT 0,
  entities int DEFAULT 0,
  rels int DEFAULT 0,
  source text DEFAULT 'chat',
  provider text,
  model_key text,
  request_id text,
  elapsed_ms int,
  finish_reason text,
  usage jsonb
);

CREATE INDEX IF NOT EXISTS kg_ingest_log_project_ts_idx
  ON ag_catalog.kg_ingest_log (project_id, ts DESC);

ALTER TABLE ag_catalog.kg_ingest_log
  ADD COLUMN IF NOT EXISTS doc_id text,
  ADD COLUMN IF NOT EXISTS src text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS raw_len int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model_key text,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS elapsed_ms int,
  ADD COLUMN IF NOT EXISTS finish_reason text,
  ADD COLUMN IF NOT EXISTS usage jsonb;
