// Hermes preflight_context assembly (SPEC: Hermes memory preflight).
// Pure-dependency tests: every graph/deck read is injected, so these prove the
// assembly contract — honest availability, connected/disconnected separation,
// complete RunPacket draft fields — without a DB or a running stack.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearHermesActivityForTest, listHermesActivity } from './hermesActivity';
import { hermesPreflightContext, renderRunPacketDraftMarkdown } from './hermesPreflight';

const INTENT = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  conversationId: 'main',
  userRequest: 'Research the current thesis.',
};

const VIEW = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  orchestratorCardId: 'card_magentic',
  connectedAgents: [
    { cardId: 'card_research_agent', title: 'Research Agent', model: { modelKey: null, provider: null }, tools: [], connected: true },
    { cardId: 'card_knowgraph_agent', title: 'KnowGraph Agent', model: { modelKey: null, provider: null }, tools: ['retrieve_knowgraph_context'], connected: true },
    { cardId: 'card_hermes_steward', title: 'Hermes', model: { modelKey: null, provider: null }, tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'], connected: true },
  ],
};

const DECK = {
  deck: {
    nodes: [
      { id: 'card_main_chat', kind: 'agent' },
      { id: 'card_magentic', kind: 'agent' },
      { id: 'card_research_agent', kind: 'agent' },
      { id: 'card_knowgraph_agent', kind: 'agent' },
      { id: 'card_hermes_steward', kind: 'agent' },
      { id: 'card_local_coder', kind: 'agent' },
      { id: 'card_plan_agent', kind: 'agent' },
      { id: 'card_child', kind: 'agent', parentGraphId: 'card_magentic' },
    ],
  },
};

const SCOPE = {
  nodes: [
    { id: 'run:1', label: 'RunRecord 1', kind: 'resource' as const, itemKind: 'RunRecord', mentionCount: 1, provenanceCount: 1 },
    { id: 'blocker:1', label: 'Blocker x', kind: 'resource' as const, mentionCount: 1, provenanceCount: 1 },
  ],
  edges: [
    { id: 'e1', source: 'run:1', target: 'blocker:1', predicate: 'ENCOUNTERED', mentionCount: 1, provenanceCount: 1 },
  ],
};

const deps = (overrides: Record<string, unknown> = {}) =>
  ({
    describeAgents: async () => VIEW,
    loadDeck: async () => DECK,
    readScope: async () => SCOPE,
    checkKnowGraph: async () => ({ available: true }),
    ...overrides,
  }) as any;

describe('hermesPreflightContext', () => {
  beforeEach(() => clearHermesActivityForTest());

  it('assembles the ContextPacket and a complete RunPacket draft from real reads', async () => {
    const result = await hermesPreflightContext(INTENT, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contextPacket.thinkGraph).toMatchObject({ available: true, nodeCount: 2, edgeCount: 1 });
    expect(result.contextPacket.knowGraph).toMatchObject({ available: true, accessPath: 'retrieve_knowgraph_context' });
    expect(result.contextPacket.codeGraph.consulted).toBe(false);
    expect(result.contextPacket.connectedParticipants.map((a) => a.cardId)).toEqual([
      'card_research_agent',
      'card_knowgraph_agent',
      'card_hermes_steward',
    ]);
    // Disconnected exclusions: never the orchestrator, the front door, a child
    // card, or a connected worker.
    expect(result.contextPacket.disconnectedExclusions).toEqual(['card_local_coder', 'card_plan_agent']);

    const draft = result.runPacketDraft;
    expect(draft.userRequest).toBe(INTENT.userRequest);
    expect(draft.conversationId).toBe('main');
    expect(draft.graphContext).toEqual({ thinkGraph: 'available', knowGraph: 'available', codeGraph: 'not_consulted' });
    expect(draft.proofRequirements.length).toBeGreaterThan(0);
    expect(draft.noFallbackRules.length).toBeGreaterThan(0);
    expect(draft.promptMarkdown).toContain('# Run Packet (draft — Hermes preflight)');
    expect(draft.promptMarkdown).toContain('card_research_agent');
    expect(draft.promptMarkdown).toContain('card_local_coder');
    expect(draft.promptMarkdown).toBe(renderRunPacketDraftMarkdown({ ...draft }));

    // The one side effect: a real context_query activity entry.
    const activity = listHermesActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0].type).toBe('context_query');
    expect(activity[0].summary).toContain('Preflight');
  });

  it('reports a failed ThinkGraph read as honestly unavailable — never fabricated context', async () => {
    const result = await hermesPreflightContext(
      INTENT,
      deps({
        readScope: async () => {
          throw new Error('age_down');
        },
        checkKnowGraph: async () => ({ available: false, reason: 'neo4j_env_missing' }),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contextPacket.thinkGraph).toMatchObject({
      available: false,
      reason: 'age_down',
      nodeCount: 0,
      recentNodes: [],
    });
    expect(result.contextPacket.knowGraph).toMatchObject({ available: false, reason: 'neo4j_env_missing' });
    expect(result.runPacketDraft.graphContext).toMatchObject({ thinkGraph: 'unavailable', knowGraph: 'unavailable' });
    expect(result.runPacketDraft.hermesContextSummary).toContain('ThinkGraph unavailable: age_down');
  });

  it('rejects an incomplete RunIntent', async () => {
    const result = await hermesPreflightContext({ ...INTENT, userRequest: '  ' }, deps());
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('preflight_intent_incomplete');
    expect(listHermesActivity()).toHaveLength(0);
  });

  it('fails honestly when the deck read fails', async () => {
    const result = await hermesPreflightContext(
      INTENT,
      deps({
        describeAgents: async () => {
          throw new Error('describe_connected_agents_deck_not_found: projectId=project-1 deckId=deck_builder');
        },
      }),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('deck_not_found');
  });

  it('reports code-context state when requested: disconnected CodeGraph card is named', async () => {
    const result = await hermesPreflightContext({ ...INTENT, needsCodeContext: true }, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contextPacket.codeGraph.consulted).toBe(false);
    expect(result.contextPacket.codeGraph.reason).toContain('disconnected');
    expect(result.runPacketDraft.graphContext.codeGraph).toBe('unavailable');
  });
});
