-- Fix: Update project_agents to use correct default model from env
-- The boot log shows DEFAULT_MODEL should be kimi-k2-thinking
-- But project_agents rows have gpt-5.1-chat-latest hardcoded

BEGIN;

-- Update all llm_chat agents to use the correct default model
UPDATE ag_catalog.project_agents
SET model = 'kimi-k2-thinking'
WHERE agent_type = 'llm_chat'
  AND (model = 'gpt-5.1-chat-latest' OR model IS NULL);

-- Update all kg_ingest agents to use the correct default model
UPDATE ag_catalog.project_agents
SET model = 'kimi-k2-thinking'
WHERE agent_type = 'kg_ingest'
  AND (model = 'gpt-5.1-chat-latest' OR model IS NULL);

-- Verify the changes
SELECT 
  agent_id,
  project_id,
  name,
  agent_type,
  model,
  temperature,
  max_tokens
FROM ag_catalog.project_agents
WHERE is_active = true
ORDER BY project_id, agent_type;

COMMIT;
