--
-- PostgreSQL database dump
--

\restrict 01yHeZbvQdIm6FxQxBe4453wwMEXvBnQATSdmM18C9XPwwjReZLuQuqaF8nEuec

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: liquidaity-user
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO "liquidaity-user";

--
-- Name: timescaledb; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;


--
-- Name: EXTENSION timescaledb; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION timescaledb IS 'Enables scalable inserts and complex queries for time-series data (Community Edition)';


--
-- Name: ag_catalog; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA ag_catalog;


ALTER SCHEMA ag_catalog OWNER TO postgres;

--
-- Name: api; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA api;


ALTER SCHEMA api OWNER TO postgres;

--
-- Name: graph_liq; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA graph_liq;


ALTER SCHEMA graph_liq OWNER TO postgres;

--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA topology;


ALTER SCHEMA topology OWNER TO postgres;

--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: age; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS age WITH SCHEMA ag_catalog;


--
-- Name: EXTENSION age; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION age IS 'AGE database extension';


--
-- Name: btree_gin; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;


--
-- Name: EXTENSION btree_gin; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gin IS 'support for indexing common datatypes in GIN';


--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA ag_catalog;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA ag_catalog;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: add_edge_simple(text, text, text); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.add_edge_simple(p_src text, p_rel text, p_dst text) RETURNS void
    LANGUAGE plpgsql
    AS $_$
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
$_$;


ALTER FUNCTION api.add_edge_simple(p_src text, p_rel text, p_dst text) OWNER TO postgres;

--
-- Name: get_gap_scores(integer); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.get_gap_scores(limit_rows integer DEFAULT 50) RETURNS TABLE(uid text, out_edges integer, in_edges integer, total_edges integer, uniq_out_rels integer, uniq_in_rels integer, rel_diversity integer, gap_score integer)
    LANGUAGE plpgsql
    AS $_$
BEGIN
  RETURN QUERY
  WITH es AS (
    -- 3rd arg must be agtype; pass a harmless dummy map
    SELECT *
    FROM ag_catalog.cypher(
           'graph_liq'::name,
           $$MATCH (a:Entity)-[r:REL]->(b:Entity)
             RETURN a.uid AS src_uid, r.rel AS rel, b.uid AS dst_uid$$::cstring,
           ag_catalog.agtype_build_map('noop', '0'::ag_catalog.agtype)
         ) AS (src_uid text, rel text, dst_uid text)
  ),
  deg AS (
    SELECT
      node_uid,
      COUNT(*) FILTER (WHERE dir = 'out') AS out_e,
      COUNT(*) FILTER (WHERE dir = 'in')  AS in_e,
      COUNT(DISTINCT rel) FILTER (WHERE dir = 'out') AS uniq_out_r,
      COUNT(DISTINCT rel) FILTER (WHERE dir = 'in')  AS uniq_in_r
    FROM (
      SELECT src_uid AS node_uid, 'out'::text AS dir, rel FROM es
      UNION ALL
      SELECT dst_uid AS node_uid, 'in' ::text AS dir, rel FROM es
    ) x
    GROUP BY node_uid
  ),
  scored AS (
    SELECT
      node_uid,
      COALESCE(out_e,0)        AS out_edges,
      COALESCE(in_e ,0)        AS in_edges,
      COALESCE(uniq_out_r,0)   AS uniq_out_rels,
      COALESCE(uniq_in_r ,0)   AS uniq_in_rels,
      COALESCE(out_e,0) + COALESCE(in_e,0)           AS total_edges,
      COALESCE(uniq_out_r,0) + COALESCE(uniq_in_r,0) AS rel_diversity
    FROM deg
  )
  SELECT
    s.node_uid                       AS uid,
    s.out_edges                      AS out_edges,
    s.in_edges                       AS in_edges,
    s.total_edges                    AS total_edges,
    s.uniq_out_rels                  AS uniq_out_rels,
    s.uniq_in_rels                   AS uniq_in_rels,
    s.rel_diversity                  AS rel_diversity,
    (
      10 - LEAST(10, CEIL(LOG(1 + s.total_edges)))
      + CASE WHEN s.rel_diversity <= 1 THEN 3 ELSE 0 END
    )::int                           AS gap_score
  FROM scored s
  ORDER BY gap_score DESC, total_edges ASC, uid ASC
  LIMIT limit_rows;
END;
$_$;


ALTER FUNCTION api.get_gap_scores(limit_rows integer) OWNER TO postgres;

--
-- Name: ingest_embedding(bigint, text, public.vector, real, real); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.ingest_embedding(p_chunk_id bigint, p_model text, p_emb public.vector, p_volume real, p_confidence real) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_scale REAL;
BEGIN
  IF p_emb IS NULL THEN
    RAISE EXCEPTION 'p_emb cannot be NULL';
  END IF;

  v_scale := GREATEST(0, COALESCE(p_volume,0) * COALESCE(p_confidence,0));

  INSERT INTO ag_catalog.rag_embeddings(chunk_id, model, emb, volume, confidence, scale, created_at, updated_at)
  VALUES (p_chunk_id, p_model, p_emb, COALESCE(p_volume,0), COALESCE(p_confidence,0), v_scale, now(), now())
  ON CONFLICT (chunk_id, model) DO UPDATE
    SET emb        = EXCLUDED.emb,
        volume     = EXCLUDED.volume,
        confidence = EXCLUDED.confidence,
        scale      = EXCLUDED.scale,
        updated_at = now();
END
$$;


ALTER FUNCTION api.ingest_embedding(p_chunk_id bigint, p_model text, p_emb public.vector, p_volume real, p_confidence real) OWNER TO postgres;

--
-- Name: rag_topk_cosine(public.vector, integer); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.rag_topk_cosine(q public.vector, k integer) RETURNS TABLE(chunk_id bigint, doc_id text, src text, chunk text, model text, cos_dist real, sim_cosine real, created_at timestamp with time zone)
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT
    e.chunk_id,
    c.doc_id,
    c.src,
    c.chunk,
    e.model,
    (e.emb <=> q)::REAL AS cos_dist,
    (1 - (e.emb <=> q))::REAL AS sim_cosine,
    c.created_at
  FROM ag_catalog.rag_embeddings e
  JOIN ag_catalog.rag_chunks_pk  c ON c.chunk_id = e.chunk_id
  ORDER BY e.emb <=> q
  LIMIT GREATEST(1, LEAST(k, 50));
$$;


ALTER FUNCTION api.rag_topk_cosine(q public.vector, k integer) OWNER TO postgres;

--
-- Name: rag_topk_hybrid_cosine(public.vector, integer, real, real); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.rag_topk_hybrid_cosine(q public.vector, k integer, w_dist real, w_recency real) RETURNS TABLE(chunk_id bigint, doc_id text, src text, chunk text, model text, score real, dist real, days_old real, created_at timestamp with time zone)
    LANGUAGE sql
    SET search_path TO 'ag_catalog', 'public', 'api'
    AS $$
  WITH base AS (
    SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
           (e.emb <=> q) AS dist,
           EXTRACT(EPOCH FROM (now() - c.created_at))/86400.0 AS days_old,
           c.created_at
      FROM ag_catalog.rag_embeddings e
      JOIN ag_catalog.rag_chunks     c ON c.id = e.chunk_id
  )
  SELECT chunk_id, doc_id, src, chunk, model,
         (w_dist * (1 - dist)) + (w_recency * (1.0 / (1.0 + days_old))) AS score,
         dist, days_old, created_at
    FROM base
   ORDER BY score DESC
   LIMIT k
$$;


ALTER FUNCTION api.rag_topk_hybrid_cosine(q public.vector, k integer, w_dist real, w_recency real) OWNER TO postgres;

--
-- Name: rag_topk_l2(public.vector, integer); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.rag_topk_l2(q public.vector, k integer) RETURNS TABLE(chunk_id bigint, doc_id text, src text, chunk text, model text, dist real, created_at timestamp with time zone)
    LANGUAGE sql
    SET search_path TO 'ag_catalog', 'public', 'api'
    AS $$
  SELECT e.chunk_id, c.doc_id, c.src, c.chunk, e.model,
         (e.emb <-> q) AS dist,
         c.created_at
  FROM ag_catalog.rag_embeddings e
  JOIN ag_catalog.rag_chunks   c ON c.id = e.chunk_id
  ORDER BY e.emb <-> q
  LIMIT k
$$;


ALTER FUNCTION api.rag_topk_l2(q public.vector, k integer) OWNER TO postgres;

--
-- Name: rag_topk_l2_mag(public.vector, integer); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.rag_topk_l2_mag(q public.vector, k integer) RETURNS TABLE(chunk_id bigint, doc_id text, src text, chunk text, model text, l2_dist real, scale real, adj real, created_at timestamp with time zone)
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  WITH base AS (
    SELECT
      e.chunk_id,
      c.doc_id,
      c.src,
      c.chunk,
      e.model,
      (e.emb <-> q)::REAL AS l2_dist,
      e.scale::REAL       AS scale,
      c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks_pk  c ON c.chunk_id = e.chunk_id
  )
  SELECT
    b.chunk_id, b.doc_id, b.src, b.chunk, b.model,
    b.l2_dist,
    b.scale,
    (b.l2_dist * (1.0 / GREATEST(0.1, b.scale)))::REAL AS adj,
    b.created_at
  FROM base b
  ORDER BY b.l2_dist ASC
  LIMIT GREATEST(1, LEAST(k, 50));
$$;


ALTER FUNCTION api.rag_topk_l2_mag(q public.vector, k integer) OWNER TO postgres;

--
-- Name: rag_topk_weighted(public.vector, integer, real, real, real); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.rag_topk_weighted(q public.vector, k integer, w_cos real, w_rec real, w_sig real) RETURNS TABLE(chunk_id bigint, doc_id text, src text, chunk text, model text, score real, cos_dist real, l2_dist real, scale real, days_old real, created_at timestamp with time zone)
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  WITH base AS (
    SELECT
      e.chunk_id,
      c.doc_id,
      c.src,
      c.chunk,
      e.model,
      (e.emb <=> q)::REAL AS cos_dist,
      (e.emb <-> q)::REAL AS l2_dist,
      e.scale::REAL       AS scale,
      EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400.0::REAL AS days_old,
      c.created_at
    FROM ag_catalog.rag_embeddings e
    JOIN ag_catalog.rag_chunks_pk  c ON c.chunk_id = e.chunk_id
  ), parts AS (
    SELECT
      b.*,
      (1 - b.cos_dist)::REAL           AS sem,
      (1.0 / (1.0 + b.days_old))::REAL AS rec,
      LEAST(1.0, b.scale / 5.0)::REAL  AS sig
    FROM base b
  )
  SELECT
    p.chunk_id, p.doc_id, p.src, p.chunk, p.model,
    (w_cos * p.sem + w_rec * p.rec + w_sig * p.sig)::REAL AS score,
    p.cos_dist,
    p.l2_dist,
    p.scale,
    p.days_old,
    p.created_at
  FROM parts p
  ORDER BY score DESC
  LIMIT GREATEST(1, LEAST(k, 50));
$$;


ALTER FUNCTION api.rag_topk_weighted(q public.vector, k integer, w_cos real, w_rec real, w_sig real) OWNER TO postgres;

--
-- Name: upsert_chunk_with_embedding(text, text, text, text, public.vector, real, real); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.upsert_chunk_with_embedding(p_doc_id text, p_src text, p_chunk text, p_model text, p_emb public.vector, p_volume real DEFAULT NULL::real, p_confidence real DEFAULT NULL::real) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'ag_catalog', 'public', 'api'
    AS $$
DECLARE
  v_id bigint;
BEGIN
  -- upsert chunk by doc_id (doc_id is unique)
  INSERT INTO ag_catalog.rag_chunks (doc_id, src, chunk, created_at)
  VALUES (p_doc_id, p_src, p_chunk, now())
  ON CONFLICT (doc_id) DO UPDATE
  SET src   = EXCLUDED.src,
      chunk = EXCLUDED.chunk
  RETURNING id INTO v_id;

  PERFORM api.ingest_embedding(v_id, p_model, p_emb, p_volume, p_confidence);

  RETURN v_id;
END
$$;


ALTER FUNCTION api.upsert_chunk_with_embedding(p_doc_id text, p_src text, p_chunk text, p_model text, p_emb public.vector, p_volume real, p_confidence real) OWNER TO postgres;

--
-- Name: upsert_edge(text, text, text); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.upsert_edge(p_src text, p_rel text, p_dst text) RETURNS void
    LANGUAGE plpgsql
    AS $_$
DECLARE
  e_cnt int := 0;
BEGIN
  -- Ensure endpoints
  PERFORM api.upsert_entity(p_src, 'Thing');
  PERFORM api.upsert_entity(p_dst, 'Thing');

  -- Edge already there?
  SELECT COALESCE(COUNT(*), 0) INTO e_cnt
  FROM ag_catalog.cypher(
         'graph_liq'::name,
         $$MATCH (a:Entity {uid:$src})-[r:REL {rel:$rel}]->(b:Entity {uid:$dst})
           RETURN r$$::cstring,
         ag_catalog.agtype_build_map(
           'src', p_src::ag_catalog.agtype,
           'rel', p_rel::ag_catalog.agtype,
           'dst', p_dst::ag_catalog.agtype
         )
       ) AS (r ag_catalog.agtype);

  IF e_cnt = 0 THEN
    PERFORM 1
    FROM ag_catalog.cypher(
           'graph_liq'::name,
           $$MATCH (a:Entity {uid:$src}), (b:Entity {uid:$dst})
             CREATE (a)-[:REL {rel:$rel}]->(b)
             RETURN 1$$::cstring,
           ag_catalog.agtype_build_map(
             'src', p_src::ag_catalog.agtype,
             'dst', p_dst::ag_catalog.agtype,
             'rel', p_rel::ag_catalog.agtype
           )
         ) AS (_ok int);
  END IF;
END;
$_$;


ALTER FUNCTION api.upsert_edge(p_src text, p_rel text, p_dst text) OWNER TO postgres;

--
-- Name: upsert_entity(text); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.upsert_entity(p_uid text) RETURNS void
    LANGUAGE plpgsql
    AS $_$
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
$_$;


ALTER FUNCTION api.upsert_entity(p_uid text) OWNER TO postgres;

--
-- Name: upsert_entity(text, text); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.upsert_entity(p_uid text, p_kind text) RETURNS void
    LANGUAGE plpgsql
    AS $_$
DECLARE
  exists_cnt int := 0;
BEGIN
  -- Does node exist?
  SELECT COALESCE(COUNT(*), 0) INTO exists_cnt
  FROM ag_catalog.cypher(
         'graph_liq'::name,
         $$MATCH (n:Entity {uid:$uid}) RETURN n$$::cstring,
         ag_catalog.agtype_build_map(
           'uid', p_uid::ag_catalog.agtype
         )
       ) AS (n ag_catalog.agtype);

  IF exists_cnt = 0 THEN
    -- Create it
    PERFORM 1
    FROM ag_catalog.cypher(
           'graph_liq'::name,
           $$CREATE (n:Entity {uid:$uid, kind:$kind}) RETURN 1$$::cstring,
           ag_catalog.agtype_build_map(
             'uid',  p_uid ::ag_catalog.agtype,
             'kind', p_kind::ag_catalog.agtype
           )
         ) AS (_ok int);
  END IF;
END;
$_$;


ALTER FUNCTION api.upsert_entity(p_uid text, p_kind text) OWNER TO postgres;

--
-- Name: all_edges(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.all_edges(p ag_catalog.agtype) RETURNS TABLE(n ag_catalog.agtype, r ag_catalog.agtype, m ag_catalog.agtype)
    LANGUAGE sql STABLE
    AS $_$
  SELECT n,r,m FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (n)-[r]->(m) RETURN n,r,m$$,
    $1
  ) AS (n ag_catalog.agtype, r ag_catalog.agtype, m ag_catalog.agtype);
$_$;


ALTER FUNCTION public.all_edges(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: company_runs_params(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.company_runs_params(p ag_catalog.agtype) RETURNS TABLE(c ag_catalog.agtype, r ag_catalog.agtype, p ag_catalog.agtype)
    LANGUAGE sql STABLE
    AS $_$
  SELECT c,r,p FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (c:Company {name:$cname})-[r:RUNS]->(p:Project) RETURN c,r,p$$,
    $1
  ) AS (c ag_catalog.agtype, r ag_catalog.agtype, p ag_catalog.agtype);
$_$;


ALTER FUNCTION public.company_runs_params(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: cyph_edges(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cyph_edges(p ag_catalog.agtype) RETURNS TABLE(n ag_catalog.agtype, r ag_catalog.agtype, m ag_catalog.agtype)
    LANGUAGE sql STABLE
    AS $_$
  SELECT n,r,m FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (n)-[r]->(m) RETURN n,r,m LIMIT 5$$,
    $1
  ) AS (n ag_catalog.agtype, r ag_catalog.agtype, m ag_catalog.agtype);
$_$;


ALTER FUNCTION public.cyph_edges(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: cyph_nodes(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cyph_nodes(p ag_catalog.agtype) RETURNS SETOF ag_catalog.agtype
    LANGUAGE sql STABLE
    AS $_$
  SELECT n FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (n) RETURN n LIMIT 5$$,
    $1
  ) AS (n ag_catalog.agtype);
$_$;


ALTER FUNCTION public.cyph_nodes(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: cyph_void(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cyph_void(p ag_catalog.agtype) RETURNS integer
    LANGUAGE sql
    AS $_$
  SELECT * FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$CREATE (:Company {name:'LiquidAIty'})-[:BUILDS]->(:Agent {name:'Sol'}) RETURN 1$$,
    $1
  ) AS (ok int);
$_$;


ALTER FUNCTION public.cyph_void(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: edge_count(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.edge_count(p ag_catalog.agtype) RETURNS integer
    LANGUAGE sql STABLE
    AS $_$
  SELECT cnt FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH ()-[r:BUILDS]->() RETURN count(r) AS cnt$$,
    $1
  ) AS (cnt int);
$_$;


ALTER FUNCTION public.edge_count(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: edge_type_counts(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.edge_type_counts(p ag_catalog.agtype) RETURNS TABLE(rel text, cnt integer)
    LANGUAGE sql STABLE
    AS $_$
  SELECT rel, cnt FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH ()-[r]->() RETURN type(r) AS rel, count(r) AS cnt$$,
    $1
  ) AS (rel text, cnt int);
$_$;


ALTER FUNCTION public.edge_type_counts(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: edges(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.edges(p ag_catalog.agtype) RETURNS TABLE(src text, rel text, dst text, eprops ag_catalog.agtype)
    LANGUAGE sql STABLE
    AS $_$
  SELECT src, rel, dst, eprops FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (a:Entity)-[r:REL]->(b:Entity)
      RETURN a.uid AS src, r.rel AS rel, b.uid AS dst, properties(r) AS eprops$$,
    $1
  ) AS (src text, rel text, dst text, eprops ag_catalog.agtype);
$_$;


ALTER FUNCTION public.edges(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: entities(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.entities(p ag_catalog.agtype) RETURNS TABLE(uid text, kind text, props ag_catalog.agtype)
    LANGUAGE sql STABLE
    AS $_$
  SELECT uid, kind, props FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (n:Entity) RETURN n.uid AS uid, n.kind AS kind, properties(n) AS props$$,
    $1
  ) AS (uid text, kind text, props ag_catalog.agtype);
$_$;


ALTER FUNCTION public.entities(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: get_company_edges_params(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_company_edges_params(p ag_catalog.agtype) RETURNS TABLE(c ag_catalog.agtype, r ag_catalog.agtype, a ag_catalog.agtype)
    LANGUAGE sql STABLE
    AS $_$
  SELECT c,r,a FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (c:Company {name:$name})-[r:BUILDS]->(a:Agent) RETURN c,r,a$$,
    $1
  ) AS (c ag_catalog.agtype, r ag_catalog.agtype, a ag_catalog.agtype);
$_$;


ALTER FUNCTION public.get_company_edges_params(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: link_rel_min(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.link_rel_min(p ag_catalog.agtype) RETURNS ag_catalog.agtype
    LANGUAGE sql
    AS $_$
  SELECT r FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (a:Entity {uid:$src}), (b:Entity {uid:$dst})
      MERGE (a)-[r:REL {rel:$rel}]->(b)
      RETURN r$$,
    $1
  ) AS (r ag_catalog.agtype);
$_$;


ALTER FUNCTION public.link_rel_min(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: link_rel_props(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.link_rel_props(p ag_catalog.agtype) RETURNS ag_catalog.agtype
    LANGUAGE sql
    AS $_$
  SELECT r FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (a:Entity {uid:$src}), (b:Entity {uid:$dst})
      MERGE (a)-[r:REL {rel:$rel}]->(b)
      SET r.props = $props
      RETURN r$$,
    $1
  ) AS (r ag_catalog.agtype);
$_$;


ALTER FUNCTION public.link_rel_props(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: link_runs(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.link_runs(p ag_catalog.agtype) RETURNS integer
    LANGUAGE sql
    AS $_$
  SELECT ok FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (c:Company {name:$cname}), (p:Project {name:$pname})
      MERGE (c)-[:RUNS]->(p) RETURN 1 AS ok$$,
    $1
  ) AS (ok int);
$_$;


ALTER FUNCTION public.link_runs(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: link_workson(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.link_workson(p ag_catalog.agtype) RETURNS integer
    LANGUAGE sql
    AS $_$
  SELECT ok FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (p:Project {name:$pname})
      MERGE (a:Agent {name:$aname})
      MERGE (a)-[:WORKS_ON]->(p) RETURN 1 AS ok$$,
    $1
  ) AS (ok int);
$_$;


ALTER FUNCTION public.link_workson(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: node_type_counts(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.node_type_counts(p ag_catalog.agtype) RETURNS TABLE(lbl ag_catalog.agtype, cnt integer)
    LANGUAGE sql STABLE
    AS $_$
  SELECT lbl, cnt FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MATCH (n) RETURN label(n) AS lbl, count(n) AS cnt$$,
    $1
  ) AS (lbl ag_catalog.agtype, cnt int);
$_$;


ALTER FUNCTION public.node_type_counts(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: ts_mark_chunks_accessed(regclass, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ts_mark_chunks_accessed(p_hypertable regclass, p_start timestamp with time zone, p_end timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  r RECORD;
  n_updated int := 0;
BEGIN
  FOR r IN
    SELECT
      (quote_ident(c.chunk_schema)||'.'||quote_ident(c.chunk_name))::regclass AS chunk
    FROM timescaledb_information.chunks c
    WHERE (quote_ident(c.hypertable_schema)||'.'||quote_ident(c.hypertable_name))::regclass = p_hypertable
      AND c.range_end   > p_start
      AND c.range_start < p_end
  LOOP
    INSERT INTO ts_chunk_usage (hypertable, chunk, last_access_at, access_count)
    VALUES (p_hypertable, r.chunk, now(), 1)
    ON CONFLICT (chunk) DO UPDATE
      SET last_access_at = GREATEST(EXCLUDED.last_access_at, ts_chunk_usage.last_access_at),
          access_count   = ts_chunk_usage.access_count + 1;
    n_updated := n_updated + 1;
  END LOOP;
  RETURN n_updated;
END$$;


ALTER FUNCTION public.ts_mark_chunks_accessed(p_hypertable regclass, p_start timestamp with time zone, p_end timestamp with time zone) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ts_metric; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ts_metric (
    id bigint NOT NULL,
    ts timestamp with time zone NOT NULL,
    series text NOT NULL,
    value double precision NOT NULL
);


ALTER TABLE public.ts_metric OWNER TO postgres;

--
-- Name: ts_read_ts_metric(timestamp with time zone, timestamp with time zone, text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ts_read_ts_metric(p_start timestamp with time zone, p_end timestamp with time zone, p_series text[]) RETURNS SETOF public.ts_metric
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM ts_mark_chunks_accessed('public.ts_metric', p_start, p_end);
  RETURN QUERY
    SELECT *
    FROM ts_metric
    WHERE ts >= p_start AND ts < p_end
      AND (p_series IS NULL OR series = ANY (p_series))
    ORDER BY ts;
END$$;


ALTER FUNCTION public.ts_read_ts_metric(p_start timestamp with time zone, p_end timestamp with time zone, p_series text[]) OWNER TO postgres;

--
-- Name: ts_run_usage_policy(regclass); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ts_run_usage_policy(p_hypertable regclass) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  cfg RECORD;
  r   RECORD;
BEGIN
  SELECT * INTO cfg FROM ts_usage_policy WHERE hypertable = p_hypertable;
  IF NOT FOUND THEN
    RAISE NOTICE 'No ts_usage_policy row for %', p_hypertable;
    RETURN;
  END IF;

  -- 3a) Compress chunks older than compress_after (if not already)
  FOR r IN
    SELECT (quote_ident(c.chunk_schema)||'.'||quote_ident(c.chunk_name)) AS fqname
    FROM timescaledb_information.chunks c
    WHERE (quote_ident(c.hypertable_schema)||'.'||quote_ident(c.hypertable_name))::regclass = p_hypertable
      AND c.range_end < now() - cfg.compress_after
      AND NOT c.is_compressed
  LOOP
    PERFORM compress_chunk((r.fqname)::regclass);
  END LOOP;

  -- 3b) Drop chunks only if:
  --     - a drop horizon is set
  --     - chunk is older than that horizon
  --     - and (never accessed OR policy says drop regardless of access)
  IF cfg.drop_if_older_than IS NOT NULL THEN
    FOR r IN
      SELECT
        (quote_ident(c.chunk_schema)||'.'||quote_ident(c.chunk_name)) AS fqname,
        u.last_access_at, u.access_count
      FROM timescaledb_information.chunks c
      LEFT JOIN ts_chunk_usage u
        ON u.chunk = (quote_ident(c.chunk_schema)||'.'||quote_ident(c.chunk_name))::regclass
      WHERE (quote_ident(c.hypertable_schema)||'.'||quote_ident(c.hypertable_name))::regclass = p_hypertable
        AND c.range_end < now() - cfg.drop_if_older_than
        AND (
              (cfg.drop_only_if_never_accessed AND (u.last_access_at IS NULL OR u.access_count = 0))
              OR
              (NOT cfg.drop_only_if_never_accessed)
            )
    LOOP
      -- Use drop_chunks to safely remove by name
      PERFORM drop_chunks((r.fqname)::regclass);
    END LOOP;
  END IF;
END$$;


ALTER FUNCTION public.ts_run_usage_policy(p_hypertable regclass) OWNER TO postgres;

--
-- Name: ts_usage_policy_job(integer, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ts_usage_policy_job(job_id integer, config jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT hypertable FROM ts_usage_policy LOOP
    PERFORM ts_run_usage_policy(r.hypertable);
  END LOOP;
END$$;


ALTER FUNCTION public.ts_usage_policy_job(job_id integer, config jsonb) OWNER TO postgres;

--
-- Name: upsert_agent_edge(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.upsert_agent_edge(p ag_catalog.agtype) RETURNS ag_catalog.agtype
    LANGUAGE sql
    AS $_$
  SELECT a FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MERGE (a:Agent {name:$aname})
      WITH a
      MERGE (c:Company {name:$cname})
      MERGE (c)-[:BUILDS]->(a)
      RETURN a$$,
    $1
  ) AS (a ag_catalog.agtype);
$_$;


ALTER FUNCTION public.upsert_agent_edge(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: upsert_agent_params(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.upsert_agent_params(p ag_catalog.agtype) RETURNS ag_catalog.agtype
    LANGUAGE sql
    AS $_$
  SELECT a FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MERGE (a:Agent {name:$name}) RETURN a$$,
    $1
  ) AS (a ag_catalog.agtype);
$_$;


ALTER FUNCTION public.upsert_agent_params(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: upsert_company_params(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.upsert_company_params(p ag_catalog.agtype) RETURNS ag_catalog.agtype
    LANGUAGE sql
    AS $_$
  SELECT n FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MERGE (c:Company {name:$name}) RETURN c$$,
    $1
  ) AS (n ag_catalog.agtype);
$_$;


ALTER FUNCTION public.upsert_company_params(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: upsert_entity(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.upsert_entity(p ag_catalog.agtype) RETURNS ag_catalog.agtype
    LANGUAGE sql
    AS $_$
  SELECT n FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MERGE (n:Entity {uid:$uid}) SET n.kind = $kind RETURN n$$,
    $1
  ) AS (n ag_catalog.agtype);
$_$;


ALTER FUNCTION public.upsert_entity(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: upsert_entity_props(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.upsert_entity_props(p ag_catalog.agtype) RETURNS ag_catalog.agtype
    LANGUAGE sql
    AS $_$
  SELECT n FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MERGE (n:Entity {uid:$uid}) SET n.kind = $kind, n.props = $props RETURN n$$,
    $1
  ) AS (n ag_catalog.agtype);
$_$;


ALTER FUNCTION public.upsert_entity_props(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: upsert_project_params(ag_catalog.agtype); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.upsert_project_params(p ag_catalog.agtype) RETURNS ag_catalog.agtype
    LANGUAGE sql
    AS $_$
  SELECT p FROM ag_catalog.cypher(
    'graph_liq'::name,
    $$MERGE (p:Project {name:$name}) RETURN p$$,
    $1
  ) AS (p ag_catalog.agtype);
$_$;


ALTER FUNCTION public.upsert_project_params(p ag_catalog.agtype) OWNER TO postgres;

--
-- Name: _compressed_hypertable_3; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._compressed_hypertable_3 (
);


ALTER TABLE _timescaledb_internal._compressed_hypertable_3 OWNER TO postgres;

--
-- Name: _direct_view_4; Type: VIEW; Schema: _timescaledb_internal; Owner: postgres
--

CREATE VIEW _timescaledb_internal._direct_view_4 AS
 SELECT public.time_bucket('00:05:00'::interval, ts) AS bucket,
    series,
    avg(value) AS avg_value
   FROM public.ts_metric
  GROUP BY (public.time_bucket('00:05:00'::interval, ts)), series;


ALTER VIEW _timescaledb_internal._direct_view_4 OWNER TO postgres;

--
-- Name: _hyper_2_1_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_2_1_chunk (
    CONSTRAINT constraint_1 CHECK (((ts >= '2025-10-30 00:00:00+00'::timestamp with time zone) AND (ts < '2025-10-31 00:00:00+00'::timestamp with time zone)))
)
INHERITS (public.ts_metric);


ALTER TABLE _timescaledb_internal._hyper_2_1_chunk OWNER TO postgres;

--
-- Name: _hyper_2_2_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_2_2_chunk (
    CONSTRAINT constraint_2 CHECK (((ts >= '2025-10-29 00:00:00+00'::timestamp with time zone) AND (ts < '2025-10-30 00:00:00+00'::timestamp with time zone)))
)
INHERITS (public.ts_metric);


ALTER TABLE _timescaledb_internal._hyper_2_2_chunk OWNER TO postgres;

--
-- Name: _hyper_2_3_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_2_3_chunk (
    CONSTRAINT constraint_3 CHECK (((ts >= '2025-10-28 00:00:00+00'::timestamp with time zone) AND (ts < '2025-10-29 00:00:00+00'::timestamp with time zone)))
)
INHERITS (public.ts_metric);


ALTER TABLE _timescaledb_internal._hyper_2_3_chunk OWNER TO postgres;

--
-- Name: _materialized_hypertable_4; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._materialized_hypertable_4 (
    bucket timestamp with time zone NOT NULL,
    series text,
    avg_value double precision
);


ALTER TABLE _timescaledb_internal._materialized_hypertable_4 OWNER TO postgres;

--
-- Name: _hyper_4_4_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_4_4_chunk (
    CONSTRAINT constraint_4 CHECK (((bucket >= '2025-10-19 00:00:00+00'::timestamp with time zone) AND (bucket < '2025-10-29 00:00:00+00'::timestamp with time zone)))
)
INHERITS (_timescaledb_internal._materialized_hypertable_4);


ALTER TABLE _timescaledb_internal._hyper_4_4_chunk OWNER TO postgres;

--
-- Name: _hyper_4_5_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_4_5_chunk (
    CONSTRAINT constraint_5 CHECK (((bucket >= '2025-10-29 00:00:00+00'::timestamp with time zone) AND (bucket < '2025-11-08 00:00:00+00'::timestamp with time zone)))
)
INHERITS (_timescaledb_internal._materialized_hypertable_4);


ALTER TABLE _timescaledb_internal._hyper_4_5_chunk OWNER TO postgres;

--
-- Name: _tmp_ts; Type: TABLE; Schema: ag_catalog; Owner: postgres
--

CREATE TABLE ag_catalog._tmp_ts (
    ts timestamp with time zone NOT NULL,
    val integer NOT NULL
);


ALTER TABLE ag_catalog._tmp_ts OWNER TO postgres;

--
-- Name: _hyper_5_9_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_5_9_chunk (
    CONSTRAINT constraint_6 CHECK (((ts >= '2025-11-06 00:00:00+00'::timestamp with time zone) AND (ts < '2025-11-13 00:00:00+00'::timestamp with time zone)))
)
INHERITS (ag_catalog._tmp_ts);


ALTER TABLE _timescaledb_internal._hyper_5_9_chunk OWNER TO postgres;

--
-- Name: _partial_view_4; Type: VIEW; Schema: _timescaledb_internal; Owner: postgres
--

CREATE VIEW _timescaledb_internal._partial_view_4 AS
 SELECT public.time_bucket('00:05:00'::interval, ts) AS bucket,
    series,
    avg(value) AS avg_value
   FROM public.ts_metric
  GROUP BY (public.time_bucket('00:05:00'::interval, ts)), series;


ALTER VIEW _timescaledb_internal._partial_view_4 OWNER TO postgres;

--
-- Name: compress_hyper_3_6_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal.compress_hyper_3_6_chunk (
    _ts_meta_count integer,
    series text,
    _ts_meta_v2_min_id bigint,
    _ts_meta_v2_max_id bigint,
    id _timescaledb_internal.compressed_data,
    _ts_meta_min_1 timestamp with time zone,
    _ts_meta_max_1 timestamp with time zone,
    ts _timescaledb_internal.compressed_data,
    value _timescaledb_internal.compressed_data
)
WITH (toast_tuple_target='128');
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN _ts_meta_count SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN series SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN _ts_meta_v2_min_id SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN _ts_meta_v2_max_id SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN id SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN _ts_meta_min_1 SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN _ts_meta_max_1 SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN ts SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_6_chunk ALTER COLUMN value SET STATISTICS 0;


ALTER TABLE _timescaledb_internal.compress_hyper_3_6_chunk OWNER TO postgres;

--
-- Name: compress_hyper_3_7_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal.compress_hyper_3_7_chunk (
    _ts_meta_count integer,
    series text,
    _ts_meta_v2_min_id bigint,
    _ts_meta_v2_max_id bigint,
    id _timescaledb_internal.compressed_data,
    _ts_meta_min_1 timestamp with time zone,
    _ts_meta_max_1 timestamp with time zone,
    ts _timescaledb_internal.compressed_data,
    value _timescaledb_internal.compressed_data
)
WITH (toast_tuple_target='128');
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN _ts_meta_count SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN series SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN _ts_meta_v2_min_id SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN _ts_meta_v2_max_id SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN id SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN _ts_meta_min_1 SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN _ts_meta_max_1 SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN ts SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_7_chunk ALTER COLUMN value SET STATISTICS 0;


ALTER TABLE _timescaledb_internal.compress_hyper_3_7_chunk OWNER TO postgres;

--
-- Name: compress_hyper_3_8_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal.compress_hyper_3_8_chunk (
    _ts_meta_count integer,
    series text,
    _ts_meta_v2_min_id bigint,
    _ts_meta_v2_max_id bigint,
    id _timescaledb_internal.compressed_data,
    _ts_meta_min_1 timestamp with time zone,
    _ts_meta_max_1 timestamp with time zone,
    ts _timescaledb_internal.compressed_data,
    value _timescaledb_internal.compressed_data
)
WITH (toast_tuple_target='128');
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN _ts_meta_count SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN series SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN _ts_meta_v2_min_id SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN _ts_meta_v2_max_id SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN id SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN _ts_meta_min_1 SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN _ts_meta_max_1 SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN ts SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_3_8_chunk ALTER COLUMN value SET STATISTICS 0;


ALTER TABLE _timescaledb_internal.compress_hyper_3_8_chunk OWNER TO postgres;

--
-- Name: _tmp_vec; Type: TABLE; Schema: ag_catalog; Owner: postgres
--

CREATE TABLE ag_catalog._tmp_vec (
    id integer NOT NULL,
    emb public.vector(4)
);


ALTER TABLE ag_catalog._tmp_vec OWNER TO postgres;

--
-- Name: rag_chunks; Type: TABLE; Schema: ag_catalog; Owner: postgres
--

CREATE TABLE ag_catalog.rag_chunks (
    id bigint NOT NULL,
    doc_id text,
    chunk text NOT NULL,
    src text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE ag_catalog.rag_chunks OWNER TO postgres;

--
-- Name: rag_chunks_id_seq; Type: SEQUENCE; Schema: ag_catalog; Owner: postgres
--

CREATE SEQUENCE ag_catalog.rag_chunks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE ag_catalog.rag_chunks_id_seq OWNER TO postgres;

--
-- Name: rag_chunks_id_seq; Type: SEQUENCE OWNED BY; Schema: ag_catalog; Owner: postgres
--

ALTER SEQUENCE ag_catalog.rag_chunks_id_seq OWNED BY ag_catalog.rag_chunks.id;


--
-- Name: rag_chunks_pk; Type: VIEW; Schema: ag_catalog; Owner: postgres
--

CREATE VIEW ag_catalog.rag_chunks_pk AS
 SELECT id AS chunk_id,
    doc_id,
    src,
    chunk,
    created_at
   FROM ag_catalog.rag_chunks c;


ALTER VIEW ag_catalog.rag_chunks_pk OWNER TO postgres;

--
-- Name: rag_docs; Type: VIEW; Schema: ag_catalog; Owner: postgres
--

CREATE VIEW ag_catalog.rag_docs AS
 SELECT chunk_id,
    doc_id,
    src,
    chunk,
    created_at AS chunk_created_at
   FROM ag_catalog.rag_chunks_pk;


ALTER VIEW ag_catalog.rag_docs OWNER TO postgres;

--
-- Name: rag_embeddings; Type: TABLE; Schema: ag_catalog; Owner: postgres
--

CREATE TABLE ag_catalog.rag_embeddings (
    chunk_id bigint NOT NULL,
    emb public.vector(1536),
    model text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    emb_unit public.vector(1536),
    emb_mag public.vector(1536),
    volume real,
    confidence real,
    updated_at timestamp with time zone,
    scale real
);


ALTER TABLE ag_catalog.rag_embeddings OWNER TO postgres;

--
-- Name: _ag_label_vertex; Type: TABLE; Schema: graph_liq; Owner: postgres
--

CREATE TABLE graph_liq._ag_label_vertex (
    id ag_catalog.graphid NOT NULL,
    properties ag_catalog.agtype DEFAULT ag_catalog.agtype_build_map() NOT NULL
);


ALTER TABLE graph_liq._ag_label_vertex OWNER TO postgres;

--
-- Name: Entity; Type: TABLE; Schema: graph_liq; Owner: postgres
--

CREATE TABLE graph_liq."Entity" (
)
INHERITS (graph_liq._ag_label_vertex);


ALTER TABLE graph_liq."Entity" OWNER TO postgres;

--
-- Name: Entity_id_seq; Type: SEQUENCE; Schema: graph_liq; Owner: postgres
--

CREATE SEQUENCE graph_liq."Entity_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


ALTER SEQUENCE graph_liq."Entity_id_seq" OWNER TO postgres;

--
-- Name: Entity_id_seq; Type: SEQUENCE OWNED BY; Schema: graph_liq; Owner: postgres
--

ALTER SEQUENCE graph_liq."Entity_id_seq" OWNED BY graph_liq."Entity".id;


--
-- Name: _ag_label_edge; Type: TABLE; Schema: graph_liq; Owner: postgres
--

CREATE TABLE graph_liq._ag_label_edge (
    id ag_catalog.graphid NOT NULL,
    start_id ag_catalog.graphid NOT NULL,
    end_id ag_catalog.graphid NOT NULL,
    properties ag_catalog.agtype DEFAULT ag_catalog.agtype_build_map() NOT NULL
);


ALTER TABLE graph_liq._ag_label_edge OWNER TO postgres;

--
-- Name: REL; Type: TABLE; Schema: graph_liq; Owner: postgres
--

CREATE TABLE graph_liq."REL" (
)
INHERITS (graph_liq._ag_label_edge);


ALTER TABLE graph_liq."REL" OWNER TO postgres;

--
-- Name: REL_id_seq; Type: SEQUENCE; Schema: graph_liq; Owner: postgres
--

CREATE SEQUENCE graph_liq."REL_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


ALTER SEQUENCE graph_liq."REL_id_seq" OWNER TO postgres;

--
-- Name: REL_id_seq; Type: SEQUENCE OWNED BY; Schema: graph_liq; Owner: postgres
--

ALTER SEQUENCE graph_liq."REL_id_seq" OWNED BY graph_liq."REL".id;


--
-- Name: _ag_label_edge_id_seq; Type: SEQUENCE; Schema: graph_liq; Owner: postgres
--

CREATE SEQUENCE graph_liq._ag_label_edge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


ALTER SEQUENCE graph_liq._ag_label_edge_id_seq OWNER TO postgres;

--
-- Name: _ag_label_edge_id_seq; Type: SEQUENCE OWNED BY; Schema: graph_liq; Owner: postgres
--

ALTER SEQUENCE graph_liq._ag_label_edge_id_seq OWNED BY graph_liq._ag_label_edge.id;


--
-- Name: _ag_label_vertex_id_seq; Type: SEQUENCE; Schema: graph_liq; Owner: postgres
--

CREATE SEQUENCE graph_liq._ag_label_vertex_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 281474976710655
    CACHE 1;


ALTER SEQUENCE graph_liq._ag_label_vertex_id_seq OWNER TO postgres;

--
-- Name: _ag_label_vertex_id_seq; Type: SEQUENCE OWNED BY; Schema: graph_liq; Owner: postgres
--

ALTER SEQUENCE graph_liq._ag_label_vertex_id_seq OWNED BY graph_liq._ag_label_vertex.id;


--
-- Name: _label_id_seq; Type: SEQUENCE; Schema: graph_liq; Owner: postgres
--

CREATE SEQUENCE graph_liq._label_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    MAXVALUE 65535
    CACHE 1
    CYCLE;


ALTER SEQUENCE graph_liq._label_id_seq OWNER TO postgres;

--
-- Name: ai_embed; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_embed (
    id bigint NOT NULL,
    label text,
    emb public.vector(384)
);


ALTER TABLE public.ai_embed OWNER TO postgres;

--
-- Name: ai_embed_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ai_embed_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ai_embed_id_seq OWNER TO postgres;

--
-- Name: ai_embed_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ai_embed_id_seq OWNED BY public.ai_embed.id;


--
-- Name: geo_place; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.geo_place (
    id bigint NOT NULL,
    name text NOT NULL,
    geom public.geometry(Point,4326) NOT NULL
);


ALTER TABLE public.geo_place OWNER TO postgres;

--
-- Name: geo_place_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.geo_place_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.geo_place_id_seq OWNER TO postgres;

--
-- Name: geo_place_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.geo_place_id_seq OWNED BY public.geo_place.id;


--
-- Name: mv_gap_scores; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.mv_gap_scores AS
 WITH es AS (
         SELECT cypher.src_uid,
            cypher.rel,
            cypher.dst_uid
           FROM ag_catalog.cypher('graph_liq'::name, '
    MATCH (a:Entity)-[r:REL]->(b:Entity)
    RETURN a.uid AS src_uid, r.rel AS rel, b.uid AS dst_uid
  '::cstring) cypher(src_uid text, rel text, dst_uid text)
        ), deg AS (
         SELECT x.uid,
            count(*) FILTER (WHERE (x.dir = 'out'::text)) AS out_edges,
            count(*) FILTER (WHERE (x.dir = 'in'::text)) AS in_edges,
            count(DISTINCT x.rel) FILTER (WHERE (x.dir = 'out'::text)) AS uniq_out_rels,
            count(DISTINCT x.rel) FILTER (WHERE (x.dir = 'in'::text)) AS uniq_in_rels
           FROM ( SELECT es.src_uid AS uid,
                    'out'::text AS dir,
                    es.rel
                   FROM es
                UNION ALL
                 SELECT es.dst_uid AS uid,
                    'in'::text AS dir,
                    es.rel
                   FROM es) x
          GROUP BY x.uid
        ), scored AS (
         SELECT deg.uid,
            COALESCE(deg.out_edges, (0)::bigint) AS out_edges,
            COALESCE(deg.in_edges, (0)::bigint) AS in_edges,
            COALESCE(deg.uniq_out_rels, (0)::bigint) AS uniq_out_rels,
            COALESCE(deg.uniq_in_rels, (0)::bigint) AS uniq_in_rels,
            (COALESCE(deg.out_edges, (0)::bigint) + COALESCE(deg.in_edges, (0)::bigint)) AS total_edges,
            (COALESCE(deg.uniq_out_rels, (0)::bigint) + COALESCE(deg.uniq_in_rels, (0)::bigint)) AS rel_diversity
           FROM deg
        )
 SELECT uid,
    out_edges,
    in_edges,
    total_edges,
    uniq_out_rels,
    uniq_in_rels,
    rel_diversity,
    ((((10)::double precision - LEAST((10)::double precision, ceil(log(((1 + total_edges))::double precision)))) + (
        CASE
            WHEN (rel_diversity <= 1) THEN 3
            ELSE 0
        END)::double precision))::integer AS gap_score
   FROM scored
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.mv_gap_scores OWNER TO postgres;

--
-- Name: ts_chunk_usage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ts_chunk_usage (
    hypertable regclass NOT NULL,
    chunk regclass NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_access_at timestamp with time zone,
    access_count bigint DEFAULT 0 NOT NULL
);


ALTER TABLE public.ts_chunk_usage OWNER TO postgres;

--
-- Name: ts_chunks_with_usage; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.ts_chunks_with_usage AS
 SELECT c.hypertable_schema,
    c.hypertable_name,
    (((quote_ident((c.chunk_schema)::text) || '.'::text) || quote_ident((c.chunk_name)::text)))::regclass AS chunk,
    c.range_start,
    c.range_end,
    c.is_compressed,
    u.last_access_at,
    u.access_count
   FROM (timescaledb_information.chunks c
     LEFT JOIN public.ts_chunk_usage u ON (((u.chunk)::oid = ((((quote_ident((c.chunk_schema)::text) || '.'::text) || quote_ident((c.chunk_name)::text)))::regclass)::oid)));


ALTER VIEW public.ts_chunks_with_usage OWNER TO postgres;

--
-- Name: ts_metric_5m; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.ts_metric_5m AS
 SELECT bucket,
    series,
    avg_value
   FROM _timescaledb_internal._materialized_hypertable_4;


ALTER VIEW public.ts_metric_5m OWNER TO postgres;

--
-- Name: ts_metric_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ts_metric_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ts_metric_id_seq OWNER TO postgres;

--
-- Name: ts_metric_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ts_metric_id_seq OWNED BY public.ts_metric.id;


--
-- Name: ts_usage_policy; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ts_usage_policy (
    hypertable regclass NOT NULL,
    compress_after interval DEFAULT '7 days'::interval NOT NULL,
    drop_if_older_than interval,
    drop_only_if_never_accessed boolean DEFAULT true NOT NULL
);


ALTER TABLE public.ts_usage_policy OWNER TO postgres;

--
-- Name: v_edges; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_edges AS
 SELECT src_uid,
    rel,
    dst_uid
   FROM ( SELECT (_.src_uid)::text AS src_uid,
            (_.rel)::text AS rel,
            (_.dst_uid)::text AS dst_uid
           FROM ( SELECT ag_catalog.agtype_access_operator(VARIADIC ARRAY[_age_default_alias_previous_cypher_clause.a, '"uid"'::ag_catalog.agtype]) AS src_uid,
                    ag_catalog.agtype_access_operator(VARIADIC ARRAY[_age_default_alias_previous_cypher_clause.r, '"rel"'::ag_catalog.agtype]) AS rel,
                    ag_catalog.agtype_access_operator(VARIADIC ARRAY[_age_default_alias_previous_cypher_clause.b, '"uid"'::ag_catalog.agtype]) AS dst_uid
                   FROM ( SELECT ag_catalog._agtype_build_vertex(a.id, ag_catalog._label_name('83127'::oid, a.id), a.properties) AS a,
                            ag_catalog._agtype_build_edge(r.id, r.start_id, r.end_id, ag_catalog._label_name('83127'::oid, r.id), r.properties) AS r,
                            ag_catalog._agtype_build_vertex(b.id, ag_catalog._label_name('83127'::oid, b.id), b.properties) AS b
                           FROM graph_liq."Entity" a,
                            graph_liq."REL" r,
                            graph_liq."Entity" b
                          WHERE ((r.start_id OPERATOR(ag_catalog.=) a.id) AND (r.end_id OPERATOR(ag_catalog.=) b.id))) _age_default_alias_previous_cypher_clause) _) cypher;


ALTER VIEW public.v_edges OWNER TO postgres;

--
-- Name: v_entities; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_entities AS
 SELECT uid,
    kind,
    props
   FROM public.entities(NULL::ag_catalog.agtype) entities(uid, kind, props);


ALTER VIEW public.v_entities OWNER TO postgres;

--
-- Name: v_gap_scores; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_gap_scores AS
 WITH es AS (
         SELECT cypher.src,
            cypher.rel,
            cypher.dst
           FROM ( SELECT (_.src)::text AS src,
                    (_.rel)::text AS rel,
                    (_.dst)::text AS dst
                   FROM ( SELECT ag_catalog.agtype_access_operator(VARIADIC ARRAY[_age_default_alias_previous_cypher_clause.a, '"uid"'::ag_catalog.agtype]) AS src,
                            ag_catalog.agtype_access_operator(VARIADIC ARRAY[_age_default_alias_previous_cypher_clause.r, '"rel"'::ag_catalog.agtype]) AS rel,
                            ag_catalog.agtype_access_operator(VARIADIC ARRAY[_age_default_alias_previous_cypher_clause.b, '"uid"'::ag_catalog.agtype]) AS dst
                           FROM ( SELECT ag_catalog._agtype_build_vertex(a.id, ag_catalog._label_name('83127'::oid, a.id), a.properties) AS a,
                                    ag_catalog._agtype_build_edge(r.id, r.start_id, r.end_id, ag_catalog._label_name('83127'::oid, r.id), r.properties) AS r,
                                    ag_catalog._agtype_build_vertex(b.id, ag_catalog._label_name('83127'::oid, b.id), b.properties) AS b
                                   FROM graph_liq."Entity" a,
                                    graph_liq."REL" r,
                                    graph_liq."Entity" b
                                  WHERE ((r.start_id OPERATOR(ag_catalog.=) a.id) AND (r.end_id OPERATOR(ag_catalog.=) b.id))) _age_default_alias_previous_cypher_clause) _) cypher
        ), deg AS (
         SELECT x.uid,
            count(*) FILTER (WHERE (x.dir = 'out'::text)) AS out_e,
            count(*) FILTER (WHERE (x.dir = 'in'::text)) AS in_e,
            count(DISTINCT x.rel) FILTER (WHERE (x.dir = 'out'::text)) AS uo,
            count(DISTINCT x.rel) FILTER (WHERE (x.dir = 'in'::text)) AS ui
           FROM ( SELECT es.src AS uid,
                    'out'::text AS dir,
                    es.rel
                   FROM es
                UNION ALL
                 SELECT es.dst AS uid,
                    'in'::text AS dir,
                    es.rel
                   FROM es) x
          GROUP BY x.uid
        )
 SELECT uid,
    out_e AS out_edges,
    in_e AS in_edges,
    (out_e + in_e) AS total_edges,
    uo AS uniq_out_rels,
    ui AS uniq_in_rels,
    (uo + ui) AS rel_diversity,
    ((((10)::double precision - LEAST((10)::double precision, ceil(log(((1 + (out_e + in_e)))::double precision)))) + (
        CASE
            WHEN ((uo + ui) <= 1) THEN 3
            ELSE 0
        END)::double precision))::integer AS gap_score
   FROM deg;


ALTER VIEW public.v_gap_scores OWNER TO postgres;

--
-- Name: v_nodes; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_nodes AS
 SELECT uid
   FROM ( SELECT (_.uid)::text AS uid
           FROM ( SELECT ag_catalog.agtype_access_operator(VARIADIC ARRAY[_age_default_alias_previous_cypher_clause.n, '"uid"'::ag_catalog.agtype]) AS uid
                   FROM ( SELECT ag_catalog._agtype_build_vertex(n.id, ag_catalog._label_name('83127'::oid, n.id), n.properties) AS n
                           FROM graph_liq."Entity" n) _age_default_alias_previous_cypher_clause) _) cypher;


ALTER VIEW public.v_nodes OWNER TO postgres;

--
-- Name: _hyper_2_1_chunk id; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_2_1_chunk ALTER COLUMN id SET DEFAULT nextval('public.ts_metric_id_seq'::regclass);


--
-- Name: _hyper_2_2_chunk id; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_2_2_chunk ALTER COLUMN id SET DEFAULT nextval('public.ts_metric_id_seq'::regclass);


--
-- Name: _hyper_2_3_chunk id; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_2_3_chunk ALTER COLUMN id SET DEFAULT nextval('public.ts_metric_id_seq'::regclass);


--
-- Name: rag_chunks id; Type: DEFAULT; Schema: ag_catalog; Owner: postgres
--

ALTER TABLE ONLY ag_catalog.rag_chunks ALTER COLUMN id SET DEFAULT nextval('ag_catalog.rag_chunks_id_seq'::regclass);


--
-- Name: Entity id; Type: DEFAULT; Schema: graph_liq; Owner: postgres
--

ALTER TABLE ONLY graph_liq."Entity" ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('graph_liq'::name, 'Entity'::name))::integer, nextval('graph_liq."Entity_id_seq"'::regclass));


--
-- Name: Entity properties; Type: DEFAULT; Schema: graph_liq; Owner: postgres
--

ALTER TABLE ONLY graph_liq."Entity" ALTER COLUMN properties SET DEFAULT ag_catalog.agtype_build_map();


--
-- Name: REL id; Type: DEFAULT; Schema: graph_liq; Owner: postgres
--

ALTER TABLE ONLY graph_liq."REL" ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('graph_liq'::name, 'REL'::name))::integer, nextval('graph_liq."REL_id_seq"'::regclass));


--
-- Name: REL properties; Type: DEFAULT; Schema: graph_liq; Owner: postgres
--

ALTER TABLE ONLY graph_liq."REL" ALTER COLUMN properties SET DEFAULT ag_catalog.agtype_build_map();


--
-- Name: _ag_label_edge id; Type: DEFAULT; Schema: graph_liq; Owner: postgres
--

ALTER TABLE ONLY graph_liq._ag_label_edge ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('graph_liq'::name, '_ag_label_edge'::name))::integer, nextval('graph_liq._ag_label_edge_id_seq'::regclass));


--
-- Name: _ag_label_vertex id; Type: DEFAULT; Schema: graph_liq; Owner: postgres
--

ALTER TABLE ONLY graph_liq._ag_label_vertex ALTER COLUMN id SET DEFAULT ag_catalog._graphid((ag_catalog._label_id('graph_liq'::name, '_ag_label_vertex'::name))::integer, nextval('graph_liq._ag_label_vertex_id_seq'::regclass));


--
-- Name: ai_embed id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_embed ALTER COLUMN id SET DEFAULT nextval('public.ai_embed_id_seq'::regclass);


--
-- Name: geo_place id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.geo_place ALTER COLUMN id SET DEFAULT nextval('public.geo_place_id_seq'::regclass);


--
-- Name: ts_metric id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ts_metric ALTER COLUMN id SET DEFAULT nextval('public.ts_metric_id_seq'::regclass);


--
-- Data for Name: hypertable; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.hypertable (id, schema_name, table_name, associated_schema_name, associated_table_prefix, num_dimensions, chunk_sizing_func_schema, chunk_sizing_func_name, chunk_target_size, compression_state, compressed_hypertable_id, status) FROM stdin;
3	_timescaledb_internal	_compressed_hypertable_3	_timescaledb_internal	_hyper_3	0	_timescaledb_functions	calculate_chunk_interval	0	2	\N	0
2	public	ts_metric	_timescaledb_internal	_hyper_2	1	_timescaledb_functions	calculate_chunk_interval	0	1	3	0
4	_timescaledb_internal	_materialized_hypertable_4	_timescaledb_internal	_hyper_4	1	_timescaledb_functions	calculate_chunk_interval	0	0	\N	0
5	ag_catalog	_tmp_ts	_timescaledb_internal	_hyper_5	1	_timescaledb_functions	calculate_chunk_interval	0	0	\N	0
\.


--
-- Data for Name: chunk; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.chunk (id, hypertable_id, schema_name, table_name, compressed_chunk_id, dropped, status, osm_chunk, creation_time) FROM stdin;
4	4	_timescaledb_internal	_hyper_4_4_chunk	\N	f	0	f	2025-10-30 04:05:39.439662+00
5	4	_timescaledb_internal	_hyper_4_5_chunk	\N	f	0	f	2025-10-30 04:05:39.477716+00
6	3	_timescaledb_internal	compress_hyper_3_6_chunk	\N	f	0	f	2025-11-05 08:09:12.784042+00
3	2	_timescaledb_internal	_hyper_2_3_chunk	6	f	1	f	2025-10-30 02:16:11.132911+00
7	3	_timescaledb_internal	compress_hyper_3_7_chunk	\N	f	0	f	2025-11-06 08:09:17.853012+00
2	2	_timescaledb_internal	_hyper_2_2_chunk	7	f	1	f	2025-10-30 02:16:11.040508+00
8	3	_timescaledb_internal	compress_hyper_3_8_chunk	\N	f	0	f	2025-11-07 11:17:47.751463+00
1	2	_timescaledb_internal	_hyper_2_1_chunk	8	f	1	f	2025-10-30 02:16:10.820392+00
9	5	_timescaledb_internal	_hyper_5_9_chunk	\N	f	0	f	2025-11-10 02:32:57.694816+00
\.


--
-- Data for Name: chunk_column_stats; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.chunk_column_stats (id, hypertable_id, chunk_id, column_name, range_start, range_end, valid) FROM stdin;
\.


--
-- Data for Name: dimension; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.dimension (id, hypertable_id, column_name, column_type, aligned, num_slices, partitioning_func_schema, partitioning_func, interval_length, compress_interval_length, integer_now_func_schema, integer_now_func) FROM stdin;
2	2	ts	timestamp with time zone	t	\N	\N	\N	86400000000	\N	\N	\N
3	4	bucket	timestamp with time zone	t	\N	\N	\N	864000000000	\N	\N	\N
4	5	ts	timestamp with time zone	t	\N	\N	\N	604800000000	\N	\N	\N
\.


--
-- Data for Name: dimension_slice; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.dimension_slice (id, dimension_id, range_start, range_end) FROM stdin;
1	2	1761782400000000	1761868800000000
2	2	1761696000000000	1761782400000000
3	2	1761609600000000	1761696000000000
4	3	1760832000000000	1761696000000000
5	3	1761696000000000	1762560000000000
6	4	1762387200000000	1762992000000000
\.


--
-- Data for Name: chunk_constraint; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.chunk_constraint (chunk_id, dimension_slice_id, constraint_name, hypertable_constraint_name) FROM stdin;
1	1	constraint_1	\N
1	\N	1_1_ts_metric_pkey	ts_metric_pkey
2	2	constraint_2	\N
2	\N	2_2_ts_metric_pkey	ts_metric_pkey
3	3	constraint_3	\N
3	\N	3_3_ts_metric_pkey	ts_metric_pkey
4	4	constraint_4	\N
5	5	constraint_5	\N
9	6	constraint_6	\N
\.


--
-- Data for Name: chunk_index; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.chunk_index (chunk_id, index_name, hypertable_id, hypertable_index_name) FROM stdin;
1	1_1_ts_metric_pkey	2	ts_metric_pkey
1	_hyper_2_1_chunk_ts_metric_ts_idx	2	ts_metric_ts_idx
1	_hyper_2_1_chunk_ts_metric_series_ts_idx	2	ts_metric_series_ts_idx
1	_hyper_2_1_chunk_ts_metric_ts_brin	2	ts_metric_ts_brin
2	2_2_ts_metric_pkey	2	ts_metric_pkey
2	_hyper_2_2_chunk_ts_metric_ts_idx	2	ts_metric_ts_idx
2	_hyper_2_2_chunk_ts_metric_series_ts_idx	2	ts_metric_series_ts_idx
2	_hyper_2_2_chunk_ts_metric_ts_brin	2	ts_metric_ts_brin
3	3_3_ts_metric_pkey	2	ts_metric_pkey
3	_hyper_2_3_chunk_ts_metric_ts_idx	2	ts_metric_ts_idx
3	_hyper_2_3_chunk_ts_metric_series_ts_idx	2	ts_metric_series_ts_idx
3	_hyper_2_3_chunk_ts_metric_ts_brin	2	ts_metric_ts_brin
4	_hyper_4_4_chunk__materialized_hypertable_4_bucket_idx	4	_materialized_hypertable_4_bucket_idx
4	_hyper_4_4_chunk__materialized_hypertable_4_series_bucket_idx	4	_materialized_hypertable_4_series_bucket_idx
5	_hyper_4_5_chunk__materialized_hypertable_4_bucket_idx	4	_materialized_hypertable_4_bucket_idx
5	_hyper_4_5_chunk__materialized_hypertable_4_series_bucket_idx	4	_materialized_hypertable_4_series_bucket_idx
9	_hyper_5_9_chunk__tmp_ts_ts_idx	5	_tmp_ts_ts_idx
\.


--
-- Data for Name: compression_chunk_size; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.compression_chunk_size (chunk_id, compressed_chunk_id, uncompressed_heap_size, uncompressed_toast_size, uncompressed_index_size, compressed_heap_size, compressed_toast_size, compressed_index_size, numrows_pre_compression, numrows_post_compression, numrows_frozen_immediately) FROM stdin;
3	6	196608	8192	393216	16384	73728	16384	2608	4	4
2	7	425984	8192	827392	16384	139264	16384	6465	8	8
1	8	90112	8192	237568	16384	65536	16384	1012	3	3
\.


--
-- Data for Name: compression_settings; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.compression_settings (relid, segmentby, orderby, orderby_desc, orderby_nullsfirst) FROM stdin;
public.ts_metric	{series}	{ts}	{t}	{t}
_timescaledb_internal.compress_hyper_3_6_chunk	{series}	{ts}	{t}	{t}
_timescaledb_internal.compress_hyper_3_7_chunk	{series}	{ts}	{t}	{t}
_timescaledb_internal.compress_hyper_3_8_chunk	{series}	{ts}	{t}	{t}
\.


--
-- Data for Name: continuous_agg; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.continuous_agg (mat_hypertable_id, raw_hypertable_id, parent_mat_hypertable_id, user_view_schema, user_view_name, partial_view_schema, partial_view_name, direct_view_schema, direct_view_name, materialized_only, finalized) FROM stdin;
4	2	\N	public	ts_metric_5m	_timescaledb_internal	_partial_view_4	_timescaledb_internal	_direct_view_4	t	t
\.


--
-- Data for Name: continuous_agg_migrate_plan; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.continuous_agg_migrate_plan (mat_hypertable_id, start_ts, end_ts, user_view_definition) FROM stdin;
\.


--
-- Data for Name: continuous_agg_migrate_plan_step; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.continuous_agg_migrate_plan_step (mat_hypertable_id, step_id, status, start_ts, end_ts, type, config) FROM stdin;
\.


--
-- Data for Name: continuous_aggs_bucket_function; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.continuous_aggs_bucket_function (mat_hypertable_id, bucket_func, bucket_width, bucket_origin, bucket_offset, bucket_timezone, bucket_fixed_width) FROM stdin;
4	public.time_bucket(interval,timestamp with time zone)	00:05:00	\N	\N	\N	t
\.


--
-- Data for Name: continuous_aggs_hypertable_invalidation_log; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.continuous_aggs_hypertable_invalidation_log (hypertable_id, lowest_modified_value, greatest_modified_value) FROM stdin;
\.


--
-- Data for Name: continuous_aggs_invalidation_threshold; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.continuous_aggs_invalidation_threshold (hypertable_id, watermark) FROM stdin;
2	1763153100000000
\.


--
-- Data for Name: continuous_aggs_materialization_invalidation_log; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.continuous_aggs_materialization_invalidation_log (materialization_id, lowest_modified_value, greatest_modified_value) FROM stdin;
4	-9223372036854775808	-210866803200000001
4	1763153100000000	9223372036854775807
\.


--
-- Data for Name: continuous_aggs_watermark; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.continuous_aggs_watermark (mat_hypertable_id, watermark) FROM stdin;
4	1761797400000000
\.


--
-- Data for Name: metadata; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.metadata (key, value, include_in_telemetry) FROM stdin;
install_timestamp	2025-10-30 01:23:09.565075+00	t
timescaledb_version	2.17.2	f
exported_uuid	3e7796ae-f525-42e9-a118-23e815ad5571	t
\.


--
-- Data for Name: tablespace; Type: TABLE DATA; Schema: _timescaledb_catalog; Owner: postgres
--

COPY _timescaledb_catalog.tablespace (id, hypertable_id, tablespace_name) FROM stdin;
\.


--
-- Data for Name: bgw_job; Type: TABLE DATA; Schema: _timescaledb_config; Owner: postgres
--

COPY _timescaledb_config.bgw_job (id, application_name, schedule_interval, max_runtime, max_retries, retry_period, proc_schema, proc_name, owner, scheduled, fixed_schedule, initial_start, hypertable_id, config, check_schema, check_name, timezone) FROM stdin;
1000	Compression Policy [1000]	12:00:00	00:00:00	-1	01:00:00	_timescaledb_functions	policy_compression	postgres	t	f	\N	2	{"hypertable_id": 2, "compress_after": "7 days"}	_timescaledb_functions	policy_compression_check	\N
1001	Retention Policy [1001]	1 day	00:05:00	-1	00:05:00	_timescaledb_functions	policy_retention	postgres	t	f	\N	2	{"drop_after": "90 days", "hypertable_id": 2}	_timescaledb_functions	policy_retention_check	\N
1002	Refresh Continuous Aggregate Policy [1002]	00:05:00	00:00:00	-1	00:05:00	_timescaledb_functions	policy_refresh_continuous_aggregate	postgres	t	f	\N	4	{"end_offset": "00:05:00", "start_offset": "30 days", "mat_hypertable_id": 4}	_timescaledb_functions	policy_refresh_continuous_aggregate_check	\N
\.


--
-- Data for Name: _compressed_hypertable_3; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal._compressed_hypertable_3  FROM stdin;
\.


--
-- Data for Name: _hyper_2_1_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal._hyper_2_1_chunk (id, ts, series, value) FROM stdin;
\.


--
-- Data for Name: _hyper_2_2_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal._hyper_2_2_chunk (id, ts, series, value) FROM stdin;
\.


--
-- Data for Name: _hyper_2_3_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal._hyper_2_3_chunk (id, ts, series, value) FROM stdin;
\.


--
-- Data for Name: _hyper_4_4_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal._hyper_4_4_chunk (bucket, series, avg_value) FROM stdin;
2025-10-28 23:35:00+00	alpha	42.4946739266354
2025-10-28 02:50:00+00	beta	71.1902928450572
2025-10-28 18:00:00+00	alpha	75.76393316138368
2025-10-28 14:50:00+00	alpha	50.62433786704681
2025-10-28 06:25:00+00	beta	43.32082713417504
2025-10-28 10:20:00+00	beta	39.16528108242793
2025-10-28 23:20:00+00	beta	59.1909029205317
2025-10-28 05:15:00+00	beta	47.09644093150712
2025-10-28 07:40:00+00	beta	56.387834989929615
2025-10-28 15:30:00+00	beta	24.876773822042317
2025-10-28 19:00:00+00	beta	57.743602644962195
2025-10-28 17:25:00+00	alpha	56.65575120985081
2025-10-28 15:10:00+00	beta	51.997914221297414
2025-10-28 19:00:00+00	alpha	50.02805608834932
2025-10-28 16:35:00+00	alpha	56.60391059011455
2025-10-28 08:30:00+00	beta	39.600659730717624
2025-10-28 06:45:00+00	beta	75.15210659300394
2025-10-28 06:40:00+00	alpha	40.24113631488889
2025-10-28 07:45:00+00	beta	47.36025527545151
2025-10-28 13:20:00+00	beta	45.3225557565395
2025-10-28 05:15:00+00	alpha	61.902094241240796
2025-10-28 18:35:00+00	alpha	59.33941928564127
2025-10-28 20:50:00+00	beta	60.6945142331282
2025-10-28 12:55:00+00	beta	68.31062216678228
2025-10-28 18:25:00+00	alpha	63.05483179848473
2025-10-28 22:20:00+00	beta	59.63309056330411
2025-10-28 20:05:00+00	beta	55.687934800225705
2025-10-28 22:50:00+00	alpha	52.028714566538895
2025-10-28 22:00:00+00	beta	44.378660698294915
2025-10-28 23:55:00+00	alpha	40.324524434352796
2025-10-28 09:45:00+00	alpha	32.381887091891215
2025-10-28 06:05:00+00	beta	52.11739767739921
2025-10-28 09:40:00+00	alpha	43.41028123822129
2025-10-28 07:35:00+00	alpha	40.80165165546915
2025-10-28 03:20:00+00	alpha	49.30743493548563
2025-10-28 06:55:00+00	alpha	57.472371646148055
2025-10-28 11:05:00+00	alpha	58.201556697039074
2025-10-28 02:55:00+00	beta	60.32985833305403
2025-10-28 19:45:00+00	alpha	56.4484624726703
2025-10-28 06:35:00+00	alpha	23.19008135295415
2025-10-28 08:40:00+00	beta	35.08885163533213
2025-10-28 19:40:00+00	beta	48.08516479767339
2025-10-28 18:10:00+00	alpha	62.784376210953155
2025-10-28 04:05:00+00	beta	57.804750152588625
2025-10-28 22:50:00+00	beta	55.28350465340528
2025-10-28 16:10:00+00	alpha	52.161859700197
2025-10-28 18:15:00+00	alpha	59.327844268938804
2025-10-28 17:55:00+00	alpha	25.335451260568092
2025-10-28 07:50:00+00	alpha	78.71423116042644
2025-10-28 11:25:00+00	alpha	55.77258312856287
2025-10-28 14:35:00+00	alpha	55.429002560955176
2025-10-28 06:35:00+00	beta	42.715713538606295
2025-10-28 17:50:00+00	beta	57.359670910628026
2025-10-28 11:55:00+00	alpha	58.91036455537827
2025-10-28 10:35:00+00	alpha	65.3361113284873
2025-10-28 14:25:00+00	alpha	37.59655446666763
2025-10-28 23:00:00+00	alpha	50.20447069384419
2025-10-28 05:55:00+00	alpha	20.292343544487714
2025-10-28 22:40:00+00	beta	48.388270263669995
2025-10-28 03:55:00+00	alpha	29.871583917286056
2025-10-28 04:10:00+00	beta	54.48656970773518
2025-10-28 18:00:00+00	beta	58.81469996643792
2025-10-28 12:05:00+00	alpha	36.269186401570636
2025-10-28 11:45:00+00	alpha	52.69174824228664
2025-10-28 16:55:00+00	alpha	54.59632637591161
2025-10-28 18:35:00+00	beta	58.9451670814708
2025-10-28 06:10:00+00	alpha	57.4474309114766
2025-10-28 13:25:00+00	alpha	66.24627329338819
2025-10-28 23:40:00+00	alpha	63.156678026383645
2025-10-28 17:05:00+00	alpha	33.038962570820914
2025-10-28 23:30:00+00	beta	62.28556521868359
2025-10-28 17:10:00+00	alpha	49.011096517998894
2025-10-28 19:50:00+00	alpha	52.69470531316849
2025-10-28 08:00:00+00	beta	38.600656550853714
2025-10-28 18:30:00+00	beta	52.98407901903737
2025-10-28 04:45:00+00	alpha	64.00461721525113
2025-10-28 19:30:00+00	alpha	55.417114739666395
2025-10-28 20:35:00+00	beta	53.46783102411418
2025-10-28 22:45:00+00	alpha	51.78813197739025
2025-10-28 03:30:00+00	alpha	58.854672209860134
2025-10-28 06:15:00+00	beta	46.19463159807778
2025-10-28 22:10:00+00	alpha	50.87348129095081
2025-10-28 20:20:00+00	beta	70.33267432150554
2025-10-28 05:50:00+00	alpha	26.96661640362094
2025-10-28 16:20:00+00	beta	22.806911743254027
2025-10-28 11:35:00+00	beta	55.75370071952004
2025-10-28 05:25:00+00	beta	55.67893874152003
2025-10-28 21:10:00+00	beta	46.63396277758316
2025-10-28 09:55:00+00	beta	73.77495777948758
2025-10-28 14:35:00+00	beta	33.46239979821208
2025-10-28 08:05:00+00	beta	59.01414440546883
2025-10-28 09:15:00+00	alpha	35.126115367964786
2025-10-28 17:30:00+00	alpha	41.78078646158122
2025-10-28 15:45:00+00	alpha	66.22087942276877
2025-10-28 13:35:00+00	beta	48.22473730844498
2025-10-28 13:55:00+00	alpha	38.9915601787405
2025-10-28 07:45:00+00	alpha	53.80958777692748
2025-10-28 16:45:00+00	beta	55.735780965909
2025-10-28 05:35:00+00	alpha	41.29458494331595
2025-10-28 05:55:00+00	beta	37.94067475664505
2025-10-28 10:35:00+00	beta	63.35484195804638
2025-10-28 19:35:00+00	alpha	52.926872536034104
2025-10-28 22:20:00+00	alpha	42.86569784935371
2025-10-28 12:35:00+00	alpha	27.314895262394053
2025-10-28 14:45:00+00	alpha	38.11871060870193
2025-10-28 12:20:00+00	alpha	52.011134803993215
2025-10-28 08:00:00+00	alpha	34.87874030297824
2025-10-28 12:30:00+00	beta	25.491119683763056
2025-10-28 14:55:00+00	alpha	66.50180576950238
2025-10-28 18:10:00+00	beta	56.37726178411452
2025-10-28 04:55:00+00	alpha	51.13087332168624
2025-10-28 17:35:00+00	alpha	63.42623376278099
2025-10-28 13:45:00+00	beta	34.740268293165535
2025-10-28 07:15:00+00	alpha	74.6180428623338
2025-10-28 17:00:00+00	beta	39.86914325369707
2025-10-28 13:45:00+00	alpha	51.7910461191366
2025-10-28 07:50:00+00	beta	55.58087582960544
2025-10-28 14:00:00+00	beta	30.93453540606897
2025-10-28 10:30:00+00	alpha	26.7258273065852
2025-10-28 21:50:00+00	beta	29.501985783460093
2025-10-28 05:30:00+00	beta	45.7971884326033
2025-10-28 12:20:00+00	beta	36.61017364293704
2025-10-28 13:05:00+00	alpha	45.17974887702125
2025-10-28 16:40:00+00	beta	42.48515464730181
2025-10-28 10:30:00+00	beta	55.79562588039632
2025-10-28 22:30:00+00	alpha	48.78078026864445
2025-10-28 10:40:00+00	beta	65.65966985476541
2025-10-28 07:20:00+00	beta	31.615991589833982
2025-10-28 17:15:00+00	alpha	46.11286827215659
2025-10-28 14:15:00+00	alpha	45.24262751182577
2025-10-28 07:30:00+00	alpha	41.56376560410757
2025-10-28 16:00:00+00	alpha	41.129877194273035
2025-10-28 07:20:00+00	alpha	51.088176661260356
2025-10-28 13:20:00+00	alpha	16.465074801494204
2025-10-28 15:35:00+00	alpha	46.37925332914972
2025-10-28 11:50:00+00	beta	38.025613602452545
2025-10-28 20:15:00+00	alpha	51.006308128880924
2025-10-28 08:20:00+00	beta	30.125387722296836
2025-10-28 13:00:00+00	beta	38.91786974490193
2025-10-28 17:20:00+00	beta	41.684589554669444
2025-10-28 23:15:00+00	alpha	34.38259307476048
2025-10-28 03:25:00+00	alpha	59.56734903855646
2025-10-28 21:10:00+00	alpha	53.68410394956518
2025-10-28 16:35:00+00	beta	70.14431820233862
2025-10-28 15:50:00+00	alpha	43.362278843496554
2025-10-28 02:50:00+00	alpha	69.1682232473822
2025-10-28 04:05:00+00	alpha	39.12534783154638
2025-10-28 20:05:00+00	alpha	61.13902054401967
2025-10-28 12:45:00+00	alpha	43.00433607773341
2025-10-28 10:55:00+00	alpha	34.488545414653906
2025-10-28 04:20:00+00	beta	61.239028705420196
2025-10-28 17:05:00+00	beta	26.4038327934123
2025-10-28 20:45:00+00	alpha	60.242197136452226
2025-10-28 08:10:00+00	alpha	50.89797182761099
2025-10-28 21:55:00+00	alpha	55.350003858572315
2025-10-28 03:30:00+00	beta	37.24009971657957
2025-10-28 09:05:00+00	beta	61.60636547538312
2025-10-28 14:40:00+00	beta	53.612721193075245
2025-10-28 08:15:00+00	alpha	28.074275502797956
2025-10-28 09:30:00+00	alpha	49.56657560985287
2025-10-28 14:05:00+00	alpha	50.872052034168945
2025-10-28 04:00:00+00	alpha	42.983110838319185
2025-10-28 21:25:00+00	beta	38.008875646004356
2025-10-28 21:40:00+00	alpha	69.22801745511609
2025-10-28 19:05:00+00	beta	37.13968597082289
2025-10-28 09:50:00+00	alpha	51.354402816834956
2025-10-28 21:00:00+00	beta	32.24145865264392
2025-10-28 14:10:00+00	alpha	52.37682639966223
2025-10-28 22:30:00+00	beta	48.878753744953045
2025-10-28 13:30:00+00	alpha	53.07021246563092
2025-10-28 10:00:00+00	alpha	58.0221135639729
2025-10-28 06:00:00+00	alpha	63.91074732496762
2025-10-28 06:50:00+00	alpha	49.76471602059217
2025-10-28 17:45:00+00	beta	46.42615468123639
2025-10-28 16:20:00+00	alpha	41.90844212655078
2025-10-28 03:35:00+00	beta	41.65588133575136
2025-10-28 15:35:00+00	beta	13.620459751702139
2025-10-28 08:45:00+00	alpha	25.636586767191016
2025-10-28 03:35:00+00	alpha	48.32764587814674
2025-10-28 14:40:00+00	alpha	76.64501002112598
2025-10-28 09:45:00+00	beta	31.533701057327697
2025-10-28 20:30:00+00	beta	50.342517520862856
2025-10-28 10:45:00+00	beta	56.85759360480061
2025-10-28 02:40:00+00	alpha	34.394764731378395
2025-10-28 15:50:00+00	beta	44.056728689828034
2025-10-28 19:25:00+00	beta	52.748804759458054
2025-10-28 16:50:00+00	beta	42.78984676812703
2025-10-28 10:15:00+00	beta	48.14293002027132
2025-10-28 04:45:00+00	beta	54.215254497070944
2025-10-28 20:00:00+00	beta	45.61085203799981
2025-10-28 04:40:00+00	alpha	58.93916092648677
2025-10-28 17:40:00+00	alpha	36.100970448784736
2025-10-28 18:20:00+00	beta	67.04154175717795
2025-10-28 23:45:00+00	beta	47.90748185478746
2025-10-28 19:55:00+00	alpha	60.35211371148836
2025-10-28 18:40:00+00	alpha	26.54911888433196
2025-10-28 20:50:00+00	alpha	62.73689384407269
2025-10-28 03:20:00+00	beta	69.38381927935532
2025-10-28 02:35:00+00	beta	28.10571668838366
2025-10-28 05:35:00+00	beta	53.294247432839484
2025-10-28 16:25:00+00	beta	39.15808107805229
2025-10-28 04:55:00+00	beta	61.47633024677767
2025-10-28 02:20:00+00	beta	35.596325298623086
2025-10-28 21:15:00+00	beta	47.148781776765354
2025-10-28 12:25:00+00	beta	60.4527951959314
2025-10-28 20:55:00+00	beta	65.22896940471362
2025-10-28 19:25:00+00	alpha	59.99293227480998
2025-10-28 18:20:00+00	alpha	63.898238981591476
2025-10-28 23:50:00+00	beta	54.15094684584942
2025-10-28 13:25:00+00	beta	30.599567331207403
2025-10-28 02:40:00+00	beta	75.0778345264109
2025-10-28 23:45:00+00	alpha	43.16732914683912
2025-10-28 14:05:00+00	beta	77.55955883741359
2025-10-28 09:35:00+00	alpha	83.38196438317563
2025-10-28 08:25:00+00	alpha	47.50642257697852
2025-10-28 09:25:00+00	alpha	55.958574977612784
2025-10-28 17:40:00+00	beta	63.83676845581215
2025-10-28 03:45:00+00	beta	56.31702181752055
2025-10-28 09:20:00+00	alpha	44.28801237895021
2025-10-28 14:45:00+00	beta	60.967763417577224
2025-10-28 04:25:00+00	alpha	43.12389429497192
2025-10-28 02:55:00+00	alpha	37.89044495090538
2025-10-28 10:50:00+00	beta	72.61037787165078
2025-10-28 13:40:00+00	alpha	47.26438250399666
2025-10-28 07:35:00+00	beta	71.13478526574121
2025-10-28 23:05:00+00	beta	44.061725572489216
2025-10-28 03:15:00+00	beta	54.25367347098938
2025-10-28 22:35:00+00	beta	60.14912896442238
2025-10-28 03:55:00+00	beta	49.80787636380823
2025-10-28 13:00:00+00	alpha	61.54470159604942
2025-10-28 02:15:00+00	beta	25.42566259574115
2025-10-28 15:40:00+00	beta	55.3525270714047
2025-10-28 06:55:00+00	beta	48.59944649401207
2025-10-28 04:10:00+00	alpha	62.224818458837206
2025-10-28 19:30:00+00	beta	29.31475454642311
2025-10-28 11:35:00+00	alpha	77.58488157815613
2025-10-28 15:20:00+00	beta	38.079353611086546
2025-10-28 20:20:00+00	alpha	57.08778008676239
2025-10-28 23:55:00+00	beta	23.116899177618894
2025-10-28 22:05:00+00	alpha	72.39140772258453
2025-10-28 03:40:00+00	alpha	60.406461116201555
2025-10-28 06:50:00+00	beta	37.94276268450964
2025-10-28 07:05:00+00	alpha	53.185122475608
2025-10-28 18:45:00+00	beta	70.56920323814582
2025-10-28 23:30:00+00	alpha	49.0055414085238
2025-10-28 12:00:00+00	alpha	50.96645896392828
2025-10-28 08:45:00+00	beta	23.550462546999434
2025-10-28 12:55:00+00	alpha	45.84260185695333
2025-10-28 14:25:00+00	beta	39.49813745794337
2025-10-28 22:35:00+00	alpha	59.76939613351742
2025-10-28 18:55:00+00	alpha	25.480414052422624
2025-10-28 14:20:00+00	beta	29.064167572711717
2025-10-28 11:10:00+00	alpha	49.93170600631946
2025-10-28 02:30:00+00	beta	57.38183400962366
2025-10-28 06:20:00+00	beta	37.47497607710169
2025-10-28 11:00:00+00	alpha	22.874688398420723
2025-10-28 11:15:00+00	alpha	65.69930895532863
2025-10-28 10:55:00+00	beta	55.578829342796595
2025-10-28 02:20:00+00	alpha	58.70286325320406
2025-10-28 12:40:00+00	beta	34.49111472859644
2025-10-28 22:55:00+00	alpha	36.31409603864353
2025-10-28 22:25:00+00	alpha	40.92642043694688
2025-10-28 08:35:00+00	beta	55.15406495444714
2025-10-28 15:40:00+00	alpha	50.794305552232366
2025-10-28 03:40:00+00	beta	42.57631882010874
2025-10-28 11:40:00+00	alpha	46.38726389503228
2025-10-28 07:15:00+00	beta	26.629911763537734
2025-10-28 16:25:00+00	alpha	59.976612825421284
2025-10-28 06:30:00+00	beta	36.369307283135456
2025-10-28 14:50:00+00	beta	52.43243577816365
2025-10-28 20:10:00+00	beta	49.36846166849188
2025-10-28 15:15:00+00	beta	14.40703561971254
2025-10-28 22:00:00+00	alpha	41.126563510630575
2025-10-28 05:45:00+00	alpha	59.69123370191221
2025-10-28 21:35:00+00	alpha	31.024736129831524
2025-10-28 08:50:00+00	alpha	40.48678268626778
2025-10-28 21:05:00+00	beta	67.74284625048787
2025-10-28 05:30:00+00	alpha	52.38805770203616
2025-10-28 20:25:00+00	alpha	35.36750085455047
2025-10-28 03:45:00+00	alpha	58.29461662738588
2025-10-28 20:40:00+00	beta	40.53137183628653
2025-10-28 11:25:00+00	beta	62.270855103913995
2025-10-28 17:50:00+00	alpha	60.276620429586934
2025-10-28 21:35:00+00	beta	69.3402024954917
2025-10-28 21:55:00+00	beta	42.8960334028313
2025-10-28 10:50:00+00	alpha	52.46654724829723
2025-10-28 21:45:00+00	beta	87.58226620177867
2025-10-28 21:20:00+00	alpha	59.56394551938708
2025-10-28 10:10:00+00	alpha	66.27796240888453
2025-10-28 11:05:00+00	beta	64.865838631741
2025-10-28 13:55:00+00	beta	59.06598270116922
2025-10-28 23:05:00+00	alpha	57.18634943447758
2025-10-28 08:40:00+00	alpha	53.434807324296436
2025-10-28 11:30:00+00	alpha	38.19691230318734
2025-10-28 15:25:00+00	alpha	29.198145285949
2025-10-28 16:15:00+00	alpha	38.00749316201597
2025-10-28 13:35:00+00	alpha	39.68356621515848
2025-10-28 11:10:00+00	beta	52.574331325816374
2025-10-28 09:25:00+00	beta	45.47427742252737
2025-10-28 16:55:00+00	beta	49.806348560240096
2025-10-28 15:05:00+00	alpha	20.64601662187787
2025-10-28 19:10:00+00	beta	49.84697375127412
2025-10-28 17:55:00+00	beta	62.337413165195414
2025-10-28 12:05:00+00	beta	59.037841290940335
2025-10-28 13:40:00+00	beta	33.88364471514217
2025-10-28 13:30:00+00	beta	34.25867865990597
2025-10-28 14:55:00+00	beta	55.089664235671684
2025-10-28 05:45:00+00	beta	43.66760053299988
2025-10-28 20:30:00+00	alpha	38.404509442136295
2025-10-28 17:30:00+00	beta	32.437550841056876
2025-10-28 20:15:00+00	beta	44.15950915392318
2025-10-28 05:20:00+00	alpha	53.89872292467224
2025-10-28 23:35:00+00	beta	52.119371672171894
2025-10-28 11:00:00+00	beta	55.6242607435877
2025-10-28 19:50:00+00	beta	35.717179520651015
2025-10-28 18:50:00+00	beta	48.46181445829829
2025-10-28 12:15:00+00	alpha	46.06041025582226
2025-10-28 10:05:00+00	beta	53.4272040017848
2025-10-28 16:15:00+00	beta	47.57600578442316
2025-10-28 19:20:00+00	alpha	44.23821255186017
2025-10-28 09:05:00+00	alpha	34.81818855415031
2025-10-28 17:45:00+00	alpha	35.736191968849894
2025-10-28 20:40:00+00	alpha	52.979420482749035
2025-10-28 21:05:00+00	alpha	57.44890161135042
2025-10-28 16:05:00+00	alpha	33.467167944192845
2025-10-28 10:10:00+00	beta	64.78738210644423
2025-10-28 20:55:00+00	alpha	54.34311812400383
2025-10-28 21:00:00+00	alpha	44.35898099164499
2025-10-28 21:20:00+00	beta	54.1698502993316
2025-10-28 21:50:00+00	alpha	54.11144801047851
2025-10-28 07:25:00+00	beta	41.710269204689325
2025-10-28 10:25:00+00	beta	29.6343447614753
2025-10-28 16:30:00+00	alpha	49.73940210743948
2025-10-28 04:35:00+00	alpha	38.77237121863975
2025-10-28 22:45:00+00	beta	60.80130486018139
2025-10-28 03:05:00+00	beta	49.4599372760746
2025-10-28 19:35:00+00	beta	56.58373678611131
2025-10-28 04:40:00+00	beta	37.967271956979104
2025-10-28 11:30:00+00	beta	47.72670660956457
2025-10-28 17:10:00+00	beta	77.33867966099655
2025-10-28 12:40:00+00	alpha	49.83396841033042
2025-10-28 19:40:00+00	alpha	76.6410543199628
2025-10-28 12:10:00+00	alpha	48.42680546512304
2025-10-28 19:15:00+00	alpha	41.78232561183513
2025-10-28 14:30:00+00	alpha	49.35753332124132
2025-10-28 08:55:00+00	alpha	71.21852738550605
2025-10-28 10:00:00+00	beta	23.561481519360008
2025-10-28 12:30:00+00	alpha	19.48653062451654
2025-10-28 05:50:00+00	beta	56.947474016870146
2025-10-28 03:15:00+00	alpha	58.89099687197172
2025-10-28 15:55:00+00	alpha	50.69321702725658
2025-10-28 06:10:00+00	beta	51.97072833592065
2025-10-28 17:20:00+00	alpha	60.305732326427304
2025-10-28 23:10:00+00	beta	73.14890821702514
2025-10-28 12:10:00+00	beta	44.237821467726725
2025-10-28 06:40:00+00	beta	47.7579348019301
2025-10-28 22:55:00+00	beta	42.19994923385487
2025-10-28 22:15:00+00	beta	53.504174104974005
2025-10-28 14:15:00+00	beta	68.32559979941884
2025-10-28 06:20:00+00	alpha	66.26450776797137
2025-10-28 05:20:00+00	beta	49.81485800795334
2025-10-28 08:25:00+00	beta	48.28050289954245
2025-10-28 07:00:00+00	alpha	60.837476717330006
2025-10-28 23:20:00+00	alpha	60.44766249858583
2025-10-28 16:30:00+00	beta	56.22177454145665
2025-10-28 09:00:00+00	beta	46.80171123597338
2025-10-28 06:45:00+00	alpha	38.9231962214809
2025-10-28 02:45:00+00	beta	66.52505216243985
2025-10-28 23:00:00+00	beta	43.0311884296661
2025-10-28 23:40:00+00	beta	62.787438856884
2025-10-28 14:30:00+00	beta	86.21131888343102
2025-10-28 11:15:00+00	beta	47.116236347627854
2025-10-28 22:05:00+00	beta	57.13528032078832
2025-10-28 22:15:00+00	alpha	42.239237189000775
2025-10-28 06:15:00+00	alpha	26.125443632922675
2025-10-28 13:50:00+00	alpha	41.86895584865225
2025-10-28 04:25:00+00	beta	37.100801446161626
2025-10-28 04:50:00+00	beta	70.63590007952915
2025-10-28 20:10:00+00	alpha	56.38012202048317
2025-10-28 17:00:00+00	alpha	59.72029663932858
2025-10-28 07:25:00+00	alpha	30.709905973648837
2025-10-28 16:00:00+00	beta	60.7981147291845
2025-10-28 23:10:00+00	alpha	59.86633943109656
2025-10-28 15:15:00+00	alpha	53.3650034829299
2025-10-28 13:50:00+00	beta	55.754433702114646
2025-10-28 08:50:00+00	beta	47.11682550704778
2025-10-28 05:05:00+00	alpha	74.76149215022932
2025-10-28 20:00:00+00	alpha	76.63232794142777
2025-10-28 05:05:00+00	beta	61.89487799145836
2025-10-28 18:25:00+00	beta	30.53593723490986
2025-10-28 21:15:00+00	alpha	67.94920667482354
2025-10-28 02:35:00+00	alpha	69.72307874756146
2025-10-28 07:40:00+00	alpha	44.40709509349681
2025-10-28 06:25:00+00	alpha	61.12258259313817
2025-10-28 18:40:00+00	beta	36.096549285262086
2025-10-28 13:05:00+00	beta	48.79589263868742
2025-10-28 13:10:00+00	alpha	56.017569351963985
2025-10-28 06:05:00+00	alpha	54.90777128877962
2025-10-28 21:40:00+00	beta	55.61019060131224
2025-10-28 10:15:00+00	alpha	43.75593835320304
2025-10-28 03:05:00+00	alpha	85.7708096160258
2025-10-28 15:00:00+00	alpha	59.90274780569073
2025-10-28 18:50:00+00	alpha	47.93363021776453
2025-10-28 08:05:00+00	alpha	63.79454599093812
2025-10-28 12:00:00+00	beta	34.91139160149381
2025-10-28 07:10:00+00	beta	35.3764636147685
2025-10-28 03:50:00+00	alpha	61.92541227972382
2025-10-28 11:20:00+00	alpha	45.9719555247964
2025-10-28 16:40:00+00	alpha	57.71163694108918
2025-10-28 20:25:00+00	beta	28.964772533318104
2025-10-28 18:05:00+00	alpha	34.83309260919615
2025-10-28 21:45:00+00	alpha	42.7384984156151
2025-10-28 08:30:00+00	alpha	35.46556105646816
2025-10-28 17:15:00+00	beta	37.88549513984648
2025-10-28 18:45:00+00	alpha	51.16989585848656
2025-10-28 13:10:00+00	beta	59.02333097386336
2025-10-28 03:00:00+00	beta	54.824723340491076
2025-10-28 07:55:00+00	beta	47.241566128718624
2025-10-28 23:25:00+00	alpha	53.94092533897333
2025-10-28 21:30:00+00	beta	25.226789580499556
2025-10-28 03:50:00+00	beta	54.27597463487077
2025-10-28 02:15:00+00	alpha	40.60135743366823
2025-10-28 06:30:00+00	alpha	69.20944766147367
2025-10-28 03:00:00+00	alpha	48.17826612546004
2025-10-28 03:10:00+00	alpha	54.52351358966763
2025-10-28 05:40:00+00	beta	25.285638683278027
2025-10-28 11:20:00+00	beta	68.23606254777424
2025-10-28 07:55:00+00	alpha	35.78731605272435
2025-10-28 09:50:00+00	beta	46.35304390948808
2025-10-28 18:55:00+00	beta	66.3451789882774
2025-10-28 11:40:00+00	beta	51.778946945835386
2025-10-28 09:30:00+00	beta	47.32924838657296
2025-10-28 10:25:00+00	alpha	57.44771680540107
2025-10-28 05:25:00+00	alpha	31.744067397220668
2025-10-28 09:40:00+00	beta	75.09073558480785
2025-10-28 19:15:00+00	beta	67.91129976307812
2025-10-28 17:35:00+00	beta	41.02110908183233
2025-10-28 15:05:00+00	beta	43.269262834727336
2025-10-28 05:10:00+00	beta	50.93307352993739
2025-10-28 17:25:00+00	beta	64.46518885285802
2025-10-28 04:00:00+00	beta	26.69344549970291
2025-10-28 15:25:00+00	beta	63.795986283261996
2025-10-28 15:10:00+00	alpha	48.770269064589115
2025-10-28 10:05:00+00	alpha	71.0717437079443
2025-10-28 15:20:00+00	alpha	49.33866472811323
2025-10-28 10:20:00+00	alpha	67.70555998281534
2025-10-28 02:25:00+00	alpha	37.595629327031574
2025-10-28 12:45:00+00	beta	51.77100561688919
2025-10-28 08:15:00+00	beta	54.715561778841916
2025-10-28 13:15:00+00	beta	31.520603303967924
2025-10-28 12:15:00+00	beta	48.154830587492924
2025-10-28 16:50:00+00	alpha	37.3308300621807
2025-10-28 09:20:00+00	beta	33.70224057295297
2025-10-28 04:30:00+00	alpha	35.24670283809557
2025-10-28 12:50:00+00	beta	56.70349919630517
2025-10-28 18:30:00+00	alpha	21.2840074104444
2025-10-28 13:15:00+00	alpha	53.682822663092225
2025-10-28 19:05:00+00	alpha	46.581161804963884
2025-10-28 05:40:00+00	alpha	60.48948070931006
2025-10-28 10:40:00+00	alpha	45.0992356387373
2025-10-28 09:10:00+00	beta	40.77891812860443
2025-10-28 19:45:00+00	beta	41.89453835467901
2025-10-28 07:00:00+00	beta	84.88305447615673
2025-10-28 05:10:00+00	alpha	25.8965360925158
2025-10-28 23:15:00+00	beta	51.03402227487493
2025-10-28 11:50:00+00	alpha	24.715863980913333
2025-10-28 15:55:00+00	beta	35.80281883000039
2025-10-28 16:45:00+00	alpha	41.301532304518915
2025-10-28 23:25:00+00	beta	28.3833476964566
2025-10-28 19:10:00+00	alpha	41.94253472546558
2025-10-28 04:15:00+00	beta	58.88965424813864
2025-10-28 11:55:00+00	beta	21.40936150777256
2025-10-28 16:05:00+00	beta	38.6581605390237
2025-10-28 21:25:00+00	alpha	54.24292709482713
2025-10-28 10:45:00+00	alpha	51.65624321150953
2025-10-28 02:25:00+00	beta	55.839769955918186
2025-10-28 22:10:00+00	beta	64.38184771249564
2025-10-28 12:25:00+00	alpha	63.408153162170926
2025-10-28 18:05:00+00	beta	71.74851478883892
2025-10-28 12:35:00+00	beta	61.02844874507069
2025-10-28 12:50:00+00	alpha	54.235002225476606
2025-10-28 14:10:00+00	beta	40.09618922649127
2025-10-28 02:30:00+00	alpha	70.6192703502897
2025-10-28 20:35:00+00	alpha	62.765336733051434
2025-10-28 04:30:00+00	beta	52.35994723847534
2025-10-28 02:45:00+00	alpha	16.44159551105097
2025-10-28 19:55:00+00	beta	45.969219917537714
2025-10-28 03:10:00+00	beta	36.92157102143258
2025-10-28 15:30:00+00	alpha	52.026640442543204
2025-10-28 07:30:00+00	beta	59.11783180389335
2025-10-28 22:25:00+00	beta	23.17184455397821
2025-10-28 05:00:00+00	alpha	46.366615910426404
2025-10-28 09:35:00+00	beta	34.14156418800112
2025-10-28 19:20:00+00	beta	39.94504155450417
2025-10-28 11:45:00+00	beta	46.34063997415275
2025-10-28 04:15:00+00	alpha	47.23107770469868
2025-10-28 14:00:00+00	alpha	45.821967082848786
2025-10-28 18:15:00+00	beta	38.26697878385295
2025-10-28 07:05:00+00	beta	45.865856229251946
2025-10-28 04:50:00+00	alpha	63.739499633403604
2025-10-28 15:00:00+00	beta	44.62487456369631
2025-10-28 08:20:00+00	alpha	69.10491508843634
2025-10-28 08:35:00+00	alpha	48.87070971585271
2025-10-28 20:45:00+00	beta	39.452503311415725
2025-10-28 22:40:00+00	alpha	37.0094136761242
2025-10-28 15:45:00+00	beta	33.817697435926064
2025-10-28 09:55:00+00	alpha	55.639480253571584
2025-10-28 03:25:00+00	beta	68.56170813820424
2025-10-28 08:55:00+00	beta	45.20688423124401
2025-10-28 16:10:00+00	beta	52.07318501460385
2025-10-28 09:15:00+00	beta	47.23984755772415
2025-10-28 09:10:00+00	alpha	44.60778447730511
2025-10-28 23:50:00+00	alpha	63.33974636952346
2025-10-28 21:30:00+00	alpha	64.14403011311231
2025-10-28 04:35:00+00	beta	60.47538586558112
2025-10-28 04:20:00+00	alpha	47.6330112824765
2025-10-28 06:00:00+00	beta	48.66626468517972
2025-10-28 14:20:00+00	alpha	61.035708196809466
2025-10-28 07:10:00+00	alpha	65.64153780950214
2025-10-28 05:00:00+00	beta	45.38240912655577
2025-10-28 09:00:00+00	alpha	55.73011619109327
2025-10-28 08:10:00+00	beta	43.819604924980396
\.


--
-- Data for Name: _hyper_4_5_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal._hyper_4_5_chunk (bucket, series, avg_value) FROM stdin;
2025-10-29 20:45:00+00	beta	48.442483830300255
2025-10-29 09:00:00+00	alpha	56.462425244848646
2025-10-29 16:45:00+00	gamma	42.2882657930618
2025-10-29 05:55:00+00	beta	52.339059558704356
2025-10-29 09:15:00+00	alpha	47.83503864940961
2025-10-30 01:30:00+00	alpha	54.51955311685661
2025-10-29 00:20:00+00	beta	50.83652878385819
2025-10-29 22:35:00+00	gamma	45.335672701104855
2025-10-29 00:50:00+00	alpha	37.9410358351263
2025-10-29 19:40:00+00	gamma	61.32417125610469
2025-10-29 23:25:00+00	alpha	44.37027259676176
2025-10-29 09:40:00+00	alpha	57.13136886153616
2025-10-30 03:25:00+00	gamma	58.430855164494176
2025-10-29 07:45:00+00	beta	64.17863402626449
2025-10-29 17:45:00+00	alpha	50.220746467254045
2025-10-29 18:55:00+00	gamma	56.45064822587919
2025-10-29 14:40:00+00	gamma	59.16592765800931
2025-10-29 13:35:00+00	gamma	62.87877452156001
2025-10-29 05:30:00+00	beta	55.519387425282105
2025-10-30 01:15:00+00	gamma	56.32175083539803
2025-10-29 23:20:00+00	alpha	35.04466380941375
2025-10-29 10:55:00+00	beta	53.52158329511646
2025-10-29 20:20:00+00	alpha	59.81736778608058
2025-10-29 16:05:00+00	alpha	49.4444566265032
2025-10-29 12:25:00+00	beta	45.6137525594977
2025-10-29 07:30:00+00	gamma	62.77788111366603
2025-10-29 10:20:00+00	gamma	42.823463235686745
2025-10-29 03:40:00+00	beta	27.476393355220274
2025-10-29 04:50:00+00	beta	44.42113537203238
2025-10-30 01:00:00+00	beta	54.752463903980626
2025-10-30 04:00:00+00	gamma	52.14673389076421
2025-10-29 03:55:00+00	beta	68.00953385465121
2025-10-29 13:15:00+00	gamma	59.65118425501398
2025-10-29 06:10:00+00	alpha	53.5330075477307
2025-10-29 19:45:00+00	beta	51.773782569055996
2025-10-29 21:40:00+00	gamma	53.45016205068382
2025-10-29 13:05:00+00	beta	47.164066421970915
2025-10-29 17:40:00+00	beta	46.16646752400516
2025-10-29 22:05:00+00	alpha	44.912091155292735
2025-10-29 18:05:00+00	beta	55.71744757612616
2025-10-29 06:05:00+00	alpha	50.44458057415531
2025-10-30 02:40:00+00	beta	63.399040845518414
2025-10-29 18:10:00+00	alpha	46.433122787772945
2025-10-30 02:15:00+00	beta	50.410111252944134
2025-10-29 08:00:00+00	gamma	61.5699739725056
2025-10-29 00:20:00+00	alpha	57.15555779936168
2025-10-30 03:45:00+00	alpha	56.06279231312965
2025-10-30 01:25:00+00	alpha	56.79243826274679
2025-10-29 05:45:00+00	beta	38.27897035420069
2025-10-29 03:25:00+00	alpha	58.29501714358007
2025-10-29 09:50:00+00	beta	37.19997758163872
2025-10-29 12:15:00+00	gamma	50.977894423542196
2025-10-29 22:50:00+00	beta	48.568769829436846
2025-10-29 09:45:00+00	beta	57.993687773347155
2025-10-29 21:10:00+00	beta	41.187533819559725
2025-10-29 06:15:00+00	beta	51.59529530099026
2025-10-29 07:45:00+00	gamma	62.766703309317165
2025-10-29 16:50:00+00	alpha	45.02269330847727
2025-10-30 02:20:00+00	gamma	63.16819772679364
2025-10-29 13:40:00+00	beta	52.815730110956295
2025-10-29 20:20:00+00	beta	61.19050537009031
2025-10-29 03:35:00+00	beta	44.32658340365024
2025-10-29 14:35:00+00	alpha	58.64733194331844
2025-10-29 21:35:00+00	beta	41.964787557833034
2025-10-29 16:50:00+00	gamma	42.660389002390765
2025-10-30 00:55:00+00	beta	54.95333322475066
2025-10-30 02:05:00+00	beta	50.32200496506747
2025-10-30 02:10:00+00	gamma	61.613946648935425
2025-10-30 01:10:00+00	gamma	55.38407762979565
2025-10-29 18:30:00+00	beta	54.23159429072863
2025-10-29 07:25:00+00	alpha	49.301033883720415
2025-10-29 04:40:00+00	gamma	43.09229588167201
2025-10-29 15:30:00+00	alpha	48.60136184341048
2025-10-29 04:15:00+00	gamma	41.994551620303994
2025-10-30 03:50:00+00	alpha	54.37499987494685
2025-10-29 06:00:00+00	alpha	41.501405519484784
2025-10-29 17:15:00+00	gamma	42.701992137563785
2025-10-29 12:55:00+00	beta	66.18867508285265
2025-10-29 00:30:00+00	beta	75.28112134477477
2025-10-29 11:10:00+00	gamma	44.18818390202801
2025-10-29 02:20:00+00	alpha	45.281104170175574
2025-10-29 07:20:00+00	gamma	62.29123790865528
2025-10-29 15:15:00+00	beta	58.57060823061654
2025-10-29 01:30:00+00	beta	45.671374418765446
2025-10-29 20:15:00+00	alpha	62.053974463037356
2025-10-29 12:45:00+00	beta	51.097216703374244
2025-10-29 15:15:00+00	alpha	46.380867128555515
2025-10-29 11:10:00+00	beta	45.01335123474628
2025-10-29 15:20:00+00	gamma	53.401474951996704
2025-10-29 00:00:00+00	alpha	57.66871919442806
2025-10-29 10:15:00+00	gamma	44.33628124264725
2025-10-29 19:35:00+00	beta	65.07036796389256
2025-10-29 15:05:00+00	alpha	64.48257011248292
2025-10-29 19:45:00+00	alpha	50.35004270682153
2025-10-29 12:25:00+00	alpha	47.98649541011319
2025-10-30 02:25:00+00	gamma	62.73609048731424
2025-10-29 19:20:00+00	beta	49.87067000794939
2025-10-29 17:45:00+00	beta	40.62626395438753
2025-10-29 12:20:00+00	alpha	58.687870720687876
2025-10-29 22:15:00+00	alpha	48.82615851698259
2025-10-29 19:25:00+00	alpha	53.04432361570707
2025-10-29 06:30:00+00	gamma	56.83500612156236
2025-10-29 15:25:00+00	alpha	53.237087757316374
2025-10-29 08:05:00+00	beta	52.412399716572054
2025-10-29 15:55:00+00	beta	44.89216795539429
2025-10-29 13:05:00+00	alpha	57.86809636123248
2025-10-29 18:20:00+00	alpha	47.67342140149535
2025-10-29 22:45:00+00	gamma	44.289819607205835
2025-10-29 08:10:00+00	gamma	60.720972029248706
2025-10-29 23:00:00+00	alpha	42.356951701480554
2025-10-29 01:40:00+00	beta	59.23500996434052
2025-10-29 10:10:00+00	gamma	44.85718320708325
2025-10-29 04:20:00+00	beta	54.33987199721027
2025-10-29 03:45:00+00	beta	49.752347903103306
2025-10-29 04:05:00+00	alpha	40.563749363247624
2025-10-29 12:50:00+00	gamma	56.047430171985035
2025-10-29 18:00:00+00	gamma	46.085686121142786
2025-10-30 01:50:00+00	gamma	60.32531895337142
2025-10-29 21:35:00+00	gamma	54.17103966094876
2025-10-29 23:45:00+00	beta	60.67312701153331
2025-10-29 17:45:00+00	gamma	45.024396408429524
2025-10-29 06:35:00+00	gamma	57.74265233751332
2025-10-29 05:20:00+00	beta	53.736536543052054
2025-10-29 12:15:00+00	alpha	57.21600933765931
2025-10-30 02:30:00+00	beta	62.55236706731796
2025-10-29 06:55:00+00	beta	45.65924998983023
2025-10-29 06:25:00+00	gamma	56.15786376925299
2025-10-29 03:45:00+00	alpha	15.599777865095927
2025-10-30 04:05:00+00	beta	50.48910395887955
2025-10-29 08:05:00+00	alpha	54.35288442856423
2025-10-29 23:50:00+00	beta	43.18367890435627
2025-10-30 03:20:00+00	beta	59.8025731698029
2025-10-29 21:55:00+00	alpha	44.610551995223325
2025-10-29 06:35:00+00	beta	52.81700230092927
2025-10-29 14:55:00+00	alpha	58.81927772992242
2025-10-29 11:20:00+00	beta	38.757337056510096
2025-10-29 20:40:00+00	gamma	60.621716975781524
2025-10-30 02:15:00+00	gamma	62.77225447363473
2025-10-29 10:50:00+00	alpha	40.248639373969596
2025-10-29 06:00:00+00	beta	52.51058698436471
2025-10-30 03:40:00+00	beta	57.11642982916982
2025-10-29 20:10:00+00	alpha	50.948376090201506
2025-10-30 00:05:00+00	beta	48.7425498237471
2025-10-29 05:05:00+00	beta	42.76676476409746
2025-10-29 04:40:00+00	alpha	53.71107016725267
2025-10-29 06:45:00+00	beta	55.4983086168571
2025-10-29 15:05:00+00	gamma	56.846995840290575
2025-10-30 03:50:00+00	beta	55.34619406676977
2025-10-29 11:45:00+00	beta	49.75769063431711
2025-10-29 13:50:00+00	gamma	62.021119136493915
2025-10-29 15:35:00+00	alpha	60.51219142363014
2025-10-29 12:45:00+00	alpha	43.2446542949328
2025-10-29 11:05:00+00	alpha	49.61755857563802
2025-10-29 19:40:00+00	beta	58.63388637621413
2025-10-29 06:20:00+00	gamma	55.32674856491614
2025-10-29 07:00:00+00	beta	53.02809573332079
2025-10-29 00:25:00+00	beta	75.56984224283444
2025-10-29 07:20:00+00	alpha	42.486157334100184
2025-10-29 06:40:00+00	beta	49.510778676454365
2025-10-30 01:10:00+00	alpha	59.84835512611037
2025-10-29 02:55:00+00	beta	52.13211744825016
2025-10-29 19:10:00+00	alpha	60.47939848318957
2025-10-29 23:05:00+00	beta	49.682862156499745
2025-10-29 15:15:00+00	gamma	53.862105430117914
2025-10-29 03:40:00+00	alpha	52.26501359990469
2025-10-29 10:25:00+00	gamma	43.873810631941126
2025-10-29 04:05:00+00	gamma	43.85498751491447
2025-10-29 09:35:00+00	gamma	49.11241386073254
2025-10-29 15:25:00+00	beta	52.582463525471255
2025-10-29 20:15:00+00	gamma	63.01658106831384
2025-10-29 14:30:00+00	beta	55.364927488591874
2025-10-29 13:15:00+00	beta	59.19111387340892
2025-10-29 21:00:00+00	alpha	45.7114906232256
2025-10-29 06:55:00+00	gamma	60.26413837938776
2025-10-29 23:05:00+00	alpha	48.62245690399559
2025-10-29 21:30:00+00	alpha	59.879945000400014
2025-10-29 04:25:00+00	gamma	42.82737640311046
2025-10-29 01:15:00+00	beta	56.773830394079866
2025-10-29 21:25:00+00	gamma	56.19673048884651
2025-10-29 09:25:00+00	gamma	51.091826046436786
2025-10-29 14:40:00+00	alpha	63.59883297984531
2025-10-29 14:30:00+00	gamma	60.260204818328326
2025-10-29 17:55:00+00	beta	54.17058114723996
2025-10-30 04:05:00+00	alpha	52.617797975601455
2025-10-29 05:35:00+00	beta	41.98231396383807
2025-10-29 19:05:00+00	alpha	51.06476932938355
2025-10-29 14:20:00+00	gamma	62.50577408719575
2025-10-29 15:00:00+00	beta	53.756529286936754
2025-10-29 00:45:00+00	beta	43.86584539992181
2025-10-29 12:00:00+00	gamma	48.14908102162812
2025-10-30 01:45:00+00	alpha	49.60380715300294
2025-10-29 03:50:00+00	alpha	37.981288239204524
2025-10-30 00:55:00+00	alpha	44.41478645101448
2025-10-29 01:00:00+00	alpha	61.570455149271424
2025-10-29 14:55:00+00	gamma	57.26968730967767
2025-10-29 15:00:00+00	alpha	52.143648390163186
2025-10-29 21:30:00+00	gamma	55.3856497194264
2025-10-30 00:45:00+00	beta	59.84547417467087
2025-10-29 22:25:00+00	gamma	45.37656908710018
2025-10-29 05:55:00+00	gamma	50.60312520064663
2025-10-29 19:40:00+00	alpha	56.02699787862177
2025-10-30 01:40:00+00	alpha	59.92033789938161
2025-10-30 00:25:00+00	gamma	46.980846847156116
2025-10-29 17:30:00+00	alpha	42.211531462895906
2025-10-29 13:10:00+00	alpha	54.20605956780757
2025-10-29 16:35:00+00	gamma	43.60946487022632
2025-10-29 20:45:00+00	alpha	45.14838453565606
2025-10-29 05:35:00+00	alpha	46.37363087721768
2025-10-29 07:40:00+00	alpha	59.736474699283335
2025-10-29 14:25:00+00	gamma	62.18117064488287
2025-10-29 22:45:00+00	beta	57.210780538853
2025-10-29 09:30:00+00	alpha	49.10218642870963
2025-10-29 04:30:00+00	beta	52.065674889663306
2025-10-29 02:00:00+00	beta	55.20828403549674
2025-10-30 03:45:00+00	gamma	55.23950347463923
2025-10-29 21:50:00+00	alpha	46.974642815596766
2025-10-29 11:00:00+00	alpha	41.574035428721736
2025-10-30 00:25:00+00	beta	55.40561888504292
2025-10-29 16:00:00+00	gamma	47.14371261372746
2025-10-29 00:05:00+00	alpha	51.08870507947762
2025-10-29 23:25:00+00	gamma	41.53986978128191
2025-10-29 10:35:00+00	alpha	46.51946547437815
2025-10-29 15:10:00+00	beta	55.69604593105489
2025-10-29 10:00:00+00	gamma	45.377735105192414
2025-10-29 09:15:00+00	gamma	52.546442175149025
2025-10-29 00:10:00+00	alpha	48.58019706345168
2025-10-29 03:20:00+00	alpha	46.860011240402365
2025-10-30 02:35:00+00	gamma	61.96608263240415
2025-10-29 05:00:00+00	gamma	44.314175512300615
2025-10-30 03:30:00+00	beta	58.12624156428937
2025-10-29 13:00:00+00	gamma	58.67136596646327
2025-10-29 16:15:00+00	gamma	44.66852537431713
2025-10-29 19:05:00+00	beta	53.056484274447506
2025-10-29 13:30:00+00	alpha	54.88999267479303
2025-10-30 03:10:00+00	alpha	60.347168626213616
2025-10-30 02:30:00+00	alpha	62.72147880083611
2025-10-29 11:45:00+00	alpha	37.22558059614905
2025-10-29 01:45:00+00	alpha	41.60690169445984
2025-10-29 11:40:00+00	gamma	45.66369821741592
2025-10-29 03:35:00+00	alpha	66.02412098244272
2025-10-29 08:25:00+00	beta	64.92920774424563
2025-10-29 12:50:00+00	alpha	67.22715236030939
2025-10-29 05:55:00+00	alpha	48.429112910906305
2025-10-29 16:55:00+00	alpha	43.257856376173535
2025-10-30 03:10:00+00	gamma	60.60675845185598
2025-10-30 01:05:00+00	alpha	61.046129696476875
2025-10-29 23:10:00+00	beta	53.46769238497544
2025-10-29 23:15:00+00	alpha	43.74841878372841
2025-10-29 01:25:00+00	alpha	23.99596187767073
2025-10-29 00:35:00+00	beta	54.56097973719052
2025-10-29 22:20:00+00	beta	47.798431054990424
2025-10-29 08:50:00+00	beta	50.85894392143045
2025-10-29 19:50:00+00	gamma	62.94678847408396
2025-10-29 15:10:00+00	alpha	42.50807080532951
2025-10-30 02:25:00+00	alpha	61.928037540626875
2025-10-29 04:50:00+00	alpha	51.64992822422619
2025-10-29 11:25:00+00	alpha	45.14197722526625
2025-10-29 21:10:00+00	alpha	49.04857563247903
2025-10-29 01:05:00+00	beta	54.8739722753838
2025-10-29 17:00:00+00	alpha	52.28013111719806
2025-10-29 08:40:00+00	alpha	57.15948584703081
2025-10-29 15:25:00+00	gamma	52.89923448092473
2025-10-30 03:35:00+00	gamma	57.13309604431159
2025-10-29 00:35:00+00	alpha	46.27396282237579
2025-10-29 07:45:00+00	alpha	61.99180373912575
2025-10-29 07:40:00+00	gamma	61.066954468359064
2025-10-29 13:50:00+00	alpha	51.32264961887372
2025-10-30 00:00:00+00	gamma	44.41783701513292
2025-10-29 07:00:00+00	gamma	60.57660390300587
2025-10-29 04:15:00+00	beta	53.677116334473226
2025-10-29 23:55:00+00	beta	47.846686322379774
2025-10-30 04:00:00+00	beta	52.52229312544985
2025-10-29 21:50:00+00	gamma	51.77344299869712
2025-10-29 11:50:00+00	beta	53.210734748002835
2025-10-29 13:05:00+00	gamma	58.37922964334622
2025-10-29 13:45:00+00	beta	56.26022766326963
2025-10-29 18:50:00+00	beta	56.27835386279717
2025-10-29 17:15:00+00	beta	47.87339781228214
2025-10-29 23:10:00+00	alpha	38.634266991976006
2025-10-29 10:35:00+00	gamma	42.29829607459964
2025-10-30 03:40:00+00	gamma	55.069247033980915
2025-10-29 23:20:00+00	beta	35.69173320801152
2025-10-29 19:00:00+00	alpha	54.11431842670872
2025-10-30 01:15:00+00	beta	62.26886350211855
2025-10-29 23:40:00+00	alpha	48.77375344243223
2025-10-29 20:10:00+00	beta	62.246234765723464
2025-10-29 16:40:00+00	gamma	43.80682653626424
2025-10-29 14:35:00+00	gamma	58.98520575253777
2025-10-29 10:40:00+00	beta	54.98323483464873
2025-10-29 09:40:00+00	gamma	49.22019812937004
2025-10-29 07:50:00+00	beta	58.32057949544122
2025-10-29 21:55:00+00	gamma	50.59448428317563
2025-10-29 21:35:00+00	alpha	62.04665660678129
2025-10-29 18:20:00+00	gamma	49.405395173299425
2025-10-29 16:00:00+00	beta	52.65991483519737
2025-10-29 17:00:00+00	beta	46.2990515071373
2025-10-29 14:10:00+00	alpha	59.15717601889694
2025-10-29 20:25:00+00	gamma	61.814189573468944
2025-10-29 11:10:00+00	alpha	53.417028343722734
2025-10-29 20:05:00+00	alpha	44.80623886853927
2025-10-29 16:10:00+00	beta	48.36894942992443
2025-10-30 00:15:00+00	alpha	47.548966310470526
2025-10-29 12:35:00+00	beta	49.098997437995024
2025-10-29 16:30:00+00	gamma	44.05099264174693
2025-10-29 13:10:00+00	beta	64.25911926022823
2025-10-29 19:45:00+00	gamma	61.352667259970644
2025-10-29 11:25:00+00	gamma	45.39545430976511
2025-10-29 10:55:00+00	alpha	27.091312614064243
2025-10-29 08:35:00+00	gamma	57.71889219675246
2025-10-29 01:25:00+00	beta	48.94826956080851
2025-10-29 01:55:00+00	beta	56.00456819285438
2025-10-29 05:35:00+00	gamma	48.757297570212685
2025-10-29 11:20:00+00	gamma	44.21179372104477
2025-10-30 00:45:00+00	alpha	48.86610495011007
2025-10-29 04:55:00+00	alpha	55.79953676849529
2025-10-30 02:45:00+00	beta	63.17324552034059
2025-10-29 06:05:00+00	beta	53.62446155710772
2025-10-30 01:45:00+00	gamma	58.6269521578872
2025-10-29 16:35:00+00	alpha	43.498392187616
2025-10-29 12:30:00+00	beta	46.341772916971465
2025-10-29 23:55:00+00	gamma	43.60301441647748
2025-10-29 08:00:00+00	alpha	42.2980195852859
2025-10-29 16:25:00+00	gamma	43.72629149548197
2025-10-29 04:00:00+00	beta	46.23828284913939
2025-10-29 20:35:00+00	alpha	57.22307090080177
2025-10-29 18:35:00+00	alpha	56.586225407874245
2025-10-29 03:25:00+00	beta	67.8134803913358
2025-10-29 10:30:00+00	alpha	44.296928538965986
2025-10-30 02:10:00+00	alpha	61.33916544540091
2025-10-29 18:40:00+00	beta	39.67942418390434
2025-10-30 02:55:00+00	beta	61.52596648638091
2025-10-30 00:20:00+00	alpha	53.253089132307835
2025-10-29 16:45:00+00	beta	40.57871754077251
2025-10-29 18:45:00+00	beta	63.41825674565329
2025-10-29 01:20:00+00	beta	55.572864573106926
2025-10-29 11:30:00+00	alpha	34.17900348408473
2025-10-29 23:40:00+00	gamma	42.943738985118365
2025-10-29 10:40:00+00	alpha	45.82312004297983
2025-10-29 17:35:00+00	beta	45.81133004841716
2025-10-29 18:30:00+00	gamma	51.49059823887408
2025-10-29 10:00:00+00	alpha	43.21426886142985
2025-10-29 04:40:00+00	beta	47.3907018279124
2025-10-29 10:45:00+00	gamma	41.60649258748919
2025-10-29 08:35:00+00	beta	42.88807807386868
2025-10-29 15:05:00+00	beta	48.59579411202854
2025-10-29 04:55:00+00	beta	58.61559824816544
2025-10-30 00:00:00+00	alpha	44.106585342237835
2025-10-29 07:55:00+00	gamma	62.001683937449585
2025-10-29 20:00:00+00	alpha	51.792606828166015
2025-10-29 06:40:00+00	alpha	57.91077094058577
2025-10-29 21:05:00+00	beta	56.65910416546048
2025-10-29 02:35:00+00	alpha	61.579314167091965
2025-10-29 00:15:00+00	beta	55.90217419005171
2025-10-29 08:00:00+00	beta	64.25505574597562
2025-10-29 16:45:00+00	alpha	42.56004628800394
2025-10-30 01:00:00+00	alpha	41.0000611015259
2025-10-29 23:15:00+00	beta	44.704946604926214
2025-10-29 09:40:00+00	beta	43.96181577379837
2025-10-30 00:25:00+00	alpha	57.10559532163033
2025-10-29 07:35:00+00	alpha	51.611066159680185
2025-10-29 04:10:00+00	gamma	43.20900547254666
2025-10-29 08:45:00+00	beta	52.60718036694452
2025-10-29 12:55:00+00	alpha	59.175614766848675
2025-10-29 14:25:00+00	alpha	69.4584368404165
2025-10-29 09:45:00+00	alpha	39.177611635433195
2025-10-29 04:00:00+00	alpha	46.79588530481148
2025-10-30 03:20:00+00	gamma	59.62193845510423
2025-10-29 21:20:00+00	beta	62.64709874213876
2025-10-29 02:50:00+00	beta	48.98328058483954
2025-10-29 20:45:00+00	gamma	61.45946461464954
2025-10-29 16:10:00+00	alpha	53.389806165579955
2025-10-29 03:30:00+00	alpha	37.98058804005039
2025-10-29 02:00:00+00	alpha	32.340639125081246
2025-10-29 22:10:00+00	beta	54.57164713030892
2025-10-29 08:15:00+00	alpha	55.1705790307571
2025-10-30 02:20:00+00	alpha	63.25163592327745
2025-10-29 21:30:00+00	beta	52.63980605856877
2025-10-29 07:15:00+00	beta	58.679552212950775
2025-10-30 03:55:00+00	beta	53.74009214641892
2025-10-29 13:00:00+00	alpha	62.341075605707566
2025-10-29 15:10:00+00	gamma	55.10816554804252
2025-10-29 11:55:00+00	alpha	49.054115079349955
2025-10-29 12:05:00+00	beta	44.73057899154533
2025-10-29 17:20:00+00	beta	46.9369826740441
2025-10-29 09:25:00+00	alpha	56.637195323914355
2025-10-29 08:20:00+00	gamma	59.687051980102865
2025-10-29 11:15:00+00	gamma	43.92616137838602
2025-10-29 04:15:00+00	alpha	51.12378201571778
2025-10-29 23:45:00+00	gamma	42.833694208307506
2025-10-29 00:25:00+00	alpha	51.996059024802115
2025-10-29 11:05:00+00	beta	43.64795531917356
2025-10-29 10:10:00+00	beta	48.39694411751371
2025-10-29 23:45:00+00	alpha	55.330916886601074
2025-10-29 11:45:00+00	gamma	47.503715993603656
2025-10-29 20:50:00+00	alpha	48.71797678275111
2025-10-29 16:55:00+00	beta	52.54322372249383
2025-10-29 10:40:00+00	gamma	43.196143572946994
2025-10-29 21:40:00+00	alpha	64.60292234278941
2025-10-29 09:35:00+00	beta	65.460467591532
2025-10-29 15:30:00+00	gamma	52.264772449494046
2025-10-29 14:05:00+00	beta	65.18137685456972
2025-10-29 12:00:00+00	beta	43.05566182893348
2025-10-29 01:45:00+00	beta	55.777814276340486
2025-10-29 18:25:00+00	gamma	50.38414000738406
2025-10-29 15:35:00+00	gamma	51.438151546251845
2025-10-29 05:25:00+00	alpha	52.61361312825581
2025-10-29 02:20:00+00	beta	79.1469830084191
2025-10-30 00:40:00+00	gamma	50.56428002421977
2025-10-29 13:35:00+00	beta	49.246419694343686
2025-10-29 23:15:00+00	gamma	42.52541045110068
2025-10-29 09:05:00+00	gamma	53.46540186730107
2025-10-29 17:20:00+00	gamma	43.21444106260097
2025-10-29 02:10:00+00	alpha	64.19136351951913
2025-10-29 04:45:00+00	beta	47.957567635790866
2025-10-29 00:15:00+00	alpha	59.20264660181781
2025-10-29 22:45:00+00	alpha	54.03520045560816
2025-10-30 03:15:00+00	alpha	58.83696240491751
2025-10-29 03:50:00+00	beta	37.943701686786966
2025-10-29 07:25:00+00	gamma	61.63600284895098
2025-10-29 14:05:00+00	alpha	59.04932331107318
2025-10-29 12:10:00+00	gamma	50.210645056327124
2025-10-30 01:35:00+00	gamma	60.118271211553996
2025-10-29 11:55:00+00	gamma	47.756939402926804
2025-10-30 01:20:00+00	beta	54.72171776227085
2025-10-30 02:50:00+00	alpha	61.251584096175215
2025-10-29 17:40:00+00	gamma	44.94806346663317
2025-10-29 03:00:00+00	beta	48.36858071480471
2025-10-29 08:20:00+00	beta	50.888144697580685
2025-10-29 18:50:00+00	gamma	54.58078668113556
2025-10-29 17:05:00+00	gamma	41.568132368908245
2025-10-29 18:10:00+00	beta	48.864546417115704
2025-10-29 02:25:00+00	beta	52.0535144278501
2025-10-29 02:35:00+00	beta	57.16750252935013
2025-10-29 17:30:00+00	beta	46.032578546235655
2025-10-30 03:50:00+00	gamma	55.32636765480078
2025-10-29 13:55:00+00	beta	54.06026534730388
2025-10-29 11:25:00+00	beta	55.487106386616254
2025-10-29 10:45:00+00	alpha	44.68866235101899
2025-10-29 23:05:00+00	gamma	41.7663514614159
2025-10-29 23:50:00+00	gamma	43.700790375791534
2025-10-29 08:45:00+00	alpha	49.175875775537115
2025-10-29 20:30:00+00	gamma	61.48430581184378
2025-10-29 19:55:00+00	alpha	50.915200343497375
2025-10-29 20:50:00+00	gamma	58.89281480934743
2025-10-29 01:10:00+00	alpha	37.361642210432365
2025-10-29 02:30:00+00	beta	70.19110989612537
2025-10-29 00:40:00+00	beta	51.20401712545489
2025-10-29 11:30:00+00	gamma	43.95809645778435
2025-10-30 01:55:00+00	beta	52.140461945429344
2025-10-29 13:55:00+00	alpha	57.96135074207391
2025-10-29 19:15:00+00	gamma	58.52297926331046
2025-10-29 23:35:00+00	gamma	43.041348751511485
2025-10-29 05:10:00+00	gamma	44.946108320994455
2025-10-30 03:40:00+00	alpha	55.8409196637729
2025-10-30 04:05:00+00	gamma	53.68429792406936
2025-10-29 02:45:00+00	beta	54.96141234430435
2025-10-29 11:15:00+00	beta	45.934695754285826
2025-10-30 02:25:00+00	beta	63.46264593791342
2025-10-29 04:05:00+00	beta	47.292337546654
2025-10-29 11:05:00+00	gamma	42.765342680137266
2025-10-30 00:40:00+00	alpha	54.013451865682384
2025-10-29 08:10:00+00	beta	63.76131025217884
2025-10-30 01:55:00+00	alpha	64.6211952959224
2025-10-30 00:10:00+00	beta	41.266931217190574
2025-10-29 23:10:00+00	gamma	42.955222910755296
2025-10-30 00:50:00+00	gamma	52.72018564452683
2025-10-30 00:20:00+00	gamma	47.45870023463036
2025-10-29 22:55:00+00	beta	50.11315322723295
2025-10-29 12:10:00+00	beta	57.88946634760306
2025-10-30 02:50:00+00	gamma	62.50108655471898
2025-10-29 05:10:00+00	alpha	45.75524581328098
2025-10-29 08:35:00+00	alpha	61.193140077912155
2025-10-30 00:05:00+00	alpha	42.66173307332796
2025-10-29 18:55:00+00	beta	61.74655052732735
2025-10-29 01:10:00+00	beta	72.23445886817305
2025-10-29 20:55:00+00	alpha	45.118639367981835
2025-10-29 17:35:00+00	alpha	43.031607001675425
2025-10-30 01:40:00+00	beta	65.35086107861079
2025-10-29 08:40:00+00	beta	54.91654038263757
2025-10-30 01:05:00+00	gamma	54.53977163388991
2025-10-29 22:10:00+00	gamma	49.104113874272834
2025-10-29 05:00:00+00	beta	51.84613615407509
2025-10-29 17:10:00+00	gamma	42.93782073246831
2025-10-29 14:45:00+00	beta	65.85711626314436
2025-10-29 17:55:00+00	gamma	45.98938074716985
2025-10-29 22:00:00+00	alpha	46.3412420775854
2025-10-29 03:20:00+00	beta	44.26601713472026
2025-10-30 02:15:00+00	alpha	63.087990798999705
2025-10-29 06:35:00+00	alpha	55.27435885044391
2025-10-29 07:55:00+00	beta	54.92947246289721
2025-10-30 00:00:00+00	beta	53.22441764207563
2025-10-29 21:10:00+00	gamma	57.845151044772976
2025-10-29 03:15:00+00	alpha	50.89431831820107
2025-10-29 12:50:00+00	beta	52.31145410668697
2025-10-29 06:20:00+00	alpha	50.343063269939805
2025-10-29 15:50:00+00	gamma	48.51541573096514
2025-10-29 18:45:00+00	alpha	47.48723536697376
2025-10-29 09:30:00+00	beta	40.34226479508557
2025-10-29 08:50:00+00	alpha	53.971199860439455
2025-10-30 02:05:00+00	alpha	49.23908244935153
2025-10-29 04:55:00+00	gamma	43.604138730749106
2025-10-29 17:15:00+00	alpha	53.57097696820257
2025-10-29 11:00:00+00	beta	45.57748725429978
2025-10-29 06:15:00+00	gamma	54.706830750313635
2025-10-29 16:55:00+00	gamma	43.88282435510923
2025-10-29 08:55:00+00	beta	55.40105133369413
2025-10-29 01:15:00+00	alpha	51.74625669001978
2025-10-30 00:10:00+00	alpha	43.90109815263925
2025-10-29 05:15:00+00	alpha	51.27961189896833
2025-10-29 03:00:00+00	alpha	44.628070359468914
2025-10-29 16:25:00+00	beta	53.65757240419197
2025-10-29 20:30:00+00	beta	43.40355569209957
2025-10-29 23:00:00+00	gamma	42.62591920108097
2025-10-29 07:15:00+00	alpha	55.918986026969606
2025-10-29 23:50:00+00	alpha	35.251510639724174
2025-10-29 16:00:00+00	alpha	41.32068799908004
2025-10-29 10:15:00+00	beta	48.87477101127393
2025-10-29 23:35:00+00	alpha	50.19287912427843
2025-10-29 15:45:00+00	alpha	41.634433126940635
2025-10-29 14:20:00+00	alpha	58.79452553890748
2025-10-29 11:00:00+00	gamma	43.95186090444447
2025-10-29 15:45:00+00	beta	50.07395579660502
2025-10-29 11:50:00+00	gamma	48.54171801770658
2025-10-29 13:10:00+00	gamma	59.903901849136936
2025-10-30 02:00:00+00	gamma	60.85766041814726
2025-10-29 04:30:00+00	alpha	43.78545752436527
2025-10-30 01:35:00+00	beta	41.17583873935882
2025-10-29 18:00:00+00	alpha	39.4514856933063
2025-10-29 18:15:00+00	alpha	49.6011019159683
2025-10-29 02:15:00+00	beta	56.43091034327553
2025-10-29 09:00:00+00	gamma	54.21897048261458
2025-10-29 10:50:00+00	gamma	43.53388581854208
2025-10-29 21:20:00+00	gamma	57.00671653381287
2025-10-29 06:10:00+00	gamma	52.00012185991826
2025-10-29 10:35:00+00	beta	50.24812523376683
2025-10-29 22:25:00+00	alpha	40.35959457290248
2025-10-29 19:55:00+00	beta	59.76801938704974
2025-10-30 00:35:00+00	beta	51.757034371446366
2025-10-29 14:10:00+00	beta	65.50701267161072
2025-10-29 07:55:00+00	alpha	62.62897397363438
2025-10-29 15:45:00+00	gamma	49.34649754937636
2025-10-30 02:45:00+00	alpha	61.58006599795933
2025-10-29 11:35:00+00	alpha	43.70534013139026
2025-10-29 12:30:00+00	gamma	54.901983031011085
2025-10-29 10:15:00+00	alpha	50.69209413804733
2025-10-29 14:00:00+00	alpha	57.52170782939817
2025-10-29 12:35:00+00	alpha	61.135194810106
2025-10-29 14:15:00+00	gamma	61.780378040108914
2025-10-29 01:50:00+00	alpha	53.54149681052975
2025-10-30 00:30:00+00	beta	40.44223847374742
2025-10-29 20:40:00+00	beta	53.91542726756022
2025-10-29 07:10:00+00	beta	54.52733472851094
2025-10-30 00:35:00+00	alpha	52.2529200963437
2025-10-29 07:05:00+00	gamma	61.03390032888585
2025-10-30 01:20:00+00	gamma	56.46228463612132
2025-10-29 23:35:00+00	beta	53.2224572483653
2025-10-29 06:10:00+00	beta	50.06902059981929
2025-10-29 12:00:00+00	alpha	45.55945024144118
2025-10-29 16:25:00+00	alpha	53.15347597732146
2025-10-29 06:50:00+00	gamma	59.5914629197346
2025-10-29 18:35:00+00	gamma	51.92906276294231
2025-10-29 21:45:00+00	beta	57.0302174226969
2025-10-29 01:20:00+00	alpha	67.98593791687001
2025-10-29 06:25:00+00	alpha	58.055441912829664
2025-10-29 00:05:00+00	beta	46.666332472655334
2025-10-29 09:00:00+00	beta	51.056140727528316
2025-10-29 15:00:00+00	gamma	57.92913426960981
2025-10-29 04:30:00+00	gamma	42.77867124402125
2025-10-29 10:30:00+00	gamma	42.49080440971877
2025-10-29 00:55:00+00	alpha	45.07814062186371
2025-10-29 17:25:00+00	beta	63.844968961437075
2025-10-30 02:30:00+00	gamma	62.33977071977231
2025-10-29 19:10:00+00	gamma	58.36564190954647
2025-10-29 04:35:00+00	gamma	42.161174390686035
2025-10-29 01:00:00+00	beta	65.86629691961801
2025-10-29 05:45:00+00	alpha	52.9290223457961
2025-10-29 01:35:00+00	beta	57.142436964771676
2025-10-29 04:50:00+00	gamma	44.069669684213046
2025-10-29 13:25:00+00	beta	55.413987802018426
2025-10-29 12:40:00+00	gamma	55.38494782189248
2025-10-29 22:55:00+00	alpha	51.76519587565559
2025-10-29 21:15:00+00	alpha	50.63436751802737
2025-10-29 17:50:00+00	alpha	39.29237537183194
2025-10-29 16:20:00+00	beta	61.03242146311224
2025-10-30 02:50:00+00	beta	61.39236943949684
2025-10-29 05:10:00+00	beta	50.2694826040204
2025-10-29 10:30:00+00	beta	44.3426182402648
2025-10-29 12:40:00+00	alpha	55.891958355397534
2025-10-29 22:30:00+00	gamma	47.518883135133024
2025-10-29 20:25:00+00	beta	46.99181135594593
2025-10-29 06:30:00+00	beta	62.141900210327684
2025-10-29 06:20:00+00	beta	47.17882558740198
2025-10-29 03:10:00+00	beta	45.745768712348514
2025-10-29 11:40:00+00	alpha	51.27808918828227
2025-10-29 18:15:00+00	gamma	49.607438218095595
2025-10-29 09:30:00+00	gamma	48.490914793235355
2025-10-29 13:50:00+00	beta	60.32701164524441
2025-10-29 13:40:00+00	gamma	63.02203644747029
2025-10-29 19:35:00+00	alpha	59.80287697863738
2025-10-29 08:20:00+00	alpha	47.18165756986428
2025-10-30 03:55:00+00	alpha	53.125431585506576
2025-10-29 17:25:00+00	alpha	46.860661191748804
2025-10-30 00:05:00+00	gamma	44.94171984133279
2025-10-29 10:10:00+00	alpha	41.26894684443169
2025-10-29 13:35:00+00	alpha	74.64328212510215
2025-10-29 09:10:00+00	gamma	51.81538238151703
2025-10-29 13:55:00+00	gamma	63.18807936419588
2025-10-30 00:30:00+00	alpha	55.25185192446916
2025-10-29 02:55:00+00	alpha	71.83768993968604
2025-10-29 19:30:00+00	alpha	50.44636466594991
2025-10-29 02:40:00+00	alpha	15.007737515305825
2025-10-29 15:50:00+00	alpha	52.170008148942294
2025-10-29 12:05:00+00	alpha	38.404454195782805
2025-10-29 09:15:00+00	beta	43.22705289883253
2025-10-30 00:50:00+00	alpha	62.278671388474734
2025-10-30 01:25:00+00	beta	46.7247913599699
2025-10-29 18:40:00+00	alpha	53.6732236827948
2025-10-29 01:30:00+00	alpha	61.72491037692318
2025-10-29 10:20:00+00	alpha	51.42109052299742
2025-10-30 03:20:00+00	alpha	58.53493497769698
2025-10-29 10:05:00+00	alpha	50.816803178131295
2025-10-29 21:05:00+00	gamma	59.48806787921276
2025-10-29 17:05:00+00	beta	44.509408742682716
2025-10-29 00:30:00+00	alpha	40.745928611700734
2025-10-29 09:55:00+00	beta	38.00756085458915
2025-10-29 15:50:00+00	beta	49.08344257110375
2025-10-29 10:05:00+00	beta	49.39677188898251
2025-10-30 03:35:00+00	beta	56.41559430999054
2025-10-29 06:30:00+00	alpha	59.42693310335413
2025-10-29 06:45:00+00	gamma	58.4210979769843
2025-10-29 03:10:00+00	alpha	56.348456544935246
2025-10-29 07:35:00+00	gamma	62.1577605547313
2025-10-30 01:15:00+00	alpha	48.04683480878741
2025-10-30 01:50:00+00	beta	50.02283955779882
2025-10-29 16:40:00+00	beta	41.521855252939844
2025-10-29 05:30:00+00	gamma	47.73168768074662
2025-10-30 02:55:00+00	alpha	61.600807834065314
2025-10-29 05:40:00+00	alpha	55.3058428366126
2025-10-29 07:10:00+00	gamma	60.95103273353482
2025-10-30 02:35:00+00	alpha	62.490604506563855
2025-10-30 03:05:00+00	beta	61.32236342674567
2025-10-29 05:50:00+00	gamma	50.49899429251883
2025-10-29 05:50:00+00	alpha	41.09296273207367
2025-10-29 20:05:00+00	gamma	62.76714008282831
2025-10-30 00:15:00+00	gamma	45.933310036884606
2025-10-29 22:05:00+00	beta	52.41802733984722
2025-10-29 05:05:00+00	gamma	45.691239165456594
2025-10-29 02:05:00+00	beta	48.31605206900991
2025-10-29 00:45:00+00	alpha	44.683940153465024
2025-10-30 02:35:00+00	beta	62.39297344303484
2025-10-29 13:40:00+00	alpha	58.03178076026272
2025-10-29 20:55:00+00	gamma	59.16872024115288
2025-10-29 18:45:00+00	gamma	54.430733572212866
2025-10-30 03:30:00+00	gamma	57.595839933199045
2025-10-29 18:25:00+00	beta	45.93884235383985
2025-10-30 03:30:00+00	alpha	58.099003868033
2025-10-29 07:05:00+00	alpha	64.31360079565908
2025-10-29 23:20:00+00	gamma	43.37873943900374
2025-10-29 14:05:00+00	gamma	61.51959377704735
2025-10-29 12:10:00+00	alpha	64.34230049295424
2025-10-29 00:00:00+00	beta	54.47950434416798
2025-10-29 07:15:00+00	gamma	61.18693326098709
2025-10-29 16:30:00+00	beta	50.63997733760829
2025-10-29 20:20:00+00	gamma	61.547430745380645
2025-10-29 23:30:00+00	gamma	42.742380899035915
2025-10-29 02:10:00+00	beta	49.107642381379435
2025-10-29 16:15:00+00	alpha	31.490934459332692
2025-10-29 22:35:00+00	alpha	55.98742993495523
2025-10-29 06:15:00+00	alpha	51.38033833704926
2025-10-29 09:55:00+00	gamma	46.45878570283958
2025-10-29 17:20:00+00	alpha	47.31674656608774
2025-10-29 15:40:00+00	gamma	49.739228598444946
2025-10-29 20:40:00+00	alpha	53.61412941926543
2025-10-30 00:35:00+00	gamma	49.00322893867674
2025-10-29 05:25:00+00	beta	43.17061607450841
2025-10-29 14:20:00+00	beta	51.36634055580633
2025-10-30 01:10:00+00	beta	61.73154440134192
2025-10-29 19:20:00+00	alpha	65.4570753997328
2025-10-29 19:35:00+00	gamma	60.955213464577035
2025-10-30 00:30:00+00	gamma	48.533024520392544
2025-10-29 06:00:00+00	gamma	51.410746023316435
2025-10-29 22:20:00+00	gamma	47.217180331700504
2025-10-29 06:25:00+00	beta	57.6872340954547
2025-10-29 13:25:00+00	alpha	45.75575605902075
2025-10-29 07:10:00+00	alpha	52.916837276258704
2025-10-29 10:45:00+00	beta	47.366968767742385
2025-10-30 03:55:00+00	gamma	54.52677629753805
2025-10-29 21:25:00+00	alpha	58.98434294405547
2025-10-30 01:40:00+00	gamma	60.13586364956423
2025-10-30 02:40:00+00	gamma	63.051147161253496
2025-10-29 23:25:00+00	beta	45.38344188913311
2025-10-29 23:00:00+00	beta	46.21876683530074
2025-10-30 04:00:00+00	alpha	53.25086305401855
2025-10-29 07:50:00+00	gamma	62.60435404187516
2025-10-30 02:45:00+00	gamma	61.923946395584835
2025-10-29 18:05:00+00	alpha	56.16922470739572
2025-10-29 18:55:00+00	alpha	51.59102871005066
2025-10-29 18:20:00+00	beta	46.05622797384236
2025-10-29 09:10:00+00	beta	51.587615511781586
2025-10-29 12:20:00+00	beta	49.596591849910006
2025-10-29 20:05:00+00	beta	48.369830103440826
2025-10-30 01:05:00+00	beta	55.390578801632515
2025-10-29 09:50:00+00	gamma	46.47707894423879
2025-10-29 04:10:00+00	beta	45.117399419906334
2025-10-29 19:00:00+00	beta	44.766564099807724
2025-10-29 11:35:00+00	beta	47.888411923457014
2025-10-30 01:45:00+00	beta	59.49687300428245
2025-10-29 18:00:00+00	beta	40.14116499132896
2025-10-29 20:55:00+00	beta	57.3443131789305
2025-10-30 01:20:00+00	alpha	51.10576850990047
2025-10-29 11:35:00+00	gamma	45.343930344944525
2025-10-29 20:35:00+00	beta	55.50177853726281
2025-10-29 16:30:00+00	alpha	42.88545836310895
2025-10-30 01:35:00+00	alpha	56.83037593849525
2025-10-29 21:25:00+00	beta	54.149402096879136
2025-10-29 23:30:00+00	alpha	46.3067102599502
2025-10-29 05:20:00+00	alpha	63.104579262894504
2025-10-29 08:25:00+00	gamma	59.46816457136042
2025-10-29 19:30:00+00	gamma	60.22329490399896
2025-10-29 05:40:00+00	beta	50.18028483030588
2025-10-29 21:50:00+00	beta	58.007406302520074
2025-10-29 13:15:00+00	alpha	60.846610161236846
2025-10-29 21:00:00+00	gamma	58.58039968635692
2025-10-29 07:30:00+00	alpha	55.6043556411786
2025-10-29 22:30:00+00	beta	45.46415920960166
2025-10-29 18:35:00+00	beta	56.61814583866207
2025-10-30 00:45:00+00	gamma	50.741117428663316
2025-10-29 21:45:00+00	alpha	59.53469860643226
2025-10-29 12:20:00+00	gamma	53.16314017932207
2025-10-30 03:05:00+00	alpha	60.24535580936538
2025-10-29 09:35:00+00	alpha	38.43779690038167
2025-10-29 05:25:00+00	gamma	45.75147021046626
2025-10-29 19:30:00+00	beta	62.505978330712516
2025-10-29 07:25:00+00	beta	71.27729007177155
2025-10-29 04:20:00+00	gamma	42.79495007038895
2025-10-29 20:10:00+00	gamma	61.94076917262989
2025-10-29 11:55:00+00	beta	34.51469408136886
2025-10-29 22:20:00+00	alpha	45.48059359349315
2025-10-29 06:05:00+00	gamma	52.55587884715661
2025-10-29 10:05:00+00	gamma	44.054986311758555
2025-10-30 02:40:00+00	alpha	62.38784285811846
2025-10-29 22:50:00+00	gamma	43.9048426043317
2025-10-29 11:40:00+00	beta	45.57935168468693
2025-10-29 02:50:00+00	alpha	40.455791817510004
2025-10-29 20:15:00+00	beta	46.61917409689036
2025-10-29 06:50:00+00	alpha	49.41501284033652
2025-10-29 18:30:00+00	alpha	46.41080348843831
2025-10-29 06:55:00+00	alpha	56.65684499205518
2025-10-29 16:15:00+00	beta	49.05329194629737
2025-10-29 22:00:00+00	beta	54.24728756478527
2025-10-29 15:20:00+00	beta	58.22944458564281
2025-10-29 21:15:00+00	gamma	58.006308798760855
2025-10-29 16:05:00+00	beta	44.37243396175301
2025-10-29 21:40:00+00	beta	60.51313005632612
2025-10-30 03:35:00+00	alpha	57.06115285108926
2025-10-29 21:55:00+00	beta	53.440730921492204
2025-10-30 03:00:00+00	beta	61.81965717009952
2025-10-29 16:35:00+00	beta	53.4174239704191
2025-10-30 02:00:00+00	alpha	53.88366759857445
2025-10-29 08:30:00+00	gamma	58.307611697009044
2025-10-30 02:20:00+00	beta	61.10342082980063
2025-10-29 13:30:00+00	gamma	61.664387169200054
2025-10-29 07:40:00+00	beta	49.15988204438347
2025-10-29 01:55:00+00	alpha	55.3840572851434
2025-10-29 16:40:00+00	alpha	46.633787757582375
2025-10-29 09:20:00+00	gamma	50.657604337754705
2025-10-29 11:15:00+00	alpha	42.90812679512959
2025-10-30 00:55:00+00	gamma	51.954603649763975
2025-10-29 22:40:00+00	beta	35.47540247387023
2025-10-29 21:45:00+00	gamma	51.8599456344629
2025-10-29 03:05:00+00	beta	43.72716369160416
2025-10-29 13:45:00+00	alpha	45.002998703063014
2025-10-29 21:20:00+00	alpha	60.59098695370329
2025-10-29 03:55:00+00	alpha	60.8971363520919
2025-10-29 03:05:00+00	alpha	58.021164153625094
2025-10-29 19:00:00+00	gamma	57.062218004135296
2025-10-29 04:20:00+00	alpha	50.314284001597734
2025-10-29 14:40:00+00	beta	51.967369836342925
2025-10-29 08:30:00+00	beta	51.11600668813022
2025-10-29 19:20:00+00	gamma	59.32403667520691
2025-10-29 09:45:00+00	gamma	48.01251195739785
2025-10-29 10:50:00+00	beta	49.45042144241599
2025-10-29 07:35:00+00	beta	55.577861719786014
2025-10-29 18:15:00+00	beta	44.06223339893452
2025-10-29 23:30:00+00	beta	45.486829234243096
2025-10-29 05:15:00+00	gamma	44.948623793106904
2025-10-29 17:25:00+00	gamma	41.70552048314384
2025-10-29 17:05:00+00	alpha	51.59094060466822
2025-10-29 08:45:00+00	gamma	57.660109505082914
2025-10-29 09:20:00+00	alpha	46.63488242169716
2025-10-29 13:25:00+00	gamma	60.75295368509512
2025-10-29 15:35:00+00	beta	53.82186710356611
2025-10-29 17:30:00+00	gamma	43.22974998399697
2025-10-29 04:45:00+00	gamma	43.869876966631736
2025-10-29 17:00:00+00	gamma	42.65965416500041
2025-10-29 07:20:00+00	beta	44.57290145833852
2025-10-30 03:15:00+00	gamma	59.04050158508661
2025-10-30 03:00:00+00	gamma	61.60357125168326
2025-10-29 04:35:00+00	alpha	39.290868904693475
2025-10-29 14:55:00+00	beta	53.20346497196677
2025-10-29 07:05:00+00	beta	47.9479479471113
2025-10-29 20:25:00+00	alpha	65.46543651497726
2025-10-29 14:25:00+00	beta	63.70128787928034
2025-10-29 13:20:00+00	alpha	49.94424722723049
2025-10-29 14:50:00+00	beta	62.15720662452027
2025-10-29 13:45:00+00	gamma	62.81308811212237
2025-10-29 19:15:00+00	beta	45.370979545649206
2025-10-29 12:55:00+00	gamma	58.392931705937414
2025-10-29 22:00:00+00	gamma	50.23718180678486
2025-10-29 02:25:00+00	alpha	55.91411424935539
2025-10-29 08:40:00+00	gamma	58.433921429934216
2025-10-29 19:50:00+00	alpha	62.82806236917976
2025-10-29 23:40:00+00	beta	42.56228150764134
2025-10-29 05:40:00+00	gamma	48.404251177644205
2025-10-29 12:30:00+00	alpha	51.968829815379365
2025-10-30 03:25:00+00	alpha	58.18420041383094
2025-10-30 00:10:00+00	gamma	46.04981506483907
2025-10-29 10:25:00+00	alpha	46.01943848005406
2025-10-29 15:55:00+00	alpha	53.566708243616084
2025-10-30 03:45:00+00	beta	54.560853943459094
2025-10-29 08:30:00+00	alpha	60.730976221279946
2025-10-29 06:45:00+00	alpha	62.89518155225329
2025-10-29 09:20:00+00	beta	45.40278803296737
2025-10-30 03:05:00+00	gamma	61.79298726285284
2025-10-29 00:50:00+00	beta	33.028362747046145
2025-10-29 20:50:00+00	beta	46.779600711743925
2025-10-29 14:00:00+00	gamma	61.436258281127586
2025-10-29 23:55:00+00	alpha	50.66519133057907
2025-10-29 22:25:00+00	beta	49.3974355437671
2025-10-29 05:30:00+00	alpha	53.921652581091124
2025-10-29 11:30:00+00	beta	40.81020039324258
2025-10-30 01:50:00+00	alpha	61.04139500019024
2025-10-29 20:35:00+00	gamma	62.238453648829704
2025-10-29 17:55:00+00	alpha	52.85297815290977
2025-10-29 21:00:00+00	beta	63.29199303779673
2025-10-30 02:05:00+00	gamma	61.071946805226716
2025-10-29 22:40:00+00	gamma	44.7104870964416
2025-10-29 17:35:00+00	gamma	44.67917190946553
2025-10-29 05:05:00+00	alpha	41.18582722528525
2025-10-30 01:30:00+00	gamma	58.243466448444146
2025-10-29 17:10:00+00	beta	52.661809936719294
2025-10-29 07:50:00+00	alpha	61.98663618316768
2025-10-29 19:55:00+00	gamma	62.91864185208124
2025-10-30 03:00:00+00	alpha	60.097799323086846
2025-10-29 15:55:00+00	gamma	49.30772682288331
2025-10-29 05:45:00+00	gamma	49.729817970697304
2025-10-29 09:05:00+00	beta	52.501074929435745
2025-10-29 04:10:00+00	alpha	52.03737258830431
2025-10-29 18:50:00+00	alpha	56.9812526673269
2025-10-29 02:05:00+00	alpha	34.15738310545191
2025-10-29 22:15:00+00	beta	49.65095841156315
2025-10-29 13:20:00+00	gamma	61.19272353499042
2025-10-30 02:55:00+00	gamma	60.90107960085548
2025-10-29 19:50:00+00	beta	53.82703693428888
2025-10-29 04:45:00+00	alpha	50.50568663791236
2025-10-29 14:15:00+00	beta	59.31984317079375
2025-10-29 22:10:00+00	alpha	53.60017869048588
2025-10-29 10:25:00+00	beta	44.64674636273386
2025-10-30 00:20:00+00	beta	38.35446964859042
2025-10-29 17:50:00+00	gamma	44.989776261237125
2025-10-29 20:00:00+00	beta	58.49651473610665
2025-10-29 02:40:00+00	beta	64.91430702475313
2025-10-29 19:05:00+00	gamma	56.450377294815965
2025-10-29 18:25:00+00	alpha	60.650818205305754
2025-10-30 00:40:00+00	beta	38.11313442420997
2025-10-29 15:30:00+00	beta	52.121892955045
2025-10-29 02:30:00+00	alpha	57.80109092106316
2025-10-29 14:00:00+00	beta	53.607557873639585
2025-10-30 00:15:00+00	beta	51.0510244940112
2025-10-29 22:35:00+00	beta	47.28878639468137
2025-10-29 08:55:00+00	alpha	40.381641301910804
2025-10-29 02:45:00+00	alpha	52.005183107512224
2025-10-29 09:10:00+00	alpha	47.64685724380664
2025-10-29 12:40:00+00	beta	47.54140618601126
2025-10-30 01:55:00+00	gamma	60.26117034858299
2025-10-29 20:30:00+00	alpha	60.45938694661263
2025-10-29 08:15:00+00	beta	52.20318782279569
2025-10-29 11:20:00+00	alpha	50.0256601064611
2025-10-29 14:45:00+00	gamma	59.67251047722128
2025-10-29 08:10:00+00	alpha	50.18221367346398
2025-10-29 14:30:00+00	alpha	54.95900560328391
2025-10-29 22:15:00+00	gamma	48.8423559230975
2025-10-29 13:30:00+00	beta	62.354739779657905
2025-10-30 03:10:00+00	beta	60.82258626023945
2025-10-30 01:25:00+00	gamma	58.04165606992662
2025-10-29 01:05:00+00	alpha	52.60662886798518
2025-10-29 00:40:00+00	alpha	79.59523314881696
2025-10-30 02:00:00+00	beta	60.400042695103636
2025-10-29 13:00:00+00	beta	51.489142710556465
2025-10-29 04:35:00+00	beta	42.959903279320294
2025-10-30 02:10:00+00	beta	64.03834375143872
2025-10-29 13:20:00+00	beta	46.895305363197636
2025-10-29 17:50:00+00	beta	59.43726261861441
2025-10-29 08:55:00+00	gamma	55.85569230595438
2025-10-29 02:15:00+00	alpha	29.098016700283846
2025-10-29 08:25:00+00	alpha	59.14250673176885
2025-10-29 00:55:00+00	beta	48.97367586169698
2025-10-29 15:40:00+00	beta	39.98179964954202
2025-10-29 05:15:00+00	beta	50.26793135321715
2025-10-29 16:05:00+00	gamma	47.498080599444606
2025-10-29 22:05:00+00	gamma	48.94821120733365
2025-10-29 11:50:00+00	alpha	48.29991027609049
2025-10-29 10:00:00+00	beta	52.974029691027134
2025-10-29 15:40:00+00	alpha	41.22328827401609
2025-10-29 04:25:00+00	alpha	42.77340622701382
2025-10-30 01:00:00+00	gamma	52.64671567371386
2025-10-29 19:25:00+00	beta	57.40129414496555
2025-10-29 12:35:00+00	gamma	53.81114013128562
2025-10-29 16:50:00+00	beta	42.05029009634218
2025-10-30 00:50:00+00	beta	50.578733298773386
2025-10-29 19:15:00+00	alpha	58.43151934361657
2025-10-29 19:10:00+00	beta	60.50362512075234
2025-10-29 05:20:00+00	gamma	45.335249254426884
2025-10-29 04:25:00+00	beta	44.36423926052901
2025-10-29 09:55:00+00	alpha	66.8414548982685
2025-10-29 05:50:00+00	beta	48.29820120661877
2025-10-29 15:20:00+00	alpha	56.31559925230825
2025-10-29 22:40:00+00	alpha	44.800439015628605
2025-10-29 22:30:00+00	alpha	45.456779665696544
2025-10-29 03:15:00+00	beta	55.907454591135206
2025-10-29 18:10:00+00	gamma	46.267763838111016
2025-10-29 21:05:00+00	alpha	63.01409287089344
2025-10-29 08:05:00+00	gamma	61.636119063873046
2025-10-29 09:50:00+00	alpha	59.53559967662933
2025-10-29 12:15:00+00	beta	56.3338886188434
2025-10-29 22:50:00+00	alpha	62.069994470884204
2025-10-30 01:30:00+00	beta	58.842532053269885
2025-10-29 14:50:00+00	gamma	57.78720657571313
2025-10-29 14:10:00+00	gamma	62.793336964336994
2025-10-29 07:30:00+00	beta	50.431784090332805
2025-10-29 08:50:00+00	gamma	56.77203296857842
2025-10-29 05:00:00+00	alpha	49.95983091676972
2025-10-29 12:45:00+00	gamma	56.788935266346925
2025-10-29 14:50:00+00	alpha	71.79658105078131
2025-10-29 09:25:00+00	beta	46.74299588796436
2025-10-29 17:40:00+00	alpha	47.099480158988484
2025-10-29 20:00:00+00	gamma	63.265778008325604
2025-10-30 03:15:00+00	beta	58.64156204063736
2025-10-29 16:20:00+00	alpha	38.30902717080018
2025-10-29 07:00:00+00	alpha	48.24254929882028
2025-10-29 18:05:00+00	gamma	46.98723286075999
2025-10-29 14:35:00+00	beta	49.271671103474226
2025-10-29 10:55:00+00	gamma	42.02948557507989
2025-10-29 19:25:00+00	gamma	59.63875085289443
2025-10-29 22:55:00+00	gamma	44.697860379008354
2025-10-29 01:35:00+00	alpha	37.11140942435621
2025-10-29 21:15:00+00	beta	42.70110938372259
2025-10-29 12:25:00+00	gamma	52.602819424448555
2025-10-29 14:45:00+00	alpha	52.763400903291526
2025-10-29 06:40:00+00	gamma	58.40597849653615
2025-10-29 12:05:00+00	gamma	49.41225676453979
2025-10-29 00:10:00+00	beta	50.802092824452494
2025-10-29 03:30:00+00	beta	15.228510136477627
2025-10-29 10:20:00+00	beta	39.14994671293523
2025-10-29 18:40:00+00	gamma	53.598657188013725
2025-10-29 09:05:00+00	alpha	60.279668683838054
2025-10-29 01:50:00+00	beta	51.5090221903924
2025-10-29 06:50:00+00	beta	46.59735684237749
2025-10-29 14:15:00+00	alpha	52.61800829149015
2025-10-29 16:10:00+00	gamma	45.43307810719372
2025-10-29 08:15:00+00	gamma	60.70628022815701
2025-10-30 03:25:00+00	beta	58.69738956236364
2025-10-29 17:10:00+00	alpha	57.83522067016732
2025-10-29 01:40:00+00	alpha	48.75435628661519
2025-10-29 16:20:00+00	gamma	44.89879527218543
\.


--
-- Data for Name: _hyper_5_9_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal._hyper_5_9_chunk (ts, val) FROM stdin;
2025-11-10 02:31:57.672823+00	1
2025-11-10 02:30:57.672823+00	2
2025-11-10 02:29:57.672823+00	3
2025-11-10 02:28:57.672823+00	4
2025-11-10 02:27:57.672823+00	5
2025-11-10 02:26:57.672823+00	6
2025-11-10 02:25:57.672823+00	7
2025-11-10 02:24:57.672823+00	8
2025-11-10 02:23:57.672823+00	9
2025-11-10 02:22:57.672823+00	10
2025-11-10 02:21:57.672823+00	11
2025-11-10 02:20:57.672823+00	12
2025-11-10 02:19:57.672823+00	13
2025-11-10 02:18:57.672823+00	14
2025-11-10 02:17:57.672823+00	15
2025-11-10 02:16:57.672823+00	16
2025-11-10 02:15:57.672823+00	17
2025-11-10 02:14:57.672823+00	18
2025-11-10 02:13:57.672823+00	19
2025-11-10 02:12:57.672823+00	20
2025-11-10 02:11:57.672823+00	21
2025-11-10 02:10:57.672823+00	22
2025-11-10 02:09:57.672823+00	23
2025-11-10 02:08:57.672823+00	24
2025-11-10 02:07:57.672823+00	25
2025-11-10 02:06:57.672823+00	26
2025-11-10 02:05:57.672823+00	27
2025-11-10 02:04:57.672823+00	28
2025-11-10 02:03:57.672823+00	29
2025-11-10 02:02:57.672823+00	30
2025-11-10 02:01:57.672823+00	31
2025-11-10 02:00:57.672823+00	32
2025-11-10 01:59:57.672823+00	33
2025-11-10 01:58:57.672823+00	34
2025-11-10 01:57:57.672823+00	35
2025-11-10 01:56:57.672823+00	36
2025-11-10 01:55:57.672823+00	37
2025-11-10 01:54:57.672823+00	38
2025-11-10 01:53:57.672823+00	39
2025-11-10 01:52:57.672823+00	40
2025-11-10 01:51:57.672823+00	41
2025-11-10 01:50:57.672823+00	42
2025-11-10 01:49:57.672823+00	43
2025-11-10 01:48:57.672823+00	44
2025-11-10 01:47:57.672823+00	45
2025-11-10 01:46:57.672823+00	46
2025-11-10 01:45:57.672823+00	47
2025-11-10 01:44:57.672823+00	48
2025-11-10 01:43:57.672823+00	49
2025-11-10 01:42:57.672823+00	50
2025-11-10 01:41:57.672823+00	51
2025-11-10 01:40:57.672823+00	52
2025-11-10 01:39:57.672823+00	53
2025-11-10 01:38:57.672823+00	54
2025-11-10 01:37:57.672823+00	55
2025-11-10 01:36:57.672823+00	56
2025-11-10 01:35:57.672823+00	57
2025-11-10 01:34:57.672823+00	58
2025-11-10 01:33:57.672823+00	59
2025-11-10 01:32:57.672823+00	60
2025-11-10 01:31:57.672823+00	61
2025-11-10 01:30:57.672823+00	62
2025-11-10 01:29:57.672823+00	63
2025-11-10 01:28:57.672823+00	64
2025-11-10 01:27:57.672823+00	65
2025-11-10 01:26:57.672823+00	66
2025-11-10 01:25:57.672823+00	67
2025-11-10 01:24:57.672823+00	68
2025-11-10 01:23:57.672823+00	69
2025-11-10 01:22:57.672823+00	70
2025-11-10 01:21:57.672823+00	71
2025-11-10 01:20:57.672823+00	72
2025-11-10 01:19:57.672823+00	73
2025-11-10 01:18:57.672823+00	74
2025-11-10 01:17:57.672823+00	75
2025-11-10 01:16:57.672823+00	76
2025-11-10 01:15:57.672823+00	77
2025-11-10 01:14:57.672823+00	78
2025-11-10 01:13:57.672823+00	79
2025-11-10 01:12:57.672823+00	80
2025-11-10 01:11:57.672823+00	81
2025-11-10 01:10:57.672823+00	82
2025-11-10 01:09:57.672823+00	83
2025-11-10 01:08:57.672823+00	84
2025-11-10 01:07:57.672823+00	85
2025-11-10 01:06:57.672823+00	86
2025-11-10 01:05:57.672823+00	87
2025-11-10 01:04:57.672823+00	88
2025-11-10 01:03:57.672823+00	89
2025-11-10 01:02:57.672823+00	90
2025-11-10 01:01:57.672823+00	91
2025-11-10 01:00:57.672823+00	92
2025-11-10 00:59:57.672823+00	93
2025-11-10 00:58:57.672823+00	94
2025-11-10 00:57:57.672823+00	95
2025-11-10 00:56:57.672823+00	96
2025-11-10 00:55:57.672823+00	97
2025-11-10 00:54:57.672823+00	98
2025-11-10 00:53:57.672823+00	99
2025-11-10 00:52:57.672823+00	100
2025-11-10 00:51:57.672823+00	101
2025-11-10 00:50:57.672823+00	102
2025-11-10 00:49:57.672823+00	103
2025-11-10 00:48:57.672823+00	104
2025-11-10 00:47:57.672823+00	105
2025-11-10 00:46:57.672823+00	106
2025-11-10 00:45:57.672823+00	107
2025-11-10 00:44:57.672823+00	108
2025-11-10 00:43:57.672823+00	109
2025-11-10 00:42:57.672823+00	110
2025-11-10 00:41:57.672823+00	111
2025-11-10 00:40:57.672823+00	112
2025-11-10 00:39:57.672823+00	113
2025-11-10 00:38:57.672823+00	114
2025-11-10 00:37:57.672823+00	115
2025-11-10 00:36:57.672823+00	116
2025-11-10 00:35:57.672823+00	117
2025-11-10 00:34:57.672823+00	118
2025-11-10 00:33:57.672823+00	119
2025-11-10 00:32:57.672823+00	120
2025-11-10 00:31:57.672823+00	121
2025-11-10 00:30:57.672823+00	122
2025-11-10 00:29:57.672823+00	123
2025-11-10 00:28:57.672823+00	124
2025-11-10 00:27:57.672823+00	125
2025-11-10 00:26:57.672823+00	126
2025-11-10 00:25:57.672823+00	127
2025-11-10 00:24:57.672823+00	128
2025-11-10 00:23:57.672823+00	129
2025-11-10 00:22:57.672823+00	130
2025-11-10 00:21:57.672823+00	131
2025-11-10 00:20:57.672823+00	132
2025-11-10 00:19:57.672823+00	133
2025-11-10 00:18:57.672823+00	134
2025-11-10 00:17:57.672823+00	135
2025-11-10 00:16:57.672823+00	136
2025-11-10 00:15:57.672823+00	137
2025-11-10 00:14:57.672823+00	138
2025-11-10 00:13:57.672823+00	139
2025-11-10 00:12:57.672823+00	140
2025-11-10 00:11:57.672823+00	141
2025-11-10 00:10:57.672823+00	142
2025-11-10 00:09:57.672823+00	143
2025-11-10 00:08:57.672823+00	144
2025-11-10 00:07:57.672823+00	145
2025-11-10 00:06:57.672823+00	146
2025-11-10 00:05:57.672823+00	147
2025-11-10 00:04:57.672823+00	148
2025-11-10 00:03:57.672823+00	149
2025-11-10 00:02:57.672823+00	150
2025-11-10 00:01:57.672823+00	151
2025-11-10 00:00:57.672823+00	152
2025-11-09 23:59:57.672823+00	153
2025-11-09 23:58:57.672823+00	154
2025-11-09 23:57:57.672823+00	155
2025-11-09 23:56:57.672823+00	156
2025-11-09 23:55:57.672823+00	157
2025-11-09 23:54:57.672823+00	158
2025-11-09 23:53:57.672823+00	159
2025-11-09 23:52:57.672823+00	160
2025-11-09 23:51:57.672823+00	161
2025-11-09 23:50:57.672823+00	162
2025-11-09 23:49:57.672823+00	163
2025-11-09 23:48:57.672823+00	164
2025-11-09 23:47:57.672823+00	165
2025-11-09 23:46:57.672823+00	166
2025-11-09 23:45:57.672823+00	167
2025-11-09 23:44:57.672823+00	168
2025-11-09 23:43:57.672823+00	169
2025-11-09 23:42:57.672823+00	170
2025-11-09 23:41:57.672823+00	171
2025-11-09 23:40:57.672823+00	172
2025-11-09 23:39:57.672823+00	173
2025-11-09 23:38:57.672823+00	174
2025-11-09 23:37:57.672823+00	175
2025-11-09 23:36:57.672823+00	176
2025-11-09 23:35:57.672823+00	177
2025-11-09 23:34:57.672823+00	178
2025-11-09 23:33:57.672823+00	179
2025-11-09 23:32:57.672823+00	180
2025-11-09 23:31:57.672823+00	181
2025-11-09 23:30:57.672823+00	182
2025-11-09 23:29:57.672823+00	183
2025-11-09 23:28:57.672823+00	184
2025-11-09 23:27:57.672823+00	185
2025-11-09 23:26:57.672823+00	186
2025-11-09 23:25:57.672823+00	187
2025-11-09 23:24:57.672823+00	188
2025-11-09 23:23:57.672823+00	189
2025-11-09 23:22:57.672823+00	190
2025-11-09 23:21:57.672823+00	191
2025-11-09 23:20:57.672823+00	192
2025-11-09 23:19:57.672823+00	193
2025-11-09 23:18:57.672823+00	194
2025-11-09 23:17:57.672823+00	195
2025-11-09 23:16:57.672823+00	196
2025-11-09 23:15:57.672823+00	197
2025-11-09 23:14:57.672823+00	198
2025-11-09 23:13:57.672823+00	199
2025-11-09 23:12:57.672823+00	200
2025-11-09 23:11:57.672823+00	201
2025-11-09 23:10:57.672823+00	202
2025-11-09 23:09:57.672823+00	203
2025-11-09 23:08:57.672823+00	204
2025-11-09 23:07:57.672823+00	205
2025-11-09 23:06:57.672823+00	206
2025-11-09 23:05:57.672823+00	207
2025-11-09 23:04:57.672823+00	208
2025-11-09 23:03:57.672823+00	209
2025-11-09 23:02:57.672823+00	210
2025-11-09 23:01:57.672823+00	211
2025-11-09 23:00:57.672823+00	212
2025-11-09 22:59:57.672823+00	213
2025-11-09 22:58:57.672823+00	214
2025-11-09 22:57:57.672823+00	215
2025-11-09 22:56:57.672823+00	216
2025-11-09 22:55:57.672823+00	217
2025-11-09 22:54:57.672823+00	218
2025-11-09 22:53:57.672823+00	219
2025-11-09 22:52:57.672823+00	220
2025-11-09 22:51:57.672823+00	221
2025-11-09 22:50:57.672823+00	222
2025-11-09 22:49:57.672823+00	223
2025-11-09 22:48:57.672823+00	224
2025-11-09 22:47:57.672823+00	225
2025-11-09 22:46:57.672823+00	226
2025-11-09 22:45:57.672823+00	227
2025-11-09 22:44:57.672823+00	228
2025-11-09 22:43:57.672823+00	229
2025-11-09 22:42:57.672823+00	230
2025-11-09 22:41:57.672823+00	231
2025-11-09 22:40:57.672823+00	232
2025-11-09 22:39:57.672823+00	233
2025-11-09 22:38:57.672823+00	234
2025-11-09 22:37:57.672823+00	235
2025-11-09 22:36:57.672823+00	236
2025-11-09 22:35:57.672823+00	237
2025-11-09 22:34:57.672823+00	238
2025-11-09 22:33:57.672823+00	239
2025-11-09 22:32:57.672823+00	240
2025-11-09 22:31:57.672823+00	241
2025-11-09 22:30:57.672823+00	242
2025-11-09 22:29:57.672823+00	243
2025-11-09 22:28:57.672823+00	244
2025-11-09 22:27:57.672823+00	245
2025-11-09 22:26:57.672823+00	246
2025-11-09 22:25:57.672823+00	247
2025-11-09 22:24:57.672823+00	248
2025-11-09 22:23:57.672823+00	249
2025-11-09 22:22:57.672823+00	250
2025-11-09 22:21:57.672823+00	251
2025-11-09 22:20:57.672823+00	252
2025-11-09 22:19:57.672823+00	253
2025-11-09 22:18:57.672823+00	254
2025-11-09 22:17:57.672823+00	255
2025-11-09 22:16:57.672823+00	256
2025-11-09 22:15:57.672823+00	257
2025-11-09 22:14:57.672823+00	258
2025-11-09 22:13:57.672823+00	259
2025-11-09 22:12:57.672823+00	260
2025-11-09 22:11:57.672823+00	261
2025-11-09 22:10:57.672823+00	262
2025-11-09 22:09:57.672823+00	263
2025-11-09 22:08:57.672823+00	264
2025-11-09 22:07:57.672823+00	265
2025-11-09 22:06:57.672823+00	266
2025-11-09 22:05:57.672823+00	267
2025-11-09 22:04:57.672823+00	268
2025-11-09 22:03:57.672823+00	269
2025-11-09 22:02:57.672823+00	270
2025-11-09 22:01:57.672823+00	271
2025-11-09 22:00:57.672823+00	272
2025-11-09 21:59:57.672823+00	273
2025-11-09 21:58:57.672823+00	274
2025-11-09 21:57:57.672823+00	275
2025-11-09 21:56:57.672823+00	276
2025-11-09 21:55:57.672823+00	277
2025-11-09 21:54:57.672823+00	278
2025-11-09 21:53:57.672823+00	279
2025-11-09 21:52:57.672823+00	280
2025-11-09 21:51:57.672823+00	281
2025-11-09 21:50:57.672823+00	282
2025-11-09 21:49:57.672823+00	283
2025-11-09 21:48:57.672823+00	284
2025-11-09 21:47:57.672823+00	285
2025-11-09 21:46:57.672823+00	286
2025-11-09 21:45:57.672823+00	287
2025-11-09 21:44:57.672823+00	288
2025-11-09 21:43:57.672823+00	289
2025-11-09 21:42:57.672823+00	290
2025-11-09 21:41:57.672823+00	291
2025-11-09 21:40:57.672823+00	292
2025-11-09 21:39:57.672823+00	293
2025-11-09 21:38:57.672823+00	294
2025-11-09 21:37:57.672823+00	295
2025-11-09 21:36:57.672823+00	296
2025-11-09 21:35:57.672823+00	297
2025-11-09 21:34:57.672823+00	298
2025-11-09 21:33:57.672823+00	299
2025-11-09 21:32:57.672823+00	300
\.


--
-- Data for Name: _materialized_hypertable_4; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal._materialized_hypertable_4 (bucket, series, avg_value) FROM stdin;
\.


--
-- Data for Name: compress_hyper_3_6_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal.compress_hyper_3_6_chunk (_ts_meta_count, series, _ts_meta_v2_min_id, _ts_meta_v2_max_id, id, _ts_meta_min_1, _ts_meta_max_1, ts, value) FROM stdin;
1000	alpha	3155	5153	BAAAAAAAAAAUIQAAAAAAAAACAAAD6AAAAAIAAAAAAAAA+wAAAAAYoRimAAA+QAAAAAA=	2025-10-28 07:20:10.66157+00	2025-10-28 23:59:10.66157+00	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
304	alpha	5155	5761	BAAAAAAAAAAWgQAAAAAAAAACAAABMAAAAAIAAAAAAAAA+wAAAAAoQShGAAASwAAAAAA=	2025-10-28 02:16:10.66157+00	2025-10-28 07:19:10.66157+00	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
1000	beta	3156	5154	BAAAAAAAAAAUIgAAAAAAAAACAAAD6AAAAAIAAAAAAAAA+wAAAAAYoxioAAA+QAAAAAA=	2025-10-28 07:20:10.66157+00	2025-10-28 23:59:10.66157+00	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
304	beta	5156	5762	BAAAAAAAAAAWggAAAAAAAAACAAABMAAAAAIAAAAAAAAA+wAAAAAoQyhIAAASwAAAAAA=	2025-10-28 02:16:10.66157+00	2025-10-28 07:19:10.66157+00	BAAAAuUtXjtmwv/////8bHkAAAABMAAAAAMAAAAAAAAP7gAFymMzsF+EAAXKYzrXbYMAABLgAAAAAA==	AwBAO4xCQEVUlgAAATAAAAABAAAAAAAAAA8AABMAAAAAAQAAATAAAAAFAAAAAAABER8AAARAAAAAAQAAAAsQAHWAEgAAbgIAAAA4DAAAAD4ADAAAAA78AAAAAAAACwKTCySiTCSiwc0stM8kkkkkLJJJJJJJKJLDCSSSSzCzS0ks4lEoks40NJJLJBBJLBASSzwSSSySTEEkksw0EkwkNBBJJLJPBBKUzSTCzgQSSwAAAAAAAAAAAAAAawAAAAsAAAZmZmZmZgy131zx21z5DTSzHfLffbcNtt9t99ttcQy1z1yzz003DK7bfXLPTTcNvfdtf/t9cg321210z231C//fPD/fHD0Nsf/N/t9tcg+830y/+311AAADe3DHTDIAAAEHHEsApgbDSjMPZ1F7swrOtsUJg8crHY1GJ7my9JHG1eFSLx18+khi4Y6VneCK3obmwraTutjAy7a2fvqAhX2Y/baRX4aoQodq9z53aJZNnyL8ZG8NnYsyCdUBjU+CGtbvdYpCCrqueGU+LGawSTT3JHrxvPjZWp4DDvtFec5FseOckQFq4x3rzSZ9PQ+NCxy7jP2tn0RiCncC7wPvBx/Yzv5Msw3bwIWG4W0IeeA66K/kqovtklfBu+nPFyxU6wzeXinL9cwNnoM7i9496XuxWuCjy+ngXmIAnFDMKhBX3Psme7uSvhuwkSdYNdTlNIXvIwWBt5JZdgFJU2CTeSpd5fsncJaRXOAPHL08fFxc5m2bVYntg9YX01QyK1W0CfuRQyY6pjHpemfIKUTW0LFhvly0GelldgLHzcYwjBcaWOp5HhOqpXTfp6FnqfVB6ERYJS+bRvwdq5QnvILGN58zKoJKDqqCNf+dxAnsSAZZ/7M8kv3pJd95HLf/6UVHc19wd3/+2PfXk1ViLLdDPMxxAkCU/nX8YNW64yF+V1n66l7MCC+AZse/Ynn9jrFV+kj50aRHzpYLICbBsd6xczf4rEwQKFB5Z9cW9YhyTtsfUxoqEd3poDbcFXYOWaZDbOx4lVDYzbdNVDwuWjqZ6lpkOFL4nCwZBwRCGL49zGcBnkcfI9wuBDbYgSsW8H+ygWhcIt0i3/V8AV804IDAI1iArs3ElaQlz9L6rWh1Yu+2ym89vFEj7bOR9EvG/DM47/ocMVpaItwKDM84qGEHJd7k29siVjrLytmS6/LE7c0m/blQbVfVWlgn68ciecPBkhbsl9e9ccAKX8TUplWFY30ujPFBESVoE4XGh+MvnrfkLf/l6T26BEfeP+JylmOnBBRgCO/yFUw3OpgCzbFsZRwP+xawlFerxJz/M7SM55pr6ZiqTlqvGvJbbgwD/b2UVtYVMbSxEYSn7ji+p+QWD1kNwQKlCXIQOb3mJtYRx9ooHj1oR+EL6Eu+NXLD1N5rg7rcdRGYuyYOq+9XQVOTF28STS3z/OXJekHl9Exr6sqk4Mdxr2PGshaX99wGcqwddL7u5rzNpT8ELI5NXwSYOFsL5wyGEXi+nDmuQ+WDCG2/0CdnoxmvZ7PocSTAa3wq3ig3tydl3c5ycQ8nNbsKj3vqzW3vAWTlcntXyz6Dw0aTDsVy6qCnQBWvrft9GqJawA/r19+TNcxtuWVQFjIg3qfRmYzPsZt4h9AM59CQ13uHrOm4BXVQMokjtF4yyFBVAMAxxcgeFYXb9Kj0XLnKc+XsLInOE9Vz1URx2eDXMcpEmUXsDJIeVJim0TB0D3iBJV1QjVDwXJm9Yk946aZxtLhZIo6VMjk3GonvwrdRJL8L0dgbZ5edReACaWYfCTii1cQCnj5oEbFQ6IBf7/13ysJMpqGP/0Bdy9IYiR8A/naN4k+tSgAGtz0Z55KBwDaWKV2636PgG95FzFHf91AAzMFVUJBNmAFJOPISROEJdxfTM5mNXh5YLcJ7wHfJtN2cTka/gXE9kMoXqg9FFdwGk+9/f2KfLqVszsXnvTMZmZgUIXzZ/LXhaoqtiTS02kVf4yiKOwEBCKOf0lVurk2tOcacmWkMaId/eXjg8rmwV2xoOcY+hIl9l1N6P6MP8Fzy6uQVJtuqd1EsIG8Rz10QX1cjTNhLqETDtyABcSCOCYkhJf4RoaesKD7wgQ2tqzH3EdpiEeo6bqrpqOd/BuSmBa61Az/nSiXwJpEYSPYqWr0BObl4simdHkdqUtlnMC17hxhlvqtADTGBbKiBuTIN9iAntJpWBUUbGg8L/mZ8ajJ7hEX/PWooyc4brgAFWIEl32JXQA6gd2E45MmAB0l0o/TJ5MAD5MokEKs6CACB6hEFObdQAIxEkwLBDAyADnRkvfa57wALYD6kY65JwAYwdtnTgbHwDp7qi38JLngHFoas6jXfNz7d1Eh7RcAHNZMnSNKhRwha2vVm51Za14ZmiCkJ3vTNIfW5zX8PFVKj0KZBA4ZBhfm7ysg5df+vblQh6Sg/g1HZqoJO82JOD3PPPsmt/ViBd4n3JSjGT0U7CpZE9EEcuc+4NP7wNXqTpujCD/GtXdTemTIpBjL4Fentr0X0iGHO5dWpg188G8ehzb7ZQKNIyRLgV/AKAA5NYv3QcaGD9fcMSocNIM5pS7ue8DmpgENmmbMz5XIzjb7Q8g7CMfKE8+AQIJIyDnhfnoDCmo7dCsGnSaY9Si4zoxVEY+O+NlPpusDM6R+DnPlOM5n/Yeo/AMLrS3VL6a8Dqed2YBo9mABrw3GpcwnEABy7nW86h36ASyKmS1GF04Ad8jMaQhTEYBjAK4tfOquRMtqWZ9yctJ8E7V39qVaPeSTzYsvNiUWtWSrGKIH8/IB2xCE44zU8QsvOejZBFJ5ywMXtLIU6ziYWLND3/UQzuBaq6QcpnpVvG/4ekPNxzg5dVI3RA3gYBw3ZdBBqmynLkrQi4EqGagEsnxikGU3vZT96dEysgEC3pDf1sLYrHWkLszfVp1QadRTr6c37/X6cHxHypHxg7T77IQI4X0y78CTdTcE4pdJuYn9JUJD0HLGCXDZYBd7m9bzS+BMyRbCf+ATTMk2C/hFVjeRiKHBEFNfzYvPSnlEJJlElJ/0soSULw+XX/2uyV0hWJPX0/wObX2cXmVvrrHw8QxTpN86u2gpJ6UOb89t2/XYEgotJ722RZUrAVGDsfkMztTVChZCuxdYj+SP8oenwbigj04xfVgwFcD2j+xaKQjwZ824pdOrbBIewv1cSAAAAAAP6M9I=
\.


--
-- Data for Name: compress_hyper_3_7_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal.compress_hyper_3_7_chunk (_ts_meta_count, series, _ts_meta_v2_min_id, _ts_meta_v2_max_id, id, _ts_meta_min_1, _ts_meta_max_1, ts, value) FROM stdin;
1000	alpha	275	7998	BAAAAAAAAAAfPgAAAAAAABpFAAAD6AAAAPq7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7sAAAC7u7u7u2FGYUMufgImYU5hS2FKYUdhVmFTYVJhT2FeYVthWmFXYWZhY2FiYV9hbmFrYWphZ2F2YXNhcmFvYX5he2F6YXdhhmGDYYJhf2GOYYthimGHYZZhk2GSYY9hnmGbYZphl2GmYaNhomGfYa5hq2GqYadhtmGzYbJhr2G+YbthumG3YcZhw2HCYb9hzmHLYcphx2HWYdNh0mHPYd5h22HaYddh5mHjYeJh32HuYeth6mHnYfZh82HyYe9h/mH7Yfph92IGYgNiAmH/Yg5iC2IKYgdiFmITYhJiD2IeYhtiGmIXYiZiI2IiYh9iLmIrYipiJ2I2YjNiMmIvYj5iO2I6YjdiRmJDYkJiP2JOYktiSmJHYlZiU2JSYk9iXmJbYlpiV2JmYmNiYmJfYm5ia2JqYmdidmJzYnJib2J+YntiemJ3YoZig2KCYn9ijmKLYopih2KWYpNikmKPYp5im2KaYpdipmKjYqJin2KuYqtiqmKnYrZis2KyYq9ivmK7Yrpit2LGYsNiwmK/Ys5iy2LKYsdi1mLTYtJiz2LeYtti2mLXYuZi42LiYt9i7mLrYupi52L2YvNi8mLvYv5i+2L6YvdjBmMDYwJi/2MOYwtjCmMHYxZjE2MSYw9jHmMbYxpjF2MmYyNjImMfYy5jK2MqYydjNmMzYzJjL2M+YztjOmM3Y0ZjQ2NCYz9jTmNLY0pjR2NWY1NjUmNPY15jW2NaY1djZmNjY2JjX2NuY2tjamNnY3Zjc2NyY29jfmN7Y3pjd2OGY4NjgmN/Y45ji2OKY4djlmOTY5Jjj2OeY5tjmmOXY6Zjo2OiY59jrmOrY6pjp2O2Y7NjsmOvY75ju2O6Y7djxmPDY8Jjv2POY8tjymPHY9Zj02PSY89j3mPbY9pj12PmY+Nj4mPfY+5j62PqY+dj9mPzY/Jj72P+Y/tj+mP3ZAZkA2QCY/9kDmQLZApkB2QWZBNkEmQPZB5kG2QaZBdkJmQjZCJkH2QuZCtkKmQnZDZkM2QyZC9kPmQ7ZDpkN2RGZENkQmQ/ZE5kS2RKZEdkVmRTZFJkT2ReZFtkWmRXZGZkY2RiZF9kbmRrZGpkZ2R2ZHNkcmRvZH5ke2R6ZHdkhmSDZIJkf2SOZItkimSHZJZkk2SSZI9knmSbZJpkl2SmZKNkomSfZK5kq2SqZKdktmSzZLJkr2S+ZLtkumS3ZMZkw2TCZL9kzmTLZMpkx2TWZNNk0mTPZN5k22TaZNdk5mTjZOJk32TuZOtk6mTnZPZk82TyZO9k/mT7ZPpk92UGZQNlAmT/ZQ5lC2UKZQdlFmUTZRJlD2UeZRtlGmUXZSZlI2UiZR9lLmUrZSplJ2U2ZTNlMmUvZT5lO2U6ZTdlRmVDZUJlP2VOZUtlSmVHZVZlU2VSZU9lXmVbZVplV2VmZWNlYmVfZW5la2VqZWdldmVzZXJlb2V+ZXtlemV3ZYZlg2WCZX9ljmWLZYplh2WWZZNlkmWPZZ5lm2WaZZdlpmWjZaJln2WuZatlqmWnZbZls2WyZa9lvmW7Zbplt2XGZcNlwmW/Zc5ly2XKZcdl1mXTZdJlz2XeZdtl2mXXZeZl42XiZd9l7mXrZepl52X2ZfNl8mXvZf5l+2X6ZfdmBmYDZgJl/2YOZgtmCmYHZhZmE2YSZg9mHmYbZhpmF2YmZiNmImYfZi5mK2YqZidmNmYzZjJmL2Y+ZjtmOmY3ZkZmQ2ZCZj9mTmZLZkpmR2ZWZlNmUmZPZl5mW2ZaZldmZmZjZmJmX2ZuZmtmamZnZnZmc2ZyZm9mfmZ7Znpmd2aGZoNmgmZ/Zo5mi2aKZodmlmaTZpJmj2aeZptmmmaXZqZmo2aiZp9mrmarZqpmp2a2ZrNmsmavZr5mu2a6ZrdmxmbDZsJmv2bOZstmymbHZtZm02bSZs9m3mbbZtpm12bmZuNm4mbfZu5m62bqZudm9mbzZvJm72b+Zvtm+mb3ZwZnA2cCZv9nDmcLZwpnB2cWZxNnEmcPZx5nG2caZxdnJmcjZyJnH2cuZytnKmcnZzZnM2cyZy9nPmc7ZzpnN2dGZ0NnQmc/Z05nS2dKZ0dnVmdTZ1JnT2deZ1tnWmdXZ2ZnY2diZ19nbmdrZ2pnZ2d2Z3NncmdvZ35ne2d6Z3dnhmeDZ4Jnf2eOZ4tnimeHZ5Znk2eSZ49nnmebZ5pnl2emZ6NnomefZ65nq2eqZ6dntmezZ7Jnr2e+Z7tnume3Z8Znw2fCZ79nzmfLZ8pnx2fWZ9Nn0mfPZ95n22faZ9dn5mfjZ+Jn32fuZ+tn6mfnZ/Zn82fyZ+9n/mf7Z/pn92gGaANoAmf/aA5oC2gKaAdoFmgTaBJoD2geaBtoGmgXaCZoI2giaB9oLmgraCpoJ2g2aDNoMmgvaD5oO2g6aDdoRmhDaEJoP2hOaEtoSmhHaFZoU2hSaE9oXmhbaFpoV2hmaGNoYmhfaG5oa2hqaGdodmhzaHJob2h+aHtoemh3aIZog2iCaH9ojmiLaIpoh2iWaJNokmiPaJ5om2iaaJdopmijaKJon2iuaKtoqminaLZos2iyaK9ovmi7aLpot2jGaMNowmi/aM5oy2jKaMdo1mjTaNJoz2jeaNto2mjXaOZo42jiaN9o7mjraOpo52j2aPNo8mjvaP5o+2j6aPdpBmkDaQJo/2kOaQtpCmkH	2025-10-29 15:40:10.258973+00	2025-10-29 23:59:10.66157+00	BAAAAuVMt2CeHf//////+dtbAAAD6AAAAfXd3d3d3d3d7t3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3QAAAAAADd3dAAXKp1/tz4QABcqnX/oYzQcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntr	AwBASjvnjPlygAAAA+gAAAABAAAAAAAAAA8AAD6AAAAAAQAAA+gAAAAMAAARER8REf8AAARAAAAAAQAADqAAAAAAAAAAAAAHFwENAAAAAAAAAAUAAAAAAAAQAAAAAAAAAFEAAArAAAAAABbUABAAAACBAAABAFwAAAAGQAAAAAAAAAQB8AAAAAAAAAAAAAAAAAAAAAALDhJJLLLLLLNByySSSTDDDAQss00sssswwrLLJJLLPOLLkjDDDCSSSSwsskk9Ewwww7LMLNOBJJLLSSySwSSzQSQEkw4ssw0EkMMBBJLBJLPBAAAAAAAACSwAAABtAAAACwAABmZmZmZmDfbXTTXXXP4Nd99tLs8/+gzz0101xzz0DbfXXHHG3XUNNNd99tddcwxv0zz0yuxzDH/fXTLXXXYN9c/t9bdNMQ0x/3+31218DfXH/zfTLTIAN9dMv/t8vwAAA1sQ4CBqADK4MZNTx31yPzCAAUa9IGnb0LcOvLJDj32ymqzqhrCGXbWjWC/yik5/3o9at8O9TURikf/WoSENO9zZsdHjIFCml17zhz5t29Zf9Ukto3lRc5/6u8ty/LcvB/5ivBuJ8zPjRwYpFacPzvsHD7TqDLZUP1GR8+bjOWHyCahY/nT+TpWZQ75sF58r/He2RuiK3MyxTG/72k349sL8/RtabGjy/+wKg6CVs5vBOEjC5OWTfm4CgmrWhonJh9U+wsTVKzeDgtirunoMAf03UXmaOhNE+DYqxUnxptR2YoLvkYh8WakMBBv+iT+bxDzJBwmBaZzspiw3aHMj5UcdEynOIrdfQBqfcy4PUtOSx0H8qyuv5g8uy9kzGKD9ciw26QC/M6RZZkyk9gVPh/FHAxlk+V8nvutY4rRRTywRNTc/IzYfccQeZP8av5+P342LGOnhz72IngtLLacf/U0pzaRDGOiIe9sb0uS/DjQLfCzwYpfulp9bakzKtds/aUnmfTLL/Hqj30TXvgL/ns8xSDz+E8NnKkdyOtD1mjA0Hy7D5hXWh94r0+WqKqe6xpg6qZ43Z24DHzfhp7ZLvEHvMBSamFYAo/s7gwuQc0RwTvXmAV0Ir2+5w2bz1LgrBxA5jrI5APoqHykLfFxeZQ49UB9xgMFPO/MvgvIupw9VTmIu+u/bMThGpVwUggwtXewGd3kUEc+j69ECQgtKsg6biMVLmBdjaMe3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
1000	alpha	1275	9498	BAAAAAAAAAAlGgAAAAAAABw5AAAD6AAAAPq7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7sAAAC7u7u7u2kWaRMqlgn2aR5pG2kaaRdpJmkjaSJpH2kuaStpKmknaTZpM2kyaS9pPmk7aTppN2lGaUNpQmk/aU5pS2lKaUdpVmlTaVJpT2leaVtpWmlXaWZpY2liaV9pbmlraWppZ2l2aXNpcmlvaX5pe2l6aXdphmmDaYJpf2mOaYtpimmHaZZpk2mSaY9pnmmbaZppl2mmaaNpommfaa5pq2mqaadptmmzabJpr2m+abtpumm3acZpw2nCab9pzmnLacppx2nWadNp0mnPad5p22naaddp5mnjaeJp32nuaetp6mnnafZp82nyae9p/mn7afpp92oGagNqAmn/ag5qC2oKagdqFmoTahJqD2oeahtqGmoXaiZqI2oiah9qLmoraipqJ2o2ajNqMmovaj5qO2o6ajdqRmpDakJqP2pOaktqSmpHalZqU2pSak9qXmpbalpqV2pmamNqYmpfam5qa2pqamdqdmpzanJqb2p+antqemp3aoZqg2qCan9qjmqLaopqh2qWapNqkmqPap5qm2qaapdqpmqjaqJqn2quaqtqqmqnarZqs2qyaq9qvmq7arpqt2rGasNqwmq/as5qy2rKasdq1mrTatJqz2reattq2mrXauZq42riat9q7mrraupq52r2avNq8mrvav5q+2r6avdrBmsDawJq/2sOawtrCmsHaxZrE2sSaw9rHmsbaxprF2smayNrImsfay5rK2sqaydrNmszazJrL2s+aztrOms3a0ZrQ2tCaz9rTmtLa0prR2tWa1NrUmtPa15rW2taa1drZmtja2JrX2tua2tramtna3Zrc2tya29rfmt7a3prd2uGa4Nrgmt/a45ri2uKa4drlmuTa5Jrj2uea5trmmuXa6Zro2uia59rrmura6prp2u2a7Nrsmuva75ru2u6a7drxmvDa8Jrv2vOa8trymvHa9Zr02vSa89r3mvba9pr12vma+Nr4mvfa+5r62vqa+dr9mvza/Jr72v+a/tr+mv3bAZsA2wCa/9sDmwLbApsB2wWbBNsEmwPbB5sG2wabBdsJmwjbCJsH2wubCtsKmwnbDZsM2wybC9sPmw7bDpsN2xGbENsQmw/bE5sS2xKbEdsVmxTbFJsT2xebFtsWmxXbGZsY2xibF9sbmxrbGpsZ2x2bHNscmxvbH5se2x6bHdshmyDbIJsf2yObItsimyHbJZsk2ySbI9snmybbJpsl2ymbKNsomyfbK5sq2yqbKdstmyzbLJsr2y+bLtsumy3bMZsw2zCbL9szmzLbMpsx2zWbNNs0mzPbN5s22zabNds5mzjbOJs32zubOts6mznbPZs82zybO9s/mz7bPps920GbQNtAmz/bQ5tC20KbQdtFm0TbRJtD20ebRttGm0XbSZtI20ibR9tLm0rbSptJ202bTNtMm0vbT5tO206bTdtRm1DbUJtP21ObUttSm1HbVZtU21SbU9tXm1bbVptV21mbWNtYm1fbW5ta21qbWdtdm1zbXJtb21+bXttem13bYZtg22CbX9tjm2LbYpth22WbZNtkm2PbZ5tm22abZdtpm2jbaJtn22ubattqm2nbbZts22yba9tvm27bbptt23GbcNtwm2/bc5ty23Kbcdt1m3TbdJtz23ebdtt2m3XbeZt423ibd9t7m3rbept5232bfNt8m3vbf5t+236bfduBm4DbgJt/24ObgtuCm4HbhZuE24Sbg9uHm4bbhpuF24mbiNuIm4fbi5uK24qbiduNm4zbjJuL24+bjtuOm43bkZuQ25Cbj9uTm5LbkpuR25WblNuUm5Pbl5uW25ablduZm5jbmJuX25ubmtuam5nbnZuc25ybm9ufm57bnpud26GboNugm5/bo5ui26Kbodulm6TbpJuj26ebptumm6XbqZuo26ibp9urm6rbqpup262brNusm6vbr5uu266brduxm7DbsJuv27Obstuym7HbtZu027Sbs9u3m7bbtpu127mbuNu4m7fbu5u627qbudu9m7zbvJu727+bvtu+m73bwZvA28Cbv9vDm8LbwpvB28WbxNvEm8Pbx5vG28abxdvJm8jbyJvH28ubytvKm8nbzZvM28yby9vPm87bzpvN29Gb0NvQm8/b05vS29Kb0dvVm9Tb1JvT29eb1tvWm9Xb2ZvY29ib19vbm9rb2pvZ292b3Nvcm9vb35ve296b3dvhm+Db4Jvf2+Ob4tvim+Hb5Zvk2+Sb49vnm+bb5pvl2+mb6Nvom+fb65vq2+qb6dvtm+zb7Jvr2++b7tvum+3b8Zvw2/Cb79vzm/Lb8pvx2/Wb9Nv0m/Pb95v22/ab9dv5m/jb+Jv32/ub+tv6m/nb/Zv82/yb+9v/m/7b/pv93AGcANwAm//cA5wC3AKcAdwFnATcBJwD3AecBtwGnAXcCZwI3AicB9wLnArcCpwJ3A2cDNwMnAvcD5wO3A6cDdwRnBDcEJwP3BOcEtwSnBHcFZwU3BScE9wXnBbcFpwV3BmcGNwYnBfcG5wa3BqcGdwdnBzcHJwb3B+cHtwenB3cIZwg3CCcH9wjnCLcIpwh3CWcJNwknCPcJ5wm3CacJdwpnCjcKJwn3CucKtwqnCncLZws3CycK9wvnC7cLpwt3DGcMNwwnC/cM5wy3DKcMdw1nDTcNJwz3DecNtw2nDX	2025-10-29 07:20:10.258973+00	2025-10-29 15:39:10.66157+00	BAAAAuVFuzzyHf//////+dtbAAAD6AAAAfXd3d3d3d3d7t3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3QAAAAAADd3dAAXKmWemd4QABcqZZ7LAzQcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntr	AwBATxE3gD9F2gAAA+gAAAABAAAAAAAAAA8AAD6AAAAAAQAAA+gAAAAOABEfERER8R8AAAQQAAAAAQL8AAAABogAAAAAAAAAAIAAAAlQAAAAAAAAAAAROQFxHwBAAAAAwPAZBA8EAAAABwAAE4QAAAABAAAEUxAAAAAAAAAAAAGwAAAABiAAAAAAAAAAAQABAwUAAAAAPAwfgAAAAAcAAAAAAAAADj6yyyyySSyywUkkkkk00wwsLLLLLLJJOOLTDCSSyySSy0kkkEEkkss0MMOOJJMMNNLDTTjyySSyS8ssEs01AEksOBJJLLQYJLKzTQSSywSSTEss0EkssEksJLBBJLLNNBIQTDDSSySSwQktMkkwwEEkAAAAlQAAAA8GZmZmZmZmZg11113311z/DXbbbLPTTTMNdcdNtaqdtA32y122z11yDzzXbTTDLHMN89NM89N9tgn32121zzwvDHD/fXLO/LEMKN9dM8P9cw/31xx/321yD/fXTLD/fXILf99dMv99cg1+3y/+310zDf73TKrfXbUAN9Kt9dMv/gAAA1kiwFdNsg9AR9W0x9B/on7eKgrK+O7QjfOQ0/VgfB2O9oO1GfcShn9UXvTapchZkEelp75v9Xa2W/X60r+Zp+5E98lir0z07XElsMrqbQjj8kgHaoJNzS4dfOtqsU6Ik9pXZ2Cog5xZ0kcybYWEmF6VTv5XrKmhLdv65T9zk7pXpbJWKxPjEcfyPZ9Shbw7CeqL+u7fWzxe5kD3rD/qtPU2IiQsYjyfz/xf8uXVxOVj86faZ13krrsYM18CzlDJZU20P5BlOc/X21vihEYXNEf2dzwjOOSIFYn/Uvz9zhrke9cEqER92qavAoj6+Ir/DBsl1FDDVqKr5v/1pu3SKzOYp59H1uKofiO7KaHb5iBdkWuJazIx5T/hxyw8TJIJg9e5+sbHhZdEbE2nn7F7+OlTy8QBwXrl3kBU9sW83T9NI8T/YqA6Ce6//x180TpYulWnPqU/M91HkiJPj1DtsMvRkXsuvz2l2nFi9SFk/0V6RjmWS5zBdxfvnGwrtLjUyGt97zgXTK381B/nfcC/PQb+WJRcYJ498nmpeoiXp7IT677Wpwopudpgvf0uPay7wSf0yZ7+uj/+bM/JupzQIkHKpELfDtj7e6cPDmr5UNuXkceMPMqW1IuXeb7ik9wHnH9a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
635	alpha	2275	10083	BAAAAAAAAAAMUQAAAAAAAAACAAACewAAAGO7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7sAAAAAAAAPu3DmcOMmrhHGcO5w63DqcOdw9nDzcPJw73D+cPtw+nD3cQZxA3ECcP9xDnELcQpxB3EWcRNxEnEPcR5xG3EacRdxJnEjcSJxH3EucStxKnEncTZxM3EycS9xPnE7cTpxN3FGcUNxQnE/cU5xS3FKcUdxVnFTcVJxT3FecVtxWnFXcWZxY3FicV9xbnFrcWpxZ3F2cXNxcnFvcX5xe3F6cXdxhnGDcYJxf3GOcYtxinGHcZZxk3GScY9xnnGbcZpxl3GmcaNxonGfca5xq3GqcadxtnGzcbJxr3G+cbtxunG3ccZxw3HCcb9xznHLccpxx3HWcdNx0nHPcd5x23Hacddx5nHjceJx33Hucetx6nHncfZx83Hyce9x/nH7cfpx93IGcgNyAnH/cg5yC3IKcgdyFnITchJyD3IechtyGnIXciZyI3Iich9yLnIrcipyJ3I2cjNyMnIvcj5yO3I6cjdyRnJDckJyP3JOcktySnJHclZyU3JSck9yXnJbclpyV3JmcmNyYnJfcm5ya3JqcmdydnJzcnJyb3J+cntyenJ3coZyg3KCcn9yjnKLcopyh3KWcpNyknKPcp5ym3KacpdypnKjcqJyn3KucqtyqnKncrZys3Kycq9yvnK7crpyt3LGcsNywnK/cs5yy3LKcsdy1nLTctJyz3Lectty2nLXcuZy43Lict9y7nLrcupy53L2cvNy8nLvcv5y+3L6cvdzBnMDcwJy/3MOcwtzCnMHcxZzE3MScw9zHnMbcxpzF3MmcyNzInMfcy5zK3MqcydzNnMzczJzL3M+cztzOnM3c0ZzQ3NCcz9zTnNLc0pzR3NWc1NzUnNPc15zW3Nac1dzZnNjc2JzX3Nuc2tzanNnc3Zzc3Nyc29zfnN7c3pzd3OGc4NzgnN/c45zi3OKc4dzlnOTc5Jzj3Oec5tzmnOXc6Zzo3Oic59zrnOrc6pzp3O2c7NzsnOvc75zu3O6c7dzxnPDc8Jzv3POc8tzynPHc9Zz03PSc89z3nPbc9pz13Pmc+Nz4nPfOfhz63Pqc+cAAA8wAAAAAA==	2025-10-29 00:00:10.66157+00	2025-10-29 07:19:10.66157+00	BAAAAuU/lbMOwv/////8bHkAAAACewAAAMbd3d3d3d3d7t3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d0AAAAAAP3d3QAFyotvXx+EAAXKi29raM0HDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrAAxJSQcOe2sAAA8wAAAAAA==	AwA/+bq7jP22SAAAAnsAAAABAAAAAAAAAA8AACewAAAAAQAAAnsAAAAHAAAAAAEfHx8AAAQQAAAAAQAAAAAAAHWAAAAPsAAAAAAAAAEzYAAA1QAABeAAAAAAAAAAAAE2AscAAAABtCCFAAAAAAoqsss8800kkkEMJJJJLLJJLCyyyyyzjjjjksskkkkkkwwMJJJJLLLLJCyzDCSTDCyzkw0EkksskkvQWJLMLOBBJCwSSTQQSTCSAAAAEss8EsEAAABnAAAACwAABmZmZmZmCvXHHOzfbP4Nd9d9NNdtdA0x01yxxyy0DfbffbLLPPQN8dNNNddtcw2y0y1y0022DbXPTPXLXTMNL/vd9tMf9w+30z1uq310DH/X7X7fXL8AAAAAAAP9MgAAAh8L4BzKE4Jh0kmkN9HmembP/dEYButV6IvtkMba8vSDHufwISfQVJ1uroeE4pZi8cELWtu3UP7zkVXeLaa20psERNl/bk20v5IFZ2nj4OlGJ/OuwUePcd1THM3HjWvcrjjITqNVvOrRYO8lZ6O588neEf5A5PVzxNfISIz+L/7E8je/nffZ5F/KjIslFWJy9kbIa5PfFtUeiGvG3GhPuwE7R+NdqZ5urL5tm900sa0ELw/fssXUJikAtjdDmqoPiXnziHIlp0GbOeL+XG6GmCwN48KxXdu+grkBBRcz6BdKvEbNqA08Hk3PCRO/WYn7hRW//dzfuLqe9DndMph7sBf7LCNoW/29y4HYOM1YmeOh9FLXOk1ZhsNY3wqX50beetUPtFPhXQfcjFPRRrK6u9Yh08fFW8KmPj2QqePkdeGNMnktzzvzvFVGQlymv9p/F70QbP8zSMl/1Sz4e6JgzTxjnQUBc2P5JBuLjyD23uJHPgtVhZBW4jaRHLwLswPHOeN/TS8AOI/FXxd0onvdDcvDkrXKbhkX+xYd5IqqaK2A+MRDDCEi1cn/LqSUu7VFPw1tgS4mareed5auPWgn+k59C4nW95SLpP1JADjb+9OCo6oOIaWeWTSq0El3qYR3poNTwf6mZoYJe8VnWu4l6gT7DE2SJ92icM0EgyFl2HskYXk+s7OGG79WMsD3rZmcxVO7YOVaRCxQOefTTJl3UFaDUPddLw8cZxxrFeRwOGdv015XWwv+52NPOnAZPVlZbpjtK9aRteOPyoyZJOW6ZbcxrpadIv7rcTA0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
1000	beta	276	7999	BAAAAAAAAAAfPwAAAAAAABpFAAAD6AAAAPq7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7sAAAC7u7u7u2FGYUMufAIoYU5hS2FKYUdhVmFTYVJhT2FeYVthWmFXYWZhY2FiYV9hbmFrYWphZ2F2YXNhcmFvYX5he2F6YXdhhmGDYYJhf2GOYYthimGHYZZhk2GSYY9hnmGbYZphl2GmYaNhomGfYa5hq2GqYadhtmGzYbJhr2G+YbthumG3YcZhw2HCYb9hzmHLYcphx2HWYdNh0mHPYd5h22HaYddh5mHjYeJh32HuYeth6mHnYfZh82HyYe9h/mH7Yfph92IGYgNiAmH/Yg5iC2IKYgdiFmITYhJiD2IeYhtiGmIXYiZiI2IiYh9iLmIrYipiJ2I2YjNiMmIvYj5iO2I6YjdiRmJDYkJiP2JOYktiSmJHYlZiU2JSYk9iXmJbYlpiV2JmYmNiYmJfYm5ia2JqYmdidmJzYnJib2J+YntiemJ3YoZig2KCYn9ijmKLYopih2KWYpNikmKPYp5im2KaYpdipmKjYqJin2KuYqtiqmKnYrZis2KyYq9ivmK7Yrpit2LGYsNiwmK/Ys5iy2LKYsdi1mLTYtJiz2LeYtti2mLXYuZi42LiYt9i7mLrYupi52L2YvNi8mLvYv5i+2L6YvdjBmMDYwJi/2MOYwtjCmMHYxZjE2MSYw9jHmMbYxpjF2MmYyNjImMfYy5jK2MqYydjNmMzYzJjL2M+YztjOmM3Y0ZjQ2NCYz9jTmNLY0pjR2NWY1NjUmNPY15jW2NaY1djZmNjY2JjX2NuY2tjamNnY3Zjc2NyY29jfmN7Y3pjd2OGY4NjgmN/Y45ji2OKY4djlmOTY5Jjj2OeY5tjmmOXY6Zjo2OiY59jrmOrY6pjp2O2Y7NjsmOvY75ju2O6Y7djxmPDY8Jjv2POY8tjymPHY9Zj02PSY89j3mPbY9pj12PmY+Nj4mPfY+5j62PqY+dj9mPzY/Jj72P+Y/tj+mP3ZAZkA2QCY/9kDmQLZApkB2QWZBNkEmQPZB5kG2QaZBdkJmQjZCJkH2QuZCtkKmQnZDZkM2QyZC9kPmQ7ZDpkN2RGZENkQmQ/ZE5kS2RKZEdkVmRTZFJkT2ReZFtkWmRXZGZkY2RiZF9kbmRrZGpkZ2R2ZHNkcmRvZH5ke2R6ZHdkhmSDZIJkf2SOZItkimSHZJZkk2SSZI9knmSbZJpkl2SmZKNkomSfZK5kq2SqZKdktmSzZLJkr2S+ZLtkumS3ZMZkw2TCZL9kzmTLZMpkx2TWZNNk0mTPZN5k22TaZNdk5mTjZOJk32TuZOtk6mTnZPZk82TyZO9k/mT7ZPpk92UGZQNlAmT/ZQ5lC2UKZQdlFmUTZRJlD2UeZRtlGmUXZSZlI2UiZR9lLmUrZSplJ2U2ZTNlMmUvZT5lO2U6ZTdlRmVDZUJlP2VOZUtlSmVHZVZlU2VSZU9lXmVbZVplV2VmZWNlYmVfZW5la2VqZWdldmVzZXJlb2V+ZXtlemV3ZYZlg2WCZX9ljmWLZYplh2WWZZNlkmWPZZ5lm2WaZZdlpmWjZaJln2WuZatlqmWnZbZls2WyZa9lvmW7Zbplt2XGZcNlwmW/Zc5ly2XKZcdl1mXTZdJlz2XeZdtl2mXXZeZl42XiZd9l7mXrZepl52X2ZfNl8mXvZf5l+2X6ZfdmBmYDZgJl/2YOZgtmCmYHZhZmE2YSZg9mHmYbZhpmF2YmZiNmImYfZi5mK2YqZidmNmYzZjJmL2Y+ZjtmOmY3ZkZmQ2ZCZj9mTmZLZkpmR2ZWZlNmUmZPZl5mW2ZaZldmZmZjZmJmX2ZuZmtmamZnZnZmc2ZyZm9mfmZ7Znpmd2aGZoNmgmZ/Zo5mi2aKZodmlmaTZpJmj2aeZptmmmaXZqZmo2aiZp9mrmarZqpmp2a2ZrNmsmavZr5mu2a6ZrdmxmbDZsJmv2bOZstmymbHZtZm02bSZs9m3mbbZtpm12bmZuNm4mbfZu5m62bqZudm9mbzZvJm72b+Zvtm+mb3ZwZnA2cCZv9nDmcLZwpnB2cWZxNnEmcPZx5nG2caZxdnJmcjZyJnH2cuZytnKmcnZzZnM2cyZy9nPmc7ZzpnN2dGZ0NnQmc/Z05nS2dKZ0dnVmdTZ1JnT2deZ1tnWmdXZ2ZnY2diZ19nbmdrZ2pnZ2d2Z3NncmdvZ35ne2d6Z3dnhmeDZ4Jnf2eOZ4tnimeHZ5Znk2eSZ49nnmebZ5pnl2emZ6NnomefZ65nq2eqZ6dntmezZ7Jnr2e+Z7tnume3Z8Znw2fCZ79nzmfLZ8pnx2fWZ9Nn0mfPZ95n22faZ9dn5mfjZ+Jn32fuZ+tn6mfnZ/Zn82fyZ+9n/mf7Z/pn92gGaANoAmf/aA5oC2gKaAdoFmgTaBJoD2geaBtoGmgXaCZoI2giaB9oLmgraCpoJ2g2aDNoMmgvaD5oO2g6aDdoRmhDaEJoP2hOaEtoSmhHaFZoU2hSaE9oXmhbaFpoV2hmaGNoYmhfaG5oa2hqaGdodmhzaHJob2h+aHtoemh3aIZog2iCaH9ojmiLaIpoh2iWaJNokmiPaJ5om2iaaJdopmijaKJon2iuaKtoqminaLZos2iyaK9ovmi7aLpot2jGaMNowmi/aM5oy2jKaMdo1mjTaNJoz2jeaNto2mjXaOZo42jiaN9o7mjraOpo52j2aPNo8mjvaP5o+2j6aPdpBmkDaQJo/2kOaQtpCmkH	2025-10-29 15:40:10.258973+00	2025-10-29 23:59:10.66157+00	BAAAAuVMt2CeHf//////+dtbAAAD6AAAAfXd3d3d3d3d7t3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3QAAAAAADd3dAAXKp1/tz4QABcqnX/oYzQcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntr	AwBASNWyqDOoJwAAA+gAAAABAAAAAAAAAA8AAD6AAAAAAQAAA+gAAAANAA8REfEfHx8AAAQQAAAAAWO4AuAAAAAAAAAFAAAAAAAAAAAAAAAAIwAAB5AAAAAAAAAFgDRBAN0AAAAeAAAAAAAABsAAAAAAAAAAAAAAAHOAAAAAAAAAAAAAAAAAAAADAUVUAQYAEAAAAAcgAAAAAAAAAAs+kkksskksswEMMMJJNNLLJCSSyyyyyyyzs44sssskkknLPRLLLLMMLCSTDCSSyySSssswkkswEElJLMMBJLPJJCUSS1SSSzASEkkskwwEEkkJJMLNNBJLLAAAAHUAAAAMAABmZmZmZmYNt89N88s9Pw0u31sz0031DXPTXXXXXTMNddNd9sd99w00100w10wyDffW/ffPPG8NddPu989dMw31q3210y02DDXT7fbTTL8P/d9tKt9adw31w/32o3zvAAADfbTTPLwAAANZFMBKw9LAb+yhCf++o5MnR6UnxAPhlf1XccX5+i0fgQ+7Dza+bsvfbgXr4jeg27x2b8Y/OytBxBNqFaVGw+lLa0p2zeMkEnpkknvs0YC1Tb7nfGdcrk21tQ8sv057vGP2Es72AEL4eqSt/Xn4pxPGF6zqPkjXx2MKXnkPDP/OeAvsrLV1wNjzWH/wv3e/cwr3GOns+geOngk3elzJlMLOBtMvNBmFdkVCYeDayZwc9q2U3ej+rWWKkNZu2GUuZkIraihoOKwlFSWAyfvUBFeOHuM1wd5tFxPPNnv44EEa4jP5Lo303rSvVKo8ta/7KI4SxY9D7nx9o8Im0A6nfqJa34LnZX9H5s4cmwVxPApkpiqe7Sd02XxKBZyocHk+cOTdFDlch5QIkb/7cpEJyaP8VsxxSorCOjfTF7c/SG9+o1/qcyssbWwMM3OnfGP8vbIyDp/qBzcPtuBbyuLQdL0OmJR4/SKy712YTdmYfmocRc//Ekcf7PsEZok48ucVqyt2VOCW+7D5VU3EUNZHA1Tffc4npzZmhTNPtLIooyN/BsbrpVq8EFlZ+U/O3mCaiiYTfTG5Owy2xfez1y2olyZSLVqXLtNKC+mIH/6WIsrvBg3aQI2a0LHmBtDh8TdrkuDYwqWA+YRcaladJWFdYi7+i5sgWK2+oIy8XqeHrdwGPEpDhw/wtDMuH96w6YQivy024MugwEa09Ni0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
1000	beta	1276	9499	BAAAAAAAAAAlGwAAAAAAABw5AAAD6AAAAPq7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7sAAAC7u7u7u2kWaRMqlAn4aR5pG2kaaRdpJmkjaSJpH2kuaStpKmknaTZpM2kyaS9pPmk7aTppN2lGaUNpQmk/aU5pS2lKaUdpVmlTaVJpT2leaVtpWmlXaWZpY2liaV9pbmlraWppZ2l2aXNpcmlvaX5pe2l6aXdphmmDaYJpf2mOaYtpimmHaZZpk2mSaY9pnmmbaZppl2mmaaNpommfaa5pq2mqaadptmmzabJpr2m+abtpumm3acZpw2nCab9pzmnLacppx2nWadNp0mnPad5p22naaddp5mnjaeJp32nuaetp6mnnafZp82nyae9p/mn7afpp92oGagNqAmn/ag5qC2oKagdqFmoTahJqD2oeahtqGmoXaiZqI2oiah9qLmoraipqJ2o2ajNqMmovaj5qO2o6ajdqRmpDakJqP2pOaktqSmpHalZqU2pSak9qXmpbalpqV2pmamNqYmpfam5qa2pqamdqdmpzanJqb2p+antqemp3aoZqg2qCan9qjmqLaopqh2qWapNqkmqPap5qm2qaapdqpmqjaqJqn2quaqtqqmqnarZqs2qyaq9qvmq7arpqt2rGasNqwmq/as5qy2rKasdq1mrTatJqz2reattq2mrXauZq42riat9q7mrraupq52r2avNq8mrvav5q+2r6avdrBmsDawJq/2sOawtrCmsHaxZrE2sSaw9rHmsbaxprF2smayNrImsfay5rK2sqaydrNmszazJrL2s+aztrOms3a0ZrQ2tCaz9rTmtLa0prR2tWa1NrUmtPa15rW2taa1drZmtja2JrX2tua2tramtna3Zrc2tya29rfmt7a3prd2uGa4Nrgmt/a45ri2uKa4drlmuTa5Jrj2uea5trmmuXa6Zro2uia59rrmura6prp2u2a7Nrsmuva75ru2u6a7drxmvDa8Jrv2vOa8trymvHa9Zr02vSa89r3mvba9pr12vma+Nr4mvfa+5r62vqa+dr9mvza/Jr72v+a/tr+mv3bAZsA2wCa/9sDmwLbApsB2wWbBNsEmwPbB5sG2wabBdsJmwjbCJsH2wubCtsKmwnbDZsM2wybC9sPmw7bDpsN2xGbENsQmw/bE5sS2xKbEdsVmxTbFJsT2xebFtsWmxXbGZsY2xibF9sbmxrbGpsZ2x2bHNscmxvbH5se2x6bHdshmyDbIJsf2yObItsimyHbJZsk2ySbI9snmybbJpsl2ymbKNsomyfbK5sq2yqbKdstmyzbLJsr2y+bLtsumy3bMZsw2zCbL9szmzLbMpsx2zWbNNs0mzPbN5s22zabNds5mzjbOJs32zubOts6mznbPZs82zybO9s/mz7bPps920GbQNtAmz/bQ5tC20KbQdtFm0TbRJtD20ebRttGm0XbSZtI20ibR9tLm0rbSptJ202bTNtMm0vbT5tO206bTdtRm1DbUJtP21ObUttSm1HbVZtU21SbU9tXm1bbVptV21mbWNtYm1fbW5ta21qbWdtdm1zbXJtb21+bXttem13bYZtg22CbX9tjm2LbYpth22WbZNtkm2PbZ5tm22abZdtpm2jbaJtn22ubattqm2nbbZts22yba9tvm27bbptt23GbcNtwm2/bc5ty23Kbcdt1m3TbdJtz23ebdtt2m3XbeZt423ibd9t7m3rbept5232bfNt8m3vbf5t+236bfduBm4DbgJt/24ObgtuCm4HbhZuE24Sbg9uHm4bbhpuF24mbiNuIm4fbi5uK24qbiduNm4zbjJuL24+bjtuOm43bkZuQ25Cbj9uTm5LbkpuR25WblNuUm5Pbl5uW25ablduZm5jbmJuX25ubmtuam5nbnZuc25ybm9ufm57bnpud26GboNugm5/bo5ui26Kbodulm6TbpJuj26ebptumm6XbqZuo26ibp9urm6rbqpup262brNusm6vbr5uu266brduxm7DbsJuv27Obstuym7HbtZu027Sbs9u3m7bbtpu127mbuNu4m7fbu5u627qbudu9m7zbvJu727+bvtu+m73bwZvA28Cbv9vDm8LbwpvB28WbxNvEm8Pbx5vG28abxdvJm8jbyJvH28ubytvKm8nbzZvM28yby9vPm87bzpvN29Gb0NvQm8/b05vS29Kb0dvVm9Tb1JvT29eb1tvWm9Xb2ZvY29ib19vbm9rb2pvZ292b3Nvcm9vb35ve296b3dvhm+Db4Jvf2+Ob4tvim+Hb5Zvk2+Sb49vnm+bb5pvl2+mb6Nvom+fb65vq2+qb6dvtm+zb7Jvr2++b7tvum+3b8Zvw2/Cb79vzm/Lb8pvx2/Wb9Nv0m/Pb95v22/ab9dv5m/jb+Jv32/ub+tv6m/nb/Zv82/yb+9v/m/7b/pv93AGcANwAm//cA5wC3AKcAdwFnATcBJwD3AecBtwGnAXcCZwI3AicB9wLnArcCpwJ3A2cDNwMnAvcD5wO3A6cDdwRnBDcEJwP3BOcEtwSnBHcFZwU3BScE9wXnBbcFpwV3BmcGNwYnBfcG5wa3BqcGdwdnBzcHJwb3B+cHtwenB3cIZwg3CCcH9wjnCLcIpwh3CWcJNwknCPcJ5wm3CacJdwpnCjcKJwn3CucKtwqnCncLZws3CycK9wvnC7cLpwt3DGcMNwwnC/cM5wy3DKcMdw1nDTcNJwz3DecNtw2nDX	2025-10-29 07:20:10.258973+00	2025-10-29 15:39:10.66157+00	BAAAAuVFuzzyHf//////+dtbAAAD6AAAAfXd3d3d3d3d7t3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3QAAAAAADd3dAAXKmWemd4QABcqZZ7LAzQcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntr	AwBAT40b11rF2AAAA+gAAAABAAAAAAAAAA8AAD6AAAAAAQAAA+gAAAAOABEfHxER8R8AAAQQAAAAAQAAAAgAs+AAAAAAJggAAAAAAAeAAAAAAAKsHhgAAAADAAAAAAAAAD4C4goxiigAAAAAAKWDAB6AAAAHkAAAAAAAAAAAABAEMwAABBAAAAAACumgyAAAABsAYKGAAAAAAAAIAAAb2AAAAAAAD0DTjiyzDDTSwcssskkkkss0MMNNNNJJPQKyyySTTSyyy8skksssskksJJLLLLNRLLISSyTTDUAQSUEssEEkskssJLLBBJJNJOASSzDySSySwQkEEssEkswwLMOBBJJLJJOyzCzASSTFiUssEEksk48kBJJNPQMBBJIAAACgAAAAEGZmZmZmZmZmDHLXTTTPPP4Nddds99dccwxzzv02wtzyDffPLTXLPPMM9Nct9tdc8A10vsz1yx21DPLD/zffbTIN6t9cv99dcw2z0w/+1x/9DXXX3fPH/7cNNMf99dMdtQ200x/+zv/3CnfXTL/zfbUNtc9NMft9NA11x/+312xxD7fbPHC77vcAAANZNmAoF5ZqqAn1bQOVt5imNaOP9qUeShfG71C/IKZI8+bT3zir8uApzGUvXtgUU9C3qNyJvdgKnEli0mjUjWclp65gVHccmUn+bop9zvIgDzQj8dYkvOs3a8w4PXl035hlazHJl5noCcfJ49nPdxMYKP5F+nuCYzOAvmUqvv4RJrkJqz8Pj7HJqS76GcxBQxh3ULKphyYxoTmS29xnfmdgSJj7P/sBrV3MA8Uvsamff8o8xMDp9XLKyrx0y92Gn703aPut5MeoMF8TBO/Gwu20tr3FbCsslCyrMCi882Vj9EDleRumgcs4h3s4+YLlvtYYGWzymqwUhe+iqZ2AvddU6mi8+F6LGEesQIV987q5jNOXwNRPo3ZxiPTQ3e3a9nP+K0Y+Yt4s/8eGPM2J8WgUD5thF3U/SPRpCtoQqPwrW2Pz5KNvzk+SUwaCTtJ9bG1qW7E8tqO104j6csVf7KwVa9ZjbMF03bFZFG0kSbRa7PAE4ac35t4r6+yWnk/hfO2bpcH1VbE4r6vPF69A987BmfrLHeXy5Y+e2h0k53LkwBR/n4MfDV4RBvHeGKIbCV/IGKudWM3uHp8zbmdghaqeWz+ijjM2JYqWDI96P/DkRmNX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
635	beta	2276	10084	BAAAAAAAAAAMUgAAAAAAAAACAAACewAAAGO7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7sAAAAAAAAPu3DmcOMmrBHIcO5w63DqcOdw9nDzcPJw73D+cPtw+nD3cQZxA3ECcP9xDnELcQpxB3EWcRNxEnEPcR5xG3EacRdxJnEjcSJxH3EucStxKnEncTZxM3EycS9xPnE7cTpxN3FGcUNxQnE/cU5xS3FKcUdxVnFTcVJxT3FecVtxWnFXcWZxY3FicV9xbnFrcWpxZ3F2cXNxcnFvcX5xe3F6cXdxhnGDcYJxf3GOcYtxinGHcZZxk3GScY9xnnGbcZpxl3GmcaNxonGfca5xq3GqcadxtnGzcbJxr3G+cbtxunG3ccZxw3HCcb9xznHLccpxx3HWcdNx0nHPcd5x23Hacddx5nHjceJx33Hucetx6nHncfZx83Hyce9x/nH7cfpx93IGcgNyAnH/cg5yC3IKcgdyFnITchJyD3IechtyGnIXciZyI3Iich9yLnIrcipyJ3I2cjNyMnIvcj5yO3I6cjdyRnJDckJyP3JOcktySnJHclZyU3JSck9yXnJbclpyV3JmcmNyYnJfcm5ya3JqcmdydnJzcnJyb3J+cntyenJ3coZyg3KCcn9yjnKLcopyh3KWcpNyknKPcp5ym3KacpdypnKjcqJyn3KucqtyqnKncrZys3Kycq9yvnK7crpyt3LGcsNywnK/cs5yy3LKcsdy1nLTctJyz3Lectty2nLXcuZy43Lict9y7nLrcupy53L2cvNy8nLvcv5y+3L6cvdzBnMDcwJy/3MOcwtzCnMHcxZzE3MScw9zHnMbcxpzF3MmcyNzInMfcy5zK3MqcydzNnMzczJzL3M+cztzOnM3c0ZzQ3NCcz9zTnNLc0pzR3NWc1NzUnNPc15zW3Nac1dzZnNjc2JzX3Nuc2tzanNnc3Zzc3Nyc29zfnN7c3pzd3OGc4NzgnN/c45zi3OKc4dzlnOTc5Jzj3Oec5tzmnOXc6Zzo3Oic59zrnOrc6pzp3O2c7NzsnOvc75zu3O6c7dzxnPDc8Jzv3POc8tzynPHc9Zz03PSc89z3nPbc9pz13Pmc+Nz4nPfOfhz63Pqc+cAAA8wAAAAAA==	2025-10-29 00:00:10.66157+00	2025-10-29 07:19:10.66157+00	BAAAAuU/lbMOwv/////8bHkAAAACewAAAMbd3d3d3d3d7t3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d0AAAAAAP3d3QAFyotvXx+EAAXKi29raM0HDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrAAxJSQcOe2sAAA8wAAAAAA==	AwBAVIe+TIBMXwAAAnsAAAABAAAAAAAAAA8AACewAAAAAQAAAnsAAAAIAAAAABEfER8AAAQwAAAAAQDCAOAAAAAO4AgAaAAAAAAAAAAAAAAACAAADVAAAAAAABwQAAAAAAc+gARgAAAAAAAAAARAAAAAAAAACiTCSSzTSzDDQcssssswwkkwJJMMJJJJJJKSSSyySTTTDMskkwwwwwwkMMLLMMJJJJLASzTiTDDDTVAkw00EssEkNBJLQJJNBJMAAAACwSSzTgAAAGYAAAALAAAGZmZmZmYNtsM8tc88/w11z10y1100DTTffbTbfXMMNNtss88s9Q0z000013x2DTTTXXXXPfUN9M8M8tNM9Q/1w/3x/1zqDTL/fOjfTPIN9c8r/99atwAAAAAAAA1+AAACICXASLyyTdfu48PPrtbjxCXqzm0Gt8mKy62Y+MsNp5843NHeHr8i3HjosSfNbapOSAfb+ZPfR21m2sAhzcOV1dMsco1Dbx6NdUqy9zubY8oRPzsTj5hVCMx8n9zQp/RA6pDpxugQFr5M928BS/+ixZLreHx9u7WGZ4G8opRfsxZv+Br9XP8F+iF9wOAFw8ttnnfU1pewOphE64vY9Z2fYyrwNGLNv/X+vuArFbenHP3Q76SmFyHs3XYy1zzhgZMnWLs2+ff77BKT/W8IEOeQNK2/O4gjeGM8+t7H9NcZ5I0f/DPOsWSLiK01JKCCictmKb0SvpLbZ398IOVhP8tN5i/GrcTuQ4JdMzg8Kbk5FzRYqEth15kpchrNyHrfG4imPo/W5KnD6poEp8Dr3kXkb/lKB1C9xvpKPJfol59pco/dyj+HaTm5yv28JIFxEBOaHztaAk+4o2Ks3dH/H3bV12rBNKWu1gp+eWPw5XVyVeL97/+3OtjZ4ONsJ40n46zbyJE23LU90Xkg4vy5/qn+vROlmi/8PfZotMhtQcd6x6VSXzJwYAatsw48eHe1lL+Jz5gC13FhUhC1W0eLwhM2JHgTYWX1lkhVpAR3i3uen9YYOQnXyeRIuER0VwXfImdULFglRFPnkP033djjeQJzHFYuYULoXID0Ds2wIh1WTJUdIF4QNq9j7aDCkhMsGVXcUHZCP3F6bCf61EMY+QbpO/ZB6CnRNChNBJODWGNcmKs7AXExk2UDAvIFBBPglfAByA2oNlbQRFb/GscyrMw9gMp/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
1000	gamma	6503	9500	BAAAAAAAAAAlHAAAAAAAAAADAAAD6AAAAAIAAAAAAAAA+wAAAAAyxzLOAAA+QAAAAAA=	2025-10-29 07:20:10.258973+00	2025-10-29 23:59:10.258973+00	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
195	gamma	9503	10085	BAAAAAAAAAAnZQAAAAAAAAADAAAAwwAAAAIAAAAAAAAA+wAAAABKN0o+AAAL8AAAAAA=	2025-10-29 04:05:10.258973+00	2025-10-29 07:19:10.258973+00	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
\.


--
-- Data for Name: compress_hyper_3_8_chunk; Type: TABLE DATA; Schema: _timescaledb_internal; Owner: postgres
--

COPY _timescaledb_internal.compress_hyper_3_8_chunk (_ts_meta_count, series, _ts_meta_v2_min_id, _ts_meta_v2_max_id, id, _ts_meta_min_1, _ts_meta_max_1, ts, value) FROM stdin;
383	alpha	1	6498	BAAAAAAAAAAZYgAAAAAAABhRAAABfwAAAEe7u7u7u7u7+7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7uwAAAAALu7u7AAAAACz/LQYAAAaQAAAAAF8iXx9fHi+RXypfJ18mXyNfMl8vXy5fK186XzdfNl8zX0JfP18+XztfSl9HX0ZfQ19SX09fTl9LX1pfV19WX1NfYl9fX15fW19qX2dfZl9jX3Jfb19uX2tfel93X3Zfc1+CX39ffl97X4pfh1+GX4Nfkl+PX45fi1+aX5dfll+TX6Jfn1+eX5tfql+nX6Zfo1+yX69frl+rX7pft1+2X7Nfwl+/X75fu1/KX8dfxl/DX9Jfz1/OX8tf2l/XX9Zf01/iX99f3l/bX+pf51/mX+Nf8l/vX+5f61/6X/df9l/zYAJf/1/+X/tgCmAHYAZgA2ASYA9gDmALYBpgF2AWYBNgImAfYB5gG2AqYCdgJmAjYDJgL2AuYCtgOmA3YDZgM2BCYD9gPmA7YEpgR2BGYENgUmBPYE5gS2BaYFdgVmBTYGJgX2BeYFtgamBnYGZgY2ByYG9gbmBrYHpgd2B2YHNggmB/YH5ge2CKYIdghmCDYJJgj2COYItgmmCXYJZgk2CiYJ9gnmCbYKpgp2CmYKNgsmCvYK5gq2C6YLdgtmCzYMJgv2C+YLtgymDHYMZgw2DSYM9gzmDLYNpg12DWYNNg4mDfYN5g22DqYOdg5mDjYPJg72DuYOtg+mD3YPZg82ECYP9g/mD7YQphB2EGYQNhEmEPYQ5hC2EaYRdhFmETYSJhH2EeYRthKmEnYSZhI2EyYS9hLmErYTphN2E2YTMAAAAAYT5hOw==	2025-10-30 00:00:10.258973+00	2025-10-30 04:05:10.258973+00	BAAAAuVTs4RKHf//////+dtbAAABfwAAAIzd3d3d3d3f7t3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3dAADd3d3d3d0ABcquP2j6OgAFyq5GkAg5AAAGsAAAAAAHDntsAAxJSgcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntr	AwBARUDHGhZsggAAAX8AAAABAAAAAAAAAA8AABfwAAAAAQAAAX8AAAAFAAAAAAABHx8AAAQgAAAAAQABgAAAACAAAAAJsAAAAAAAAAAAAAEAYwAAAAAAAAAAAAAABzwEDjkjjjzjgU001A09A9A9QPNNQNQRNPP00DjkTzzz0I4448845A88OSOQOQOQROMCSywQSSSzkAAAAEoAAAAIAAAAAGZmZmYLscrcrsMsvwyxwytvvvwvDPPDO+vLHPMMMrcccL8MMQxxwwwxvxtwDG/Ky/HLLLEPt9tcr8brrwAAAAAA31u/AAABQR3ASk8UAQpfI2hb4bIPx1PSi/NtHrwXNERmTKy40d6wDCscRU3Cg6GjR9HuQeuabqYInr0QwX5KPMcjQ6ohKEJvh+g8+94qyY3WgWMQTSHQS77t/noJ14ZEgDkqibNbXBC/td4dilmPj09Jmtnn8TpHjCOJv36VlBS16g2ejNb3uWs/+VwEqn0HpbU+84HiGCPQZH6qgc58V2geNjwHSvbekbTjfBng1PncoSOaHzVGvO8+XeEudTnxHl+ZORmPzCN92RxK389a7Y03LUQfAxw0b+p9JYvdhH4WtorQXPZqpq/C+IA213C+zWB9IfWktsJ0LqgMWOy5tHO7DMrdNTvoCGPO00nQl88hYV9h614WuL7s8Q4/eTbly+jnDJCwHFpHkhgL9vit8D+kXz21Kn5jMPv3uad/0+XCRzOU6WfaGvTi+LeufzFUPthfZo4+d88B83Y/b9s+U9iUsg8IWfu8+xetkvAKWevvcLWn/ihweP+p2QCL4+KZ/AP93/tM0aO5VFBVfBlvAfDQkgcZYNxMCifu25VMX2AuvMnN6+QlaZ9y2QI/lv5203ZP5NK/xNA3UY3Cy4xRf1XFxrjAxw11BsH4ufNq1BfiW4Xegbm3hxZ/UO+7ASoQrojf1uxN0uueJde08OxXPJTb1KIBveVns04qBMxOQJU3lOBbQBcXcH3b/hNk/h0fsFGe6puqUwMOuwBuX/L3kZ/3BH6XUUQz7eM2SJPhv4qtMqicrTUCP+wJXdkpvFBgxh4CWhxHVBFuWu2oNsaSiLjbta8//cmoJXVCaLvSnwfvh7Ovgmf0wG+lEKrdaXL9v4B4SB9AyA1x501VzcOWQfvYOypoShh/N/9gHd5uLAMFAu/v+TNO7hzJTD57pOeU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
383	beta	2	6499	BAAAAAAAAAAZYwAAAAAAABhRAAABfwAAAEe7u7u7u7u7+7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7uwAAAAALu7u7AAAAAC0BLQgAAAaQAAAAAF8iXx9fHi+RXypfJ18mXyNfMl8vXy5fK186XzdfNl8zX0JfP18+XztfSl9HX0ZfQ19SX09fTl9LX1pfV19WX1NfYl9fX15fW19qX2dfZl9jX3Jfb19uX2tfel93X3Zfc1+CX39ffl97X4pfh1+GX4Nfkl+PX45fi1+aX5dfll+TX6Jfn1+eX5tfql+nX6Zfo1+yX69frl+rX7pft1+2X7Nfwl+/X75fu1/KX8dfxl/DX9Jfz1/OX8tf2l/XX9Zf01/iX99f3l/bX+pf51/mX+Nf8l/vX+5f61/6X/df9l/zYAJf/1/+X/tgCmAHYAZgA2ASYA9gDmALYBpgF2AWYBNgImAfYB5gG2AqYCdgJmAjYDJgL2AuYCtgOmA3YDZgM2BCYD9gPmA7YEpgR2BGYENgUmBPYE5gS2BaYFdgVmBTYGJgX2BeYFtgamBnYGZgY2ByYG9gbmBrYHpgd2B2YHNggmB/YH5ge2CKYIdghmCDYJJgj2COYItgmmCXYJZgk2CiYJ9gnmCbYKpgp2CmYKNgsmCvYK5gq2C6YLdgtmCzYMJgv2C+YLtgymDHYMZgw2DSYM9gzmDLYNpg12DWYNNg4mDfYN5g22DqYOdg5mDjYPJg72DuYOtg+mD3YPZg82ECYP9g/mD7YQphB2EGYQNhEmEPYQ5hC2EaYRdhFmETYSJhH2EeYRthKmEnYSZhI2EyYS9hLmErYTphN2E2YTMAAAAAYT5hOw==	2025-10-30 00:00:10.258973+00	2025-10-30 04:05:10.258973+00	BAAAAuVTs4RKHf//////+dtbAAABfwAAAIzd3d3d3d3f7t3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3dAADd3d3d3d0ABcquP2j6OgAFyq5GkAg5AAAGsAAAAAAHDntsAAxJSgcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntrBw57bAcOe2sHDntsBw57awcOe2wHDntr	AwBARzE3r5AW0AAAAX8AAAABAAAAAAAAAA8AABfwAAAAAQAAAX8AAAAFAAAAAAABHx8AAAQgAAAAAQAACAAAAAAcAAAIkAAAAADGcFAEBGAAXQAAMPMAAAAYAAAACgzz0DzjkzzlQU9E0081E088PNQNQQRRQRPlETkkTzzzz445FE85E444SSPOOPRPQSOSzDASSyzjj8wEw0k4EktoLLOPBBJNJJIAAAAAAAACSQAAAGIAAAAKAAAAZmZmZmYLsMcsrccafwuyxxzvzvwxDDK2y+267PEMbr7cMccMcwuxwtyyyyrvDHC/G63LLGwN9c8sMY7sMAx/31m30zv+DfPbXW7/LPYAAN9ddMrv/gAAAUEjwEk+mvVh3asQMavmH0VQtVWO3yfXHyAfjdpJL29RH2/QxlOJpxiDM36om5RPrSCp2cJlG2BgX6EaN66x3zA2I5Mdac4NTYmifq0+ebHs32Vb5756Z6Pld16CXUr46tO4iHTn2n8l/dN1x7PrRMINJe2aBk7KmuW+LyV++ZUjsuo/vgjBgR6drvBxRQwwLuAjafsVhPCr8+Eqj7cljSGMWM5JSKHz3DTHm/96hraylm1E2t+svIWVH/hUtRqvKOSjvaY4pAG+f8NI6jVPzhp0b2vw1zPsMbHFXnuSZKv68/d2Kt8Y21/947prKA5zhqUkaZmqtwgTc0ohlJkOueJ6i5FefEn6ui03279xa/eks+s3Pq/0gsl2yVThA4GrsKi9T649HZL5C+VOcIjKW7tcT/9OWNgB7w+iXPYqw0s56pg8eZ/1OA1Mrm1N2ENDdjWZIb8axEl0/X1cRXiNu0H8Djfwpblnv7MLJz5eKSY6hx/t2JB9LP4RvSMwBJpvF4t6HoMyfzK96rNmAgVjfXW9eAXV3EHL5giriI0n/JvNUhkVJNo4b3Ywc5V2GjKp6/IEbBYZBZZuQCCs/wK80DWEFZdKGBACBbNz9FHhs5QGagO9c03KglfAmPj/DhxTYwGHLKrAN0CwO7qnC7ZEHIdK8EbVwgTHgTJf8AqCqsFwf6ShfncneRLF/f6xX9mMGhwPGpZcLAl1Rz4lUZtm/IHx/wLC3P3ZiBgKAHDJGQIMCMgA11wawIEMw9uOOhEDxA5BxBwMxgBPpu7hw/xu/VtA/UKvz4Ol50VCUezT/Ug9pTn6O8M5MBpJHnBQjUsvUg8E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
246	gamma	5765	6500	BAAAAAAAAAAZZAAAAAAAAAADAAAA9gAAAAIAAAAAAAAA+wAAAAAtAy0KAAAPIAAAAAA=	2025-10-30 00:00:10.258973+00	2025-10-30 04:05:10.258973+00	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
\.


--
-- Data for Name: _tmp_ts; Type: TABLE DATA; Schema: ag_catalog; Owner: postgres
--

COPY ag_catalog._tmp_ts (ts, val) FROM stdin;
\.


--
-- Data for Name: _tmp_vec; Type: TABLE DATA; Schema: ag_catalog; Owner: postgres
--

COPY ag_catalog._tmp_vec (id, emb) FROM stdin;
1	[1,0,0,0]
2	[0,1,0,0]
3	[1,0.1,0,0]
\.


--
-- Data for Name: ag_graph; Type: TABLE DATA; Schema: ag_catalog; Owner: postgres
--

COPY ag_catalog.ag_graph (graphid, name, namespace) FROM stdin;
83127	graph_liq	graph_liq
\.


--
-- Data for Name: ag_label; Type: TABLE DATA; Schema: ag_catalog; Owner: postgres
--

COPY ag_catalog.ag_label (name, graph, id, kind, relation, seq_name) FROM stdin;
_ag_label_vertex	83127	1	v	graph_liq._ag_label_vertex	_ag_label_vertex_id_seq
_ag_label_edge	83127	2	e	graph_liq._ag_label_edge	_ag_label_edge_id_seq
Entity	83127	8	v	graph_liq."Entity"	Entity_id_seq
REL	83127	9	e	graph_liq."REL"	REL_id_seq
\.


--
-- Data for Name: rag_chunks; Type: TABLE DATA; Schema: ag_catalog; Owner: postgres
--

COPY ag_catalog.rag_chunks (id, doc_id, chunk, src, created_at) FROM stdin;
6	doc_1	seed chunk 1	seed	2025-11-10 03:47:44.401563+00
7	doc_2	seed chunk 2	seed	2025-11-10 03:46:44.401563+00
8	doc_3	seed chunk 3	seed	2025-11-10 03:45:44.401563+00
9	doc_4	seed chunk 4	seed	2025-11-10 03:44:44.401563+00
10	doc_5	seed chunk 5	seed	2025-11-10 03:43:44.401563+00
\.


--
-- Data for Name: rag_embeddings; Type: TABLE DATA; Schema: ag_catalog; Owner: postgres
--

COPY ag_catalog.rag_embeddings (chunk_id, emb, model, created_at, emb_unit, emb_mag, volume, confidence, updated_at, scale) FROM stdin;
6	[0.7331,0.8097,0.6502,0.9127,0.0237,0.1903,0.3,0.5575,0.3532,0.4566,0.8754,0.8489,0.4467,0.5562,0.0798,0.1265,0.1498,0.014,0.5874,0.2362,0.42,0.9049,0.4078,0.0926,0.1979,0.3253,0.7447,0.032,0.6831,0.2585,0.5627,0.6532,0.9232,0.7607,0.7129,0.4934,0.224,0.0551,0.2291,0.2517,0.6001,0.743,0.4923,0.8227,0.4696,0.9969,0.5116,0.6006,0.9282,0.8014,0.9153,0.9787,0.8224,0.8449,0.7728,0.1571,0.4613,0.6728,0.52,0.7127,0.4178,0.7368,0.7254,0.057,0.3933,0.3115,0.5306,0.4789,0.6045,0.0798,0.9045,0.0182,0.9116,0.9088,0.4516,0.1809,0.0013,0.9217,0.4415,0.2266,0.9744,0.1338,0.8338,0.1943,0.3162,0.1397,0.6522,0.63,0.7232,0.8029,0.5525,0.2429,0.4419,0.9125,0.9634,0.5987,0.5072,0.0648,0.9821,0.852,0.1033,0.1573,0.6951,0.5636,0.9253,0.306,0.9404,0.7175,0.3661,0.0939,0.3485,0.7622,0.9557,0.665,0.4809,0.846,0.4726,0.2467,0.6278,0.3151,0.0656,0.0512,0.9545,0.2783,0.8844,0.4456,0.6374,0.2889,0.5778,0.6963,0.5866,0.4494,0.8733,0.3015,0.7059,0.938,0.1311,0.0369,0.2502,0.9823,0.0471,0.2924,0.3445,0.83,0.5563,0.1304,0.7499,0.9087,0.1485,0.4292,0.6053,0.0443,0.0944,0.1914,0.1188,0.7396,0.7531,0.86,0.1604,0.6484,0.2422,0.1241,0.9731,0.2669,0.1159,0.8771,0.7831,0.1584,0.0979,0.7852,0.8958,0.8152,0.8827,0.483,0.3839,0.8025,0.7433,0.5524,0.0151,0.0776,0.9346,0.5412,0.8119,0.6551,0.1544,0.5739,0.6891,0.1941,0.4885,0.5511,0.852,0.1055,0.1554,0.1452,0.2285,0.4078,0.9068,0.6274,0.552,0.8951,0.4823,0.4667,0.8063,0.2294,0.0727,0.3359,0.9489,0.7746,0.7838,0.9097,0.6173,0.8093,0.1308,0.6534,0.282,0.9285,0.7775,0.4229,0.4972,0.8554,0.2278,0.6224,0.1792,0.3769,0.2659,0.7507,0.7,0.1054,0.588,0.8511,0.7888,0.7484,0.5821,0.4926,0.2919,0.9305,0.173,0.4304,0.3556,0.8002,0.6216,0.5944,0.3289,0.1113,0.5266,0.8156,0.1334,0.4558,0.8236,0.9916,0.8407,0.3305,0.0978,0.7516,0.6052,0.371,0.63,0.1088,0.711,0.6767,0.2296,0.9995,0.5761,0.0204,0.7811,0.1301,0.0971,0.1609,0.1668,0.0774,0.1249,0.9094,0.7928,0.7178,0.7615,0.7453,0.084,0.2519,0.0824,0.9345,0.1856,0.9082,0.1794,0.1607,0.3537,0.8842,0.6848,0.7447,0.7831,0.9822,0.0352,0.0686,0.5612,0.5005,0.6841,0.5211,0.9415,0.8274,0.5317,0.9444,0.3647,0.5673,0.3292,0.6794,0.555,0.557,0.6546,0.4205,0.3256,0.0366,0.296,0.6729,0.1316,0.0841,0.622,0.0998,0.0084,0.585,0.2918,0.3616,0.5459,0.0579,0.4175,0.2816,0.3135,0.2844,0.8309,0.0967,0.104,0.3796,0.5454,0.0026,0.6771,0.3214,0.5667,0.2738,0.4812,0.6637,0.738,0.0504,0.6916,0.6095,0.571,0.1327,0.1727,0.668,0.6655,0.2202,0.5617,0.0412,0.5562,0.7446,0.278,0.2129,0.7847,0.353,0.3047,0.0315,0.9669,0.3886,0.8853,0.1684,0.8019,0.1266,0.3706,0.0379,0.1375,0.9464,0.8012,0.1912,0.7582,0.8482,0.5972,0.0129,0.638,0.5242,0.2626,0.7567,0.8149,0.3705,0.5545,0.9326,0.5524,0.0517,0.8801,0.9862,0.9944,0.6245,0.2719,0.2608,0.2499,0.6187,0.0177,0.4506,0.8003,0.8647,0.7763,0.2446,0.4045,0.7264,0.358,0.8101,0.1951,0.3755,0.7818,0.6308,0.0614,0.381,0.3283,0.6724,0.6879,0.8554,0.1029,0.0737,0.2383,0.4759,0.8908,0.24,0.7186,0.1774,0.3121,0.589,0.5492,0.81,0.0833,0.2955,0.5614,0.0864,0.1579,0.7521,0.6059,0.6502,0.3494,0.3258,0.9816,0.6451,0.5344,0.1613,0.9047,0.3978,0.9337,0.0736,0.9813,0.7978,0.9242,0.2897,0.4543,0.6023,0.244,0.7062,0.9789,0.5668,0.3031,0.6751,0.0238,0.6486,0.1219,0.8895,0.7749,0.7163,0.7765,0.9773,0.7877,0.9938,0.2319,0.076,0.4551,0.3841,0.2301,0.6313,0.1824,0.614,0.021,0.9712,0.5184,0.2957,0.8963,0.4461,0.821,0.535,0.6229,0.0911,0.0568,0.5104,0.6751,0.6428,0.194,0.2784,0.9961,0.5423,0.426,0.1357,0.5923,0.9773,0.3796,0.9745,0.6745,0.1675,0.8447,0.7299,0.2101,0.251,0.7611,0.137,0.0131,0.0233,0.643,0.8757,0.9882,0.3477,0.8887,0.0196,0.7033,0.5131,0.5984,0.2526,0.7608,0.5462,0.6216,0.3468,0.2204,0.1248,0.2734,0.5807,0.8365,0.9547,0.6065,0.6161,0.3069,0.8109,0.0456,0.8972,0.4919,0.8485,0.7354,0.5386,0.2791,0.3036,0.7726,0.6261,0.787,0.3075,0.7451,0.7793,0.63,0.7657,0.235,0.3937,0.3624,0.2789,0.7092,0.5016,0.6645,0.9225,0.8362,0.2548,0.9477,0.4412,0.9354,0.2565,0.2739,0.5632,0.0313,0.2722,0.5119,0.4245,0.3142,0.1404,0.8911,0.4179,0.7651,0.1778,0.3594,0.3538,0.6004,0.1929,0.8078,0.4197,0.4949,0.4105,0.8227,0.9911,0.2114,0.733,0.7923,0.518,0.5932,0.8493,0.0789,0.4008,0.9863,0.7538,0.8113,0.2908,0.2043,0.1274,0.3126,0.6008,0.4877,0.5637,0.4008,0.096,0.3175,0.36,0.9659,0.1036,0.4438,0.5656,0.9897,0.8794,0.7577,0.6888,0.755,0.73,0.1739,0.3796,0.1222,0.6274,0.4802,0.4206,0.8357,0.7494,0.0345,0.0814,0.4991,0.4583,0.5459,0.067,0.2986,0.5973,0.9651,0.1609,0.4628,0.0298,0.6352,0.6005,0.3974,0.759,0.2072,0.7239,0.1528,0.1055,0.5699,0.6745,0.7723,0.3748,0.7938,0.2933,0.9541,0.5736,0.713,0.642,0.9763,0.5285,0.7003,0.4948,0.2131,0.7361,0.6956,0.8272,0.3275,0.9658,0.4641,0.5538,0.5636,0.7101,0.9133,0.2926,0.2562,0.0994,0.9273,0.6267,0.4522,0.4725,0.864,0.7871,0.6456,0.9434,0.0891,0.0662,0.7675,0.7745,0.264,0.9639,0.9261,0.9285,0.6523,0.9689,0.1393,0.5772,0.1571,0.8191,0.6651,0.6823,0.0386,0.7224,0.3585,0.2872,0.6733,0.8112,0.4963,0.3317,0.938,0.3667,0.5931,0.0012,0.3537,0.1976,0.083,0.8304,0.4795,0.2637,0.6546,0.0573,0.9973,0.1397,0.8082,0.452,0.6021,0.856,0.8577,0.8938,0.2358,0.3597,0.6201,0.3683,0.8143,0.9454,0.0596,0.6786,0.3343,0.9113,0.0288,0.8185,0.5878,0.33,0.8133,0.3216,0.7254,0.1081,0.4938,0.7417,0.7033,0.4079,0.5644,0.441,0.7037,0.0005,0.8307,0.953,0.2002,0.6669,0.0749,0.0939,0.0837,0.0161,0.5225,0.315,0.6043,0.8365,0.0052,0.0445,0.3227,0.4573,0.9324,0.2649,0.3955,0.2538,0.5114,0.9972,0.1949,0.9401,0.5907,0.1476,0.0843,0.9109,0.7747,0.7866,0.3406,0.5034,0.2999,0.8525,0.1724,0.2599,0.8252,0.2268,0.4335,0.1532,0.5508,0.1777,0.7669,0.9715,0.3265,0.5461,0.4787,0.6468,0.3343,0.9817,0.3583,0.1275,0.6358,0.3523,0.9697,0.843,0.7125,0.3385,0.9867,0.7955,0.8145,0.8424,0.4324,0.0804,0.0889,0.3916,0.2055,0.2375,0.4433,0.4219,0.3321,0.7897,0.4703,0.0395,0.0638,0.136,0.0363,0.9264,0.7047,0.4387,0.5254,0.7796,0.0022,0.8722,0.3922,0.4546,0.4333,0.1313,0.8348,0.846,0.6301,0.8865,0.0279,0.054,0.8167,0.4611,0.3171,0.5351,0.7973,0.1907,0.2242,0.8768,0.3316,0.5579,0.7296,0.1118,0.1054,0.3003,0.4495,0.3907,0.8967,0.0392,0.2833,0.1403,0.0285,0.7028,0.4732,0.179,0.3701,0.2703,0.4978,0.881,0.8906,0.8719,0.9697,0.3516,0.3812,0.9481,0.9711,0.4957,0.1777,0.0546,0.0132,0.8406,0.1185,0.8273,0.6099,0.1837,0.0519,0.6577,0.4361,0.5004,0.5724,0.7362,0.7385,0.396,0.6591,0.6942,0.0329,0.7225,0.7649,0.3419,0.1153,0.2675,0.645,0.2699,0.4426,0.7045,0.155,0.505,0.5804,0.4885,0.4223,0.4374,0.4431,0.3606,0.3968,0.1356,0.7475,0.9807,0.8966,0.7985,0.3601,0.3577,0.2676,0.44,0.4467,0.5024,0.0896,0.7041,0.786,0.0971,0.2769,0.6195,0.2275,0.7631,0.6528,0.4023,0.6274,0.1658,0.1015,0.1783,0.4332,0.5549,0.2708,0.3172,0.8643,0.4837,0.4499,0.1771,0.5172,0.8127,0.8037,0.0062,0.3277,0.8363,0.1751,0.5388,0.3619,0.3065,0.185,0.0156,0.5355,0.4277,0.8475,0.4981,0.5095,0.2622,0.0852,0.8594,0.6152,0.4342,0.3175,0.9704,0.6327,0.0867,0.9099,0.7705,0.099,0.5355,0.5727,0.2204,0.4581,0.33,0.4707,0.9875,0.3634,0.7457,0.6345,0.6247,0.4889,0.9301,0.0819,0.6962,0.1486,0.4302,0.4791,0.5752,0.2319,0.1469,0.9376,0.1089,0.0365,0.3227,0.3755,0.2468,0.3692,0.1102,0.4207,0.1006,0.6923,0.6545,0.5816,0.7392,0.116,0.1178,0.8122,0.9768,0.9608,0.7842,0.5136,0.8117,0.0502,0.134,0.6417,0.0148,0.2397,0.6575,0.9509,0.7941,0.2466,0.6698,0.1531,0.0632,0.2649,0.4478,0.7299,0.8543,0.8549,0.2953,0.7131,0.1417,0.5754,0.8219,0.1919,0.756,0.8725,0.5791,0.6633,0.8585,0.1366,0.7986,0.0885,0.9589,0.648,0.8829,0.4593,0.3233,0.8013,0.2216,0.4672,0.9605,0.2811,0.3762,0.5331,0.0981,0.4472,0.7063,0.3636,0.0962,0.4269,0.7975,0.925,0.6669,0.0905,0.2605,0.9126,0.0224,0.9996,0.1324,0.6627,0.4812,0.1719,0.3323,0.7988,0.8439,0.7012,0.1915,0.1442,0.6865,0.6525,0.3114,0.1153,0.2794,0.5626,0.786,0.8969,0.1848,0.0902,0.2487,0.6569,0.8872,0.0151,0.7557,0.376,0.2619,0.5782,0.3089,0.7281,0.0971,0.6529,0.4053,0.459,0.1911,0.0298,0.4213,0.2795,0.7618,0.1539,0.1778,0.6666,0.5873,0.4255,0.8943,0.789,0.6279,0.5738,0.7347,0.7577,0.5534,0.8343,0.7777,0.0398,0.1544,0.539,0.5608,0.0013,0.501,0.9779,0.4794,0.6223,0.0747,0.976,0.6062,0.9215,0.9627,0.5645,0.0005,0.385,0.8625,0.9461,0.1035,0.4186,0.4275,0.4128,0.548,0.5125,0.4652,0.4709,0.6029,0.2069,0.4498,0.7881,0.6491,0.7219,0.0853,0.7509,0.6255,0.7313,0.8105,0.541,0.3796,0.8281,0.5755,0.907,0.8779,0.1806,0.3101,0.9385,0.858,0.3478,0.2483,0.6059,0.4957,0.148,0.5801,0.8584,0.6656,0.2468,0.2409,0.8448,0.5606,0.5488,0.6444,0.7581,0.0442,0.8845,0.7643,0.4395,0.1599,0.8619,0.9131,0.5506,0.4354,0.254,0.0187,0.0079,0.1363,0.8115,0.9863,0.3834,0.4616,0.3165,0.9224,0.6279,0.5491,0.44,0.5926,0.7481,0.5414,0.1351,0.2157,0.896,0.9696,0.3605,0.323,0.09,0.0658,0.8521,0.2464,0.6778,0.9701,0.7439,0.06,0.8287,0.5473,0.9255,0.9526,0.6165,0.4697,0.124,0.9475,0.9285,0.9358,0.147,0.1248,0.4625,0.8516,0.0656,0.0835,0.2606,0.7604,0.1047,0.8949,0.8996,0.3915,0.9156,0.7973,0.8347,0.287,0.4835,0.9215,0.3475,0.0976,0.9504,0.6243,0.5095,0.817,0.7512,0.1635,0.5495,0.1819,0.2947,0.2778,0.0155,0.586,0.748,0.4383,0.5112,0.3398,0.585,0.8159,0.6174,0.713,0.2784,0.675,0.6835,0.4813,0.4254,0.0767,0.8609,0.7787,0.167,0.9658,0.3751,0.0589,0.4259,0.7077,0.6318,0.2537,0.9233,0.1553,0.0898,0.6915,0.0244,0.32,0.3721,0.2705,0.8694,0.2452,0.4212,0.5664,0.4065,0.7048,0.5379,0.1948,0.0869,0.952,0.2955,0.8326,0.934,0.3961,0.3562,0.4368,0.7944,0.6328,0.8597,0.2193,0.3185,0.7702,0.742,0.4631,0.262,0.457,0.1213,0.8219,0.715,0.7331,0.4837,0.4029,0.6348,0.4223,0.1483,0.7461,0.4888,0.055,0.824,0.6139,0.3203,0.9667,0.196,0.6106,0.0095,0.9789,0.8975,0.5951,0.3915,0.0822,0.5955,0.978,0.2569,0.1826,0.0774,0.8272,0.0276,0.1152,0.1301,0.0538,0.5482,0.3748,0.9332,0.4797,0.8889,0.3629,0.5149,0.1861,0.8084,0.0962,0.4466,0.6612,0.3016,0.1691,0.1508,0.4669,0.118,0.7729,0.6755,0.6513,0.2179,0.1472,0.9779,0.9987,0.3508,0.1067,0.0239,0.6827,0.2007,0.7654,0.96,0.6791,0.5217,0.4831,0.1191,0.7262,0.7417,0.0539,0.5778,0.2836,0.3204,0.2193,0.4735,0.1178,0.3324,0.8702,0.0733,0.0765,0.6354,0.2223,0.9643,0.927,0.2153,0.8297,0.6146,0.8069,0.7107,0.7443,0.58,0.0148,0.9108,0.9424,0.1494,0.4738,0.4369,0.6776,0.1627,0.1484,0.7714,0.5366,0.077,0.5975,0.5916,0.679,0.1739,0.2769,0.055,0.0047,0.1518,0.2007,0.2491,0.2009,0.727,0.9169,0.8809,0.3556,0.0391,0.4504,0.2326,0.0094,0.2398,0.0834,0.0784,0.1626,0.0946,0.0232,0.2308,0.4251,0.1543,0.654,0.7362,0.1353,0.4677,0.0559,0.5868,0.145,0.3607,0.3767,0.7126,0.8909,0.2609,0.9068,0.7257,0.4992,0.0714,0.6378,0.1891,0.7577,0.7993,0.0762,0.3745,0.0175,0.186,0.3852,0.6097,0.2976,0.1723,0.669,0.8491,0.1884,0.8921,0.7774,0.0924,0.5801,0.4462,0.4996,0.8446,0.3974,0.2988,0.5122,0.4257,0.0507,0.2361,0.8199,0.6052,0.0402,0.2948,0.8419,0.266,0.1124,0.2657,0.1337,0.1593,0.4517,0.4253,0.1802,0.7642,0.144,0.0217,0.9054,0.1856,0.4612,0.0095,0.7022,0.6057,0.3713,0.1052,0.1617,0.473,0.0953]	seed-model	2025-11-10 04:48:51.599122+00	[0.7331,0.8097,0.6502,0.9127,0.0237,0.1903,0.3,0.5575,0.3532,0.4566,0.8754,0.8489,0.4467,0.5562,0.0798,0.1265,0.1498,0.014,0.5874,0.2362,0.42,0.9049,0.4078,0.0926,0.1979,0.3253,0.7447,0.032,0.6831,0.2585,0.5627,0.6532,0.9232,0.7607,0.7129,0.4934,0.224,0.0551,0.2291,0.2517,0.6001,0.743,0.4923,0.8227,0.4696,0.9969,0.5116,0.6006,0.9282,0.8014,0.9153,0.9787,0.8224,0.8449,0.7728,0.1571,0.4613,0.6728,0.52,0.7127,0.4178,0.7368,0.7254,0.057,0.3933,0.3115,0.5306,0.4789,0.6045,0.0798,0.9045,0.0182,0.9116,0.9088,0.4516,0.1809,0.0013,0.9217,0.4415,0.2266,0.9744,0.1338,0.8338,0.1943,0.3162,0.1397,0.6522,0.63,0.7232,0.8029,0.5525,0.2429,0.4419,0.9125,0.9634,0.5987,0.5072,0.0648,0.9821,0.852,0.1033,0.1573,0.6951,0.5636,0.9253,0.306,0.9404,0.7175,0.3661,0.0939,0.3485,0.7622,0.9557,0.665,0.4809,0.846,0.4726,0.2467,0.6278,0.3151,0.0656,0.0512,0.9545,0.2783,0.8844,0.4456,0.6374,0.2889,0.5778,0.6963,0.5866,0.4494,0.8733,0.3015,0.7059,0.938,0.1311,0.0369,0.2502,0.9823,0.0471,0.2924,0.3445,0.83,0.5563,0.1304,0.7499,0.9087,0.1485,0.4292,0.6053,0.0443,0.0944,0.1914,0.1188,0.7396,0.7531,0.86,0.1604,0.6484,0.2422,0.1241,0.9731,0.2669,0.1159,0.8771,0.7831,0.1584,0.0979,0.7852,0.8958,0.8152,0.8827,0.483,0.3839,0.8025,0.7433,0.5524,0.0151,0.0776,0.9346,0.5412,0.8119,0.6551,0.1544,0.5739,0.6891,0.1941,0.4885,0.5511,0.852,0.1055,0.1554,0.1452,0.2285,0.4078,0.9068,0.6274,0.552,0.8951,0.4823,0.4667,0.8063,0.2294,0.0727,0.3359,0.9489,0.7746,0.7838,0.9097,0.6173,0.8093,0.1308,0.6534,0.282,0.9285,0.7775,0.4229,0.4972,0.8554,0.2278,0.6224,0.1792,0.3769,0.2659,0.7507,0.7,0.1054,0.588,0.8511,0.7888,0.7484,0.5821,0.4926,0.2919,0.9305,0.173,0.4304,0.3556,0.8002,0.6216,0.5944,0.3289,0.1113,0.5266,0.8156,0.1334,0.4558,0.8236,0.9916,0.8407,0.3305,0.0978,0.7516,0.6052,0.371,0.63,0.1088,0.711,0.6767,0.2296,0.9995,0.5761,0.0204,0.7811,0.1301,0.0971,0.1609,0.1668,0.0774,0.1249,0.9094,0.7928,0.7178,0.7615,0.7453,0.084,0.2519,0.0824,0.9345,0.1856,0.9082,0.1794,0.1607,0.3537,0.8842,0.6848,0.7447,0.7831,0.9822,0.0352,0.0686,0.5612,0.5005,0.6841,0.5211,0.9415,0.8274,0.5317,0.9444,0.3647,0.5673,0.3292,0.6794,0.555,0.557,0.6546,0.4205,0.3256,0.0366,0.296,0.6729,0.1316,0.0841,0.622,0.0998,0.0084,0.585,0.2918,0.3616,0.5459,0.0579,0.4175,0.2816,0.3135,0.2844,0.8309,0.0967,0.104,0.3796,0.5454,0.0026,0.6771,0.3214,0.5667,0.2738,0.4812,0.6637,0.738,0.0504,0.6916,0.6095,0.571,0.1327,0.1727,0.668,0.6655,0.2202,0.5617,0.0412,0.5562,0.7446,0.278,0.2129,0.7847,0.353,0.3047,0.0315,0.9669,0.3886,0.8853,0.1684,0.8019,0.1266,0.3706,0.0379,0.1375,0.9464,0.8012,0.1912,0.7582,0.8482,0.5972,0.0129,0.638,0.5242,0.2626,0.7567,0.8149,0.3705,0.5545,0.9326,0.5524,0.0517,0.8801,0.9862,0.9944,0.6245,0.2719,0.2608,0.2499,0.6187,0.0177,0.4506,0.8003,0.8647,0.7763,0.2446,0.4045,0.7264,0.358,0.8101,0.1951,0.3755,0.7818,0.6308,0.0614,0.381,0.3283,0.6724,0.6879,0.8554,0.1029,0.0737,0.2383,0.4759,0.8908,0.24,0.7186,0.1774,0.3121,0.589,0.5492,0.81,0.0833,0.2955,0.5614,0.0864,0.1579,0.7521,0.6059,0.6502,0.3494,0.3258,0.9816,0.6451,0.5344,0.1613,0.9047,0.3978,0.9337,0.0736,0.9813,0.7978,0.9242,0.2897,0.4543,0.6023,0.244,0.7062,0.9789,0.5668,0.3031,0.6751,0.0238,0.6486,0.1219,0.8895,0.7749,0.7163,0.7765,0.9773,0.7877,0.9938,0.2319,0.076,0.4551,0.3841,0.2301,0.6313,0.1824,0.614,0.021,0.9712,0.5184,0.2957,0.8963,0.4461,0.821,0.535,0.6229,0.0911,0.0568,0.5104,0.6751,0.6428,0.194,0.2784,0.9961,0.5423,0.426,0.1357,0.5923,0.9773,0.3796,0.9745,0.6745,0.1675,0.8447,0.7299,0.2101,0.251,0.7611,0.137,0.0131,0.0233,0.643,0.8757,0.9882,0.3477,0.8887,0.0196,0.7033,0.5131,0.5984,0.2526,0.7608,0.5462,0.6216,0.3468,0.2204,0.1248,0.2734,0.5807,0.8365,0.9547,0.6065,0.6161,0.3069,0.8109,0.0456,0.8972,0.4919,0.8485,0.7354,0.5386,0.2791,0.3036,0.7726,0.6261,0.787,0.3075,0.7451,0.7793,0.63,0.7657,0.235,0.3937,0.3624,0.2789,0.7092,0.5016,0.6645,0.9225,0.8362,0.2548,0.9477,0.4412,0.9354,0.2565,0.2739,0.5632,0.0313,0.2722,0.5119,0.4245,0.3142,0.1404,0.8911,0.4179,0.7651,0.1778,0.3594,0.3538,0.6004,0.1929,0.8078,0.4197,0.4949,0.4105,0.8227,0.9911,0.2114,0.733,0.7923,0.518,0.5932,0.8493,0.0789,0.4008,0.9863,0.7538,0.8113,0.2908,0.2043,0.1274,0.3126,0.6008,0.4877,0.5637,0.4008,0.096,0.3175,0.36,0.9659,0.1036,0.4438,0.5656,0.9897,0.8794,0.7577,0.6888,0.755,0.73,0.1739,0.3796,0.1222,0.6274,0.4802,0.4206,0.8357,0.7494,0.0345,0.0814,0.4991,0.4583,0.5459,0.067,0.2986,0.5973,0.9651,0.1609,0.4628,0.0298,0.6352,0.6005,0.3974,0.759,0.2072,0.7239,0.1528,0.1055,0.5699,0.6745,0.7723,0.3748,0.7938,0.2933,0.9541,0.5736,0.713,0.642,0.9763,0.5285,0.7003,0.4948,0.2131,0.7361,0.6956,0.8272,0.3275,0.9658,0.4641,0.5538,0.5636,0.7101,0.9133,0.2926,0.2562,0.0994,0.9273,0.6267,0.4522,0.4725,0.864,0.7871,0.6456,0.9434,0.0891,0.0662,0.7675,0.7745,0.264,0.9639,0.9261,0.9285,0.6523,0.9689,0.1393,0.5772,0.1571,0.8191,0.6651,0.6823,0.0386,0.7224,0.3585,0.2872,0.6733,0.8112,0.4963,0.3317,0.938,0.3667,0.5931,0.0012,0.3537,0.1976,0.083,0.8304,0.4795,0.2637,0.6546,0.0573,0.9973,0.1397,0.8082,0.452,0.6021,0.856,0.8577,0.8938,0.2358,0.3597,0.6201,0.3683,0.8143,0.9454,0.0596,0.6786,0.3343,0.9113,0.0288,0.8185,0.5878,0.33,0.8133,0.3216,0.7254,0.1081,0.4938,0.7417,0.7033,0.4079,0.5644,0.441,0.7037,0.0005,0.8307,0.953,0.2002,0.6669,0.0749,0.0939,0.0837,0.0161,0.5225,0.315,0.6043,0.8365,0.0052,0.0445,0.3227,0.4573,0.9324,0.2649,0.3955,0.2538,0.5114,0.9972,0.1949,0.9401,0.5907,0.1476,0.0843,0.9109,0.7747,0.7866,0.3406,0.5034,0.2999,0.8525,0.1724,0.2599,0.8252,0.2268,0.4335,0.1532,0.5508,0.1777,0.7669,0.9715,0.3265,0.5461,0.4787,0.6468,0.3343,0.9817,0.3583,0.1275,0.6358,0.3523,0.9697,0.843,0.7125,0.3385,0.9867,0.7955,0.8145,0.8424,0.4324,0.0804,0.0889,0.3916,0.2055,0.2375,0.4433,0.4219,0.3321,0.7897,0.4703,0.0395,0.0638,0.136,0.0363,0.9264,0.7047,0.4387,0.5254,0.7796,0.0022,0.8722,0.3922,0.4546,0.4333,0.1313,0.8348,0.846,0.6301,0.8865,0.0279,0.054,0.8167,0.4611,0.3171,0.5351,0.7973,0.1907,0.2242,0.8768,0.3316,0.5579,0.7296,0.1118,0.1054,0.3003,0.4495,0.3907,0.8967,0.0392,0.2833,0.1403,0.0285,0.7028,0.4732,0.179,0.3701,0.2703,0.4978,0.881,0.8906,0.8719,0.9697,0.3516,0.3812,0.9481,0.9711,0.4957,0.1777,0.0546,0.0132,0.8406,0.1185,0.8273,0.6099,0.1837,0.0519,0.6577,0.4361,0.5004,0.5724,0.7362,0.7385,0.396,0.6591,0.6942,0.0329,0.7225,0.7649,0.3419,0.1153,0.2675,0.645,0.2699,0.4426,0.7045,0.155,0.505,0.5804,0.4885,0.4223,0.4374,0.4431,0.3606,0.3968,0.1356,0.7475,0.9807,0.8966,0.7985,0.3601,0.3577,0.2676,0.44,0.4467,0.5024,0.0896,0.7041,0.786,0.0971,0.2769,0.6195,0.2275,0.7631,0.6528,0.4023,0.6274,0.1658,0.1015,0.1783,0.4332,0.5549,0.2708,0.3172,0.8643,0.4837,0.4499,0.1771,0.5172,0.8127,0.8037,0.0062,0.3277,0.8363,0.1751,0.5388,0.3619,0.3065,0.185,0.0156,0.5355,0.4277,0.8475,0.4981,0.5095,0.2622,0.0852,0.8594,0.6152,0.4342,0.3175,0.9704,0.6327,0.0867,0.9099,0.7705,0.099,0.5355,0.5727,0.2204,0.4581,0.33,0.4707,0.9875,0.3634,0.7457,0.6345,0.6247,0.4889,0.9301,0.0819,0.6962,0.1486,0.4302,0.4791,0.5752,0.2319,0.1469,0.9376,0.1089,0.0365,0.3227,0.3755,0.2468,0.3692,0.1102,0.4207,0.1006,0.6923,0.6545,0.5816,0.7392,0.116,0.1178,0.8122,0.9768,0.9608,0.7842,0.5136,0.8117,0.0502,0.134,0.6417,0.0148,0.2397,0.6575,0.9509,0.7941,0.2466,0.6698,0.1531,0.0632,0.2649,0.4478,0.7299,0.8543,0.8549,0.2953,0.7131,0.1417,0.5754,0.8219,0.1919,0.756,0.8725,0.5791,0.6633,0.8585,0.1366,0.7986,0.0885,0.9589,0.648,0.8829,0.4593,0.3233,0.8013,0.2216,0.4672,0.9605,0.2811,0.3762,0.5331,0.0981,0.4472,0.7063,0.3636,0.0962,0.4269,0.7975,0.925,0.6669,0.0905,0.2605,0.9126,0.0224,0.9996,0.1324,0.6627,0.4812,0.1719,0.3323,0.7988,0.8439,0.7012,0.1915,0.1442,0.6865,0.6525,0.3114,0.1153,0.2794,0.5626,0.786,0.8969,0.1848,0.0902,0.2487,0.6569,0.8872,0.0151,0.7557,0.376,0.2619,0.5782,0.3089,0.7281,0.0971,0.6529,0.4053,0.459,0.1911,0.0298,0.4213,0.2795,0.7618,0.1539,0.1778,0.6666,0.5873,0.4255,0.8943,0.789,0.6279,0.5738,0.7347,0.7577,0.5534,0.8343,0.7777,0.0398,0.1544,0.539,0.5608,0.0013,0.501,0.9779,0.4794,0.6223,0.0747,0.976,0.6062,0.9215,0.9627,0.5645,0.0005,0.385,0.8625,0.9461,0.1035,0.4186,0.4275,0.4128,0.548,0.5125,0.4652,0.4709,0.6029,0.2069,0.4498,0.7881,0.6491,0.7219,0.0853,0.7509,0.6255,0.7313,0.8105,0.541,0.3796,0.8281,0.5755,0.907,0.8779,0.1806,0.3101,0.9385,0.858,0.3478,0.2483,0.6059,0.4957,0.148,0.5801,0.8584,0.6656,0.2468,0.2409,0.8448,0.5606,0.5488,0.6444,0.7581,0.0442,0.8845,0.7643,0.4395,0.1599,0.8619,0.9131,0.5506,0.4354,0.254,0.0187,0.0079,0.1363,0.8115,0.9863,0.3834,0.4616,0.3165,0.9224,0.6279,0.5491,0.44,0.5926,0.7481,0.5414,0.1351,0.2157,0.896,0.9696,0.3605,0.323,0.09,0.0658,0.8521,0.2464,0.6778,0.9701,0.7439,0.06,0.8287,0.5473,0.9255,0.9526,0.6165,0.4697,0.124,0.9475,0.9285,0.9358,0.147,0.1248,0.4625,0.8516,0.0656,0.0835,0.2606,0.7604,0.1047,0.8949,0.8996,0.3915,0.9156,0.7973,0.8347,0.287,0.4835,0.9215,0.3475,0.0976,0.9504,0.6243,0.5095,0.817,0.7512,0.1635,0.5495,0.1819,0.2947,0.2778,0.0155,0.586,0.748,0.4383,0.5112,0.3398,0.585,0.8159,0.6174,0.713,0.2784,0.675,0.6835,0.4813,0.4254,0.0767,0.8609,0.7787,0.167,0.9658,0.3751,0.0589,0.4259,0.7077,0.6318,0.2537,0.9233,0.1553,0.0898,0.6915,0.0244,0.32,0.3721,0.2705,0.8694,0.2452,0.4212,0.5664,0.4065,0.7048,0.5379,0.1948,0.0869,0.952,0.2955,0.8326,0.934,0.3961,0.3562,0.4368,0.7944,0.6328,0.8597,0.2193,0.3185,0.7702,0.742,0.4631,0.262,0.457,0.1213,0.8219,0.715,0.7331,0.4837,0.4029,0.6348,0.4223,0.1483,0.7461,0.4888,0.055,0.824,0.6139,0.3203,0.9667,0.196,0.6106,0.0095,0.9789,0.8975,0.5951,0.3915,0.0822,0.5955,0.978,0.2569,0.1826,0.0774,0.8272,0.0276,0.1152,0.1301,0.0538,0.5482,0.3748,0.9332,0.4797,0.8889,0.3629,0.5149,0.1861,0.8084,0.0962,0.4466,0.6612,0.3016,0.1691,0.1508,0.4669,0.118,0.7729,0.6755,0.6513,0.2179,0.1472,0.9779,0.9987,0.3508,0.1067,0.0239,0.6827,0.2007,0.7654,0.96,0.6791,0.5217,0.4831,0.1191,0.7262,0.7417,0.0539,0.5778,0.2836,0.3204,0.2193,0.4735,0.1178,0.3324,0.8702,0.0733,0.0765,0.6354,0.2223,0.9643,0.927,0.2153,0.8297,0.6146,0.8069,0.7107,0.7443,0.58,0.0148,0.9108,0.9424,0.1494,0.4738,0.4369,0.6776,0.1627,0.1484,0.7714,0.5366,0.077,0.5975,0.5916,0.679,0.1739,0.2769,0.055,0.0047,0.1518,0.2007,0.2491,0.2009,0.727,0.9169,0.8809,0.3556,0.0391,0.4504,0.2326,0.0094,0.2398,0.0834,0.0784,0.1626,0.0946,0.0232,0.2308,0.4251,0.1543,0.654,0.7362,0.1353,0.4677,0.0559,0.5868,0.145,0.3607,0.3767,0.7126,0.8909,0.2609,0.9068,0.7257,0.4992,0.0714,0.6378,0.1891,0.7577,0.7993,0.0762,0.3745,0.0175,0.186,0.3852,0.6097,0.2976,0.1723,0.669,0.8491,0.1884,0.8921,0.7774,0.0924,0.5801,0.4462,0.4996,0.8446,0.3974,0.2988,0.5122,0.4257,0.0507,0.2361,0.8199,0.6052,0.0402,0.2948,0.8419,0.266,0.1124,0.2657,0.1337,0.1593,0.4517,0.4253,0.1802,0.7642,0.144,0.0217,0.9054,0.1856,0.4612,0.0095,0.7022,0.6057,0.3713,0.1052,0.1617,0.473,0.0953]	[0.7331,0.8097,0.6502,0.9127,0.0237,0.1903,0.3,0.5575,0.3532,0.4566,0.8754,0.8489,0.4467,0.5562,0.0798,0.1265,0.1498,0.014,0.5874,0.2362,0.42,0.9049,0.4078,0.0926,0.1979,0.3253,0.7447,0.032,0.6831,0.2585,0.5627,0.6532,0.9232,0.7607,0.7129,0.4934,0.224,0.0551,0.2291,0.2517,0.6001,0.743,0.4923,0.8227,0.4696,0.9969,0.5116,0.6006,0.9282,0.8014,0.9153,0.9787,0.8224,0.8449,0.7728,0.1571,0.4613,0.6728,0.52,0.7127,0.4178,0.7368,0.7254,0.057,0.3933,0.3115,0.5306,0.4789,0.6045,0.0798,0.9045,0.0182,0.9116,0.9088,0.4516,0.1809,0.0013,0.9217,0.4415,0.2266,0.9744,0.1338,0.8338,0.1943,0.3162,0.1397,0.6522,0.63,0.7232,0.8029,0.5525,0.2429,0.4419,0.9125,0.9634,0.5987,0.5072,0.0648,0.9821,0.852,0.1033,0.1573,0.6951,0.5636,0.9253,0.306,0.9404,0.7175,0.3661,0.0939,0.3485,0.7622,0.9557,0.665,0.4809,0.846,0.4726,0.2467,0.6278,0.3151,0.0656,0.0512,0.9545,0.2783,0.8844,0.4456,0.6374,0.2889,0.5778,0.6963,0.5866,0.4494,0.8733,0.3015,0.7059,0.938,0.1311,0.0369,0.2502,0.9823,0.0471,0.2924,0.3445,0.83,0.5563,0.1304,0.7499,0.9087,0.1485,0.4292,0.6053,0.0443,0.0944,0.1914,0.1188,0.7396,0.7531,0.86,0.1604,0.6484,0.2422,0.1241,0.9731,0.2669,0.1159,0.8771,0.7831,0.1584,0.0979,0.7852,0.8958,0.8152,0.8827,0.483,0.3839,0.8025,0.7433,0.5524,0.0151,0.0776,0.9346,0.5412,0.8119,0.6551,0.1544,0.5739,0.6891,0.1941,0.4885,0.5511,0.852,0.1055,0.1554,0.1452,0.2285,0.4078,0.9068,0.6274,0.552,0.8951,0.4823,0.4667,0.8063,0.2294,0.0727,0.3359,0.9489,0.7746,0.7838,0.9097,0.6173,0.8093,0.1308,0.6534,0.282,0.9285,0.7775,0.4229,0.4972,0.8554,0.2278,0.6224,0.1792,0.3769,0.2659,0.7507,0.7,0.1054,0.588,0.8511,0.7888,0.7484,0.5821,0.4926,0.2919,0.9305,0.173,0.4304,0.3556,0.8002,0.6216,0.5944,0.3289,0.1113,0.5266,0.8156,0.1334,0.4558,0.8236,0.9916,0.8407,0.3305,0.0978,0.7516,0.6052,0.371,0.63,0.1088,0.711,0.6767,0.2296,0.9995,0.5761,0.0204,0.7811,0.1301,0.0971,0.1609,0.1668,0.0774,0.1249,0.9094,0.7928,0.7178,0.7615,0.7453,0.084,0.2519,0.0824,0.9345,0.1856,0.9082,0.1794,0.1607,0.3537,0.8842,0.6848,0.7447,0.7831,0.9822,0.0352,0.0686,0.5612,0.5005,0.6841,0.5211,0.9415,0.8274,0.5317,0.9444,0.3647,0.5673,0.3292,0.6794,0.555,0.557,0.6546,0.4205,0.3256,0.0366,0.296,0.6729,0.1316,0.0841,0.622,0.0998,0.0084,0.585,0.2918,0.3616,0.5459,0.0579,0.4175,0.2816,0.3135,0.2844,0.8309,0.0967,0.104,0.3796,0.5454,0.0026,0.6771,0.3214,0.5667,0.2738,0.4812,0.6637,0.738,0.0504,0.6916,0.6095,0.571,0.1327,0.1727,0.668,0.6655,0.2202,0.5617,0.0412,0.5562,0.7446,0.278,0.2129,0.7847,0.353,0.3047,0.0315,0.9669,0.3886,0.8853,0.1684,0.8019,0.1266,0.3706,0.0379,0.1375,0.9464,0.8012,0.1912,0.7582,0.8482,0.5972,0.0129,0.638,0.5242,0.2626,0.7567,0.8149,0.3705,0.5545,0.9326,0.5524,0.0517,0.8801,0.9862,0.9944,0.6245,0.2719,0.2608,0.2499,0.6187,0.0177,0.4506,0.8003,0.8647,0.7763,0.2446,0.4045,0.7264,0.358,0.8101,0.1951,0.3755,0.7818,0.6308,0.0614,0.381,0.3283,0.6724,0.6879,0.8554,0.1029,0.0737,0.2383,0.4759,0.8908,0.24,0.7186,0.1774,0.3121,0.589,0.5492,0.81,0.0833,0.2955,0.5614,0.0864,0.1579,0.7521,0.6059,0.6502,0.3494,0.3258,0.9816,0.6451,0.5344,0.1613,0.9047,0.3978,0.9337,0.0736,0.9813,0.7978,0.9242,0.2897,0.4543,0.6023,0.244,0.7062,0.9789,0.5668,0.3031,0.6751,0.0238,0.6486,0.1219,0.8895,0.7749,0.7163,0.7765,0.9773,0.7877,0.9938,0.2319,0.076,0.4551,0.3841,0.2301,0.6313,0.1824,0.614,0.021,0.9712,0.5184,0.2957,0.8963,0.4461,0.821,0.535,0.6229,0.0911,0.0568,0.5104,0.6751,0.6428,0.194,0.2784,0.9961,0.5423,0.426,0.1357,0.5923,0.9773,0.3796,0.9745,0.6745,0.1675,0.8447,0.7299,0.2101,0.251,0.7611,0.137,0.0131,0.0233,0.643,0.8757,0.9882,0.3477,0.8887,0.0196,0.7033,0.5131,0.5984,0.2526,0.7608,0.5462,0.6216,0.3468,0.2204,0.1248,0.2734,0.5807,0.8365,0.9547,0.6065,0.6161,0.3069,0.8109,0.0456,0.8972,0.4919,0.8485,0.7354,0.5386,0.2791,0.3036,0.7726,0.6261,0.787,0.3075,0.7451,0.7793,0.63,0.7657,0.235,0.3937,0.3624,0.2789,0.7092,0.5016,0.6645,0.9225,0.8362,0.2548,0.9477,0.4412,0.9354,0.2565,0.2739,0.5632,0.0313,0.2722,0.5119,0.4245,0.3142,0.1404,0.8911,0.4179,0.7651,0.1778,0.3594,0.3538,0.6004,0.1929,0.8078,0.4197,0.4949,0.4105,0.8227,0.9911,0.2114,0.733,0.7923,0.518,0.5932,0.8493,0.0789,0.4008,0.9863,0.7538,0.8113,0.2908,0.2043,0.1274,0.3126,0.6008,0.4877,0.5637,0.4008,0.096,0.3175,0.36,0.9659,0.1036,0.4438,0.5656,0.9897,0.8794,0.7577,0.6888,0.755,0.73,0.1739,0.3796,0.1222,0.6274,0.4802,0.4206,0.8357,0.7494,0.0345,0.0814,0.4991,0.4583,0.5459,0.067,0.2986,0.5973,0.9651,0.1609,0.4628,0.0298,0.6352,0.6005,0.3974,0.759,0.2072,0.7239,0.1528,0.1055,0.5699,0.6745,0.7723,0.3748,0.7938,0.2933,0.9541,0.5736,0.713,0.642,0.9763,0.5285,0.7003,0.4948,0.2131,0.7361,0.6956,0.8272,0.3275,0.9658,0.4641,0.5538,0.5636,0.7101,0.9133,0.2926,0.2562,0.0994,0.9273,0.6267,0.4522,0.4725,0.864,0.7871,0.6456,0.9434,0.0891,0.0662,0.7675,0.7745,0.264,0.9639,0.9261,0.9285,0.6523,0.9689,0.1393,0.5772,0.1571,0.8191,0.6651,0.6823,0.0386,0.7224,0.3585,0.2872,0.6733,0.8112,0.4963,0.3317,0.938,0.3667,0.5931,0.0012,0.3537,0.1976,0.083,0.8304,0.4795,0.2637,0.6546,0.0573,0.9973,0.1397,0.8082,0.452,0.6021,0.856,0.8577,0.8938,0.2358,0.3597,0.6201,0.3683,0.8143,0.9454,0.0596,0.6786,0.3343,0.9113,0.0288,0.8185,0.5878,0.33,0.8133,0.3216,0.7254,0.1081,0.4938,0.7417,0.7033,0.4079,0.5644,0.441,0.7037,0.0005,0.8307,0.953,0.2002,0.6669,0.0749,0.0939,0.0837,0.0161,0.5225,0.315,0.6043,0.8365,0.0052,0.0445,0.3227,0.4573,0.9324,0.2649,0.3955,0.2538,0.5114,0.9972,0.1949,0.9401,0.5907,0.1476,0.0843,0.9109,0.7747,0.7866,0.3406,0.5034,0.2999,0.8525,0.1724,0.2599,0.8252,0.2268,0.4335,0.1532,0.5508,0.1777,0.7669,0.9715,0.3265,0.5461,0.4787,0.6468,0.3343,0.9817,0.3583,0.1275,0.6358,0.3523,0.9697,0.843,0.7125,0.3385,0.9867,0.7955,0.8145,0.8424,0.4324,0.0804,0.0889,0.3916,0.2055,0.2375,0.4433,0.4219,0.3321,0.7897,0.4703,0.0395,0.0638,0.136,0.0363,0.9264,0.7047,0.4387,0.5254,0.7796,0.0022,0.8722,0.3922,0.4546,0.4333,0.1313,0.8348,0.846,0.6301,0.8865,0.0279,0.054,0.8167,0.4611,0.3171,0.5351,0.7973,0.1907,0.2242,0.8768,0.3316,0.5579,0.7296,0.1118,0.1054,0.3003,0.4495,0.3907,0.8967,0.0392,0.2833,0.1403,0.0285,0.7028,0.4732,0.179,0.3701,0.2703,0.4978,0.881,0.8906,0.8719,0.9697,0.3516,0.3812,0.9481,0.9711,0.4957,0.1777,0.0546,0.0132,0.8406,0.1185,0.8273,0.6099,0.1837,0.0519,0.6577,0.4361,0.5004,0.5724,0.7362,0.7385,0.396,0.6591,0.6942,0.0329,0.7225,0.7649,0.3419,0.1153,0.2675,0.645,0.2699,0.4426,0.7045,0.155,0.505,0.5804,0.4885,0.4223,0.4374,0.4431,0.3606,0.3968,0.1356,0.7475,0.9807,0.8966,0.7985,0.3601,0.3577,0.2676,0.44,0.4467,0.5024,0.0896,0.7041,0.786,0.0971,0.2769,0.6195,0.2275,0.7631,0.6528,0.4023,0.6274,0.1658,0.1015,0.1783,0.4332,0.5549,0.2708,0.3172,0.8643,0.4837,0.4499,0.1771,0.5172,0.8127,0.8037,0.0062,0.3277,0.8363,0.1751,0.5388,0.3619,0.3065,0.185,0.0156,0.5355,0.4277,0.8475,0.4981,0.5095,0.2622,0.0852,0.8594,0.6152,0.4342,0.3175,0.9704,0.6327,0.0867,0.9099,0.7705,0.099,0.5355,0.5727,0.2204,0.4581,0.33,0.4707,0.9875,0.3634,0.7457,0.6345,0.6247,0.4889,0.9301,0.0819,0.6962,0.1486,0.4302,0.4791,0.5752,0.2319,0.1469,0.9376,0.1089,0.0365,0.3227,0.3755,0.2468,0.3692,0.1102,0.4207,0.1006,0.6923,0.6545,0.5816,0.7392,0.116,0.1178,0.8122,0.9768,0.9608,0.7842,0.5136,0.8117,0.0502,0.134,0.6417,0.0148,0.2397,0.6575,0.9509,0.7941,0.2466,0.6698,0.1531,0.0632,0.2649,0.4478,0.7299,0.8543,0.8549,0.2953,0.7131,0.1417,0.5754,0.8219,0.1919,0.756,0.8725,0.5791,0.6633,0.8585,0.1366,0.7986,0.0885,0.9589,0.648,0.8829,0.4593,0.3233,0.8013,0.2216,0.4672,0.9605,0.2811,0.3762,0.5331,0.0981,0.4472,0.7063,0.3636,0.0962,0.4269,0.7975,0.925,0.6669,0.0905,0.2605,0.9126,0.0224,0.9996,0.1324,0.6627,0.4812,0.1719,0.3323,0.7988,0.8439,0.7012,0.1915,0.1442,0.6865,0.6525,0.3114,0.1153,0.2794,0.5626,0.786,0.8969,0.1848,0.0902,0.2487,0.6569,0.8872,0.0151,0.7557,0.376,0.2619,0.5782,0.3089,0.7281,0.0971,0.6529,0.4053,0.459,0.1911,0.0298,0.4213,0.2795,0.7618,0.1539,0.1778,0.6666,0.5873,0.4255,0.8943,0.789,0.6279,0.5738,0.7347,0.7577,0.5534,0.8343,0.7777,0.0398,0.1544,0.539,0.5608,0.0013,0.501,0.9779,0.4794,0.6223,0.0747,0.976,0.6062,0.9215,0.9627,0.5645,0.0005,0.385,0.8625,0.9461,0.1035,0.4186,0.4275,0.4128,0.548,0.5125,0.4652,0.4709,0.6029,0.2069,0.4498,0.7881,0.6491,0.7219,0.0853,0.7509,0.6255,0.7313,0.8105,0.541,0.3796,0.8281,0.5755,0.907,0.8779,0.1806,0.3101,0.9385,0.858,0.3478,0.2483,0.6059,0.4957,0.148,0.5801,0.8584,0.6656,0.2468,0.2409,0.8448,0.5606,0.5488,0.6444,0.7581,0.0442,0.8845,0.7643,0.4395,0.1599,0.8619,0.9131,0.5506,0.4354,0.254,0.0187,0.0079,0.1363,0.8115,0.9863,0.3834,0.4616,0.3165,0.9224,0.6279,0.5491,0.44,0.5926,0.7481,0.5414,0.1351,0.2157,0.896,0.9696,0.3605,0.323,0.09,0.0658,0.8521,0.2464,0.6778,0.9701,0.7439,0.06,0.8287,0.5473,0.9255,0.9526,0.6165,0.4697,0.124,0.9475,0.9285,0.9358,0.147,0.1248,0.4625,0.8516,0.0656,0.0835,0.2606,0.7604,0.1047,0.8949,0.8996,0.3915,0.9156,0.7973,0.8347,0.287,0.4835,0.9215,0.3475,0.0976,0.9504,0.6243,0.5095,0.817,0.7512,0.1635,0.5495,0.1819,0.2947,0.2778,0.0155,0.586,0.748,0.4383,0.5112,0.3398,0.585,0.8159,0.6174,0.713,0.2784,0.675,0.6835,0.4813,0.4254,0.0767,0.8609,0.7787,0.167,0.9658,0.3751,0.0589,0.4259,0.7077,0.6318,0.2537,0.9233,0.1553,0.0898,0.6915,0.0244,0.32,0.3721,0.2705,0.8694,0.2452,0.4212,0.5664,0.4065,0.7048,0.5379,0.1948,0.0869,0.952,0.2955,0.8326,0.934,0.3961,0.3562,0.4368,0.7944,0.6328,0.8597,0.2193,0.3185,0.7702,0.742,0.4631,0.262,0.457,0.1213,0.8219,0.715,0.7331,0.4837,0.4029,0.6348,0.4223,0.1483,0.7461,0.4888,0.055,0.824,0.6139,0.3203,0.9667,0.196,0.6106,0.0095,0.9789,0.8975,0.5951,0.3915,0.0822,0.5955,0.978,0.2569,0.1826,0.0774,0.8272,0.0276,0.1152,0.1301,0.0538,0.5482,0.3748,0.9332,0.4797,0.8889,0.3629,0.5149,0.1861,0.8084,0.0962,0.4466,0.6612,0.3016,0.1691,0.1508,0.4669,0.118,0.7729,0.6755,0.6513,0.2179,0.1472,0.9779,0.9987,0.3508,0.1067,0.0239,0.6827,0.2007,0.7654,0.96,0.6791,0.5217,0.4831,0.1191,0.7262,0.7417,0.0539,0.5778,0.2836,0.3204,0.2193,0.4735,0.1178,0.3324,0.8702,0.0733,0.0765,0.6354,0.2223,0.9643,0.927,0.2153,0.8297,0.6146,0.8069,0.7107,0.7443,0.58,0.0148,0.9108,0.9424,0.1494,0.4738,0.4369,0.6776,0.1627,0.1484,0.7714,0.5366,0.077,0.5975,0.5916,0.679,0.1739,0.2769,0.055,0.0047,0.1518,0.2007,0.2491,0.2009,0.727,0.9169,0.8809,0.3556,0.0391,0.4504,0.2326,0.0094,0.2398,0.0834,0.0784,0.1626,0.0946,0.0232,0.2308,0.4251,0.1543,0.654,0.7362,0.1353,0.4677,0.0559,0.5868,0.145,0.3607,0.3767,0.7126,0.8909,0.2609,0.9068,0.7257,0.4992,0.0714,0.6378,0.1891,0.7577,0.7993,0.0762,0.3745,0.0175,0.186,0.3852,0.6097,0.2976,0.1723,0.669,0.8491,0.1884,0.8921,0.7774,0.0924,0.5801,0.4462,0.4996,0.8446,0.3974,0.2988,0.5122,0.4257,0.0507,0.2361,0.8199,0.6052,0.0402,0.2948,0.8419,0.266,0.1124,0.2657,0.1337,0.1593,0.4517,0.4253,0.1802,0.7642,0.144,0.0217,0.9054,0.1856,0.4612,0.0095,0.7022,0.6057,0.3713,0.1052,0.1617,0.473,0.0953]	5	0.8	2025-11-10 21:26:06.992169+00	4.8
7	[0.1207,0.4155,0.2575,0.3197,0.2786,0.3009,0.5915,0.2232,0.7483,0.9834,0.5193,0.4088,0.8734,0.6603,0.5241,0.2782,0.3491,0.9515,0.1714,0.0182,0.3253,0.3385,0.0707,0.6784,0.6087,0.7903,0.3946,0.7822,0.7284,0.6802,0.4276,0.852,0.0044,0.9638,0.1197,0.4065,0.2772,0.8657,0.6286,0.6895,0.4214,0.9598,0.721,0.3396,0.7708,0.2416,0.9915,0.8614,0.8857,0.9327,0.3383,0.7953,0.6387,0.378,0.9191,0.8489,0.043,0.137,0.758,0.1617,0.6055,0.6871,0.9773,0.7324,0.2471,0.6853,0.9597,0.3007,0.7697,0.6208,0.0408,0.7207,0.768,0.2541,0.8758,0.7707,0.6434,0.2561,0.3923,0.0041,0.5425,0.5902,0.9166,0.8139,0.8464,0.7621,0.7303,0.9518,0.4545,0.7349,0.7745,0.9561,0.9841,0.5168,0.033,0.0734,0.6051,0.2312,0.0514,0.6468,0.8483,0.0577,0.8826,0.2271,0.8742,0.0064,0.5653,0.4949,0.2902,0.4936,0.5469,0.8548,0.0568,0.2793,0.1867,0.3934,0.5612,0.8827,0.9562,0.5196,0.566,0.328,0.7019,0.4663,0.8722,0.1331,0.9,0.0006,0.6081,0.7805,0.3553,0.7656,0.9908,0.0554,0.182,0.0772,0.4812,0.1912,0.6916,0.9735,0.1992,0.0455,0.157,0.3729,0.3059,0.7779,0.0789,0.988,0.8799,0.3931,0.5647,0.8081,0.3595,0.7402,0.1996,0.7047,0.5276,0.4809,0.7504,0.7869,0.3079,0.4319,0.433,0.8744,0.2669,0.1836,0.3353,0.3713,0.9782,0.6595,0.8895,0.2759,0.8477,0.8134,0.272,0.0492,0.1488,0.5319,0.5275,0.6736,0.0524,0.2513,0.9911,0.9516,0.8845,0.0674,0.2945,0.4928,0.7922,0.0786,0.3117,0.7546,0.5907,0.2283,0.0767,0.0161,0.7809,0.8912,0.2361,0.5233,0.9622,0.9979,0.2472,0.3414,0.3754,0.8949,0.7026,0.2193,0.453,0.1825,0.3994,0.235,0.966,0.6063,0.6775,0.781,0.2089,0.3486,0.8507,0.4998,0.9988,0.6425,0.4189,0.484,0.4745,0.8301,0.7032,0.1871,0.0647,0.0075,0.8286,0.1487,0.7494,0.7214,0.7712,0.687,0.8578,0.2696,0.2751,0.6611,0.6256,0.5454,0.4043,0.8686,0.7868,0.5347,0.3219,0.7474,0.2712,0.0298,0.7556,0.0274,0.1308,0.985,0.9501,0.8619,0.1434,0.8404,0.891,0.8403,0.0916,0.3721,0.4596,0.95,0.8779,0.2468,0.2677,0.0277,0.1091,0.7493,0.1502,0.0708,0.5665,0.1176,0.1306,0.5668,0.2581,0.6597,0.4967,0.5595,0.2036,0.4012,0.8872,0.6416,0.5163,0.7521,0.8394,0.3688,0.1299,0.1268,0.5783,0.8371,0.9413,0.3051,0.1049,0.151,0.937,0.3636,0.2156,0.1873,0.4173,0.0367,0.6702,0.508,0.653,0.0509,0.3611,0.9218,0.9345,0.4624,0.5366,0.4732,0.6091,0.805,0.4282,0.198,0.4446,0.7303,0.1679,0.5357,0.0537,0.6748,0.917,0.8944,0.8265,0.17,0.4753,0.1674,0.0937,0.0652,0.872,0.5738,0.4948,0.3128,0.002,0.2929,0.4669,0.2348,0.6772,0.9408,0.1698,0.0565,0.3458,0.1235,0.5252,0.0833,0.6146,0.5065,0.3789,0.9753,0.6137,0.3619,0.2842,0.9106,0.9862,0.6399,0.5725,0.7336,0.4253,0.433,0.7551,0.5895,0.6507,0.3751,0.8609,0.0552,0.1459,0.9253,0.8612,0.9015,0.1254,0.2579,0.1046,0.1186,0.2531,0.1293,0.7367,0.4999,0.0454,0.0164,0.6993,0.9556,0.7323,0.6037,0.7887,0.1784,0.6805,0.8202,0.4942,0.8387,0.0844,0.5545,0.4461,0.1201,0.1445,0.0201,0.896,0.891,0.2074,0.7053,0.2258,0.1823,0.5526,0.0402,0.7561,0.8512,0.3139,0.7435,0.5785,0.6912,0.7643,0.5503,0.1176,0.1873,0.5307,0.6753,0.1554,0.4346,0.3319,0.2798,0.3906,0.7588,0.9269,0.9562,0.2838,0.2164,0.3822,0.9779,0.6435,0.2847,0.9697,0.7201,0.194,0.2821,0.6901,0.2,0.9882,0.1129,0.9478,0.7969,0.3036,0.918,0.1662,0.1958,0.1263,0.6593,0.05,0.2274,0.3622,0.3664,0.0851,0.1297,0.204,0.5751,0.0231,0.8533,0.7468,0.1146,0.9594,0.0529,0.2052,0.7853,0.1322,0.0835,0.4719,0.293,0.1243,0.1437,0.5764,0.0209,0.8872,0.2269,0.2198,0.3396,0.7391,0.0971,0.7324,0.4661,0.6608,0.94,0.7471,0.5464,0.3812,0.2669,0.3411,0.4788,0.7204,0.0514,0.4412,0.171,0.4882,0.646,0.089,0.7381,0.8598,0.511,0.1554,0.2991,0.9554,0.7063,0.3039,0.974,0.7764,0.9267,0.5212,0.8253,0.9573,0.0764,0.4606,0.6235,0.2387,0.3571,0.9572,0.7635,0.9247,0.2709,0.4572,0.9903,0.231,0.4927,0.1358,0.4722,0.144,0.0796,0.3496,0.7732,0.2495,0.9626,0.5523,0.3101,0.4197,0.1627,0.6799,0.3839,0.835,0.6925,0.4195,0.1874,0.1086,0.998,0.0301,0.8419,0.5481,0.5371,0.1428,0.1858,0.4724,0.4415,0.5379,0.6587,0.9649,0.9696,0.8271,0.7567,0.2694,0.5101,0.0446,0.3666,0.6655,0.8084,0.4831,0.7006,0.4751,0.6898,0.3018,0.2888,0.9843,0.6159,0.6795,0.3516,0.9489,0.8947,0.0678,0.86,0.6435,0.4553,0.4244,0.8575,0.1014,0.5182,0.4167,0.6984,0.8395,0.2883,0.9094,0.9186,0.3376,0.9849,0.4996,0.0028,0.0084,0.7724,0.2707,0.3346,0.2952,0.8546,0.8669,0.7882,0.1345,0.1296,0.7392,0.5698,0.4253,0.6353,0.3656,0.6865,0.9159,0.7041,0.0389,0.53,0.7571,0.7269,0.9034,0.9203,0.5163,0.8629,0.4643,0.0356,0.6574,0.4621,0.2082,0.0965,0.9578,0.7002,0.5996,0.8931,0.0713,0.7009,0.791,0.2133,0.6067,0.6312,0.7628,0.1951,0.3787,0.0985,0.6108,0.7759,0.9713,0.3834,0.8,0.5099,0.3164,0.7646,0.8242,0.6506,0.7705,0.6965,0.3351,0.9042,0.5622,0.1288,0.6441,0.6959,0.198,0.6969,0.6392,0.5742,0.3259,0.5376,0.7937,0.19,0.728,0.5741,0.2126,0.6138,0.6379,0.5265,0.12,0.1514,0.6113,0.1562,0.188,0.0863,0.3784,0.1295,0.0165,0.392,0.4865,0.6257,0.2296,0.6333,0.1035,0.2119,0.0881,0.7671,0.9048,0.4074,0.6582,0.4435,0.1147,0.6478,0.6445,0.3046,0.1278,0.0594,0.0457,0.4949,0.1813,0.74,0.0995,0.5005,0.366,0.3331,0.026,0.8862,0.2477,0.1178,0.1623,0.4631,0.9883,0.4888,0.6658,0.8332,0.3577,0.7958,0.0615,0.3536,0.4449,0.32,0.8532,0.7019,0.6498,0.6968,0.006,0.7382,0.6228,0.8323,0.6659,0.3241,0.1895,0.0765,0.0091,0.5459,0.6573,0.7511,0.7783,0.8537,0.0196,0.3672,0.5877,0.5439,0.8704,0.0699,0.3594,0.9717,0.5768,0.9496,0.4907,0.5231,0.9045,0.9375,0.7237,0.194,0.0425,0.4698,0.934,0.6035,0.0741,0.7348,0.769,0.2246,0.4155,0.6037,0.2305,0.5283,0.5479,0.0909,0.9927,0.5982,0.7759,0.0636,0.4833,0.0343,0.3133,0.8514,0.89,0.2155,0.5031,0.1172,0.5697,0.4669,0.0482,0.3071,0.0711,0.6185,0.0871,0.672,0.2732,0.8785,0.5318,0.5535,0.8072,0.4492,0.7141,0.8851,0.6406,0.1605,0.4449,0.4733,0.1487,0.3488,0.8996,0.4213,0.0535,0.0819,0.6985,0.9194,0.2822,0.0037,0.9458,0.3111,0.8009,0.0827,0.4707,0.3243,0.442,0.3731,0.0505,0.8528,0.6072,0.677,0.2995,0.5376,0.1631,0.2849,0.7632,0.0977,0.8267,0.7068,0.2227,0.3609,0.2954,0.7336,0.8025,0.9661,0.4859,0.2162,0.3655,0.94,0.7089,0.1026,0.5789,0.6153,0.5745,0.4715,0.2028,0.4726,0.2407,0.2181,0.5888,0.7979,0.0183,0.3685,0.1921,0.5356,0.0136,0.2647,0.4964,0.5565,0.1094,0.9289,0.8263,0.2428,0.6163,0.8924,0.5636,0.7858,0.7984,0.9261,0.0902,0.744,0.5253,0.6717,0.2403,0.5454,0.5378,0.4022,0.2959,0.23,0.6664,0.026,0.2365,0.6735,0.1821,0.6778,0.4428,0.346,0.9195,0.3988,0.6642,0.0851,0.3267,0.6389,0.5457,0.6312,0.5295,0.6761,0.024,0.565,0.9298,0.6954,0.2395,0.282,0.5674,0.0065,0.6925,0.4843,0.5036,0.9911,0.7761,0.4903,0.7142,0.0938,0.5991,0.9744,0.2551,0.7439,0.6509,0.1756,0.5521,0.8176,0.1542,0.3399,0.7566,0.7328,0.5221,0.7171,0.3998,0.3496,0.0143,0.6303,0.5668,0.6744,0.2459,0.9166,0.9464,0.152,0.6014,0.251,0.5539,0.8226,0.7143,0.7793,0.006,0.4787,0.6425,0.4482,0.7555,0.3407,0.1001,0.026,0.4949,0.922,0.4527,0.6511,0.1718,0.4407,0.8032,0.3851,0.0274,0.1755,0.0418,0.9477,0.7778,0.5764,0.4923,0.975,0.8057,0.6228,0.4804,0.5041,0.6023,0.9674,0.8419,0.6705,0.5939,0.4077,0.3616,0.7493,0.4737,0.0233,0.2306,0.5772,0.8457,0.4103,0.6997,0.655,0.8823,0.4167,0.7932,0.0003,0.7688,0.6536,0.5159,0.7871,0.6553,0.5976,0.0024,0.7021,0.0806,0.1199,0.7474,0.2033,0.6782,0.3289,0.8415,0.3933,0.6482,0.0137,0.087,0.0084,0.3822,0.2506,0.6521,0.4255,0.0966,0.0089,0.7678,0.0652,0.4547,0.3995,0.827,0.4121,0.0829,0.4331,0.9878,0.2415,0.9292,0.2053,0.0578,0.876,0.4045,0.813,0.0849,0.9691,0.1908,0.3216,0.8345,0.9392,0.9054,0.9031,0.7686,0.2696,0.1612,0.0109,0.8994,0.8304,0.7317,0.1413,0.6349,0.3299,0.5078,0.0591,0.3136,0.6872,0.9937,0.283,0.5112,0.8206,0.0741,0.4559,0.1534,0.5583,0.041,0.2265,0.6491,0.6714,0.7589,0.6768,0.4774,0.071,0.9695,0.4009,0.7896,0.8367,0.3047,0.3167,0.2354,0.5098,0.0765,0.0271,0.5337,0.5442,0.7373,0.3586,0.416,0.2219,0.5237,0.6805,0.4312,0.7166,0.5979,0.2235,0.9773,0.8439,0.245,0.7679,0.551,0.4624,0.847,0.4513,0.5729,0.7506,0.4994,0.3169,0.0905,0.5095,0.2002,0.556,0.431,0.0896,0.299,0.2892,0.7686,0.1634,0.7939,0.4784,0.2367,0.4151,0.1117,0.9945,0.4489,0.4683,0.1398,0.1332,0.7193,0.3539,0.4928,0.424,0.8358,0.4539,0.4496,0.9626,0.4975,0.7497,0.4415,0.6522,0.7767,0.462,0.7226,0.9389,0.0326,0.6278,0.3867,0.9492,0.6555,0.9273,0.3923,0.9842,0.326,0.8563,0.7938,0.0291,0.401,0.6285,0.488,0.516,0.7664,0.2485,0.4502,0.6154,0.735,0.577,0.7982,0.4087,0.3462,0.248,0.2596,0.097,0.0999,0.7282,0.0552,0.4532,0.295,0.0033,0.513,0.5173,0.3885,0.8268,0.6694,0.7107,0.1785,0.3992,0.2752,0.3208,0.3632,0.5469,0.1052,0.949,0.6748,0.5877,0.8961,0.6488,0.4622,0.146,0.2316,0.0286,0.1218,0.6943,0.5979,0.9417,0.2317,0.1562,0.4356,0.3865,0.7966,0.5726,0.1624,0.0978,0.0707,0.8591,0.2632,0.9534,0.5111,0.0963,0.1396,0.8653,0.2,0.4458,0.6492,0.4572,0.3524,0.2757,0.5789,0.6733,0.9318,0.7093,0.2905,0.4528,0.4462,0.8209,0.3275,0.0186,0.4204,0.8802,0.9971,0.8036,0.7339,0.4245,0.1699,0.0393,0.2813,0.6519,0.4263,0.2383,0.7843,0.831,0.774,0.1875,0.4836,0.8747,0.7826,0.8399,0.7984,0.2024,0.1122,0.4563,0.8809,0.8762,0.3142,0.4271,0.0585,0.1398,0.2416,0.044,0.123,0.9609,0.4639,0.4532,0.3403,0.0421,0.9646,0.1249,0.5714,0.2395,0.7894,0.1383,0.1583,0.081,0.4952,0.2976,0.9791,0.4064,0.6693,0.1625,0.5965,0.6228,0.6213,0.2097,0.094,0.9631,0.4662,0.7086,0.4147,0.9336,0.636,0.6084,0.6401,0.3934,0.9958,0.0894,0.3104,0.083,0.7248,0.7608,0.0851,0.3981,0.2567,0.9141,0.9836,0.9656,0.6344,0.3151,0.4802,0.7719,0.3917,0.5788,0.2061,0.6619,0.9064,0.4605,0.72,0.1114,0.0243,0.9152,0.6245,0.7584,0.7792,0.3123,0.3615,0.0961,0.7933,0.8451,0.5006,0.7579,0.8716,0.4059,0.9546,0.3185,0.3734,0.7702,0.9598,0.9911,0.663,0.0587,0.2539,0.2088,0.5218,0.5902,0.4543,0.2259,0.5368,0.8556,0.6127,0.197,0.4776,0.1775,0.9216,0.6944,0.9145,0.5051,0.131,0.3777,0.9612,0.0405,0.3814,0.5794,0.8176,0.6504,0.9453,0.7158,0.9274,0.3784,0.425,0.4289,0.1048,0.2679,0.3083,0.3141,0.5612,0.6115,0.6869,0.5872,0.0911,0.792,0.764,0.1927,0.9898,0.6908,0.9197,0.9057,0.7482,0.072,0.3143,0.0453,0.9734,0.8245,0.8361,0.3213,0.0483,0.6703,0.3542,0.1938,0.4954,0.9939,0.1726,0.9725,0.3099,0.1224,0.9374,0.5138,0.6989,0.5783,0.5397,0.0707,0.8368,0.6296,0.662,0.373,0.0348,0.8103,0.755,0.311,0.5782,0.0364,0.2751,0.9631,0.6359,0.6006,0.6111,0.8751,0.5289,0.3025,0.8953,0.2439,0.6618,0.1523,0.7804,0.9284,0.2419,0.5754,0.6179,0.2746,0.9395,0.4919,0.9667,0.9728,0.2179,0.0818,0.9852,0.8345,0.484,0.8829,0.616,0.0644,0.659,0.0837,0.0039,0.2988,0.5754,0.7599,0.6969,0.2623,0.6166,0.9618,0.1386,0.2589,0.9708,0.0318,0.9699,0.8049,0.2185,0.5541,0.8932,0.2773,0.8565,0.8965,0.0487,0.2484,0.5931,0.7091,0.1236,0.24,0.5871,0.6633,0.3011,0.7424,0.1207,0.4351,0.2448,0.6416,0.2471,0.5074,0.5692,0.6103,0.308,0.8202,0.3028,0.8777,0.0711,0.828,0.1008,0.2076,0.0217,0.0855,0.2008,0.1071,0.0179,0.5881,0.2366,0.5649,0.4046,0.382,0.6744,0.7024,0.5682,0.7134,0.4701,0.8744,0.3332,0.7409,0.788,0.5512,0.3862,0.6024,0.922,0.9136,0.4257,0.1252,0.6919,0.4626,0.6648,0.2315,0.3997,0.1796]	seed-model	2025-11-10 04:48:51.599122+00	[0.1207,0.4155,0.2575,0.3197,0.2786,0.3009,0.5915,0.2232,0.7483,0.9834,0.5193,0.4088,0.8734,0.6603,0.5241,0.2782,0.3491,0.9515,0.1714,0.0182,0.3253,0.3385,0.0707,0.6784,0.6087,0.7903,0.3946,0.7822,0.7284,0.6802,0.4276,0.852,0.0044,0.9638,0.1197,0.4065,0.2772,0.8657,0.6286,0.6895,0.4214,0.9598,0.721,0.3396,0.7708,0.2416,0.9915,0.8614,0.8857,0.9327,0.3383,0.7953,0.6387,0.378,0.9191,0.8489,0.043,0.137,0.758,0.1617,0.6055,0.6871,0.9773,0.7324,0.2471,0.6853,0.9597,0.3007,0.7697,0.6208,0.0408,0.7207,0.768,0.2541,0.8758,0.7707,0.6434,0.2561,0.3923,0.0041,0.5425,0.5902,0.9166,0.8139,0.8464,0.7621,0.7303,0.9518,0.4545,0.7349,0.7745,0.9561,0.9841,0.5168,0.033,0.0734,0.6051,0.2312,0.0514,0.6468,0.8483,0.0577,0.8826,0.2271,0.8742,0.0064,0.5653,0.4949,0.2902,0.4936,0.5469,0.8548,0.0568,0.2793,0.1867,0.3934,0.5612,0.8827,0.9562,0.5196,0.566,0.328,0.7019,0.4663,0.8722,0.1331,0.9,0.0006,0.6081,0.7805,0.3553,0.7656,0.9908,0.0554,0.182,0.0772,0.4812,0.1912,0.6916,0.9735,0.1992,0.0455,0.157,0.3729,0.3059,0.7779,0.0789,0.988,0.8799,0.3931,0.5647,0.8081,0.3595,0.7402,0.1996,0.7047,0.5276,0.4809,0.7504,0.7869,0.3079,0.4319,0.433,0.8744,0.2669,0.1836,0.3353,0.3713,0.9782,0.6595,0.8895,0.2759,0.8477,0.8134,0.272,0.0492,0.1488,0.5319,0.5275,0.6736,0.0524,0.2513,0.9911,0.9516,0.8845,0.0674,0.2945,0.4928,0.7922,0.0786,0.3117,0.7546,0.5907,0.2283,0.0767,0.0161,0.7809,0.8912,0.2361,0.5233,0.9622,0.9979,0.2472,0.3414,0.3754,0.8949,0.7026,0.2193,0.453,0.1825,0.3994,0.235,0.966,0.6063,0.6775,0.781,0.2089,0.3486,0.8507,0.4998,0.9988,0.6425,0.4189,0.484,0.4745,0.8301,0.7032,0.1871,0.0647,0.0075,0.8286,0.1487,0.7494,0.7214,0.7712,0.687,0.8578,0.2696,0.2751,0.6611,0.6256,0.5454,0.4043,0.8686,0.7868,0.5347,0.3219,0.7474,0.2712,0.0298,0.7556,0.0274,0.1308,0.985,0.9501,0.8619,0.1434,0.8404,0.891,0.8403,0.0916,0.3721,0.4596,0.95,0.8779,0.2468,0.2677,0.0277,0.1091,0.7493,0.1502,0.0708,0.5665,0.1176,0.1306,0.5668,0.2581,0.6597,0.4967,0.5595,0.2036,0.4012,0.8872,0.6416,0.5163,0.7521,0.8394,0.3688,0.1299,0.1268,0.5783,0.8371,0.9413,0.3051,0.1049,0.151,0.937,0.3636,0.2156,0.1873,0.4173,0.0367,0.6702,0.508,0.653,0.0509,0.3611,0.9218,0.9345,0.4624,0.5366,0.4732,0.6091,0.805,0.4282,0.198,0.4446,0.7303,0.1679,0.5357,0.0537,0.6748,0.917,0.8944,0.8265,0.17,0.4753,0.1674,0.0937,0.0652,0.872,0.5738,0.4948,0.3128,0.002,0.2929,0.4669,0.2348,0.6772,0.9408,0.1698,0.0565,0.3458,0.1235,0.5252,0.0833,0.6146,0.5065,0.3789,0.9753,0.6137,0.3619,0.2842,0.9106,0.9862,0.6399,0.5725,0.7336,0.4253,0.433,0.7551,0.5895,0.6507,0.3751,0.8609,0.0552,0.1459,0.9253,0.8612,0.9015,0.1254,0.2579,0.1046,0.1186,0.2531,0.1293,0.7367,0.4999,0.0454,0.0164,0.6993,0.9556,0.7323,0.6037,0.7887,0.1784,0.6805,0.8202,0.4942,0.8387,0.0844,0.5545,0.4461,0.1201,0.1445,0.0201,0.896,0.891,0.2074,0.7053,0.2258,0.1823,0.5526,0.0402,0.7561,0.8512,0.3139,0.7435,0.5785,0.6912,0.7643,0.5503,0.1176,0.1873,0.5307,0.6753,0.1554,0.4346,0.3319,0.2798,0.3906,0.7588,0.9269,0.9562,0.2838,0.2164,0.3822,0.9779,0.6435,0.2847,0.9697,0.7201,0.194,0.2821,0.6901,0.2,0.9882,0.1129,0.9478,0.7969,0.3036,0.918,0.1662,0.1958,0.1263,0.6593,0.05,0.2274,0.3622,0.3664,0.0851,0.1297,0.204,0.5751,0.0231,0.8533,0.7468,0.1146,0.9594,0.0529,0.2052,0.7853,0.1322,0.0835,0.4719,0.293,0.1243,0.1437,0.5764,0.0209,0.8872,0.2269,0.2198,0.3396,0.7391,0.0971,0.7324,0.4661,0.6608,0.94,0.7471,0.5464,0.3812,0.2669,0.3411,0.4788,0.7204,0.0514,0.4412,0.171,0.4882,0.646,0.089,0.7381,0.8598,0.511,0.1554,0.2991,0.9554,0.7063,0.3039,0.974,0.7764,0.9267,0.5212,0.8253,0.9573,0.0764,0.4606,0.6235,0.2387,0.3571,0.9572,0.7635,0.9247,0.2709,0.4572,0.9903,0.231,0.4927,0.1358,0.4722,0.144,0.0796,0.3496,0.7732,0.2495,0.9626,0.5523,0.3101,0.4197,0.1627,0.6799,0.3839,0.835,0.6925,0.4195,0.1874,0.1086,0.998,0.0301,0.8419,0.5481,0.5371,0.1428,0.1858,0.4724,0.4415,0.5379,0.6587,0.9649,0.9696,0.8271,0.7567,0.2694,0.5101,0.0446,0.3666,0.6655,0.8084,0.4831,0.7006,0.4751,0.6898,0.3018,0.2888,0.9843,0.6159,0.6795,0.3516,0.9489,0.8947,0.0678,0.86,0.6435,0.4553,0.4244,0.8575,0.1014,0.5182,0.4167,0.6984,0.8395,0.2883,0.9094,0.9186,0.3376,0.9849,0.4996,0.0028,0.0084,0.7724,0.2707,0.3346,0.2952,0.8546,0.8669,0.7882,0.1345,0.1296,0.7392,0.5698,0.4253,0.6353,0.3656,0.6865,0.9159,0.7041,0.0389,0.53,0.7571,0.7269,0.9034,0.9203,0.5163,0.8629,0.4643,0.0356,0.6574,0.4621,0.2082,0.0965,0.9578,0.7002,0.5996,0.8931,0.0713,0.7009,0.791,0.2133,0.6067,0.6312,0.7628,0.1951,0.3787,0.0985,0.6108,0.7759,0.9713,0.3834,0.8,0.5099,0.3164,0.7646,0.8242,0.6506,0.7705,0.6965,0.3351,0.9042,0.5622,0.1288,0.6441,0.6959,0.198,0.6969,0.6392,0.5742,0.3259,0.5376,0.7937,0.19,0.728,0.5741,0.2126,0.6138,0.6379,0.5265,0.12,0.1514,0.6113,0.1562,0.188,0.0863,0.3784,0.1295,0.0165,0.392,0.4865,0.6257,0.2296,0.6333,0.1035,0.2119,0.0881,0.7671,0.9048,0.4074,0.6582,0.4435,0.1147,0.6478,0.6445,0.3046,0.1278,0.0594,0.0457,0.4949,0.1813,0.74,0.0995,0.5005,0.366,0.3331,0.026,0.8862,0.2477,0.1178,0.1623,0.4631,0.9883,0.4888,0.6658,0.8332,0.3577,0.7958,0.0615,0.3536,0.4449,0.32,0.8532,0.7019,0.6498,0.6968,0.006,0.7382,0.6228,0.8323,0.6659,0.3241,0.1895,0.0765,0.0091,0.5459,0.6573,0.7511,0.7783,0.8537,0.0196,0.3672,0.5877,0.5439,0.8704,0.0699,0.3594,0.9717,0.5768,0.9496,0.4907,0.5231,0.9045,0.9375,0.7237,0.194,0.0425,0.4698,0.934,0.6035,0.0741,0.7348,0.769,0.2246,0.4155,0.6037,0.2305,0.5283,0.5479,0.0909,0.9927,0.5982,0.7759,0.0636,0.4833,0.0343,0.3133,0.8514,0.89,0.2155,0.5031,0.1172,0.5697,0.4669,0.0482,0.3071,0.0711,0.6185,0.0871,0.672,0.2732,0.8785,0.5318,0.5535,0.8072,0.4492,0.7141,0.8851,0.6406,0.1605,0.4449,0.4733,0.1487,0.3488,0.8996,0.4213,0.0535,0.0819,0.6985,0.9194,0.2822,0.0037,0.9458,0.3111,0.8009,0.0827,0.4707,0.3243,0.442,0.3731,0.0505,0.8528,0.6072,0.677,0.2995,0.5376,0.1631,0.2849,0.7632,0.0977,0.8267,0.7068,0.2227,0.3609,0.2954,0.7336,0.8025,0.9661,0.4859,0.2162,0.3655,0.94,0.7089,0.1026,0.5789,0.6153,0.5745,0.4715,0.2028,0.4726,0.2407,0.2181,0.5888,0.7979,0.0183,0.3685,0.1921,0.5356,0.0136,0.2647,0.4964,0.5565,0.1094,0.9289,0.8263,0.2428,0.6163,0.8924,0.5636,0.7858,0.7984,0.9261,0.0902,0.744,0.5253,0.6717,0.2403,0.5454,0.5378,0.4022,0.2959,0.23,0.6664,0.026,0.2365,0.6735,0.1821,0.6778,0.4428,0.346,0.9195,0.3988,0.6642,0.0851,0.3267,0.6389,0.5457,0.6312,0.5295,0.6761,0.024,0.565,0.9298,0.6954,0.2395,0.282,0.5674,0.0065,0.6925,0.4843,0.5036,0.9911,0.7761,0.4903,0.7142,0.0938,0.5991,0.9744,0.2551,0.7439,0.6509,0.1756,0.5521,0.8176,0.1542,0.3399,0.7566,0.7328,0.5221,0.7171,0.3998,0.3496,0.0143,0.6303,0.5668,0.6744,0.2459,0.9166,0.9464,0.152,0.6014,0.251,0.5539,0.8226,0.7143,0.7793,0.006,0.4787,0.6425,0.4482,0.7555,0.3407,0.1001,0.026,0.4949,0.922,0.4527,0.6511,0.1718,0.4407,0.8032,0.3851,0.0274,0.1755,0.0418,0.9477,0.7778,0.5764,0.4923,0.975,0.8057,0.6228,0.4804,0.5041,0.6023,0.9674,0.8419,0.6705,0.5939,0.4077,0.3616,0.7493,0.4737,0.0233,0.2306,0.5772,0.8457,0.4103,0.6997,0.655,0.8823,0.4167,0.7932,0.0003,0.7688,0.6536,0.5159,0.7871,0.6553,0.5976,0.0024,0.7021,0.0806,0.1199,0.7474,0.2033,0.6782,0.3289,0.8415,0.3933,0.6482,0.0137,0.087,0.0084,0.3822,0.2506,0.6521,0.4255,0.0966,0.0089,0.7678,0.0652,0.4547,0.3995,0.827,0.4121,0.0829,0.4331,0.9878,0.2415,0.9292,0.2053,0.0578,0.876,0.4045,0.813,0.0849,0.9691,0.1908,0.3216,0.8345,0.9392,0.9054,0.9031,0.7686,0.2696,0.1612,0.0109,0.8994,0.8304,0.7317,0.1413,0.6349,0.3299,0.5078,0.0591,0.3136,0.6872,0.9937,0.283,0.5112,0.8206,0.0741,0.4559,0.1534,0.5583,0.041,0.2265,0.6491,0.6714,0.7589,0.6768,0.4774,0.071,0.9695,0.4009,0.7896,0.8367,0.3047,0.3167,0.2354,0.5098,0.0765,0.0271,0.5337,0.5442,0.7373,0.3586,0.416,0.2219,0.5237,0.6805,0.4312,0.7166,0.5979,0.2235,0.9773,0.8439,0.245,0.7679,0.551,0.4624,0.847,0.4513,0.5729,0.7506,0.4994,0.3169,0.0905,0.5095,0.2002,0.556,0.431,0.0896,0.299,0.2892,0.7686,0.1634,0.7939,0.4784,0.2367,0.4151,0.1117,0.9945,0.4489,0.4683,0.1398,0.1332,0.7193,0.3539,0.4928,0.424,0.8358,0.4539,0.4496,0.9626,0.4975,0.7497,0.4415,0.6522,0.7767,0.462,0.7226,0.9389,0.0326,0.6278,0.3867,0.9492,0.6555,0.9273,0.3923,0.9842,0.326,0.8563,0.7938,0.0291,0.401,0.6285,0.488,0.516,0.7664,0.2485,0.4502,0.6154,0.735,0.577,0.7982,0.4087,0.3462,0.248,0.2596,0.097,0.0999,0.7282,0.0552,0.4532,0.295,0.0033,0.513,0.5173,0.3885,0.8268,0.6694,0.7107,0.1785,0.3992,0.2752,0.3208,0.3632,0.5469,0.1052,0.949,0.6748,0.5877,0.8961,0.6488,0.4622,0.146,0.2316,0.0286,0.1218,0.6943,0.5979,0.9417,0.2317,0.1562,0.4356,0.3865,0.7966,0.5726,0.1624,0.0978,0.0707,0.8591,0.2632,0.9534,0.5111,0.0963,0.1396,0.8653,0.2,0.4458,0.6492,0.4572,0.3524,0.2757,0.5789,0.6733,0.9318,0.7093,0.2905,0.4528,0.4462,0.8209,0.3275,0.0186,0.4204,0.8802,0.9971,0.8036,0.7339,0.4245,0.1699,0.0393,0.2813,0.6519,0.4263,0.2383,0.7843,0.831,0.774,0.1875,0.4836,0.8747,0.7826,0.8399,0.7984,0.2024,0.1122,0.4563,0.8809,0.8762,0.3142,0.4271,0.0585,0.1398,0.2416,0.044,0.123,0.9609,0.4639,0.4532,0.3403,0.0421,0.9646,0.1249,0.5714,0.2395,0.7894,0.1383,0.1583,0.081,0.4952,0.2976,0.9791,0.4064,0.6693,0.1625,0.5965,0.6228,0.6213,0.2097,0.094,0.9631,0.4662,0.7086,0.4147,0.9336,0.636,0.6084,0.6401,0.3934,0.9958,0.0894,0.3104,0.083,0.7248,0.7608,0.0851,0.3981,0.2567,0.9141,0.9836,0.9656,0.6344,0.3151,0.4802,0.7719,0.3917,0.5788,0.2061,0.6619,0.9064,0.4605,0.72,0.1114,0.0243,0.9152,0.6245,0.7584,0.7792,0.3123,0.3615,0.0961,0.7933,0.8451,0.5006,0.7579,0.8716,0.4059,0.9546,0.3185,0.3734,0.7702,0.9598,0.9911,0.663,0.0587,0.2539,0.2088,0.5218,0.5902,0.4543,0.2259,0.5368,0.8556,0.6127,0.197,0.4776,0.1775,0.9216,0.6944,0.9145,0.5051,0.131,0.3777,0.9612,0.0405,0.3814,0.5794,0.8176,0.6504,0.9453,0.7158,0.9274,0.3784,0.425,0.4289,0.1048,0.2679,0.3083,0.3141,0.5612,0.6115,0.6869,0.5872,0.0911,0.792,0.764,0.1927,0.9898,0.6908,0.9197,0.9057,0.7482,0.072,0.3143,0.0453,0.9734,0.8245,0.8361,0.3213,0.0483,0.6703,0.3542,0.1938,0.4954,0.9939,0.1726,0.9725,0.3099,0.1224,0.9374,0.5138,0.6989,0.5783,0.5397,0.0707,0.8368,0.6296,0.662,0.373,0.0348,0.8103,0.755,0.311,0.5782,0.0364,0.2751,0.9631,0.6359,0.6006,0.6111,0.8751,0.5289,0.3025,0.8953,0.2439,0.6618,0.1523,0.7804,0.9284,0.2419,0.5754,0.6179,0.2746,0.9395,0.4919,0.9667,0.9728,0.2179,0.0818,0.9852,0.8345,0.484,0.8829,0.616,0.0644,0.659,0.0837,0.0039,0.2988,0.5754,0.7599,0.6969,0.2623,0.6166,0.9618,0.1386,0.2589,0.9708,0.0318,0.9699,0.8049,0.2185,0.5541,0.8932,0.2773,0.8565,0.8965,0.0487,0.2484,0.5931,0.7091,0.1236,0.24,0.5871,0.6633,0.3011,0.7424,0.1207,0.4351,0.2448,0.6416,0.2471,0.5074,0.5692,0.6103,0.308,0.8202,0.3028,0.8777,0.0711,0.828,0.1008,0.2076,0.0217,0.0855,0.2008,0.1071,0.0179,0.5881,0.2366,0.5649,0.4046,0.382,0.6744,0.7024,0.5682,0.7134,0.4701,0.8744,0.3332,0.7409,0.788,0.5512,0.3862,0.6024,0.922,0.9136,0.4257,0.1252,0.6919,0.4626,0.6648,0.2315,0.3997,0.1796]	[0.1207,0.4155,0.2575,0.3197,0.2786,0.3009,0.5915,0.2232,0.7483,0.9834,0.5193,0.4088,0.8734,0.6603,0.5241,0.2782,0.3491,0.9515,0.1714,0.0182,0.3253,0.3385,0.0707,0.6784,0.6087,0.7903,0.3946,0.7822,0.7284,0.6802,0.4276,0.852,0.0044,0.9638,0.1197,0.4065,0.2772,0.8657,0.6286,0.6895,0.4214,0.9598,0.721,0.3396,0.7708,0.2416,0.9915,0.8614,0.8857,0.9327,0.3383,0.7953,0.6387,0.378,0.9191,0.8489,0.043,0.137,0.758,0.1617,0.6055,0.6871,0.9773,0.7324,0.2471,0.6853,0.9597,0.3007,0.7697,0.6208,0.0408,0.7207,0.768,0.2541,0.8758,0.7707,0.6434,0.2561,0.3923,0.0041,0.5425,0.5902,0.9166,0.8139,0.8464,0.7621,0.7303,0.9518,0.4545,0.7349,0.7745,0.9561,0.9841,0.5168,0.033,0.0734,0.6051,0.2312,0.0514,0.6468,0.8483,0.0577,0.8826,0.2271,0.8742,0.0064,0.5653,0.4949,0.2902,0.4936,0.5469,0.8548,0.0568,0.2793,0.1867,0.3934,0.5612,0.8827,0.9562,0.5196,0.566,0.328,0.7019,0.4663,0.8722,0.1331,0.9,0.0006,0.6081,0.7805,0.3553,0.7656,0.9908,0.0554,0.182,0.0772,0.4812,0.1912,0.6916,0.9735,0.1992,0.0455,0.157,0.3729,0.3059,0.7779,0.0789,0.988,0.8799,0.3931,0.5647,0.8081,0.3595,0.7402,0.1996,0.7047,0.5276,0.4809,0.7504,0.7869,0.3079,0.4319,0.433,0.8744,0.2669,0.1836,0.3353,0.3713,0.9782,0.6595,0.8895,0.2759,0.8477,0.8134,0.272,0.0492,0.1488,0.5319,0.5275,0.6736,0.0524,0.2513,0.9911,0.9516,0.8845,0.0674,0.2945,0.4928,0.7922,0.0786,0.3117,0.7546,0.5907,0.2283,0.0767,0.0161,0.7809,0.8912,0.2361,0.5233,0.9622,0.9979,0.2472,0.3414,0.3754,0.8949,0.7026,0.2193,0.453,0.1825,0.3994,0.235,0.966,0.6063,0.6775,0.781,0.2089,0.3486,0.8507,0.4998,0.9988,0.6425,0.4189,0.484,0.4745,0.8301,0.7032,0.1871,0.0647,0.0075,0.8286,0.1487,0.7494,0.7214,0.7712,0.687,0.8578,0.2696,0.2751,0.6611,0.6256,0.5454,0.4043,0.8686,0.7868,0.5347,0.3219,0.7474,0.2712,0.0298,0.7556,0.0274,0.1308,0.985,0.9501,0.8619,0.1434,0.8404,0.891,0.8403,0.0916,0.3721,0.4596,0.95,0.8779,0.2468,0.2677,0.0277,0.1091,0.7493,0.1502,0.0708,0.5665,0.1176,0.1306,0.5668,0.2581,0.6597,0.4967,0.5595,0.2036,0.4012,0.8872,0.6416,0.5163,0.7521,0.8394,0.3688,0.1299,0.1268,0.5783,0.8371,0.9413,0.3051,0.1049,0.151,0.937,0.3636,0.2156,0.1873,0.4173,0.0367,0.6702,0.508,0.653,0.0509,0.3611,0.9218,0.9345,0.4624,0.5366,0.4732,0.6091,0.805,0.4282,0.198,0.4446,0.7303,0.1679,0.5357,0.0537,0.6748,0.917,0.8944,0.8265,0.17,0.4753,0.1674,0.0937,0.0652,0.872,0.5738,0.4948,0.3128,0.002,0.2929,0.4669,0.2348,0.6772,0.9408,0.1698,0.0565,0.3458,0.1235,0.5252,0.0833,0.6146,0.5065,0.3789,0.9753,0.6137,0.3619,0.2842,0.9106,0.9862,0.6399,0.5725,0.7336,0.4253,0.433,0.7551,0.5895,0.6507,0.3751,0.8609,0.0552,0.1459,0.9253,0.8612,0.9015,0.1254,0.2579,0.1046,0.1186,0.2531,0.1293,0.7367,0.4999,0.0454,0.0164,0.6993,0.9556,0.7323,0.6037,0.7887,0.1784,0.6805,0.8202,0.4942,0.8387,0.0844,0.5545,0.4461,0.1201,0.1445,0.0201,0.896,0.891,0.2074,0.7053,0.2258,0.1823,0.5526,0.0402,0.7561,0.8512,0.3139,0.7435,0.5785,0.6912,0.7643,0.5503,0.1176,0.1873,0.5307,0.6753,0.1554,0.4346,0.3319,0.2798,0.3906,0.7588,0.9269,0.9562,0.2838,0.2164,0.3822,0.9779,0.6435,0.2847,0.9697,0.7201,0.194,0.2821,0.6901,0.2,0.9882,0.1129,0.9478,0.7969,0.3036,0.918,0.1662,0.1958,0.1263,0.6593,0.05,0.2274,0.3622,0.3664,0.0851,0.1297,0.204,0.5751,0.0231,0.8533,0.7468,0.1146,0.9594,0.0529,0.2052,0.7853,0.1322,0.0835,0.4719,0.293,0.1243,0.1437,0.5764,0.0209,0.8872,0.2269,0.2198,0.3396,0.7391,0.0971,0.7324,0.4661,0.6608,0.94,0.7471,0.5464,0.3812,0.2669,0.3411,0.4788,0.7204,0.0514,0.4412,0.171,0.4882,0.646,0.089,0.7381,0.8598,0.511,0.1554,0.2991,0.9554,0.7063,0.3039,0.974,0.7764,0.9267,0.5212,0.8253,0.9573,0.0764,0.4606,0.6235,0.2387,0.3571,0.9572,0.7635,0.9247,0.2709,0.4572,0.9903,0.231,0.4927,0.1358,0.4722,0.144,0.0796,0.3496,0.7732,0.2495,0.9626,0.5523,0.3101,0.4197,0.1627,0.6799,0.3839,0.835,0.6925,0.4195,0.1874,0.1086,0.998,0.0301,0.8419,0.5481,0.5371,0.1428,0.1858,0.4724,0.4415,0.5379,0.6587,0.9649,0.9696,0.8271,0.7567,0.2694,0.5101,0.0446,0.3666,0.6655,0.8084,0.4831,0.7006,0.4751,0.6898,0.3018,0.2888,0.9843,0.6159,0.6795,0.3516,0.9489,0.8947,0.0678,0.86,0.6435,0.4553,0.4244,0.8575,0.1014,0.5182,0.4167,0.6984,0.8395,0.2883,0.9094,0.9186,0.3376,0.9849,0.4996,0.0028,0.0084,0.7724,0.2707,0.3346,0.2952,0.8546,0.8669,0.7882,0.1345,0.1296,0.7392,0.5698,0.4253,0.6353,0.3656,0.6865,0.9159,0.7041,0.0389,0.53,0.7571,0.7269,0.9034,0.9203,0.5163,0.8629,0.4643,0.0356,0.6574,0.4621,0.2082,0.0965,0.9578,0.7002,0.5996,0.8931,0.0713,0.7009,0.791,0.2133,0.6067,0.6312,0.7628,0.1951,0.3787,0.0985,0.6108,0.7759,0.9713,0.3834,0.8,0.5099,0.3164,0.7646,0.8242,0.6506,0.7705,0.6965,0.3351,0.9042,0.5622,0.1288,0.6441,0.6959,0.198,0.6969,0.6392,0.5742,0.3259,0.5376,0.7937,0.19,0.728,0.5741,0.2126,0.6138,0.6379,0.5265,0.12,0.1514,0.6113,0.1562,0.188,0.0863,0.3784,0.1295,0.0165,0.392,0.4865,0.6257,0.2296,0.6333,0.1035,0.2119,0.0881,0.7671,0.9048,0.4074,0.6582,0.4435,0.1147,0.6478,0.6445,0.3046,0.1278,0.0594,0.0457,0.4949,0.1813,0.74,0.0995,0.5005,0.366,0.3331,0.026,0.8862,0.2477,0.1178,0.1623,0.4631,0.9883,0.4888,0.6658,0.8332,0.3577,0.7958,0.0615,0.3536,0.4449,0.32,0.8532,0.7019,0.6498,0.6968,0.006,0.7382,0.6228,0.8323,0.6659,0.3241,0.1895,0.0765,0.0091,0.5459,0.6573,0.7511,0.7783,0.8537,0.0196,0.3672,0.5877,0.5439,0.8704,0.0699,0.3594,0.9717,0.5768,0.9496,0.4907,0.5231,0.9045,0.9375,0.7237,0.194,0.0425,0.4698,0.934,0.6035,0.0741,0.7348,0.769,0.2246,0.4155,0.6037,0.2305,0.5283,0.5479,0.0909,0.9927,0.5982,0.7759,0.0636,0.4833,0.0343,0.3133,0.8514,0.89,0.2155,0.5031,0.1172,0.5697,0.4669,0.0482,0.3071,0.0711,0.6185,0.0871,0.672,0.2732,0.8785,0.5318,0.5535,0.8072,0.4492,0.7141,0.8851,0.6406,0.1605,0.4449,0.4733,0.1487,0.3488,0.8996,0.4213,0.0535,0.0819,0.6985,0.9194,0.2822,0.0037,0.9458,0.3111,0.8009,0.0827,0.4707,0.3243,0.442,0.3731,0.0505,0.8528,0.6072,0.677,0.2995,0.5376,0.1631,0.2849,0.7632,0.0977,0.8267,0.7068,0.2227,0.3609,0.2954,0.7336,0.8025,0.9661,0.4859,0.2162,0.3655,0.94,0.7089,0.1026,0.5789,0.6153,0.5745,0.4715,0.2028,0.4726,0.2407,0.2181,0.5888,0.7979,0.0183,0.3685,0.1921,0.5356,0.0136,0.2647,0.4964,0.5565,0.1094,0.9289,0.8263,0.2428,0.6163,0.8924,0.5636,0.7858,0.7984,0.9261,0.0902,0.744,0.5253,0.6717,0.2403,0.5454,0.5378,0.4022,0.2959,0.23,0.6664,0.026,0.2365,0.6735,0.1821,0.6778,0.4428,0.346,0.9195,0.3988,0.6642,0.0851,0.3267,0.6389,0.5457,0.6312,0.5295,0.6761,0.024,0.565,0.9298,0.6954,0.2395,0.282,0.5674,0.0065,0.6925,0.4843,0.5036,0.9911,0.7761,0.4903,0.7142,0.0938,0.5991,0.9744,0.2551,0.7439,0.6509,0.1756,0.5521,0.8176,0.1542,0.3399,0.7566,0.7328,0.5221,0.7171,0.3998,0.3496,0.0143,0.6303,0.5668,0.6744,0.2459,0.9166,0.9464,0.152,0.6014,0.251,0.5539,0.8226,0.7143,0.7793,0.006,0.4787,0.6425,0.4482,0.7555,0.3407,0.1001,0.026,0.4949,0.922,0.4527,0.6511,0.1718,0.4407,0.8032,0.3851,0.0274,0.1755,0.0418,0.9477,0.7778,0.5764,0.4923,0.975,0.8057,0.6228,0.4804,0.5041,0.6023,0.9674,0.8419,0.6705,0.5939,0.4077,0.3616,0.7493,0.4737,0.0233,0.2306,0.5772,0.8457,0.4103,0.6997,0.655,0.8823,0.4167,0.7932,0.0003,0.7688,0.6536,0.5159,0.7871,0.6553,0.5976,0.0024,0.7021,0.0806,0.1199,0.7474,0.2033,0.6782,0.3289,0.8415,0.3933,0.6482,0.0137,0.087,0.0084,0.3822,0.2506,0.6521,0.4255,0.0966,0.0089,0.7678,0.0652,0.4547,0.3995,0.827,0.4121,0.0829,0.4331,0.9878,0.2415,0.9292,0.2053,0.0578,0.876,0.4045,0.813,0.0849,0.9691,0.1908,0.3216,0.8345,0.9392,0.9054,0.9031,0.7686,0.2696,0.1612,0.0109,0.8994,0.8304,0.7317,0.1413,0.6349,0.3299,0.5078,0.0591,0.3136,0.6872,0.9937,0.283,0.5112,0.8206,0.0741,0.4559,0.1534,0.5583,0.041,0.2265,0.6491,0.6714,0.7589,0.6768,0.4774,0.071,0.9695,0.4009,0.7896,0.8367,0.3047,0.3167,0.2354,0.5098,0.0765,0.0271,0.5337,0.5442,0.7373,0.3586,0.416,0.2219,0.5237,0.6805,0.4312,0.7166,0.5979,0.2235,0.9773,0.8439,0.245,0.7679,0.551,0.4624,0.847,0.4513,0.5729,0.7506,0.4994,0.3169,0.0905,0.5095,0.2002,0.556,0.431,0.0896,0.299,0.2892,0.7686,0.1634,0.7939,0.4784,0.2367,0.4151,0.1117,0.9945,0.4489,0.4683,0.1398,0.1332,0.7193,0.3539,0.4928,0.424,0.8358,0.4539,0.4496,0.9626,0.4975,0.7497,0.4415,0.6522,0.7767,0.462,0.7226,0.9389,0.0326,0.6278,0.3867,0.9492,0.6555,0.9273,0.3923,0.9842,0.326,0.8563,0.7938,0.0291,0.401,0.6285,0.488,0.516,0.7664,0.2485,0.4502,0.6154,0.735,0.577,0.7982,0.4087,0.3462,0.248,0.2596,0.097,0.0999,0.7282,0.0552,0.4532,0.295,0.0033,0.513,0.5173,0.3885,0.8268,0.6694,0.7107,0.1785,0.3992,0.2752,0.3208,0.3632,0.5469,0.1052,0.949,0.6748,0.5877,0.8961,0.6488,0.4622,0.146,0.2316,0.0286,0.1218,0.6943,0.5979,0.9417,0.2317,0.1562,0.4356,0.3865,0.7966,0.5726,0.1624,0.0978,0.0707,0.8591,0.2632,0.9534,0.5111,0.0963,0.1396,0.8653,0.2,0.4458,0.6492,0.4572,0.3524,0.2757,0.5789,0.6733,0.9318,0.7093,0.2905,0.4528,0.4462,0.8209,0.3275,0.0186,0.4204,0.8802,0.9971,0.8036,0.7339,0.4245,0.1699,0.0393,0.2813,0.6519,0.4263,0.2383,0.7843,0.831,0.774,0.1875,0.4836,0.8747,0.7826,0.8399,0.7984,0.2024,0.1122,0.4563,0.8809,0.8762,0.3142,0.4271,0.0585,0.1398,0.2416,0.044,0.123,0.9609,0.4639,0.4532,0.3403,0.0421,0.9646,0.1249,0.5714,0.2395,0.7894,0.1383,0.1583,0.081,0.4952,0.2976,0.9791,0.4064,0.6693,0.1625,0.5965,0.6228,0.6213,0.2097,0.094,0.9631,0.4662,0.7086,0.4147,0.9336,0.636,0.6084,0.6401,0.3934,0.9958,0.0894,0.3104,0.083,0.7248,0.7608,0.0851,0.3981,0.2567,0.9141,0.9836,0.9656,0.6344,0.3151,0.4802,0.7719,0.3917,0.5788,0.2061,0.6619,0.9064,0.4605,0.72,0.1114,0.0243,0.9152,0.6245,0.7584,0.7792,0.3123,0.3615,0.0961,0.7933,0.8451,0.5006,0.7579,0.8716,0.4059,0.9546,0.3185,0.3734,0.7702,0.9598,0.9911,0.663,0.0587,0.2539,0.2088,0.5218,0.5902,0.4543,0.2259,0.5368,0.8556,0.6127,0.197,0.4776,0.1775,0.9216,0.6944,0.9145,0.5051,0.131,0.3777,0.9612,0.0405,0.3814,0.5794,0.8176,0.6504,0.9453,0.7158,0.9274,0.3784,0.425,0.4289,0.1048,0.2679,0.3083,0.3141,0.5612,0.6115,0.6869,0.5872,0.0911,0.792,0.764,0.1927,0.9898,0.6908,0.9197,0.9057,0.7482,0.072,0.3143,0.0453,0.9734,0.8245,0.8361,0.3213,0.0483,0.6703,0.3542,0.1938,0.4954,0.9939,0.1726,0.9725,0.3099,0.1224,0.9374,0.5138,0.6989,0.5783,0.5397,0.0707,0.8368,0.6296,0.662,0.373,0.0348,0.8103,0.755,0.311,0.5782,0.0364,0.2751,0.9631,0.6359,0.6006,0.6111,0.8751,0.5289,0.3025,0.8953,0.2439,0.6618,0.1523,0.7804,0.9284,0.2419,0.5754,0.6179,0.2746,0.9395,0.4919,0.9667,0.9728,0.2179,0.0818,0.9852,0.8345,0.484,0.8829,0.616,0.0644,0.659,0.0837,0.0039,0.2988,0.5754,0.7599,0.6969,0.2623,0.6166,0.9618,0.1386,0.2589,0.9708,0.0318,0.9699,0.8049,0.2185,0.5541,0.8932,0.2773,0.8565,0.8965,0.0487,0.2484,0.5931,0.7091,0.1236,0.24,0.5871,0.6633,0.3011,0.7424,0.1207,0.4351,0.2448,0.6416,0.2471,0.5074,0.5692,0.6103,0.308,0.8202,0.3028,0.8777,0.0711,0.828,0.1008,0.2076,0.0217,0.0855,0.2008,0.1071,0.0179,0.5881,0.2366,0.5649,0.4046,0.382,0.6744,0.7024,0.5682,0.7134,0.4701,0.8744,0.3332,0.7409,0.788,0.5512,0.3862,0.6024,0.922,0.9136,0.4257,0.1252,0.6919,0.4626,0.6648,0.2315,0.3997,0.1796]	0.5	0.9	2025-11-10 21:26:06.992169+00	1.35
8	[0.7932,0.7768,0.6111,0.0587,0.756,0.4649,0.9622,0.7569,0.8332,0.6767,0.6768,0.2552,0.3842,0.6569,0.0287,0.5607,0.7718,0.4639,0.2571,0.706,0.9365,0.765,0.907,0.9605,0.2091,0.2187,0.8914,0.971,0.9561,0.0845,0.4133,0.3408,0.8828,0.0012,0.9179,0.0215,0.7394,0.105,0.7342,0.2362,0.9781,0.0083,0.1161,0.1761,0.7951,0.6544,0.4444,0.7964,0.8878,0.8724,0.55,0.5608,0.2809,0.7798,0.5809,0.5963,0.9524,0.46,0.8613,0.8575,0.0592,0.5969,0.8713,0.99,0.9297,0.4484,0.8832,0.8043,0.4933,0.5116,0.7794,0.6896,0.1341,0.025,0.4198,0.3951,0.8369,0.5584,0.8426,0.6663,0.2667,0.757,0.4991,0.5696,0.1122,0.3684,0.2484,0.0956,0.9957,0.2471,0.1539,0.6812,0.9056,0.7484,0.8522,0.2475,0.5771,0.4299,0.8424,0.3812,0.2829,0.8421,0.7817,0.1509,0.7882,0.6512,0.6082,0.5749,0.5896,0.8188,0.0386,0.0526,0.268,0.7769,0.2528,0.4796,0.5997,0.2056,0.7819,0.3483,0.5614,0.1418,0.6469,0.3838,0.9221,0.6273,0.9909,0.0117,0.3403,0.6969,0.5956,0.1576,0.3727,0.7894,0.417,0.7379,0.3723,0.0491,0.259,0.2638,0.1637,0.9748,0.5431,0.5403,0.0237,0.0903,0.36,0.1858,0.8645,0.5666,0.4215,0.8919,0.1936,0.2115,0.4309,0.1856,0.5358,0.7021,0.4275,0.736,0.9466,0.6911,0.2638,0.2865,0.9832,0.5547,0.3478,0.2153,0.373,0.565,0.6531,0.2781,0.5461,0.8748,0.1563,0.956,0.6391,0.28,0.7255,0.6577,0.2825,0.3079,0.2939,0.8459,0.6549,0.3919,0.3298,0.7384,0.2751,0.0608,0.0813,0.172,0.8677,0.8395,0.0465,0.778,0.9066,0.0118,0.6321,0.9263,0.3142,0.0867,0.1111,0.4958,0.2325,0.6455,0.3622,0.238,0.4918,0.9162,0.339,0.2226,0.1044,0.6129,0.1563,0.3323,0.3111,0.4729,0.9125,0.4274,0.0154,0.666,0.4718,0.8868,0.3379,0.0551,0.5399,0.0389,0.3677,0.047,0.6141,0.4898,0.0566,0.8107,0.1206,0.4711,0.7024,0.6086,0.1194,0.6738,0.9188,0.6608,0.2634,0.0318,0.914,0.5283,0.1446,0.8245,0.0972,0.7369,0.6678,0.0939,0.303,0.0733,0.0675,0.8532,0.4038,0.9309,0.9995,0.9311,0.2718,0.8613,0.5239,0.841,0.1876,0.3517,0.168,0.5323,0.8268,0.8336,0.7018,0.1969,0.5816,0.2615,0.8066,0.9582,0.5654,0.9662,0.9113,0.3662,0.8343,0.8029,0.3844,0.54,0.6585,0.8565,0.9451,0.1232,0.9477,0.1214,0.0366,0.9022,0.6632,0.1445,0.7236,0.3548,0.3213,0.665,0.4897,0.7067,0.0911,0.0271,0.5003,0.9574,0.6597,0.7675,0.5927,0.8076,0.465,0.4357,0.1228,0.2173,0.8717,0.1713,0.9744,0.9371,0.3773,0.7912,0.6729,0.4595,0.8141,0.1105,0.7061,0.38,0.0237,0.8324,0.5918,0.3335,0.6614,0.6166,0.1514,0.8871,0.6919,0.5197,0.4602,0.8401,0.8813,0.0725,0.5984,0.8588,0.2378,0.1054,0.2293,0.6148,0.3114,0.7465,0.0798,0.6838,0.9107,0.9196,0.3008,0.2273,0.0808,0.85,0.7855,0.2425,0.7904,0.8469,0.9967,0.7735,0.5148,0.4339,0.9323,0.944,0.1149,0.7827,0.6671,0.8096,0.4002,0.8376,0.9611,0.5061,0.1647,0.4458,0.6166,0.3535,0.0065,0.9513,0.8175,0.7517,0.984,0.3444,0.7953,0.6832,0.0724,0.9574,0.1154,0.1745,0.494,0.6169,0.4821,0.3837,0.2159,0.7729,0.0925,0.7408,0.6921,0.1925,0.2554,0.2709,0.1563,0.5078,0.9235,0.5357,0.5991,0.4065,0.1187,0.0522,0.1366,0.6106,0.4973,0.3232,0.4482,0.8234,0.5892,0.6901,0.3968,0.7621,0.8868,0.5086,0.7605,0.7778,0.7996,0.3539,0.2013,0.8755,0.8107,0.9302,0.9244,0.0737,0.8797,0.8922,0.0581,0.8093,0.4365,0.4579,0.7797,0.0257,0.9572,0.3899,0.1904,0.4203,0.5464,0.8023,0.205,0.5966,0.9714,0.3564,0.8535,0.659,0.583,0.6063,0.176,0.8202,0.798,0.4618,0.2765,0.7359,0.3636,0.366,0.2627,0.1268,0.4392,0.9744,0.0895,0.9894,0.4437,0.1701,0.055,0.6912,0.5191,0.9463,0.903,0.537,0.7457,0.0845,0.3032,0.3684,0.2521,0.6431,0.8471,0.2452,0.1405,0.5723,0.3997,0.5362,0.292,0.932,0.3913,0.2592,0.5675,0.4274,0.8254,0.0662,0.78,0.3609,0.2654,0.4391,0.0653,0.0004,0.4245,0.8238,0.4219,0.6095,0.1996,0.0661,0.6007,0.1328,0.2987,0.5222,0.1267,0.4781,0.3354,0.7599,0.0036,0.2297,0.2718,0.0701,0.0195,0.113,0.8472,0.9962,0.5718,0.602,0.1693,0.5204,0.2984,0.4207,0.3621,0.3504,0.8358,0.9019,0.5015,0.6305,0.2338,0.7503,0.2477,0.0889,0.3009,0.7008,0.1753,0.536,0.8448,0.5158,0.4558,0.1379,0.1058,0.5621,0.9195,0.7746,0.6348,0.2624,0.9237,0.1858,0.1238,0.906,0.4925,0.0565,0.5554,0.9787,0.5396,0.0525,0.3886,0.1161,0.5098,0.4076,0.022,0.8934,0.282,0.0038,0.3583,0.5609,0.1602,0.769,0.3927,0.9663,0.9741,0.8295,0.8214,0.779,0.5682,0.3759,0.527,0.7909,0.3374,0.616,0.9831,0.9156,0.9911,0.7452,0.1999,0.347,0.6614,0.655,0.0197,0.3961,0.4226,0.2272,0.6663,0.207,0.1673,0.1853,0.0941,0.5243,0.2482,0.7186,0.642,0.706,0.9647,0.5175,0.0798,0.0601,0.6073,0.5372,0.8604,0.3363,0.1873,0.9841,0.4377,0.3664,0.061,0.147,0.9566,0.2383,0.5969,0.3432,0.8829,0.032,0.8608,0.7995,0.948,0.5933,0.9842,0.806,0.4807,0.4171,0.2773,0.1262,0.9026,0.1137,0.9723,0.132,0.4631,0.5986,0.8374,0.3888,0.9394,0.6019,0.1369,0.2202,0.3148,0.4662,0.9296,0.0907,0.6469,0.033,0.9962,0.587,0.9527,0.2237,0.0071,0.2115,0.2268,0.2973,0.5017,0.9399,0.0309,0.5112,0.778,0.0362,0.2615,0.2946,0.1786,0.5988,0.3189,0.8859,0.0393,0.1864,0.8533,0.5735,0.378,0.3522,0.2027,0.2095,0.4533,0.5896,0.9378,0.3571,0.2122,0.231,0.4372,0.0288,0.7943,0.6436,0.3919,0.0935,0.1234,0.4017,0.961,0.902,0.2233,0.3861,0.9983,0.2843,0.8745,0.564,0.9906,0.973,0.965,0.9197,0.9643,0.6304,0.0128,0.9945,0.7792,0.1622,0.8361,0.1768,0.7861,0.665,0.8178,0.2723,0.0565,0.2705,0.295,0.0543,0.857,0.4013,0.8637,0.8539,0.5792,0.0902,0.7298,0.4677,0.6682,0.9904,0.846,0.8193,0.5249,0.9679,0.7844,0.9924,0.4046,0.9955,0.7426,0.4901,0.2827,0.9705,0.5115,0.8054,0.2301,0.1393,0.0309,0.8952,0.4307,0.9681,0.2521,0.117,0.7071,0.9589,0.1849,0.1657,0.967,0.4132,0.2708,0.9405,0.1847,0.7256,0.2279,0.0047,0.814,0.7662,0.2313,0.5418,0.7307,0.2052,0.7382,0.9217,0.8333,0.2903,0.5984,0.6508,0.9333,0.4921,0.0656,0.6176,0.0778,0.8256,0.19,0.3603,0.6979,0.5535,0.7474,0.0136,0.6474,0.0146,0.6908,0.4223,0.128,0.62,0.7711,0.2154,0.4179,0.6709,0.1573,0.9793,0.6647,0.9014,0.184,0.1811,0.0414,0.1114,0.3554,0.3304,0.3096,0.1929,0.5236,0.3454,0.9069,0.6013,0.1365,0.196,0.4833,0.9505,0.1637,0.4061,0.6695,0.9196,0.6321,0.3434,0.4125,0.2168,0.1841,0.6056,0.6224,0.9239,0.6534,0.6417,0.7518,0.5852,0.4267,0.5963,0.893,0.3837,0.7029,0.5704,0.6841,0.9977,0.4975,0.7675,0.03,0.9407,0.8727,0.3494,0.2449,0.7287,0.3689,0.5548,0.2999,0.3628,0.5529,0.5983,0.1791,0.4989,0.1224,0.3602,0.5331,0.1259,0.5033,0.692,0.3603,0.0828,0.6707,0.5139,0.6611,0.7299,0.3294,0.5233,0.644,0.0275,0.3735,0.0327,0.6867,0.9614,0.9071,0.8429,0.0437,0.9022,0.163,0.3901,0.7798,0.1763,0.2758,0.6319,0.5418,0.2334,0.814,0.7273,0.2996,0.6528,0.258,0.2605,0.6483,0.2735,0.6197,0.2504,0.0007,0.1986,0.0542,0.0009,0.7913,0.054,0.4527,0.7578,0.6513,0.3886,0.1877,0.5692,0.8555,0.5379,0.7335,0.0178,0.9356,0.911,0.0794,0.8409,0.5565,0.3647,0.7331,0.6024,0.2686,0.5374,0.6208,0.3062,0.225,0.0752,0.9436,0.8129,0.937,0.0614,0.3874,0.1012,0.2642,0.0991,0.9921,0.3878,0.984,0.3045,0.1093,0.2371,0.1336,0.8526,0.9211,0.253,0.4356,0.7099,0.0197,0.0254,0.6261,0.4186,0.8469,0.5217,0.1412,0.0886,0.9888,0.4031,0.5484,0.654,0.5484,0.142,0.1997,0.4361,0.517,0.0033,0.8016,0.0842,0.4959,0.9188,0.0817,0.0991,0.5077,0.4932,0.6168,0.0845,0.7196,0.2545,0.6583,0.6148,0.2423,0.1085,0.5137,0.6271,0.1722,0.0561,0.2821,0.3206,0.8083,0.6649,0.2702,0.3547,0.7364,0.9051,0.8243,0.8606,0.0094,0.2178,0.5191,0.4262,0.6358,0.7801,0.4409,0.9581,0.8047,0.1001,0.1724,0.8253,0.2179,0.7597,0.6407,0.057,0.2326,0.5405,0.7638,0.854,0.8958,0.0235,0.7134,0.0543,0.9444,0.4931,0.3116,0.8327,0.7898,0.7226,0.1667,0.9594,0.65,0.8951,0.3437,0.1459,0.0228,0.0391,0.098,0.9156,0.528,0.1173,0.9645,0.4434,0.5055,0.6638,0.0335,0.4147,0.5025,0.6798,0.6675,0.9734,0.4492,0.6923,0.9131,0.2059,0.3165,0.6967,0.4913,0.1753,0.2386,0.0259,0.4518,0.0353,0.4986,0.5216,0.3568,0.024,0.6956,0.4964,0.5682,0.7127,0.7743,0.1204,0.2914,0.0547,0.9108,0.1839,0.0939,0.3339,0.0592,0.4977,0.1903,0.9765,0.9401,0.0763,0.4125,0.2576,0.01,0.5942,0.3745,0.1088,0.106,0.0653,0.6205,0.2466,0.0982,0.0988,0.4912,0.1028,0.0755,0.3333,0.2124,0.776,0.489,0.1004,0.9204,0.7195,0.4756,0.4751,0.8975,0.8463,0.2416,0.0188,0.3189,0.0599,0.7176,0.6894,0.9623,0.4506,0.7801,0.5017,0.9005,0.1221,0.5351,0.8356,0.0913,0.996,0.2322,0.6234,0.2609,0.6762,0.4936,0.5747,0.7744,0.5237,0.2035,0.7701,0.2106,0.5455,0.6789,0.7131,0.6042,0.8505,0.5766,0.8601,0.8399,0.2552,0.7087,0.7577,0.649,0.5005,0.4263,0.7755,0.2704,0.3145,0.9777,0.6466,0.7438,0.259,0.5773,0.1169,0.9047,0.7248,0.4959,0.5204,0.1506,0.9856,0.9833,0.5429,0.1261,0.4021,0.9569,0.8185,0.0618,0.7924,0.5985,0.7281,0.9464,0.1901,0.8617,0.0603,0.6653,0.772,0.1819,0.2756,0.9246,0.8826,0.2985,0.5251,0.3469,0.8978,0.5927,0.9831,0.0207,0.7613,0.0097,0.9199,0.1731,0.1905,0.5844,0.1719,0.4734,0.3232,0.4713,0.9303,0.8719,0.7181,0.698,0.3627,0.4811,0.5401,0.6284,0.3349,0.3915,0.9336,0.6537,0.5271,0.9984,0.7254,0.1889,0.3242,0.5167,0.3961,0.9136,0.4254,0.9728,0.5778,0.9145,0.6445,0.0638,0.4879,0.2942,0.863,0.3528,0.3257,0.068,0.0304,0.8898,0.9628,0.0254,0.3503,0.7232,0.3838,0.7468,0.2578,0.1519,0.1805,0.5599,0.5648,0.2502,0.9422,0.2464,0.7021,0.434,0.379,0.302,0.7973,0.1471,0.2193,0.4781,0.0456,0.271,0.4043,0.3889,0.7489,0.2491,0.0584,0.3949,0.262,0.0617,0.2066,0.7288,0.6119,0.4997,0.5121,0.341,0.4196,0.6225,0.2717,0.0471,0.6528,0.6431,0.6572,0.3964,0.1752,0.6389,0.3248,0.5306,0.2951,0.6605,0.6998,0.1602,0.3088,0.1834,0.0387,0.5433,0.1844,0.3644,0.8131,0.1226,0.6514,0.659,0.6611,0.9057,0.9264,0.2283,0.9372,0.8349,0.4975,0.2611,0.2672,0.9658,0.9656,0.903,0.494,0.9086,0.5009,0.5242,0.8242,0.2446,0.298,0.7044,0.037,0.3557,0.1313,0.4765,0.1302,0.6483,0.7797,0.4959,0.7098,0.2591,0.8359,0.9309,0.7457,0.2046,0.2309,0.9056,0.2939,0.5962,0.9252,0.1705,0.1218,0.5513,0.2614,0.7805,0.9754,0.4859,0.6419,0.0594,0.129,0.4364,0.9281,0.8461,0.8533,0.4539,0.2089,0.1412,0.25,0.6719,0.1983,0.6667,0.2046,0.4034,0.2485,0.6287,0.4075,0.0607,0.9897,0.2531,0.2347,0.4273,0.7997,0.9187,0.3391,0.6128,0.4024,0.5584,0.7529,0.5835,0.858,0.7139,0.4174,0.5587,0.1445,0.9233,0.5346,0.0969,0.5732,0.9152,0.2459,0.3743,0.096,0.3948,0.9085,0.3693,0.7587,0.0179,0.5386,0.7683,0.2799,0.4868,0.5007,0.5961,0.7044,0.2414,0.1251,0.3727,0.1722,0.5408,0.2432,0.9644,0.0102,0.7435,0.8068,0.3883,0.8687,0.2475,0.7832,0.7655,0.0784,0.0257,0.7326,0.5464,0.5718,0.1549,0.5702,0.5093,0.597,0.6289,0.7532,0.4341,0.4413,0.9892,0.0834,0.1586,0.1008,0.5682,0.3555,0.6543,0.4208,0.0399,0.7715,0.7993,0.5526,0.7303,0.7853,0.0214,0.2307,0.7544,0.6372,0.9855,0.4738,0.0381,0.2648,0.249,0.6949,0.2459,0.4967,0.5293,0.8507,0.9462,0.234,0.9725,0.3204,0.7317,0.7643,0.8025,0.1239,0.5495,0.116,0.9587,0.3266,0.1185,0.344,0.4129,0.5487,0.1975,0.8806,0.5332,0.2301,0.539,0.4952,0.7787,0.8787,0.9954,0.1674,0.3881,0.3711,0.1705,0.7377,0.6522,0.9661,0.051,0.6083,0.6312,0.0365,0.3138,0.9904,0.0248,0.9863,0.7908,0.9515,0.2417,0.8175,0.7496,0.8708,0.4591,0.3914,0.7887,0.6268,0.3048,0.3682,0.1907,0.0401,0.9907,0.2971,0.8136,0.2706,0.1675,0.0657,0.1123,0.2242,0.2413,0.3702,0.9842,0.1505,0.0537,0.2089,0.2317,0.5058]	seed-model	2025-11-10 04:48:51.599122+00	[0.7932,0.7768,0.6111,0.0587,0.756,0.4649,0.9622,0.7569,0.8332,0.6767,0.6768,0.2552,0.3842,0.6569,0.0287,0.5607,0.7718,0.4639,0.2571,0.706,0.9365,0.765,0.907,0.9605,0.2091,0.2187,0.8914,0.971,0.9561,0.0845,0.4133,0.3408,0.8828,0.0012,0.9179,0.0215,0.7394,0.105,0.7342,0.2362,0.9781,0.0083,0.1161,0.1761,0.7951,0.6544,0.4444,0.7964,0.8878,0.8724,0.55,0.5608,0.2809,0.7798,0.5809,0.5963,0.9524,0.46,0.8613,0.8575,0.0592,0.5969,0.8713,0.99,0.9297,0.4484,0.8832,0.8043,0.4933,0.5116,0.7794,0.6896,0.1341,0.025,0.4198,0.3951,0.8369,0.5584,0.8426,0.6663,0.2667,0.757,0.4991,0.5696,0.1122,0.3684,0.2484,0.0956,0.9957,0.2471,0.1539,0.6812,0.9056,0.7484,0.8522,0.2475,0.5771,0.4299,0.8424,0.3812,0.2829,0.8421,0.7817,0.1509,0.7882,0.6512,0.6082,0.5749,0.5896,0.8188,0.0386,0.0526,0.268,0.7769,0.2528,0.4796,0.5997,0.2056,0.7819,0.3483,0.5614,0.1418,0.6469,0.3838,0.9221,0.6273,0.9909,0.0117,0.3403,0.6969,0.5956,0.1576,0.3727,0.7894,0.417,0.7379,0.3723,0.0491,0.259,0.2638,0.1637,0.9748,0.5431,0.5403,0.0237,0.0903,0.36,0.1858,0.8645,0.5666,0.4215,0.8919,0.1936,0.2115,0.4309,0.1856,0.5358,0.7021,0.4275,0.736,0.9466,0.6911,0.2638,0.2865,0.9832,0.5547,0.3478,0.2153,0.373,0.565,0.6531,0.2781,0.5461,0.8748,0.1563,0.956,0.6391,0.28,0.7255,0.6577,0.2825,0.3079,0.2939,0.8459,0.6549,0.3919,0.3298,0.7384,0.2751,0.0608,0.0813,0.172,0.8677,0.8395,0.0465,0.778,0.9066,0.0118,0.6321,0.9263,0.3142,0.0867,0.1111,0.4958,0.2325,0.6455,0.3622,0.238,0.4918,0.9162,0.339,0.2226,0.1044,0.6129,0.1563,0.3323,0.3111,0.4729,0.9125,0.4274,0.0154,0.666,0.4718,0.8868,0.3379,0.0551,0.5399,0.0389,0.3677,0.047,0.6141,0.4898,0.0566,0.8107,0.1206,0.4711,0.7024,0.6086,0.1194,0.6738,0.9188,0.6608,0.2634,0.0318,0.914,0.5283,0.1446,0.8245,0.0972,0.7369,0.6678,0.0939,0.303,0.0733,0.0675,0.8532,0.4038,0.9309,0.9995,0.9311,0.2718,0.8613,0.5239,0.841,0.1876,0.3517,0.168,0.5323,0.8268,0.8336,0.7018,0.1969,0.5816,0.2615,0.8066,0.9582,0.5654,0.9662,0.9113,0.3662,0.8343,0.8029,0.3844,0.54,0.6585,0.8565,0.9451,0.1232,0.9477,0.1214,0.0366,0.9022,0.6632,0.1445,0.7236,0.3548,0.3213,0.665,0.4897,0.7067,0.0911,0.0271,0.5003,0.9574,0.6597,0.7675,0.5927,0.8076,0.465,0.4357,0.1228,0.2173,0.8717,0.1713,0.9744,0.9371,0.3773,0.7912,0.6729,0.4595,0.8141,0.1105,0.7061,0.38,0.0237,0.8324,0.5918,0.3335,0.6614,0.6166,0.1514,0.8871,0.6919,0.5197,0.4602,0.8401,0.8813,0.0725,0.5984,0.8588,0.2378,0.1054,0.2293,0.6148,0.3114,0.7465,0.0798,0.6838,0.9107,0.9196,0.3008,0.2273,0.0808,0.85,0.7855,0.2425,0.7904,0.8469,0.9967,0.7735,0.5148,0.4339,0.9323,0.944,0.1149,0.7827,0.6671,0.8096,0.4002,0.8376,0.9611,0.5061,0.1647,0.4458,0.6166,0.3535,0.0065,0.9513,0.8175,0.7517,0.984,0.3444,0.7953,0.6832,0.0724,0.9574,0.1154,0.1745,0.494,0.6169,0.4821,0.3837,0.2159,0.7729,0.0925,0.7408,0.6921,0.1925,0.2554,0.2709,0.1563,0.5078,0.9235,0.5357,0.5991,0.4065,0.1187,0.0522,0.1366,0.6106,0.4973,0.3232,0.4482,0.8234,0.5892,0.6901,0.3968,0.7621,0.8868,0.5086,0.7605,0.7778,0.7996,0.3539,0.2013,0.8755,0.8107,0.9302,0.9244,0.0737,0.8797,0.8922,0.0581,0.8093,0.4365,0.4579,0.7797,0.0257,0.9572,0.3899,0.1904,0.4203,0.5464,0.8023,0.205,0.5966,0.9714,0.3564,0.8535,0.659,0.583,0.6063,0.176,0.8202,0.798,0.4618,0.2765,0.7359,0.3636,0.366,0.2627,0.1268,0.4392,0.9744,0.0895,0.9894,0.4437,0.1701,0.055,0.6912,0.5191,0.9463,0.903,0.537,0.7457,0.0845,0.3032,0.3684,0.2521,0.6431,0.8471,0.2452,0.1405,0.5723,0.3997,0.5362,0.292,0.932,0.3913,0.2592,0.5675,0.4274,0.8254,0.0662,0.78,0.3609,0.2654,0.4391,0.0653,0.0004,0.4245,0.8238,0.4219,0.6095,0.1996,0.0661,0.6007,0.1328,0.2987,0.5222,0.1267,0.4781,0.3354,0.7599,0.0036,0.2297,0.2718,0.0701,0.0195,0.113,0.8472,0.9962,0.5718,0.602,0.1693,0.5204,0.2984,0.4207,0.3621,0.3504,0.8358,0.9019,0.5015,0.6305,0.2338,0.7503,0.2477,0.0889,0.3009,0.7008,0.1753,0.536,0.8448,0.5158,0.4558,0.1379,0.1058,0.5621,0.9195,0.7746,0.6348,0.2624,0.9237,0.1858,0.1238,0.906,0.4925,0.0565,0.5554,0.9787,0.5396,0.0525,0.3886,0.1161,0.5098,0.4076,0.022,0.8934,0.282,0.0038,0.3583,0.5609,0.1602,0.769,0.3927,0.9663,0.9741,0.8295,0.8214,0.779,0.5682,0.3759,0.527,0.7909,0.3374,0.616,0.9831,0.9156,0.9911,0.7452,0.1999,0.347,0.6614,0.655,0.0197,0.3961,0.4226,0.2272,0.6663,0.207,0.1673,0.1853,0.0941,0.5243,0.2482,0.7186,0.642,0.706,0.9647,0.5175,0.0798,0.0601,0.6073,0.5372,0.8604,0.3363,0.1873,0.9841,0.4377,0.3664,0.061,0.147,0.9566,0.2383,0.5969,0.3432,0.8829,0.032,0.8608,0.7995,0.948,0.5933,0.9842,0.806,0.4807,0.4171,0.2773,0.1262,0.9026,0.1137,0.9723,0.132,0.4631,0.5986,0.8374,0.3888,0.9394,0.6019,0.1369,0.2202,0.3148,0.4662,0.9296,0.0907,0.6469,0.033,0.9962,0.587,0.9527,0.2237,0.0071,0.2115,0.2268,0.2973,0.5017,0.9399,0.0309,0.5112,0.778,0.0362,0.2615,0.2946,0.1786,0.5988,0.3189,0.8859,0.0393,0.1864,0.8533,0.5735,0.378,0.3522,0.2027,0.2095,0.4533,0.5896,0.9378,0.3571,0.2122,0.231,0.4372,0.0288,0.7943,0.6436,0.3919,0.0935,0.1234,0.4017,0.961,0.902,0.2233,0.3861,0.9983,0.2843,0.8745,0.564,0.9906,0.973,0.965,0.9197,0.9643,0.6304,0.0128,0.9945,0.7792,0.1622,0.8361,0.1768,0.7861,0.665,0.8178,0.2723,0.0565,0.2705,0.295,0.0543,0.857,0.4013,0.8637,0.8539,0.5792,0.0902,0.7298,0.4677,0.6682,0.9904,0.846,0.8193,0.5249,0.9679,0.7844,0.9924,0.4046,0.9955,0.7426,0.4901,0.2827,0.9705,0.5115,0.8054,0.2301,0.1393,0.0309,0.8952,0.4307,0.9681,0.2521,0.117,0.7071,0.9589,0.1849,0.1657,0.967,0.4132,0.2708,0.9405,0.1847,0.7256,0.2279,0.0047,0.814,0.7662,0.2313,0.5418,0.7307,0.2052,0.7382,0.9217,0.8333,0.2903,0.5984,0.6508,0.9333,0.4921,0.0656,0.6176,0.0778,0.8256,0.19,0.3603,0.6979,0.5535,0.7474,0.0136,0.6474,0.0146,0.6908,0.4223,0.128,0.62,0.7711,0.2154,0.4179,0.6709,0.1573,0.9793,0.6647,0.9014,0.184,0.1811,0.0414,0.1114,0.3554,0.3304,0.3096,0.1929,0.5236,0.3454,0.9069,0.6013,0.1365,0.196,0.4833,0.9505,0.1637,0.4061,0.6695,0.9196,0.6321,0.3434,0.4125,0.2168,0.1841,0.6056,0.6224,0.9239,0.6534,0.6417,0.7518,0.5852,0.4267,0.5963,0.893,0.3837,0.7029,0.5704,0.6841,0.9977,0.4975,0.7675,0.03,0.9407,0.8727,0.3494,0.2449,0.7287,0.3689,0.5548,0.2999,0.3628,0.5529,0.5983,0.1791,0.4989,0.1224,0.3602,0.5331,0.1259,0.5033,0.692,0.3603,0.0828,0.6707,0.5139,0.6611,0.7299,0.3294,0.5233,0.644,0.0275,0.3735,0.0327,0.6867,0.9614,0.9071,0.8429,0.0437,0.9022,0.163,0.3901,0.7798,0.1763,0.2758,0.6319,0.5418,0.2334,0.814,0.7273,0.2996,0.6528,0.258,0.2605,0.6483,0.2735,0.6197,0.2504,0.0007,0.1986,0.0542,0.0009,0.7913,0.054,0.4527,0.7578,0.6513,0.3886,0.1877,0.5692,0.8555,0.5379,0.7335,0.0178,0.9356,0.911,0.0794,0.8409,0.5565,0.3647,0.7331,0.6024,0.2686,0.5374,0.6208,0.3062,0.225,0.0752,0.9436,0.8129,0.937,0.0614,0.3874,0.1012,0.2642,0.0991,0.9921,0.3878,0.984,0.3045,0.1093,0.2371,0.1336,0.8526,0.9211,0.253,0.4356,0.7099,0.0197,0.0254,0.6261,0.4186,0.8469,0.5217,0.1412,0.0886,0.9888,0.4031,0.5484,0.654,0.5484,0.142,0.1997,0.4361,0.517,0.0033,0.8016,0.0842,0.4959,0.9188,0.0817,0.0991,0.5077,0.4932,0.6168,0.0845,0.7196,0.2545,0.6583,0.6148,0.2423,0.1085,0.5137,0.6271,0.1722,0.0561,0.2821,0.3206,0.8083,0.6649,0.2702,0.3547,0.7364,0.9051,0.8243,0.8606,0.0094,0.2178,0.5191,0.4262,0.6358,0.7801,0.4409,0.9581,0.8047,0.1001,0.1724,0.8253,0.2179,0.7597,0.6407,0.057,0.2326,0.5405,0.7638,0.854,0.8958,0.0235,0.7134,0.0543,0.9444,0.4931,0.3116,0.8327,0.7898,0.7226,0.1667,0.9594,0.65,0.8951,0.3437,0.1459,0.0228,0.0391,0.098,0.9156,0.528,0.1173,0.9645,0.4434,0.5055,0.6638,0.0335,0.4147,0.5025,0.6798,0.6675,0.9734,0.4492,0.6923,0.9131,0.2059,0.3165,0.6967,0.4913,0.1753,0.2386,0.0259,0.4518,0.0353,0.4986,0.5216,0.3568,0.024,0.6956,0.4964,0.5682,0.7127,0.7743,0.1204,0.2914,0.0547,0.9108,0.1839,0.0939,0.3339,0.0592,0.4977,0.1903,0.9765,0.9401,0.0763,0.4125,0.2576,0.01,0.5942,0.3745,0.1088,0.106,0.0653,0.6205,0.2466,0.0982,0.0988,0.4912,0.1028,0.0755,0.3333,0.2124,0.776,0.489,0.1004,0.9204,0.7195,0.4756,0.4751,0.8975,0.8463,0.2416,0.0188,0.3189,0.0599,0.7176,0.6894,0.9623,0.4506,0.7801,0.5017,0.9005,0.1221,0.5351,0.8356,0.0913,0.996,0.2322,0.6234,0.2609,0.6762,0.4936,0.5747,0.7744,0.5237,0.2035,0.7701,0.2106,0.5455,0.6789,0.7131,0.6042,0.8505,0.5766,0.8601,0.8399,0.2552,0.7087,0.7577,0.649,0.5005,0.4263,0.7755,0.2704,0.3145,0.9777,0.6466,0.7438,0.259,0.5773,0.1169,0.9047,0.7248,0.4959,0.5204,0.1506,0.9856,0.9833,0.5429,0.1261,0.4021,0.9569,0.8185,0.0618,0.7924,0.5985,0.7281,0.9464,0.1901,0.8617,0.0603,0.6653,0.772,0.1819,0.2756,0.9246,0.8826,0.2985,0.5251,0.3469,0.8978,0.5927,0.9831,0.0207,0.7613,0.0097,0.9199,0.1731,0.1905,0.5844,0.1719,0.4734,0.3232,0.4713,0.9303,0.8719,0.7181,0.698,0.3627,0.4811,0.5401,0.6284,0.3349,0.3915,0.9336,0.6537,0.5271,0.9984,0.7254,0.1889,0.3242,0.5167,0.3961,0.9136,0.4254,0.9728,0.5778,0.9145,0.6445,0.0638,0.4879,0.2942,0.863,0.3528,0.3257,0.068,0.0304,0.8898,0.9628,0.0254,0.3503,0.7232,0.3838,0.7468,0.2578,0.1519,0.1805,0.5599,0.5648,0.2502,0.9422,0.2464,0.7021,0.434,0.379,0.302,0.7973,0.1471,0.2193,0.4781,0.0456,0.271,0.4043,0.3889,0.7489,0.2491,0.0584,0.3949,0.262,0.0617,0.2066,0.7288,0.6119,0.4997,0.5121,0.341,0.4196,0.6225,0.2717,0.0471,0.6528,0.6431,0.6572,0.3964,0.1752,0.6389,0.3248,0.5306,0.2951,0.6605,0.6998,0.1602,0.3088,0.1834,0.0387,0.5433,0.1844,0.3644,0.8131,0.1226,0.6514,0.659,0.6611,0.9057,0.9264,0.2283,0.9372,0.8349,0.4975,0.2611,0.2672,0.9658,0.9656,0.903,0.494,0.9086,0.5009,0.5242,0.8242,0.2446,0.298,0.7044,0.037,0.3557,0.1313,0.4765,0.1302,0.6483,0.7797,0.4959,0.7098,0.2591,0.8359,0.9309,0.7457,0.2046,0.2309,0.9056,0.2939,0.5962,0.9252,0.1705,0.1218,0.5513,0.2614,0.7805,0.9754,0.4859,0.6419,0.0594,0.129,0.4364,0.9281,0.8461,0.8533,0.4539,0.2089,0.1412,0.25,0.6719,0.1983,0.6667,0.2046,0.4034,0.2485,0.6287,0.4075,0.0607,0.9897,0.2531,0.2347,0.4273,0.7997,0.9187,0.3391,0.6128,0.4024,0.5584,0.7529,0.5835,0.858,0.7139,0.4174,0.5587,0.1445,0.9233,0.5346,0.0969,0.5732,0.9152,0.2459,0.3743,0.096,0.3948,0.9085,0.3693,0.7587,0.0179,0.5386,0.7683,0.2799,0.4868,0.5007,0.5961,0.7044,0.2414,0.1251,0.3727,0.1722,0.5408,0.2432,0.9644,0.0102,0.7435,0.8068,0.3883,0.8687,0.2475,0.7832,0.7655,0.0784,0.0257,0.7326,0.5464,0.5718,0.1549,0.5702,0.5093,0.597,0.6289,0.7532,0.4341,0.4413,0.9892,0.0834,0.1586,0.1008,0.5682,0.3555,0.6543,0.4208,0.0399,0.7715,0.7993,0.5526,0.7303,0.7853,0.0214,0.2307,0.7544,0.6372,0.9855,0.4738,0.0381,0.2648,0.249,0.6949,0.2459,0.4967,0.5293,0.8507,0.9462,0.234,0.9725,0.3204,0.7317,0.7643,0.8025,0.1239,0.5495,0.116,0.9587,0.3266,0.1185,0.344,0.4129,0.5487,0.1975,0.8806,0.5332,0.2301,0.539,0.4952,0.7787,0.8787,0.9954,0.1674,0.3881,0.3711,0.1705,0.7377,0.6522,0.9661,0.051,0.6083,0.6312,0.0365,0.3138,0.9904,0.0248,0.9863,0.7908,0.9515,0.2417,0.8175,0.7496,0.8708,0.4591,0.3914,0.7887,0.6268,0.3048,0.3682,0.1907,0.0401,0.9907,0.2971,0.8136,0.2706,0.1675,0.0657,0.1123,0.2242,0.2413,0.3702,0.9842,0.1505,0.0537,0.2089,0.2317,0.5058]	[0.7932,0.7768,0.6111,0.0587,0.756,0.4649,0.9622,0.7569,0.8332,0.6767,0.6768,0.2552,0.3842,0.6569,0.0287,0.5607,0.7718,0.4639,0.2571,0.706,0.9365,0.765,0.907,0.9605,0.2091,0.2187,0.8914,0.971,0.9561,0.0845,0.4133,0.3408,0.8828,0.0012,0.9179,0.0215,0.7394,0.105,0.7342,0.2362,0.9781,0.0083,0.1161,0.1761,0.7951,0.6544,0.4444,0.7964,0.8878,0.8724,0.55,0.5608,0.2809,0.7798,0.5809,0.5963,0.9524,0.46,0.8613,0.8575,0.0592,0.5969,0.8713,0.99,0.9297,0.4484,0.8832,0.8043,0.4933,0.5116,0.7794,0.6896,0.1341,0.025,0.4198,0.3951,0.8369,0.5584,0.8426,0.6663,0.2667,0.757,0.4991,0.5696,0.1122,0.3684,0.2484,0.0956,0.9957,0.2471,0.1539,0.6812,0.9056,0.7484,0.8522,0.2475,0.5771,0.4299,0.8424,0.3812,0.2829,0.8421,0.7817,0.1509,0.7882,0.6512,0.6082,0.5749,0.5896,0.8188,0.0386,0.0526,0.268,0.7769,0.2528,0.4796,0.5997,0.2056,0.7819,0.3483,0.5614,0.1418,0.6469,0.3838,0.9221,0.6273,0.9909,0.0117,0.3403,0.6969,0.5956,0.1576,0.3727,0.7894,0.417,0.7379,0.3723,0.0491,0.259,0.2638,0.1637,0.9748,0.5431,0.5403,0.0237,0.0903,0.36,0.1858,0.8645,0.5666,0.4215,0.8919,0.1936,0.2115,0.4309,0.1856,0.5358,0.7021,0.4275,0.736,0.9466,0.6911,0.2638,0.2865,0.9832,0.5547,0.3478,0.2153,0.373,0.565,0.6531,0.2781,0.5461,0.8748,0.1563,0.956,0.6391,0.28,0.7255,0.6577,0.2825,0.3079,0.2939,0.8459,0.6549,0.3919,0.3298,0.7384,0.2751,0.0608,0.0813,0.172,0.8677,0.8395,0.0465,0.778,0.9066,0.0118,0.6321,0.9263,0.3142,0.0867,0.1111,0.4958,0.2325,0.6455,0.3622,0.238,0.4918,0.9162,0.339,0.2226,0.1044,0.6129,0.1563,0.3323,0.3111,0.4729,0.9125,0.4274,0.0154,0.666,0.4718,0.8868,0.3379,0.0551,0.5399,0.0389,0.3677,0.047,0.6141,0.4898,0.0566,0.8107,0.1206,0.4711,0.7024,0.6086,0.1194,0.6738,0.9188,0.6608,0.2634,0.0318,0.914,0.5283,0.1446,0.8245,0.0972,0.7369,0.6678,0.0939,0.303,0.0733,0.0675,0.8532,0.4038,0.9309,0.9995,0.9311,0.2718,0.8613,0.5239,0.841,0.1876,0.3517,0.168,0.5323,0.8268,0.8336,0.7018,0.1969,0.5816,0.2615,0.8066,0.9582,0.5654,0.9662,0.9113,0.3662,0.8343,0.8029,0.3844,0.54,0.6585,0.8565,0.9451,0.1232,0.9477,0.1214,0.0366,0.9022,0.6632,0.1445,0.7236,0.3548,0.3213,0.665,0.4897,0.7067,0.0911,0.0271,0.5003,0.9574,0.6597,0.7675,0.5927,0.8076,0.465,0.4357,0.1228,0.2173,0.8717,0.1713,0.9744,0.9371,0.3773,0.7912,0.6729,0.4595,0.8141,0.1105,0.7061,0.38,0.0237,0.8324,0.5918,0.3335,0.6614,0.6166,0.1514,0.8871,0.6919,0.5197,0.4602,0.8401,0.8813,0.0725,0.5984,0.8588,0.2378,0.1054,0.2293,0.6148,0.3114,0.7465,0.0798,0.6838,0.9107,0.9196,0.3008,0.2273,0.0808,0.85,0.7855,0.2425,0.7904,0.8469,0.9967,0.7735,0.5148,0.4339,0.9323,0.944,0.1149,0.7827,0.6671,0.8096,0.4002,0.8376,0.9611,0.5061,0.1647,0.4458,0.6166,0.3535,0.0065,0.9513,0.8175,0.7517,0.984,0.3444,0.7953,0.6832,0.0724,0.9574,0.1154,0.1745,0.494,0.6169,0.4821,0.3837,0.2159,0.7729,0.0925,0.7408,0.6921,0.1925,0.2554,0.2709,0.1563,0.5078,0.9235,0.5357,0.5991,0.4065,0.1187,0.0522,0.1366,0.6106,0.4973,0.3232,0.4482,0.8234,0.5892,0.6901,0.3968,0.7621,0.8868,0.5086,0.7605,0.7778,0.7996,0.3539,0.2013,0.8755,0.8107,0.9302,0.9244,0.0737,0.8797,0.8922,0.0581,0.8093,0.4365,0.4579,0.7797,0.0257,0.9572,0.3899,0.1904,0.4203,0.5464,0.8023,0.205,0.5966,0.9714,0.3564,0.8535,0.659,0.583,0.6063,0.176,0.8202,0.798,0.4618,0.2765,0.7359,0.3636,0.366,0.2627,0.1268,0.4392,0.9744,0.0895,0.9894,0.4437,0.1701,0.055,0.6912,0.5191,0.9463,0.903,0.537,0.7457,0.0845,0.3032,0.3684,0.2521,0.6431,0.8471,0.2452,0.1405,0.5723,0.3997,0.5362,0.292,0.932,0.3913,0.2592,0.5675,0.4274,0.8254,0.0662,0.78,0.3609,0.2654,0.4391,0.0653,0.0004,0.4245,0.8238,0.4219,0.6095,0.1996,0.0661,0.6007,0.1328,0.2987,0.5222,0.1267,0.4781,0.3354,0.7599,0.0036,0.2297,0.2718,0.0701,0.0195,0.113,0.8472,0.9962,0.5718,0.602,0.1693,0.5204,0.2984,0.4207,0.3621,0.3504,0.8358,0.9019,0.5015,0.6305,0.2338,0.7503,0.2477,0.0889,0.3009,0.7008,0.1753,0.536,0.8448,0.5158,0.4558,0.1379,0.1058,0.5621,0.9195,0.7746,0.6348,0.2624,0.9237,0.1858,0.1238,0.906,0.4925,0.0565,0.5554,0.9787,0.5396,0.0525,0.3886,0.1161,0.5098,0.4076,0.022,0.8934,0.282,0.0038,0.3583,0.5609,0.1602,0.769,0.3927,0.9663,0.9741,0.8295,0.8214,0.779,0.5682,0.3759,0.527,0.7909,0.3374,0.616,0.9831,0.9156,0.9911,0.7452,0.1999,0.347,0.6614,0.655,0.0197,0.3961,0.4226,0.2272,0.6663,0.207,0.1673,0.1853,0.0941,0.5243,0.2482,0.7186,0.642,0.706,0.9647,0.5175,0.0798,0.0601,0.6073,0.5372,0.8604,0.3363,0.1873,0.9841,0.4377,0.3664,0.061,0.147,0.9566,0.2383,0.5969,0.3432,0.8829,0.032,0.8608,0.7995,0.948,0.5933,0.9842,0.806,0.4807,0.4171,0.2773,0.1262,0.9026,0.1137,0.9723,0.132,0.4631,0.5986,0.8374,0.3888,0.9394,0.6019,0.1369,0.2202,0.3148,0.4662,0.9296,0.0907,0.6469,0.033,0.9962,0.587,0.9527,0.2237,0.0071,0.2115,0.2268,0.2973,0.5017,0.9399,0.0309,0.5112,0.778,0.0362,0.2615,0.2946,0.1786,0.5988,0.3189,0.8859,0.0393,0.1864,0.8533,0.5735,0.378,0.3522,0.2027,0.2095,0.4533,0.5896,0.9378,0.3571,0.2122,0.231,0.4372,0.0288,0.7943,0.6436,0.3919,0.0935,0.1234,0.4017,0.961,0.902,0.2233,0.3861,0.9983,0.2843,0.8745,0.564,0.9906,0.973,0.965,0.9197,0.9643,0.6304,0.0128,0.9945,0.7792,0.1622,0.8361,0.1768,0.7861,0.665,0.8178,0.2723,0.0565,0.2705,0.295,0.0543,0.857,0.4013,0.8637,0.8539,0.5792,0.0902,0.7298,0.4677,0.6682,0.9904,0.846,0.8193,0.5249,0.9679,0.7844,0.9924,0.4046,0.9955,0.7426,0.4901,0.2827,0.9705,0.5115,0.8054,0.2301,0.1393,0.0309,0.8952,0.4307,0.9681,0.2521,0.117,0.7071,0.9589,0.1849,0.1657,0.967,0.4132,0.2708,0.9405,0.1847,0.7256,0.2279,0.0047,0.814,0.7662,0.2313,0.5418,0.7307,0.2052,0.7382,0.9217,0.8333,0.2903,0.5984,0.6508,0.9333,0.4921,0.0656,0.6176,0.0778,0.8256,0.19,0.3603,0.6979,0.5535,0.7474,0.0136,0.6474,0.0146,0.6908,0.4223,0.128,0.62,0.7711,0.2154,0.4179,0.6709,0.1573,0.9793,0.6647,0.9014,0.184,0.1811,0.0414,0.1114,0.3554,0.3304,0.3096,0.1929,0.5236,0.3454,0.9069,0.6013,0.1365,0.196,0.4833,0.9505,0.1637,0.4061,0.6695,0.9196,0.6321,0.3434,0.4125,0.2168,0.1841,0.6056,0.6224,0.9239,0.6534,0.6417,0.7518,0.5852,0.4267,0.5963,0.893,0.3837,0.7029,0.5704,0.6841,0.9977,0.4975,0.7675,0.03,0.9407,0.8727,0.3494,0.2449,0.7287,0.3689,0.5548,0.2999,0.3628,0.5529,0.5983,0.1791,0.4989,0.1224,0.3602,0.5331,0.1259,0.5033,0.692,0.3603,0.0828,0.6707,0.5139,0.6611,0.7299,0.3294,0.5233,0.644,0.0275,0.3735,0.0327,0.6867,0.9614,0.9071,0.8429,0.0437,0.9022,0.163,0.3901,0.7798,0.1763,0.2758,0.6319,0.5418,0.2334,0.814,0.7273,0.2996,0.6528,0.258,0.2605,0.6483,0.2735,0.6197,0.2504,0.0007,0.1986,0.0542,0.0009,0.7913,0.054,0.4527,0.7578,0.6513,0.3886,0.1877,0.5692,0.8555,0.5379,0.7335,0.0178,0.9356,0.911,0.0794,0.8409,0.5565,0.3647,0.7331,0.6024,0.2686,0.5374,0.6208,0.3062,0.225,0.0752,0.9436,0.8129,0.937,0.0614,0.3874,0.1012,0.2642,0.0991,0.9921,0.3878,0.984,0.3045,0.1093,0.2371,0.1336,0.8526,0.9211,0.253,0.4356,0.7099,0.0197,0.0254,0.6261,0.4186,0.8469,0.5217,0.1412,0.0886,0.9888,0.4031,0.5484,0.654,0.5484,0.142,0.1997,0.4361,0.517,0.0033,0.8016,0.0842,0.4959,0.9188,0.0817,0.0991,0.5077,0.4932,0.6168,0.0845,0.7196,0.2545,0.6583,0.6148,0.2423,0.1085,0.5137,0.6271,0.1722,0.0561,0.2821,0.3206,0.8083,0.6649,0.2702,0.3547,0.7364,0.9051,0.8243,0.8606,0.0094,0.2178,0.5191,0.4262,0.6358,0.7801,0.4409,0.9581,0.8047,0.1001,0.1724,0.8253,0.2179,0.7597,0.6407,0.057,0.2326,0.5405,0.7638,0.854,0.8958,0.0235,0.7134,0.0543,0.9444,0.4931,0.3116,0.8327,0.7898,0.7226,0.1667,0.9594,0.65,0.8951,0.3437,0.1459,0.0228,0.0391,0.098,0.9156,0.528,0.1173,0.9645,0.4434,0.5055,0.6638,0.0335,0.4147,0.5025,0.6798,0.6675,0.9734,0.4492,0.6923,0.9131,0.2059,0.3165,0.6967,0.4913,0.1753,0.2386,0.0259,0.4518,0.0353,0.4986,0.5216,0.3568,0.024,0.6956,0.4964,0.5682,0.7127,0.7743,0.1204,0.2914,0.0547,0.9108,0.1839,0.0939,0.3339,0.0592,0.4977,0.1903,0.9765,0.9401,0.0763,0.4125,0.2576,0.01,0.5942,0.3745,0.1088,0.106,0.0653,0.6205,0.2466,0.0982,0.0988,0.4912,0.1028,0.0755,0.3333,0.2124,0.776,0.489,0.1004,0.9204,0.7195,0.4756,0.4751,0.8975,0.8463,0.2416,0.0188,0.3189,0.0599,0.7176,0.6894,0.9623,0.4506,0.7801,0.5017,0.9005,0.1221,0.5351,0.8356,0.0913,0.996,0.2322,0.6234,0.2609,0.6762,0.4936,0.5747,0.7744,0.5237,0.2035,0.7701,0.2106,0.5455,0.6789,0.7131,0.6042,0.8505,0.5766,0.8601,0.8399,0.2552,0.7087,0.7577,0.649,0.5005,0.4263,0.7755,0.2704,0.3145,0.9777,0.6466,0.7438,0.259,0.5773,0.1169,0.9047,0.7248,0.4959,0.5204,0.1506,0.9856,0.9833,0.5429,0.1261,0.4021,0.9569,0.8185,0.0618,0.7924,0.5985,0.7281,0.9464,0.1901,0.8617,0.0603,0.6653,0.772,0.1819,0.2756,0.9246,0.8826,0.2985,0.5251,0.3469,0.8978,0.5927,0.9831,0.0207,0.7613,0.0097,0.9199,0.1731,0.1905,0.5844,0.1719,0.4734,0.3232,0.4713,0.9303,0.8719,0.7181,0.698,0.3627,0.4811,0.5401,0.6284,0.3349,0.3915,0.9336,0.6537,0.5271,0.9984,0.7254,0.1889,0.3242,0.5167,0.3961,0.9136,0.4254,0.9728,0.5778,0.9145,0.6445,0.0638,0.4879,0.2942,0.863,0.3528,0.3257,0.068,0.0304,0.8898,0.9628,0.0254,0.3503,0.7232,0.3838,0.7468,0.2578,0.1519,0.1805,0.5599,0.5648,0.2502,0.9422,0.2464,0.7021,0.434,0.379,0.302,0.7973,0.1471,0.2193,0.4781,0.0456,0.271,0.4043,0.3889,0.7489,0.2491,0.0584,0.3949,0.262,0.0617,0.2066,0.7288,0.6119,0.4997,0.5121,0.341,0.4196,0.6225,0.2717,0.0471,0.6528,0.6431,0.6572,0.3964,0.1752,0.6389,0.3248,0.5306,0.2951,0.6605,0.6998,0.1602,0.3088,0.1834,0.0387,0.5433,0.1844,0.3644,0.8131,0.1226,0.6514,0.659,0.6611,0.9057,0.9264,0.2283,0.9372,0.8349,0.4975,0.2611,0.2672,0.9658,0.9656,0.903,0.494,0.9086,0.5009,0.5242,0.8242,0.2446,0.298,0.7044,0.037,0.3557,0.1313,0.4765,0.1302,0.6483,0.7797,0.4959,0.7098,0.2591,0.8359,0.9309,0.7457,0.2046,0.2309,0.9056,0.2939,0.5962,0.9252,0.1705,0.1218,0.5513,0.2614,0.7805,0.9754,0.4859,0.6419,0.0594,0.129,0.4364,0.9281,0.8461,0.8533,0.4539,0.2089,0.1412,0.25,0.6719,0.1983,0.6667,0.2046,0.4034,0.2485,0.6287,0.4075,0.0607,0.9897,0.2531,0.2347,0.4273,0.7997,0.9187,0.3391,0.6128,0.4024,0.5584,0.7529,0.5835,0.858,0.7139,0.4174,0.5587,0.1445,0.9233,0.5346,0.0969,0.5732,0.9152,0.2459,0.3743,0.096,0.3948,0.9085,0.3693,0.7587,0.0179,0.5386,0.7683,0.2799,0.4868,0.5007,0.5961,0.7044,0.2414,0.1251,0.3727,0.1722,0.5408,0.2432,0.9644,0.0102,0.7435,0.8068,0.3883,0.8687,0.2475,0.7832,0.7655,0.0784,0.0257,0.7326,0.5464,0.5718,0.1549,0.5702,0.5093,0.597,0.6289,0.7532,0.4341,0.4413,0.9892,0.0834,0.1586,0.1008,0.5682,0.3555,0.6543,0.4208,0.0399,0.7715,0.7993,0.5526,0.7303,0.7853,0.0214,0.2307,0.7544,0.6372,0.9855,0.4738,0.0381,0.2648,0.249,0.6949,0.2459,0.4967,0.5293,0.8507,0.9462,0.234,0.9725,0.3204,0.7317,0.7643,0.8025,0.1239,0.5495,0.116,0.9587,0.3266,0.1185,0.344,0.4129,0.5487,0.1975,0.8806,0.5332,0.2301,0.539,0.4952,0.7787,0.8787,0.9954,0.1674,0.3881,0.3711,0.1705,0.7377,0.6522,0.9661,0.051,0.6083,0.6312,0.0365,0.3138,0.9904,0.0248,0.9863,0.7908,0.9515,0.2417,0.8175,0.7496,0.8708,0.4591,0.3914,0.7887,0.6268,0.3048,0.3682,0.1907,0.0401,0.9907,0.2971,0.8136,0.2706,0.1675,0.0657,0.1123,0.2242,0.2413,0.3702,0.9842,0.1505,0.0537,0.2089,0.2317,0.5058]	0.2	0.7	2025-11-10 21:26:06.992169+00	0.84
9	[0.517,0.7961,0.9238,0.8681,0.0324,0.4841,0.7494,0.0939,0.7064,0.8942,0.8001,0.6695,0.8885,0.0962,0.0903,0.0104,0.4858,0.5093,0.5296,0.529,0.9663,0.7624,0.1238,0.3525,0.3268,0.1429,0.1628,0.7679,0.3946,0.0783,0.6313,0.388,0.4325,0.04,0.7377,0.7935,0.8907,0.6393,0.8601,0.7902,0.6125,0.2918,0.114,0.5005,0.2545,0.1484,0.9526,0.6197,0.1779,0.1127,0.8055,0.0915,0.8882,0.814,0.3166,0.3323,0.4353,0.5818,0.6666,0.4002,0.5497,0.9865,0.8537,0.538,0.5112,0.6513,0.0795,0.4796,0.6787,0.08,0.0776,0.6363,0.3848,0.9547,0.7085,0.7153,0.0002,0.7227,0.559,0.7606,0.5901,0.7308,0.8961,0.2081,0.2217,0.4406,0.3782,0.4254,0.4677,0.1503,0.0547,0.2021,0.165,0.0225,0.4351,0.4414,0.4832,0.8888,0.2563,0.756,0.4456,0.4054,0.3392,0.7435,0.4484,0.0954,0.5929,0.9535,0.9328,0.3147,0.7851,0.0391,0.6731,0.0592,0.5489,0.0163,0.58,0.6059,0.8714,0.3408,0.3069,0.5455,0.1225,0.939,0.9112,0.2643,0.8185,0.4575,0.643,0.5292,0.7791,0.1809,0.6935,0.9795,0.9181,0.6686,0.2603,0.8446,0.1114,0.9916,0.6181,0.9651,0.1912,0.1968,0.2768,0.8154,0.5663,0.2223,0.6055,0.8466,0.6664,0.9412,0.4438,0.3565,0.2102,0.7576,0.5679,0.9033,0.4179,0.4372,0.3278,0.8358,0.2903,0.7609,0.8609,0.9046,0.4362,0.7857,0.4633,0.3414,0.4335,0.4459,0.0184,0.006,0.6391,0.7714,0.1125,0.9744,0.7762,0.5936,0.9478,0.1837,0.2883,0.0816,0.5535,0.7804,0.8027,0.7338,0.5863,0.8036,0.6207,0.1119,0.6551,0.3278,0.6885,0.5396,0.708,0.655,0.1879,0.7092,0.4218,0.2279,0.8271,0.4104,0.6541,0.4748,0.6591,0.7988,0.585,0.6518,0.546,0.4846,0.1152,0.2594,0.8067,0.1657,0.8463,0.2299,0.1067,0.1147,0.1619,0.4044,0.1712,0.9239,0.8649,0.245,0.7163,0.2263,0.7574,0.0836,0.4134,0.0618,0.2245,0.274,0.3144,0.0108,0.7455,0.3155,0.8442,0.4462,0.6949,0.8565,0.8388,0.1741,0.0246,0.2611,0.7486,0.4997,0.8968,0.9602,0.3216,0.6434,0.9992,0.0544,0.5791,0.808,0.3206,0.6323,0.6669,0.476,0.7849,0.2131,0.8667,0.4959,0.1591,0.0501,0.833,0.1998,0.5517,0.5788,0.2803,0.2513,0.675,0.3509,0.6109,0.5005,0.8699,0.1454,0.8688,0.1999,0.7501,0.7573,0.8315,0.2777,0.3292,0.7336,0.1214,0.1933,0.9371,0.208,0.6482,0.9136,0.3563,0.9443,0.7165,0.1225,0.7975,0.2977,0.1861,0.5557,0.0465,0.1822,0.8113,0.3072,0.3347,0.1794,0.0531,0.8465,0.7903,0.2047,0.8992,0.8302,0.132,0.7305,0.0086,0.6155,0.3035,0.4512,0.7356,0.7055,0.9489,0.8684,0.7669,0.7471,0.9084,0.077,0.0293,0.0695,0.3154,0.4711,0.017,0.7416,0.9613,0.9805,0.3238,0.1977,0.2988,0.6887,0.5265,0.1784,0.7619,0.4422,0.5259,0.4034,0.7135,0.1788,0.422,0.8706,0.2012,0.0876,0.484,0.3536,0.6172,0.6628,0.8737,0.664,0.0257,0.7956,0.7189,0.6111,0.0246,0.781,0.3806,0.4485,0.5758,0.4611,0.0433,0.296,0.0056,0.058,0.1141,0.1042,0.2622,0.2894,0.9359,0.0512,0.2002,0.2004,0.1422,0.7356,0.8777,0.7037,0.3095,0.6465,0.1168,0.1013,0.7072,0.1366,0.3165,0.9382,0.8536,0.429,0.2721,0.0823,0.3404,0.5393,0.4437,0.8917,0.0789,0.3704,0.5644,0.4187,0.8681,0.0001,0.0478,0.745,0.9953,0.5987,0.8363,0.1828,0.8005,0.7553,0.8391,0.4866,0.8166,0.6884,0.9499,0.6606,0.4979,0.4884,0.4745,0.3852,0.3627,0.5691,0.9852,0.028,0.8494,0.7923,0.8627,0.8012,0.9428,0.9141,0.1873,0.8407,0.854,0.8121,0.0197,0.8088,0.9134,0.4903,0.5165,0.9934,0.9593,0.041,0.6957,0.7028,0.4743,0.5919,0.0843,0.4988,0.5507,0.4349,0.6104,0.19,0.4037,0.3814,0.1621,0.5044,0.6189,0.5577,0.3693,0.4137,0.4464,0.8125,0.4754,0.1939,0.0596,0.9728,0.6172,0.379,0.4723,0.913,0.3743,0.9069,0.5492,0.5023,0.9058,0.4875,0.3306,0.2044,0.1431,0.8459,0.2201,0.513,0.8322,0.7054,0.5364,0.8151,0.9637,0.7479,0.556,0.5895,0.6742,0.663,0.751,0.5088,0.7554,0.8648,0.1866,0.6573,0.3258,0.8031,0.4653,0.737,0.8389,0.0579,0.2986,0.6904,0.2371,0.0739,0.1886,0.0149,0.4219,0.33,0.6282,0.7156,0.5953,0.9047,0.2936,0.4655,0.8231,0.8051,0.8808,0.3189,0.9284,0.2315,0.9559,0.5344,0.1423,0.0469,0.3203,0.5372,0.2157,0.2977,0.7924,0.9753,0.3761,0.5317,0.8169,0.3195,0.8554,0.9593,0.0916,0.8947,0.1244,0.8408,0.644,0.9307,0.5873,0.8309,0.5989,0.7331,0.6529,0.8132,0.6459,0.4092,0.6665,0.4604,0.1484,0.5514,0.6368,0.7762,0.2538,0.7291,0.0387,0.6022,0.821,0.2942,0.6309,0.8105,0.4215,0.7438,0.5235,0.4966,0.7863,0.4263,0.3328,0.4864,0.938,0.3407,0.7724,0.1635,0.444,0.7661,0.6799,0.6663,0.2197,0.9128,0.1473,0.6907,0.0883,0.4529,0.4067,0.9794,0.9732,0.248,0.0673,0.6469,0.4425,0.2494,0.389,0.9031,0.0456,0.5011,0.4512,0.046,0.8459,0.4759,0.4892,0.5851,0.6853,0.6775,0.1499,0.5442,0.2678,0.6427,0.9865,0.446,0.2702,0.8244,0.2725,0.5976,0.8042,0.469,0.827,0.6857,0.8305,0.5165,0.9858,0.2614,0.8251,0.8453,0.3069,0.5327,0.7955,0.5736,0.4801,0.4177,0.5139,0.4789,0.8048,0.115,0.0292,0.601,0.8207,0.6037,0.8234,0.2613,0.5298,0.3522,0.7151,0.1332,0.9941,0.4542,0.0485,0.6138,0.9644,0.8842,0.9027,0.5563,0.3539,0.0813,0.1731,0.3851,0.2234,0.0955,0.7816,0.7541,0.7971,0.8044,0.0902,0.0205,0.0953,0.2903,0.6554,0.1258,0.2982,0.6212,0.3473,0.1854,0.2974,0.7563,0.6681,0.8836,0.9538,0.4349,0.9602,0.5381,0.9455,0.3653,0.3244,0.9901,0.955,0.0798,0.1037,0.0336,0.9263,0.9607,0.8365,0.8365,0.1733,0.5319,0.6065,0.0096,0.812,0.0883,0.323,0.3867,0.8001,0.1163,0.3975,0.6423,0.0125,0.6668,0.796,0.9852,0.9045,0.0268,0.6826,0.3814,0.4515,0.88,0.6764,0.7661,0.3266,0.03,0.6816,0.5602,0.7075,0.5135,0.4097,0.3527,0.8822,0.756,0.2421,0.3053,0.5954,0.4109,0.7014,0.9304,0.0172,0.6538,0.5057,0.2548,0.1518,0.4384,0.0337,0.0829,0.7607,0.6042,0.1981,0.0193,0.2066,0.425,0.2705,0.9233,0.3838,0.2041,0.7612,0.561,0.6642,0.6321,0.0812,0.9065,0.6756,0.4398,0.4073,0.8033,0.9019,0.6629,0.276,0.2835,0.0977,0.1172,0.9408,0.5782,0.3699,0.1618,0.512,0.9865,0.7269,0.9017,0.78,0.5542,0.5365,0.7693,0.401,0.3162,0.5834,0.1889,0.8386,0.4622,0.1276,0.3147,0.7595,0.2284,0.5981,0.6883,0.1278,0.2878,0.0834,0.1794,0.5446,0.1737,0.3097,0.2252,0.4235,0.1164,0.4925,0.7132,0.3245,0.4091,0.1742,0.0052,0.7708,0.6028,0.6855,0.864,0.963,0.0948,0.2578,0.7865,0.0653,0.2711,0.0373,0.1652,0.471,0.0152,0.9765,0.0422,0.4107,0.5165,0.7602,0.6882,0.0056,0.2457,0.2865,0.8724,0.1254,0.6343,0.4795,0.7374,0.084,0.8021,0.2935,0.9306,0.724,0.2893,0.2167,0.2217,0.3608,0.6312,0.5212,0.8764,0.5512,0.2615,0.975,0.6884,0.5061,0.8707,0.4601,0.7883,0.2635,0.3181,0.2333,0.8721,0.5646,0.8374,0.2725,0.8092,0.9003,0.6501,0.5727,0.9291,0.3981,0.5651,0.6283,0.4402,0.2369,0.6394,0.5116,0.1954,0.5907,0.7486,0.6833,0.2693,0.937,0.1617,0.1078,0.7595,0.6326,0.5966,0.9516,0.2896,0.5376,0.5217,0.3026,0.3724,0.6326,0.1472,0.2451,0.7112,0.4369,0.5338,0.0834,0.4963,0.8729,0.1375,0.2854,0.1354,0.3623,0.8198,0.0947,0.9771,0.0049,0.3953,0.8256,0.5835,0.9689,0.0124,0.2494,0.0062,0.948,0.4576,0.2832,0.202,0.5608,0.3855,0.9447,0.2767,0.8858,0.7329,0.7702,0.5908,0.4413,0.9839,0.696,0.6658,0.5014,0.5108,0.8996,0.2682,0.0919,0.7381,0.7635,0.0583,0.2618,0.122,0.7253,0.5307,0.3663,0.3778,0.8487,0.8858,0.2875,0.976,0.7232,0.6139,0.2392,0.9539,0.8025,0.7408,0.1597,0.1736,0.7694,0.3265,0.3422,0.9308,0.0191,0.5224,0.3639,0.8181,0.263,0.9994,0.1596,0.3817,0.4329,0.5988,0.5497,0.9482,0.3605,0.4823,0.1646,0.7291,0.9586,0.5995,0.5287,0.4814,0.1623,0.3641,0.6146,0.0524,0.2397,0.6689,0.0801,0.0381,0.2347,0.216,0.727,0.1112,0.3469,0.5172,0.7909,0.4138,0.2942,0.1927,0.9681,0.992,0.7937,0.8892,0.2104,0.6336,0.5539,0.4619,0.8222,0.6554,0.6921,0.3016,0.2187,0.8375,0.3204,0.3047,0.4363,0.4843,0.1773,0.6318,0.154,0.7499,0.4381,0.842,0.2021,0.0206,0.6236,0.9514,0.0169,0.6661,0.1524,0.8711,0.6791,0.3627,0.909,0.1858,0.5713,0.999,0.6557,0.8514,0.6546,0.6425,0.3352,0.1457,0.0067,0.554,0.1835,0.1646,0.788,0.4814,0.6456,0.6793,0.5542,0.2993,0.818,0.662,0.5364,0.7862,0.02,0.9631,0.0203,0.2987,0.4105,0.3107,0.7706,0.03,0.5652,0.8936,0.2943,0.1596,0.4533,0.4323,0.2502,0.3967,0.0755,0.1915,0.3785,0.3515,0.8777,0.4332,0.9703,0.53,0.0605,0.6175,0.3068,0.4471,0.248,0.7387,0.3353,0.0826,0.0159,0.2084,0.7673,0.783,0.023,0.8603,0.9497,0.2968,0.6396,0.091,0.1986,0.531,0.2491,0.1927,0.793,0.3024,0.9208,0.6282,0.395,0.9056,0.8016,0.7958,0.4745,0.2626,0.6725,0.7444,0.6265,0.7801,0.751,0.6946,0.3923,0.2053,0.961,0.2602,0.5883,0.8071,0.4531,0.8742,0.6778,0.24,0.6286,0.5177,0.1194,0.5678,0.4183,0.4429,0.9789,0.2941,0.1196,0.3613,0.4482,0.031,0.6431,0.2987,0.019,0.5376,0.3026,0.7797,0.7003,0.2758,0.7218,0.5585,0.5517,0.5118,0.6568,0.8747,0.2954,0.0904,0.7774,0.0238,0.0377,0.3502,0.8473,0.9453,0.084,0.4216,0.0444,0.9693,0.0327,0.755,0.6578,0.6186,0.167,0.201,0.2991,0.8684,0.1293,0.1341,0.591,0.7438,0.823,0.6603,0.0391,0.0889,0.2117,0.394,0.3781,0.8487,0.895,0.799,0.7456,0.4039,0.6152,0.3415,0.1216,0.1868,0.6653,0.9074,0.7165,0.9137,0.9413,0.0748,0.6996,0.5486,0.5009,0.1795,0.8863,0.8111,0.6277,0.2227,0.7598,0.5089,0.2891,0.7941,0.0544,0.2553,0.6346,0.5781,0.7136,0.4992,0.0362,0.1749,0.7447,0.9242,0.3077,0.3888,0.8398,0.0157,0.7575,0.065,0.6508,0.2311,0.9732,0.8046,0.8995,0.46,0.9541,0.5871,0.9027,0.3318,0.3112,0.4987,0.2953,0.6288,0.9127,0.5491,0.0431,0.6613,0.3974,0.3508,0.0807,0.0336,0.4858,0.996,0.779,0.9454,0.2317,0.671,0.0002,0.2555,0.5406,0.4249,0.0955,0.0537,0.1822,0.0256,0.8618,0.0589,0.5801,0.1837,0.4944,0.1808,0.975,0.4968,0.546,0.2701,0.2952,0.9391,0.393,0.8861,0.8919,0.7196,0.5132,0.7409,0.5446,0.6131,0.6631,0.924,0.8936,0.8565,0.6984,0.2156,0.3617,0.7973,0.4954,0.0216,0.1737,0.4828,0.6029,0.807,0.2788,0.5383,0.4102,0.4288,0.0731,0.0788,0.4698,0.8453,0.5258,0.9759,0.5155,0.2796,0.8314,0.5042,0.7589,0.786,0.3514,0.6796,0.3009,0.1022,0.7102,0.2258,0.8008,0.4268,0.3103,0.5916,0.8454,0.9316,0.5143,0.5211,0.4006,0.5295,0.0102,0.5484,0.018,0.5742,0.8746,0.4809,0.8962,0.587,0.1724,0.9363,0.3464,0.3755,0.2924,0.2658,0.9115,0.4652,0.2464,0.4821,0.1226,0.4415,0.1312,0.0173,0.7752,0.7957,0.1921,0.668,0.3765,0.6957,0.9154,0.3893,0.8026,0.091,0.4295,0.6546,0.2993,0.9642,0.8489,0.2174,0.5896,0.0983,0.6493,0.351,0.955,0.9787,0.7386,0.6348,0.4468,0.4475,0.5682,0.0115,0.6625,0.5279,0.6176,0.6554,0.8711,0.824,0.0801,0.0763,0.6367,0.8147,0.2966,0.9062,0.6971,0.4497,0.0272,0.8905,0.984,0.64,0.8391,0.6337,0.9574,0.1789,0.294,0.0974,0.9945,0.7919,0.9623,0.8525,0.7095,0.2599,0.1855,0.7836,0.1717,0.4936,0.2966,0.7421,0.0986,0.4569,0.0214,0.4204,0.9672,0.9757,0.0787,0.5794,0.0899,0.9467,0.7518,0.3034,0.8938,0.5401,0.8321,0.0513,0.9578,0.387,0.4453,0.542,0.6182,0.9385,0.1322,0.6499,0.3363,0.3436,0.6379,0.6658,0.5687,0.3549,0.9742,0.9779,0.8007,0.3684,0.0441,0.1711,0.0054,0.5557,0.0246,0.6046,0.398,0.3255,0.1755,0.748,0.5675,0.3936,0.2087,0.1398,0.4767,0.1546,0.4977,0.3367,0.6938,0.861,0.5258,0.9221,0.2576,0.2287,0.0982,0.9295,0.6862,0.1984,0.1259,0.1028,0.2832,0.1539,0.4235,0.1497,0.1982,0.2599,0.9244,0.7845,0.1649,0.3806,0.0381,0.2152,0.123,0.5353,0.7948,0.9082,0.9345,0.6723,0.6752,0.9547,0.1778,0.2557,0.2356,0.6911,0.8835,0.0356,0.2884,0.6227,0.9278,0.0739,0.0952,0.8095,0.1522,0.3143,0.1226,0.4048,0.6084,0.5884,0.38,0.2861,0.9385,0.9496,0.8123,0.5023,0.6496,0.5717,0.0362,0.8816]	seed-model	2025-11-10 04:48:51.599122+00	[0.517,0.7961,0.9238,0.8681,0.0324,0.4841,0.7494,0.0939,0.7064,0.8942,0.8001,0.6695,0.8885,0.0962,0.0903,0.0104,0.4858,0.5093,0.5296,0.529,0.9663,0.7624,0.1238,0.3525,0.3268,0.1429,0.1628,0.7679,0.3946,0.0783,0.6313,0.388,0.4325,0.04,0.7377,0.7935,0.8907,0.6393,0.8601,0.7902,0.6125,0.2918,0.114,0.5005,0.2545,0.1484,0.9526,0.6197,0.1779,0.1127,0.8055,0.0915,0.8882,0.814,0.3166,0.3323,0.4353,0.5818,0.6666,0.4002,0.5497,0.9865,0.8537,0.538,0.5112,0.6513,0.0795,0.4796,0.6787,0.08,0.0776,0.6363,0.3848,0.9547,0.7085,0.7153,0.0002,0.7227,0.559,0.7606,0.5901,0.7308,0.8961,0.2081,0.2217,0.4406,0.3782,0.4254,0.4677,0.1503,0.0547,0.2021,0.165,0.0225,0.4351,0.4414,0.4832,0.8888,0.2563,0.756,0.4456,0.4054,0.3392,0.7435,0.4484,0.0954,0.5929,0.9535,0.9328,0.3147,0.7851,0.0391,0.6731,0.0592,0.5489,0.0163,0.58,0.6059,0.8714,0.3408,0.3069,0.5455,0.1225,0.939,0.9112,0.2643,0.8185,0.4575,0.643,0.5292,0.7791,0.1809,0.6935,0.9795,0.9181,0.6686,0.2603,0.8446,0.1114,0.9916,0.6181,0.9651,0.1912,0.1968,0.2768,0.8154,0.5663,0.2223,0.6055,0.8466,0.6664,0.9412,0.4438,0.3565,0.2102,0.7576,0.5679,0.9033,0.4179,0.4372,0.3278,0.8358,0.2903,0.7609,0.8609,0.9046,0.4362,0.7857,0.4633,0.3414,0.4335,0.4459,0.0184,0.006,0.6391,0.7714,0.1125,0.9744,0.7762,0.5936,0.9478,0.1837,0.2883,0.0816,0.5535,0.7804,0.8027,0.7338,0.5863,0.8036,0.6207,0.1119,0.6551,0.3278,0.6885,0.5396,0.708,0.655,0.1879,0.7092,0.4218,0.2279,0.8271,0.4104,0.6541,0.4748,0.6591,0.7988,0.585,0.6518,0.546,0.4846,0.1152,0.2594,0.8067,0.1657,0.8463,0.2299,0.1067,0.1147,0.1619,0.4044,0.1712,0.9239,0.8649,0.245,0.7163,0.2263,0.7574,0.0836,0.4134,0.0618,0.2245,0.274,0.3144,0.0108,0.7455,0.3155,0.8442,0.4462,0.6949,0.8565,0.8388,0.1741,0.0246,0.2611,0.7486,0.4997,0.8968,0.9602,0.3216,0.6434,0.9992,0.0544,0.5791,0.808,0.3206,0.6323,0.6669,0.476,0.7849,0.2131,0.8667,0.4959,0.1591,0.0501,0.833,0.1998,0.5517,0.5788,0.2803,0.2513,0.675,0.3509,0.6109,0.5005,0.8699,0.1454,0.8688,0.1999,0.7501,0.7573,0.8315,0.2777,0.3292,0.7336,0.1214,0.1933,0.9371,0.208,0.6482,0.9136,0.3563,0.9443,0.7165,0.1225,0.7975,0.2977,0.1861,0.5557,0.0465,0.1822,0.8113,0.3072,0.3347,0.1794,0.0531,0.8465,0.7903,0.2047,0.8992,0.8302,0.132,0.7305,0.0086,0.6155,0.3035,0.4512,0.7356,0.7055,0.9489,0.8684,0.7669,0.7471,0.9084,0.077,0.0293,0.0695,0.3154,0.4711,0.017,0.7416,0.9613,0.9805,0.3238,0.1977,0.2988,0.6887,0.5265,0.1784,0.7619,0.4422,0.5259,0.4034,0.7135,0.1788,0.422,0.8706,0.2012,0.0876,0.484,0.3536,0.6172,0.6628,0.8737,0.664,0.0257,0.7956,0.7189,0.6111,0.0246,0.781,0.3806,0.4485,0.5758,0.4611,0.0433,0.296,0.0056,0.058,0.1141,0.1042,0.2622,0.2894,0.9359,0.0512,0.2002,0.2004,0.1422,0.7356,0.8777,0.7037,0.3095,0.6465,0.1168,0.1013,0.7072,0.1366,0.3165,0.9382,0.8536,0.429,0.2721,0.0823,0.3404,0.5393,0.4437,0.8917,0.0789,0.3704,0.5644,0.4187,0.8681,0.0001,0.0478,0.745,0.9953,0.5987,0.8363,0.1828,0.8005,0.7553,0.8391,0.4866,0.8166,0.6884,0.9499,0.6606,0.4979,0.4884,0.4745,0.3852,0.3627,0.5691,0.9852,0.028,0.8494,0.7923,0.8627,0.8012,0.9428,0.9141,0.1873,0.8407,0.854,0.8121,0.0197,0.8088,0.9134,0.4903,0.5165,0.9934,0.9593,0.041,0.6957,0.7028,0.4743,0.5919,0.0843,0.4988,0.5507,0.4349,0.6104,0.19,0.4037,0.3814,0.1621,0.5044,0.6189,0.5577,0.3693,0.4137,0.4464,0.8125,0.4754,0.1939,0.0596,0.9728,0.6172,0.379,0.4723,0.913,0.3743,0.9069,0.5492,0.5023,0.9058,0.4875,0.3306,0.2044,0.1431,0.8459,0.2201,0.513,0.8322,0.7054,0.5364,0.8151,0.9637,0.7479,0.556,0.5895,0.6742,0.663,0.751,0.5088,0.7554,0.8648,0.1866,0.6573,0.3258,0.8031,0.4653,0.737,0.8389,0.0579,0.2986,0.6904,0.2371,0.0739,0.1886,0.0149,0.4219,0.33,0.6282,0.7156,0.5953,0.9047,0.2936,0.4655,0.8231,0.8051,0.8808,0.3189,0.9284,0.2315,0.9559,0.5344,0.1423,0.0469,0.3203,0.5372,0.2157,0.2977,0.7924,0.9753,0.3761,0.5317,0.8169,0.3195,0.8554,0.9593,0.0916,0.8947,0.1244,0.8408,0.644,0.9307,0.5873,0.8309,0.5989,0.7331,0.6529,0.8132,0.6459,0.4092,0.6665,0.4604,0.1484,0.5514,0.6368,0.7762,0.2538,0.7291,0.0387,0.6022,0.821,0.2942,0.6309,0.8105,0.4215,0.7438,0.5235,0.4966,0.7863,0.4263,0.3328,0.4864,0.938,0.3407,0.7724,0.1635,0.444,0.7661,0.6799,0.6663,0.2197,0.9128,0.1473,0.6907,0.0883,0.4529,0.4067,0.9794,0.9732,0.248,0.0673,0.6469,0.4425,0.2494,0.389,0.9031,0.0456,0.5011,0.4512,0.046,0.8459,0.4759,0.4892,0.5851,0.6853,0.6775,0.1499,0.5442,0.2678,0.6427,0.9865,0.446,0.2702,0.8244,0.2725,0.5976,0.8042,0.469,0.827,0.6857,0.8305,0.5165,0.9858,0.2614,0.8251,0.8453,0.3069,0.5327,0.7955,0.5736,0.4801,0.4177,0.5139,0.4789,0.8048,0.115,0.0292,0.601,0.8207,0.6037,0.8234,0.2613,0.5298,0.3522,0.7151,0.1332,0.9941,0.4542,0.0485,0.6138,0.9644,0.8842,0.9027,0.5563,0.3539,0.0813,0.1731,0.3851,0.2234,0.0955,0.7816,0.7541,0.7971,0.8044,0.0902,0.0205,0.0953,0.2903,0.6554,0.1258,0.2982,0.6212,0.3473,0.1854,0.2974,0.7563,0.6681,0.8836,0.9538,0.4349,0.9602,0.5381,0.9455,0.3653,0.3244,0.9901,0.955,0.0798,0.1037,0.0336,0.9263,0.9607,0.8365,0.8365,0.1733,0.5319,0.6065,0.0096,0.812,0.0883,0.323,0.3867,0.8001,0.1163,0.3975,0.6423,0.0125,0.6668,0.796,0.9852,0.9045,0.0268,0.6826,0.3814,0.4515,0.88,0.6764,0.7661,0.3266,0.03,0.6816,0.5602,0.7075,0.5135,0.4097,0.3527,0.8822,0.756,0.2421,0.3053,0.5954,0.4109,0.7014,0.9304,0.0172,0.6538,0.5057,0.2548,0.1518,0.4384,0.0337,0.0829,0.7607,0.6042,0.1981,0.0193,0.2066,0.425,0.2705,0.9233,0.3838,0.2041,0.7612,0.561,0.6642,0.6321,0.0812,0.9065,0.6756,0.4398,0.4073,0.8033,0.9019,0.6629,0.276,0.2835,0.0977,0.1172,0.9408,0.5782,0.3699,0.1618,0.512,0.9865,0.7269,0.9017,0.78,0.5542,0.5365,0.7693,0.401,0.3162,0.5834,0.1889,0.8386,0.4622,0.1276,0.3147,0.7595,0.2284,0.5981,0.6883,0.1278,0.2878,0.0834,0.1794,0.5446,0.1737,0.3097,0.2252,0.4235,0.1164,0.4925,0.7132,0.3245,0.4091,0.1742,0.0052,0.7708,0.6028,0.6855,0.864,0.963,0.0948,0.2578,0.7865,0.0653,0.2711,0.0373,0.1652,0.471,0.0152,0.9765,0.0422,0.4107,0.5165,0.7602,0.6882,0.0056,0.2457,0.2865,0.8724,0.1254,0.6343,0.4795,0.7374,0.084,0.8021,0.2935,0.9306,0.724,0.2893,0.2167,0.2217,0.3608,0.6312,0.5212,0.8764,0.5512,0.2615,0.975,0.6884,0.5061,0.8707,0.4601,0.7883,0.2635,0.3181,0.2333,0.8721,0.5646,0.8374,0.2725,0.8092,0.9003,0.6501,0.5727,0.9291,0.3981,0.5651,0.6283,0.4402,0.2369,0.6394,0.5116,0.1954,0.5907,0.7486,0.6833,0.2693,0.937,0.1617,0.1078,0.7595,0.6326,0.5966,0.9516,0.2896,0.5376,0.5217,0.3026,0.3724,0.6326,0.1472,0.2451,0.7112,0.4369,0.5338,0.0834,0.4963,0.8729,0.1375,0.2854,0.1354,0.3623,0.8198,0.0947,0.9771,0.0049,0.3953,0.8256,0.5835,0.9689,0.0124,0.2494,0.0062,0.948,0.4576,0.2832,0.202,0.5608,0.3855,0.9447,0.2767,0.8858,0.7329,0.7702,0.5908,0.4413,0.9839,0.696,0.6658,0.5014,0.5108,0.8996,0.2682,0.0919,0.7381,0.7635,0.0583,0.2618,0.122,0.7253,0.5307,0.3663,0.3778,0.8487,0.8858,0.2875,0.976,0.7232,0.6139,0.2392,0.9539,0.8025,0.7408,0.1597,0.1736,0.7694,0.3265,0.3422,0.9308,0.0191,0.5224,0.3639,0.8181,0.263,0.9994,0.1596,0.3817,0.4329,0.5988,0.5497,0.9482,0.3605,0.4823,0.1646,0.7291,0.9586,0.5995,0.5287,0.4814,0.1623,0.3641,0.6146,0.0524,0.2397,0.6689,0.0801,0.0381,0.2347,0.216,0.727,0.1112,0.3469,0.5172,0.7909,0.4138,0.2942,0.1927,0.9681,0.992,0.7937,0.8892,0.2104,0.6336,0.5539,0.4619,0.8222,0.6554,0.6921,0.3016,0.2187,0.8375,0.3204,0.3047,0.4363,0.4843,0.1773,0.6318,0.154,0.7499,0.4381,0.842,0.2021,0.0206,0.6236,0.9514,0.0169,0.6661,0.1524,0.8711,0.6791,0.3627,0.909,0.1858,0.5713,0.999,0.6557,0.8514,0.6546,0.6425,0.3352,0.1457,0.0067,0.554,0.1835,0.1646,0.788,0.4814,0.6456,0.6793,0.5542,0.2993,0.818,0.662,0.5364,0.7862,0.02,0.9631,0.0203,0.2987,0.4105,0.3107,0.7706,0.03,0.5652,0.8936,0.2943,0.1596,0.4533,0.4323,0.2502,0.3967,0.0755,0.1915,0.3785,0.3515,0.8777,0.4332,0.9703,0.53,0.0605,0.6175,0.3068,0.4471,0.248,0.7387,0.3353,0.0826,0.0159,0.2084,0.7673,0.783,0.023,0.8603,0.9497,0.2968,0.6396,0.091,0.1986,0.531,0.2491,0.1927,0.793,0.3024,0.9208,0.6282,0.395,0.9056,0.8016,0.7958,0.4745,0.2626,0.6725,0.7444,0.6265,0.7801,0.751,0.6946,0.3923,0.2053,0.961,0.2602,0.5883,0.8071,0.4531,0.8742,0.6778,0.24,0.6286,0.5177,0.1194,0.5678,0.4183,0.4429,0.9789,0.2941,0.1196,0.3613,0.4482,0.031,0.6431,0.2987,0.019,0.5376,0.3026,0.7797,0.7003,0.2758,0.7218,0.5585,0.5517,0.5118,0.6568,0.8747,0.2954,0.0904,0.7774,0.0238,0.0377,0.3502,0.8473,0.9453,0.084,0.4216,0.0444,0.9693,0.0327,0.755,0.6578,0.6186,0.167,0.201,0.2991,0.8684,0.1293,0.1341,0.591,0.7438,0.823,0.6603,0.0391,0.0889,0.2117,0.394,0.3781,0.8487,0.895,0.799,0.7456,0.4039,0.6152,0.3415,0.1216,0.1868,0.6653,0.9074,0.7165,0.9137,0.9413,0.0748,0.6996,0.5486,0.5009,0.1795,0.8863,0.8111,0.6277,0.2227,0.7598,0.5089,0.2891,0.7941,0.0544,0.2553,0.6346,0.5781,0.7136,0.4992,0.0362,0.1749,0.7447,0.9242,0.3077,0.3888,0.8398,0.0157,0.7575,0.065,0.6508,0.2311,0.9732,0.8046,0.8995,0.46,0.9541,0.5871,0.9027,0.3318,0.3112,0.4987,0.2953,0.6288,0.9127,0.5491,0.0431,0.6613,0.3974,0.3508,0.0807,0.0336,0.4858,0.996,0.779,0.9454,0.2317,0.671,0.0002,0.2555,0.5406,0.4249,0.0955,0.0537,0.1822,0.0256,0.8618,0.0589,0.5801,0.1837,0.4944,0.1808,0.975,0.4968,0.546,0.2701,0.2952,0.9391,0.393,0.8861,0.8919,0.7196,0.5132,0.7409,0.5446,0.6131,0.6631,0.924,0.8936,0.8565,0.6984,0.2156,0.3617,0.7973,0.4954,0.0216,0.1737,0.4828,0.6029,0.807,0.2788,0.5383,0.4102,0.4288,0.0731,0.0788,0.4698,0.8453,0.5258,0.9759,0.5155,0.2796,0.8314,0.5042,0.7589,0.786,0.3514,0.6796,0.3009,0.1022,0.7102,0.2258,0.8008,0.4268,0.3103,0.5916,0.8454,0.9316,0.5143,0.5211,0.4006,0.5295,0.0102,0.5484,0.018,0.5742,0.8746,0.4809,0.8962,0.587,0.1724,0.9363,0.3464,0.3755,0.2924,0.2658,0.9115,0.4652,0.2464,0.4821,0.1226,0.4415,0.1312,0.0173,0.7752,0.7957,0.1921,0.668,0.3765,0.6957,0.9154,0.3893,0.8026,0.091,0.4295,0.6546,0.2993,0.9642,0.8489,0.2174,0.5896,0.0983,0.6493,0.351,0.955,0.9787,0.7386,0.6348,0.4468,0.4475,0.5682,0.0115,0.6625,0.5279,0.6176,0.6554,0.8711,0.824,0.0801,0.0763,0.6367,0.8147,0.2966,0.9062,0.6971,0.4497,0.0272,0.8905,0.984,0.64,0.8391,0.6337,0.9574,0.1789,0.294,0.0974,0.9945,0.7919,0.9623,0.8525,0.7095,0.2599,0.1855,0.7836,0.1717,0.4936,0.2966,0.7421,0.0986,0.4569,0.0214,0.4204,0.9672,0.9757,0.0787,0.5794,0.0899,0.9467,0.7518,0.3034,0.8938,0.5401,0.8321,0.0513,0.9578,0.387,0.4453,0.542,0.6182,0.9385,0.1322,0.6499,0.3363,0.3436,0.6379,0.6658,0.5687,0.3549,0.9742,0.9779,0.8007,0.3684,0.0441,0.1711,0.0054,0.5557,0.0246,0.6046,0.398,0.3255,0.1755,0.748,0.5675,0.3936,0.2087,0.1398,0.4767,0.1546,0.4977,0.3367,0.6938,0.861,0.5258,0.9221,0.2576,0.2287,0.0982,0.9295,0.6862,0.1984,0.1259,0.1028,0.2832,0.1539,0.4235,0.1497,0.1982,0.2599,0.9244,0.7845,0.1649,0.3806,0.0381,0.2152,0.123,0.5353,0.7948,0.9082,0.9345,0.6723,0.6752,0.9547,0.1778,0.2557,0.2356,0.6911,0.8835,0.0356,0.2884,0.6227,0.9278,0.0739,0.0952,0.8095,0.1522,0.3143,0.1226,0.4048,0.6084,0.5884,0.38,0.2861,0.9385,0.9496,0.8123,0.5023,0.6496,0.5717,0.0362,0.8816]	[0.517,0.7961,0.9238,0.8681,0.0324,0.4841,0.7494,0.0939,0.7064,0.8942,0.8001,0.6695,0.8885,0.0962,0.0903,0.0104,0.4858,0.5093,0.5296,0.529,0.9663,0.7624,0.1238,0.3525,0.3268,0.1429,0.1628,0.7679,0.3946,0.0783,0.6313,0.388,0.4325,0.04,0.7377,0.7935,0.8907,0.6393,0.8601,0.7902,0.6125,0.2918,0.114,0.5005,0.2545,0.1484,0.9526,0.6197,0.1779,0.1127,0.8055,0.0915,0.8882,0.814,0.3166,0.3323,0.4353,0.5818,0.6666,0.4002,0.5497,0.9865,0.8537,0.538,0.5112,0.6513,0.0795,0.4796,0.6787,0.08,0.0776,0.6363,0.3848,0.9547,0.7085,0.7153,0.0002,0.7227,0.559,0.7606,0.5901,0.7308,0.8961,0.2081,0.2217,0.4406,0.3782,0.4254,0.4677,0.1503,0.0547,0.2021,0.165,0.0225,0.4351,0.4414,0.4832,0.8888,0.2563,0.756,0.4456,0.4054,0.3392,0.7435,0.4484,0.0954,0.5929,0.9535,0.9328,0.3147,0.7851,0.0391,0.6731,0.0592,0.5489,0.0163,0.58,0.6059,0.8714,0.3408,0.3069,0.5455,0.1225,0.939,0.9112,0.2643,0.8185,0.4575,0.643,0.5292,0.7791,0.1809,0.6935,0.9795,0.9181,0.6686,0.2603,0.8446,0.1114,0.9916,0.6181,0.9651,0.1912,0.1968,0.2768,0.8154,0.5663,0.2223,0.6055,0.8466,0.6664,0.9412,0.4438,0.3565,0.2102,0.7576,0.5679,0.9033,0.4179,0.4372,0.3278,0.8358,0.2903,0.7609,0.8609,0.9046,0.4362,0.7857,0.4633,0.3414,0.4335,0.4459,0.0184,0.006,0.6391,0.7714,0.1125,0.9744,0.7762,0.5936,0.9478,0.1837,0.2883,0.0816,0.5535,0.7804,0.8027,0.7338,0.5863,0.8036,0.6207,0.1119,0.6551,0.3278,0.6885,0.5396,0.708,0.655,0.1879,0.7092,0.4218,0.2279,0.8271,0.4104,0.6541,0.4748,0.6591,0.7988,0.585,0.6518,0.546,0.4846,0.1152,0.2594,0.8067,0.1657,0.8463,0.2299,0.1067,0.1147,0.1619,0.4044,0.1712,0.9239,0.8649,0.245,0.7163,0.2263,0.7574,0.0836,0.4134,0.0618,0.2245,0.274,0.3144,0.0108,0.7455,0.3155,0.8442,0.4462,0.6949,0.8565,0.8388,0.1741,0.0246,0.2611,0.7486,0.4997,0.8968,0.9602,0.3216,0.6434,0.9992,0.0544,0.5791,0.808,0.3206,0.6323,0.6669,0.476,0.7849,0.2131,0.8667,0.4959,0.1591,0.0501,0.833,0.1998,0.5517,0.5788,0.2803,0.2513,0.675,0.3509,0.6109,0.5005,0.8699,0.1454,0.8688,0.1999,0.7501,0.7573,0.8315,0.2777,0.3292,0.7336,0.1214,0.1933,0.9371,0.208,0.6482,0.9136,0.3563,0.9443,0.7165,0.1225,0.7975,0.2977,0.1861,0.5557,0.0465,0.1822,0.8113,0.3072,0.3347,0.1794,0.0531,0.8465,0.7903,0.2047,0.8992,0.8302,0.132,0.7305,0.0086,0.6155,0.3035,0.4512,0.7356,0.7055,0.9489,0.8684,0.7669,0.7471,0.9084,0.077,0.0293,0.0695,0.3154,0.4711,0.017,0.7416,0.9613,0.9805,0.3238,0.1977,0.2988,0.6887,0.5265,0.1784,0.7619,0.4422,0.5259,0.4034,0.7135,0.1788,0.422,0.8706,0.2012,0.0876,0.484,0.3536,0.6172,0.6628,0.8737,0.664,0.0257,0.7956,0.7189,0.6111,0.0246,0.781,0.3806,0.4485,0.5758,0.4611,0.0433,0.296,0.0056,0.058,0.1141,0.1042,0.2622,0.2894,0.9359,0.0512,0.2002,0.2004,0.1422,0.7356,0.8777,0.7037,0.3095,0.6465,0.1168,0.1013,0.7072,0.1366,0.3165,0.9382,0.8536,0.429,0.2721,0.0823,0.3404,0.5393,0.4437,0.8917,0.0789,0.3704,0.5644,0.4187,0.8681,0.0001,0.0478,0.745,0.9953,0.5987,0.8363,0.1828,0.8005,0.7553,0.8391,0.4866,0.8166,0.6884,0.9499,0.6606,0.4979,0.4884,0.4745,0.3852,0.3627,0.5691,0.9852,0.028,0.8494,0.7923,0.8627,0.8012,0.9428,0.9141,0.1873,0.8407,0.854,0.8121,0.0197,0.8088,0.9134,0.4903,0.5165,0.9934,0.9593,0.041,0.6957,0.7028,0.4743,0.5919,0.0843,0.4988,0.5507,0.4349,0.6104,0.19,0.4037,0.3814,0.1621,0.5044,0.6189,0.5577,0.3693,0.4137,0.4464,0.8125,0.4754,0.1939,0.0596,0.9728,0.6172,0.379,0.4723,0.913,0.3743,0.9069,0.5492,0.5023,0.9058,0.4875,0.3306,0.2044,0.1431,0.8459,0.2201,0.513,0.8322,0.7054,0.5364,0.8151,0.9637,0.7479,0.556,0.5895,0.6742,0.663,0.751,0.5088,0.7554,0.8648,0.1866,0.6573,0.3258,0.8031,0.4653,0.737,0.8389,0.0579,0.2986,0.6904,0.2371,0.0739,0.1886,0.0149,0.4219,0.33,0.6282,0.7156,0.5953,0.9047,0.2936,0.4655,0.8231,0.8051,0.8808,0.3189,0.9284,0.2315,0.9559,0.5344,0.1423,0.0469,0.3203,0.5372,0.2157,0.2977,0.7924,0.9753,0.3761,0.5317,0.8169,0.3195,0.8554,0.9593,0.0916,0.8947,0.1244,0.8408,0.644,0.9307,0.5873,0.8309,0.5989,0.7331,0.6529,0.8132,0.6459,0.4092,0.6665,0.4604,0.1484,0.5514,0.6368,0.7762,0.2538,0.7291,0.0387,0.6022,0.821,0.2942,0.6309,0.8105,0.4215,0.7438,0.5235,0.4966,0.7863,0.4263,0.3328,0.4864,0.938,0.3407,0.7724,0.1635,0.444,0.7661,0.6799,0.6663,0.2197,0.9128,0.1473,0.6907,0.0883,0.4529,0.4067,0.9794,0.9732,0.248,0.0673,0.6469,0.4425,0.2494,0.389,0.9031,0.0456,0.5011,0.4512,0.046,0.8459,0.4759,0.4892,0.5851,0.6853,0.6775,0.1499,0.5442,0.2678,0.6427,0.9865,0.446,0.2702,0.8244,0.2725,0.5976,0.8042,0.469,0.827,0.6857,0.8305,0.5165,0.9858,0.2614,0.8251,0.8453,0.3069,0.5327,0.7955,0.5736,0.4801,0.4177,0.5139,0.4789,0.8048,0.115,0.0292,0.601,0.8207,0.6037,0.8234,0.2613,0.5298,0.3522,0.7151,0.1332,0.9941,0.4542,0.0485,0.6138,0.9644,0.8842,0.9027,0.5563,0.3539,0.0813,0.1731,0.3851,0.2234,0.0955,0.7816,0.7541,0.7971,0.8044,0.0902,0.0205,0.0953,0.2903,0.6554,0.1258,0.2982,0.6212,0.3473,0.1854,0.2974,0.7563,0.6681,0.8836,0.9538,0.4349,0.9602,0.5381,0.9455,0.3653,0.3244,0.9901,0.955,0.0798,0.1037,0.0336,0.9263,0.9607,0.8365,0.8365,0.1733,0.5319,0.6065,0.0096,0.812,0.0883,0.323,0.3867,0.8001,0.1163,0.3975,0.6423,0.0125,0.6668,0.796,0.9852,0.9045,0.0268,0.6826,0.3814,0.4515,0.88,0.6764,0.7661,0.3266,0.03,0.6816,0.5602,0.7075,0.5135,0.4097,0.3527,0.8822,0.756,0.2421,0.3053,0.5954,0.4109,0.7014,0.9304,0.0172,0.6538,0.5057,0.2548,0.1518,0.4384,0.0337,0.0829,0.7607,0.6042,0.1981,0.0193,0.2066,0.425,0.2705,0.9233,0.3838,0.2041,0.7612,0.561,0.6642,0.6321,0.0812,0.9065,0.6756,0.4398,0.4073,0.8033,0.9019,0.6629,0.276,0.2835,0.0977,0.1172,0.9408,0.5782,0.3699,0.1618,0.512,0.9865,0.7269,0.9017,0.78,0.5542,0.5365,0.7693,0.401,0.3162,0.5834,0.1889,0.8386,0.4622,0.1276,0.3147,0.7595,0.2284,0.5981,0.6883,0.1278,0.2878,0.0834,0.1794,0.5446,0.1737,0.3097,0.2252,0.4235,0.1164,0.4925,0.7132,0.3245,0.4091,0.1742,0.0052,0.7708,0.6028,0.6855,0.864,0.963,0.0948,0.2578,0.7865,0.0653,0.2711,0.0373,0.1652,0.471,0.0152,0.9765,0.0422,0.4107,0.5165,0.7602,0.6882,0.0056,0.2457,0.2865,0.8724,0.1254,0.6343,0.4795,0.7374,0.084,0.8021,0.2935,0.9306,0.724,0.2893,0.2167,0.2217,0.3608,0.6312,0.5212,0.8764,0.5512,0.2615,0.975,0.6884,0.5061,0.8707,0.4601,0.7883,0.2635,0.3181,0.2333,0.8721,0.5646,0.8374,0.2725,0.8092,0.9003,0.6501,0.5727,0.9291,0.3981,0.5651,0.6283,0.4402,0.2369,0.6394,0.5116,0.1954,0.5907,0.7486,0.6833,0.2693,0.937,0.1617,0.1078,0.7595,0.6326,0.5966,0.9516,0.2896,0.5376,0.5217,0.3026,0.3724,0.6326,0.1472,0.2451,0.7112,0.4369,0.5338,0.0834,0.4963,0.8729,0.1375,0.2854,0.1354,0.3623,0.8198,0.0947,0.9771,0.0049,0.3953,0.8256,0.5835,0.9689,0.0124,0.2494,0.0062,0.948,0.4576,0.2832,0.202,0.5608,0.3855,0.9447,0.2767,0.8858,0.7329,0.7702,0.5908,0.4413,0.9839,0.696,0.6658,0.5014,0.5108,0.8996,0.2682,0.0919,0.7381,0.7635,0.0583,0.2618,0.122,0.7253,0.5307,0.3663,0.3778,0.8487,0.8858,0.2875,0.976,0.7232,0.6139,0.2392,0.9539,0.8025,0.7408,0.1597,0.1736,0.7694,0.3265,0.3422,0.9308,0.0191,0.5224,0.3639,0.8181,0.263,0.9994,0.1596,0.3817,0.4329,0.5988,0.5497,0.9482,0.3605,0.4823,0.1646,0.7291,0.9586,0.5995,0.5287,0.4814,0.1623,0.3641,0.6146,0.0524,0.2397,0.6689,0.0801,0.0381,0.2347,0.216,0.727,0.1112,0.3469,0.5172,0.7909,0.4138,0.2942,0.1927,0.9681,0.992,0.7937,0.8892,0.2104,0.6336,0.5539,0.4619,0.8222,0.6554,0.6921,0.3016,0.2187,0.8375,0.3204,0.3047,0.4363,0.4843,0.1773,0.6318,0.154,0.7499,0.4381,0.842,0.2021,0.0206,0.6236,0.9514,0.0169,0.6661,0.1524,0.8711,0.6791,0.3627,0.909,0.1858,0.5713,0.999,0.6557,0.8514,0.6546,0.6425,0.3352,0.1457,0.0067,0.554,0.1835,0.1646,0.788,0.4814,0.6456,0.6793,0.5542,0.2993,0.818,0.662,0.5364,0.7862,0.02,0.9631,0.0203,0.2987,0.4105,0.3107,0.7706,0.03,0.5652,0.8936,0.2943,0.1596,0.4533,0.4323,0.2502,0.3967,0.0755,0.1915,0.3785,0.3515,0.8777,0.4332,0.9703,0.53,0.0605,0.6175,0.3068,0.4471,0.248,0.7387,0.3353,0.0826,0.0159,0.2084,0.7673,0.783,0.023,0.8603,0.9497,0.2968,0.6396,0.091,0.1986,0.531,0.2491,0.1927,0.793,0.3024,0.9208,0.6282,0.395,0.9056,0.8016,0.7958,0.4745,0.2626,0.6725,0.7444,0.6265,0.7801,0.751,0.6946,0.3923,0.2053,0.961,0.2602,0.5883,0.8071,0.4531,0.8742,0.6778,0.24,0.6286,0.5177,0.1194,0.5678,0.4183,0.4429,0.9789,0.2941,0.1196,0.3613,0.4482,0.031,0.6431,0.2987,0.019,0.5376,0.3026,0.7797,0.7003,0.2758,0.7218,0.5585,0.5517,0.5118,0.6568,0.8747,0.2954,0.0904,0.7774,0.0238,0.0377,0.3502,0.8473,0.9453,0.084,0.4216,0.0444,0.9693,0.0327,0.755,0.6578,0.6186,0.167,0.201,0.2991,0.8684,0.1293,0.1341,0.591,0.7438,0.823,0.6603,0.0391,0.0889,0.2117,0.394,0.3781,0.8487,0.895,0.799,0.7456,0.4039,0.6152,0.3415,0.1216,0.1868,0.6653,0.9074,0.7165,0.9137,0.9413,0.0748,0.6996,0.5486,0.5009,0.1795,0.8863,0.8111,0.6277,0.2227,0.7598,0.5089,0.2891,0.7941,0.0544,0.2553,0.6346,0.5781,0.7136,0.4992,0.0362,0.1749,0.7447,0.9242,0.3077,0.3888,0.8398,0.0157,0.7575,0.065,0.6508,0.2311,0.9732,0.8046,0.8995,0.46,0.9541,0.5871,0.9027,0.3318,0.3112,0.4987,0.2953,0.6288,0.9127,0.5491,0.0431,0.6613,0.3974,0.3508,0.0807,0.0336,0.4858,0.996,0.779,0.9454,0.2317,0.671,0.0002,0.2555,0.5406,0.4249,0.0955,0.0537,0.1822,0.0256,0.8618,0.0589,0.5801,0.1837,0.4944,0.1808,0.975,0.4968,0.546,0.2701,0.2952,0.9391,0.393,0.8861,0.8919,0.7196,0.5132,0.7409,0.5446,0.6131,0.6631,0.924,0.8936,0.8565,0.6984,0.2156,0.3617,0.7973,0.4954,0.0216,0.1737,0.4828,0.6029,0.807,0.2788,0.5383,0.4102,0.4288,0.0731,0.0788,0.4698,0.8453,0.5258,0.9759,0.5155,0.2796,0.8314,0.5042,0.7589,0.786,0.3514,0.6796,0.3009,0.1022,0.7102,0.2258,0.8008,0.4268,0.3103,0.5916,0.8454,0.9316,0.5143,0.5211,0.4006,0.5295,0.0102,0.5484,0.018,0.5742,0.8746,0.4809,0.8962,0.587,0.1724,0.9363,0.3464,0.3755,0.2924,0.2658,0.9115,0.4652,0.2464,0.4821,0.1226,0.4415,0.1312,0.0173,0.7752,0.7957,0.1921,0.668,0.3765,0.6957,0.9154,0.3893,0.8026,0.091,0.4295,0.6546,0.2993,0.9642,0.8489,0.2174,0.5896,0.0983,0.6493,0.351,0.955,0.9787,0.7386,0.6348,0.4468,0.4475,0.5682,0.0115,0.6625,0.5279,0.6176,0.6554,0.8711,0.824,0.0801,0.0763,0.6367,0.8147,0.2966,0.9062,0.6971,0.4497,0.0272,0.8905,0.984,0.64,0.8391,0.6337,0.9574,0.1789,0.294,0.0974,0.9945,0.7919,0.9623,0.8525,0.7095,0.2599,0.1855,0.7836,0.1717,0.4936,0.2966,0.7421,0.0986,0.4569,0.0214,0.4204,0.9672,0.9757,0.0787,0.5794,0.0899,0.9467,0.7518,0.3034,0.8938,0.5401,0.8321,0.0513,0.9578,0.387,0.4453,0.542,0.6182,0.9385,0.1322,0.6499,0.3363,0.3436,0.6379,0.6658,0.5687,0.3549,0.9742,0.9779,0.8007,0.3684,0.0441,0.1711,0.0054,0.5557,0.0246,0.6046,0.398,0.3255,0.1755,0.748,0.5675,0.3936,0.2087,0.1398,0.4767,0.1546,0.4977,0.3367,0.6938,0.861,0.5258,0.9221,0.2576,0.2287,0.0982,0.9295,0.6862,0.1984,0.1259,0.1028,0.2832,0.1539,0.4235,0.1497,0.1982,0.2599,0.9244,0.7845,0.1649,0.3806,0.0381,0.2152,0.123,0.5353,0.7948,0.9082,0.9345,0.6723,0.6752,0.9547,0.1778,0.2557,0.2356,0.6911,0.8835,0.0356,0.2884,0.6227,0.9278,0.0739,0.0952,0.8095,0.1522,0.3143,0.1226,0.4048,0.6084,0.5884,0.38,0.2861,0.9385,0.9496,0.8123,0.5023,0.6496,0.5717,0.0362,0.8816]	0	0.6	2025-11-10 21:26:06.992169+00	0.6
10	[0.1651,0.9447,0.1219,0.9098,0.334,0.4938,0.4499,0.1343,0.4944,0.764,0.712,0.2489,0.7138,0.9116,0.4046,0.4013,0.3752,0.8242,0.17,0.468,0.669,0.8567,0.8183,0.4377,0.5894,0.257,0.5013,0.3903,0.2475,0.0892,0.1876,0.7388,0.3033,0.5815,0.5352,0.6669,0.6399,0.83,0.2696,0.6268,0.4751,0.4371,0.3138,0.6928,0.8734,0.3575,0.6715,0.7002,0.1603,0.4197,0.1037,0.4058,0.2166,0.4182,0.7625,0.0153,0.498,0.0982,0.4915,0.7371,0.4158,0.5397,0.8387,0.8215,0.6089,0.0509,0.1688,0.4506,0.1918,0.8876,0.6544,0.1997,0.1043,0.4782,0.8528,0.7881,0.8931,0.8958,0.1365,0.5794,0.6454,0.7675,0.2258,0.4677,0.7109,0.8194,0.2016,0.1017,0.8376,0.3855,0.1484,0.1392,0.1823,0.6945,0.0509,0.6606,0.1309,0.4509,0.8678,0.7254,0.7455,0.0767,0.4976,0.9163,0.2879,0.7348,0.8366,0.1852,0.1956,0.8501,0.6786,0.5209,0.5233,0.934,0.2521,0.9,0.7415,0.7404,0.883,0.1677,0.7813,0.3101,0.5896,0.1117,0.036,0.4607,0.0984,0.2083,0.5292,0.191,0.338,0.3986,0.3836,0.7638,0.9403,0.9969,0.2148,0.8687,0.8863,0.2218,0.4568,0.9339,0.1151,0.4438,0.0777,0.5825,0.3531,0.1247,0.361,0.3164,0.4411,0.313,0.0739,0.856,0.4632,0.8198,0.1998,0.0564,0.773,0.8153,0.6908,0.6937,0.8416,0.5767,0.4434,0.3397,0.4529,0.7242,0.2985,0.2114,0.9761,0.9299,0.4233,0.1137,0.5069,0.5238,0.9844,0.4992,0.5568,0.3663,0.735,0.876,0.4232,0.4414,0.9077,0.3692,0.3224,0.2625,0.9156,0.3491,0.4182,0.6851,0.1836,0.3391,0.5654,0.2076,0.2739,0.179,0.5129,0.1795,0.7427,0.0008,0.7228,0.0949,0.2575,0.4227,0.115,0.0207,0.204,0.6756,0.8401,0.3397,0.1594,0.0473,0.8833,0.3981,0.5568,0.5072,0.7729,0.44,0.3705,0.572,0.1275,0.4437,0.7436,0.1872,0.6891,0.5039,0.9372,0.6813,0.2956,0.9497,0.1485,0.1762,0.7039,0.9212,0.8185,0.0003,0.8498,0.7087,0.8831,0.8267,0.5578,0.7551,0.1049,0.7303,0.3309,0.1898,0.1116,0.0802,0.3723,0.0321,0.2708,0.9847,0.1248,0.116,0.5785,0.5291,0.4283,0.8839,0.2531,0.7398,0.7043,0.4759,0.7807,0.6451,0.0464,0.7886,0.975,0.2608,0.5232,0.8371,0.2867,0.9898,0.7684,0.2661,0.5889,0.0149,0.4375,0.6857,0.5623,0.1003,0.6018,0.804,0.7461,0.9412,0.8548,0.0983,0.9895,0.3047,0.9348,0.647,0.8539,0.724,0.7313,0.4603,0.9246,0.8187,0.0932,0.7262,0.7397,0.3998,0.394,0.3199,0.4267,0.2596,0.7677,0.4163,0.1356,0.9103,0.531,0.2439,0.4459,0.8953,0.1128,0.7956,0.8214,0.8081,0.0125,0.4517,0.6296,0.4989,0.9453,0.1701,0.5153,0.6392,0.481,0.2128,0.215,0.0987,0.1653,0.4948,0.1278,0.6621,0.4848,0.635,0.5835,0.7585,0.667,0.6624,0.7131,0.9035,0.8382,0.7798,0.952,0.3972,0.7176,0.8799,0.0122,0.3307,0.5342,0.3394,0.7908,0.1634,0.0299,0.0371,0.8999,0.2304,0.1286,0.9903,0.8956,0.3709,0.5712,0.3363,0.2799,0.7156,0.3674,0.9281,0.464,0.6772,0.1033,0.0913,0.2379,0.5202,0.1661,0.7074,0.3093,0.5245,0.9559,0.3146,0.4299,0.3699,0.37,0.3522,0.8816,0.9986,0.1173,0.0959,0.4863,0.7684,0.4798,0.6114,0.5015,0.2819,0.8933,0.3813,0.6416,0.8488,0.5623,0.4896,0.2047,0.2393,0.8895,0.2907,0.4986,0.7043,0.4177,0.6881,0.2395,0.1183,0.5224,0.9598,0.4609,0.0585,0.7957,0.4639,0.2279,0.8205,0.2386,0.8175,0.6454,0.814,0.66,0.4213,0.2125,0.9726,0.2357,0.5321,0.7334,0.9251,0.2792,0.6319,0.3194,0.5347,0.8503,0.6422,0.3444,0.7391,0.5855,0.6656,0.251,0.9139,0.0638,0.2119,0.4823,0.217,0.926,0.9253,0.0057,0.9617,0.1991,0.3121,0.7161,0.0114,0.6533,0.8105,0.5518,0.9869,0.4121,0.9823,0.4395,0.0318,0.768,0.2839,0.4529,0.9052,0.9745,0.2362,0.0486,0.8374,0.3886,0.8172,0.741,0.6991,0.036,0.3226,0.063,0.2883,0.991,0.8138,0.2401,0.7248,0.1293,0.5341,0.0979,0.1515,0.8918,0.8148,0.7214,0.0064,0.3131,0.2795,0.3619,0.888,0.7252,0.8826,0.3099,0.7035,0.6432,0.0958,0.9884,0.7043,0.5817,0.4909,0.5086,0.8645,0.5877,0.6234,0.9142,0.6898,0.2168,0.8043,0.3472,0.425,0.4179,0.3321,0.3096,0.1062,0.6698,0.8206,0.5814,0.4181,0.9477,0.945,0.7407,0.23,0.944,0.4605,0.0085,0.0658,0.2179,0.1123,0.2009,0.9876,0.594,0.1172,0.0976,0.5746,0.1354,0.6862,0.5272,0.9888,0.4982,0.5684,0.2718,0.2762,0.2252,0.0748,0.588,0.9092,0.1296,0.7796,0.1598,0.2792,0.4378,0.8119,0.8418,0.8846,0.7566,0.897,0.1636,0.8176,0.5539,0.653,0.9552,0.9613,0.5586,0.3885,0.4936,0.7574,0.7361,0.8413,0.8368,0.4661,0.2283,0.8762,0.5714,0.4322,0.3671,0.1472,0.7651,0.3216,0.1734,0.6134,0.6207,0.887,0.8907,0.9434,0.007,0.7795,0.4126,0.03,0.9447,0.7258,0.6,0.3899,0.6793,0.1415,0.2825,0.8974,0.4371,0.9571,0.0509,0.0659,0.2498,0.4036,0.8437,0.0074,0.079,0.5223,0.3564,0.8577,0.9254,0.1011,0.2464,0.6689,0.0562,0.5883,0.7151,0.762,0.3955,0.2445,0.9193,0.4129,0.2566,0.5088,0.2235,0.5324,0.8977,0.6386,0.8637,0.2856,0.6923,0.7254,0.1028,0.636,0.142,0.9559,0.2591,0.0607,0.0727,0.3651,0.0463,0.8025,0.5628,0.8259,0.9952,0.1004,0.257,0.4074,0.2763,0.6472,0.3025,0.8747,0.7962,0.6855,0.0278,0.868,0.6689,0.7262,0.7697,0.7497,0.7734,0.9676,0.9937,0.48,0.797,0.0644,0.6102,0.8518,0.2148,0.3738,0.1889,0.9631,0.1523,0.4657,0.9009,0.9902,0.0428,0.6099,0.2956,0.6107,0.833,0.0535,0.1525,0.7647,0.1399,0.3481,0.5527,0.2088,0.6927,0.9306,0.8289,0.0793,0.968,0.6281,0.6749,0.0154,0.5556,0.2662,0.6166,0.8648,0.4421,0.4351,0.6785,0.4847,0.4407,0.6512,0.0805,0.3131,0.4284,0.6061,0.6041,0.4442,0.8307,0.8457,0.3753,0.9167,0.0309,0.6704,0.3434,0.6221,0.4775,0.4056,0.1839,0.5543,0.0941,0.9824,0.8676,0.0371,0.8058,0.7599,0.1563,0.5789,0.9284,0.1939,0.2044,0.2243,0.6263,0.3999,0.182,0.827,0.3222,0.0282,0.1454,0.4375,0.6757,0.9729,0.2784,0.8661,0.7622,0.4278,0.0347,0.424,0.9505,0.3369,0.672,0.9906,0.7929,0.1693,0.331,0.6651,0.6789,0.1528,0.7555,0.614,0.7869,0.4001,0.8137,0.9776,0.6198,0.0392,0.9148,0.0848,0.3744,0.2993,0.8857,0.3694,0.7815,0.2154,0.3029,0.0947,0.8961,0.7702,0.254,0.3831,0.9249,0.5934,0.6188,0.3827,0.2003,0.5737,0.2985,0.101,0.7643,0.6723,0.5988,0.1135,0.4158,0.7408,0.6224,0.4198,0.0568,0.9164,0.2059,0.5147,0.5703,0.4238,0.2946,0.6776,0.0686,0.4713,0.1251,0.8931,0.0811,0.5038,0.4241,0.1563,0.8963,0.0721,0.298,0.9438,0.6573,0.5976,0.7166,0.4108,0.3911,0.2334,0.4462,0.0663,0.0604,0.4133,0.6903,0.7688,0.7214,0.4726,0.9049,0.436,0.41,0.9987,0.1554,0.992,0.74,0.4711,0.519,0.8485,0.1327,0.0469,0.6302,0.3825,0.9166,0.772,0.8922,0.4375,0.3932,0.8178,0.8188,0.9407,0.7135,0.7462,0.8868,0.6768,0.9397,0.926,0.4137,0.9568,0.4069,0.9868,0.7933,0.9143,0.3485,0.9795,0.7328,0.0945,0.1452,0.9786,0.9843,0.5101,0.4301,0.2824,0.0493,0.5007,0.4481,0.5521,0.6148,0.8093,0.8441,0.9365,0.7805,0.8751,0.4443,0.087,0.5383,0.0003,0.7798,0.4493,0.9333,0.5676,0.2795,0.7304,0.5408,0.7761,0.303,0.5674,0.928,0.2394,0.0487,0.726,0.5301,0.8477,0.3277,0.3317,0.8126,0.2363,0.5761,0.2746,0.4832,0.727,0.3784,0.6091,0.0187,0.2588,0.882,0.9444,0.7507,0.5016,0.6306,0.0112,0.487,0.2327,0.6466,0.176,0.8498,0.446,0.9981,0.6938,0.1061,0.6321,0.2844,0.1317,0.8236,0.0733,0.5209,0.348,0.5522,0.9919,0.4695,0.9812,0.3099,0.3258,0.3347,0.9278,0.412,0.1369,0.4122,0.1051,0.0543,0.2375,0.5395,0.1649,0.4772,0.1995,0.1337,0.2268,0.1326,0.9968,0.3018,0.1178,0.3415,0.2377,0.06,0.0875,0.0982,0.5086,0.1527,0.6387,0.9283,0.1022,0.3857,0.414,0.9132,0.8521,0.2351,0.4167,0.833,0.8266,0.0571,0.5845,0.9349,0.4278,0.2776,0.1443,0.4486,0.6585,0.0219,0.8685,0.6556,0.1074,0.2489,0.3227,0.1452,0.1606,0.4723,0.4534,0.0612,0.057,0.1314,0.0228,0.6602,0.7333,0.1328,0.9615,0.2122,0.2537,0.3698,0.1872,0.763,0.4831,0.1406,0.3955,0.2508,0.4464,0.4894,0.9498,0.8169,0.2652,0.1047,0.1143,0.7245,0.4817,0.4996,0.7072,0.7496,0.299,0.4091,0.9324,0.3108,0.5083,0.109,0.7436,0.0897,0.6952,0.6436,0.1437,0.7386,0.5856,0.5937,0.2951,0.4542,0.1589,0.5544,0.2534,0.0739,0.14,0.2568,0.6934,0.5708,0.9553,0.8789,0.9826,0.5974,0.8951,0.8759,0.6194,0.0202,0.8014,0.0642,0.5914,0.8208,0.4535,0.2905,0.7337,0.1469,0.6039,0.9247,0.715,0.6114,0.0771,0.0705,0.8218,0.5859,0.18,0.3217,0.3239,0.6851,0.1655,0.5922,0.3081,0.5629,0.9022,0.2418,0.0819,0.2615,0.641,0.1999,0.5359,0.927,0.4222,0.5213,0.8224,0.1009,0.5579,0.5871,0.5073,0.4897,0.437,0.0114,0.6831,0.309,0.5452,0.0693,0.7627,0.9583,0.124,0.3954,0.1293,0.8475,0.5706,0.5776,0.1612,0.545,0.7548,0.0899,0.3556,0.8946,0.4429,0.4469,0.9418,0.4,0.1681,0.7256,0.8084,0.7394,0.9708,0.0846,0.4576,0.8512,0.6136,0.5784,0.0939,0.2995,0.9058,0.7067,0.085,0.7864,0.8161,0.9557,0.2447,0.649,0.1951,0.6237,0.0743,0.6856,0.291,0.9134,0.173,0.0025,0.6371,0.9671,0.154,0.9883,0.1503,0.1793,0.1591,0.2612,0.1705,0.841,0.4688,0.3839,0.5215,0.281,0.8627,0.8278,0.0517,0.8775,0.6449,0.1081,0.5755,0.5445,0.9239,0.9787,0.6199,0.1412,0.9029,0.2881,0.5462,0.6363,0.9249,0.796,0.4738,0.1726,0.5846,0.0856,0.3636,0.8584,0.8387,0.164,0.8952,0.53,0.6322,0.0489,0.2358,0.9497,0.4902,0.592,0.8213,0.7136,0.3539,0.5065,0.9159,0.2661,0.563,0.7803,0.1301,0.6343,0.6879,0.2963,0.9397,0.4754,0.3693,0.7565,0.3544,0.2608,0.5617,0.1611,0.0855,0.6621,0.7868,0.4519,0.4613,0.4976,0.7859,0.8085,0.9788,0.6964,0.1827,0.1639,0.3483,0.6898,0.0894,0.7378,0.0174,0.0029,0.0386,0.3781,0.6706,0.9362,0.6968,0.3872,0.8388,0.8396,0.351,0.5523,0.2384,0.2632,0.117,0.4028,0.713,0.2104,0.4866,0.3035,0.733,0.2618,0.5406,0.0124,0.9695,0.3853,0.4778,0.9187,0.0964,0.3701,0.5714,0.3085,0.8019,0.7152,0.3308,0.2053,0.4499,0.6533,0.2487,0.6096,0.591,0.1496,0.4321,0.7789,0.7424,0.3079,0.4964,0.3447,0.8943,0.8536,0.9192,0.6646,0.0922,0.16,0.7667,0.7773,0.0684,0.1174,0.7001,0.4476,0.8931,0.5955,0.5954,0.5763,0.4092,0.9641,0.1512,0.0738,0.7627,0.9389,0.1392,0.1969,0.3466,0.7956,0.7575,0.3274,0.3041,0.6456,0.43,0.402,0.616,0.6972,0.751,0.7622,0.2068,0.5653,0.4153,0.4084,0.4761,0.2184,0.6614,0.1447,0.3183,0.0164,0.1355,0.6388,0.3451,0.9447,0.9413,0.4245,0.8907,0.9453,0.896,0.6004,0.3882,0.788,0.2996,0.8573,0.4216,0.7003,0.3321,0.5996,0.5513,0.2283,0.9074,0.1509,0.9958,0.4472,0.859,0.9503,0.7216,0.6672,0.1519,0.1936,0.3521,0.6367,0.6206,0.1128,0.3179,0.0443,0.9433,0.0654,0.1664,0.4772,0.0561,0.9892,0.3227,0.0398,0.2798,0.0524,0.6726,0.6542,0.598,0.8769,0.4324,0.4425,0.945,0.0373,0.9161,0.6199,0.1403,0.4571,0.9342,0.5495,0.6281,0.6893,0.8918,0.3115,0.7789,0.4853,0.1764,0.751,0.23,0.8355,0.5944,0.4982,0.1082,0.8092,0.7252,0.6303,0.1247,0.0419,0.7342,0.6348,0.5897,0.3751,0.3716,0.0803,0.4605,0.5662,0.7688,0.5284,0.1278,0.1164,0.1075,0.5845,0.4687,0.6334,0.5452,0.2327,0.8769,0.4229,0.1113,0.6952,0.9924,0.0066,0.9144,0.5534,0.3849,0.8319,0.3659,0.3603,0.0178,0.1654,0.3058,0.7377,0.5487,0.999,0.2057,0.8183,0.5708,0.1421,0.225,0.421,0.124,0.0599,0.1035,0.1859,0.3338,0.9649,0.27,0.9596,0.1255,0.6739,0.2705,0.4862,0.1424,0.374,0.3705,0.9245,0.3598,0.7942,0.8436,0.5835,0.3132,0.1135,0.0173,0.4772,0.6745,0.9823,0.4468,0.2052,0.5155,0.734,0.58,0.2903,0.1656,0.4173,0.9242,0.2693,0.4175,0.8921,0.6974,0.9519,0.8078,0.2327,0.3994,0.8152,0.9376,0.5792,0.8039,0.5321,0.9221,0.1676,0.4475,0.8912,0.751,0.325,0.446,0.1581,0.2194,0.1309,0.0341,0.5868,0.416,0.4356,0.8981,0.7565,0.7062,0.6351,0.0871,0.9273,0.2102,0.5417,0.142,0.4068,0.8922,0.7098,0.2897,0.2895,0.1894,0.0905,0.1354,0.8021,0.999]	seed-model	2025-11-10 04:48:51.599122+00	[0.1651,0.9447,0.1219,0.9098,0.334,0.4938,0.4499,0.1343,0.4944,0.764,0.712,0.2489,0.7138,0.9116,0.4046,0.4013,0.3752,0.8242,0.17,0.468,0.669,0.8567,0.8183,0.4377,0.5894,0.257,0.5013,0.3903,0.2475,0.0892,0.1876,0.7388,0.3033,0.5815,0.5352,0.6669,0.6399,0.83,0.2696,0.6268,0.4751,0.4371,0.3138,0.6928,0.8734,0.3575,0.6715,0.7002,0.1603,0.4197,0.1037,0.4058,0.2166,0.4182,0.7625,0.0153,0.498,0.0982,0.4915,0.7371,0.4158,0.5397,0.8387,0.8215,0.6089,0.0509,0.1688,0.4506,0.1918,0.8876,0.6544,0.1997,0.1043,0.4782,0.8528,0.7881,0.8931,0.8958,0.1365,0.5794,0.6454,0.7675,0.2258,0.4677,0.7109,0.8194,0.2016,0.1017,0.8376,0.3855,0.1484,0.1392,0.1823,0.6945,0.0509,0.6606,0.1309,0.4509,0.8678,0.7254,0.7455,0.0767,0.4976,0.9163,0.2879,0.7348,0.8366,0.1852,0.1956,0.8501,0.6786,0.5209,0.5233,0.934,0.2521,0.9,0.7415,0.7404,0.883,0.1677,0.7813,0.3101,0.5896,0.1117,0.036,0.4607,0.0984,0.2083,0.5292,0.191,0.338,0.3986,0.3836,0.7638,0.9403,0.9969,0.2148,0.8687,0.8863,0.2218,0.4568,0.9339,0.1151,0.4438,0.0777,0.5825,0.3531,0.1247,0.361,0.3164,0.4411,0.313,0.0739,0.856,0.4632,0.8198,0.1998,0.0564,0.773,0.8153,0.6908,0.6937,0.8416,0.5767,0.4434,0.3397,0.4529,0.7242,0.2985,0.2114,0.9761,0.9299,0.4233,0.1137,0.5069,0.5238,0.9844,0.4992,0.5568,0.3663,0.735,0.876,0.4232,0.4414,0.9077,0.3692,0.3224,0.2625,0.9156,0.3491,0.4182,0.6851,0.1836,0.3391,0.5654,0.2076,0.2739,0.179,0.5129,0.1795,0.7427,0.0008,0.7228,0.0949,0.2575,0.4227,0.115,0.0207,0.204,0.6756,0.8401,0.3397,0.1594,0.0473,0.8833,0.3981,0.5568,0.5072,0.7729,0.44,0.3705,0.572,0.1275,0.4437,0.7436,0.1872,0.6891,0.5039,0.9372,0.6813,0.2956,0.9497,0.1485,0.1762,0.7039,0.9212,0.8185,0.0003,0.8498,0.7087,0.8831,0.8267,0.5578,0.7551,0.1049,0.7303,0.3309,0.1898,0.1116,0.0802,0.3723,0.0321,0.2708,0.9847,0.1248,0.116,0.5785,0.5291,0.4283,0.8839,0.2531,0.7398,0.7043,0.4759,0.7807,0.6451,0.0464,0.7886,0.975,0.2608,0.5232,0.8371,0.2867,0.9898,0.7684,0.2661,0.5889,0.0149,0.4375,0.6857,0.5623,0.1003,0.6018,0.804,0.7461,0.9412,0.8548,0.0983,0.9895,0.3047,0.9348,0.647,0.8539,0.724,0.7313,0.4603,0.9246,0.8187,0.0932,0.7262,0.7397,0.3998,0.394,0.3199,0.4267,0.2596,0.7677,0.4163,0.1356,0.9103,0.531,0.2439,0.4459,0.8953,0.1128,0.7956,0.8214,0.8081,0.0125,0.4517,0.6296,0.4989,0.9453,0.1701,0.5153,0.6392,0.481,0.2128,0.215,0.0987,0.1653,0.4948,0.1278,0.6621,0.4848,0.635,0.5835,0.7585,0.667,0.6624,0.7131,0.9035,0.8382,0.7798,0.952,0.3972,0.7176,0.8799,0.0122,0.3307,0.5342,0.3394,0.7908,0.1634,0.0299,0.0371,0.8999,0.2304,0.1286,0.9903,0.8956,0.3709,0.5712,0.3363,0.2799,0.7156,0.3674,0.9281,0.464,0.6772,0.1033,0.0913,0.2379,0.5202,0.1661,0.7074,0.3093,0.5245,0.9559,0.3146,0.4299,0.3699,0.37,0.3522,0.8816,0.9986,0.1173,0.0959,0.4863,0.7684,0.4798,0.6114,0.5015,0.2819,0.8933,0.3813,0.6416,0.8488,0.5623,0.4896,0.2047,0.2393,0.8895,0.2907,0.4986,0.7043,0.4177,0.6881,0.2395,0.1183,0.5224,0.9598,0.4609,0.0585,0.7957,0.4639,0.2279,0.8205,0.2386,0.8175,0.6454,0.814,0.66,0.4213,0.2125,0.9726,0.2357,0.5321,0.7334,0.9251,0.2792,0.6319,0.3194,0.5347,0.8503,0.6422,0.3444,0.7391,0.5855,0.6656,0.251,0.9139,0.0638,0.2119,0.4823,0.217,0.926,0.9253,0.0057,0.9617,0.1991,0.3121,0.7161,0.0114,0.6533,0.8105,0.5518,0.9869,0.4121,0.9823,0.4395,0.0318,0.768,0.2839,0.4529,0.9052,0.9745,0.2362,0.0486,0.8374,0.3886,0.8172,0.741,0.6991,0.036,0.3226,0.063,0.2883,0.991,0.8138,0.2401,0.7248,0.1293,0.5341,0.0979,0.1515,0.8918,0.8148,0.7214,0.0064,0.3131,0.2795,0.3619,0.888,0.7252,0.8826,0.3099,0.7035,0.6432,0.0958,0.9884,0.7043,0.5817,0.4909,0.5086,0.8645,0.5877,0.6234,0.9142,0.6898,0.2168,0.8043,0.3472,0.425,0.4179,0.3321,0.3096,0.1062,0.6698,0.8206,0.5814,0.4181,0.9477,0.945,0.7407,0.23,0.944,0.4605,0.0085,0.0658,0.2179,0.1123,0.2009,0.9876,0.594,0.1172,0.0976,0.5746,0.1354,0.6862,0.5272,0.9888,0.4982,0.5684,0.2718,0.2762,0.2252,0.0748,0.588,0.9092,0.1296,0.7796,0.1598,0.2792,0.4378,0.8119,0.8418,0.8846,0.7566,0.897,0.1636,0.8176,0.5539,0.653,0.9552,0.9613,0.5586,0.3885,0.4936,0.7574,0.7361,0.8413,0.8368,0.4661,0.2283,0.8762,0.5714,0.4322,0.3671,0.1472,0.7651,0.3216,0.1734,0.6134,0.6207,0.887,0.8907,0.9434,0.007,0.7795,0.4126,0.03,0.9447,0.7258,0.6,0.3899,0.6793,0.1415,0.2825,0.8974,0.4371,0.9571,0.0509,0.0659,0.2498,0.4036,0.8437,0.0074,0.079,0.5223,0.3564,0.8577,0.9254,0.1011,0.2464,0.6689,0.0562,0.5883,0.7151,0.762,0.3955,0.2445,0.9193,0.4129,0.2566,0.5088,0.2235,0.5324,0.8977,0.6386,0.8637,0.2856,0.6923,0.7254,0.1028,0.636,0.142,0.9559,0.2591,0.0607,0.0727,0.3651,0.0463,0.8025,0.5628,0.8259,0.9952,0.1004,0.257,0.4074,0.2763,0.6472,0.3025,0.8747,0.7962,0.6855,0.0278,0.868,0.6689,0.7262,0.7697,0.7497,0.7734,0.9676,0.9937,0.48,0.797,0.0644,0.6102,0.8518,0.2148,0.3738,0.1889,0.9631,0.1523,0.4657,0.9009,0.9902,0.0428,0.6099,0.2956,0.6107,0.833,0.0535,0.1525,0.7647,0.1399,0.3481,0.5527,0.2088,0.6927,0.9306,0.8289,0.0793,0.968,0.6281,0.6749,0.0154,0.5556,0.2662,0.6166,0.8648,0.4421,0.4351,0.6785,0.4847,0.4407,0.6512,0.0805,0.3131,0.4284,0.6061,0.6041,0.4442,0.8307,0.8457,0.3753,0.9167,0.0309,0.6704,0.3434,0.6221,0.4775,0.4056,0.1839,0.5543,0.0941,0.9824,0.8676,0.0371,0.8058,0.7599,0.1563,0.5789,0.9284,0.1939,0.2044,0.2243,0.6263,0.3999,0.182,0.827,0.3222,0.0282,0.1454,0.4375,0.6757,0.9729,0.2784,0.8661,0.7622,0.4278,0.0347,0.424,0.9505,0.3369,0.672,0.9906,0.7929,0.1693,0.331,0.6651,0.6789,0.1528,0.7555,0.614,0.7869,0.4001,0.8137,0.9776,0.6198,0.0392,0.9148,0.0848,0.3744,0.2993,0.8857,0.3694,0.7815,0.2154,0.3029,0.0947,0.8961,0.7702,0.254,0.3831,0.9249,0.5934,0.6188,0.3827,0.2003,0.5737,0.2985,0.101,0.7643,0.6723,0.5988,0.1135,0.4158,0.7408,0.6224,0.4198,0.0568,0.9164,0.2059,0.5147,0.5703,0.4238,0.2946,0.6776,0.0686,0.4713,0.1251,0.8931,0.0811,0.5038,0.4241,0.1563,0.8963,0.0721,0.298,0.9438,0.6573,0.5976,0.7166,0.4108,0.3911,0.2334,0.4462,0.0663,0.0604,0.4133,0.6903,0.7688,0.7214,0.4726,0.9049,0.436,0.41,0.9987,0.1554,0.992,0.74,0.4711,0.519,0.8485,0.1327,0.0469,0.6302,0.3825,0.9166,0.772,0.8922,0.4375,0.3932,0.8178,0.8188,0.9407,0.7135,0.7462,0.8868,0.6768,0.9397,0.926,0.4137,0.9568,0.4069,0.9868,0.7933,0.9143,0.3485,0.9795,0.7328,0.0945,0.1452,0.9786,0.9843,0.5101,0.4301,0.2824,0.0493,0.5007,0.4481,0.5521,0.6148,0.8093,0.8441,0.9365,0.7805,0.8751,0.4443,0.087,0.5383,0.0003,0.7798,0.4493,0.9333,0.5676,0.2795,0.7304,0.5408,0.7761,0.303,0.5674,0.928,0.2394,0.0487,0.726,0.5301,0.8477,0.3277,0.3317,0.8126,0.2363,0.5761,0.2746,0.4832,0.727,0.3784,0.6091,0.0187,0.2588,0.882,0.9444,0.7507,0.5016,0.6306,0.0112,0.487,0.2327,0.6466,0.176,0.8498,0.446,0.9981,0.6938,0.1061,0.6321,0.2844,0.1317,0.8236,0.0733,0.5209,0.348,0.5522,0.9919,0.4695,0.9812,0.3099,0.3258,0.3347,0.9278,0.412,0.1369,0.4122,0.1051,0.0543,0.2375,0.5395,0.1649,0.4772,0.1995,0.1337,0.2268,0.1326,0.9968,0.3018,0.1178,0.3415,0.2377,0.06,0.0875,0.0982,0.5086,0.1527,0.6387,0.9283,0.1022,0.3857,0.414,0.9132,0.8521,0.2351,0.4167,0.833,0.8266,0.0571,0.5845,0.9349,0.4278,0.2776,0.1443,0.4486,0.6585,0.0219,0.8685,0.6556,0.1074,0.2489,0.3227,0.1452,0.1606,0.4723,0.4534,0.0612,0.057,0.1314,0.0228,0.6602,0.7333,0.1328,0.9615,0.2122,0.2537,0.3698,0.1872,0.763,0.4831,0.1406,0.3955,0.2508,0.4464,0.4894,0.9498,0.8169,0.2652,0.1047,0.1143,0.7245,0.4817,0.4996,0.7072,0.7496,0.299,0.4091,0.9324,0.3108,0.5083,0.109,0.7436,0.0897,0.6952,0.6436,0.1437,0.7386,0.5856,0.5937,0.2951,0.4542,0.1589,0.5544,0.2534,0.0739,0.14,0.2568,0.6934,0.5708,0.9553,0.8789,0.9826,0.5974,0.8951,0.8759,0.6194,0.0202,0.8014,0.0642,0.5914,0.8208,0.4535,0.2905,0.7337,0.1469,0.6039,0.9247,0.715,0.6114,0.0771,0.0705,0.8218,0.5859,0.18,0.3217,0.3239,0.6851,0.1655,0.5922,0.3081,0.5629,0.9022,0.2418,0.0819,0.2615,0.641,0.1999,0.5359,0.927,0.4222,0.5213,0.8224,0.1009,0.5579,0.5871,0.5073,0.4897,0.437,0.0114,0.6831,0.309,0.5452,0.0693,0.7627,0.9583,0.124,0.3954,0.1293,0.8475,0.5706,0.5776,0.1612,0.545,0.7548,0.0899,0.3556,0.8946,0.4429,0.4469,0.9418,0.4,0.1681,0.7256,0.8084,0.7394,0.9708,0.0846,0.4576,0.8512,0.6136,0.5784,0.0939,0.2995,0.9058,0.7067,0.085,0.7864,0.8161,0.9557,0.2447,0.649,0.1951,0.6237,0.0743,0.6856,0.291,0.9134,0.173,0.0025,0.6371,0.9671,0.154,0.9883,0.1503,0.1793,0.1591,0.2612,0.1705,0.841,0.4688,0.3839,0.5215,0.281,0.8627,0.8278,0.0517,0.8775,0.6449,0.1081,0.5755,0.5445,0.9239,0.9787,0.6199,0.1412,0.9029,0.2881,0.5462,0.6363,0.9249,0.796,0.4738,0.1726,0.5846,0.0856,0.3636,0.8584,0.8387,0.164,0.8952,0.53,0.6322,0.0489,0.2358,0.9497,0.4902,0.592,0.8213,0.7136,0.3539,0.5065,0.9159,0.2661,0.563,0.7803,0.1301,0.6343,0.6879,0.2963,0.9397,0.4754,0.3693,0.7565,0.3544,0.2608,0.5617,0.1611,0.0855,0.6621,0.7868,0.4519,0.4613,0.4976,0.7859,0.8085,0.9788,0.6964,0.1827,0.1639,0.3483,0.6898,0.0894,0.7378,0.0174,0.0029,0.0386,0.3781,0.6706,0.9362,0.6968,0.3872,0.8388,0.8396,0.351,0.5523,0.2384,0.2632,0.117,0.4028,0.713,0.2104,0.4866,0.3035,0.733,0.2618,0.5406,0.0124,0.9695,0.3853,0.4778,0.9187,0.0964,0.3701,0.5714,0.3085,0.8019,0.7152,0.3308,0.2053,0.4499,0.6533,0.2487,0.6096,0.591,0.1496,0.4321,0.7789,0.7424,0.3079,0.4964,0.3447,0.8943,0.8536,0.9192,0.6646,0.0922,0.16,0.7667,0.7773,0.0684,0.1174,0.7001,0.4476,0.8931,0.5955,0.5954,0.5763,0.4092,0.9641,0.1512,0.0738,0.7627,0.9389,0.1392,0.1969,0.3466,0.7956,0.7575,0.3274,0.3041,0.6456,0.43,0.402,0.616,0.6972,0.751,0.7622,0.2068,0.5653,0.4153,0.4084,0.4761,0.2184,0.6614,0.1447,0.3183,0.0164,0.1355,0.6388,0.3451,0.9447,0.9413,0.4245,0.8907,0.9453,0.896,0.6004,0.3882,0.788,0.2996,0.8573,0.4216,0.7003,0.3321,0.5996,0.5513,0.2283,0.9074,0.1509,0.9958,0.4472,0.859,0.9503,0.7216,0.6672,0.1519,0.1936,0.3521,0.6367,0.6206,0.1128,0.3179,0.0443,0.9433,0.0654,0.1664,0.4772,0.0561,0.9892,0.3227,0.0398,0.2798,0.0524,0.6726,0.6542,0.598,0.8769,0.4324,0.4425,0.945,0.0373,0.9161,0.6199,0.1403,0.4571,0.9342,0.5495,0.6281,0.6893,0.8918,0.3115,0.7789,0.4853,0.1764,0.751,0.23,0.8355,0.5944,0.4982,0.1082,0.8092,0.7252,0.6303,0.1247,0.0419,0.7342,0.6348,0.5897,0.3751,0.3716,0.0803,0.4605,0.5662,0.7688,0.5284,0.1278,0.1164,0.1075,0.5845,0.4687,0.6334,0.5452,0.2327,0.8769,0.4229,0.1113,0.6952,0.9924,0.0066,0.9144,0.5534,0.3849,0.8319,0.3659,0.3603,0.0178,0.1654,0.3058,0.7377,0.5487,0.999,0.2057,0.8183,0.5708,0.1421,0.225,0.421,0.124,0.0599,0.1035,0.1859,0.3338,0.9649,0.27,0.9596,0.1255,0.6739,0.2705,0.4862,0.1424,0.374,0.3705,0.9245,0.3598,0.7942,0.8436,0.5835,0.3132,0.1135,0.0173,0.4772,0.6745,0.9823,0.4468,0.2052,0.5155,0.734,0.58,0.2903,0.1656,0.4173,0.9242,0.2693,0.4175,0.8921,0.6974,0.9519,0.8078,0.2327,0.3994,0.8152,0.9376,0.5792,0.8039,0.5321,0.9221,0.1676,0.4475,0.8912,0.751,0.325,0.446,0.1581,0.2194,0.1309,0.0341,0.5868,0.416,0.4356,0.8981,0.7565,0.7062,0.6351,0.0871,0.9273,0.2102,0.5417,0.142,0.4068,0.8922,0.7098,0.2897,0.2895,0.1894,0.0905,0.1354,0.8021,0.999]	[0.1651,0.9447,0.1219,0.9098,0.334,0.4938,0.4499,0.1343,0.4944,0.764,0.712,0.2489,0.7138,0.9116,0.4046,0.4013,0.3752,0.8242,0.17,0.468,0.669,0.8567,0.8183,0.4377,0.5894,0.257,0.5013,0.3903,0.2475,0.0892,0.1876,0.7388,0.3033,0.5815,0.5352,0.6669,0.6399,0.83,0.2696,0.6268,0.4751,0.4371,0.3138,0.6928,0.8734,0.3575,0.6715,0.7002,0.1603,0.4197,0.1037,0.4058,0.2166,0.4182,0.7625,0.0153,0.498,0.0982,0.4915,0.7371,0.4158,0.5397,0.8387,0.8215,0.6089,0.0509,0.1688,0.4506,0.1918,0.8876,0.6544,0.1997,0.1043,0.4782,0.8528,0.7881,0.8931,0.8958,0.1365,0.5794,0.6454,0.7675,0.2258,0.4677,0.7109,0.8194,0.2016,0.1017,0.8376,0.3855,0.1484,0.1392,0.1823,0.6945,0.0509,0.6606,0.1309,0.4509,0.8678,0.7254,0.7455,0.0767,0.4976,0.9163,0.2879,0.7348,0.8366,0.1852,0.1956,0.8501,0.6786,0.5209,0.5233,0.934,0.2521,0.9,0.7415,0.7404,0.883,0.1677,0.7813,0.3101,0.5896,0.1117,0.036,0.4607,0.0984,0.2083,0.5292,0.191,0.338,0.3986,0.3836,0.7638,0.9403,0.9969,0.2148,0.8687,0.8863,0.2218,0.4568,0.9339,0.1151,0.4438,0.0777,0.5825,0.3531,0.1247,0.361,0.3164,0.4411,0.313,0.0739,0.856,0.4632,0.8198,0.1998,0.0564,0.773,0.8153,0.6908,0.6937,0.8416,0.5767,0.4434,0.3397,0.4529,0.7242,0.2985,0.2114,0.9761,0.9299,0.4233,0.1137,0.5069,0.5238,0.9844,0.4992,0.5568,0.3663,0.735,0.876,0.4232,0.4414,0.9077,0.3692,0.3224,0.2625,0.9156,0.3491,0.4182,0.6851,0.1836,0.3391,0.5654,0.2076,0.2739,0.179,0.5129,0.1795,0.7427,0.0008,0.7228,0.0949,0.2575,0.4227,0.115,0.0207,0.204,0.6756,0.8401,0.3397,0.1594,0.0473,0.8833,0.3981,0.5568,0.5072,0.7729,0.44,0.3705,0.572,0.1275,0.4437,0.7436,0.1872,0.6891,0.5039,0.9372,0.6813,0.2956,0.9497,0.1485,0.1762,0.7039,0.9212,0.8185,0.0003,0.8498,0.7087,0.8831,0.8267,0.5578,0.7551,0.1049,0.7303,0.3309,0.1898,0.1116,0.0802,0.3723,0.0321,0.2708,0.9847,0.1248,0.116,0.5785,0.5291,0.4283,0.8839,0.2531,0.7398,0.7043,0.4759,0.7807,0.6451,0.0464,0.7886,0.975,0.2608,0.5232,0.8371,0.2867,0.9898,0.7684,0.2661,0.5889,0.0149,0.4375,0.6857,0.5623,0.1003,0.6018,0.804,0.7461,0.9412,0.8548,0.0983,0.9895,0.3047,0.9348,0.647,0.8539,0.724,0.7313,0.4603,0.9246,0.8187,0.0932,0.7262,0.7397,0.3998,0.394,0.3199,0.4267,0.2596,0.7677,0.4163,0.1356,0.9103,0.531,0.2439,0.4459,0.8953,0.1128,0.7956,0.8214,0.8081,0.0125,0.4517,0.6296,0.4989,0.9453,0.1701,0.5153,0.6392,0.481,0.2128,0.215,0.0987,0.1653,0.4948,0.1278,0.6621,0.4848,0.635,0.5835,0.7585,0.667,0.6624,0.7131,0.9035,0.8382,0.7798,0.952,0.3972,0.7176,0.8799,0.0122,0.3307,0.5342,0.3394,0.7908,0.1634,0.0299,0.0371,0.8999,0.2304,0.1286,0.9903,0.8956,0.3709,0.5712,0.3363,0.2799,0.7156,0.3674,0.9281,0.464,0.6772,0.1033,0.0913,0.2379,0.5202,0.1661,0.7074,0.3093,0.5245,0.9559,0.3146,0.4299,0.3699,0.37,0.3522,0.8816,0.9986,0.1173,0.0959,0.4863,0.7684,0.4798,0.6114,0.5015,0.2819,0.8933,0.3813,0.6416,0.8488,0.5623,0.4896,0.2047,0.2393,0.8895,0.2907,0.4986,0.7043,0.4177,0.6881,0.2395,0.1183,0.5224,0.9598,0.4609,0.0585,0.7957,0.4639,0.2279,0.8205,0.2386,0.8175,0.6454,0.814,0.66,0.4213,0.2125,0.9726,0.2357,0.5321,0.7334,0.9251,0.2792,0.6319,0.3194,0.5347,0.8503,0.6422,0.3444,0.7391,0.5855,0.6656,0.251,0.9139,0.0638,0.2119,0.4823,0.217,0.926,0.9253,0.0057,0.9617,0.1991,0.3121,0.7161,0.0114,0.6533,0.8105,0.5518,0.9869,0.4121,0.9823,0.4395,0.0318,0.768,0.2839,0.4529,0.9052,0.9745,0.2362,0.0486,0.8374,0.3886,0.8172,0.741,0.6991,0.036,0.3226,0.063,0.2883,0.991,0.8138,0.2401,0.7248,0.1293,0.5341,0.0979,0.1515,0.8918,0.8148,0.7214,0.0064,0.3131,0.2795,0.3619,0.888,0.7252,0.8826,0.3099,0.7035,0.6432,0.0958,0.9884,0.7043,0.5817,0.4909,0.5086,0.8645,0.5877,0.6234,0.9142,0.6898,0.2168,0.8043,0.3472,0.425,0.4179,0.3321,0.3096,0.1062,0.6698,0.8206,0.5814,0.4181,0.9477,0.945,0.7407,0.23,0.944,0.4605,0.0085,0.0658,0.2179,0.1123,0.2009,0.9876,0.594,0.1172,0.0976,0.5746,0.1354,0.6862,0.5272,0.9888,0.4982,0.5684,0.2718,0.2762,0.2252,0.0748,0.588,0.9092,0.1296,0.7796,0.1598,0.2792,0.4378,0.8119,0.8418,0.8846,0.7566,0.897,0.1636,0.8176,0.5539,0.653,0.9552,0.9613,0.5586,0.3885,0.4936,0.7574,0.7361,0.8413,0.8368,0.4661,0.2283,0.8762,0.5714,0.4322,0.3671,0.1472,0.7651,0.3216,0.1734,0.6134,0.6207,0.887,0.8907,0.9434,0.007,0.7795,0.4126,0.03,0.9447,0.7258,0.6,0.3899,0.6793,0.1415,0.2825,0.8974,0.4371,0.9571,0.0509,0.0659,0.2498,0.4036,0.8437,0.0074,0.079,0.5223,0.3564,0.8577,0.9254,0.1011,0.2464,0.6689,0.0562,0.5883,0.7151,0.762,0.3955,0.2445,0.9193,0.4129,0.2566,0.5088,0.2235,0.5324,0.8977,0.6386,0.8637,0.2856,0.6923,0.7254,0.1028,0.636,0.142,0.9559,0.2591,0.0607,0.0727,0.3651,0.0463,0.8025,0.5628,0.8259,0.9952,0.1004,0.257,0.4074,0.2763,0.6472,0.3025,0.8747,0.7962,0.6855,0.0278,0.868,0.6689,0.7262,0.7697,0.7497,0.7734,0.9676,0.9937,0.48,0.797,0.0644,0.6102,0.8518,0.2148,0.3738,0.1889,0.9631,0.1523,0.4657,0.9009,0.9902,0.0428,0.6099,0.2956,0.6107,0.833,0.0535,0.1525,0.7647,0.1399,0.3481,0.5527,0.2088,0.6927,0.9306,0.8289,0.0793,0.968,0.6281,0.6749,0.0154,0.5556,0.2662,0.6166,0.8648,0.4421,0.4351,0.6785,0.4847,0.4407,0.6512,0.0805,0.3131,0.4284,0.6061,0.6041,0.4442,0.8307,0.8457,0.3753,0.9167,0.0309,0.6704,0.3434,0.6221,0.4775,0.4056,0.1839,0.5543,0.0941,0.9824,0.8676,0.0371,0.8058,0.7599,0.1563,0.5789,0.9284,0.1939,0.2044,0.2243,0.6263,0.3999,0.182,0.827,0.3222,0.0282,0.1454,0.4375,0.6757,0.9729,0.2784,0.8661,0.7622,0.4278,0.0347,0.424,0.9505,0.3369,0.672,0.9906,0.7929,0.1693,0.331,0.6651,0.6789,0.1528,0.7555,0.614,0.7869,0.4001,0.8137,0.9776,0.6198,0.0392,0.9148,0.0848,0.3744,0.2993,0.8857,0.3694,0.7815,0.2154,0.3029,0.0947,0.8961,0.7702,0.254,0.3831,0.9249,0.5934,0.6188,0.3827,0.2003,0.5737,0.2985,0.101,0.7643,0.6723,0.5988,0.1135,0.4158,0.7408,0.6224,0.4198,0.0568,0.9164,0.2059,0.5147,0.5703,0.4238,0.2946,0.6776,0.0686,0.4713,0.1251,0.8931,0.0811,0.5038,0.4241,0.1563,0.8963,0.0721,0.298,0.9438,0.6573,0.5976,0.7166,0.4108,0.3911,0.2334,0.4462,0.0663,0.0604,0.4133,0.6903,0.7688,0.7214,0.4726,0.9049,0.436,0.41,0.9987,0.1554,0.992,0.74,0.4711,0.519,0.8485,0.1327,0.0469,0.6302,0.3825,0.9166,0.772,0.8922,0.4375,0.3932,0.8178,0.8188,0.9407,0.7135,0.7462,0.8868,0.6768,0.9397,0.926,0.4137,0.9568,0.4069,0.9868,0.7933,0.9143,0.3485,0.9795,0.7328,0.0945,0.1452,0.9786,0.9843,0.5101,0.4301,0.2824,0.0493,0.5007,0.4481,0.5521,0.6148,0.8093,0.8441,0.9365,0.7805,0.8751,0.4443,0.087,0.5383,0.0003,0.7798,0.4493,0.9333,0.5676,0.2795,0.7304,0.5408,0.7761,0.303,0.5674,0.928,0.2394,0.0487,0.726,0.5301,0.8477,0.3277,0.3317,0.8126,0.2363,0.5761,0.2746,0.4832,0.727,0.3784,0.6091,0.0187,0.2588,0.882,0.9444,0.7507,0.5016,0.6306,0.0112,0.487,0.2327,0.6466,0.176,0.8498,0.446,0.9981,0.6938,0.1061,0.6321,0.2844,0.1317,0.8236,0.0733,0.5209,0.348,0.5522,0.9919,0.4695,0.9812,0.3099,0.3258,0.3347,0.9278,0.412,0.1369,0.4122,0.1051,0.0543,0.2375,0.5395,0.1649,0.4772,0.1995,0.1337,0.2268,0.1326,0.9968,0.3018,0.1178,0.3415,0.2377,0.06,0.0875,0.0982,0.5086,0.1527,0.6387,0.9283,0.1022,0.3857,0.414,0.9132,0.8521,0.2351,0.4167,0.833,0.8266,0.0571,0.5845,0.9349,0.4278,0.2776,0.1443,0.4486,0.6585,0.0219,0.8685,0.6556,0.1074,0.2489,0.3227,0.1452,0.1606,0.4723,0.4534,0.0612,0.057,0.1314,0.0228,0.6602,0.7333,0.1328,0.9615,0.2122,0.2537,0.3698,0.1872,0.763,0.4831,0.1406,0.3955,0.2508,0.4464,0.4894,0.9498,0.8169,0.2652,0.1047,0.1143,0.7245,0.4817,0.4996,0.7072,0.7496,0.299,0.4091,0.9324,0.3108,0.5083,0.109,0.7436,0.0897,0.6952,0.6436,0.1437,0.7386,0.5856,0.5937,0.2951,0.4542,0.1589,0.5544,0.2534,0.0739,0.14,0.2568,0.6934,0.5708,0.9553,0.8789,0.9826,0.5974,0.8951,0.8759,0.6194,0.0202,0.8014,0.0642,0.5914,0.8208,0.4535,0.2905,0.7337,0.1469,0.6039,0.9247,0.715,0.6114,0.0771,0.0705,0.8218,0.5859,0.18,0.3217,0.3239,0.6851,0.1655,0.5922,0.3081,0.5629,0.9022,0.2418,0.0819,0.2615,0.641,0.1999,0.5359,0.927,0.4222,0.5213,0.8224,0.1009,0.5579,0.5871,0.5073,0.4897,0.437,0.0114,0.6831,0.309,0.5452,0.0693,0.7627,0.9583,0.124,0.3954,0.1293,0.8475,0.5706,0.5776,0.1612,0.545,0.7548,0.0899,0.3556,0.8946,0.4429,0.4469,0.9418,0.4,0.1681,0.7256,0.8084,0.7394,0.9708,0.0846,0.4576,0.8512,0.6136,0.5784,0.0939,0.2995,0.9058,0.7067,0.085,0.7864,0.8161,0.9557,0.2447,0.649,0.1951,0.6237,0.0743,0.6856,0.291,0.9134,0.173,0.0025,0.6371,0.9671,0.154,0.9883,0.1503,0.1793,0.1591,0.2612,0.1705,0.841,0.4688,0.3839,0.5215,0.281,0.8627,0.8278,0.0517,0.8775,0.6449,0.1081,0.5755,0.5445,0.9239,0.9787,0.6199,0.1412,0.9029,0.2881,0.5462,0.6363,0.9249,0.796,0.4738,0.1726,0.5846,0.0856,0.3636,0.8584,0.8387,0.164,0.8952,0.53,0.6322,0.0489,0.2358,0.9497,0.4902,0.592,0.8213,0.7136,0.3539,0.5065,0.9159,0.2661,0.563,0.7803,0.1301,0.6343,0.6879,0.2963,0.9397,0.4754,0.3693,0.7565,0.3544,0.2608,0.5617,0.1611,0.0855,0.6621,0.7868,0.4519,0.4613,0.4976,0.7859,0.8085,0.9788,0.6964,0.1827,0.1639,0.3483,0.6898,0.0894,0.7378,0.0174,0.0029,0.0386,0.3781,0.6706,0.9362,0.6968,0.3872,0.8388,0.8396,0.351,0.5523,0.2384,0.2632,0.117,0.4028,0.713,0.2104,0.4866,0.3035,0.733,0.2618,0.5406,0.0124,0.9695,0.3853,0.4778,0.9187,0.0964,0.3701,0.5714,0.3085,0.8019,0.7152,0.3308,0.2053,0.4499,0.6533,0.2487,0.6096,0.591,0.1496,0.4321,0.7789,0.7424,0.3079,0.4964,0.3447,0.8943,0.8536,0.9192,0.6646,0.0922,0.16,0.7667,0.7773,0.0684,0.1174,0.7001,0.4476,0.8931,0.5955,0.5954,0.5763,0.4092,0.9641,0.1512,0.0738,0.7627,0.9389,0.1392,0.1969,0.3466,0.7956,0.7575,0.3274,0.3041,0.6456,0.43,0.402,0.616,0.6972,0.751,0.7622,0.2068,0.5653,0.4153,0.4084,0.4761,0.2184,0.6614,0.1447,0.3183,0.0164,0.1355,0.6388,0.3451,0.9447,0.9413,0.4245,0.8907,0.9453,0.896,0.6004,0.3882,0.788,0.2996,0.8573,0.4216,0.7003,0.3321,0.5996,0.5513,0.2283,0.9074,0.1509,0.9958,0.4472,0.859,0.9503,0.7216,0.6672,0.1519,0.1936,0.3521,0.6367,0.6206,0.1128,0.3179,0.0443,0.9433,0.0654,0.1664,0.4772,0.0561,0.9892,0.3227,0.0398,0.2798,0.0524,0.6726,0.6542,0.598,0.8769,0.4324,0.4425,0.945,0.0373,0.9161,0.6199,0.1403,0.4571,0.9342,0.5495,0.6281,0.6893,0.8918,0.3115,0.7789,0.4853,0.1764,0.751,0.23,0.8355,0.5944,0.4982,0.1082,0.8092,0.7252,0.6303,0.1247,0.0419,0.7342,0.6348,0.5897,0.3751,0.3716,0.0803,0.4605,0.5662,0.7688,0.5284,0.1278,0.1164,0.1075,0.5845,0.4687,0.6334,0.5452,0.2327,0.8769,0.4229,0.1113,0.6952,0.9924,0.0066,0.9144,0.5534,0.3849,0.8319,0.3659,0.3603,0.0178,0.1654,0.3058,0.7377,0.5487,0.999,0.2057,0.8183,0.5708,0.1421,0.225,0.421,0.124,0.0599,0.1035,0.1859,0.3338,0.9649,0.27,0.9596,0.1255,0.6739,0.2705,0.4862,0.1424,0.374,0.3705,0.9245,0.3598,0.7942,0.8436,0.5835,0.3132,0.1135,0.0173,0.4772,0.6745,0.9823,0.4468,0.2052,0.5155,0.734,0.58,0.2903,0.1656,0.4173,0.9242,0.2693,0.4175,0.8921,0.6974,0.9519,0.8078,0.2327,0.3994,0.8152,0.9376,0.5792,0.8039,0.5321,0.9221,0.1676,0.4475,0.8912,0.751,0.325,0.446,0.1581,0.2194,0.1309,0.0341,0.5868,0.416,0.4356,0.8981,0.7565,0.7062,0.6351,0.0871,0.9273,0.2102,0.5417,0.142,0.4068,0.8922,0.7098,0.2897,0.2895,0.1894,0.0905,0.1354,0.8021,0.999]	2	1	2025-11-10 21:26:06.992169+00	3
\.


--
-- Data for Name: Entity; Type: TABLE DATA; Schema: graph_liq; Owner: postgres
--

COPY graph_liq."Entity" (id, properties) FROM stdin;
2251799813685250	{"uid": "entity:beta", "kind": "Thing"}
2251799813685249	{"uid": "entity:alpha", "kind": "Thing", "props": {"name": "Alpha", "score": 0.73::numeric}}
2251799813685251	{"uid": "demo:a", "kind": "Thing"}
2251799813685252	{"uid": "demo:b", "kind": "Thing"}
2251799813685253	{"uid": "demo:a"}
2251799813685254	{"uid": "demo:a"}
2251799813685255	{"uid": "demo:b"}
\.


--
-- Data for Name: REL; Type: TABLE DATA; Schema: graph_liq; Owner: postgres
--

COPY graph_liq."REL" (id, start_id, end_id, properties) FROM stdin;
2533274790395905	2251799813685249	2251799813685250	{"rel": "CONNECTS_TO", "props": {"ts": "2025-11-05T20:00:00Z", "confidence": 0.92::numeric}}
2533274790395906	2251799813685251	2251799813685252	{"rel": "CONNECTS_TO"}
2533274790395907	2251799813685251	2251799813685250	{"rel": "MENTIONS"}
\.


--
-- Data for Name: _ag_label_edge; Type: TABLE DATA; Schema: graph_liq; Owner: postgres
--

COPY graph_liq._ag_label_edge (id, start_id, end_id, properties) FROM stdin;
\.


--
-- Data for Name: _ag_label_vertex; Type: TABLE DATA; Schema: graph_liq; Owner: postgres
--

COPY graph_liq._ag_label_vertex (id, properties) FROM stdin;
\.


--
-- Data for Name: ai_embed; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ai_embed (id, label, emb) FROM stdin;
\.


--
-- Data for Name: geo_place; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.geo_place (id, name, geom) FROM stdin;
1	HQ	0101000020E6100000E3A59BC420E855C054E3A59BC4F04440
2	Shop	0101000020E610000048E17A14AEE755C06F1283C0CAF14440
\.


--
-- Data for Name: spatial_ref_sys; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) FROM stdin;
\.


--
-- Data for Name: ts_chunk_usage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ts_chunk_usage (hypertable, chunk, first_seen_at, last_access_at, access_count) FROM stdin;
\.


--
-- Data for Name: ts_metric; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ts_metric (id, ts, series, value) FROM stdin;
\.


--
-- Data for Name: ts_usage_policy; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ts_usage_policy (hypertable, compress_after, drop_if_older_than, drop_only_if_never_accessed) FROM stdin;
public.ts_metric	7 days	90 days	t
\.


--
-- Data for Name: topology; Type: TABLE DATA; Schema: topology; Owner: postgres
--

COPY topology.topology (id, name, srid, "precision", hasz) FROM stdin;
\.


--
-- Data for Name: layer; Type: TABLE DATA; Schema: topology; Owner: postgres
--

COPY topology.layer (topology_id, layer_id, schema_name, table_name, feature_column, feature_type, level, child_id) FROM stdin;
\.


--
-- Name: chunk_column_stats_id_seq; Type: SEQUENCE SET; Schema: _timescaledb_catalog; Owner: postgres
--

SELECT pg_catalog.setval('_timescaledb_catalog.chunk_column_stats_id_seq', 1, false);


--
-- Name: chunk_constraint_name; Type: SEQUENCE SET; Schema: _timescaledb_catalog; Owner: postgres
--

SELECT pg_catalog.setval('_timescaledb_catalog.chunk_constraint_name', 3, true);


--
-- Name: chunk_id_seq; Type: SEQUENCE SET; Schema: _timescaledb_catalog; Owner: postgres
--

SELECT pg_catalog.setval('_timescaledb_catalog.chunk_id_seq', 9, true);


--
-- Name: continuous_agg_migrate_plan_step_step_id_seq; Type: SEQUENCE SET; Schema: _timescaledb_catalog; Owner: postgres
--

SELECT pg_catalog.setval('_timescaledb_catalog.continuous_agg_migrate_plan_step_step_id_seq', 1, false);


--
-- Name: dimension_id_seq; Type: SEQUENCE SET; Schema: _timescaledb_catalog; Owner: postgres
--

SELECT pg_catalog.setval('_timescaledb_catalog.dimension_id_seq', 4, true);


--
-- Name: dimension_slice_id_seq; Type: SEQUENCE SET; Schema: _timescaledb_catalog; Owner: postgres
--

SELECT pg_catalog.setval('_timescaledb_catalog.dimension_slice_id_seq', 6, true);


--
-- Name: hypertable_id_seq; Type: SEQUENCE SET; Schema: _timescaledb_catalog; Owner: postgres
--

SELECT pg_catalog.setval('_timescaledb_catalog.hypertable_id_seq', 5, true);


--
-- Name: bgw_job_id_seq; Type: SEQUENCE SET; Schema: _timescaledb_config; Owner: postgres
--

SELECT pg_catalog.setval('_timescaledb_config.bgw_job_id_seq', 1003, true);


--
-- Name: rag_chunks_id_seq; Type: SEQUENCE SET; Schema: ag_catalog; Owner: postgres
--

SELECT pg_catalog.setval('ag_catalog.rag_chunks_id_seq', 10, true);


--
-- Name: Entity_id_seq; Type: SEQUENCE SET; Schema: graph_liq; Owner: postgres
--

SELECT pg_catalog.setval('graph_liq."Entity_id_seq"', 7, true);


--
-- Name: REL_id_seq; Type: SEQUENCE SET; Schema: graph_liq; Owner: postgres
--

SELECT pg_catalog.setval('graph_liq."REL_id_seq"', 3, true);


--
-- Name: _ag_label_edge_id_seq; Type: SEQUENCE SET; Schema: graph_liq; Owner: postgres
--

SELECT pg_catalog.setval('graph_liq._ag_label_edge_id_seq', 1, false);


--
-- Name: _ag_label_vertex_id_seq; Type: SEQUENCE SET; Schema: graph_liq; Owner: postgres
--

SELECT pg_catalog.setval('graph_liq._ag_label_vertex_id_seq', 1, false);


--
-- Name: _label_id_seq; Type: SEQUENCE SET; Schema: graph_liq; Owner: postgres
--

SELECT pg_catalog.setval('graph_liq._label_id_seq', 9, true);


--
-- Name: ai_embed_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ai_embed_id_seq', 1, false);


--
-- Name: geo_place_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.geo_place_id_seq', 2, true);


--
-- Name: ts_metric_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ts_metric_id_seq', 10085, true);


--
-- Name: topology_id_seq; Type: SEQUENCE SET; Schema: topology; Owner: postgres
--

SELECT pg_catalog.setval('topology.topology_id_seq', 1, false);


--
-- Name: _hyper_2_1_chunk 1_1_ts_metric_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_2_1_chunk
    ADD CONSTRAINT "1_1_ts_metric_pkey" PRIMARY KEY (ts, id);


--
-- Name: _hyper_2_2_chunk 2_2_ts_metric_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_2_2_chunk
    ADD CONSTRAINT "2_2_ts_metric_pkey" PRIMARY KEY (ts, id);


--
-- Name: _hyper_2_3_chunk 3_3_ts_metric_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_2_3_chunk
    ADD CONSTRAINT "3_3_ts_metric_pkey" PRIMARY KEY (ts, id);


--
-- Name: _tmp_vec _tmp_vec_pkey; Type: CONSTRAINT; Schema: ag_catalog; Owner: postgres
--

ALTER TABLE ONLY ag_catalog._tmp_vec
    ADD CONSTRAINT _tmp_vec_pkey PRIMARY KEY (id);


--
-- Name: rag_chunks rag_chunks_pkey; Type: CONSTRAINT; Schema: ag_catalog; Owner: postgres
--

ALTER TABLE ONLY ag_catalog.rag_chunks
    ADD CONSTRAINT rag_chunks_pkey PRIMARY KEY (id);


--
-- Name: rag_embeddings rag_embeddings_pkey; Type: CONSTRAINT; Schema: ag_catalog; Owner: postgres
--

ALTER TABLE ONLY ag_catalog.rag_embeddings
    ADD CONSTRAINT rag_embeddings_pkey PRIMARY KEY (chunk_id);


--
-- Name: _ag_label_edge _ag_label_edge_pkey; Type: CONSTRAINT; Schema: graph_liq; Owner: postgres
--

ALTER TABLE ONLY graph_liq._ag_label_edge
    ADD CONSTRAINT _ag_label_edge_pkey PRIMARY KEY (id);


--
-- Name: _ag_label_vertex _ag_label_vertex_pkey; Type: CONSTRAINT; Schema: graph_liq; Owner: postgres
--

ALTER TABLE ONLY graph_liq._ag_label_vertex
    ADD CONSTRAINT _ag_label_vertex_pkey PRIMARY KEY (id);


--
-- Name: ai_embed ai_embed_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_embed
    ADD CONSTRAINT ai_embed_pkey PRIMARY KEY (id);


--
-- Name: geo_place geo_place_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.geo_place
    ADD CONSTRAINT geo_place_pkey PRIMARY KEY (id);


--
-- Name: ts_chunk_usage ts_chunk_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ts_chunk_usage
    ADD CONSTRAINT ts_chunk_usage_pkey PRIMARY KEY (chunk);


--
-- Name: ts_metric ts_metric_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ts_metric
    ADD CONSTRAINT ts_metric_pkey PRIMARY KEY (ts, id);


--
-- Name: ts_usage_policy ts_usage_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ts_usage_policy
    ADD CONSTRAINT ts_usage_policy_pkey PRIMARY KEY (hypertable);


--
-- Name: _hyper_2_1_chunk_ts_metric_series_ts_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_1_chunk_ts_metric_series_ts_idx ON _timescaledb_internal._hyper_2_1_chunk USING btree (series, ts DESC);


--
-- Name: _hyper_2_1_chunk_ts_metric_ts_brin; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_1_chunk_ts_metric_ts_brin ON _timescaledb_internal._hyper_2_1_chunk USING brin (ts);


--
-- Name: _hyper_2_1_chunk_ts_metric_ts_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_1_chunk_ts_metric_ts_idx ON _timescaledb_internal._hyper_2_1_chunk USING btree (ts DESC);


--
-- Name: _hyper_2_2_chunk_ts_metric_series_ts_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_2_chunk_ts_metric_series_ts_idx ON _timescaledb_internal._hyper_2_2_chunk USING btree (series, ts DESC);


--
-- Name: _hyper_2_2_chunk_ts_metric_ts_brin; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_2_chunk_ts_metric_ts_brin ON _timescaledb_internal._hyper_2_2_chunk USING brin (ts);


--
-- Name: _hyper_2_2_chunk_ts_metric_ts_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_2_chunk_ts_metric_ts_idx ON _timescaledb_internal._hyper_2_2_chunk USING btree (ts DESC);


--
-- Name: _hyper_2_3_chunk_ts_metric_series_ts_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_3_chunk_ts_metric_series_ts_idx ON _timescaledb_internal._hyper_2_3_chunk USING btree (series, ts DESC);


--
-- Name: _hyper_2_3_chunk_ts_metric_ts_brin; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_3_chunk_ts_metric_ts_brin ON _timescaledb_internal._hyper_2_3_chunk USING brin (ts);


--
-- Name: _hyper_2_3_chunk_ts_metric_ts_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_2_3_chunk_ts_metric_ts_idx ON _timescaledb_internal._hyper_2_3_chunk USING btree (ts DESC);


--
-- Name: _hyper_4_4_chunk__materialized_hypertable_4_bucket_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_4_4_chunk__materialized_hypertable_4_bucket_idx ON _timescaledb_internal._hyper_4_4_chunk USING btree (bucket DESC);


--
-- Name: _hyper_4_4_chunk__materialized_hypertable_4_series_bucket_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_4_4_chunk__materialized_hypertable_4_series_bucket_idx ON _timescaledb_internal._hyper_4_4_chunk USING btree (series, bucket DESC);


--
-- Name: _hyper_4_5_chunk__materialized_hypertable_4_bucket_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_4_5_chunk__materialized_hypertable_4_bucket_idx ON _timescaledb_internal._hyper_4_5_chunk USING btree (bucket DESC);


--
-- Name: _hyper_4_5_chunk__materialized_hypertable_4_series_bucket_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_4_5_chunk__materialized_hypertable_4_series_bucket_idx ON _timescaledb_internal._hyper_4_5_chunk USING btree (series, bucket DESC);


--
-- Name: _hyper_5_9_chunk__tmp_ts_ts_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_5_9_chunk__tmp_ts_ts_idx ON _timescaledb_internal._hyper_5_9_chunk USING btree (ts DESC);


--
-- Name: _materialized_hypertable_4_bucket_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _materialized_hypertable_4_bucket_idx ON _timescaledb_internal._materialized_hypertable_4 USING btree (bucket DESC);


--
-- Name: _materialized_hypertable_4_series_bucket_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _materialized_hypertable_4_series_bucket_idx ON _timescaledb_internal._materialized_hypertable_4 USING btree (series, bucket DESC);


--
-- Name: compress_hyper_3_6_chunk_series__ts_meta_min_1__ts_meta_max_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX compress_hyper_3_6_chunk_series__ts_meta_min_1__ts_meta_max_idx ON _timescaledb_internal.compress_hyper_3_6_chunk USING btree (series, _ts_meta_min_1 DESC, _ts_meta_max_1 DESC);


--
-- Name: compress_hyper_3_7_chunk_series__ts_meta_min_1__ts_meta_max_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX compress_hyper_3_7_chunk_series__ts_meta_min_1__ts_meta_max_idx ON _timescaledb_internal.compress_hyper_3_7_chunk USING btree (series, _ts_meta_min_1 DESC, _ts_meta_max_1 DESC);


--
-- Name: compress_hyper_3_8_chunk_series__ts_meta_min_1__ts_meta_max_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX compress_hyper_3_8_chunk_series__ts_meta_min_1__ts_meta_max_idx ON _timescaledb_internal.compress_hyper_3_8_chunk USING btree (series, _ts_meta_min_1 DESC, _ts_meta_max_1 DESC);


--
-- Name: _tmp_ts_ts_idx; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX _tmp_ts_ts_idx ON ag_catalog._tmp_ts USING btree (ts DESC);


--
-- Name: idx_rag_chunks_created_at; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_chunks_created_at ON ag_catalog.rag_chunks USING btree (created_at);


--
-- Name: idx_rag_emb_mag_hnsw_l2; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_emb_mag_hnsw_l2 ON ag_catalog.rag_embeddings USING hnsw (emb_mag public.vector_l2_ops) WITH (m='16', ef_construction='128');


--
-- Name: idx_rag_emb_unit_hnsw_cos; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_emb_unit_hnsw_cos ON ag_catalog.rag_embeddings USING hnsw (emb_unit public.vector_cosine_ops) WITH (m='16', ef_construction='128');


--
-- Name: idx_rag_embeddings_created_at; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_embeddings_created_at ON ag_catalog.rag_embeddings USING btree (created_at);


--
-- Name: idx_rag_embeddings_emb_cos; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_embeddings_emb_cos ON ag_catalog.rag_embeddings USING ivfflat (emb public.vector_cosine_ops) WITH (lists='100');


--
-- Name: idx_rag_embeddings_emb_l2; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_embeddings_emb_l2 ON ag_catalog.rag_embeddings USING ivfflat (emb) WITH (lists='100');


--
-- Name: idx_rag_embeddings_hnsw_cos; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_embeddings_hnsw_cos ON ag_catalog.rag_embeddings USING hnsw (emb public.vector_cosine_ops) WITH (m='16', ef_construction='128');


--
-- Name: idx_rag_embeddings_hnsw_l2; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_embeddings_hnsw_l2 ON ag_catalog.rag_embeddings USING hnsw (emb public.vector_l2_ops) WITH (m='16', ef_construction='128');


--
-- Name: idx_rag_embeddings_ivf_cos; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_embeddings_ivf_cos ON ag_catalog.rag_embeddings USING ivfflat (emb public.vector_cosine_ops) WITH (lists='200');


--
-- Name: idx_rag_embeddings_ivf_l2; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE INDEX idx_rag_embeddings_ivf_l2 ON ag_catalog.rag_embeddings USING ivfflat (emb) WITH (lists='200');


--
-- Name: rag_chunks_doc_id_uniq; Type: INDEX; Schema: ag_catalog; Owner: postgres
--

CREATE UNIQUE INDEX rag_chunks_doc_id_uniq ON ag_catalog.rag_chunks USING btree (doc_id);


--
-- Name: ai_embed_hnsw; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_embed_hnsw ON public.ai_embed USING hnsw (emb public.vector_l2_ops);


--
-- Name: geo_place_gix; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX geo_place_gix ON public.geo_place USING gist (geom);


--
-- Name: mv_gap_scores_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mv_gap_scores_idx ON public.mv_gap_scores USING btree (gap_score DESC, total_edges, uid);


--
-- Name: ts_metric_series_ts_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ts_metric_series_ts_idx ON public.ts_metric USING btree (series, ts DESC);


--
-- Name: ts_metric_ts_brin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ts_metric_ts_brin ON public.ts_metric USING brin (ts);


--
-- Name: ts_metric_ts_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ts_metric_ts_idx ON public.ts_metric USING btree (ts DESC);


--
-- Name: _hyper_2_1_chunk ts_cagg_invalidation_trigger; Type: TRIGGER; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TRIGGER ts_cagg_invalidation_trigger AFTER INSERT OR DELETE OR UPDATE ON _timescaledb_internal._hyper_2_1_chunk FOR EACH ROW EXECUTE FUNCTION _timescaledb_functions.continuous_agg_invalidation_trigger('2');


--
-- Name: _hyper_2_2_chunk ts_cagg_invalidation_trigger; Type: TRIGGER; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TRIGGER ts_cagg_invalidation_trigger AFTER INSERT OR DELETE OR UPDATE ON _timescaledb_internal._hyper_2_2_chunk FOR EACH ROW EXECUTE FUNCTION _timescaledb_functions.continuous_agg_invalidation_trigger('2');


--
-- Name: _hyper_2_3_chunk ts_cagg_invalidation_trigger; Type: TRIGGER; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TRIGGER ts_cagg_invalidation_trigger AFTER INSERT OR DELETE OR UPDATE ON _timescaledb_internal._hyper_2_3_chunk FOR EACH ROW EXECUTE FUNCTION _timescaledb_functions.continuous_agg_invalidation_trigger('2');


--
-- Name: _compressed_hypertable_3 ts_insert_blocker; Type: TRIGGER; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TRIGGER ts_insert_blocker BEFORE INSERT ON _timescaledb_internal._compressed_hypertable_3 FOR EACH ROW EXECUTE FUNCTION _timescaledb_functions.insert_blocker();


--
-- Name: _materialized_hypertable_4 ts_insert_blocker; Type: TRIGGER; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TRIGGER ts_insert_blocker BEFORE INSERT ON _timescaledb_internal._materialized_hypertable_4 FOR EACH ROW EXECUTE FUNCTION _timescaledb_functions.insert_blocker();


--
-- Name: _tmp_ts ts_insert_blocker; Type: TRIGGER; Schema: ag_catalog; Owner: postgres
--

CREATE TRIGGER ts_insert_blocker BEFORE INSERT ON ag_catalog._tmp_ts FOR EACH ROW EXECUTE FUNCTION _timescaledb_functions.insert_blocker();


--
-- Name: ts_metric ts_cagg_invalidation_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER ts_cagg_invalidation_trigger AFTER INSERT OR DELETE OR UPDATE ON public.ts_metric FOR EACH ROW EXECUTE FUNCTION _timescaledb_functions.continuous_agg_invalidation_trigger('2');


--
-- Name: ts_metric ts_insert_blocker; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER ts_insert_blocker BEFORE INSERT ON public.ts_metric FOR EACH ROW EXECUTE FUNCTION _timescaledb_functions.insert_blocker();


--
-- Name: rag_embeddings rag_embeddings_chunk_id_fkey; Type: FK CONSTRAINT; Schema: ag_catalog; Owner: postgres
--

ALTER TABLE ONLY ag_catalog.rag_embeddings
    ADD CONSTRAINT rag_embeddings_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES ag_catalog.rag_chunks(id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: liquidaity-user
--

GRANT USAGE ON SCHEMA public TO mcp;


--
-- Name: SCHEMA ag_catalog; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA ag_catalog TO mcp;


--
-- Name: SCHEMA api; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA api TO mcp;


--
-- Name: FUNCTION agtype_in(cstring); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_in(cstring) TO mcp;


--
-- Name: FUNCTION agtype_out(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_out(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_recv(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_recv(internal) TO mcp;


--
-- Name: FUNCTION agtype_send(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_send(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION graphid_in(cstring); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_in(cstring) TO mcp;


--
-- Name: FUNCTION graphid_out(ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_out(ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION graphid_recv(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_recv(internal) TO mcp;


--
-- Name: FUNCTION graphid_send(ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_send(ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION agtype_array_to_agtype(ag_catalog.agtype[]); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_array_to_agtype(ag_catalog.agtype[]) TO mcp;


--
-- Name: FUNCTION agtype_to_int4_array(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_int4_array(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_to_bool(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_bool(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_to_float8(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_float8(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_to_graphid(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_graphid(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_to_int2(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_int2(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_to_int4(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_int4(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_to_int8(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_int8(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_to_json(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_json(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_to_text(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_to_text(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION bool_to_agtype(boolean); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.bool_to_agtype(boolean) TO mcp;


--
-- Name: FUNCTION float8_to_agtype(double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.float8_to_agtype(double precision) TO mcp;


--
-- Name: FUNCTION graphid_to_agtype(ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_to_agtype(ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION int4_to_agtype(integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.int4_to_agtype(integer) TO mcp;


--
-- Name: FUNCTION int8_to_agtype(bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.int8_to_agtype(bigint) TO mcp;


--
-- Name: FUNCTION _ag_enforce_edge_uniqueness(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._ag_enforce_edge_uniqueness(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION _ag_enforce_edge_uniqueness2(ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._ag_enforce_edge_uniqueness2(ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION _ag_enforce_edge_uniqueness3(ag_catalog.graphid, ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._ag_enforce_edge_uniqueness3(ag_catalog.graphid, ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION _ag_enforce_edge_uniqueness4(ag_catalog.graphid, ag_catalog.graphid, ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._ag_enforce_edge_uniqueness4(ag_catalog.graphid, ag_catalog.graphid, ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION _agtype_build_edge(ag_catalog.graphid, ag_catalog.graphid, ag_catalog.graphid, cstring, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._agtype_build_edge(ag_catalog.graphid, ag_catalog.graphid, ag_catalog.graphid, cstring, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION _agtype_build_path(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._agtype_build_path(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION _agtype_build_vertex(ag_catalog.graphid, cstring, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._agtype_build_vertex(ag_catalog.graphid, cstring, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION _cypher_create_clause(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._cypher_create_clause(internal) TO mcp;


--
-- Name: FUNCTION _cypher_delete_clause(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._cypher_delete_clause(internal) TO mcp;


--
-- Name: FUNCTION _cypher_merge_clause(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._cypher_merge_clause(internal) TO mcp;


--
-- Name: FUNCTION _cypher_set_clause(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._cypher_set_clause(internal) TO mcp;


--
-- Name: FUNCTION _extract_label_id(ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._extract_label_id(ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION _graphid(label_id integer, entry_id bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._graphid(label_id integer, entry_id bigint) TO mcp;


--
-- Name: FUNCTION _label_id(graph_name name, label_name name); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._label_id(graph_name name, label_name name) TO mcp;


--
-- Name: FUNCTION _label_name(graph_oid oid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog._label_name(graph_oid oid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION age_abs(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_abs(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_acos(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_acos(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_agtype_float8_accum(double precision[], ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_agtype_float8_accum(double precision[], ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_agtype_larger_aggtransfn(ag_catalog.agtype, VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_agtype_larger_aggtransfn(ag_catalog.agtype, VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_agtype_smaller_aggtransfn(ag_catalog.agtype, VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_agtype_smaller_aggtransfn(ag_catalog.agtype, VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_agtype_sum(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_agtype_sum(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_asin(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_asin(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_atan(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_atan(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_atan2(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_atan2(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_build_vle_match_edge(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_build_vle_match_edge(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_ceil(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_ceil(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_collect_aggfinalfn(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_collect_aggfinalfn(internal) TO mcp;


--
-- Name: FUNCTION age_collect_aggtransfn(internal, VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_collect_aggtransfn(internal, VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_cos(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_cos(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_cot(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_cot(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_create_barbell_graph(graph_name name, graph_size integer, bridge_size integer, node_label name, node_properties ag_catalog.agtype, edge_label name, edge_properties ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_create_barbell_graph(graph_name name, graph_size integer, bridge_size integer, node_label name, node_properties ag_catalog.agtype, edge_label name, edge_properties ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_degrees(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_degrees(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_delete_global_graphs(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_delete_global_graphs(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_e(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_e() TO mcp;


--
-- Name: FUNCTION age_end_id(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_end_id(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_endnode(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_endnode(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_eq_tilde(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_eq_tilde(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_exists(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_exists(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_exp(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_exp(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_float8_stddev_pop_aggfinalfn(double precision[]); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_float8_stddev_pop_aggfinalfn(double precision[]) TO mcp;


--
-- Name: FUNCTION age_float8_stddev_samp_aggfinalfn(double precision[]); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_float8_stddev_samp_aggfinalfn(double precision[]) TO mcp;


--
-- Name: FUNCTION age_floor(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_floor(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_graph_stats(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_graph_stats(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_head(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_head(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_id(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_id(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_is_valid_label_name(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_is_valid_label_name(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_isempty(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_isempty(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_keys(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_keys(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_label(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_label(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_labels(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_labels(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_last(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_last(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_left(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_left(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_length(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_length(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_log(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_log(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_log10(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_log10(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_ltrim(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_ltrim(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_match_two_vle_edges(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_match_two_vle_edges(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_match_vle_edge_to_id_qual(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_match_vle_edge_to_id_qual(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_match_vle_terminal_edge(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_match_vle_terminal_edge(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_materialize_vle_edges(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_materialize_vle_edges(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_materialize_vle_path(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_materialize_vle_path(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_nodes(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_nodes(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_percentile_aggtransfn(internal, ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_percentile_aggtransfn(internal, ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_percentile_cont_aggfinalfn(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_percentile_cont_aggfinalfn(internal) TO mcp;


--
-- Name: FUNCTION age_percentile_disc_aggfinalfn(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_percentile_disc_aggfinalfn(internal) TO mcp;


--
-- Name: FUNCTION age_pi(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_pi() TO mcp;


--
-- Name: FUNCTION age_prepare_cypher(cstring, cstring); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_prepare_cypher(cstring, cstring) TO mcp;


--
-- Name: FUNCTION age_properties(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_properties(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_radians(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_radians(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_rand(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_rand() TO mcp;


--
-- Name: FUNCTION age_range(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_range(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_relationships(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_relationships(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_replace(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_replace(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_reverse(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_reverse(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_right(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_right(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_round(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_round(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_rtrim(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_rtrim(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_sign(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_sign(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_sin(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_sin(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_size(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_size(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_split(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_split(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_sqrt(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_sqrt(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_start_id(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_start_id(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_startnode(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_startnode(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_substring(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_substring(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tail(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tail(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tan(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tan(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_timestamp(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_timestamp() TO mcp;


--
-- Name: FUNCTION age_toboolean(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_toboolean(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tobooleanlist(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tobooleanlist(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tofloat(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tofloat(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tofloatlist(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tofloatlist(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tointeger(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tointeger(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tointegerlist(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tointegerlist(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tolower(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tolower(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_tostring("any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tostring("any") TO mcp;


--
-- Name: FUNCTION age_tostringlist(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_tostringlist(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_toupper(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_toupper(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_trim(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_trim(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION age_type(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_type(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_unnest(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_unnest(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_vertex_stats(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_vertex_stats(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_vle(ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, OUT edges ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_vle(ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, OUT edges ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_vle(ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, OUT edges ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_vle(ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype, OUT edges ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_access_operator(VARIADIC ag_catalog.agtype[]); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_access_operator(VARIADIC ag_catalog.agtype[]) TO mcp;


--
-- Name: FUNCTION agtype_access_slice(ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_access_slice(ag_catalog.agtype, ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_add(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_add(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_add(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_add(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_add(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_add(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_add(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_add(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_add(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_add(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_add(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_add(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_add(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_add(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_add(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_div(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_div(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_div(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_div(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_div(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_div(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_div(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_div(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_div(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_div(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_div(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_div(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_div(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_eq(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_eq(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ge(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ge(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_gt(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_gt(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_le(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_le(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_le(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_le(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_le(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_le(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_le(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_le(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_le(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_le(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_le(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_le(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_le(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_lt(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_lt(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mod(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mod(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_mul(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_mul(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_ne(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_ne(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(ag_catalog.agtype, real); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(ag_catalog.agtype, real) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(ag_catalog.agtype, double precision); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(ag_catalog.agtype, double precision) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(ag_catalog.agtype, smallint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(ag_catalog.agtype, smallint) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(ag_catalog.agtype, bigint); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(ag_catalog.agtype, bigint) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(ag_catalog.agtype, numeric); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(ag_catalog.agtype, numeric) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(real, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(real, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(double precision, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(double precision, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(smallint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(smallint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(integer, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(integer, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(bigint, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(bigint, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_any_sub(numeric, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_any_sub(numeric, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_array_element(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_array_element(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_array_element_text(ag_catalog.agtype, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_array_element_text(ag_catalog.agtype, integer) TO mcp;


--
-- Name: FUNCTION agtype_btree_cmp(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_btree_cmp(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_build_list(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_build_list() TO mcp;


--
-- Name: FUNCTION agtype_build_list(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_build_list(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_build_map(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_build_map() TO mcp;


--
-- Name: FUNCTION agtype_build_map(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_build_map(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_build_map_nonull(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_build_map_nonull(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_concat(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_concat(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_contained_by(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_contained_by(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_contained_by_top_level(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_contained_by_top_level(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_contains(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_contains(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_contains_top_level(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_contains_top_level(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_div(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_div(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_eq(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_eq(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_exists(ag_catalog.agtype, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_exists(ag_catalog.agtype, text) TO mcp;


--
-- Name: FUNCTION agtype_exists_agtype(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_exists_agtype(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_exists_all(ag_catalog.agtype, text[]); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_exists_all(ag_catalog.agtype, text[]) TO mcp;


--
-- Name: FUNCTION agtype_exists_all_agtype(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_exists_all_agtype(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_exists_any(ag_catalog.agtype, text[]); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_exists_any(ag_catalog.agtype, text[]) TO mcp;


--
-- Name: FUNCTION agtype_exists_any_agtype(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_exists_any_agtype(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_extract_path(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_extract_path(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_extract_path_text(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_extract_path_text(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_ge(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_ge(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_gt(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_gt(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_hash_cmp(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_hash_cmp(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_in_operator(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_in_operator(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_le(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_le(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_lt(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_lt(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_mod(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_mod(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_mul(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_mul(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_ne(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_ne(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_neg(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_neg(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_object_field(ag_catalog.agtype, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_object_field(ag_catalog.agtype, text) TO mcp;


--
-- Name: FUNCTION agtype_object_field_agtype(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_object_field_agtype(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_object_field_text(ag_catalog.agtype, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_object_field_text(ag_catalog.agtype, text) TO mcp;


--
-- Name: FUNCTION agtype_object_field_text_agtype(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_object_field_text_agtype(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_pow(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_pow(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_string_match_contains(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_string_match_contains(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_string_match_ends_with(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_string_match_ends_with(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_string_match_starts_with(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_string_match_starts_with(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_sub(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_sub(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION agtype_typecast_bool(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_typecast_bool(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_typecast_edge(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_typecast_edge(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_typecast_float(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_typecast_float(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_typecast_int(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_typecast_int(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_typecast_numeric(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_typecast_numeric(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_typecast_path(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_typecast_path(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_typecast_vertex(VARIADIC "any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_typecast_vertex(VARIADIC "any") TO mcp;


--
-- Name: FUNCTION agtype_volatile_wrapper("any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.agtype_volatile_wrapper("any") TO mcp;


--
-- Name: FUNCTION alter_graph(graph_name name, operation cstring, new_value name); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.alter_graph(graph_name name, operation cstring, new_value name) TO mcp;


--
-- Name: FUNCTION armor(bytea); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.armor(bytea) TO mcp;


--
-- Name: FUNCTION armor(bytea, text[], text[]); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.armor(bytea, text[], text[]) TO mcp;


--
-- Name: FUNCTION create_complete_graph(graph_name name, nodes integer, edge_label name, node_label name); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.create_complete_graph(graph_name name, nodes integer, edge_label name, node_label name) TO mcp;


--
-- Name: FUNCTION create_elabel(graph_name cstring, label_name cstring); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.create_elabel(graph_name cstring, label_name cstring) TO mcp;


--
-- Name: FUNCTION create_graph(graph_name name); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.create_graph(graph_name name) TO mcp;


--
-- Name: FUNCTION create_vlabel(graph_name cstring, label_name cstring); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.create_vlabel(graph_name cstring, label_name cstring) TO mcp;


--
-- Name: FUNCTION crypt(text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.crypt(text, text) TO mcp;


--
-- Name: FUNCTION cypher(graph_name name, query_string cstring, params ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.cypher(graph_name name, query_string cstring, params ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION dearmor(text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.dearmor(text) TO mcp;


--
-- Name: FUNCTION decrypt(bytea, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.decrypt(bytea, bytea, text) TO mcp;


--
-- Name: FUNCTION decrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.decrypt_iv(bytea, bytea, bytea, text) TO mcp;


--
-- Name: FUNCTION digest(bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.digest(bytea, text) TO mcp;


--
-- Name: FUNCTION digest(text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.digest(text, text) TO mcp;


--
-- Name: FUNCTION drop_graph(graph_name name, cascade boolean); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.drop_graph(graph_name name, cascade boolean) TO mcp;


--
-- Name: FUNCTION drop_label(graph_name name, label_name name, force boolean); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.drop_label(graph_name name, label_name name, force boolean) TO mcp;


--
-- Name: FUNCTION encrypt(bytea, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.encrypt(bytea, bytea, text) TO mcp;


--
-- Name: FUNCTION encrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.encrypt_iv(bytea, bytea, bytea, text) TO mcp;


--
-- Name: FUNCTION gen_random_bytes(integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gen_random_bytes(integer) TO mcp;


--
-- Name: FUNCTION gen_random_uuid(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gen_random_uuid() TO mcp;


--
-- Name: FUNCTION gen_salt(text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gen_salt(text) TO mcp;


--
-- Name: FUNCTION gen_salt(text, integer); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gen_salt(text, integer) TO mcp;


--
-- Name: FUNCTION get_cypher_keywords(OUT word text, OUT catcode "char", OUT catdesc text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.get_cypher_keywords(OUT word text, OUT catcode "char", OUT catdesc text) TO mcp;


--
-- Name: FUNCTION gin_compare_agtype(text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gin_compare_agtype(text, text) TO mcp;


--
-- Name: FUNCTION gin_consistent_agtype(internal, smallint, ag_catalog.agtype, integer, internal, internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gin_consistent_agtype(internal, smallint, ag_catalog.agtype, integer, internal, internal) TO mcp;


--
-- Name: FUNCTION gin_extract_agtype(ag_catalog.agtype, internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gin_extract_agtype(ag_catalog.agtype, internal) TO mcp;


--
-- Name: FUNCTION gin_extract_agtype_query(ag_catalog.agtype, internal, smallint, internal, internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gin_extract_agtype_query(ag_catalog.agtype, internal, smallint, internal, internal) TO mcp;


--
-- Name: FUNCTION gin_triconsistent_agtype(internal, smallint, ag_catalog.agtype, integer, internal, internal, internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.gin_triconsistent_agtype(internal, smallint, ag_catalog.agtype, integer, internal, internal, internal) TO mcp;


--
-- Name: FUNCTION graph_exists(graph_name name); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graph_exists(graph_name name) TO mcp;


--
-- Name: FUNCTION graphid_btree_cmp(ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_btree_cmp(ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION graphid_btree_sort(internal); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_btree_sort(internal) TO mcp;


--
-- Name: FUNCTION graphid_eq(ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_eq(ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION graphid_ge(ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_ge(ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION graphid_gt(ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_gt(ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION graphid_hash_cmp(ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_hash_cmp(ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION graphid_le(ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_le(ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION graphid_lt(ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_lt(ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION graphid_ne(ag_catalog.graphid, ag_catalog.graphid); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.graphid_ne(ag_catalog.graphid, ag_catalog.graphid) TO mcp;


--
-- Name: FUNCTION hmac(bytea, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.hmac(bytea, bytea, text) TO mcp;


--
-- Name: FUNCTION hmac(text, text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.hmac(text, text, text) TO mcp;


--
-- Name: FUNCTION load_edges_from_file(graph_name name, label_name name, file_path text, load_as_agtype boolean); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.load_edges_from_file(graph_name name, label_name name, file_path text, load_as_agtype boolean) TO mcp;


--
-- Name: FUNCTION load_labels_from_file(graph_name name, label_name name, file_path text, id_field_exists boolean, load_as_agtype boolean); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.load_labels_from_file(graph_name name, label_name name, file_path text, id_field_exists boolean, load_as_agtype boolean) TO mcp;


--
-- Name: FUNCTION pgp_armor_headers(text, OUT key text, OUT value text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_armor_headers(text, OUT key text, OUT value text) TO mcp;


--
-- Name: FUNCTION pgp_key_id(bytea); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_key_id(bytea) TO mcp;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_decrypt(bytea, bytea) TO mcp;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_decrypt(bytea, bytea, text) TO mcp;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_decrypt(bytea, bytea, text, text) TO mcp;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_decrypt_bytea(bytea, bytea) TO mcp;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_decrypt_bytea(bytea, bytea, text) TO mcp;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_decrypt_bytea(bytea, bytea, text, text) TO mcp;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_encrypt(text, bytea) TO mcp;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_encrypt(text, bytea, text) TO mcp;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_encrypt_bytea(bytea, bytea) TO mcp;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_pub_encrypt_bytea(bytea, bytea, text) TO mcp;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_sym_decrypt(bytea, text) TO mcp;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_sym_decrypt(bytea, text, text) TO mcp;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_sym_decrypt_bytea(bytea, text) TO mcp;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_sym_decrypt_bytea(bytea, text, text) TO mcp;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_sym_encrypt(text, text) TO mcp;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_sym_encrypt(text, text, text) TO mcp;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_sym_encrypt_bytea(bytea, text) TO mcp;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text, text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.pgp_sym_encrypt_bytea(bytea, text, text) TO mcp;


--
-- Name: FUNCTION text_to_agtype(text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.text_to_agtype(text) TO mcp;


--
-- Name: FUNCTION uuid_generate_v1(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_generate_v1() TO mcp;


--
-- Name: FUNCTION uuid_generate_v1mc(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_generate_v1mc() TO mcp;


--
-- Name: FUNCTION uuid_generate_v3(namespace uuid, name text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_generate_v3(namespace uuid, name text) TO mcp;


--
-- Name: FUNCTION uuid_generate_v4(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_generate_v4() TO mcp;


--
-- Name: FUNCTION uuid_generate_v5(namespace uuid, name text); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_generate_v5(namespace uuid, name text) TO mcp;


--
-- Name: FUNCTION uuid_nil(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_nil() TO mcp;


--
-- Name: FUNCTION uuid_ns_dns(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_ns_dns() TO mcp;


--
-- Name: FUNCTION uuid_ns_oid(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_ns_oid() TO mcp;


--
-- Name: FUNCTION uuid_ns_url(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_ns_url() TO mcp;


--
-- Name: FUNCTION uuid_ns_x500(); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.uuid_ns_x500() TO mcp;


--
-- Name: FUNCTION add_edge_simple(p_src text, p_rel text, p_dst text); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.add_edge_simple(p_src text, p_rel text, p_dst text) TO mcp;


--
-- Name: FUNCTION rag_topk_hybrid_cosine(q public.vector, k integer, w_dist real, w_recency real); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.rag_topk_hybrid_cosine(q public.vector, k integer, w_dist real, w_recency real) TO mcp;


--
-- Name: FUNCTION rag_topk_l2(q public.vector, k integer); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.rag_topk_l2(q public.vector, k integer) TO mcp;


--
-- Name: FUNCTION upsert_entity(p_uid text); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.upsert_entity(p_uid text) TO mcp;


--
-- Name: TABLE ts_metric; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ts_metric TO mcp;


--
-- Name: FUNCTION age_avg(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_avg(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_collect("any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_collect("any") TO mcp;


--
-- Name: FUNCTION age_max("any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_max("any") TO mcp;


--
-- Name: FUNCTION age_min("any"); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_min("any") TO mcp;


--
-- Name: FUNCTION age_percentilecont(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_percentilecont(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_percentiledisc(ag_catalog.agtype, ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_percentiledisc(ag_catalog.agtype, ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_stdev(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_stdev(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_stdevp(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_stdevp(ag_catalog.agtype) TO mcp;


--
-- Name: FUNCTION age_sum(ag_catalog.agtype); Type: ACL; Schema: ag_catalog; Owner: postgres
--

GRANT ALL ON FUNCTION ag_catalog.age_sum(ag_catalog.agtype) TO mcp;


--
-- Name: TABLE _compressed_hypertable_3; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._compressed_hypertable_3 TO mcp;


--
-- Name: TABLE _direct_view_4; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._direct_view_4 TO mcp;


--
-- Name: TABLE _hyper_2_1_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._hyper_2_1_chunk TO mcp;


--
-- Name: TABLE _hyper_2_2_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._hyper_2_2_chunk TO mcp;


--
-- Name: TABLE _hyper_2_3_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._hyper_2_3_chunk TO mcp;


--
-- Name: TABLE _materialized_hypertable_4; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._materialized_hypertable_4 TO mcp;


--
-- Name: TABLE _hyper_4_4_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._hyper_4_4_chunk TO mcp;


--
-- Name: TABLE _hyper_4_5_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._hyper_4_5_chunk TO mcp;


--
-- Name: TABLE _partial_view_4; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal._partial_view_4 TO mcp;


--
-- Name: TABLE compress_hyper_3_6_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal.compress_hyper_3_6_chunk TO mcp;


--
-- Name: TABLE compress_hyper_3_7_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal.compress_hyper_3_7_chunk TO mcp;


--
-- Name: TABLE compress_hyper_3_8_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE _timescaledb_internal.compress_hyper_3_8_chunk TO mcp;


--
-- Name: TABLE ai_embed; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_embed TO mcp;


--
-- Name: TABLE geo_place; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.geo_place TO mcp;


--
-- Name: TABLE geography_columns; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.geography_columns TO mcp;


--
-- Name: TABLE geometry_columns; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.geometry_columns TO mcp;


--
-- Name: TABLE mv_gap_scores; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mv_gap_scores TO mcp;


--
-- Name: TABLE spatial_ref_sys; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.spatial_ref_sys TO mcp;


--
-- Name: TABLE ts_chunk_usage; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ts_chunk_usage TO mcp;


--
-- Name: TABLE ts_chunks_with_usage; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ts_chunks_with_usage TO mcp;


--
-- Name: TABLE ts_metric_5m; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ts_metric_5m TO mcp;


--
-- Name: TABLE ts_usage_policy; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ts_usage_policy TO mcp;


--
-- Name: TABLE v_edges; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.v_edges TO mcp;


--
-- Name: TABLE v_entities; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.v_entities TO mcp;


--
-- Name: TABLE v_gap_scores; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.v_gap_scores TO mcp;


--
-- Name: TABLE v_nodes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.v_nodes TO mcp;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: ag_catalog; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ag_catalog GRANT ALL ON FUNCTIONS TO mcp;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO mcp;


--
-- Name: mv_gap_scores; Type: MATERIALIZED VIEW DATA; Schema: public; Owner: postgres
--

REFRESH MATERIALIZED VIEW public.mv_gap_scores;


--
-- PostgreSQL database dump complete
--

\unrestrict 01yHeZbvQdIm6FxQxBe4453wwMEXvBnQATSdmM18C9XPwwjReZLuQuqaF8nEuec

