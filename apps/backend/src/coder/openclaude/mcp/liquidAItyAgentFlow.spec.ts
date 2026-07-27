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
  });

  it('transports only stable assignment identities to the Python-owned runtime', async () => {
    const runCard = vi.fn(async () => ({
      status: 'success',
      output: 'done',
      agentAssignmentResult: {
        assignmentId: 'assignment:run-1',
        artifactLocators: ['artifacts/a/report.md'],
      },
    }));
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
    const [card, _agent, taskText, context] = runCard.mock.calls[0];
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
    expect(result.artifactLocators).toEqual(['artifacts/a/report.md']);
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
