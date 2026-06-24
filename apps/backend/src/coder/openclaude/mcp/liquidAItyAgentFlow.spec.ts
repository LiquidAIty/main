import { describe, expect, it, vi } from 'vitest';
import {
  buildAgentFabricProfile,
  buildProjectContext,
  executeVisibleFlow,
  setSessionBuilderContext,
  writePlanDraft,
  type AgentFlowDeps,
  type ExecuteVisibleFlowInput,
} from './liquidAItyAgentFlow';

const DECK = {
  id: 'deck_builder',
  name: 'Builder Deck',
  nodes: [
    { id: 'card_magentic', kind: 'agent', runtimeType: 'magentic_one', title: 'Mag One' },
    {
      id: 'card_research',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      title: 'Research Agent',
      runtimeOptions: { modelKey: 'gpt-5.1', provider: 'openai', tools: ['current_datetime'] },
    },
    { id: 'card_lonely', kind: 'agent', runtimeType: 'assistant_agent', title: 'Disconnected' },
  ],
  edges: [{ id: 'e1', source: 'card_magentic', target: 'card_research', edgeType: 'magentic_option' }],
};

const LATEST_RUN = {
  steps: [
    {
      magenticTrace: {
        plan: {
          taskLedgerArtifact: {
            source: 'autogen_0_7_5_magentic_one',
            planFlowTaskObjects: [{ id: 't1', title: 'Do step', expectedArtifact: 'a report' }],
            modelCallProof: [{ label: 'plan_call' }],
          },
        },
      },
    },
  ],
};

const ROUTING_CONNECTED = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  eligibleBusConnectedAgents: [{ id: 'card_research', title: 'Research Agent', role: 'research', reason: '' }],
  selectedExecutionPath: [],
  ignoredEligibleAgents: [],
  disconnectedAgentsIgnored: [{ id: 'card_lonely', title: 'Disconnected', role: 'other', reason: '' }],
  missingRequiredAgents: [],
  blockedReason: null,
};
const ROUTING_EMPTY = { ...ROUTING_CONNECTED, eligibleBusConnectedAgents: [], disconnectedAgentsIgnored: [] };

function deps(over: Partial<AgentFlowDeps> = {}): AgentFlowDeps {
  return {
    loadDeck: vi.fn(async () => ({ deck: DECK, latestRun: LATEST_RUN, runs: [LATEST_RUN], meta: {} })) as any,
    buildRouting: vi.fn(() => ROUTING_CONNECTED) as any,
    runCard: vi.fn() as any,
    ...over,
  };
}

const PACKET: ExecuteVisibleFlowInput = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  taskIds: ['t1', 't2'],
  selectedCardId: 'card_research',
  missionPacket: {
    objective: 'Research RDW catalysts',
    selectedTaskSteps: [{ id: 't1', shortTitle: 'Gather filings', detail: 'Pull 8-Ks' }],
    constraints: ['read-only'],
    acceptanceCriteria: ['cite every claim'],
  },
};

describe('buildProjectContext', () => {
  it('summarizes authoritative deck + flow + selected card + active plan', async () => {
    const ctx = await buildProjectContext(
      { projectId: 'project-1', deckId: 'deck_builder', selectedCardId: 'card_research' },
      deps(),
    );
    expect(ctx.flowSummary).toEqual({
      orchestratorCardId: 'card_magentic',
      connectedFlowCardIds: ['card_research'],
      cardCount: 3,
      edgeCount: 1,
    });
    expect(ctx.selectedCard).toMatchObject({ id: 'card_research', busConnected: true });
    expect(ctx.activePlanSummary).toEqual({ hasArtifact: true, source: 'autogen_0_7_5_magentic_one', taskCount: 1 });
  });
});

describe('buildAgentFabricProfile (describe_agent_fabric)', () => {
  it('reports the real visible flow + capability profile, never invented', async () => {
    const profile = await buildAgentFabricProfile({ projectId: 'project-1', deckId: 'deck_builder' }, deps());
    expect(profile.visibleFlows).toEqual([
      { flowId: 'card_magentic', title: 'Mag One', runnable: true, connectedAgentCount: 1 },
    ]);
    expect(profile.selectedFlowProfile).toMatchObject({
      flowId: 'card_magentic',
      runnable: true,
      connectedAgents: [{ id: 'card_research', title: 'Research Agent', role: 'research' }],
      tools: ['current_datetime'],
      graphWritePolicy: 'no_direct_graph_write',
    });
    expect(profile.selectedFlowProfile?.models).toEqual([
      { cardId: 'card_research', modelKey: 'gpt-5.1', provider: 'openai' },
    ]);
    // Honest empties for fields not represented in authoritative deck state.
    expect(profile.selectedFlowProfile?.requiredInputs).toEqual([]);
  });

  it('marks a flow not runnable + needs-input condition when no agents are connected', async () => {
    const profile = await buildAgentFabricProfile(
      { projectId: 'project-1', deckId: 'deck_builder' },
      deps({ buildRouting: vi.fn(() => ROUTING_EMPTY) as any }),
    );
    expect(profile.visibleFlows[0].runnable).toBe(false);
    expect(profile.selectedFlowProfile?.needsInputConditions).toContain('flow_not_runnable_no_connected_agents');
  });
});

describe('executeVisibleFlow', () => {
  it('runs the mission WITHOUT runApproved and keys task updates to the provided plan task IDs', async () => {
    const runCard = vi.fn(async () => ({
      output: 'Mission complete.',
      status: 'success',
      magenticTrace: {
        plan: {
          taskLedgerArtifact: {
            source: 'autogen_0_7_5_magentic_one',
            planFlowTaskObjects: [{ id: 't1' }],
            modelCallProof: [{ label: 'plan_call' }],
          },
        },
        ledgerTrace: { source: 'python_magone' },
      },
    }));
    const result = await executeVisibleFlow(PACKET, deps({ runCard: runCard as any }));

    expect(runCard).toHaveBeenCalledTimes(1);
    const ctxArg = runCard.mock.calls[0][3] as Record<string, unknown>;
    // No approval boolean threaded into the new path.
    expect('runApproved' in ctxArg).toBe(false);

    expect(result.status).toBe('completed');
    // Task-ID preservation: updates keyed to the incoming plan task IDs.
    expect(result.taskUpdates.map((u) => u.taskId)).toEqual(['t1', 't2']);
    expect(result.taskUpdates.every((u) => u.status === 'completed')).toBe(true);
    expect(result.planFlowUpdates).toEqual([{ id: 't1' }]);
    expect(result.evidence).toEqual([{ label: 'plan_call' }]);
    expect(result.provenance.route).toContain('magentic-one');
    expect(result.needsInput).toEqual([]);
  });

  it('returns needs_input (no run) when the selected flow has no connected agents', async () => {
    const runCard = vi.fn();
    const result = await executeVisibleFlow(
      PACKET,
      deps({ buildRouting: vi.fn(() => ROUTING_EMPTY) as any, runCard: runCard as any }),
    );
    expect(runCard).not.toHaveBeenCalled();
    expect(result.status).toBe('needs_input');
    expect(result.needsInput[0].reason).toMatch(/no connected agents/);
    expect(result.taskUpdates.map((u) => u.status)).toEqual(['needs_input', 'needs_input']);
  });

  it('returns an honest failure when the run errors', async () => {
    const result = await executeVisibleFlow(
      PACKET,
      deps({ runCard: vi.fn(async () => ({ output: '', status: 'error', error: 'autogen_rails_unavailable' })) as any }),
    );
    expect(result.status).toBe('failed');
    expect(result.failure).toBe('autogen_rails_unavailable');
  });

  it('rejects a missing objective and a missing orchestrator card', async () => {
    await expect(
      executeVisibleFlow({ ...PACKET, missionPacket: { ...PACKET.missionPacket, objective: '' } }, deps()),
    ).rejects.toThrow(/missing_objective/);
    await expect(
      executeVisibleFlow(
        PACKET,
        deps({ loadDeck: vi.fn(async () => ({ deck: { id: 'd', name: 'x', nodes: [], edges: [] }, latestRun: null, runs: [], meta: {} })) as any }),
      ),
    ).rejects.toThrow(/no_orchestrator_card/);
  });
});

describe('writePlanDraft — session-bound context (concurrency safety)', () => {
  // A loader/saver pair that records every save keyed by `${projectId}/${deckId}`,
  // so we can prove a write lands ONLY in its own session's deck.
  function makeStore() {
    const saved: Record<string, any> = {};
    const loadDeck = vi.fn(async (projectId: string, deckId: string) => ({
      deck: {
        id: deckId,
        name: deckId,
        nodes: [{ id: 'card_magentic' }],
        edges: [],
        promptTemplates: [],
        version: 1,
      },
      latestRun: null,
      runs: [],
      meta: { deckRevision: `rev-${projectId}-${deckId}`, deckSavedAt: null },
    }));
    const saveDeck = vi.fn(async (projectId: string, deckId: string, document: any) => {
      saved[`${projectId}/${deckId}`] = document.planDraft;
      return { deck: document, meta: { deckRevision: 'rev2', deckSavedAt: null } };
    });
    return { saved, loadDeck, saveDeck };
  }
  const oneStep = (label: string) => [
    { shortTitle: `Step ${label}`, shortSummary: `s ${label}`, detail: `detail ${label}` },
  ];

  it('writes each session only into its own bound deck and never cross-writes', async () => {
    setSessionBuilderContext('mag1:projA:main', 'projA', 'deckA');
    setSessionBuilderContext('mag1:projB:main', 'projB', 'deckB');
    const store = makeStore();

    const resA = await writePlanDraft(
      { sessionId: 'mag1:projA:main', objective: 'Plan A', steps: oneStep('A') } as any,
      { loadDeck: store.loadDeck as any, saveDeck: store.saveDeck as any },
    );
    const resB = await writePlanDraft(
      { sessionId: 'mag1:projB:main', objective: 'Plan B', steps: oneStep('B') } as any,
      { loadDeck: store.loadDeck as any, saveDeck: store.saveDeck as any },
    );

    expect(store.saveDeck).toHaveBeenCalledWith('projA', 'deckA', expect.anything(), expect.anything());
    expect(store.saveDeck).toHaveBeenCalledWith('projB', 'deckB', expect.anything(), expect.anything());
    expect(resA.planDraft.projectId).toBe('projA');
    expect(resA.planDraft.deckId).toBe('deckA');
    expect(resB.planDraft.projectId).toBe('projB');
    expect(resB.planDraft.deckId).toBe('deckB');
    // A persisted only into A; B only into B; never the other way.
    expect(store.saved['projA/deckA'].objective).toBe('Plan A');
    expect(store.saved['projB/deckB'].objective).toBe('Plan B');
    expect(store.saved['projA/deckB']).toBeUndefined();
    expect(store.saved['projB/deckA']).toBeUndefined();
  });

  it('A still writes into A even after B’s session started (no shared global to clobber)', async () => {
    // Reproduces the old race: B's turn begins (sets B's context) BEFORE A writes.
    setSessionBuilderContext('mag1:projA:main', 'projA', 'deckA');
    const store = makeStore();
    setSessionBuilderContext('mag1:projB:main', 'projB', 'deckB'); // "B starts" — would clobber a global

    const resA = await writePlanDraft(
      { sessionId: 'mag1:projA:main', objective: 'A after B started', steps: oneStep('A') } as any,
      { loadDeck: store.loadDeck as any, saveDeck: store.saveDeck as any },
    );
    expect(resA.planDraft.projectId).toBe('projA');
    expect(resA.planDraft.deckId).toBe('deckA');
    expect(store.saveDeck).toHaveBeenCalledWith('projA', 'deckA', expect.anything(), expect.anything());
    expect(store.saveDeck).not.toHaveBeenCalledWith('projB', 'deckB', expect.anything(), expect.anything());
  });

  it('honors explicit ids for the direct bridge route (no session context required)', async () => {
    const store = makeStore();
    const res = await writePlanDraft(
      { projectId: 'directProj', deckId: 'directDeck', objective: 'Direct', steps: oneStep('D') } as any,
      { loadDeck: store.loadDeck as any, saveDeck: store.saveDeck as any },
    );
    expect(res.planDraft.projectId).toBe('directProj');
    expect(res.planDraft.deckId).toBe('directDeck');
    expect(store.saved['directProj/directDeck'].objective).toBe('Direct');
  });

  it('fails closed when neither a known session context nor explicit ids are present', async () => {
    const store = makeStore();
    await expect(
      writePlanDraft(
        { sessionId: 'mag1:never-bound:main', objective: 'X', steps: oneStep('X') } as any,
        { loadDeck: store.loadDeck as any, saveDeck: store.saveDeck as any },
      ),
    ).rejects.toThrow(/session_context/);
    expect(store.saveDeck).not.toHaveBeenCalled();
  });
});
