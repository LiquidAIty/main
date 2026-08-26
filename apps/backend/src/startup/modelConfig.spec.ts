import { describe, expect, it, vi } from 'vitest';

import { logModelConfiguration } from './modelConfig';

describe('startup model configuration reporting', () => {
  it('reports an unavailable saved Deck without claiming the Deck is absent', async () => {
    const output: string[] = [];
    const errors: string[] = [];

    await logModelConfiguration({
      listProjects: async () => [{ id: 'project-1', code: 'p1', name: 'Project One' }],
      readDeck: vi.fn(async () => { throw new Error('fetch failed'); }),
      write: (message) => output.push(message),
      writeError: (message) => errors.push(message),
    });

    expect(errors).toEqual([
      '  ❌ Saved Agent Canvas deck unavailable for Project Project One: fetch failed',
    ]);
    expect(output).toContain(
      '  (saved Agent Canvas deck state unavailable — model routing not reported)\n',
    );
    expect(output.join('\n')).not.toContain('no saved Agent Canvas deck found');
  });

  it('uses the absence message only after a successful Deck read returns no saved Deck', async () => {
    const output: string[] = [];

    await logModelConfiguration({
      listProjects: async () => [{ id: 'project-1', code: 'p1', name: 'Project One' }],
      readDeck: vi.fn(async () => ({
        deck: null,
        meta: { deckRevision: null, deckSavedAt: null },
      })),
      write: (message) => output.push(message),
      writeError: vi.fn(),
    });

    expect(output).toContain('  (no saved Agent Canvas deck found — nothing routes yet)\n');
  });

  it('reports a malformed Deck response separately from absence and service availability', async () => {
    const output: string[] = [];
    const errors: string[] = [];

    await logModelConfiguration({
      listProjects: async () => [{ id: 'project-1', code: 'p1', name: 'Project One' }],
      readDeck: vi.fn(async () => { throw new Error('python_deck_response_invalid'); }),
      write: (message) => output.push(message),
      writeError: (message) => errors.push(message),
    });

    expect(errors).toEqual([
      '  ❌ Saved Agent Canvas deck malformed for Project Project One: python_deck_response_invalid',
    ]);
    expect(output).toContain(
      '  (saved Agent Canvas deck response malformed — model routing not reported)\n',
    );
    expect(output.join('\n')).not.toContain('no saved Agent Canvas deck found');
    expect(output.join('\n')).not.toContain('state unavailable');
  });
});
