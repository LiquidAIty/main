-- Trading uses actual Hermes provenance only. No synthetic conversion of obsolete receipts.
-- NOT NULL additions intentionally fail atomically if an installation still has old rows.
BEGIN;

ALTER TABLE ag_catalog.trading_jobs
  ADD COLUMN source_execution JSONB NOT NULL,
  DROP COLUMN source_run_id;
ALTER TABLE ag_catalog.trading_jobs ADD CONSTRAINT trading_jobs_source_present CHECK (
  COALESCE(
    jsonb_typeof(source_execution) = 'object'
    AND source_execution->>'runtime' = 'hermes'
    AND NULLIF(source_execution->>'profile', '') IS NOT NULL
    AND NULLIF(source_execution->>'sessionId', '') IS NOT NULL
    AND NULLIF(source_execution->>'turnId', '') IS NOT NULL
    AND NULLIF(source_execution->>'toolCallId', '') IS NOT NULL, FALSE)
);

ALTER TABLE ag_catalog.trading_decisions
  ADD COLUMN project_id UUID NOT NULL,
  ADD COLUMN deck_id TEXT NOT NULL,
  ADD COLUMN card_id TEXT NOT NULL,
  ADD COLUMN card_revision_id UUID NOT NULL,
  ADD COLUMN subject TEXT NOT NULL,
  ADD COLUMN source_execution JSONB NOT NULL,
  ALTER COLUMN job_id DROP NOT NULL,
  DROP COLUMN source_run_id;
ALTER TABLE ag_catalog.trading_decisions ADD CONSTRAINT trading_decisions_subject_present
  CHECK (length(btrim(subject)) > 0);
ALTER TABLE ag_catalog.trading_decisions ADD CONSTRAINT trading_decisions_source_present CHECK (
  COALESCE(
    jsonb_typeof(source_execution) = 'object'
    AND source_execution->>'runtime' = 'hermes'
    AND NULLIF(source_execution->>'profile', '') IS NOT NULL
    AND NULLIF(source_execution->>'sessionId', '') IS NOT NULL
    AND NULLIF(source_execution->>'turnId', '') IS NOT NULL
    AND NULLIF(source_execution->>'toolCallId', '') IS NOT NULL, FALSE)
);
CREATE UNIQUE INDEX trading_research_decision_key
  ON ag_catalog.trading_decisions(project_id, deck_id, card_id, idempotency_key)
  WHERE job_id IS NULL;
CREATE INDEX trading_decisions_card_created
  ON ag_catalog.trading_decisions(project_id, deck_id, card_id, created_at DESC);

ALTER TABLE ag_catalog.trading_lifecycle_runs
  ADD COLUMN source_execution JSONB NOT NULL CHECK (COALESCE(
    jsonb_typeof(source_execution) = 'object'
    AND source_execution->>'runtime' = 'hermes'
    AND NULLIF(source_execution->>'profile', '') IS NOT NULL
    AND NULLIF(source_execution->>'sessionId', '') IS NOT NULL
    AND NULLIF(source_execution->>'turnId', '') IS NOT NULL
    AND NULLIF(source_execution->>'toolCallId', '') IS NOT NULL, FALSE)),
  ADD COLUMN symbols JSONB NOT NULL CHECK (
    jsonb_typeof(symbols) = 'array' AND jsonb_array_length(symbols) > 0),
  DROP COLUMN symbol;

COMMIT;
