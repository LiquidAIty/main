-- ============================================================================
-- Seed exactly 2 agent projects: Main Chat + KG Ingest
-- ============================================================================
-- This enforces the "Project = Agent Deck" architecture where:
-- - Left sidebar shows 2 agent projects
-- - Each project IS one agent (no sub-agents)
-- - Right side edits that project's config directly
--
-- Run: psql "postgresql://postgres:postgres@localhost:5433/liquidaity" -f db/seed_two_agent_projects.sql

BEGIN;

-- Insert Main Chat agent project (idempotent)
INSERT INTO ag_catalog.projects (
  id,
  name,
  code,
  project_type,
  status,
  agent_model,
  agent_temperature,
  agent_max_tokens,
  assist_main_agent_id
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Main Chat',
  'main-chat',
  'agent',
  'active',
  'gpt-5.1-chat-latest',
  0.7,
  2048,
  '00000000-0000-0000-0000-000000000001'::uuid
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  project_type = EXCLUDED.project_type,
  agent_model = EXCLUDED.agent_model,
  agent_temperature = EXCLUDED.agent_temperature,
  agent_max_tokens = EXCLUDED.agent_max_tokens;

-- Insert KG Ingest agent project (idempotent)
INSERT INTO ag_catalog.projects (
  id,
  name,
  code,
  project_type,
  status,
  agent_model,
  agent_temperature,
  agent_max_tokens,
  assist_kg_ingest_agent_id
)
VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  'KG Ingest',
  'kg-ingest',
  'agent',
  'active',
  'kimi-k2-thinking',
  0,
  2048,
  '00000000-0000-0000-0000-000000000002'::uuid
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  project_type = EXCLUDED.project_type,
  agent_model = EXCLUDED.agent_model,
  agent_temperature = EXCLUDED.agent_temperature,
  agent_max_tokens = EXCLUDED.agent_max_tokens;

COMMIT;

-- Verify
SELECT 
  id,
  name,
  code,
  project_type,
  agent_model,
  agent_temperature,
  agent_max_tokens
FROM ag_catalog.projects
WHERE project_type = 'agent'
ORDER BY name;
