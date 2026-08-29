-- Native Hermes child Runs disclose the effective provider/model separately
-- from the owning Card's parent model. A disclosed fallback is never inferred
-- from prose and never changes saved Card authority.
BEGIN;

ALTER TABLE ag_catalog.agent_runs
  ADD COLUMN IF NOT EXISTS model_fallback_occurred BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS model_fallback_reason TEXT;

COMMIT;
