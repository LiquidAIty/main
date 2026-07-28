-- Remove abandoned runtime-profile, permanent card-binding, and audit surfaces.
-- Saved cards own their configuration. AgentGraph keeps exact assignments,
-- operation references, execution identity, and result lineage.

BEGIN;

DROP TABLE IF EXISTS public.card_run_traces;
DROP TABLE IF EXISTS public.card_data_bindings;
DROP TABLE IF EXISTS public.card_skill_bindings;
DROP TABLE IF EXISTS public.runtime_skills;
DROP TABLE IF EXISTS public.runtime_profiles;

DROP TABLE IF EXISTS ag_catalog.card_registered_query_bindings;
DROP TABLE IF EXISTS ag_catalog.registered_query_audit;

ALTER TABLE IF EXISTS ag_catalog.registered_queries
  DROP COLUMN IF EXISTS owner_id,
  DROP COLUMN IF EXISTS description;

ALTER TABLE IF EXISTS ag_catalog.registered_query_versions
  DROP COLUMN IF EXISTS authored_by,
  DROP COLUMN IF EXISTS audit_note;

ALTER TABLE IF EXISTS ag_catalog.card_run_traces
  DROP COLUMN IF EXISTS profile_id,
  DROP COLUMN IF EXISTS profile_version,
  DROP COLUMN IF EXISTS skill_versions,
  DROP COLUMN IF EXISTS data_binding_refs;

ALTER TABLE IF EXISTS ag_catalog.agent_assignments
  DROP CONSTRAINT IF EXISTS agent_assignments_retry_of_assignment_id_fkey,
  DROP COLUMN IF EXISTS retry_of_assignment_id;

COMMIT;
