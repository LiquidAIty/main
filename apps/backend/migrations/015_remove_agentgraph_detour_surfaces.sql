-- Remove abandoned runtime-profile, permanent card-binding, audit, and
-- lease/retry surfaces.
-- Saved cards own their configuration. AgentGraph keeps exact assignments,
-- operation references, execution identity, and result lineage.
--
-- Do not apply until the remaining registered_query_audit records have been
-- reviewed. Migration 014 independently aligns the live claim-token contract.

BEGIN;

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

DROP TABLE IF EXISTS public.card_run_traces;
DROP TABLE IF EXISTS public.card_data_bindings;
DROP TABLE IF EXISTS public.card_skill_bindings;
DROP TABLE IF EXISTS public.runtime_skills;
DROP TABLE IF EXISTS public.runtime_profiles;

DROP TABLE IF EXISTS ag_catalog.card_registered_query_bindings;
DROP TABLE IF EXISTS ag_catalog.registered_query_audit;
DROP TABLE IF EXISTS ag_catalog.registered_query_promotions;

ALTER TABLE IF EXISTS ag_catalog.registered_queries
  DROP CONSTRAINT IF EXISTS registered_queries_target_graph_check,
  DROP CONSTRAINT IF EXISTS registered_queries_operation_class_check,
  DROP CONSTRAINT IF EXISTS registered_queries_codegraph_write_check,
  DROP CONSTRAINT IF EXISTS registered_queries_capability_check,
  DROP COLUMN IF EXISTS owner_id,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS target_graph,
  DROP COLUMN IF EXISTS operation_class,
  DROP COLUMN IF EXISTS capability_id,
  DROP COLUMN IF EXISTS disabled_at;

ALTER TABLE IF EXISTS ag_catalog.registered_query_versions
  DROP COLUMN IF EXISTS authored_by,
  DROP COLUMN IF EXISTS audit_note;

ALTER TABLE IF EXISTS ag_catalog.registered_query_versions
  DROP CONSTRAINT IF EXISTS registered_query_versions_language_check;
ALTER TABLE IF EXISTS ag_catalog.registered_query_versions
  ADD CONSTRAINT registered_query_versions_language_check
  CHECK (language IN ('sql', 'cypher'));

ALTER TABLE IF EXISTS ag_catalog.card_run_traces
  DROP COLUMN IF EXISTS profile_id,
  DROP COLUMN IF EXISTS profile_version,
  DROP COLUMN IF EXISTS skill_versions,
  DROP COLUMN IF EXISTS data_binding_refs;

ALTER TABLE IF EXISTS ag_catalog.agent_assignments
  DROP CONSTRAINT IF EXISTS agent_assignments_retry_of_assignment_id_fkey,
  DROP COLUMN IF EXISTS retry_of_assignment_id,
  DROP COLUMN IF EXISTS lease_token,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS heartbeat_at,
  DROP COLUMN IF EXISTS attempt;

SELECT *
FROM ag_catalog.cypher(
  'agentgraph',
  $$
  MATCH (assignment:Assignment)
  REMOVE assignment.attempt,
         assignment.leaseExpiresAt,
         assignment.heartbeatAt,
         assignment.retryOfAssignmentId
  RETURN count(assignment)
  $$
) AS (updated agtype);

COMMIT;
