-- Remove the abandoned GraphView and registered-query detours.
-- AgentGraph keeps assignments, prompts, direct native-authority references,
-- execution lineage, and results. Native graph tools own graph reads/writes.

BEGIN;

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

DELETE FROM ag_catalog.agent_context_references
WHERE reference_type IN ('graph_view', 'registered_query', 'query_execution');

UPDATE ag_catalog.agent_context_references
SET reference_type = CASE reference_type
  WHEN 'thinkgraph' THEN 'engraphis'
  WHEN 'knowgraph' THEN 'graphiti'
  WHEN 'codegraph' THEN 'cbm'
  ELSE reference_type
END
WHERE reference_type IN ('thinkgraph', 'knowgraph', 'codegraph');

ALTER TABLE ag_catalog.agent_context_references
  DROP CONSTRAINT IF EXISTS agent_context_references_reference_type_check;
ALTER TABLE ag_catalog.agent_context_references
  ADD CONSTRAINT agent_context_references_reference_type_check
  CHECK (
    reference_type IN (
      'artifact',
      'conversation_message',
      'database',
      'engraphis',
      'graphiti',
      'cbm',
      'native_session',
      'worldsignals'
    )
  );

DROP TABLE IF EXISTS ag_catalog.agent_instruction_operation_references;
DROP TABLE IF EXISTS ag_catalog.agent_assignment_operation_references;
DROP TABLE IF EXISTS ag_catalog.registered_query_executions;
DROP TABLE IF EXISTS ag_catalog.card_registered_query_bindings;
DROP TABLE IF EXISTS ag_catalog.registered_query_audit;
DROP TABLE IF EXISTS ag_catalog.registered_query_promotions;
DROP TABLE IF EXISTS ag_catalog.registered_query_versions;
DROP TABLE IF EXISTS ag_catalog.registered_queries;
DROP FUNCTION IF EXISTS ag_catalog.reject_registered_query_mutation();

-- Remove the abandoned model-facing JSON response contract from saved agent
-- configuration. Graphiti owns extraction structure; prompts may provide
-- organizing guidance without forcing every model through a second dialect.
DROP TABLE IF EXISTS ag_catalog.project_agents;

-- Hermes memory is owned by Hermes itself. These tables belonged to the
-- removed LiquidAIty SQL-memory imitation and have no runtime caller.
DROP TABLE IF EXISTS liq_core.memory_item;
DROP TABLE IF EXISTS liq_core.memory_space;
DROP TABLE IF EXISTS liq_core.knowgraph_scope_attachment;

SELECT *
FROM ag_catalog.cypher(
  'agentgraph',
  $$
  MATCH (view:GraphView)
  DETACH DELETE view
  RETURN count(view)
  $$
) AS (deleted agtype);

COMMIT;
