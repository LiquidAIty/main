-- Exact cross-agent correlation must not degrade into table scans as projects
-- and runs grow. Parent-run identity is validated for ambiguity in Python.

BEGIN;

CREATE INDEX IF NOT EXISTS card_run_traces_correlation_idx
  ON ag_catalog.card_run_traces(correlation_id);

CREATE INDEX IF NOT EXISTS agent_assignments_parent_receiver_idx
  ON ag_catalog.agent_assignments(parent_run_id, receiver_card_id)
  WHERE parent_run_id IS NOT NULL;

COMMIT;
