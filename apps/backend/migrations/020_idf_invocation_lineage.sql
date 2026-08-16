-- Keep the existing deck aggregate in place while correcting its project role.
-- This does not copy, recreate, or rewrite the saved deck JSONB. The stable
-- agent-builder project row becomes the canonical Assist that both Agent
-- Builder and Main select.

BEGIN;

UPDATE ag_catalog.projects
SET project_type = 'assist', updated_at = NOW()
WHERE code = 'agent-builder'
  AND project_type = 'agent'
  AND jsonb_typeof(agent_io_schema->'v3_state'->'decks'->'deck_builder') = 'object';

COMMIT;
