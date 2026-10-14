-- Add the approved Project Bot/worker operating policy to each current saved
-- Hermes Main prompt and remove retired application-selected provider transport,
-- temperature, token-limit, and turn-limit controls from every current Hermes
-- Card. Hermes owns provider transport; the saved model owns its supported
-- generation controls.
-- Retired shared-chat activity labels are rewritten in place to the single
-- Project-conversation vocabulary; message content and identity are unchanged.
-- Historical revisions and grants remain immutable; each affected Card
-- receives one otherwise-identical current revision.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

DO $$
DECLARE
  source RECORD;
  next_revision_id UUID;
  next_revision_number INTEGER;
  copied_grants JSONB;
  clean_runtime_extensions JSONB;
  next_prompt TEXT;
  next_stable JSONB;
  next_revision_sha256 TEXT;
  policy_text CONSTANT TEXT := $policy$[OPERATING POLICY]
Use the current Project's enabled outbound orange flow wires as the complete direct Bot roster. Blue magentic_option wires only select Magnetic workers and never create direct Bot authority.
Answer directly when another Card is unnecessary. When a connected Card is needed, use Hermes message_agent. Never impersonate a recipient, switch profiles, write into another Card's terminal, or substitute another execution route.
When the user explicitly addresses an eligible @Card, compose one bounded message and send it once with message_agent. The recipient provides the visible answer under its own identity; after the queued acknowledgement, return [SILENT] instead of adding or rewriting a Main answer. Queued or accepted delivery is not completed work.
When you independently consult a connected Card, wait for its actual returned result and use that result in your answer. Never invent a result or hide a delivery failure.
Wiring never starts work. Invoke Magnetic only for an approved mission through the existing run_mag_one TaskGraph workflow and its exact blue-connected saved workers. Do not replace Magnetic with delegate_task or another task system.
Do not claim ThinkGraph capture occurred unless the runtime reports it. Use KnowGraph for sourced research and distinguish a returned finding from a confirmed saved Know.
Builder is the same saved Builder shown in the lower terminal.$policy$;
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
          AND position('[OPERATING POLICY]' IN revision.base_prompt) = 0
        )
        OR COALESCE(revision.runtime_extension_config, '{}'::jsonb)
          ?| ARRAY['openaiRuntime', 'team', 'writeMode']
        OR revision.temperature IS NOT NULL
        OR revision.max_tokens IS NOT NULL
        OR revision.max_turns IS NOT NULL
        OR revision.status IS NOT NULL
        OR membership.display_status IS NOT NULL
        OR COALESCE(revision.runtime_extension_config, '{}'::jsonb)
          #> '{script,hermesSupport}' IS NOT NULL
        OR COALESCE(revision.runtime_extension_config, '{}'::jsonb)
          #> '{script,nativeSupport}' IS NOT NULL
        OR COALESCE(revision.runtime_extension_config, '{}'::jsonb)
          #> '{script,rollback}' IS NOT NULL
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
    WHERE revision_id = source.revision_id;

    SELECT COALESCE(MAX(revision_number), 0) + 1
    INTO next_revision_number
    FROM ag_catalog.agent_card_revisions
    WHERE project_id = source.project_id
      AND deck_id = source.deck_id
      AND card_id = source.card_id;

    next_revision_id := gen_random_uuid();
    next_prompt := CASE
      WHEN source.runtime_mode = 'main'
        AND position('[OPERATING POLICY]' IN source.base_prompt) = 0
      THEN rtrim(source.base_prompt) || E'\n\n' || policy_text
      ELSE source.base_prompt
    END;
    clean_runtime_extensions := COALESCE(
      source.runtime_extension_config, '{}'::jsonb
    ) - 'openaiRuntime' - 'team' - 'writeMode';
    IF jsonb_typeof(clean_runtime_extensions->'script') = 'object' THEN
      clean_runtime_extensions := jsonb_set(
        clean_runtime_extensions,
        '{script}',
        (clean_runtime_extensions->'script')
          - 'hermesSupport' - 'nativeSupport' - 'rollback'
      );
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
      'runtimeExtensions', clean_runtime_extensions,
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
      NULL, NULL, NULL, source.enabled,
      source.enabled_location, clean_runtime_extensions,
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

    UPDATE ag_catalog.deck_card_memberships
    SET display_status = NULL
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

WITH rewritten AS (
  SELECT message.project_id,
         message.message_id,
         jsonb_agg(
           CASE entry.item->>'kind'
             WHEN 'shared_chat_speaker' THEN jsonb_set(
               entry.item, '{kind}', '"conversation_speaker"'::jsonb
             )
             WHEN 'shared_chat_target' THEN jsonb_set(
               entry.item, '{kind}', '"conversation_target"'::jsonb
             )
             ELSE entry.item
           END
           ORDER BY entry.ordinal
         ) AS visible_activities
  FROM ag_catalog.conversation_messages AS message
  CROSS JOIN LATERAL jsonb_array_elements(message.visible_activities)
    WITH ORDINALITY AS entry(item, ordinal)
  WHERE jsonb_typeof(message.visible_activities) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(message.visible_activities) AS candidate(item)
      WHERE candidate.item->>'kind' IN (
        'shared_chat_speaker', 'shared_chat_target'
      )
    )
  GROUP BY message.project_id, message.message_id
)
UPDATE ag_catalog.conversation_messages AS message
SET visible_activities = rewritten.visible_activities
FROM rewritten
WHERE message.project_id = rewritten.project_id
  AND message.message_id = rewritten.message_id;

COMMIT;
