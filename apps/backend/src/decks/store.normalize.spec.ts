import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/pool', () => ({
  pool: { query: dbMocks.query },
}));

import { getDeckDocument, normalizeRuntimeOptions } from './store';

beforeEach(() => {
  dbMocks.query.mockReset();
});

// Persistence proof: the local SLM provider survives the deck-store sanitizer, so a
// card's local-model selection is written into (and read back from) the deck JSON.
describe('deck store runtime-options provider persistence', () => {
  it('preserves the local SLM provider + model on save', () => {
    const out = normalizeRuntimeOptions({
      provider: 'local_openai_compatible',
      modelKey: 'local-gemma-slm',
    });
    expect(out?.provider).toBe('local_openai_compatible');
    expect(out?.modelKey).toBe('local-gemma-slm');
  });

  it('still keeps cloud providers', () => {
    expect(normalizeRuntimeOptions({ provider: 'openai' })?.provider).toBe('openai');
    expect(normalizeRuntimeOptions({ provider: 'openrouter' })?.provider).toBe('openrouter');
  });

  it('drops unknown providers', () => {
    expect(normalizeRuntimeOptions({ provider: 'bogus' })?.provider).toBe(null);
  });
});

// Persistence proof: a card's SELECTED tool ids survive the deck-store sanitizer
// verbatim — the save/load roundtrip can never rewrite, reorder-filter, or
// substitute a card's tool assignment (the ThinkGraph card depends on exactly
// [read_thinkgraph_scope, apply_thinkgraph_patch] surviving).
describe('deck store runtime-options tool persistence', () => {
  it('preserves selected tool ids exactly as saved', () => {
    const out = normalizeRuntimeOptions({
      tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'],
    });
    expect(out?.tools).toEqual(['read_thinkgraph_scope', 'apply_thinkgraph_patch']);
  });

  it('trims whitespace but never renames or invents tool ids', () => {
    const out = normalizeRuntimeOptions({ tools: ['  read_thinkgraph_scope  ', '', 42] });
    expect(out?.tools).toEqual(['read_thinkgraph_scope']);
  });

  it('an absent selection stays absent — no default tools are injected', () => {
    expect(normalizeRuntimeOptions({})?.tools).toBe(null);
  });
});

describe('deck store edge persistence', () => {
  it('preserves a directed Main-to-Hermes flow edge exactly as saved', async () => {
    const deck = {
      id: 'deck_builder',
      name: 'Builder',
      version: 1,
      promptTemplates: [],
      nodes: [
        {
          id: 'card_main_chat',
          kind: 'agent',
          title: 'Main',
          runtimeBinding: 'main_chat',
          runtimeType: 'assistant_agent',
          position: { x: 0, y: 0 },
        },
        {
          id: 'custom-hermes-card',
          kind: 'agent',
          title: 'Hermes',
          runtimeBinding: 'hermes_steward',
          runtimeType: 'assistant_agent',
          position: { x: 100, y: 0 },
        },
        {
          id: 'worker',
          kind: 'agent',
          title: 'Worker',
          runtimeBinding: 'research_agent',
          runtimeType: 'assistant_agent',
          position: { x: 200, y: 0 },
        },
        {
          id: 'card_magentic',
          kind: 'agent',
          title: 'Bus',
          runtimeType: 'magentic_one',
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        {
          id: 'main-hermes-flow',
          source: 'card_main_chat',
          sourceHandle: 'out-a',
          target: 'custom-hermes-card',
          targetHandle: 'in-a',
          edgeType: 'flow',
        },
        {
          id: 'reversed',
          source: 'custom-hermes-card',
          target: 'card_main_chat',
          edgeType: 'flow',
        },
        {
          id: 'invalid',
          source: 'card_main_chat',
          target: 'custom-hermes-card',
          edgeType: 'unknown_authority',
        },
        {
          id: 'unrelated',
          source: 'card_main_chat',
          target: 'worker',
          edgeType: 'flow',
        },
        {
          id: 'control',
          source: 'card_main_chat',
          target: 'card_magentic',
          edgeType: 'magentic_control',
        },
      ],
    };
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        agent_io_schema: {
          v3_state: {
            decks: { deck_builder: deck },
            deckRuns: {},
            meta: { decks: {} },
          },
        },
      }],
    });

    const result = await getDeckDocument('project-one', 'deck_builder');
    const edges = result.deck!.edges;
    expect(edges.find((edge) => edge.id === 'main-hermes-flow')).toEqual(expect.objectContaining({
      source: 'card_main_chat',
      sourceHandle: 'out-a',
      target: 'custom-hermes-card',
      targetHandle: 'in-a',
      edgeType: 'flow',
    }));
    expect(edges.find((edge) => edge.id === 'reversed')?.edgeType).toBe('flow');
    expect(edges.find((edge) => edge.id === 'invalid')?.edgeType).toBe('invalid');
    expect(edges.find((edge) => edge.id === 'unrelated')?.edgeType).toBe('flow');
  });
});
