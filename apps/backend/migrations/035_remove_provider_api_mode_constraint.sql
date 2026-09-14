-- Migration 034 was applied before native Hermes provider modes were restored.
-- Keep its recorded bytes immutable and carry the later schema correction
-- forward without rewriting migration history or application data.
BEGIN;

ALTER TABLE ag_catalog.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_provider_api_mode_check;

COMMIT;
