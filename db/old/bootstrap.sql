-- === Extensions (safe & conditional) ========================================
-- Guards with pg_available_extensions so we only create what's present.
DO $ext$
DECLARE
  ext text;
BEGIN
  FOREACH ext IN ARRAY ARRAY[
    'age',          -- AGE (Apache AGE graph extension)
    'timescaledb',  -- TimescaleDB (time-series)
    'pg_trgm',      -- pg_trgm (trigram text search)
    'pgvector',     -- pgvector (vector similarity)
    'pgcrypto',     -- pgcrypto (cryptographic functions)
    'uuid-ossp',    -- uuid-ossp (UUID generators)
    'btree_gin',    -- btree_gin (B-tree emulation in GIN (Generalized Inverted Index))
    'btree_gist',   -- btree_gist (B-tree emulation in GiST (Generalized Search Tree))
    'postgis',      -- PostGIS (geospatial)
    'pg_cron'       -- pg_cron (PostgreSQL Cron extension)
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = ext) THEN
      EXECUTE format('CREATE EXTENSION IF NOT EXISTS %I;', ext);
    END IF;
  END LOOP;
END
$ext$;

-- AGE (Apache AGE) requires LOAD per session in some builds
-- No-op if already loaded; safe to call.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'age') THEN
    PERFORM 1;  -- placeholder; LOAD is session-scoped, so:
  END IF;
END$$;

-- Keep search path the way you’ve been using it
SET search_path = ag_catalog, public;
