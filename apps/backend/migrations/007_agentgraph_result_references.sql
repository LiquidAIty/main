-- Complete exact Hermes result/reference correlation on the one AgentGraph
-- assignment authority. Native session memory remains in its native store;
-- AgentGraph records only stable identities and cross-agent provenance.

BEGIN;

ALTER TABLE ag_catalog.agent_context_references
  DROP CONSTRAINT IF EXISTS agent_context_references_reference_type_check;
ALTER TABLE ag_catalog.agent_context_references
  ADD CONSTRAINT agent_context_references_reference_type_check
  CHECK (
    reference_type IN (
      'graph_view',
      'registered_query',
      'conversation_message',
      'database',
      'thinkgraph',
      'knowgraph',
      'codegraph',
      'native_session'
    )
  );

ALTER TABLE ag_catalog.agent_results
  ADD COLUMN IF NOT EXISTS summary TEXT;

COMMIT;
