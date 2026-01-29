ALTER TABLE ag_catalog.projects
  ADD COLUMN IF NOT EXISTS assist_kg_ingest_agent_id uuid;
