import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCardWithContract } from '../cards/runtime';
import { executeDeck } from './deckRuntime';

vi.mock('../cards/runtime', () => ({
  runCardWithContract: vi.fn(),
}));

describe('executeDeck', () => {
  beforeEach(() => {
    vi.mocked(runCardWithContract).mockReset();
  });

  it('passes workspaceObjectContext to the card runtime', async () => {
    vi.mocked(runCardWithContract).mockResolvedValue({
      cardId: 'mag1',
      status: 'success',
      output: 'real output',
      startedAt: '2026-06-11T00:00:00.000Z',
      endedAt: '2026-06-11T00:00:01.000Z',
    } as any);

    const workspaceObjectContext = {
      activeSurface: 'agent_builder',
      selectedObjectId: 'card-a',
    };

    const result = await executeDeck(
      {
        id: 'deck-1',
        nodes: [{ id: 'mag1', runtimeType: 'magentic_one' }],
        edges: [],
      },
      [],
      {
        input: 'hello',
        projectId: 'project-1',
        workspaceObjectContext,
      },
    );

    expect(result.status).toBe('success');
    expect(runCardWithContract).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mag1' }),
      {},
      'hello',
      expect.objectContaining({ workspaceObjectContext }),
    );
  });
});
