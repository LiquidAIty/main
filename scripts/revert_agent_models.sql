-- REVERT: Restore agents back to gpt-5.1-chat-latest
-- This undoes the unauthorized change to kimi-k2-thinking

BEGIN;

-- Restore llm_chat agents back to original value
UPDATE ag_catalog.project_agents
SET model = 'gpt-5.1-chat-latest'
WHERE agent_type = 'llm_chat'
  AND model = 'kimi-k2-thinking';

-- Restore kg_ingest agents back to original value  
UPDATE ag_catalog.project_agents
SET model = 'gpt-5.1-chat-latest'
WHERE agent_type = 'kg_ingest'
  AND model = 'kimi-k2-thinking';

-- Show current state
SELECT 
  agent_id,
  name,
  agent_type,
  model
FROM ag_catalog.project_agents
WHERE is_active = true
ORDER BY agent_type, name;

COMMIT;
