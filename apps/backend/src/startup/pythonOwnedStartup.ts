import {
  recoverActiveKanbanRunMonitors,
  type AppendRecoveredHermesTeamResult,
} from '../hermes/kanbanRunRecovery';
import {
  agentTerminalManager,
  agentTerminalPresentationOptions,
  type AgentTerminalState,
  type DesiredAgentTerminal,
} from '../hermes/agentTerminal';
import { getV3ProjectBlob } from '../decks/store';
import { BUILDER_CARD_ID } from '../decks/store';
import { listOwnedAgentProjects } from '../services/agentBuilderStore';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import { logModelConfiguration } from './modelConfig';
import type { AgentCardInstance, DeckDocument } from '../types';

type PythonOwnedStartupDependencies = {
  request?: (endpointPath: string, init: RequestInit) => Promise<unknown>;
  delay?: (milliseconds: number) => Promise<void>;
  logModels?: () => Promise<unknown>;
  startCardRuntimes?: () => Promise<unknown>;
  recoverKanban?: typeof recoverActiveKanbanRunMonitors;
  appendRecoveredTeamResult?: AppendRecoveredHermesTeamResult;
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
  return card?.runtime.kind === 'autogen' && card.runtime.mode === 'magentic_one';
}

function isFlowController(card: AgentCardInstance | undefined): boolean {
  return Boolean(
    card
    && card.runtime.kind === 'hermes'
    && isEnabledCard(card)
    && (card.runtimeOptions as Record<string, unknown> | null | undefined)?.delegationRole === 'profile',
  );
}

/**
 * Resolve automatic Hermes runtime demand from the same persisted invocation
 * contracts used by the Card domain. FLOW is directed controller -> target.
 * The two Magentic-One edge types identify the bus structurally and remain
 * endpoint-order independent; handles are preserved presentation metadata once
 * the saved edgeType has been established.
 */
export function deriveAutomaticHermesCardIds(deck: DeckDocument): Set<string> {
  const cards = new Map(deck.nodes.map((card) => [card.id, card] as const));
  const required = new Set<string>();

  for (const card of deck.nodes) {
    if (card.runtime.kind === 'hermes' && card.runtime.mode === 'main') required.add(card.id);
  }

  for (const edge of deck.edges) {
    if (edge.enabled === false) continue;
    const source = cards.get(String(edge.source || '').trim());
    const target = cards.get(String(edge.target || '').trim());
    if (!source || !target || source.id === target.id) continue;

    if (edge.edgeType === 'flow') {
      if (
        isFlowController(source)
        && target.runtime.kind === 'hermes'
        && target.runtime.mode === 'delegate'
        && isEnabledCard(target)
      ) required.add(target.id);
      continue;
    }

    if (edge.edgeType !== 'magentic_option' && edge.edgeType !== 'magentic_control') continue;
    const sourceIsBus = isMagenticOne(source);
    const targetIsBus = isMagenticOne(target);
    if (sourceIsBus === targetIsBus) continue;
    const attachedCard = sourceIsBus ? target : source;

    if (edge.edgeType === 'magentic_option') {
      if (attachedCard.runtime.kind === 'hermes' && isEnabledCard(attachedCard)) {
        required.add(attachedCard.id);
      }
    } else if (attachedCard.runtime.kind === 'hermes' && attachedCard.runtime.mode === 'main') {
      required.add(attachedCard.id);
    }
  }

  return required;
}

export async function reconcileConnectedAgentTerminals(dependencies: {
  listProjects?: typeof listOwnedAgentProjects;
  loadProject?: typeof getV3ProjectBlob;
  reconcile?: typeof agentTerminalManager.reconcile;
  mainWorkingDirectory?: () => string;
  builderWorkingDirectory?: () => string;
} = {}): Promise<AgentTerminalState[]> {
  const projects = await (dependencies.listProjects ?? listOwnedAgentProjects)();
  const loadProject = dependencies.loadProject ?? getV3ProjectBlob;
  const projectDecks = await Promise.all(projects.map(async (project) => ({
    project,
    blob: await loadProject(project.id),
  })));
  const desired: DesiredAgentTerminal[] = [];
  for (const { project, blob } of projectDecks) {
    if (!project.ownerUserId.trim()) throw new Error('agent_terminal_project_owner_missing');
    for (const [deckId, deck] of Object.entries(blob.decks)) {
      const requiredCardIds = deriveAutomaticHermesCardIds(deck);
      for (const card of deck.nodes) {
        if (card.runtime.kind !== 'hermes') continue;
        const isMainPresentation = card.runtime.mode === 'main';
        if (!requiredCardIds.has(card.id)) continue;
        const isBuilderPresentation = card.id === BUILDER_CARD_ID;
        desired.push({
          owner: {
            userId: project.ownerUserId,
            projectId: project.id,
            deckId,
            cardId: card.id,
          },
          card,
          deck,
          ...(dependencies.mainWorkingDirectory && isMainPresentation
            ? { workingDirectory: dependencies.mainWorkingDirectory(), attachTui: false }
            : dependencies.builderWorkingDirectory && isBuilderPresentation
              ? { workingDirectory: dependencies.builderWorkingDirectory(), attachTui: true }
              : agentTerminalPresentationOptions(card, true)),
        });
      }
    }
  }
  return (dependencies.reconcile ?? agentTerminalManager.reconcile.bind(agentTerminalManager))(desired);
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
): Promise<{ discovered: number; started: number }> {
  const request = dependencies.request ?? ((endpointPath, init) => (
    requestPythonRailsJson(endpointPath, init, { timeoutMs: STARTUP_PROBE_TIMEOUT_MS })
  ));
  const wait = dependencies.delay ?? delay;
  const logModels = dependencies.logModels ?? logModelConfiguration;
  const recoverKanban = dependencies.recoverKanban ?? recoverActiveKanbanRunMonitors;
  const appendRecoveredTeamResult = dependencies.appendRecoveredTeamResult
    ?? ((delivery) => agentTerminalManager.appendRecoveredNativeTeamResult(delivery));
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
  // or native Team recovery inside the readiness loop.
  if (!isActive()) throw new Error('python_owned_startup_cancelled');
  await (dependencies.startCardRuntimes ?? requestConnectedAgentTerminalReconcile)();
  await logModels();
  if (!isActive()) throw new Error('python_owned_startup_cancelled');
  return recoverKanban({ appendTeamResult: appendRecoveredTeamResult });
}
