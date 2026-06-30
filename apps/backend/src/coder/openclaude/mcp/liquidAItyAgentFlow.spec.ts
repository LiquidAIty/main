import { describe, expect, it, vi } from 'vitest';
import {
  buildAgentFabricProfile,
  buildProjectContext,
  executeVisibleFlow,
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

  it('contributes the ThinkGraph capability: skill link, permitted tools, and read/write boundary', async () => {
    const ctx = await buildProjectContext(
      { projectId: 'project-1', deckId: 'deck_builder' },
      deps(),
    );
    const cap = ctx.thinkGraphCapability;
    expect(cap.skill).toBe('skills/thinkgraph.md');
    // The skill file is the source of truth and is actually loaded (not a dangling link).
    expect(cap.skillInstructions).toContain('directional');
    // ThinkGraph has exactly one durable writer; KnowGraph is read-only (no write group exists).
    expect(cap.permittedTools.thinkgraphWrite).toEqual(['thinkgraph_apply_delta']);
    expect(cap.permittedTools.knowgraphRead).toEqual([
      'knowgraph_get_slice', 'knowgraph_search', 'knowgraph_inspect_evidence', 'knowgraph_get_source_context',
    ]);
    expect(Object.keys(cap.permittedTools)).not.toContain('knowgraphWrite');
    expect(cap.permittedTools.graphNav).toEqual(['graph_focus', 'graph_highlight', 'graph_clear_highlight']);
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
