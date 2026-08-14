-- Store the exact IDD-validated structured snapshot beside the AI-facing
-- mixed-Markdown IDF. Additive only: existing IDFs and user data are retained.

BEGIN;

ALTER TABLE ag_catalog.input_data_files
  ADD COLUMN IF NOT EXISTS structured_context JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(structured_context) = 'object');

COMMIT;
