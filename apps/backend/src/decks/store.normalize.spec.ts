import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/pool', () => ({
  pool: { query: dbMocks.query },
}));

import {
  getDeckDocument,
  normalizeRuntimeOptions,
  saveDeckDocument,
  validateDeckIntegrityTransition,
  validateDeckRelationshipTransition,
} from './store';

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

describe('deck store Hermes observation compatibility', () => {
  it('upgrades only the historical directed Main-to-Hermes flow edge', async () => {
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
          id: 'legacy-authority',
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
    expect(edges.find((edge) => edge.id === 'legacy-authority')).toEqual(expect.objectContaining({
      source: 'card_main_chat',
      sourceHandle: 'out-a',
      target: 'custom-hermes-card',
      targetHandle: 'in-a',
      edgeType: 'hermes_observe',
      metadata: expect.objectContaining({ legacyCompatibility: true }),
    }));
    expect(edges.find((edge) => edge.id === 'reversed')?.edgeType).toBe('flow');
    expect(edges.find((edge) => edge.id === 'invalid')?.edgeType).toBe('invalid');
    expect(edges.find((edge) => edge.id === 'unrelated')?.edgeType).toBe('flow');
  });
});

describe('deck save concurrency and integrity', () => {
  const currentDeck = {
    id: 'deck_custom',
    name: 'Custom',
    version: 1,
    promptTemplates: [],
    nodes: [
      {
        id: 'worker',
        kind: 'agent',
        title: 'Worker',
        runtimeType: 'assistant_agent',
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  } as any;

  function mockCurrentDeck(revision = 'server-newer') {
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        agent_io_schema: {
          v3_state: {
            decks: { deck_custom: currentDeck },
            deckRuns: {},
            meta: { decks: { deck_custom: { revision, savedAt: null } } },
          },
        },
      }],
    });
  }

  it('rejects a stale revision before issuing any database update', async () => {
    mockCurrentDeck();
    await expect(
      saveDeckDocument('project-one', 'deck_custom', currentDeck, {
        expectedRevision: 'client-stale',
      }),
    ).rejects.toThrow('deck_conflict');
    expect(dbMocks.query).toHaveBeenCalledTimes(1);
    expect(String(dbMocks.query.mock.calls[0][0])).toContain('SELECT agent_io_schema');
  });

  it('rejects a missing revision so a conflicted client cannot retry unconditionally', async () => {
    mockCurrentDeck();
    await expect(
      saveDeckDocument('project-one', 'deck_custom', currentDeck, {
        expectedRevision: null,
      }),
    ).rejects.toThrow('deck_revision_required');
    expect(dbMocks.query).toHaveBeenCalledTimes(1);
    expect(String(dbMocks.query.mock.calls[0][0])).not.toContain('UPDATE');
  });

  it('rejects unexplained one-card disappearance and accepts exact confirmed intent', () => {
    const nextDeck = { ...currentDeck, nodes: [] };
    expect(() => validateDeckIntegrityTransition(currentDeck, nextDeck)).toThrow(
      'deck_integrity_empty_nodes_blocked',
    );

    const currentWithTwo = {
      ...currentDeck,
      nodes: [...currentDeck.nodes, { ...currentDeck.nodes[0], id: 'other' }],
    };
    const nextWithOne = { ...currentWithTwo, nodes: [currentWithTwo.nodes[0]] };
    expect(() => validateDeckIntegrityTransition(currentWithTwo, nextWithOne)).toThrow(
      'deck_integrity_unexplained_node_removal_blocked',
    );
    expect(() =>
      validateDeckIntegrityTransition(currentWithTwo, nextWithOne, {
        reason: 'canvas:delete-card-confirmed',
        removedNodeIds: ['other'],
      }),
    ).not.toThrow();
  });
});

describe('deck semantic relationship validation', () => {
  const nodes = [
    { id: 'main', kind: 'agent', runtimeBinding: 'main_chat', runtimeType: 'assistant_agent', title: 'Main', position: { x: 0, y: 0 } },
    { id: 'mag', kind: 'agent', runtimeType: 'magentic_one', title: 'Mag', position: { x: 100, y: 0 } },
    { id: 'coder', kind: 'agent', runtimeBinding: 'local_coder', runtimeType: 'local_coder', title: 'Coder', position: { x: 200, y: 0 } },
  ] as any;

  it('accepts canonical membership and directional calls', () => {
    expect(() => validateDeckRelationshipTransition(null, {
      id: 'deck', name: 'Deck', version: 1, promptTemplates: [], nodes,
      edges: [
        { id: 'member', source: 'mag', sourceHandle: 'magone-member-right-1', target: 'coder', targetHandle: 'magone-member-left', edgeType: 'magentic_option' },
        { id: 'call', source: 'main', sourceHandle: 'call-out', target: 'coder', targetHandle: 'call-in', edgeType: 'flow' },
      ],
    } as any)).not.toThrow();
  });

  it('rejects reversed handle semantics and noncanonical membership direction', () => {
    expect(() => validateDeckRelationshipTransition(null, {
      id: 'deck', name: 'Deck', version: 1, promptTemplates: [], nodes,
      edges: [
        { id: 'bad', source: 'coder', sourceHandle: 'magone-member-right', target: 'mag', targetHandle: 'magone-member-left-1', edgeType: 'magentic_option' },
      ],
    } as any)).toThrow('deck_relationship_invalid');
  });
});
