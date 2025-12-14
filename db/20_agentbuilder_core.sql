-- 20_agentbuilder_core.sql
-- Adds agent builder configuration columns to projects table (prefer ag_catalog.projects)

DO $$
DECLARE
  target_table text := 'ag_catalog.projects';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ag_catalog' AND table_name = 'projects'
  ) THEN
    target_table := 'projects';
  END IF;

  EXECUTE format('ALTER TABLE %s
    ADD COLUMN IF NOT EXISTS agent_model text,
    ADD COLUMN IF NOT EXISTS agent_prompt_template text,
    ADD COLUMN IF NOT EXISTS agent_tools jsonb NOT NULL DEFAULT ''[]''::jsonb,
    ADD COLUMN IF NOT EXISTS agent_io_schema jsonb NOT NULL DEFAULT ''{}''::jsonb,
    ADD COLUMN IF NOT EXISTS agent_temperature real,
    ADD COLUMN IF NOT EXISTS agent_max_tokens integer,
    ADD COLUMN IF NOT EXISTS agent_permissions jsonb NOT NULL DEFAULT ''{}''::jsonb;
  ', target_table);
  EXECUTE format('COMMENT ON COLUMN %s.agent_model IS ''Preferred model identifier for this agent card'';', target_table);
  EXECUTE format('COMMENT ON COLUMN %s.agent_prompt_template IS ''Prompt template used by Agent Builder when orchestrating this project'';', target_table);
  EXECUTE format('COMMENT ON COLUMN %s.agent_tools IS ''JSON array of tool identifiers the agent may call'';', target_table);
  EXECUTE format('COMMENT ON COLUMN %s.agent_io_schema IS ''JSON schema describing agent inputs/outputs'';', target_table);
  EXECUTE format('COMMENT ON COLUMN %s.agent_temperature IS ''Model temperature override for this agent'';', target_table);
  EXECUTE format('COMMENT ON COLUMN %s.agent_max_tokens IS ''Maximum tokens per response for this agent'';', target_table);
  EXECUTE format('COMMENT ON COLUMN %s.agent_permissions IS ''Structured permissions or policy metadata for this agent'';', target_table);
END$$;
