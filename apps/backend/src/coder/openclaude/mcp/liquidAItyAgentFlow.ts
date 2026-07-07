// @graph entity: LiquidAItyAgentFlow
// @graph role: mcp-downstream-handlers
// @graph relates_to: DeckStore, MagOneRouting, CardRuntime(AutoGen transport)
//
// Handlers behind the LiquidAIty-owned MCP boundary that sits BELOW the OpenClaude
// QueryEngine session:
//   - describe_connected_agents : read the connected, bus-eligible (magentic_option)
//                                 Mag One Agent Cards + their capabilities, so the
//                                 Harness can write a run_mag_one prompt
//   - run_mag_one               : run regular native Mag One from a Harness-authored
//                                 Markdown orchestration prompt (used verbatim — no
//                                 plan, no task object, no approval/visible-flow gate)
//
// All handlers read authoritative current state, never mutate the deck, never
// write graph memory, and never fabricate agents/tools/outputs.

import { getDeckDocument } from '../../../decks/store';
import { resolvedMagenticOptions, runCardWithContract } from '../../../cards/runtime';
import { resolveCoderWorkspaceRoot } from '../../workspaceRoot';

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
// The ONE read tool Harness uses to see the Mag One team before writing the
// run_mag_one prompt: the currently connected, bus-eligible (magentic_option)
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
// The ONE Mag One entrypoint: a Harness-authored Markdown orchestration prompt
// runs regular native Mag One. No structured plan, no plan.objective, no
// prompt-to-plan adapter, no task ledger gate, no approval gate, no visible-flow
// task-by-task wrapper. The Markdown string IS Mag One's job; Mag One reasons
// over it, selects among the connected bus-eligible workers itself, runs them,
// and returns its own result (its native internal task ledger may exist, but is
// never forced/exposed/gated here).
export type RunMagOneInput = {
  projectId: string;
  deckId: string;
  // The Harness-authored Markdown orchestration prompt — objective, relevant
  // graph/repo/research findings, constraints, available connected agents, and
  // desired result/proof, exactly as Harness judged relevant. Used verbatim as
  // the native Mag One task; never translated into a plan or task object.
  // Optional: supply this OR jobId (the Coder job-folder handoff).
  promptMarkdown?: string;
  // Coder job-folder handoff: the shared job id. When set, the run's task is the
  // EXACT bytes of handoff/<jobId>/prompt.md (the Coder wrote it with its native
  // Write tool) and its return surface is returns/<jobId>/. The workspace root is
  // the server-forced trusted root — never a client path. Takes precedence over
  // promptMarkdown so the job FILE is always the contract.
  jobId?: string;
};

export type RunMagOneResult = {
  status: 'completed' | 'failed';
  runId: string;
  finalText: string;
  failure: string | null;
  provenance: { route: string };
  // Coder job-folder handoff: the assigned return surface + the files the run
  // actually wrote there, so the Coder can read and continue from them. Null /
  // empty for a normal (promptMarkdown) run.
  jobId: string | null;
  returnsDir: string | null;
  returnedFiles: string[];
  returnStatus: 'return_files_created' | 'no_return_files_created' | null;
};

export async function runMagOne(
  input: RunMagOneInput,
  deps: AgentFlowDeps = {},
): Promise<RunMagOneResult> {
  const loadDeck = deps.loadDeck ?? getDeckDocument;
  const runCard = deps.runCard ?? runCardWithContract;

  const projectId = asString(input?.projectId).trim();
  const deckId = asString(input?.deckId).trim();
  const jobId = asString(input?.jobId).trim();
  const promptMarkdown = asString(input?.promptMarkdown).trim();
  const route = 'liquidaity_mcp(run_mag_one) -> cards/runtime -> autogen rails -> magentic-one';
  const runId = `mag_one_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!projectId || !deckId) {
    throw new Error('run_mag_one_missing_selected_flow: projectId and deckId are required');
  }
  // Either a Coder job-folder handoff (jobId) or an inline Markdown prompt is the
  // task source. jobId wins so the on-disk handoff FILE is always the contract.
  if (!jobId && !promptMarkdown) {
    throw new Error('run_mag_one_missing_input: provide jobId (job-folder handoff) or promptMarkdown');
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

  // The coder workspace root is SERVER-OWNED and trusted — the default owned Coder
  // workspace (<repo-root>/coder-workspace), never a client path; a client-supplied
  // job id only names a folder UNDER this root.
  const workspaceRoot = resolveCoderWorkspaceRoot();

  // Regular native Mag One run. For a handoff run the runtime input is empty —
  // the Python rails read handoff/<jobId>/prompt.md as the exact task; otherwise
  // the Markdown prompt is the task. Bus eligibility (magentic_option) is enforced
  // inside runCardWithContract, which throws honestly when no worker is connected.
  const result = await runCard(orchestrator, {}, jobId ? '' : promptMarkdown, {
    deckId,
    projectId,
    allCards: nodes,
    allEdges: edges,
    allTemplates: [],
    previousOutput: '',
    ...(jobId ? { jobHandoff: { workspaceRoot, jobId } } : {}),
  });

  const failed = result?.status === 'error';
  const handoff = (result as any)?.jobHandoffResult ?? null;
  return {
    status: failed ? 'failed' : 'completed',
    runId,
    finalText: asString(result?.output),
    failure: failed ? asString(result?.error) || 'run_mag_one_failed' : null,
    provenance: { route },
    jobId: jobId || null,
    returnsDir: handoff?.returnsDir ?? null,
    returnedFiles: Array.isArray(handoff?.returnedFiles) ? handoff.returnedFiles : [],
    returnStatus: handoff?.returnStatus ?? null,
  };
}
