/**
 * Hermes preflight_context — the memory read Hermes performs for the Harness
 * BEFORE a Mag One run.
 *
 * Assembly only: bounded REAL reads (ThinkGraph scope, deck bus topology,
 * KnowGraph reachability) packaged into a ContextPacket plus a structural
 * RunPacketDraft the Harness refines. No model call, no reasoning, and NO
 * writes — the only side effect is one honest Hermes activity entry recording
 * that the preflight actually ran. An unavailable graph source is reported as
 * unavailable, never faked into context.
 */

import type {
  ContextPacket,
  RunIntent,
  RunPacketDraft,
} from '../../contracts/runtimeContracts';
import { describeConnectedAgents } from '../openclaude/mcp/liquidAItyAgentFlow';
import { getDeckDocument } from '../../decks/store';
import { readThinkGraphScope } from '../../services/thinkgraph/thinkGraphStore';
import { appendHermesActivity } from './hermesActivity';

const RECENT_NODE_LIMIT = 20;
const KNOWGRAPH_PING_TIMEOUT_MS = 3_000;

// Standing run-contract text — constants of the role model, not reasoning.
export const RUN_PACKET_PROOF_REQUIREMENTS = [
  'Each worker result must name the worker and carry its actual output/evidence.',
  'Graph reads must state whether real context was available or honestly empty.',
];
export const RUN_PACKET_NO_FALLBACK_RULES = [
  'Use only the connected workers listed; disconnected cards are excluded from this run.',
  'If a selected worker or graph read fails, report the failure honestly — never substitute a solo answer.',
  'Never claim a graph write, artifact, or tool execution that a returned result does not show.',
];
export const RUN_PACKET_EXPECTED_OUTPUT =
  'A final report readable in chat: what was done, which workers acted, their evidence, blockers, and the recommended next action.';

/** Honest KnowGraph reachability: a real Neo4j connectivity check against the
 * same env config the KnowGraph read routes use. No data is read. */
async function checkKnowGraphReachable(): Promise<{ available: boolean; reason?: string }> {
  const uri = String(process.env.NEO4J_URI || '').trim();
  const user = String(process.env.NEO4J_USER || '').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();
  if (!uri || !user || !password) {
    return { available: false, reason: 'neo4j_env_missing' };
  }
  let driver: any = null;
  try {
    const neo4jModule: any = await import('neo4j-driver');
    const neo4j: any = neo4jModule?.default ?? neo4jModule;
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    await Promise.race([
      driver.verifyConnectivity(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('neo4j_connectivity_timeout')), KNOWGRAPH_PING_TIMEOUT_MS),
      ),
    ]);
    return { available: true };
  } catch (error: any) {
    return { available: false, reason: String(error?.message || 'neo4j_unreachable') };
  } finally {
    try {
      await driver?.close();
    } catch {
      /* connectivity result already decided */
    }
  }
}

export type HermesPreflightDeps = {
  loadDeck?: typeof getDeckDocument;
  describeAgents?: typeof describeConnectedAgents;
  readScope?: typeof readThinkGraphScope;
  checkKnowGraph?: typeof checkKnowGraphReachable;
};

export type HermesPreflightResult =
  | { ok: true; contextPacket: ContextPacket; runPacketDraft: RunPacketDraft }
  | { ok: false; error: string };

/** Structural Markdown rendering of the draft fields — real data in fixed
 * sections. The Harness refines this draft; it is never a plan translation. */
export function renderRunPacketDraftMarkdown(draft: Omit<RunPacketDraft, 'promptMarkdown'>): string {
  return [
    '# Run Packet (draft — Hermes preflight)',
    '',
    '## User request',
    draft.userRequest,
    '',
    '## Run identity',
    `- projectId: ${draft.projectId}`,
    `- deckId: ${draft.deckId}`,
    `- conversationId: ${draft.conversationId}`,
    '',
    '## Connected workers (the only eligible participants)',
    ...draft.connectedParticipants.map((id) => `- ${id}`),
    '',
    '## Excluded (disconnected — never callable in this run)',
    ...(draft.disconnectedExclusions.length
      ? draft.disconnectedExclusions.map((id) => `- ${id}`)
      : ['- none']),
    '',
    '## Hermes context summary',
    draft.hermesContextSummary,
    '',
    '## Graph context availability',
    `- ThinkGraph: ${draft.graphContext.thinkGraph}`,
    `- KnowGraph: ${draft.graphContext.knowGraph}`,
    `- CodeGraph: ${draft.graphContext.codeGraph}`,
    '',
    '## Proof requirements',
    ...draft.proofRequirements.map((rule) => `- ${rule}`),
    '',
    '## Expected visible output',
    draft.expectedVisibleOutput,
    '',
    '## No-fallback rules',
    ...draft.noFallbackRules.map((rule) => `- ${rule}`),
  ].join('\n');
}

export async function hermesPreflightContext(
  intent: RunIntent,
  deps: HermesPreflightDeps = {},
): Promise<HermesPreflightResult> {
  const loadDeck = deps.loadDeck ?? getDeckDocument;
  const describeAgents = deps.describeAgents ?? describeConnectedAgents;
  const readScope = deps.readScope ?? readThinkGraphScope;
  const checkKnowGraph = deps.checkKnowGraph ?? checkKnowGraphReachable;

  const projectId = String(intent?.projectId || '').trim();
  const deckId = String(intent?.deckId || '').trim();
  const conversationId = String(intent?.conversationId || '').trim();
  const userRequest = String(intent?.userRequest || '').trim();
  if (!projectId || !deckId || !userRequest) {
    return { ok: false, error: 'preflight_intent_incomplete: projectId, deckId, and userRequest are required' };
  }

  // Connected participants + disconnected exclusions from the LIVE saved deck
  // (bus edges are the only activation authority).
  let view: Awaited<ReturnType<typeof describeConnectedAgents>>;
  let disconnected: string[] = [];
  try {
    view = await describeAgents({ projectId, deckId });
    const { deck } = await loadDeck(projectId, deckId);
    const connectedIds = new Set(view.connectedAgents.map((a) => a.cardId));
    disconnected = (deck?.nodes || [])
      .filter((node: any) => String(node?.kind || 'agent') === 'agent')
      .filter((node: any) => !String(node?.parentGraphId || '').trim())
      .map((node: any) => String(node?.id || ''))
      .filter(
        (id: string) =>
          id &&
          !connectedIds.has(id) &&
          id !== view.orchestratorCardId &&
          id !== 'card_main_chat',
      )
      .sort();
  } catch (error: any) {
    return { ok: false, error: String(error?.message || 'preflight_deck_read_failed') };
  }

  // ThinkGraph: real bounded read; a failed read is an honest unavailable.
  let thinkGraph: ContextPacket['thinkGraph'];
  try {
    const scope = await readScope({ projectId });
    thinkGraph = {
      available: true,
      nodeCount: scope.nodes.length,
      edgeCount: scope.edges.length,
      recentNodes: scope.nodes.slice(0, RECENT_NODE_LIMIT).map((node) => ({
        id: node.id,
        label: node.label,
        ...(node.itemKind ? { kind: node.itemKind } : {}),
      })),
    };
  } catch (error: any) {
    thinkGraph = {
      available: false,
      reason: String(error?.message || 'thinkgraph_read_failed'),
      nodeCount: 0,
      edgeCount: 0,
      recentNodes: [],
    };
  }

  const knowGraphCheck = await checkKnowGraph();
  const knowGraph: ContextPacket['knowGraph'] = {
    available: knowGraphCheck.available,
    ...(knowGraphCheck.reason ? { reason: knowGraphCheck.reason } : {}),
    accessPath: 'retrieve_knowgraph_context',
  };

  // CodeGraph is read in-run through the CodeGraph card when code context is
  // required AND that card is connected. Preflight only reports the state.
  const codeGraphConnected = view.connectedAgents.some((a) => a.cardId === 'card_codegraph_agent');
  const codeGraph: ContextPacket['codeGraph'] = intent.needsCodeContext
    ? {
        consulted: false,
        reason: codeGraphConnected
          ? 'code context requested — available in-run via the connected CodeGraph card'
          : 'code context requested but the CodeGraph card is disconnected',
      }
    : { consulted: false, reason: 'code context not requested for this run' };

  const contextPacket: ContextPacket = {
    projectId,
    deckId,
    conversationId,
    thinkGraph,
    knowGraph,
    codeGraph,
    connectedParticipants: view.connectedAgents.map((a) => ({
      cardId: a.cardId,
      title: a.title,
      tools: a.tools,
    })),
    disconnectedExclusions: disconnected,
  };

  const hermesContextSummary = [
    thinkGraph.available
      ? `ThinkGraph: ${thinkGraph.nodeCount} node(s), ${thinkGraph.edgeCount} edge(s)` +
        (thinkGraph.nodeCount === 0 ? ' (honestly empty — no prior run memory)' : '')
      : `ThinkGraph unavailable: ${thinkGraph.reason}`,
    knowGraph.available
      ? 'KnowGraph reachable — evidence retrieval available in-run via retrieve_knowgraph_context'
      : `KnowGraph unavailable: ${knowGraph.reason}`,
    codeGraph.reason,
  ].join(' | ');

  const draftFields: Omit<RunPacketDraft, 'promptMarkdown'> = {
    userRequest,
    projectId,
    deckId,
    conversationId,
    connectedParticipants: contextPacket.connectedParticipants.map((a) => a.cardId),
    disconnectedExclusions: disconnected,
    hermesContextSummary,
    graphContext: {
      thinkGraph: thinkGraph.available ? 'available' : 'unavailable',
      knowGraph: knowGraph.available ? 'available' : 'unavailable',
      codeGraph: intent.needsCodeContext
        ? codeGraphConnected
          ? 'available'
          : 'unavailable'
        : 'not_consulted',
    },
    proofRequirements: [...RUN_PACKET_PROOF_REQUIREMENTS],
    expectedVisibleOutput: RUN_PACKET_EXPECTED_OUTPUT,
    noFallbackRules: [...RUN_PACKET_NO_FALLBACK_RULES],
  };
  const runPacketDraft: RunPacketDraft = {
    ...draftFields,
    promptMarkdown: renderRunPacketDraftMarkdown(draftFields),
  };

  // The one side effect: honest activity that this preflight really ran.
  appendHermesActivity([
    {
      id: `hermes:preflight:${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'context_query',
      summary:
        `Preflight: ThinkGraph ${thinkGraph.available ? `${thinkGraph.nodeCount} node(s)` : 'unavailable'}; ` +
        `KnowGraph ${knowGraph.available ? 'reachable' : 'unavailable'}; ` +
        `workers=[${draftFields.connectedParticipants.join(',')}]`,
      runId: null,
      featureId: null,
    },
  ]);

  return { ok: true, contextPacket, runPacketDraft };
}
