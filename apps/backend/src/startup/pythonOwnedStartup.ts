import {
  agentTerminalManager,
  agentTerminalPresentationOptions,
  resolveHermesBotRosterProjections,
  type AgentTerminalState,
  type DesiredAgentTerminal,
  type DesiredHermesBotProfile,
  type HermesBotRosterProjection,
} from '../hermes/agentTerminal';
import { getV3ProjectBlob } from '../decks/store';
import { BUILDER_CARD_ID } from '../decks/store';
import {
  listCanonicalSavedCardBindings,
  listOwnedAgentProjects,
} from '../services/agentBuilderStore';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { logModelConfiguration } from './modelConfig';
import type { AgentCardInstance, DeckDocument } from '../types';

type PythonOwnedStartupDependencies = {
  request?: (endpointPath: string, init: RequestInit) => Promise<unknown>;
  delay?: (milliseconds: number) => Promise<void>;
  logModels?: () => Promise<unknown>;
  startCardRuntimes?: () => Promise<unknown>;
  isActive?: () => boolean;
  maxAttempts?: number;
  pollIntervalMs?: number;
};

const DEFAULT_MAX_ATTEMPTS = 120;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const STARTUP_PROBE_TIMEOUT_MS = 2_000;
let topologyReconcileTail: Promise<void> = Promise.resolve();

function isEnabledCard(card: AgentCardInstance): boolean {
  const options = card.runtimeOptions as (Record<string, unknown> & { enabled?: boolean }) | null | undefined;
  return (card as AgentCardInstance & { enabled?: boolean }).enabled !== false
    && options?.enabled !== false;
}

function isMagenticOne(card: AgentCardInstance | undefined): boolean {
  return card?.runtime.kind === 'hermes' && card.runtime.mode === 'magentic_one';
}

/**
 * Resolve automatic Hermes runtime demand from Python-owned, saved-orchestrator
 * Bot roster projections and the existing Magnetic worker-membership contract.
 * FLOW authority is not reimplemented here. Blue membership is endpoint-order
 * independent; handles remain presentation metadata once edgeType is saved.
 */
export function deriveAutomaticHermesCardIds(
  deck: DeckDocument,
  botProfiles: HermesBotRosterProjection[],
): Set<string> {
  const cards = new Map(deck.nodes.map((card) => [card.id, card] as const));
  const profiles = new Map(botProfiles.map((projection) => [projection.profile, projection] as const));
  const required = new Set<string>();

  for (const projection of botProfiles) {
    if (!projection.botEnabled || !projection.roster.length) continue;
    const source = cards.get(projection.cardId);
    if (source?.runtime.kind === 'hermes' && source.runtime.mode !== 'main') {
      required.add(projection.cardId);
    }
    for (const profile of projection.roster) {
      const target = profiles.get(profile);
      if (target?.botEnabled) required.add(target.cardId);
    }
  }

  for (const edge of deck.edges) {
    if (edge.enabled === false) continue;
    const source = cards.get(String(edge.source || '').trim());
    const target = cards.get(String(edge.target || '').trim());
    if (!source || !target || source.id === target.id) continue;

    if (edge.edgeType === 'flow') continue;

    if (edge.edgeType !== 'magentic_option') continue;
    const sourceIsBus = isMagenticOne(source);
    const targetIsBus = isMagenticOne(target);
    if (sourceIsBus === targetIsBus) continue;
    const attachedCard = sourceIsBus ? target : source;
    const busCard = sourceIsBus ? source : target;

    if (isEnabledCard(busCard)
      && attachedCard.runtime.kind === 'hermes'
      && isEnabledCard(attachedCard)) {
      required.add(busCard.id);
      required.add(attachedCard.id);
    }
  }

  return required;
}

export async function reconcileConnectedAgentTerminals(dependencies: {
  listProjects?: typeof listOwnedAgentProjects;
  loadProject?: typeof getV3ProjectBlob;
  reconcile?: typeof agentTerminalManager.reconcile;
  resolveBotProfiles?: typeof resolveHermesBotRosterProjections;
  listCanonicalBindings?: typeof listCanonicalSavedCardBindings;
  builderWorkingDirectory?: () => string;
} = {}): Promise<AgentTerminalState[]> {
  const projects = await (dependencies.listProjects ?? listOwnedAgentProjects)();
  const canonicalBindings = await (
    dependencies.listCanonicalBindings ?? listCanonicalSavedCardBindings
  )();
  const canonicalByProfile = new Map(canonicalBindings.map((binding) => (
    [binding.runtimeProfile.toLowerCase(), binding] as const
  )));
  if (canonicalByProfile.size !== canonicalBindings.length) {
    throw new Error('agent_terminal_canonical_profile_ambiguous');
  }
  const isCanonicalCard = (card: AgentCardInstance): boolean => {
    if (card.runtime.kind !== 'hermes') return false;
    const binding = canonicalByProfile.get(card.runtime.profile.toLowerCase());
    return Boolean(
      binding
      && binding.cardId === card.id
      && binding.cardRevisionId === String(card._cardRevisionId || '')
      && binding.revisionSha256 === String(card._cardRevisionSha256 || ''),
    );
  };
  const loadProject = dependencies.loadProject ?? getV3ProjectBlob;
  const projectDecks = await Promise.all(projects.map(async (project) => ({
    project,
    blob: await loadProject(project.id),
  })));
  projectDecks.sort((left, right) => (
    left.project.ownerUserId.localeCompare(right.project.ownerUserId)
    || left.project.id.localeCompare(right.project.id)
  ));
  const desired: DesiredAgentTerminal[] = [];
  const botProfiles: DesiredHermesBotProfile[] = [];
  const eagerProfiles = new Set<string>();
  const projectedProfiles = new Set<string>();
  const resolveBotProfiles = dependencies.resolveBotProfiles ?? resolveHermesBotRosterProjections;
  for (const { project, blob } of projectDecks) {
    if (!project.ownerUserId.trim()) throw new Error('agent_terminal_project_owner_missing');
    for (const [deckId, deck] of Object.entries(blob.decks)
      .sort(([left], [right]) => left.localeCompare(right))) {
      const projections = await resolveBotProfiles(project.id, deckId);
      const cards = new Map(deck.nodes.map((card) => [card.id, card] as const));
      for (const projection of projections) {
        const card = cards.get(projection.cardId);
        if (!card || card.runtime.kind !== 'hermes'
          || card.runtime.profile !== projection.profile
          || Boolean(card.kind === 'agent' && isEnabledCard(card)) !== projection.botEnabled
          || (card._cardRevisionId || '') !== projection.cardRevisionId) {
          throw new Error('agent_terminal_bot_roster_saved_identity_mismatch');
        }
        if (!isCanonicalCard(card)) continue;
        const profileKey = projection.profile.toLowerCase();
        if (!projectedProfiles.has(profileKey)) {
          projectedProfiles.add(profileKey);
          botProfiles.push({
            owner: {
              userId: project.ownerUserId,
              projectId: project.id,
              deckId,
              cardId: card.id,
              ...(card.runtime.mode === 'main' ? { conversationId: 'main' } : {}),
            },
            card,
            projection,
          });
        }
      }
      const requiredCardIds = deriveAutomaticHermesCardIds(deck, projections);
      for (const card of deck.nodes) {
        if (card.runtime.kind !== 'hermes') continue;
        if (!isCanonicalCard(card)) continue;
        if (card.runtime.mode === 'main') continue;
        if (!requiredCardIds.has(card.id)) continue;
        const isBuilderPresentation = card.id === BUILDER_CARD_ID;
        const profileKey = card.runtime.profile.toLowerCase();
        const openAtReconcile = !eagerProfiles.has(profileKey);
        eagerProfiles.add(profileKey);
        desired.push({
          owner: {
            userId: project.ownerUserId,
            projectId: project.id,
            deckId,
            cardId: card.id,
          },
          card,
          deck,
          openAtReconcile,
          ...(dependencies.builderWorkingDirectory && isBuilderPresentation
              ? { workingDirectory: dependencies.builderWorkingDirectory(), attachTui: true }
              : agentTerminalPresentationOptions(card, card.runtime.mode !== 'magentic_one')),
        });
      }
    }
  }
  return (dependencies.reconcile ?? agentTerminalManager.reconcile.bind(agentTerminalManager))(
    desired,
    { cols: 120, rows: 36 },
    botProfiles,
  );
}

export function requestConnectedAgentTerminalReconcile(
  dependencies: Parameters<typeof reconcileConnectedAgentTerminals>[0] = {},
): Promise<AgentTerminalState[]> {
  const result = topologyReconcileTail.then(() => reconcileConnectedAgentTerminals(dependencies));
  topologyReconcileTail = result.then(() => undefined, () => undefined);
  return result;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'python_rails_unavailable');
}

/**
 * Wait for the one supervised Python rails process, then perform each
 * Python-owned backend startup read exactly once for this backend listener.
 */
export async function runPythonOwnedStartupTasks(
  dependencies: PythonOwnedStartupDependencies = {},
): Promise<void> {
  const request = dependencies.request ?? ((endpointPath, init) => (
    requestPythonRailsJson(endpointPath, init, { timeoutMs: STARTUP_PROBE_TIMEOUT_MS })
  ));
  const wait = dependencies.delay ?? delay;
  const logModels = dependencies.logModels ?? logModelConfiguration;
  const isActive = dependencies.isActive ?? (() => true);
  const maxAttempts = Math.max(1, Math.trunc(dependencies.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const pollIntervalMs = Math.max(0, Math.trunc(
    dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  ));
  let lastFailure = 'python_rails_unavailable';
  let pythonRailsReady = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!isActive()) throw new Error('python_owned_startup_cancelled');
    try {
      const response = await request('/health', { method: 'GET' }) as { status?: unknown };
      if (String(response?.status || '').trim() === 'ok') {
        pythonRailsReady = true;
        break;
      }
      lastFailure = `python_rails_health_invalid:${String(response?.status || 'missing')}`;
    } catch (error) {
      const message = errorMessage(error);
      if (message === 'python_owned_startup_cancelled') throw error;
      lastFailure = message;
    }
    if (attempt < maxAttempts) await wait(pollIntervalMs);
  }

  if (!pythonRailsReady) {
    throw new Error(`python_owned_startup_timeout:${lastFailure}`);
  }

  // Readiness is the only retried operation. Once the supervised Python rails
  // process is ready, each stateful startup task runs at most once for this
  // backend listener; failures remain visible instead of replaying Deck reads
  // inside the readiness loop.
  if (!isActive()) throw new Error('python_owned_startup_cancelled');
  await (dependencies.startCardRuntimes ?? requestConnectedAgentTerminalReconcile)();
  await logModels();
}
