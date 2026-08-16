-- Add immutable coding-job IDF review state and exact runtime proof to the
-- existing IDF and card-run authorities. Additive only; historical rows remain
-- conversation inputs that did not require an approval workflow.

BEGIN;

ALTER TABLE ag_catalog.input_data_files
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'conversation'
    CHECK (purpose IN ('conversation', 'coding_job')),
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (approval_status IN ('not_required', 'draft', 'approved', 'superseded')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS supersedes_idf_id TEXT,
  ADD COLUMN IF NOT EXISTS job_context JSONB
    CHECK (job_context IS NULL OR jsonb_typeof(job_context) = 'object');

CREATE INDEX IF NOT EXISTS input_data_files_job_revisions_idx
  ON ag_catalog.input_data_files(project_id, run_id, version DESC)
  WHERE purpose = 'coding_job';

ALTER TABLE ag_catalog.card_run_traces
  ADD COLUMN IF NOT EXISTS access_mode TEXT,
  ADD COLUMN IF NOT EXISTS idf_id TEXT,
  ADD COLUMN IF NOT EXISTS idf_version INTEGER,
  ADD COLUMN IF NOT EXISTS idf_content_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS provider_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_turn_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_auth_mode TEXT,
  ADD COLUMN IF NOT EXISTS provider_plan_type TEXT,
  ADD COLUMN IF NOT EXISTS result_artifact_json JSONB
    CHECK (result_artifact_json IS NULL OR jsonb_typeof(result_artifact_json) = 'object');

COMMIT;
