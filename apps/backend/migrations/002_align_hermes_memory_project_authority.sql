-- Hermes memory must use the same project authority as decks and conversations.
-- ag_catalog.projects is canonical. liq_core.project is legacy. Any memory
-- rows that point only at that obsolete registry are stale legacy data and are
-- removed before the FK is validated; no project identity is invented.

BEGIN;

ALTER TABLE liq_core.memory_space
  DROP CONSTRAINT IF EXISTS memory_space_project_id_fkey;

DELETE FROM liq_core.memory_item mi
USING liq_core.memory_space ms
WHERE ms.memory_space_id = mi.memory_space_id
  AND NOT EXISTS (
    SELECT 1 FROM ag_catalog.projects p WHERE p.id = ms.project_id
  );

DELETE FROM liq_core.memory_space ms
WHERE NOT EXISTS (
  SELECT 1 FROM ag_catalog.projects p WHERE p.id = ms.project_id
);

ALTER TABLE liq_core.memory_space
  ADD CONSTRAINT memory_space_project_id_fkey
  FOREIGN KEY (project_id)
  REFERENCES ag_catalog.projects(id)
  ON DELETE CASCADE
;

ALTER TABLE liq_core.memory_space
  VALIDATE CONSTRAINT memory_space_project_id_fkey;

COMMENT ON CONSTRAINT memory_space_project_id_fkey ON liq_core.memory_space IS
  'Canonical Hermes memory project authority: ag_catalog.projects.';

COMMIT;
