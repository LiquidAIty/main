// @graph entity: MainAgentFlow
// @graph role: mcp-downstream-handlers
// @graph relates_to: DeckStore, MagOneRouting, CardRuntime(AutoGen transport)
//
// Handlers behind the Main MCP boundary that sits BELOW the OpenClaude
// configured-card session:
//   - describe_connected_agents : read the connected, bus-eligible (magentic_option)
//                                 Mag One Agent Cards + their capabilities for Run Plan review
//   - run_mag_one               : transport a Hermes-prepared, Main-presented,
//                                 user-accepted canonical IDF identity to
//                                 regular native Mag One
//
// These handlers read authoritative saved topology and never mutate the deck or
// fabricate agents/tools/outputs. The IDF is the actual model input; native
// Magentic-One owns its own lifecycle and result.

import { getDeckDocument } from '../../../decks/store';
import {
  resolvedMagenticControllers,
  resolvedMagenticOptions,
  resolveCardTools,
  resolveMagenticWorkerReadiness,
  runCardWithContract,
} from '../../../cards/runtime';
import { resolveRuntimeBinding } from '../../../contracts/runtimeBinding';
import { fetchInputDataFile } from '../../../services/autogen/autogenOrchestratorClient';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function isMagenticCard(node: any): boolean {
  return asString(node?.runtimeType).trim().toLowerCase() === 'magentic_one';
}

export type AgentFlowDeps = {
  loadDeck?: typeof getDeckDocument;
  runCard?: typeof runCardWithContract;
  resolveWorkerReadiness?: typeof resolveMagenticWorkerReadiness;
  fetchIdf?: typeof fetchInputDataFile;
};

// ── mag_one.describe_connected_agents ─────────────────────────────────────────
// The ONE read tool used to see the Mag One team while preparing/reviewing the
// Run Plan: the currently connected, bus-eligible (magentic_option)
// Agent Cards and their actual capabilities. Read-only, deck-authentic — no
// visible-flow fields, no plan/task/approval/mission wording, nothing invented.
export type ConnectedAgent = {
  cardId: string;
  title: string;
  model: { modelKey: string | null; provider: string | null };
  tools: string[];
  connected: boolean;
  executionReady: boolean;
  readinessState: string;
  readinessReason: string | null;
};

export type DescribeConnectedAgentsResult = {
  projectId: string;
  deckId: string;
  orchestratorCardId: string | null;
  connectedAgents: ConnectedAgent[];
};

export async function describeConnectedAgents(
  args: { projectId: string; deckId: string },
  deps: AgentFlowDeps = {},
): Promise<DescribeConnectedAgentsResult> {
  const loadDeck = deps.loadDeck ?? getDeckDocument;
  const projectId = asString(args.projectId).trim();
  const deckId = asString(args.deckId).trim();

  const { deck } = await loadDeck(projectId, deckId);
  if (!deck) {
    throw new Error(`describe_connected_agents_deck_not_found: projectId=${projectId} deckId=${deckId}`);
  }
  const nodes: any[] = Array.isArray(deck.nodes) ? deck.nodes : [];
  const edges: any[] = Array.isArray(deck.edges) ? deck.edges : [];
  const orchestrator = nodes.find(isMagenticCard) ?? null;

  const connectedAgents: ConnectedAgent[] = [];
  if (orchestrator) {
    const connectedCards = resolvedMagenticOptions(asString(orchestrator.id), nodes, edges);
    const resolveReadiness = deps.resolveWorkerReadiness ?? resolveMagenticWorkerReadiness;
    for (const readiness of await resolveReadiness(connectedCards)) {
      const card = readiness.card;
      connectedAgents.push({
        cardId: asString(card?.id),
        title: asString(card?.title) || asString(card?.id),
        model: {
          modelKey: asString(card?.runtimeOptions?.modelKey).trim() || null,
          provider: asString(card?.runtimeOptions?.provider).trim() || null,
        },
        tools: resolveCardTools(card),
        connected: readiness.connected,
        executionReady: readiness.executionReady,
        readinessState: readiness.readinessState,
        readinessReason: readiness.readinessReason,
      });
    }
  }

  return {
    projectId,
    deckId,
    orchestratorCardId: orchestrator ? asString(orchestrator.id) : null,
    connectedAgents,
  };
}

// ── run_mag_one ───────────────────────────────────────────────────────────────
// The ONE Mag One entrypoint: a Hermes-prepared, Main-presented, user-accepted
// canonical IDF identity runs regular native Mag One. There is no TS prompt-to-plan
// adapter, lifecycle adapter, task-ledger gate, approval gate, or visible-flow wrapper.
// Mag One reasons over the exact IDF input, selects among
// the connected bus-eligible workers itself, and returns its native result.
export type RunMagOneInput = {
  idfId: string;
  projectId: string;
  deckId: string;
  conversationId?: string;
};

export type RunMagOneResult = {
  status: 'completed' | 'partial' | 'failed';
  runId: string;
  finalText: string;
  failure: string | null;
  provenance: { route: string };
  // The bus-connected worker card ids this run was eligible to use (from the
  // live deck's magentic_option edges at run time) — the same set Mag One saw.
  // Disconnected cards are structurally absent, never filtered downstream.
  connectedParticipants: string[];
  conversationId: string | null;
  idfId: string;
};

export async function runMagOne(
  input: RunMagOneInput,
  deps: AgentFlowDeps = {},
): Promise<RunMagOneResult> {
  const loadDeck = deps.loadDeck ?? getDeckDocument;
  const runCard = deps.runCard ?? runCardWithContract;
  const fetchIdf = deps.fetchIdf ?? fetchInputDataFile;

  const idfId = asString(input?.idfId).trim();
  const projectId = asString(input?.projectId).trim();
  const deckId = asString(input?.deckId).trim();
  const conversationId = asString(input?.conversationId).trim();
  const route = 'main_mcp(run_mag_one) -> cards/runtime -> autogen rails -> magentic-one';
  const runId = `mag_one_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!idfId || !projectId || !deckId) {
    throw new Error('run_mag_one_missing_identity: idfId, projectId, and deckId are required');
  }

  const { deck } = await loadDeck(projectId, deckId);
  if (!deck) {
    throw new Error(`run_mag_one_deck_not_found: projectId=${projectId} deckId=${deckId}`);
  }
  const nodes: any[] = Array.isArray(deck.nodes) ? deck.nodes : [];
  const edges: any[] = Array.isArray(deck.edges) ? deck.edges : [];
  const orchestrator = nodes.find(isMagenticCard);
  if (!orchestrator) {
    throw new Error('run_mag_one_no_orchestrator_card');
  }
  const mainControllers = resolvedMagenticControllers(asString(orchestrator.id), nodes, edges).filter(
    (card) =>
      resolveRuntimeBinding(card?.runtimeBinding) === 'main_chat',
  );
  if (mainControllers.length !== 1) {
    throw new Error('run_mag_one_main_control_not_authorized: exactly one live main_chat magentic_control edge is required');
  }
  // The eligible worker roster resolves ONLY from the live blue side
  // connections — the same resolution the runtime uses. Main Chat is not a worker.
  const connectedCards = resolvedMagenticOptions(asString(orchestrator.id), nodes, edges);
  const connectedParticipants = connectedCards.map((card: any) => asString(card?.id));
  const { idf } = await fetchIdf({ projectId, idfId });
  if (idf.projectId !== projectId || idf.deckId !== deckId) {
    throw new Error('run_mag_one_idf_scope_mismatch');
  }
  const result: any = await runCard(orchestrator, idf.modelInputMarkdown, {
    deckId,
    projectId,
    allCards: nodes,
    allEdges: edges,
    allTemplates: [],
    previousOutput: '',
    runId,
    conversationId,
    idf,
  });

  const failed = result?.status === 'error';
  return {
    status: failed ? 'failed' : 'completed',
    runId,
    finalText: asString(result?.output),
    failure: failed ? asString(result?.error) || 'run_mag_one_failed' : null,
    provenance: { route },
    connectedParticipants,
    conversationId: conversationId || null,
    idfId,
  };
}
