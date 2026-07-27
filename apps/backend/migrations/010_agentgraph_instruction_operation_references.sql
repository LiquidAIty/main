-- Approved AgentGraph instructions own exact immutable operation-version
-- references. Assignments copy that approved set so an in-flight or historical
-- run never depends on mutable instruction input or "latest" resolution.

BEGIN;

ALTER TABLE ag_catalog.registered_queries
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ag_catalog.agent_instruction_operation_references (
  instruction_id TEXT NOT NULL
    REFERENCES ag_catalog.agent_instructions(instruction_id) ON DELETE CASCADE,
  reference_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  operation_version INTEGER NOT NULL CHECK (operation_version > 0),
  execution_role TEXT NOT NULL
    CHECK (execution_role IN ('required_context', 'optional_tool')),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(parameters) = 'object'),
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (instruction_id, reference_id),
  UNIQUE (instruction_id, operation_id, operation_version),
  FOREIGN KEY (project_id, operation_id, operation_version)
    REFERENCES ag_catalog.registered_query_versions(project_id, query_id, version)
    ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS agent_instruction_operation_references_immutable
  ON ag_catalog.agent_instruction_operation_references;
CREATE TRIGGER agent_instruction_operation_references_immutable
BEFORE UPDATE OR DELETE ON ag_catalog.agent_instruction_operation_references
FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_registered_query_mutation();

ALTER TABLE ag_catalog.agent_assignment_operation_references
  ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE ag_catalog.agent_assignment_operation_references
  ADD COLUMN IF NOT EXISTS execution_role TEXT;

UPDATE ag_catalog.agent_assignment_operation_references
SET reference_id = CONCAT(
      'operation-ref:',
      REPLACE(REPLACE(operation_id, ':', '_'), '.', '_'),
      ':v',
      operation_version
    )
WHERE reference_id IS NULL;

UPDATE ag_catalog.agent_assignment_operation_references
SET execution_role = CASE
      WHEN required THEN 'required_context'
      ELSE 'optional_tool'
    END
WHERE execution_role IS NULL;

ALTER TABLE ag_catalog.agent_assignment_operation_references
  ALTER COLUMN reference_id SET NOT NULL;
ALTER TABLE ag_catalog.agent_assignment_operation_references
  ALTER COLUMN execution_role SET NOT NULL;
ALTER TABLE ag_catalog.agent_assignment_operation_references
  ADD CONSTRAINT agent_assignment_operation_role_check
  CHECK (execution_role IN ('required_context', 'optional_tool'));
ALTER TABLE ag_catalog.agent_assignment_operation_references
  ADD CONSTRAINT agent_assignment_operation_reference_unique
  UNIQUE (assignment_id, reference_id);
ALTER TABLE ag_catalog.agent_assignment_operation_references
  DROP COLUMN required;

DROP TRIGGER IF EXISTS agent_assignment_operation_references_immutable
  ON ag_catalog.agent_assignment_operation_references;
CREATE TRIGGER agent_assignment_operation_references_immutable
BEFORE UPDATE OR DELETE ON ag_catalog.agent_assignment_operation_references
FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_registered_query_mutation();

GRANT SELECT, INSERT
  ON ag_catalog.agent_instruction_operation_references
  TO "liquidaity-user";

COMMIT;
