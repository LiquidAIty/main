-- Complete the vocabulary already used by observe_materialized_anchor_reads.
-- Run as the existing graph/schema owner when READ has not yet been created.
-- Ordinary backend readiness subsequently verifies/records this same migration.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

DO $migration$
DECLARE
  graph_oid OID;
  label_kind "char";
BEGIN
  SELECT graphid INTO graph_oid FROM ag_catalog.ag_graph WHERE name = 'agentgraph';
  IF graph_oid IS NULL THEN RAISE EXCEPTION 'agentgraph_not_found'; END IF;

  SELECT kind INTO label_kind FROM ag_catalog.ag_label
    WHERE graph = graph_oid AND name = 'READ';
  IF label_kind IS NULL THEN
    IF NOT has_schema_privilege(current_user, 'agentgraph', 'CREATE') THEN
      RAISE EXCEPTION 'agentgraph_read_schema_owner_required';
    END IF;
    PERFORM ag_catalog.create_elabel('agentgraph'::cstring, 'READ'::cstring);
  ELSIF label_kind <> 'e' THEN
    RAISE EXCEPTION 'agentgraph_read_label_kind_invalid';
  END IF;

  IF NOT (
    has_table_privilege('liquidaity-user', 'agentgraph."READ"', 'SELECT')
    AND has_table_privilege('liquidaity-user', 'agentgraph."READ"', 'INSERT')
    AND has_table_privilege('liquidaity-user', 'agentgraph."READ"', 'UPDATE')
  ) THEN
    GRANT SELECT, INSERT, UPDATE ON agentgraph."READ" TO "liquidaity-user";
  END IF;
  IF NOT has_sequence_privilege('liquidaity-user', 'agentgraph."READ_id_seq"', 'USAGE') THEN
    GRANT USAGE ON SEQUENCE agentgraph."READ_id_seq" TO "liquidaity-user";
  END IF;

  IF NOT (
    has_table_privilege('liquidaity-user', 'agentgraph."READ"', 'SELECT')
    AND has_table_privilege('liquidaity-user', 'agentgraph."READ"', 'INSERT')
    AND has_table_privilege('liquidaity-user', 'agentgraph."READ"', 'UPDATE')
    AND has_sequence_privilege('liquidaity-user', 'agentgraph."READ_id_seq"', 'USAGE')
  ) THEN
    RAISE EXCEPTION 'agentgraph_read_grant_missing';
  END IF;
END
$migration$;

COMMIT;
