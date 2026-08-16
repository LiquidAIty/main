import { describe, expect, it, vi } from 'vitest';

import { describeConnectedAgents } from './mainAgentFlow';

describe('Python-owned Mag One roster transport', () => {
  it('forwards exact Project/Deck identity and returns the Python result', async () => {
    const request = vi.fn(async () => ({
      ok: true,
      projectId: 'project-1',
      deckId: 'deck-1',
      orchestratorCardId: 'card_magentic',
      connectedAgents: [{
        cardId: 'card_worker',
        title: 'Worker',
        model: { modelKey: 'model-1', provider: 'openai' },
        tools: [],
        connected: true,
        executionReady: true,
        readinessState: 'ready',
        readinessReason: null,
      }],
    }));

    const result = await describeConnectedAgents(
      { projectId: 'project-1', deckId: 'deck-1' },
      request as any,
    );

    expect(request).toHaveBeenCalledWith(
      '/domain/mag-one/project-1/deck-1/agents',
      { method: 'GET' },
    );
    expect(result.connectedAgents.map((agent) => agent.cardId)).toEqual(['card_worker']);
  });

  it('fails before transport when Project or Deck identity is absent', async () => {
    await expect(
      describeConnectedAgents({ projectId: '', deckId: 'deck-1' }, vi.fn() as any),
    ).rejects.toThrow('projectId_and_deckId_required');
  });

  it('rejects a malformed Python response', async () => {
    await expect(
      describeConnectedAgents(
        { projectId: 'project-1', deckId: 'deck-1' },
        vi.fn(async () => ({ ok: true, connectedAgents: [] })) as any,
      ),
    ).rejects.toThrow('mag_one_connected_agents_response_invalid');
  });
});
