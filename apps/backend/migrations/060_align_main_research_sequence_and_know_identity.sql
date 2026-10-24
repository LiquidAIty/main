-- Entity: Saved Cards
-- Relationship: Append-revises current Main and KnowGraph Cards so retired
-- execution and Know-attachment instructions cannot remain live.
-- Entity: Main Chat
-- Relationship: Adds the bounded clarify, ThinkGraph, KnowGraph, conclusion,
-- then optional execution sequence without replacing the saved prompt.
-- Entity: KnowGraph
-- Relationship: Replaces legacy ABOUT attachment wording with the exact
-- entity_uuid property contract while leaving historical revisions immutable.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

DO $$
DECLARE
  source RECORD;
  next_revision_id UUID;
  next_revision_number INTEGER;
  copied_grants JSONB;
  next_prompt TEXT;
  next_stable JSONB;
  next_revision_sha256 TEXT;
  retired_magnetic TEXT :=
    'Wiring never starts work. Invoke Magnetic only for an approved mission through the existing run_mag_one TaskGraph workflow and its exact blue-connected saved workers. Do not replace Magnetic with delegate_task or another task system.';
  current_magnetic TEXT :=
    'Wiring never starts work. Invoke @Magnetic only through message_agent after @Builder has produced a graph-anchored PromptSpec and Main has reviewed it; Hermes owns the exact blue-connected TaskGraph workers.';
  research_sequence TEXT := $sequence$[RESEARCH SEQUENCE]
For an ambiguous or high-consequence request, ask bounded clarifying questions through ordinary Main chat first. Let those completed exchanges build useful ThinkGraph reasoning, then call wired @KnowGraph for the current sourced evidence needed to test that reasoning. Reconcile both into a conclusion before proposing or starting execution. Use direct Bot calls for bounded testing; use @Builder and then @Magnetic only for substantial execution after the conclusion.$sequence$;
  retired_know_identity TEXT :=
    'exactly one ABOUT Entity attachment';
  current_know_identity TEXT :=
    'one exact stored Entity UUID and no ABOUT or MENTIONS attachment edge';
  retired_know_readback TEXT :=
    'Confirm the exact Know and ABOUT Entity readback before describing it as persisted.';
  current_know_readback TEXT :=
    'Confirm the exact Know readback carries the same stored entity_uuid before describing it as persisted.';
BEGIN
  FOR source IN
    SELECT revision.*, membership.presentation_config
    FROM ag_catalog.agent_cards AS card
    JOIN ag_catalog.agent_card_revisions AS revision
      ON revision.revision_id = card.current_revision_id
    JOIN ag_catalog.deck_card_memberships AS membership
      ON membership.project_id = card.project_id
     AND membership.deck_id = card.deck_id
     AND membership.card_id = card.card_id
    WHERE revision.runtime_kind = 'hermes'
      AND (
        (
          revision.runtime_mode = 'main'
          AND (
            position(retired_magnetic IN revision.base_prompt) > 0
            OR position('[RESEARCH SEQUENCE]' IN revision.base_prompt) = 0
            OR EXISTS (
              SELECT 1
              FROM ag_catalog.card_capability_grants AS current_grant
              WHERE current_grant.revision_id = revision.revision_id
                AND current_grant.grant_id = 'run_mag_one'
            )
          )
        )
        OR (
          revision.runtime_profile = 'knowgraph'
          AND (
            position(retired_know_identity IN revision.base_prompt) > 0
            OR position(retired_know_readback IN revision.base_prompt) > 0
          )
        )
      )
    FOR UPDATE OF card
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
    WHERE revision_id = source.revision_id
      AND grant_id <> 'run_mag_one';

    SELECT COALESCE(MAX(revision_number), 0) + 1
    INTO next_revision_number
    FROM ag_catalog.agent_card_revisions
    WHERE project_id = source.project_id
      AND deck_id = source.deck_id
      AND card_id = source.card_id;

    next_revision_id := gen_random_uuid();
    next_prompt := source.base_prompt;
    IF source.runtime_mode = 'main' THEN
      next_prompt := replace(next_prompt, retired_magnetic, current_magnetic);
      IF position('[RESEARCH SEQUENCE]' IN next_prompt) = 0 THEN
        next_prompt := next_prompt || E'\n\n' || research_sequence;
      END IF;
    ELSIF source.runtime_profile = 'knowgraph' THEN
      next_prompt := replace(next_prompt, retired_know_identity, current_know_identity);
      next_prompt := replace(next_prompt, retired_know_readback, current_know_readback);
    END IF;

    next_stable := jsonb_build_object(
      'cardId', source.card_id,
      'templateId', source.template_id,
      'kind', source.kind,
      'title', source.title,
      'subtitle', source.subtitle,
      'role', source.role,
      'parentGraphId', source.parent_graph_id,
      'basePrompt', next_prompt,
      'stableOutputContract', source.stable_output_contract,
      'runtime', jsonb_build_object(
        'kind', source.runtime_kind,
        'mode', source.runtime_mode,
        'profile', source.runtime_profile
      ),
      'provider', source.provider,
      'modelKey', source.model_key,
      'providerModelId', source.provider_model_id,
      'accessMode', source.access_mode,
      'reasoningEffort', source.reasoning_effort,
      'enabled', source.enabled,
      'enabledLocation', source.enabled_location,
      'runtimeExtensions', COALESCE(source.runtime_extension_config, '{}'::jsonb),
      'grants', copied_grants,
      'presentationProperties', source.presentation_config
    );
    next_revision_sha256 := encode(
      digest(convert_to(next_stable::text, 'UTF8'), 'sha256'),
      'hex'
    );

    INSERT INTO ag_catalog.agent_card_revisions (
      revision_id, project_id, deck_id, card_id, revision_number,
      template_id, kind, title, subtitle, role, parent_graph_id,
      base_prompt, base_prompt_sha256, stable_output_contract,
      runtime_kind, runtime_mode, runtime_profile, provider, model_key,
      provider_model_id, access_mode, reasoning_effort, temperature,
      max_tokens, max_turns, enabled, enabled_location,
      runtime_extension_config, revision_sha256
    ) VALUES (
      next_revision_id, source.project_id, source.deck_id, source.card_id,
      next_revision_number, source.template_id, source.kind, source.title,
      source.subtitle, source.role, source.parent_graph_id,
      next_prompt,
      encode(digest(convert_to(next_prompt, 'UTF8'), 'sha256'), 'hex'),
      source.stable_output_contract, source.runtime_kind, source.runtime_mode,
      source.runtime_profile, source.provider, source.model_key,
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
    WHERE revision_id = source.revision_id
      AND grant_id <> 'run_mag_one';

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

  UPDATE ag_catalog.deck_prompt_templates
  SET content = replace(content, retired_magnetic, current_magnetic)
  WHERE template_id = 'prompt_main_chat'
    AND position(retired_magnetic IN content) > 0;

  UPDATE ag_catalog.deck_prompt_templates
  SET content = content || E'\n\n' || research_sequence
  WHERE template_id = 'prompt_main_chat'
    AND position('[RESEARCH SEQUENCE]' IN content) = 0;

  UPDATE ag_catalog.deck_prompt_templates
  SET content = replace(
    replace(content, retired_know_identity, current_know_identity),
    retired_know_readback,
    current_know_readback
  )
  WHERE template_id = 'prompt_knowgraph'
    AND (
      position(retired_know_identity IN content) > 0
      OR position(retired_know_readback IN content) > 0
    );
END
$$;

COMMIT;
