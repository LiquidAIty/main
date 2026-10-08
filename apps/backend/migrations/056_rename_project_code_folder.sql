-- Name the Project-owned Builder code-folder field literally. Existing values
-- are preserved; current validation refuses absolute host paths before use.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

ALTER TABLE ag_catalog.agent_decks
  RENAME COLUMN workspace_root TO project_code_folder;

-- The retired field accepted machine-specific absolute paths, including the
-- LiquidAIty checkout. Retain already-portable names and clear only values that
-- cannot satisfy the new managed-storage contract.
UPDATE ag_catalog.agent_decks
SET project_code_folder = NULL
WHERE project_code_folder IS NOT NULL
  AND (
    BTRIM(project_code_folder) = ''
    OR LENGTH(BTRIM(project_code_folder)) > 100
    OR BTRIM(project_code_folder) IN ('.', '..')
    OR BTRIM(project_code_folder) ~ '[\\/<>:"|?*]'
    OR BTRIM(project_code_folder) ~ '[[:cntrl:]]'
    OR BTRIM(project_code_folder) ~ '[. ]$'
    OR BTRIM(project_code_folder) ~* '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$'
  );

UPDATE ag_catalog.agent_decks
SET project_code_folder = BTRIM(project_code_folder)
WHERE project_code_folder IS NOT NULL;

COMMIT;
