-- sanity_extensions.sql
-- Quick checks for: pg_trgm, uuid-ossp, vector, PostGIS, TimescaleDB, AGE.

SET client_min_messages = warning;

-- 0) Show versions
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- 1) pg_trgm (PostgreSQL Trigram)
SELECT 'pg_trgm' AS ext, similarity('abc','abccc') AS ok;

-- 2) uuid-ossp (Universally Unique ID – OSSP)
SELECT 'uuid-ossp' AS ext, uuid_generate_v4() IS NOT NULL AS ok;

-- 3) pgvector
DROP TABLE IF EXISTS _tmp_vec;
CREATE TABLE _tmp_vec(
  id  int PRIMARY KEY,
  emb vector(4)
);
INSERT INTO _tmp_vec VALUES
  (1, '[1,0,0,0]'),
  (2, '[0,1,0,0]'),
  (3, '[1,0.1,0,0]');
-- Expect id=3 to be closest to [1,0,0,0]
SELECT 'vector' AS ext, id
FROM _tmp_vec
ORDER BY emb <-> '[1,0,0,0]'
LIMIT 1;

-- 4) PostGIS
SELECT 'postgis' AS ext,
       ST_IsValid(
         ST_Buffer(
           ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography,
           500
         )::geometry
       ) AS ok;

-- 5) TimescaleDB (must be a LOGGED table)
DROP TABLE IF EXISTS _tmp_ts;
CREATE TABLE _tmp_ts (
  ts  timestamptz NOT NULL,
  val int         NOT NULL
);
SELECT create_hypertable('_tmp_ts','ts', if_not_exists=>true);
INSERT INTO _tmp_ts
SELECT now() - (i||' min')::interval, i
FROM generate_series(1,300) g(i);
SELECT 'timescaledb' AS ext, count(*) AS rows FROM _tmp_ts;

-- 6) AGE (Apache AGE)
-- Ensure the graph exists
SELECT create_graph('graph_liq')
WHERE NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'graph_liq');

-- Count nodes (works even if there are none)
SELECT 'age' AS ext, cnt
FROM ag_catalog.cypher(
       'graph_liq'::name,
       $$ MATCH (n) RETURN count(n) AS cnt $$::cstring
     ) AS (cnt bigint);
