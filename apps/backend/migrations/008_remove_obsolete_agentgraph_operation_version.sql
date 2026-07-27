-- Remove the only obsolete registered-operation version. It queried the
-- migration-005 context payload table that migration 006 removed. The version
-- has no bindings or executions; only its rejected setup audit rows remain.

BEGIN;

DROP TRIGGER IF EXISTS registered_query_audit_immutable
  ON ag_catalog.registered_query_audit;
DROP TRIGGER IF EXISTS registered_query_versions_immutable
  ON ag_catalog.registered_query_versions;

DELETE FROM ag_catalog.registered_query_audit
WHERE query_id = 'agentgraph.active_context_identities'
  AND version = 1;

DELETE FROM ag_catalog.registered_query_versions
WHERE query_id = 'agentgraph.active_context_identities'
  AND version = 1;

CREATE TRIGGER registered_query_versions_immutable
BEFORE UPDATE OR DELETE ON ag_catalog.registered_query_versions
FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_registered_query_mutation();

CREATE TRIGGER registered_query_audit_immutable
BEFORE UPDATE OR DELETE ON ag_catalog.registered_query_audit
FOR EACH ROW EXECUTE FUNCTION ag_catalog.reject_registered_query_mutation();

COMMIT;
