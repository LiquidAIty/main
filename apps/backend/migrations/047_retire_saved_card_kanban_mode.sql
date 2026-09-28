-- Retire the saved-Card runtime mode literally named `kanban` without
-- rewriting historical Card revisions or completed Run evidence. Native
-- Hermes kanban.db task/dependency execution remains Magnetic authority.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_cards AS card
    JOIN ag_catalog.agent_card_revisions AS revision
      ON revision.revision_id = card.current_revision_id
    WHERE revision.runtime_kind = 'hermes'
      AND revision.runtime_mode = 'kanban'
  ) THEN
    RAISE EXCEPTION 'retired_kanban_card_mode_current_state_present';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_runs AS run
    WHERE run.runtime_kind = 'hermes'
      AND run.runtime_mode = 'kanban'
      AND run.state IN ('pending', 'running')
  ) THEN
    RAISE EXCEPTION 'retired_kanban_card_mode_active_run_present';
  END IF;
END
$$;

ALTER TABLE ag_catalog.agent_card_revisions
  DROP CONSTRAINT IF EXISTS agent_card_revisions_runtime_check;
ALTER TABLE ag_catalog.agent_card_revisions
  ADD CONSTRAINT agent_card_revisions_runtime_check CHECK (
    runtime_kind = 'hermes'
    AND runtime_mode IN ('main', 'delegate', 'magentic_one')
    AND runtime_profile IS NOT NULL
  ) NOT VALID;

ALTER TABLE ag_catalog.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_runtime_check;
ALTER TABLE ag_catalog.agent_runs
  ADD CONSTRAINT agent_runs_runtime_check CHECK (
    runtime_kind = 'hermes'
    AND runtime_mode IN ('main', 'delegate', 'magentic_one')
  ) NOT VALID;

COMMIT;
