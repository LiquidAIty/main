-- Complete the existing AgentGraph result record with compact execution
-- evidence and review state. Tool arguments/results and saved-card
-- configuration remain in their canonical runtime authorities.

BEGIN;

ALTER TABLE ag_catalog.agent_results
  ADD COLUMN IF NOT EXISTS tool_evidence JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(tool_evidence) = 'array'),
  ADD COLUMN IF NOT EXISTS review_state TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_state IN (
      'unreviewed',
      'approved',
      'changes_requested',
      'rejected'
    )),
  ADD COLUMN IF NOT EXISTS reviewed_by_card_id TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

COMMIT;
