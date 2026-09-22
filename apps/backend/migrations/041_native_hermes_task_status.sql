-- Persist exact native Hermes task status for current Runs while retaining
-- legacy phase values on historical rows. Live APIs no longer produce or
-- expose the older LiquidAIty-made phase vocabulary.
BEGIN;

ALTER TABLE ag_catalog.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_native_phase_check;
ALTER TABLE ag_catalog.agent_runs
  ADD CONSTRAINT agent_runs_native_phase_check CHECK (
    native_phase IS NULL OR native_phase IN (
      'triage', 'todo', 'scheduled', 'ready', 'running',
      'blocked', 'review', 'done', 'archived',
      'queued', 'decomposing', 'working', 'synthesizing',
      'complete', 'failed', 'cancelled'
    )
  );

COMMIT;
