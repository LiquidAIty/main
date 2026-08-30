-- One bounded JSON receipt reproduces the immutable Card Script execution
-- without duplicating source bytes already owned by the referenced Card revision.
BEGIN;

ALTER TABLE ag_catalog.agent_runs
  ADD COLUMN IF NOT EXISTS card_script_execution JSONB;

COMMIT;
