-- Registered, bounded database context and durable ordinary-agent records.
-- card_run_traces remains the canonical run authority. Operational payloads
-- live in relational rows; Apache AGE keeps only compact identities/lineage.

BEGIN;

CREATE TABLE IF NOT EXISTS ag_catalog.registered_queries (
  project_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  database_authority TEXT NOT NULL CHECK (database_authority IN ('postgresql', 'agentgraph_age')),
  database_name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, query_id)
);

CREATE TABLE IF NOT EXISTS ag_catalog.registered_query_versions (
  project_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  language TEXT NOT NULL CHECK (language IN ('sql', 'cypher')),
  statement TEXT NOT NULL,
  parameter_schema JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(parameter_schema) = 'object'),
  row_limit INTEGER NOT NULL CHECK (row_limit BETWEEN 1 AND 1000),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 30000),
  authored_by TEXT NOT NULL,
  audit_note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, query_id, version),
  FOREIGN KEY (project_id, query_id)
    REFERENCES ag_catalog.registered_queries(project_id, query_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ag_catalog.registered_query_promotions (
  project_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  promoted_by TEXT NOT NULL,
  audit_note TEXT NOT NULL,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, query_id, version),
  FOREIGN KEY (project_id, query_id, version)
    REFERENCES ag_catalog.registered_query_versions(project_id, query_id, version)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ag_catalog.registered_query_audit (
  audit_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  version INTEGER,
  action TEXT NOT NULL CHECK (action IN ('created', 'version_created', 'promoted', 'executed', 'rejected')),
  actor_id TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (project_id, query_id)
    REFERENCES ag_catalog.registered_queries(project_id, query_id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION ag_catalog.reject_registered_query_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'registered_query_records_are_immutable';
END;
$$;

DROP TRIGGER IF EXISTS registered_query_versions_immutable
  ON ag_catalog.registered_query_versions;
CREATE TRIGGER registered_query_versions_immutable
BEFORE UPDATE OR DELETE ON ag_catalog.registered_query_versions
FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_registered_query_mutation();

DROP TRIGGER IF EXISTS registered_query_promotions_immutable
  ON ag_catalog.registered_query_promotions;
CREATE TRIGGER registered_query_promotions_immutable
BEFORE UPDATE OR DELETE ON ag_catalog.registered_query_promotions
FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_registered_query_mutation();

DROP TRIGGER IF EXISTS registered_query_audit_immutable
  ON ag_catalog.registered_query_audit;
CREATE TRIGGER registered_query_audit_immutable
BEFORE UPDATE OR DELETE ON ag_catalog.registered_query_audit
FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_registered_query_mutation();

CREATE TABLE IF NOT EXISTS ag_catalog.card_registered_query_bindings (
  project_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  query_version INTEGER NOT NULL,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('required', 'optional')),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  assigned_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, deck_id, card_id, binding_id),
  FOREIGN KEY (project_id, query_id, query_version)
    REFERENCES ag_catalog.registered_query_versions(project_id, query_id, version)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_assignments (
  assignment_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  deck_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT,
  sender_card_id TEXT,
  receiver_card_id TEXT NOT NULL,
  parent_assignment_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  retry_of_assignment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, correlation_id),
  FOREIGN KEY (project_id, correlation_id)
    REFERENCES ag_catalog.card_run_traces(project_id, correlation_id)
    ON DELETE CASCADE,
  FOREIGN KEY (parent_assignment_id)
    REFERENCES ag_catalog.agent_assignments(assignment_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (retry_of_assignment_id)
    REFERENCES ag_catalog.agent_assignments(assignment_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_context_references (
  assignment_id TEXT NOT NULL
    REFERENCES ag_catalog.agent_assignments(assignment_id) ON DELETE CASCADE,
  reference_id TEXT NOT NULL,
  reference_type TEXT NOT NULL CHECK (
    reference_type IN ('agent_context', 'graph_view', 'registered_query', 'conversation_message', 'database')
  ),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assignment_id, reference_type, reference_id)
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_results (
  result_id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL UNIQUE
    REFERENCES ag_catalog.agent_assignments(assignment_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled')),
  output TEXT,
  error_code TEXT,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (project_id, correlation_id)
    REFERENCES ag_catalog.card_run_traces(project_id, correlation_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_artifact_references (
  assignment_id TEXT NOT NULL
    REFERENCES ag_catalog.agent_assignments(assignment_id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  locator TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assignment_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS ag_catalog.registered_query_executions (
  execution_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL
    REFERENCES ag_catalog.agent_assignments(assignment_id) ON DELETE CASCADE,
  binding_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  query_version INTEGER NOT NULL,
  parameters JSONB NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
  graph_view_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, correlation_id)
    REFERENCES ag_catalog.card_run_traces(project_id, correlation_id)
    ON DELETE CASCADE,
  FOREIGN KEY (project_id, query_id, query_version)
    REFERENCES ag_catalog.registered_query_versions(project_id, query_id, version)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS registered_query_executions_run_idx
  ON ag_catalog.registered_query_executions(project_id, correlation_id, created_at);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_context_payloads (
  context_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_agent_id TEXT,
  receiving_agent_id TEXT NOT NULL,
  markdown TEXT NOT NULL,
  producing_run_id TEXT,
  parent_context_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (parent_context_id)
    REFERENCES ag_catalog.agent_context_payloads(context_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ag_catalog.agent_result_payloads (
  result_id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL
    REFERENCES ag_catalog.agent_context_payloads(context_id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  receiving_agent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled')),
  markdown TEXT,
  result_ref TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Preserve all historical AGE payloads before new writes become identity-only.
LOAD 'age';
SET LOCAL search_path = ag_catalog, public;

WITH age_contexts AS (
  SELECT properties::text::jsonb AS properties
  FROM cypher('agentgraph', $$
    MATCH (context:AgentContext)
    RETURN properties(context)
  $$) AS (properties agtype)
)
INSERT INTO ag_catalog.agent_context_payloads (
  context_id, project_id, deck_id, conversation_id, sender_agent_id,
  receiving_agent_id, markdown, producing_run_id, status, created_at, updated_at
)
SELECT
  COALESCE(properties->>'contextId', properties->>'context_id'),
  COALESCE(properties->>'projectId', properties->>'project_id', ''),
  COALESCE(properties->>'deckId', properties->>'deck_id', ''),
  COALESCE(properties->>'conversationId', properties->>'conversation_id', ''),
  NULLIF(COALESCE(properties->>'senderAgentId', properties->>'sender_agent_id'), ''),
  COALESCE(properties->>'receivingAgentId', properties->>'receiving_agent_id', ''),
  COALESCE(properties->>'markdown', properties->>'prompt', ''),
  NULLIF(COALESCE(properties->>'producingRunId', properties->>'producing_run_id'), ''),
  COALESCE(NULLIF(properties->>'status', ''), 'pending'),
  COALESCE(
    NULLIF(COALESCE(properties->>'createdAt', properties->>'created_at'), '')::timestamptz,
    NOW()
  ),
  COALESCE(
    NULLIF(COALESCE(properties->>'updatedAt', properties->>'updated_at'), '')::timestamptz,
    NULLIF(COALESCE(properties->>'createdAt', properties->>'created_at'), '')::timestamptz,
    NOW()
  )
FROM age_contexts
WHERE COALESCE(properties->>'contextId', properties->>'context_id') IS NOT NULL
ON CONFLICT (context_id) DO NOTHING;

WITH age_results AS (
  SELECT
    result_properties::text::jsonb AS properties,
    context_properties::text::jsonb AS context_properties
  FROM cypher('agentgraph', $$
    MATCH (context:AgentContext)-[:PRODUCED]->(result:Result)
    RETURN properties(result), properties(context)
  $$) AS (result_properties agtype, context_properties agtype)
)
INSERT INTO ag_catalog.agent_result_payloads (
  result_id, context_id, project_id, conversation_id, receiving_agent_id,
  run_id, status, markdown, result_ref, error, created_at
)
SELECT
  COALESCE(properties->>'resultId', properties->>'result_id'),
  COALESCE(
    properties->>'contextId', properties->>'context_id',
    context_properties->>'contextId', context_properties->>'context_id'
  ),
  COALESCE(
    properties->>'projectId', properties->>'project_id',
    context_properties->>'projectId', context_properties->>'project_id', ''
  ),
  COALESCE(
    properties->>'conversationId', properties->>'conversation_id',
    context_properties->>'conversationId', context_properties->>'conversation_id', ''
  ),
  COALESCE(
    properties->>'receivingAgentId', properties->>'receiving_agent_id',
    context_properties->>'receivingAgentId', context_properties->>'receiving_agent_id', ''
  ),
  COALESCE(properties->>'runId', properties->>'run_id', ''),
  COALESCE(NULLIF(properties->>'status', ''), 'completed'),
  NULLIF(COALESCE(properties->>'markdown', properties->>'output'), ''),
  NULLIF(COALESCE(properties->>'resultRef', properties->>'result_ref'), ''),
  NULLIF(properties->>'error', ''),
  COALESCE(
    NULLIF(COALESCE(properties->>'createdAt', properties->>'created_at'), '')::timestamptz,
    NOW()
  )
FROM age_results
WHERE COALESCE(properties->>'resultId', properties->>'result_id') IS NOT NULL
  AND COALESCE(
    properties->>'contextId', properties->>'context_id',
    context_properties->>'contextId', context_properties->>'context_id'
  ) IN (
    SELECT context_id FROM ag_catalog.agent_context_payloads
  )
ON CONFLICT (result_id) DO NOTHING;

-- The relational copies above are now authoritative. Keep only compact graph
-- identity/status/lineage properties; remove duplicated operational payloads.
SELECT *
FROM cypher('agentgraph', $$
  MATCH (context:AgentContext)
  REMOVE context.markdown, context.prompt, context.prompt_ref
  RETURN count(context)
$$) AS (compacted_contexts agtype);

SELECT *
FROM cypher('agentgraph', $$
  MATCH (result:Result)
  REMOVE result.markdown, result.output, result.resultRef, result.result_ref, result.error
  RETURN count(result)
$$) AS (compacted_results agtype);

GRANT SELECT, INSERT
  ON ag_catalog.registered_queries,
     ag_catalog.registered_query_versions,
     ag_catalog.registered_query_promotions,
     ag_catalog.registered_query_audit
  TO "liquidaity-user";

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ag_catalog.card_registered_query_bindings,
     ag_catalog.agent_assignments,
     ag_catalog.agent_context_references,
     ag_catalog.agent_results,
     ag_catalog.agent_artifact_references,
     ag_catalog.registered_query_executions,
     ag_catalog.agent_context_payloads,
     ag_catalog.agent_result_payloads
  TO "liquidaity-user";

COMMIT;
