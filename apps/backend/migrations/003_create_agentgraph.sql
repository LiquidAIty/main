-- AgentGraph is the Apache AGE authority for exact Markdown agent handoffs and result lineage.
-- Apply with the same Postgres connection used by Python rails and the backend.

BEGIN;

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'agentgraph') THEN
    PERFORM ag_catalog.create_graph('agentgraph');
  END IF;
END
$$;

COMMIT;
