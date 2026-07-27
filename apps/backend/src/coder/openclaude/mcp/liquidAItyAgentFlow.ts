// @graph entity: LiquidAItyAgentFlow
// @graph role: mcp-downstream-handlers
// @graph relates_to: DeckStore, MagOneRouting, CardRuntime(AutoGen transport)
//
// Handlers behind the LiquidAIty-owned MCP boundary that sits BELOW the OpenClaude
// QueryEngine session:
//   - describe_connected_agents : read the connected, bus-eligible (magentic_option)
//                                 Mag One Agent Cards + their capabilities for Run Plan review
//   - run_mag_one               : run regular native Mag One from a Hermes-prepared,
//                                 Main-presented, user-accepted
//                                 Markdown orchestration prompt (used verbatim — no
//                                 plan, no task object, no approval/visible-flow gate)
//
// All handlers read authoritative current state, never mutate the deck, never
// write graph memory, and never fabricate agents/tools/outputs.

import { getDeckDocument } from '../../../decks/store';
import { resolvedMagenticControllers, resolvedMagenticOptions, runCardWithContract } from '../../../cards/runtime';
import { resolveRuntimeBinding } from '../../../contracts/runtimeBinding';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function isMagenticCard(node: any): boolean {
  return asString(node?.runtimeType).trim().toLowerCase() === 'magentic_one';
}

function resolveCardTools(card: any): string[] {
  const fromOptions = card?.runtimeOptions?.tools;
  const raw = Array.isArray(fromOptions) ? fromOptions : Array.isArray(card?.tools) ? card.tools : [];
  return raw.map((tool: unknown) => asString(tool).trim()).filter(Boolean);
}

export type AgentFlowDeps = {
  loadDeck?: typeof getDeckDocument;
  runCard?: typeof runCardWithContract;
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
    // Bus connectivity (magentic_option edges) is the only eligibility signal —
    // connected = active, disconnected = inactive. No role/priority inference.
    for (const card of resolvedMagenticOptions(asString(orchestrator.id), nodes, edges)) {
      connectedAgents.push({
        cardId: asString(card?.id),
        title: asString(card?.title) || asString(card?.id),
        model: {
          modelKey: asString(card?.runtimeOptions?.modelKey).trim() || null,
          provider: asString(card?.runtimeOptions?.provider).trim() || null,
        },
        tools: resolveCardTools(card),
        connected: true,
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
// The ONE Mag One entrypoint: a Hermes-prepared, Main-presented, user-accepted Markdown prompt
// runs regular native Mag One. No structured plan, no plan.objective, no
// prompt-to-plan adapter, no task ledger gate, no approval gate, no visible-flow
// task-by-task wrapper. The Markdown string IS Mag One's job; Mag One reasons
// over it, selects among the connected bus-eligible workers itself, runs them,
// and returns its own result (its native internal task ledger may exist, but is
// never forced/exposed/gated here).
export type RunMagOneInput = {
  // Stable identity only. Python claims the AgentGraph assignment and hydrates
  // the exact relational instruction; TypeScript never carries task text.
  instructionId: string;
  projectId: string;
  deckId: string;
  conversationId?: string;
  /** Main Chat context for Hermes post-run review only; never forwarded to Mag One. */
  parentContext?: { objective?: string; acceptanceCriteria?: string[]; reviewInstruction?: string };
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
  parentRunId: string | null;
  conversationId: string | null;
  objective: string;
  assignmentId: string | null;
  artifactLocators: string[];
};

export async function runMagOne(
  input: RunMagOneInput,
  deps: AgentFlowDeps = {},
): Promise<RunMagOneResult> {
  const loadDeck = deps.loadDeck ?? getDeckDocument;
  const runCard = deps.runCard ?? runCardWithContract;

  const instructionId = asString(input?.instructionId).trim();
  const projectId = asString(input?.projectId).trim();
  const deckId = asString(input?.deckId).trim();
  const conversationId = asString(input?.conversationId).trim();
  const parentRunId = null;
  const objective = '';
  const route = 'liquidaity_mcp(run_mag_one) -> cards/runtime -> autogen rails -> magentic-one';
  const runId = `mag_one_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!instructionId || !projectId || !deckId) {
    throw new Error('run_mag_one_missing_identity: instructionId, projectId, and deckId are required');
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
      resolveRuntimeBinding(
        card?.runtimeOptions?.binding ?? card?.runtimeBinding ?? card?.binding,
        card?.id,
      ) === 'main_chat',
  );
  if (mainControllers.length !== 1) {
    throw new Error('run_mag_one_main_control_not_authorized: exactly one live main_chat magentic_control edge is required');
  }
  // The eligible worker roster resolves ONLY from the live blue side
  // connections — the same resolution the runtime uses. The job folder never
  // carries a roster; Main Chat and Hermes are structurally excluded.
  const connectedParticipants = resolvedMagenticOptions(asString(orchestrator.id), nodes, edges).map(
    (card: any) => asString(card?.id),
  );
  const senderCardId = asString(mainControllers[0]?.id);
  const receiverCardId = asString(orchestrator.id);
  const result: any = await runCard(orchestrator, {}, '', {
    deckId,
    projectId,
    allCards: nodes,
    allEdges: edges,
    allTemplates: [],
    previousOutput: '',
    runId,
    agentAssignment: { instructionId, senderCardId, receiverCardId },
  });

  const failed = result?.status === 'error';
  const assignment = (result as any)?.agentAssignmentResult ?? null;
  return {
    status: failed ? 'failed' : 'completed',
    runId,
    finalText: asString(result?.output),
    failure: failed ? asString(result?.error) || 'run_mag_one_failed' : null,
    provenance: { route },
    connectedParticipants,
    parentRunId,
    conversationId: conversationId || null,
    objective,
    assignmentId: assignment?.assignmentId ?? null,
    artifactLocators: Array.isArray(assignment?.artifactLocators)
      ? assignment.artifactLocators
      : [],
  };
}
