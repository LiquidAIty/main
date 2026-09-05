import { callPythonAgentSystemTool } from '../services/mcp/pythonAgentMcpClient';
import { getDeckDocument } from '../decks/store';

export type HermesProfileTarget = {
  cardId: string;
  cardRevisionId: string;
  title: string;
  profile: string;
  description: string;
};

export type HermesProfileDelegationAuthority = {
  projectId: string;
  deckId: string;
  deckRevision: string;
  conversationId: string;
  parentRunId: string;
  sourceCardId: string;
  sourceRuntimeMode: 'main' | 'delegate' | 'kanban';
  parentExecutionContextId: string;
  profileTargets: HermesProfileTarget[];
};

export type HermesProfileDelegationParams = {
  sessionId?: unknown;
  parentExecutionContextId?: unknown;
  nativeChildId?: unknown;
  targetProfile?: unknown;
  goal?: unknown;
  context?: unknown;
  dataAnchors?: unknown;
};

type SystemRunner = typeof callPythonAgentSystemTool;
type DeckReader = typeof getDeckDocument;

function bounded(value: unknown, field: string, limit: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`hermes_profile_${field}_must_be_string`);
  const text = value.trim();
  if (required && !text) throw new Error(`hermes_profile_${field}_required`);
  if (text.length > limit) throw new Error(`hermes_profile_${field}_too_long`);
  return text;
}

/**
 * Resolve one native profile choice to the canonical saved-Card runner.
 *
 * This function is only a fail-closed host adapter. Python's existing
 * card.run_assistant_agent handler still reloads the current saved deck,
 * verifies the directed flow edge, materializes one IDF, creates the child
 * Card Run, and executes the target's own saved profile/configuration.
 */
export async function runHermesProfileDelegation(
  authority: HermesProfileDelegationAuthority,
  params: HermesProfileDelegationParams,
  runSystemTool: SystemRunner = callPythonAgentSystemTool,
  readDeck: DeckReader = getDeckDocument,
): Promise<{
  nativeChildId: string;
  targetProfile: string;
  runId: string;
  result: string;
  nativeEvents: unknown[];
}> {
  const parentContext = bounded(
    params.parentExecutionContextId,
    'parent_execution_context_id',
    128,
    true,
  );
  if (parentContext !== authority.parentExecutionContextId) {
    throw new Error('hermes_profile_parent_context_mismatch');
  }
  const nativeChildId = bounded(params.nativeChildId, 'native_child_id', 128, true);
  if (!/^profile-[a-f0-9]{12}$/.test(nativeChildId)) {
    throw new Error('hermes_profile_native_child_id_invalid');
  }
  const targetProfile = bounded(params.targetProfile, 'target_profile', 64, true).toLowerCase();
  const target = authority.profileTargets.find((candidate) => (
    candidate.profile.toLowerCase() === targetProfile
  ));
  if (!target) throw new Error('hermes_profile_target_not_authorized');
  const goal = bounded(params.goal, 'goal', 100_000, true);
  const context = params.context === undefined
    ? ''
    : bounded(params.context, 'context', 100_000);
  const dataAnchors = params.dataAnchors === undefined ? undefined : params.dataAnchors;
  if (dataAnchors !== undefined && !Array.isArray(dataAnchors)) {
    throw new Error('hermes_profile_data_anchors_must_be_array');
  }
  if (dataAnchors && dataAnchors.length > 16) {
    throw new Error('hermes_profile_data_anchors_too_many');
  }
  const currentDeck = await readDeck(authority.projectId, authority.deckId);
  if (!currentDeck.deck) throw new Error('hermes_profile_deck_not_found');
  if (!authority.deckRevision || currentDeck.meta.deckRevision !== authority.deckRevision) {
    throw new Error('hermes_profile_deck_revision_stale');
  }
  const deck = currentDeck.deck;
  const source = deck.nodes.find((card) => card.id === authority.sourceCardId);
  const currentTarget = deck.nodes.find((card) => card.id === target.cardId);
  const sourceRecord = source as unknown as Record<string, unknown> | undefined;
  const targetRecord = currentTarget as unknown as Record<string, unknown> | undefined;
  const sourceOptions = source?.runtimeOptions as Record<string, unknown> | null | undefined;
  const targetOptions = currentTarget?.runtimeOptions as Record<string, unknown> | null | undefined;
  const targetRuntime = currentTarget?.runtime;
  const targetRuntimeMatches = targetRuntime?.kind === 'hermes'
    && targetRuntime.mode === 'delegate'
    && targetRuntime.profile.toLowerCase() === targetProfile;
  const currentEdge = deck.edges.some((edge) => {
    const record = edge as unknown as Record<string, unknown>;
    return edge.source === authority.sourceCardId
      && edge.target === target.cardId
      && edge.edgeType === 'flow'
      && record.enabled !== false;
  });
  if (
    !source
    || !currentTarget
    || source.id === currentTarget.id
    || sourceRecord?.enabled === false
    || targetRecord?.enabled === false
    || sourceOptions?.enabled === false
    || sourceOptions?.profileDelegationEnabled !== true
    || source.runtime.kind !== 'hermes'
    || targetOptions?.enabled === false
    || !currentEdge
    || !targetRuntimeMatches
    || deck.nodes.filter((card) => card.runtime.kind === 'hermes'
      && card.runtime.profile.trim().toLowerCase() === targetProfile).length !== 1
  ) {
    throw new Error('hermes_profile_target_stale');
  }
  const input = context ? `${goal}\n\n## Delegated context\n${context}` : goal;
  const response = await runSystemTool({
    kind: 'system-root',
    projectId: authority.projectId,
    deckId: authority.deckId,
    conversationId: authority.conversationId,
    parentRunId: authority.parentRunId,
    callerCardId: authority.sourceCardId,
    callerRuntimeKind: 'hermes',
    callerRuntimeMode: authority.sourceRuntimeMode,
    grantedTools: ['card.run_assistant_agent'],
    presentedTools: [],
  }, 'card.run_assistant_agent', {
    cardId: target.cardId,
    cardRevisionId: target.cardRevisionId,
    input,
    ...(dataAnchors !== undefined ? { dataAnchors } : {}),
  });
  if (response.ok !== true) {
    throw new Error(String(response.error || 'hermes_profile_card_run_failed'));
  }
  const result = response.result;
  if (!result || typeof result !== 'object') {
    throw new Error('hermes_profile_card_run_result_invalid');
  }
  const record = result as Record<string, unknown>;
  const runId = bounded(record.runId, 'child_run_id', 128, true);
  const output = bounded(record.output, 'result', 2_000_000);
  const nativeEvents = Array.isArray(record.nativeEvents) ? record.nativeEvents : [];
  return { nativeChildId, targetProfile, runId, result: output, nativeEvents };
}
