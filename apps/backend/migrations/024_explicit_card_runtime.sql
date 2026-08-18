-- Replace the historical runtime-type/binding/facet combination with one
-- explicit Card runtime union.  This migration is intentionally strict: an
-- unknown mixed state aborts the transaction instead of guessing from titles,
-- prompts, tools, or presentation data.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_card_revisions
    WHERE NOT (
      (runtime_type = 'magentic_one' AND runtime_binding IS NULL)
      OR (runtime_type = 'magentic_one' AND runtime_binding = 'magentic_one')
      OR (
        runtime_type = 'assistant_agent'
        AND runtime_binding IN (
          'assist', 'local_coder', 'main_chat', 'coder', 'research_agent',
          'plan_agent', 'worldsignals_agent', 'trading_agent', 'hermes_steward'
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'explicit_card_runtime_migration_unmapped_state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_card_revisions
    WHERE runtime_binding IN ('local_coder', 'coder')
      AND card_id <> 'card_local_coder'
  ) THEN
    RAISE EXCEPTION 'explicit_card_runtime_migration_coder_identity_ambiguous';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_card_revisions
    WHERE (runtime_binding = 'main_chat' AND card_id <> 'card_main_chat')
       OR (runtime_binding = 'hermes_steward' AND card_id <> 'card_hermes_steward')
  ) THEN
    RAISE EXCEPTION 'explicit_card_runtime_migration_hermes_identity_ambiguous';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ag_catalog.hermes_card_facets
    WHERE instruction_text <> ''
  ) OR EXISTS (
    SELECT 1
    FROM ag_catalog.autogen_card_facets
    WHERE system_message <> ''
  ) THEN
    RAISE EXCEPTION 'explicit_card_runtime_migration_duplicate_prompt_not_empty';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_card_revisions
    WHERE (runtime_binding = 'hermes_steward' AND execution_mode <> 'auto-kanban')
       OR (
         runtime_binding IN ('main_chat', 'coder')
         AND execution_mode IS DISTINCT FROM 'single'
       )
       OR (
         runtime_binding = 'local_coder'
         AND execution_mode IS NOT NULL
         AND execution_mode <> 'single'
       )
  ) THEN
    RAISE EXCEPTION 'explicit_card_runtime_migration_execution_mode_conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_card_revisions
    WHERE access_mode = 'coder-oauth' AND card_id <> 'card_local_coder'
  ) THEN
    RAISE EXCEPTION 'explicit_card_runtime_migration_coder_oauth_ambiguous';
  END IF;
END
$$;

ALTER TABLE ag_catalog.agent_card_revisions
  ADD COLUMN runtime_kind TEXT,
  ADD COLUMN runtime_mode TEXT,
  ADD COLUMN runtime_profile TEXT;

UPDATE ag_catalog.agent_card_revisions AS revision
SET runtime_kind = CASE
      WHEN revision.runtime_type = 'magentic_one' THEN 'autogen'
      WHEN revision.runtime_binding IN ('main_chat', 'coder', 'local_coder', 'hermes_steward')
        THEN 'hermes'
      ELSE 'autogen'
    END,
    runtime_mode = CASE
      WHEN revision.runtime_type = 'magentic_one' THEN 'magentic_one'
      WHEN revision.runtime_binding = 'main_chat' THEN 'main'
      WHEN revision.runtime_binding IN ('coder', 'local_coder') THEN 'delegate'
      WHEN revision.runtime_binding = 'hermes_steward' THEN 'kanban'
      ELSE 'assistant'
    END,
    runtime_profile = CASE
      WHEN revision.runtime_binding = 'main_chat'
        THEN COALESCE(facet.profile_name, 'liquidaity-main')
      WHEN revision.runtime_binding IN ('coder', 'local_coder')
        THEN COALESCE(facet.profile_name, 'coder')
      WHEN revision.runtime_binding = 'hermes_steward'
        THEN COALESCE(facet.profile_name, 'liquidaity-hermes-steward')
      ELSE NULL
    END
FROM ag_catalog.agent_card_revisions AS source
LEFT JOIN ag_catalog.hermes_card_facets AS facet
  ON facet.revision_id = source.revision_id
WHERE revision.revision_id = source.revision_id;

-- The retired OpenClaude account mode existed only on the historical Coder
-- revision.  The migrated Hermes Coder uses the saved ChatGPT/Codex account.
UPDATE ag_catalog.agent_card_revisions
SET access_mode = 'chatgpt-account'
WHERE card_id = 'card_local_coder' AND access_mode = 'coder-oauth';

ALTER TABLE ag_catalog.agent_card_revisions
  ALTER COLUMN runtime_kind SET NOT NULL,
  ALTER COLUMN runtime_mode SET NOT NULL,
  DROP CONSTRAINT IF EXISTS agent_card_revisions_runtime_type_check,
  DROP CONSTRAINT IF EXISTS agent_card_revisions_access_mode_check,
  DROP CONSTRAINT IF EXISTS agent_card_revisions_execution_mode_check;

ALTER TABLE ag_catalog.agent_card_revisions
  ADD CONSTRAINT agent_card_revisions_runtime_check CHECK (
    (runtime_kind = 'hermes'
      AND runtime_mode IN ('main', 'delegate', 'kanban')
      AND runtime_profile IS NOT NULL)
    OR
    (runtime_kind = 'autogen'
      AND runtime_mode IN ('assistant', 'magentic_one')
      AND runtime_profile IS NULL)
  ),
  ADD CONSTRAINT agent_card_revisions_access_mode_check CHECK (
    access_mode IS NULL OR access_mode IN (
      'chatgpt-account', 'openai-api', 'openrouter-api'
    )
  ),
  DROP COLUMN runtime_type,
  DROP COLUMN runtime_binding,
  DROP COLUMN execution_mode;

DROP TABLE ag_catalog.hermes_card_facets;
DROP TABLE ag_catalog.autogen_card_facets;

ALTER TABLE ag_catalog.agent_runs
  ADD COLUMN runtime_kind TEXT,
  ADD COLUMN runtime_mode TEXT;

UPDATE ag_catalog.agent_runs AS run
SET runtime_kind = revision.runtime_kind,
    runtime_mode = revision.runtime_mode
FROM ag_catalog.agent_card_revisions AS revision
WHERE revision.revision_id = run.target_card_revision_id;

ALTER TABLE ag_catalog.agent_runs
  ALTER COLUMN runtime_kind SET NOT NULL,
  ALTER COLUMN runtime_mode SET NOT NULL,
  ADD CONSTRAINT agent_runs_runtime_check CHECK (
    (runtime_kind = 'hermes' AND runtime_mode IN ('main', 'delegate', 'kanban'))
    OR
    (runtime_kind = 'autogen' AND runtime_mode IN ('assistant', 'magentic_one'))
  ),
  DROP COLUMN runtime_type;

UPDATE ag_catalog.agent_decks
SET document_version = 7
WHERE document_version < 7;

REVOKE ALL ON ag_catalog.agent_card_revisions FROM "liquidaity-user";
GRANT SELECT, INSERT ON ag_catalog.agent_card_revisions TO "liquidaity-user";

COMMIT;
