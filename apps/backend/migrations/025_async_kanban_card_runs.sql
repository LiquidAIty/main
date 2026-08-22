-- Keep one saved Kanban Card Run durable while native Hermes Auto-Kanban
-- continues beyond the submitting HTTP request. This extends the existing Run
-- ledger; it does not introduce another queue, event store, or worker identity.

BEGIN;

ALTER TABLE ag_catalog.agent_runs
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS native_phase TEXT CHECK (
    native_phase IS NULL OR native_phase IN (
      'queued', 'decomposing', 'working', 'synthesizing',
      'complete', 'blocked', 'failed'
    )
  ),
  ADD COLUMN IF NOT EXISTS native_task_completed_count INTEGER CHECK (
    native_task_completed_count IS NULL OR native_task_completed_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS native_task_total_count INTEGER CHECK (
    native_task_total_count IS NULL OR native_task_total_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS native_active_worker_count INTEGER CHECK (
    native_active_worker_count IS NULL OR native_active_worker_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS tool_call_count BIGINT CHECK (
    tool_call_count IS NULL OR tool_call_count >= 0
  ),
  ADD COLUMN IF NOT EXISTS provider_cached_tokens BIGINT CHECK (
    provider_cached_tokens IS NULL OR provider_cached_tokens >= 0
  ),
  ADD COLUMN IF NOT EXISTS provider_reasoning_tokens BIGINT CHECK (
    provider_reasoning_tokens IS NULL OR provider_reasoning_tokens >= 0
  ),
  ADD COLUMN IF NOT EXISTS final_result TEXT;

ALTER TABLE ag_catalog.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_state_check;
ALTER TABLE ag_catalog.agent_runs
  ADD CONSTRAINT agent_runs_state_check CHECK (
    state IN ('pending', 'running', 'completed', 'blocked', 'failed', 'cancelled')
  );

CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_exact_request_key
  ON ag_catalog.agent_runs (
    project_id, deck_id, target_card_revision_id, request_fingerprint
  )
  WHERE request_fingerprint IS NOT NULL;

COMMIT;
