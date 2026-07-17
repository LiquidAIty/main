import { describe, it, expect } from 'vitest';
import { detectRunPathologies, type AgentTelemetryEvent } from './agentTelemetry';

// Minimal event factory — only the fields the detector reads.
let seq = 0;
function ev(partial: Partial<AgentTelemetryEvent>): AgentTelemetryEvent {
  seq += 1;
  return {
    id: `evt_${seq}`,
    timestamp: `2026-07-17T00:00:${String(seq).padStart(2, '0')}.000Z`,
    projectId: 'p',
    deckId: 'd',
    conversationId: 'main',
    correlationId: 'run_1',
    stage: 'card_call',
    caller: 'mag_one',
    cardId: null,
    provider: null,
    model: null,
    inputSummary: '',
    outputSummary: '',
    status: 'completed',
    errorSummary: null,
    durationMs: null,
    contextChars: null,
    tools: [],
    graphReads: [],
    graphWrites: [],
    mode: 'real_model_call',
    metadata: {},
    source: 'ram',
    ...partial,
  };
}

describe('detectRunPathologies — Double Agent failure detection', () => {
  it('flags a repeated identical tool signature (tool loop)', () => {
    const p = detectRunPathologies([
      ev({ cardId: 'card_x', tools: ['knowgraph.query'] }),
      ev({ cardId: 'card_x', tools: ['knowgraph.query'] }),
      ev({ cardId: 'card_x', tools: ['knowgraph.query'] }),
    ]);
    expect(p.repeatedToolSignatures).toHaveLength(1);
    expect(p.repeatedToolSignatures[0]).toMatchObject({ cardId: 'card_x', signature: 'knowgraph.query', count: 3 });
  });

  it('does not flag distinct tool signatures on the same card', () => {
    const p = detectRunPathologies([
      ev({ cardId: 'card_x', tools: ['knowgraph.query'] }),
      ev({ cardId: 'card_x', tools: ['codegraph.search'] }),
    ]);
    expect(p.repeatedToolSignatures).toHaveLength(0);
  });

  it('flags a call re-driven after a non-retryable failure', () => {
    const p = detectRunPathologies([
      ev({ stage: 'card_call', cardId: 'card_kg', status: 'started' }),
      ev({ stage: 'card_call', cardId: 'card_kg', status: 'failed', errorSummary: 'knowgraph_corpus_unprepared retryable=false' }),
      ev({ stage: 'card_call', cardId: 'card_kg', status: 'started' }), // retry it anyway
    ]);
    expect(p.retriesAfterFailure).toContain('card_call:card_kg');
  });

  it('does not flag a retry after a retryable (empty) result', () => {
    const p = detectRunPathologies([
      ev({ stage: 'card_call', cardId: 'card_kg', status: 'started' }),
      ev({ stage: 'card_call', cardId: 'card_kg', status: 'completed', outputSummary: 'empty' }),
      ev({ stage: 'card_call', cardId: 'card_kg', status: 'started' }),
    ]);
    expect(p.retriesAfterFailure).toHaveLength(0);
  });

  it('flags duplicate dispatch of the same worker', () => {
    const p = detectRunPathologies([
      ev({ stage: 'mag_one_dispatch', cardId: 'card_research' }),
      ev({ stage: 'mag_one_dispatch', cardId: 'card_research' }),
      ev({ stage: 'mag_one_dispatch', cardId: 'card_worldsignals' }),
    ]);
    expect(p.duplicateDispatch).toEqual(['card_research']);
  });

  it('flags a child that started but never reached a terminal state', () => {
    const p = detectRunPathologies([
      ev({ stage: 'card_call', cardId: 'card_a', status: 'started' }),
      ev({ stage: 'card_call', cardId: 'card_a', status: 'completed' }),
      ev({ stage: 'card_call', cardId: 'card_b', status: 'started' }), // never completes
    ]);
    expect(p.unresolvedChildren).toEqual(['card_call:card_b']);
  });

  it('flags an automatic second run (two frontdoor starts)', () => {
    const p = detectRunPathologies([
      ev({ stage: 'frontdoor', status: 'started' }),
      ev({ stage: 'frontdoor', status: 'completed' }),
      ev({ stage: 'frontdoor', status: 'started' }), // second run, same correlation
    ]);
    expect(p.secondRunDetected).toBe(true);
  });

  it('reports the largest context contribution for input-pressure triage', () => {
    const p = detectRunPathologies([
      ev({ stage: 'hermes_context', contextChars: 2000 }),
      ev({ stage: 'card_call', contextChars: 74000 }),
      ev({ stage: 'card_call', contextChars: 1200 }),
    ]);
    expect(p.maxContextChars).toBe(74000);
  });

  it('a clean run has no pathologies', () => {
    const p = detectRunPathologies([
      ev({ stage: 'frontdoor', status: 'started' }),
      ev({ stage: 'mag_one_dispatch', cardId: 'card_research' }),
      ev({ stage: 'card_call', cardId: 'card_research', status: 'started', tools: ['web_search'] }),
      ev({ stage: 'card_call', cardId: 'card_research', status: 'completed' }),
      ev({ stage: 'frontdoor', status: 'completed' }),
    ]);
    expect(p.repeatedToolSignatures).toHaveLength(0);
    expect(p.retriesAfterFailure).toHaveLength(0);
    expect(p.duplicateDispatch).toHaveLength(0);
    expect(p.unresolvedChildren).toHaveLength(0);
    expect(p.secondRunDetected).toBe(false);
  });
});
