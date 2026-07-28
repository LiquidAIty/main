-- Align the live AgentGraph assignment ownership column with the current
-- atomic claim/finish implementation without removing any legacy columns.
-- The separate cleanup migration owns removal of abandoned lease/retry
-- surfaces after its remaining persisted audit rows are reviewed.

BEGIN;

ALTER TABLE IF EXISTS ag_catalog.agent_assignments
  ADD COLUMN IF NOT EXISTS claim_token TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='ag_catalog'
      AND table_name='agent_assignments'
      AND column_name='lease_token'
  ) THEN
    EXECUTE
      'UPDATE ag_catalog.agent_assignments
       SET claim_token=COALESCE(claim_token, lease_token)';
  END IF;
END
$$;

COMMIT;
