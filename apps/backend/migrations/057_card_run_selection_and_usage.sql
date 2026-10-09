-- Keep bounded Auto selection outcomes and truthful native usage on the
-- existing outer Run row.  This creates no second assessment or event store.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

ALTER TABLE ag_catalog.agent_runs
  ADD COLUMN auto_tools_decision JSONB,
  ADD COLUMN auto_model_decision JSONB,
  ADD COLUMN provider_total_tokens BIGINT,
  ADD COLUMN cost_status TEXT;

ALTER TABLE ag_catalog.agent_runs
  ADD CONSTRAINT agent_runs_provider_total_tokens_check
    CHECK (provider_total_tokens IS NULL OR provider_total_tokens >= 0),
  ADD CONSTRAINT agent_runs_cost_status_check
    CHECK (
      cost_status IS NULL
      OR cost_status IN ('actual', 'estimated', 'included', 'unknown')
    );

COMMIT;
