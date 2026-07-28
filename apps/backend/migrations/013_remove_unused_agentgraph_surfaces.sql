BEGIN;

DROP TABLE IF EXISTS ag_catalog.agent_artifact_references;
DROP TABLE IF EXISTS ag_catalog.assist_agent_assignments;

ALTER TABLE IF EXISTS ag_catalog.agent_results
  DROP COLUMN IF EXISTS review_state,
  DROP COLUMN IF EXISTS reviewed_by_card_id,
  DROP COLUMN IF EXISTS reviewed_at;

COMMIT;
