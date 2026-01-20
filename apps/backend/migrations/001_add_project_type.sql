-- Migration: Add project_type and versioning support
-- 
-- A project is either:
--   - Assist project: shipped product chat workspace
--   - Agent project: builder/expert workspace with versioned agent decks
--
-- Run as postgres superuser:
-- psql "postgresql://postgres:postgres@localhost:5433/liquidaity" -f apps/backend/migrations/001_add_project_type.sql

-- Add project_type column
ALTER TABLE ag_catalog.projects 
ADD COLUMN IF NOT EXISTS project_type VARCHAR(20) DEFAULT 'agent' CHECK (project_type IN ('assist', 'agent'));

-- Add active_deck_version_id for Agent projects (versioned agent deck)
ALTER TABLE ag_catalog.projects 
ADD COLUMN IF NOT EXISTS active_deck_version_id UUID;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_projects_type ON ag_catalog.projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_deck_version ON ag_catalog.projects(active_deck_version_id);

-- Update existing projects to 'agent' type (they're all Agent Builder projects currently)
UPDATE ag_catalog.projects SET project_type = 'agent' WHERE project_type IS NULL;

-- Grant complete permissions to liquidaity-user
GRANT USAGE ON SCHEMA ag_catalog TO "liquidaity-user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ag_catalog TO "liquidaity-user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ag_catalog TO "liquidaity-user";

-- Grant default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA ag_catalog GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "liquidaity-user";
ALTER DEFAULT PRIVILEGES IN SCHEMA ag_catalog GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "liquidaity-user";

-- Verify migration
SELECT 
  COUNT(*) as total_projects,
  COUNT(*) FILTER (WHERE project_type = 'agent') as agent_projects,
  COUNT(*) FILTER (WHERE project_type = 'assist') as assist_projects
FROM ag_catalog.projects;
