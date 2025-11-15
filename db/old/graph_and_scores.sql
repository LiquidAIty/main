-- graph_and_scores.sql
-- Minimal: define a view that reads AGE edges and computes a simple “gap” score.
-- No PL/pgSQL, no parameters, no MV, no functions.

SET search_path = public, ag_catalog;

CREATE OR REPLACE VIEW public.v_gap_scores AS
WITH es AS (
  -- NOTE: cast query to cstring; no 3rd param
  SELECT *
  FROM ag_catalog.cypher('graph_liq'::name,
         $$MATCH (a:Entity)-[r:REL]->(b:Entity)
           RETURN a.uid AS src, r.rel AS rel, b.uid AS dst$$::cstring
  ) AS (src text, rel text, dst text)
),
deg AS (
  SELECT
    uid,
    COUNT(*) FILTER (WHERE dir = 'out') AS out_e,
    COUNT(*) FILTER (WHERE dir = 'in')  AS in_e,
    COUNT(DISTINCT rel) FILTER (WHERE dir = 'out') AS uo,
    COUNT(DISTINCT rel) FILTER (WHERE dir = 'in')  AS ui
  FROM (
    SELECT src AS uid, 'out'::text AS dir, rel FROM es
    UNION ALL
    SELECT dst AS uid, 'in' ::text AS dir, rel FROM es
  ) x
  GROUP BY uid
)
SELECT
  uid,

  in_e                      AS in_edges,
  (out_e + in_e)            AS total_edges,
  uo                        AS uniq_out_rels,
  ui                        AS uniq_in_rels,
  (uo + ui)                 AS rel_diversity,
  (
    10 - LEAST(10, CEIL(LOG(1 + (out_e + in_e))))
    + CASE WHEN (uo + ui) <= 1 THEN 3 ELSE 0 END
  )::int                    AS gap_score
FROM deg;
