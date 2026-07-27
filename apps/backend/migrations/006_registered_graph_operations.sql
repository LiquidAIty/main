-- Complete the single AgentGraph assignment authority. Migration 005's
-- short-lived context/result payload and promotion workflows contained only
-- implementation proof records; active callers now use instructions,
-- assignments, registered operations, and canonical results directly.

BEGIN;

ALTER TABLE ag_catalog.registered_queries
  ADD COLUMN IF NOT EXISTS target_graph TEXT;
ALTER TABLE ag_catalog.registered_queries
  ADD COLUMN IF NOT EXISTS operation_class TEXT;
ALTER TABLE ag_catalog.registered_queries
  ADD COLUMN IF NOT EXISTS capability_id TEXT;

UPDATE ag_catalog.registered_queries
SET target_graph = CASE
      WHEN query_id LIKE 'thinkgraph.%' THEN 'thinkgraph'
      WHEN query_id LIKE 'knowgraph.%' THEN 'knowgraph'
      WHEN query_id LIKE 'codegraph.%' THEN 'codegraph'
      ELSE 'agentgraph'
    END,
    operation_class = 'read'
WHERE target_graph IS NULL OR operation_class IS NULL;

ALTER TABLE ag_catalog.registered_queries
  ALTER COLUMN target_graph SET NOT NULL,
  ALTER COLUMN operation_class SET NOT NULL;

ALTER TABLE ag_catalog.registered_queries
  ADD CONSTRAINT registered_queries_target_graph_check
  CHECK (target_graph IN ('thinkgraph', 'knowgraph', 'codegraph', 'agentgraph'));
ALTER TABLE ag_catalog.registered_queries
  ADD CONSTRAINT registered_queries_operation_class_check
  CHECK (operation_class IN ('read', 'write'));
ALTER TABLE ag_catalog.registered_queries
  ADD CONSTRAINT registered_queries_codegraph_write_check
  CHECK (NOT (target_graph = 'codegraph' AND operation_class = 'write'));
ALTER TABLE ag_catalog.registered_queries
  ADD CONSTRAINT registered_queries_capability_check
  CHECK (
    (operation_class = 'read' AND capability_id IS NULL)
    OR
    (target_graph = 'thinkgraph' AND operation_class = 'write'
      AND capability_id = 'thinkgraph.submit_update')
    OR
    (target_graph = 'knowgraph' AND operation_class = 'write'
      AND capability_id = 'knowgraph.ingest')
  );

ALTER TABLE ag_catalog.registered_query_versions
  DROP CONSTRAINT IF EXISTS registered_query_versions_language_check;
ALTER TABLE ag_catalog.registered_query_versions
  ADD CONSTRAINT registered_query_versions_language_check
  CHECK (language IN ('sql', 'cypher', 'capability'));

CREATE TABLE IF NOT EXISTS ag_catalog.agent_assignment_operation_references (
  assignment_id TEXT NOT NULL
    REFERENCES ag_catalog.agent_assignments(assignment_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  operation_version INTEGER NOT NULL CHECK (operation_version > 0),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(parameters) = 'object'),
  explanation TEXT,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assignment_id, operation_id, operation_version),
  FOREIGN KEY (project_id, operation_id, operation_version)
    REFERENCES ag_catalog.registered_query_versions(project_id, query_id, version)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_instructions (
  instruction_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  prepared_by_card_id TEXT,
  body TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ag_catalog.agent_assignments
  ADD COLUMN IF NOT EXISTS instruction_id TEXT
    REFERENCES ag_catalog.agent_instructions(instruction_id) ON DELETE RESTRICT;
ALTER TABLE ag_catalog.agent_assignments
  ADD COLUMN IF NOT EXISTS claimed_by_card_id TEXT;
ALTER TABLE ag_catalog.agent_assignments
  ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE ag_catalog.agent_assignments
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ag_catalog.agent_assignments
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE ag_catalog.agent_assignments
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE ag_catalog.agent_assignments
  ADD COLUMN IF NOT EXISTS parent_run_id TEXT;

ALTER TABLE ag_catalog.agent_assignments
  DROP CONSTRAINT IF EXISTS agent_assignments_state_check;
ALTER TABLE ag_catalog.agent_assignments
  ADD CONSTRAINT agent_assignments_state_check
  CHECK (state IN ('pending', 'running', 'completed', 'failed', 'cancelled'));

ALTER TABLE ag_catalog.agent_artifact_references
  ADD COLUMN IF NOT EXISTS result_id TEXT
    REFERENCES ag_catalog.agent_results(result_id) ON DELETE CASCADE;
ALTER TABLE ag_catalog.agent_artifact_references
  ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE ag_catalog.agent_artifact_references
  ADD COLUMN IF NOT EXISTS producer_card_id TEXT;
ALTER TABLE ag_catalog.agent_artifact_references
  ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE ag_catalog.agent_artifact_references
  ADD COLUMN IF NOT EXISTS byte_count BIGINT;

-- Promotion was a document-approval workflow and is not an execution gate.
DROP TRIGGER IF EXISTS registered_query_promotions_immutable
  ON ag_catalog.registered_query_promotions;
DROP TABLE IF EXISTS ag_catalog.registered_query_promotions;
DROP TRIGGER IF EXISTS registered_query_audit_immutable
  ON ag_catalog.registered_query_audit;
DELETE FROM ag_catalog.registered_query_audit WHERE action = 'promoted';
ALTER TABLE ag_catalog.registered_query_audit
  DROP CONSTRAINT IF EXISTS registered_query_audit_action_check;
ALTER TABLE ag_catalog.registered_query_audit
  ADD CONSTRAINT registered_query_audit_action_check
  CHECK (action IN ('created', 'version_created', 'executed', 'rejected'));
CREATE TRIGGER registered_query_audit_immutable
BEFORE UPDATE OR DELETE ON ag_catalog.registered_query_audit
FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_registered_query_mutation();

-- Obsolete context/result payload authorities. Exact instruction/result bodies
-- now live on agent_instructions and agent_results.
DROP TABLE IF EXISTS ag_catalog.agent_context_operation_references;
DROP TABLE IF EXISTS ag_catalog.agent_result_payloads;
DROP TABLE IF EXISTS ag_catalog.agent_context_payloads;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ag_catalog.agent_assignment_operation_references,
     ag_catalog.agent_instructions
  TO "liquidaity-user";

COMMIT;
