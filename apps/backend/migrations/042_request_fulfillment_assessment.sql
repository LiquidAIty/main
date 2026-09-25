-- One typed, response-scoped Jev assessment on the existing Run owner.  The
-- exact input remains the retained in.idf artifact; this JSON stores only the
-- bounded result/status and binding digests, not another prompt or transcript.
BEGIN;

ALTER TABLE ag_catalog.agent_runs
  ADD COLUMN IF NOT EXISTS request_fulfillment JSONB;

COMMIT;
