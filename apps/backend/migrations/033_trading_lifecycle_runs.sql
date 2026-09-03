-- Card-scoped receipts for bounded deterministic subsystem lifecycles.
-- This table cannot authorize or represent live order execution.
BEGIN;

CREATE TABLE IF NOT EXISTS ag_catalog.trading_lifecycle_runs (
  lifecycle_run_id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  -- Card/revision identity is validated by the Python owner before insertion;
  -- explicit Card deletion performs the inverse audit for this table.
  card_revision_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'local_backtest'),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  paper_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (paper_only = TRUE),
  live_orders BOOLEAN NOT NULL DEFAULT FALSE CHECK (live_orders = FALSE),
  model_provider_calls BOOLEAN NOT NULL DEFAULT FALSE CHECK (model_provider_calls = FALSE),
  symbol TEXT NOT NULL,
  data_provenance JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(data_provenance) = 'object'),
  snapshot JSONB,
  lifecycle_events JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(lifecycle_events) = 'array'),
  artifacts JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(artifacts) = 'array'),
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, deck_id, card_id, idempotency_key),
  CHECK (
    (status = 'completed' AND snapshot IS NOT NULL AND finished_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND snapshot IS NULL AND finished_at IS NOT NULL AND error_code IS NOT NULL)
    OR (status = 'running' AND snapshot IS NULL AND finished_at IS NULL AND error_code IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS trading_lifecycle_runs_card_created_idx
  ON ag_catalog.trading_lifecycle_runs(project_id, deck_id, card_id, created_at DESC);

REVOKE ALL ON ag_catalog.trading_lifecycle_runs FROM "liquidaity-user";
GRANT SELECT, INSERT, UPDATE ON ag_catalog.trading_lifecycle_runs TO "liquidaity-user";

COMMIT;
