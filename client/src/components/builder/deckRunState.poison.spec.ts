import { describe, expect, it } from 'vitest';

import type { DeckRun } from '../../types/agentgraph';
import { buildReloadStateFromDeckRuns } from './deckRunState';

// Focused proof for the chat-output boundary. Imports ONLY deckRunState.ts (no
// agentbuilder.tsx, so no WorldSignals globe / d3 / three). Proves: a real clean
// answer appears in chat; a failed run does not become an assistant bubble.

function makeRun(partial: Partial<DeckRun> & { steps?: any[] }): DeckRun {
  return {
    id: 'run-1',
    deckId: 'deck-1',
    startedAt: '2026-06-16T00:00:00.000Z',
    endedAt: '2026-06-16T00:00:01.000Z',
    status: 'success',
    input: '',
    steps: [],
    events: [],
    ...partial,
  } as unknown as DeckRun;
}

describe('deckRunState — chat shows the real answer only', () => {
  it('appends a genuine clean assistant answer from a successful run', () => {
    const run = makeRun({
      status: 'success',
      input: 'Tell me a very short one sentence joke.',
      steps: [
        {
          id: 's1',
          status: 'success',
          output: 'Why did the scarecrow win an award? Because he was outstanding in his field.',
        },
      ],
    });
    const state = buildReloadStateFromDeckRuns([run], run);
    expect(state.messages).toEqual([
      { role: 'user', text: 'Tell me a very short one sentence joke.' },
      {
        role: 'assistant',
        text: 'Why did the scarecrow win an award? Because he was outstanding in his field.',
      },
    ]);
  });

  it('does not turn a failed run into an assistant chat bubble', () => {
    const run = makeRun({
      status: 'error',
      input: 'hi',
      error: 'AI call failed',
      steps: [{ id: 's1', status: 'error', output: '', error: 'boom' }],
    });
    const state = buildReloadStateFromDeckRuns([run], run);
    expect(state.messages).toEqual([{ role: 'user', text: 'hi' }]);
  });
});
