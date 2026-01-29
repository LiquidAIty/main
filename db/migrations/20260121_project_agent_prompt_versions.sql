CREATE TABLE IF NOT EXISTS ag_catalog.project_agent_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  agent_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version_note text NULL,
  provider text NULL,
  model_key text NULL,
  temperature numeric NULL,
  max_tokens integer NULL,
  prompt_template text NOT NULL
);

CREATE INDEX IF NOT EXISTS project_agent_prompt_versions_idx
  ON ag_catalog.project_agent_prompt_versions (project_id, agent_type, created_at DESC);
