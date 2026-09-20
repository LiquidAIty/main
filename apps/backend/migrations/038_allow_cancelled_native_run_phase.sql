-- A stopped Mag One execution is a truthful native cancellation, not a failure.
BEGIN;

ALTER TABLE ag_catalog.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_native_phase_check;
ALTER TABLE ag_catalog.agent_runs
  ADD CONSTRAINT agent_runs_native_phase_check CHECK (
    native_phase IS NULL OR native_phase IN (
      'queued', 'decomposing', 'working', 'synthesizing',
      'complete', 'blocked', 'failed', 'cancelled'
    )
  );

COMMIT;
