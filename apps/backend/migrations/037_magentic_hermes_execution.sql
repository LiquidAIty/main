-- Move the existing Mag One Card, plus the WorldSignals seed, onto their exact
-- Hermes profiles. Old rows remain inert; NOT VALID checks reject every new
-- non-Hermes revision or Run without requiring a data-deletion migration.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

ALTER TABLE ag_catalog.agent_card_revisions
  DROP CONSTRAINT IF EXISTS agent_card_revisions_runtime_check;
ALTER TABLE ag_catalog.agent_card_revisions
  ADD CONSTRAINT agent_card_revisions_runtime_check CHECK (
    runtime_kind = 'hermes'
    AND runtime_mode IN ('main', 'delegate', 'kanban', 'magentic_one')
    AND runtime_profile IS NOT NULL
  ) NOT VALID;

ALTER TABLE ag_catalog.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_runtime_check;
ALTER TABLE ag_catalog.agent_runs
  ADD CONSTRAINT agent_runs_runtime_check CHECK (
    runtime_kind = 'hermes'
    AND runtime_mode IN ('main', 'delegate', 'kanban', 'magentic_one')
  ) NOT VALID;

DO $$
DECLARE
  source RECORD;
  next_revision_id UUID;
  next_revision_number INTEGER;
  next_runtime_mode TEXT;
  next_runtime_profile TEXT;
  next_stable JSONB;
  next_revision_sha256 TEXT;
  copied_grants JSONB;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_cards AS card
    JOIN ag_catalog.agent_card_revisions AS revision
      ON revision.revision_id = card.current_revision_id
    WHERE revision.runtime_kind = 'autogen'
      AND NOT (
        (card.card_id = 'card_magentic' AND revision.runtime_mode = 'magentic_one')
        OR
        (card.card_id = 'card_worldsignals_agent' AND revision.runtime_mode = 'assistant')
      )
  ) THEN
    RAISE EXCEPTION 'magentic_hermes_migration_unmapped_current_runtime';
  END IF;

  FOR source IN
    SELECT revision.*, membership.presentation_config
    FROM ag_catalog.agent_cards AS card
    JOIN ag_catalog.agent_card_revisions AS revision
      ON revision.revision_id = card.current_revision_id
    JOIN ag_catalog.deck_card_memberships AS membership
      ON membership.project_id = card.project_id
     AND membership.deck_id = card.deck_id
     AND membership.card_id = card.card_id
    WHERE revision.runtime_kind = 'autogen'
      AND (
        (card.card_id = 'card_magentic' AND revision.runtime_mode = 'magentic_one')
        OR
        (card.card_id = 'card_worldsignals_agent' AND revision.runtime_mode = 'assistant')
      )
    FOR UPDATE OF card
  LOOP
    next_runtime_mode := CASE source.card_id
      WHEN 'card_magentic' THEN 'magentic_one'
      ELSE 'delegate'
    END;
    next_runtime_profile := CASE source.card_id
      WHEN 'card_magentic' THEN 'card_magentic'
      ELSE 'worldsignals'
    END;

    SELECT jsonb_build_object(
      'tools', COALESCE(
        jsonb_agg(grant_id ORDER BY ordinal) FILTER (WHERE grant_kind = 'tool'),
        '[]'::jsonb
      ),
      'nativeTools', COALESCE(
        jsonb_agg(grant_id ORDER BY ordinal) FILTER (WHERE grant_kind = 'native_tool'),
        '[]'::jsonb
      ),
      'skills', COALESCE(
        jsonb_agg(grant_id ORDER BY ordinal) FILTER (WHERE grant_kind = 'skill'),
        '[]'::jsonb
      ),
      'toolsets', COALESCE(
        jsonb_agg(grant_id ORDER BY ordinal) FILTER (WHERE grant_kind = 'toolset'),
        '[]'::jsonb
      ),
      'mcpConnectionIds', COALESCE(
        jsonb_agg(grant_id ORDER BY ordinal) FILTER (WHERE grant_kind = 'mcp_connection'),
        '[]'::jsonb
      )
    )
    INTO copied_grants
    FROM ag_catalog.card_capability_grants
    WHERE revision_id = source.revision_id;

    SELECT COALESCE(MAX(revision_number), 0) + 1
    INTO next_revision_number
    FROM ag_catalog.agent_card_revisions
    WHERE project_id = source.project_id
      AND deck_id = source.deck_id
      AND card_id = source.card_id;

    next_revision_id := gen_random_uuid();
    next_stable := jsonb_build_object(
      'cardId', source.card_id,
      'templateId', source.template_id,
      'kind', source.kind,
      'title', source.title,
      'subtitle', source.subtitle,
      'role', source.role,
      'status', source.status,
      'parentGraphId', source.parent_graph_id,
      'basePrompt', source.base_prompt,
      'stableOutputContract', source.stable_output_contract,
      'runtime', jsonb_build_object(
        'kind', 'hermes',
        'mode', next_runtime_mode,
        'profile', next_runtime_profile
      ),
      'provider', source.provider,
      'modelKey', source.model_key,
      'providerModelId', source.provider_model_id,
      'accessMode', source.access_mode,
      'reasoningEffort', source.reasoning_effort,
      'temperature', source.temperature,
      'maxTokens', source.max_tokens,
      'maxTurns', source.max_turns,
      'enabled', source.enabled,
      'enabledLocation', source.enabled_location,
      'runtimeExtensions', source.runtime_extension_config,
      'grants', copied_grants,
      'presentationProperties', source.presentation_config
    );
    next_revision_sha256 := encode(
      digest(convert_to(next_stable::text, 'UTF8'), 'sha256'),
      'hex'
    );

    INSERT INTO ag_catalog.agent_card_revisions (
      revision_id, project_id, deck_id, card_id, revision_number,
      template_id, kind, title, subtitle, role, status, parent_graph_id,
      base_prompt, base_prompt_sha256, stable_output_contract,
      runtime_kind, runtime_mode, runtime_profile, provider, model_key,
      provider_model_id, access_mode, reasoning_effort, temperature,
      max_tokens, max_turns, enabled, enabled_location,
      runtime_extension_config, revision_sha256
    ) VALUES (
      next_revision_id, source.project_id, source.deck_id, source.card_id,
      next_revision_number, source.template_id, source.kind, source.title,
      source.subtitle, source.role, source.status, source.parent_graph_id,
      source.base_prompt, source.base_prompt_sha256,
      source.stable_output_contract, 'hermes', next_runtime_mode,
      next_runtime_profile, source.provider, source.model_key,
      source.provider_model_id, source.access_mode, source.reasoning_effort,
      source.temperature, source.max_tokens, source.max_turns, source.enabled,
      source.enabled_location, source.runtime_extension_config,
      next_revision_sha256
    );

    INSERT INTO ag_catalog.card_capability_grants (
      revision_id, grant_kind, ordinal, grant_id
    )
    SELECT next_revision_id, grant_kind, ordinal, grant_id
    FROM ag_catalog.card_capability_grants
    WHERE revision_id = source.revision_id;

    UPDATE ag_catalog.agent_cards
    SET current_revision_id = next_revision_id
    WHERE project_id = source.project_id
      AND deck_id = source.deck_id
      AND card_id = source.card_id;

    UPDATE ag_catalog.agent_decks
    SET revision = gen_random_uuid()::text,
        saved_at = NOW(),
        updated_at = NOW()
    WHERE project_id = source.project_id
      AND deck_id = source.deck_id;
  END LOOP;
END
$$;

COMMIT;
