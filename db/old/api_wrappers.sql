-- api_wrappers.sql  (AGE-safe; dollar-quoted cstring everywhere)
CREATE SCHEMA IF NOT EXISTS api;

-- Ensure a node exists: (uid)
CREATE OR REPLACE FUNCTION api.upsert_entity(p_uid text)
RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE ok int; cy text;
BEGIN
  -- exists?
  cy := format('MATCH (n:Entity {uid:%L}) RETURN 1', p_uid);
  EXECUTE format(
    'SELECT 1 FROM ag_catalog.cypher(''graph_liq''::name, $q$%s$q$::cstring) AS (_ok int)',
    cy
  ) INTO ok;

  IF NOT FOUND THEN
    cy := format('CREATE (n:Entity {uid:%L}) RETURN 1', p_uid);
    EXECUTE format(
      'SELECT 1 FROM ag_catalog.cypher(''graph_liq''::name, $q$%s$q$::cstring) AS (_ok int)',
      cy
    ) INTO ok;
  END IF;
END
$f$;

-- Ensure edge: (src)-[:REL {rel:<p_rel>}]->(dst)
CREATE OR REPLACE FUNCTION api.add_edge_simple(p_src text, p_rel text, p_dst text)
RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE ok int; cy text;
BEGIN
  PERFORM api.upsert_entity(p_src);
  PERFORM api.upsert_entity(p_dst);

  -- edge exists?
  cy := format(
    'MATCH (a:Entity {uid:%L})-[r:REL]->(b:Entity {uid:%L}) WHERE r.rel=%L RETURN 1',
    p_src, p_dst, p_rel
  );
  EXECUTE format(
    'SELECT 1 FROM ag_catalog.cypher(''graph_liq''::name, $q$%s$q$::cstring) AS (_ok int)',
    cy
  ) INTO ok;

  IF NOT FOUND THEN
    cy := format(
      'MATCH (a:Entity {uid:%L}), (b:Entity {uid:%L}) CREATE (a)-[:REL {rel:%L}]->(b) RETURN 1',
      p_src, p_dst, p_rel
    );
    EXECUTE format(
      'SELECT 1 FROM ag_catalog.cypher(''graph_liq''::name, $q$%s$q$::cstring) AS (_ok int)',
      cy
    ) INTO ok;
  END IF;
END
$f$;

-- Read views (constant cstring with dollar-quote)
DROP VIEW IF EXISTS public.v_edges;
CREATE VIEW public.v_edges AS
SELECT *
FROM ag_catalog.cypher(
       'graph_liq'::name,
       $$MATCH (a:Entity)-[r:REL]->(b:Entity)
         RETURN a.uid AS src_uid, r.rel AS rel, b.uid AS dst_uid$$::cstring
     ) AS (src_uid text, rel text, dst_uid text);

DROP VIEW IF EXISTS public.v_nodes;
CREATE VIEW public.v_nodes AS
SELECT *
FROM ag_catalog.cypher(
       'graph_liq'::name,
       $$MATCH (n:Entity) RETURN n.uid AS uid$$::cstring
     ) AS (uid text);

-- Optional grants for mcp role if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mcp') THEN
    GRANT USAGE ON SCHEMA api TO mcp;
    GRANT EXECUTE ON FUNCTION api.upsert_entity(text) TO mcp;
    GRANT EXECUTE ON FUNCTION api.add_edge_simple(text,text,text) TO mcp;
    GRANT SELECT ON public.v_nodes, public.v_edges TO mcp;
  END IF;
END$$;
