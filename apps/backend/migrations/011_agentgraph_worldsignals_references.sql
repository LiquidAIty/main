-- WorldSignals remains the payload authority. AgentGraph stores only the
-- stable identity of a bounded command, batch, poll, or event result.

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
      'native_session',
      'worldsignals'
    )
  );

COMMIT;
