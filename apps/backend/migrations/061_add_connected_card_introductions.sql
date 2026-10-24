-- Entity: Saved Cards
-- Relationship: Append-revises connected saved Cards with the short introduction
-- their orchestrators display and receive, without changing Card execution.
-- Entity: Bot Mode Delegation
-- Relationship: Each introduction names the exact @Card call, specialty, input,
-- capabilities, and expected result while leaving wires as the sole authority.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

DO $$
DECLARE
  source RECORD;
  introduction TEXT;
  next_prompt TEXT;
  next_revision_id UUID;
  next_revision_number INTEGER;
  copied_grants JSONB;
  next_stable JSONB;
  next_revision_sha256 TEXT;
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
      AND revision.runtime_profile IN (
        'builder', 'thinkgraph', 'knowgraph', 'trading', 'worldview',
        'card_magentic', 'signal-analyst', 'quant-analyst', 'team'
      )
      AND position('[ORCHESTRATOR SKILL]' IN revision.base_prompt) = 0
    FOR UPDATE OF card
  LOOP
    introduction := CASE source.runtime_profile
      WHEN 'builder' THEN $skill$Builder specializes in constructing prompts, saved Cards, applications, UI pages, webpages, code, and implementation artifacts. It uses repository inspection, files, terminal, browser or web, code execution, vision, and CodeGraph tools only when those capabilities are granted.

Call @Builder through message_agent for actual construction work or when a mature Project needs a graph-anchored execution PromptSpec for Magnetic. Give it the bounded objective and exact relevant ThinkGraph and KnowGraph references; expect a reviewed artifact or PromptSpec with evidence, tests, blockers, and unresolved decisions.$skill$
      WHEN 'thinkgraph' THEN $skill$ThinkGraph specializes in the Project's accumulated reasoning history in Engraphis: how an idea evolved, what was agreed, which assumptions conflict, and what remains unresolved. It uses Engraphis discovery and exact memory reads; ordinary completed Main turns are captured automatically.

Call @ThinkGraph through message_agent only for an explicit historical synthesis or when compact grounding cannot answer a cross-turn question. Provide the relevant Entities or exact Think references; expect a read-only synthesis grounded in Think IDs, not sourced evidence or a new graph write.$skill$
      WHEN 'knowgraph' THEN $skill$KnowGraph specializes in current sourced research and durable provenance. Its existing AutoTeam v1 flow decides the bounded searches, runs read-only search workers, rates their evidence, synthesizes accepted findings, and uses grounded-citation and Graphiti tools for any useful verified Knows.

Call @KnowGraph through message_agent for current facts, evidence checking, contrary evidence, or durable Project knowledge. Send one bounded question with the relevant Entity and proposition; expect search coverage, accepted and rejected finding counts, a sourced synthesis, unknowns, and persistence only when exact readback succeeded.$skill$
      WHEN 'trading' THEN $skill$Trader specializes in paper-trading decisions and deterministic Trade Jobs through its saved trading tools and supplied market or research evidence. It does not replace sourced research and does not turn a request into a live trade.

Call @Trader through message_agent only for an explicit paper-trading analysis, paper decision, or permitted Trade Job. Supply the thesis, instrument universe, time horizon, risk constraints, and relevant sourced evidence; expect a bounded paper result, assumptions, risk, job status, or an exact blocker.$skill$
      WHEN 'worldview' THEN $skill$WorldView specializes in satellite and space-signal discovery plus supervised focus on the existing 3D globe. It uses its saved signal-discovery and WorldView capabilities with deliberately selected Project context.

Call @WorldView through message_agent when the task needs satellite or space-object discovery, identification, comparison, or a real globe-focus update. Supply the target question and any known identifiers; expect sourced signal findings and exact focused identifiers or an honest no-change result.$skill$
      WHEN 'card_magentic' THEN $skill$Magnetic specializes in long-running coordinated execution through the existing Hermes TaskGraph and exact blue-connected worker roster. It has no CLI and is not a substitute for ordinary direct Bot calls.

Call @Magnetic through message_agent after @Builder has engineered a graph-anchored PromptSpec and Main has reviewed it, when the Project is mature enough for sustained multi-worker execution. Send that exact PromptSpec; expect asynchronous TaskGraph progress and one synthesized result while Main remains available to the user.$skill$
      WHEN 'signal-analyst' THEN $skill$Analyst specializes in assessing sourced evidence: what a source establishes, what it does not establish, how current it is, and which claims remain weak or contradicted. It uses only its saved evidence and research capabilities.

Call @Analyst through message_agent when a decision needs claim-by-claim evidence review rather than new orchestration. Supply the proposition, sources or exact research references, and decision criteria; expect a bounded assessment of support, challenge, gaps, uncertainty, and invalidators.$skill$
      WHEN 'quant-analyst' THEN $skill$Quant specializes in bounded numerical signal assessment, comparisons, scenarios, and sensitivity checks using its saved deterministic computation and data capabilities. It does not invent missing inputs or turn an estimate into sourced evidence.

Call @Quant through message_agent when the decision depends on explicit calculations, relative magnitudes, thresholds, or scenario ranges. Supply the quantities, units, assumptions, horizon, and requested comparison; expect reproducible results, sensitivity, uncertainty, and missing-input blockers.$skill$
      WHEN 'team' THEN $skill$Team is the general-purpose Bot and Magnetic wildcard for bounded work that does not belong to a more specific Card. It may use its granted web, terminal, file, browser, vision, and code-execution tools without creating another scheduler or hidden Card system.

Call @Team through message_agent for a bounded generalist task or deliberate Bot Mode test, and let @Magnetic use it as fallback TaskGraph capacity. Provide one exact assignment and necessary references; expect one evidence-backed result with uncertainty and capability gaps.$skill$
      ELSE NULL
    END;
    IF introduction IS NULL THEN
      CONTINUE;
    END IF;

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
    next_prompt := source.base_prompt || E'\n\n[ORCHESTRATOR SKILL]\n' || introduction;
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
