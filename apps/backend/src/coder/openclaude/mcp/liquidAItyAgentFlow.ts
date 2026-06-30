// @graph entity: LiquidAItyAgentFlow
// @graph role: mcp-downstream-handlers
// @graph relates_to: DeckStore, MagOneRouting, CardRuntime(AutoGen transport)
//
// Handlers behind the LiquidAIty-owned MCP boundary that sits BELOW the OpenClaude
// QueryEngine session:
//   - project_context        : bounded authoritative deck/plan summary
//   - describe_agent_fabric   : capability profile of the real visible flow so the
//                               session can write an EXECUTABLE step (not invent one)
//   - execute_visible_flow    : run the selected visible Agent Builder flow as a
//                               mission, returning task updates keyed to the
//                               existing plan task IDs
//
// There is NO runApproved / approval boolean in this path. The user action is
// "edit plan / select task / run selected task or flow" — an execution command,
// not an approval gate. Mag One receives the mission and works; when it lacks
// required context it returns needs_input with a structured explanation. (Python
// `runApproved` is bookkeeping-only — magentic_agentchat.py:442 — never a gate, so
// the new path simply omits it.)
//
// All handlers read authoritative current state, never mutate the deck, never
// write graph memory, and never fabricate agents/tools/outputs.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDeckDocument } from '../../../decks/store';
import { buildMagOneRoutingDiagnostics, runCardWithContract } from '../../../cards/runtime';
import { resolveRuntimeBinding } from '../../../contracts/runtimeBinding';
import { HARNESS_GRAPH_TOOLS } from './harnessGraphTools';

const PROMPT_SUMMARY_CHARS = 200;
const THINKGRAPH_SKILL_PATH = 'skills/thinkgraph.md';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function summarize(value: unknown, max = PROMPT_SUMMARY_CHARS): string {
  const text = asString(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function isMagenticCard(node: any): boolean {
  return asString(node?.runtimeType).trim().toLowerCase() === 'magentic_one';
}

function resolveCardTools(card: any): string[] {
  const fromOptions = card?.runtimeOptions?.tools;
  const raw = Array.isArray(fromOptions) ? fromOptions : Array.isArray(card?.tools) ? card.tools : [];
  return raw.map((tool: unknown) => asString(tool).trim()).filter(Boolean);
}

/** Thin bounded read of a repo skill file (the source of truth for capability instructions). */
function loadSkillFile(rel: string): string | null {
  try {
    const file = [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel), resolve(process.cwd(), '..', '..', rel)]
      .find((p) => existsSync(p));
    return file ? readFileSync(file, 'utf8').slice(0, 6000) : null;
  } catch {
    return null;
  }
}

export type ThinkGraphCapability = {
  cardId: string | null;
  cardTitle: string;
  available: boolean;
  skill: string;
  skillInstructions: string | null;
  permittedTools: typeof HARNESS_GRAPH_TOOLS;
};

/**
 * The single ThinkGraph capability contribution surfaced to the normal Harness through the
 * project_context resource: reuses the existing ThinkGraph card for identity, links the skill
 * file (its instructions are the source of truth), and declares the permitted MCP graph tools.
 * Thin carrier only — no logic, no prompt baked into route code.
 */
function buildThinkGraphCapability(nodes: any[]): ThinkGraphCapability {
  const card = nodes.find(
    (n) => resolveRuntimeBinding(n?.runtimeOptions?.binding ?? n?.binding, n?.id) === 'thinkgraph_agent',
  );
  return {
    cardId: card ? asString(card.id) : null,
    cardTitle: card ? asString(card.title) || 'ThinkGraph' : 'ThinkGraph',
    available: Boolean(card),
    skill: THINKGRAPH_SKILL_PATH,
    skillInstructions: loadSkillFile(THINKGRAPH_SKILL_PATH),
    permittedTools: HARNESS_GRAPH_TOOLS,
  };
}

function extractLatestArtifact(latestRun: any): any | null {
  const steps: any[] = Array.isArray(latestRun?.steps) ? latestRun.steps : [];
  let artifact: any = null;
  for (const step of steps) {
    const candidate = step?.magenticTrace?.plan?.taskLedgerArtifact;
    if (candidate && typeof candidate === 'object') artifact = candidate;
  }
  return artifact;
}

export type AgentFlowDeps = {
  loadDeck?: typeof getDeckDocument;
  runCard?: typeof runCardWithContract;
  buildRouting?: typeof buildMagOneRoutingDiagnostics;
};

// ── project_context resource ────────────────────────────────────────────────
export type ProjectContext = {
  projectId: string;
  deckId: string;
  deckName: string;
  selectedCard: { id: string; title: string; runtimeType: string; busConnected: boolean } | null;
  flowSummary: {
    orchestratorCardId: string | null;
    connectedFlowCardIds: string[];
    cardCount: number;
    edgeCount: number;
  };
  activePlanSummary: { hasArtifact: boolean; source: string | null } | null;
  thinkGraphCapability: ThinkGraphCapability;
  contextReferences: string[];
  warnings: string[];
};

export async function buildProjectContext(
  args: { projectId: string; deckId: string; selectedCardId?: string },
  deps: AgentFlowDeps = {},
): Promise<ProjectContext> {
  const loadDeck = deps.loadDeck ?? getDeckDocument;
  const buildRouting = deps.buildRouting ?? buildMagOneRoutingDiagnostics;
  const projectId = asString(args.projectId).trim();
  const deckId = asString(args.deckId).trim();
  const selectedCardId = asString(args.selectedCardId).trim() || null;
  const warnings: string[] = [];

  const { deck, latestRun } = await loadDeck(projectId, deckId);
  if (!deck) {
    throw new Error(`project_context_deck_not_found: projectId=${projectId} deckId=${deckId}`);
  }
  const nodes: any[] = Array.isArray(deck.nodes) ? deck.nodes : [];
  const edges: any[] = Array.isArray(deck.edges) ? deck.edges : [];
  const orchestrator = nodes.find(isMagenticCard);
  if (!orchestrator) warnings.push('no_orchestrator_card_in_deck');

  let connectedFlowCardIds: string[] = [];
  const roleById = new Map<string, string>();
  if (orchestrator) {
    const routing = buildRouting(orchestrator, nodes, edges, '', { projectId, deckId });
    connectedFlowCardIds = routing.eligibleBusConnectedAgents.map((a) => a.id);
    for (const a of routing.eligibleBusConnectedAgents) roleById.set(a.id, a.role);
  }
  const connectedSet = new Set(connectedFlowCardIds);

  let selectedCard: ProjectContext['selectedCard'] = null;
  if (selectedCardId) {
    const card = nodes.find((n) => asString(n?.id) === selectedCardId);
    if (card) {
      const id = asString(card.id);
      selectedCard = {
        id,
        title: asString(card.title) || id,
        runtimeType: asString(card.runtimeType) || 'assistant_agent',
        busConnected: connectedSet.has(id) || (orchestrator && id === asString(orchestrator.id)),
      };
    } else {
      warnings.push(`selected_card_not_in_deck: ${selectedCardId}`);
    }
  }

  const artifact = extractLatestArtifact(latestRun);
  const activePlanSummary = artifact
    ? {
        hasArtifact: true,
        source: asString(artifact.source) || null,
      }
    : null;
  if (!activePlanSummary) warnings.push('no_task_ledger_artifact_on_latest_run');

  return {
    projectId,
    deckId,
    deckName: asString(deck.name) || deckId,
    selectedCard,
    flowSummary: {
      orchestratorCardId: orchestrator ? asString(orchestrator.id) : null,
      connectedFlowCardIds,
      cardCount: nodes.length,
      edgeCount: edges.length,
    },
    activePlanSummary,
    thinkGraphCapability: buildThinkGraphCapability(nodes),
    contextReferences: [],
    warnings,
  };
}

// ── describe_agent_fabric ─────────────────────────────────────────────────────
// Real capability profile so the session writes executable steps. Reports ONLY
// what is authentic in the deck (connected agents/roles/tools/models). Fields not
// represented in authoritative state are returned empty/honest — never invented.
export type AgentFabricProfile = {
  projectId: string;
  deckId: string;
  visibleFlows: Array<{ flowId: string; title: string; runnable: boolean; connectedAgentCount: number }>;
  selectedFlowProfile: {
    flowId: string;
    runnable: boolean;
    connectedAgents: Array<{ id: string; title: string; role: string }>;
    tools: string[];
    models: Array<{ cardId: string; modelKey: string | null; provider: string | null }>;
    graphReadScopes: string[];
    requiredInputs: string[];
    constraints: string[];
    expectedArtifacts: string[];
    needsInputConditions: string[];
    graphWritePolicy: 'no_direct_graph_write';
  } | null;
  warnings: string[];
};

export async function buildAgentFabricProfile(
  args: { projectId: string; deckId: string; selectedCardId?: string },
  deps: AgentFlowDeps = {},
): Promise<AgentFabricProfile> {
  const loadDeck = deps.loadDeck ?? getDeckDocument;
  const buildRouting = deps.buildRouting ?? buildMagOneRoutingDiagnostics;
  const projectId = asString(args.projectId).trim();
  const deckId = asString(args.deckId).trim();
  const warnings: string[] = [];

  const { deck } = await loadDeck(projectId, deckId);
  if (!deck) {
    throw new Error(`describe_agent_fabric_deck_not_found: projectId=${projectId} deckId=${deckId}`);
  }
  const nodes: any[] = Array.isArray(deck.nodes) ? deck.nodes : [];
  const edges: any[] = Array.isArray(deck.edges) ? deck.edges : [];
  const orchestrators = nodes.filter(isMagenticCard);
  if (orchestrators.length === 0) warnings.push('no_visible_flow_in_deck');

  const visibleFlows = orchestrators.map((orchestrator) => {
    const routing = buildRouting(orchestrator, nodes, edges, '', { projectId, deckId });
    return {
      flowId: asString(orchestrator.id),
      title: asString(orchestrator.title) || asString(orchestrator.id),
      runnable: routing.eligibleBusConnectedAgents.length > 0,
      connectedAgentCount: routing.eligibleBusConnectedAgents.length,
    };
  });

  // The selected flow is the orchestrator (the visible flow). selectedCardId may
  // point at a participant; we profile the flow that owns it (or the only flow).
  const orchestrator = orchestrators[0] ?? null;
  let selectedFlowProfile: AgentFabricProfile['selectedFlowProfile'] = null;
  if (orchestrator) {
    const routing = buildRouting(orchestrator, nodes, edges, '', { projectId, deckId });
    const connectedAgents = routing.eligibleBusConnectedAgents.map((a) => ({
      id: a.id,
      title: a.title,
      role: a.role,
    }));
    const connectedCards = connectedAgents
      .map((a) => nodes.find((n) => asString(n?.id) === a.id))
      .filter(Boolean);
    const tools = Array.from(new Set(connectedCards.flatMap((c) => resolveCardTools(c))));
    const models = connectedCards.map((c) => ({
      cardId: asString(c.id),
      modelKey: asString(c?.runtimeOptions?.modelKey).trim() || null,
      provider: asString(c?.runtimeOptions?.provider).trim() || null,
    }));
    const needsInputConditions = connectedAgents.length === 0
      ? ['flow_not_runnable_no_connected_agents']
      : [];
    selectedFlowProfile = {
      flowId: asString(orchestrator.id),
      runnable: connectedAgents.length > 0,
      connectedAgents,
      tools,
      models,
      // The following are not represented in authoritative deck state today; they
      // are returned honestly empty rather than invented.
      graphReadScopes: [],
      requiredInputs: [],
      constraints: [],
      expectedArtifacts: [],
      needsInputConditions,
      graphWritePolicy: 'no_direct_graph_write',
    };
  }

  return { projectId, deckId, visibleFlows, selectedFlowProfile, warnings };
}

// ── execute_visible_flow ──────────────────────────────────────────────────────
// A Plan is a prompt + pointers — nothing more. Made by the Harness, passed to Mag One.
// `objective` is the Harness's prompt; `graphReadScope` is the set of stable graph refs
// (think:/know:/code:) it selected. The graph stays the single source of truth: Mag One reads the
// pointed-at context through its OWN tools, and its native MagenticOne Task Ledger does the
// planning. We do NOT pre-build task steps/artifacts/criteria here.
export type Plan = {
  objective: string;
  graphReadScope?: string[];
};

export type ExecuteVisibleFlowInput = {
  projectId: string;
  deckId: string;
  taskIds: string[];
  selectedCardId?: string;
  plan: Plan;
};

export type ExecuteVisibleFlowResult = {
  status: 'completed' | 'failed' | 'needs_input';
  runId: string;
  taskUpdates: Array<{ taskId: string; status: string; resultSummary: string }>;
  artifacts: unknown[];
  evidence: unknown[];
  progress: string;
  needsInput: Array<{ reason: string; field?: string }>;
  failure: string | null;
  provenance: { source: string | null; route: string; ledgerTrace: unknown | null };
};

// The whole handoff: the Harness's objective + the graph pointers to read. Mag One plans natively
// from this; we add no task structure of our own.
function renderPlan(plan: Plan): string {
  const lines: string[] = [`Objective: ${asString(plan.objective)}`];
  if (plan.graphReadScope?.length) {
    lines.push('', 'Graph pointers to read for context (the graph is the source of truth):', ...plan.graphReadScope.map((r) => `- ${asString(r)}`));
  }
  lines.push('', 'Graph-write policy: no direct graph write — return evidence/artifacts only.');
  return lines.join('\n').trim();
}

/**
 * Run the selected visible Agent Builder flow as a mission. NO runApproved.
 * Returns task updates keyed to the INCOMING plan task IDs so returned evidence
 * updates the same visible current tasks (one task universe). When the flow is
 * not runnable it returns needs_input with a structured reason rather than a gate.
 */
export async function executeVisibleFlow(
  input: ExecuteVisibleFlowInput,
  deps: AgentFlowDeps = {},
): Promise<ExecuteVisibleFlowResult> {
  const loadDeck = deps.loadDeck ?? getDeckDocument;
  const runCard = deps.runCard ?? runCardWithContract;
  const buildRouting = deps.buildRouting ?? buildMagOneRoutingDiagnostics;

  const projectId = asString(input?.projectId).trim();
  const deckId = asString(input?.deckId).trim();
  const taskIds = Array.isArray(input?.taskIds) ? input.taskIds.map(asString).filter(Boolean) : [];
  const route = 'liquidaity_mcp(execute_visible_flow) -> cards/runtime -> autogen rails -> magentic-one';
  const runId = `mcp_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!projectId || !deckId) {
    throw new Error('execute_visible_flow_missing_selected_flow: projectId and deckId are required');
  }
  if (!asString(input?.plan?.objective).trim()) {
    throw new Error('execute_visible_flow_missing_objective');
  }

  const { deck } = await loadDeck(projectId, deckId);
  if (!deck) {
    throw new Error(`execute_visible_flow_deck_not_found: projectId=${projectId} deckId=${deckId}`);
  }
  const nodes: any[] = Array.isArray(deck.nodes) ? deck.nodes : [];
  const edges: any[] = Array.isArray(deck.edges) ? deck.edges : [];
  const orchestrator = nodes.find(isMagenticCard);
  if (!orchestrator) {
    throw new Error('execute_visible_flow_no_orchestrator_card');
  }

  // Structural needs_input: the flow has no connected agents -> not runnable.
  const routing = buildRouting(orchestrator, nodes, edges, '', { projectId, deckId });
  if (routing.eligibleBusConnectedAgents.length === 0) {
    return {
      status: 'needs_input',
      runId,
      taskUpdates: taskIds.map((taskId) => ({ taskId, status: 'needs_input', resultSummary: '' })),
      artifacts: [],
      evidence: [],
      progress: 'flow not runnable',
      needsInput: [
        { reason: 'selected flow has no connected agents on the Mag One bus', field: 'connectedAgents' },
      ],
      failure: null,
      provenance: { source: null, route, ledgerTrace: null },
    };
  }

  const task = renderPlan(input.plan);
  // NO runApproved: the mission runs directly (Python runApproved is bookkeeping
  // only — magentic_agentchat.py:442 — never a gate).
  const result = await runCard(orchestrator, {}, task, {
    deckId,
    projectId,
    allCards: nodes,
    allEdges: edges,
    allTemplates: [],
    previousOutput: '',
  });

  const plan = (result as any)?.magenticTrace?.plan ?? null;
  const ledgerTrace = (result as any)?.magenticTrace?.ledgerTrace ?? null;
  const taskLedger = plan?.taskLedgerArtifact ?? null;
  const evidence = Array.isArray(taskLedger?.modelCallProof) ? taskLedger.modelCallProof : [];
  const finalText = asString(result?.output);
  const failed = result?.status === 'error';
  const status: ExecuteVisibleFlowResult['status'] = failed ? 'failed' : 'completed';
  const resultSummary = summarize(failed ? asString(result?.error) : finalText);

  return {
    status,
    runId,
    // Task-ID preservation: updates are keyed to the INCOMING plan task IDs.
    taskUpdates: taskIds.map((taskId) => ({ taskId, status, resultSummary })),
    artifacts: taskLedger ? [taskLedger] : [],
    evidence,
    progress: failed ? 'failed' : 'completed',
    needsInput: [],
    failure: failed ? asString(result?.error) || 'execute_visible_flow_failed' : null,
    provenance: { source: taskLedger?.source ?? null, route, ledgerTrace },
  };
}
