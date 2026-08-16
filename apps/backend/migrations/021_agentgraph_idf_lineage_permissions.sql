-- Best-effort AGE observation for immutable IDF and durable result identities.
-- PostgreSQL remains execution authority. AGE receives no DELETE privilege and
-- no assignment, approval, runtime, or provider-selection authority.

BEGIN;

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

DO $$
DECLARE
  graph_oid OID;
BEGIN
  SELECT graphid INTO graph_oid FROM ag_catalog.ag_graph WHERE name = 'agentgraph';
  IF graph_oid IS NULL THEN
    RAISE EXCEPTION 'agentgraph_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label WHERE graph = graph_oid AND name = 'InputDataFile'
  ) THEN
    PERFORM ag_catalog.create_vlabel('agentgraph', 'InputDataFile');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label WHERE graph = graph_oid AND name = 'Result'
  ) THEN
    PERFORM ag_catalog.create_vlabel('agentgraph', 'Result');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ag_catalog.ag_label WHERE graph = graph_oid AND name = 'PRODUCED'
  ) THEN
    PERFORM ag_catalog.create_elabel('agentgraph', 'PRODUCED');
  END IF;
END
$$;

REVOKE ALL PRIVILEGES
  ON agentgraph."Assignment", agentgraph."USES_IDF"
  FROM "liquidaity-user";
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON agentgraph."InputDataFile", agentgraph."Result", agentgraph."PRODUCED"
  FROM "liquidaity-user";

GRANT USAGE ON SCHEMA agentgraph TO "liquidaity-user";
GRANT SELECT, INSERT, UPDATE
  ON agentgraph."InputDataFile", agentgraph."Result", agentgraph."PRODUCED"
  TO "liquidaity-user";
GRANT USAGE, SELECT
  ON agentgraph."InputDataFile_id_seq", agentgraph."Result_id_seq", agentgraph."PRODUCED_id_seq"
  TO "liquidaity-user";

COMMIT;
