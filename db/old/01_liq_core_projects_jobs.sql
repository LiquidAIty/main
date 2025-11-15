BEGIN;

-- === Schema ===================================================================
CREATE SCHEMA IF NOT EXISTS liq_core;

-- === Generic updated_at trigger ==============================================
CREATE OR REPLACE FUNCTION liq_core.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- === Project Types ============================================================
-- Logical "category" for a project: trading, sim_energyplus, sim_openfoam, etc.
CREATE TABLE IF NOT EXISTS liq_core.project_type (
  project_type_id  SERIAL PRIMARY KEY,
  key              TEXT        NOT NULL UNIQUE,
  label            TEXT        NOT NULL,
  description      TEXT,
  default_config   JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_project_type_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_project_type_touch_updated_at
      BEFORE UPDATE ON liq_core.project_type
      FOR EACH ROW
      EXECUTE FUNCTION liq_core.touch_updated_at();
  END IF;
END
$$;

-- === Projects ================================================================
-- One row per "thing the user cares about": a company, a building, a sim bundle, etc.
CREATE TABLE IF NOT EXISTS liq_core.project (
  project_id       UUID PRIMARY KEY DEFAULT ag_catalog.uuid_generate_v4(),
  owner_ref        TEXT        NOT NULL,            -- external user id / subject
  project_type_id  INTEGER     NOT NULL REFERENCES liq_core.project_type(project_type_id),
  name             TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'active',  -- active, archived, deleted, etc.
  meta             JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_owner_name UNIQUE (owner_ref, name)
);

CREATE INDEX IF NOT EXISTS idx_project_owner_ref
  ON liq_core.project (owner_ref);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_project_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_project_touch_updated_at
      BEFORE UPDATE ON liq_core.project
      FOR EACH ROW
      EXECUTE FUNCTION liq_core.touch_updated_at();
  END IF;
END
$$;

-- === Memory Spaces ===========================================================
-- Logical buckets: user_logic, project, agent, run, etc.
CREATE TABLE IF NOT EXISTS liq_core.memory_space (
  memory_space_id  BIGSERIAL PRIMARY KEY,
  project_id       UUID        NOT NULL REFERENCES liq_core.project(project_id) ON DELETE CASCADE,
  scope            TEXT        NOT NULL,   -- 'user_logic', 'project', 'agent', 'run', ...
  label            TEXT,
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  config           JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_space_project_scope
  ON liq_core.memory_space (project_id, scope);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_memory_space_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_memory_space_touch_updated_at
      BEFORE UPDATE ON liq_core.memory_space
      FOR EACH ROW
      EXECUTE FUNCTION liq_core.touch_updated_at();
  END IF;
END
$$;

-- === Memory Items ============================================================
-- Arbitrary JSON blobs keyed to a space; optionally linked to RAG chunks.
CREATE TABLE IF NOT EXISTS liq_core.memory_item (
  memory_item_id   BIGSERIAL PRIMARY KEY,
  memory_space_id  BIGINT      NOT NULL REFERENCES liq_core.memory_space(memory_space_id) ON DELETE CASCADE,
  key              TEXT,
  value            JSONB       NOT NULL,
  embedding_chunk_id BIGINT,   -- optional link to ag_catalog.rag_chunks.chunk_id
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_item_space
  ON liq_core.memory_item (memory_space_id);

CREATE INDEX IF NOT EXISTS idx_memory_item_key
  ON liq_core.memory_item (key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_memory_item_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_memory_item_touch_updated_at
      BEFORE UPDATE ON liq_core.memory_item
      FOR EACH ROW
      EXECUTE FUNCTION liq_core.touch_updated_at();
  END IF;
END
$$;

-- === Jobs ====================================================================
-- Generic job queue: "run sim", "run agent", "ingest company", etc.
CREATE TABLE IF NOT EXISTS liq_core.job (
  job_id          BIGSERIAL PRIMARY KEY,
  project_id      UUID        NOT NULL REFERENCES liq_core.project(project_id) ON DELETE CASCADE,
  job_type        TEXT        NOT NULL,            -- 'sim', 'agent', 'rag_search', ...
  target_engine   TEXT,                            -- 'energyplus', 'openfoam', 'trading_core', ...
  request         JSONB       NOT NULL,            -- full payload / params for the job
  status          TEXT        NOT NULL DEFAULT 'queued',  -- queued, running, done, error, cancelled
  priority        INTEGER     NOT NULL DEFAULT 0,
  scheduled_for   TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_status_scheduled
  ON liq_core.job (status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_job_project_created
  ON liq_core.job (project_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_job_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_job_touch_updated_at
      BEFORE UPDATE ON liq_core.job
      FOR EACH ROW
      EXECUTE FUNCTION liq_core.touch_updated_at();
  END IF;
END
$$;

-- === Job Runs ================================================================
-- Individual attempts for a job; good for agent retries + metrics.
CREATE TABLE IF NOT EXISTS liq_core.job_run (
  job_run_id      BIGSERIAL PRIMARY KEY,
  job_id          BIGINT      NOT NULL REFERENCES liq_core.job(job_id) ON DELETE CASCADE,
  attempt         INTEGER     NOT NULL DEFAULT 1,
  status          TEXT        NOT NULL,           -- running, done, error, ...
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  logs            TEXT,
  metrics         JSONB       NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_job_run_job_attempt
  ON liq_core.job_run (job_id, attempt DESC);

-- === Embedded SMOKE ==========================================================
-- Creates/updates a demo project + memory + job, then prints counts.
DO $smoke$
DECLARE
  v_pt_id      INTEGER;
  v_project_id UUID;
  v_space_id   BIGINT;
  v_job_id     BIGINT;
  c_projects   INTEGER;
  c_spaces     INTEGER;
  c_items      INTEGER;
  c_jobs       INTEGER;
  c_runs       INTEGER;
BEGIN
  -- Upsert a demo project_type
  INSERT INTO liq_core.project_type (key, label, description)
  VALUES ('demo_trading', 'Demo Trading Project', 'Seed project type for SMOKE')
  ON CONFLICT (key) DO UPDATE
    SET updated_at = now()
  RETURNING project_type_id INTO v_pt_id;

  -- Upsert a demo project for owner 'demo-owner'
  BEGIN
    INSERT INTO liq_core.project (owner_ref, project_type_id, name, status)
    VALUES ('demo-owner', v_pt_id, 'Demo Project', 'active')
    ON CONFLICT (owner_ref, name) DO UPDATE
      SET updated_at = now()
    RETURNING project_id INTO v_project_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT project_id
      INTO v_project_id
      FROM liq_core.project
      WHERE owner_ref = 'demo-owner' AND name = 'Demo Project'
      LIMIT 1;
  END;

  -- Ensure a memory space exists
  INSERT INTO liq_core.memory_space (project_id, scope, label, tags)
  VALUES (v_project_id, 'project', 'Demo Memory Space', ARRAY['smoke'])
  RETURNING memory_space_id INTO v_space_id;

  -- One memory item
  INSERT INTO liq_core.memory_item (memory_space_id, key, value)
  VALUES (v_space_id, 'hello', '{"msg":"world"}'::JSONB);

  -- One queued job + run
  INSERT INTO liq_core.job (project_id, job_type, target_engine, request, status, priority)
  VALUES (
    v_project_id,
    'sim',
    'energyplus',
    '{"kind":"smoke","note":"demo job"}'::JSONB,
    'queued',
    0
  )
  RETURNING job_id INTO v_job_id;

  INSERT INTO liq_core.job_run (job_id, attempt, status, logs, metrics)
  VALUES (
    v_job_id,
    1,
    'queued',
    'SMOKE run placeholder',
    '{"ok":true}'::JSONB
  );

  -- Counts
  SELECT COUNT(*) INTO c_projects FROM liq_core.project;
  SELECT COUNT(*) INTO c_spaces   FROM liq_core.memory_space;
  SELECT COUNT(*) INTO c_items    FROM liq_core.memory_item;
  SELECT COUNT(*) INTO c_jobs     FROM liq_core.job;
  SELECT COUNT(*) INTO c_runs     FROM liq_core.job_run;

  RAISE NOTICE 'LIQ_CORE SMOKE -> projects=%, spaces=%, items=%, jobs=%, runs=%',
    c_projects, c_spaces, c_items, c_jobs, c_runs;
END
$smoke$ LANGUAGE plpgsql;

COMMIT;
