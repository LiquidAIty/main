-- Move the current saved Main authority to the canonical Hermes profile and
-- replace retired Hermes field vocabulary without retaining dual names.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

ALTER TABLE ag_catalog.card_capability_grants
  DROP CONSTRAINT IF EXISTS card_capability_grants_grant_kind_check;

DO $$
DECLARE
  old_grant_kind TEXT := concat('na', 'tive', '_tool');
BEGIN
  UPDATE ag_catalog.card_capability_grants
  SET grant_kind = 'hermes_tool'
  WHERE grant_kind = old_grant_kind;
END
$$;

ALTER TABLE ag_catalog.card_capability_grants
  ADD CONSTRAINT card_capability_grants_grant_kind_check CHECK (
    grant_kind IN ('tool', 'hermes_tool', 'skill', 'toolset', 'mcp_connection', 'coder_card')
  );

DO $$
DECLARE
  source RECORD;
  old_profile TEXT := concat('liquid', 'aity', '-main');
  next_revision_id UUID;
  next_revision_number INTEGER;
  copied_grants JSONB;
  next_stable JSONB;
  next_revision_sha256 TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ag_catalog.agent_cards AS card
    JOIN ag_catalog.agent_card_revisions AS revision
      ON revision.revision_id = card.current_revision_id
    WHERE revision.runtime_kind = 'hermes'
      AND revision.runtime_profile = 'main'
      AND card.card_id <> 'card_main_chat'
  ) THEN
    RAISE EXCEPTION 'main_profile_already_bound';
  END IF;

  FOR source IN
    SELECT revision.*, COALESCE(membership.presentation_config, '{}'::jsonb) AS presentation_config
    FROM ag_catalog.agent_card_revisions AS revision
    JOIN (
      SELECT DISTINCT current_revision_id
      FROM ag_catalog.agent_cards
      WHERE card_id = 'card_main_chat'
    ) AS current_card
      ON current_card.current_revision_id = revision.revision_id
    LEFT JOIN ag_catalog.deck_card_memberships AS membership
      ON membership.project_id = revision.project_id
     AND membership.deck_id = revision.deck_id
     AND membership.card_id = revision.card_id
    WHERE revision.card_id = 'card_main_chat'
      AND revision.runtime_kind = 'hermes'
      AND revision.runtime_mode = 'main'
      AND revision.runtime_profile = old_profile
    FOR UPDATE OF revision
  LOOP
    SELECT jsonb_build_object(
      'tools', COALESCE(
        jsonb_agg(grant_id ORDER BY ordinal) FILTER (WHERE grant_kind = 'tool'),
        '[]'::jsonb
      ),
      'hermesTools', COALESCE(
        jsonb_agg(grant_id ORDER BY ordinal) FILTER (WHERE grant_kind = 'hermes_tool'),
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
        'kind', source.runtime_kind,
        'mode', source.runtime_mode,
        'profile', 'main'
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
      source.stable_output_contract, source.runtime_kind, source.runtime_mode,
      'main', source.provider, source.model_key,
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
    WHERE card_id = source.card_id
      AND current_revision_id = source.revision_id;

    UPDATE ag_catalog.agent_decks AS deck
    SET revision = gen_random_uuid()::text,
        saved_at = NOW(),
        updated_at = NOW()
    WHERE EXISTS (
      SELECT 1
      FROM ag_catalog.agent_cards AS card
      WHERE card.project_id = deck.project_id
        AND card.deck_id = deck.deck_id
        AND card.card_id = source.card_id
        AND card.current_revision_id = next_revision_id
    );
  END LOOP;
END
$$;

COMMIT;
