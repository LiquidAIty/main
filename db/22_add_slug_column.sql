-- ============================================================================
-- 22_add_slug_column.sql
-- Add slug column to projects table and populate from code column
-- ============================================================================
-- Run as postgres superuser:
-- psql "postgresql://postgres:postgres@localhost:5433/liquidaity" -f db/22_add_slug_column.sql

BEGIN;

-- Add slug column
ALTER TABLE ag_catalog.projects 
ADD COLUMN IF NOT EXISTS slug VARCHAR(100);

-- Populate slug from code (code is the existing identifier)
UPDATE ag_catalog.projects 
SET slug = code 
WHERE slug IS NULL;

-- Create unique index on slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON ag_catalog.projects(slug);

-- Verify migration
SELECT id, name, code, slug, project_type
FROM ag_catalog.projects
WHERE project_type = 'agent'
ORDER BY name;

COMMIT;
