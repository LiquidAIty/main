-- ============================================================================
-- Phase 1: Multi-Agent Support
-- ============================================================================
-- This migration adds support for multiple agents per project.
-- Existing single-agent configs in ag_catalog.projects remain for backward compatibility.

BEGIN;

-- Create project_agents table
CREATE TABLE IF NOT EXISTS ag_catalog.project_agents (
  agent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL, -- 'kg_ingest', 'kg_read', 'llm_chat'
  
  -- Agent configuration (same structure as projects table)
  model TEXT,
  prompt_template TEXT,
  tools JSONB DEFAULT '[]'::jsonb,
  io_schema JSONB DEFAULT '{}'::jsonb,
  permissions JSONB DEFAULT '{}'::jsonb,
  temperature REAL,
  max_tokens INTEGER,
  
  -- Sectioned prompts (Phase 1 enhancement)
  role_text TEXT,
  goal_text TEXT,
  constraints_text TEXT,
  io_schema_text TEXT,
  memory_policy_text TEXT,
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(project_id, name)
);

-- Index for fast project lookups
CREATE INDEX IF NOT EXISTS idx_project_agents_project_id 
  ON ag_catalog.project_agents(project_id);

-- Index for agent type filtering
CREATE INDEX IF NOT EXISTS idx_project_agents_type 
  ON ag_catalog.project_agents(agent_type);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION ag_catalog.update_project_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_project_agents_updated_at 
  ON ag_catalog.project_agents;
CREATE TRIGGER trigger_update_project_agents_updated_at
  BEFORE UPDATE ON ag_catalog.project_agents
  FOR EACH ROW
  EXECUTE FUNCTION ag_catalog.update_project_agents_updated_at();

-- Helper function to assemble sectioned prompts into full prompt_template
CREATE OR REPLACE FUNCTION ag_catalog.assemble_prompt_sections(
  p_role TEXT,
  p_goal TEXT,
  p_constraints TEXT,
  p_io_schema TEXT,
  p_memory_policy TEXT
) RETURNS TEXT AS $$
DECLARE
  result TEXT := '';
BEGIN
  IF p_role IS NOT NULL AND p_role != '' THEN
    result := result || E'# Role\n' || p_role || E'\n\n';
  END IF;
  
  IF p_goal IS NOT NULL AND p_goal != '' THEN
    result := result || E'# Goal\n' || p_goal || E'\n\n';
  END IF;
  
  IF p_constraints IS NOT NULL AND p_constraints != '' THEN
    result := result || E'# Constraints\n' || p_constraints || E'\n\n';
  END IF;
  
  IF p_io_schema IS NOT NULL AND p_io_schema != '' THEN
    result := result || E'# Input/Output Schema\n' || p_io_schema || E'\n\n';
  END IF;
  
  IF p_memory_policy IS NOT NULL AND p_memory_policy != '' THEN
    result := result || E'# Memory Policy\n' || p_memory_policy || E'\n\n';
  END IF;
  
  RETURN TRIM(result);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Migration: Create default agents from existing project configs
-- This preserves backward compatibility
DO $$
DECLARE
  proj RECORD;
  has_config BOOLEAN;
BEGIN
  FOR proj IN 
    SELECT 
      id,
      code,
      agent_model,
      agent_prompt_template,
      agent_tools,
      agent_io_schema,
      agent_permissions,
      agent_temperature,
      agent_max_tokens
    FROM ag_catalog.projects
  LOOP
    -- Check if project has any agent config
    has_config := (
      (proj.agent_model IS NOT NULL AND proj.agent_model != '') OR
      (proj.agent_prompt_template IS NOT NULL AND proj.agent_prompt_template != '') OR
      (proj.agent_tools IS NOT NULL AND jsonb_array_length(proj.agent_tools) > 0) OR
      (proj.agent_io_schema IS NOT NULL AND proj.agent_io_schema::text != '{}') OR
      (proj.agent_permissions IS NOT NULL AND proj.agent_permissions::text != '{}') OR
      (proj.agent_temperature IS NOT NULL) OR
      (proj.agent_max_tokens IS NOT NULL)
    );
    
    -- Only migrate if project has config and doesn't already have a default agent
    IF has_config THEN
      INSERT INTO ag_catalog.project_agents (
        project_id,
        name,
        agent_type,
        model,
        prompt_template,
        tools,
        io_schema,
        permissions,
        temperature,
        max_tokens
      )
      SELECT
        COALESCE(proj.code, proj.id::text),
        'Default Agent',
        'llm_chat',
        proj.agent_model,
        proj.agent_prompt_template,
        COALESCE(proj.agent_tools, '[]'::jsonb),
        COALESCE(proj.agent_io_schema, '{}'::jsonb),
        COALESCE(proj.agent_permissions, '{}'::jsonb),
        proj.agent_temperature,
        proj.agent_max_tokens
      ON CONFLICT (project_id, name) DO NOTHING;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Migration complete: existing agent configs migrated to project_agents table';
END;
$$;

COMMIT;
