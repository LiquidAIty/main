-- ============================================================================
-- Prune database to exactly 2 agent projects: Main Chat + KG Ingest
-- ============================================================================
-- This removes all extra agent projects to enforce the "2 decks" architecture
-- Run: psql "postgresql://postgres:postgres@localhost:5433/liquidaity" -f db/prune_to_2_agent_projects.sql

BEGIN;

-- First, list what we have
SELECT 
  id,
  name,
  code,
  slug,
  project_type,
  status
FROM ag_catalog.projects
WHERE project_type IN ('agent', 'agents')
ORDER BY created_at;

-- Delete all agent projects except the 2 canonical ones
-- Adjust the slug/name patterns if your projects have different identifiers
DELETE FROM ag_catalog.project_agents
WHERE project_id IN (
  SELECT id FROM ag_catalog.projects
  WHERE project_type IN ('agent', 'agents')
    AND slug NOT IN ('main-chat', 'kg-ingest')
    AND name NOT IN ('Main Chat', 'KG Ingest')
);

DELETE FROM ag_catalog.projects
WHERE project_type IN ('agent', 'agents')
  AND slug NOT IN ('main-chat', 'kg-ingest')
  AND name NOT IN ('Main Chat', 'KG Ingest');

-- Verify we have exactly 2 agent projects left
SELECT 
  COUNT(*) as agent_project_count,
  string_agg(name, ', ') as remaining_projects
FROM ag_catalog.projects
WHERE project_type IN ('agent', 'agents');

COMMIT;

-- If you don't have the 2 canonical projects yet, run seed_two_agent_projects.sql after this
