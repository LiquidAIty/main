import { describe, expect, it, vi } from 'vitest';

import { describeConnectedAgents, runMagOne } from './liquidAItyAgentFlow';

const nodes = [
  {
    id: 'card_main_chat',
    kind: 'agent',
    runtimeType: 'assistant_agent',
    runtimeOptions: { binding: 'main_chat' },
  },
  {
    id: 'card_mag_one',
    kind: 'agent',
    runtimeType: 'magentic_one',
  },
  {
    id: 'card_worker',
    kind: 'agent',
    title: 'Worker',
    runtimeType: 'assistant_agent',
    runtimeOptions: { tools: ['web_search'] },
  },
];
const edges = [
  { id: 'control', source: 'card_main_chat', target: 'card_mag_one', edgeType: 'magentic_control' },
  { id: 'worker', source: 'card_mag_one', target: 'card_worker', edgeType: 'magentic_option' },
];

function deps(runCard = vi.fn()) {
  return {
    loadDeck: vi.fn(async () => ({ deck: { nodes, edges } })) as any,
    runCard: runCard as any,
    resolveWorkerReadiness: vi.fn(async (cards: any[]) => cards.map((card) => ({
      card,
      connected: true as const,
      executionReady: true,
      readinessState: 'ready' as const,
      readinessReason: null,
    }))),
  };
}

describe('AgentGraph-native Mag One flow', () => {
  it('describes only bus-connected saved worker cards', async () => {
    const result = await describeConnectedAgents(
      { projectId: 'project-1', deckId: 'deck-1' },
      deps(),
    );
    expect(result.orchestratorCardId).toBe('card_mag_one');
    expect(result.connectedAgents.map((agent) => agent.cardId)).toEqual(['card_worker']);
    expect(result.connectedAgents[0]).toMatchObject({
      connected: true,
      executionReady: true,
      readinessState: 'ready',
      readinessReason: null,
    });
  });

  it('lists an explicit blue-connected staged card while keeping it out of execution', async () => {
    const trading = {
      id: 'card_trading_workbench',
      kind: 'agent',
      title: 'Trading Agent',
      runtimeType: 'assistant_agent',
      parentGraphId: 'workbench_trading',
      runtimeOptions: { modelKey: 'openai/gpt-5.6-luna', provider: 'openrouter' },
    };
    const stagedNodes = [...nodes, trading];
    const stagedEdges = [
      ...edges,
      { id: 'trading', source: 'card_trading_workbench', target: 'card_mag_one', edgeType: 'magentic_option' },
    ];
    const result = await describeConnectedAgents(
      { projectId: 'project-1', deckId: 'deck-1' },
      {
        loadDeck: vi.fn(async () => ({ deck: { nodes: stagedNodes, edges: stagedEdges } })) as any,
        resolveWorkerReadiness: vi.fn(async (cards: any[]) => cards.map((card) => ({
          card,
          connected: true as const,
          executionReady: card.id !== trading.id,
          readinessState: card.id === trading.id ? 'staged_runtime_missing' as const : 'ready' as const,
          readinessReason: card.id === trading.id ? 'trading_runtime_adapter_missing' : null,
        }))),
      },
    );

    expect(result.connectedAgents.map((agent) => agent.cardId)).toEqual([
      'card_worker',
      'card_trading_workbench',
    ]);
    expect(result.connectedAgents[1]).toMatchObject({
      connected: true,
      executionReady: false,
      readinessState: 'staged_runtime_missing',
      readinessReason: 'trading_runtime_adapter_missing',
    });
  });

  it('transports only stable assignment identities to the Python-owned runtime', async () => {
    const runCard = vi.fn(
      async (_card: any, _taskText: string, _context: any) => ({
      status: 'success',
      output: 'done',
      agentAssignmentResult: {
        assignmentId: 'assignment:run-1',
      },
      }),
    );
    const result = await runMagOne(
      {
        projectId: 'project-1',
        deckId: 'deck-1',
        conversationId: 'main',
        instructionId: 'instruction:abc',
      },
      deps(runCard),
    );
    expect(runCard).toHaveBeenCalledOnce();
    const [card, taskText, context] = runCard.mock.calls[0];
    expect(card.id).toBe('card_mag_one');
    expect(taskText).toBe('');
    expect(context.agentAssignment).toEqual({
      instructionId: 'instruction:abc',
      senderCardId: 'card_main_chat',
      receiverCardId: 'card_mag_one',
    });
    expect(JSON.stringify(context)).not.toContain('prompt.md');
    expect(JSON.stringify(context)).not.toContain('workspaceRoot');
    expect(result.assignmentId).toBe('assignment:run-1');
  });

  it('fails before runtime when the stable instruction identity is absent', async () => {
    await expect(
      runMagOne(
        { projectId: 'project-1', deckId: 'deck-1', instructionId: '' },
        deps(),
      ),
    ).rejects.toThrow('run_mag_one_missing_identity');
  });

  it('requires exactly one saved Main controller edge', async () => {
    const loadDeck = vi.fn(async () => ({
      deck: { nodes, edges: edges.filter((edge) => edge.id !== 'control') },
    }));
    await expect(
      runMagOne(
        { projectId: 'project-1', deckId: 'deck-1', instructionId: 'instruction:abc' },
        { loadDeck: loadDeck as any, runCard: vi.fn() as any },
      ),
    ).rejects.toThrow('run_mag_one_main_control_not_authorized');
  });
});
