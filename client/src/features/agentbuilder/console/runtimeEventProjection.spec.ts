import { describe, expect, it } from 'vitest';

import {
  reconcileTerminalEvents,
  type CardTerminalEvent,
} from './runtimeEventProjection';

const identity = {
  projectId: 'p',
  deckId: 'd',
  cardId: 'c',
  cardName: 'Saved Card',
  runId: 'r',
  parentRunId: null,
  nativeChildId: null,
};

const model: CardTerminalEvent = {
  ...identity,
  id: 'r:model',
  kind: 'model',
  sequence: 1,
  timestamp: null,
  text: 'Model text',
};

describe('runtime event projection', () => {
  it('updates a public event in place by stable scoped identity', () => {
    const updated = { ...model, text: 'Model text appended' };

    expect(reconcileTerminalEvents([model, updated])).toEqual([updated]);
  });

  it('preserves worker and task identities while ordering concurrent events', () => {
    const first = {
      ...model,
      id: 'native-1',
      taskId: 't_a',
      agentId: 'attempt-1',
      text: 'Worker A',
      sequence: 2,
    };
    const second = {
      ...first,
      taskId: 't_b',
      agentId: 'attempt-2',
      text: 'Worker B',
      sequence: 1,
    };
    const retry = {
      ...first,
      agentId: 'attempt-3',
      text: 'Replacement A',
      sequence: 3,
    };

    expect(reconcileTerminalEvents([retry, first, second, first])).toEqual([
      second,
      first,
      retry,
    ]);
  });

  it('excludes events that are not part of the public runtime contract', () => {
    const privateReasoning = {
      ...model,
      id: 'thought',
      kind: 'reasoning',
      text: 'private thought',
    } as unknown as CardTerminalEvent;

    expect(reconcileTerminalEvents([model, privateReasoning])).toEqual([model]);
  });
});
