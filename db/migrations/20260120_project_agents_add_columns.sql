ALTER TABLE ag_catalog.project_agents
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model_key text,
  ADD COLUMN IF NOT EXISTS prompt_template text;
