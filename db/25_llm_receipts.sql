-- ============================================================================
-- 25_llm_probability.sql
-- Create LLM probability table for tracking agent self-ratings
-- Ultra-minimal: LLM only outputs @p=<float>
-- ============================================================================
-- Run: psql "postgresql://postgres:postgres@localhost:5433/liquidaity" -f db/25_llm_receipts.sql

BEGIN;

-- Drop old tables if exist
DROP TABLE IF EXISTS ag_catalog.llm_receipts CASCADE;
DROP TABLE IF EXISTS ag_catalog.llm_probability CASCADE;

-- Create minimal probability table
CREATE TABLE ag_catalog.llm_probability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL REFERENCES ag_catalog.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  predicted_probability real NOT NULL CHECK (predicted_probability >= -0.10 AND predicted_probability <= 1.00),
  rated_probability real NOT NULL DEFAULT 0.0 CHECK (rated_probability >= -0.10 AND rated_probability <= 1.00),
  raw_line text NOT NULL
);

-- Create indexes for efficient queries
CREATE INDEX idx_llm_probability_project_created 
  ON ag_catalog.llm_probability(project_id, created_at DESC);

CREATE INDEX idx_llm_probability_run_id 
  ON ag_catalog.llm_probability(run_id);

COMMIT;
