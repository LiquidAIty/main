-- Canonical LiquidAIty model input. This adds the replacement before the
-- assignment/claim runtime path is disconnected. Historical assignment rows
-- remain recoverable; this migration does not rewrite or delete user data.

BEGIN;

CREATE TABLE IF NOT EXISTS ag_catalog.input_data_files (
  idf_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  originating_card_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  system_text TEXT NOT NULL DEFAULT '',
  user_text TEXT NOT NULL,
  dynamic_context_markdown TEXT NOT NULL DEFAULT '',
  native_references JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(native_references) = 'array'),
  model_input_markdown TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, run_id, version)
);

CREATE INDEX IF NOT EXISTS input_data_files_context_idx
  ON ag_catalog.input_data_files(project_id, conversation_id, created_at DESC);

COMMIT;
