-- Preserve who last requested the existing Project spatial-layer choice.
-- The user override column remains the availability ceiling; a WorldView Card
-- may write that tier only for a user-authorized turn, never as a UI click.
BEGIN;

ALTER TABLE ag_catalog.project_worldview_capabilities
  ADD COLUMN IF NOT EXISTS last_origin TEXT;

UPDATE ag_catalog.project_worldview_capabilities
SET last_origin = CASE
  WHEN user_enabled IS NOT NULL THEN 'user'
  ELSE 'main'
END
WHERE last_origin IS NULL;

ALTER TABLE ag_catalog.project_worldview_capabilities
  ALTER COLUMN last_origin SET NOT NULL;

ALTER TABLE ag_catalog.project_worldview_capabilities
  ADD CONSTRAINT project_worldview_capabilities_last_origin_check
  CHECK (last_origin IN ('user', 'main', 'worldview_card'));

COMMIT;
