import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, AgentTemplate, DeckDocument, V3Blackboard } from '../types';

const runtimeHarness = vi.hoisted(() => ({
  calls: [] as Array<{ cardId: string; input: string }>,
  runCardWithContract: vi.fn(),
}));

vi.mock('../cards/runtime', async () => {
  const actual = await vi.importActual<typeof import('../cards/runtime')>('../cards/runtime');
  return {
    ...actual,
    runCardWithContract: runtimeHarness.runCardWithContract,
  };
});

import { executeDeck } from './deckRuntime';

const templates: AgentTemplate[] = [
  {
    id: 'worker',
    name: 'Worker',
    tools: [],
  },
  {
    id: 'blackboard',
    name: 'Blackboard',
    tools: [],
  },
];

function createAgent(id: string, title: string): AgentCardInstance {
  return {
    id,
    kind: 'agent',
    templateId: 'worker',
    title,
    prompt: '',
    position: { x: 0, y: 0 },
  };
}

function createBlackboard(id = 'node_blackboard'): AgentCardInstance {
  return {
    id,
    kind: 'blackboard',
    templateId: 'blackboard',
    title: 'Blackboard',
    prompt: '',
    position: { x: 0, y: 0 },
  };
}

function createDeckDocument(
  nodes: AgentCardInstance[],
  edges: DeckDocument['edges'],
): DeckDocument {
  return {
    id: 'deck_test',
    name: 'Deck Test',
    promptTemplates: [],
    version: 1,
    nodes,
    edges,
  };
}

describe('executeDeck', () => {
  beforeEach(() => {
    runtimeHarness.calls.length = 0;
    runtimeHarness.runCardWithContract.mockReset();
    runtimeHarness.runCardWithContract.mockImplementation(async (
      card: AgentCardInstance,
      _agent: AgentTemplate,
      input: string,
      context: { blackboard?: V3Blackboard | null },
    ) => {
      runtimeHarness.calls.push({ cardId: card.id, input });
      return {
        output: `output:${card.id}`,
        status: 'success',
        startedAt: '2026-03-27T00:00:00.000Z',
        endedAt: '2026-03-27T00:00:01.000Z',
        runtimeBinding: card.runtimeBinding ?? null,
        inputSummary: input,
        outputSummary: `output:${card.id}`,
        blackboardWrite: null,
        blackboard: context.blackboard ?? null,
      };
    });
  });

  it('uses drawn links to determine execution order', async () => {
    const deck = createDeckDocument(
      [createAgent('c', 'C'), createAgent('a', 'A'), createAgent('b', 'B')],
      [
        { id: 'edge_a_b', source: 'a', target: 'b' },
        { id: 'edge_b_c', source: 'b', target: 'c' },
      ],
    );

    const run = await executeDeck(deck, templates, { input: '' });

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['a', 'b', 'c']);
  });

  it('changes execution order when a drawn link is deleted', async () => {
    const deck = createDeckDocument(
      [createAgent('c', 'C'), createAgent('a', 'A'), createAgent('b', 'B')],
      [{ id: 'edge_a_b', source: 'a', target: 'b' }],
    );

    const run = await executeDeck(deck, templates, { input: '' });

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['c', 'a', 'b']);
  });

  it('updates execution order when a visible link is rewired', async () => {
    const originalDeck = createDeckDocument(
      [createAgent('c', 'C'), createAgent('a', 'A'), createAgent('b', 'B')],
      [
        { id: 'edge_c_a', source: 'c', target: 'a' },
        { id: 'edge_a_b', source: 'a', target: 'b' },
      ],
    );
    const rewiredDeck = createDeckDocument(
      [createAgent('c', 'C'), createAgent('a', 'A'), createAgent('b', 'B')],
      [
        { id: 'edge_c_a', source: 'c', target: 'a' },
        { id: 'edge_a_b', source: 'b', target: 'a' },
      ],
    );

    const originalRun = await executeDeck(originalDeck, templates, { input: '' });
    const rewiredRun = await executeDeck(rewiredDeck, templates, { input: '' });

    expect(originalRun.status).toBe('success');
    expect(originalRun.steps.map((step) => step.cardId)).toEqual(['c', 'a', 'b']);
    expect(rewiredRun.status).toBe('success');
    expect(rewiredRun.steps.map((step) => step.cardId)).toEqual(['c', 'b', 'a']);
  });

  it('reads and writes blackboard only through visible links', async () => {
    const board = createBlackboard();

    const fullyLinkedRun = await executeDeck(
      createDeckDocument(
        [createAgent('reader', 'Reader'), createAgent('writer', 'Writer'), board],
        [
          { id: 'edge_writer_board', source: 'writer', target: board.id },
          { id: 'edge_board_reader', source: board.id, target: 'reader' },
        ],
      ),
      templates,
      { input: '' },
    );

    expect(fullyLinkedRun.steps.map((step) => step.cardId)).toEqual(['writer', 'reader']);
    expect(runtimeHarness.calls.find((call) => call.cardId === 'reader')?.input).toBe(
      'writer:\noutput:writer',
    );
    expect(fullyLinkedRun.blackboard?.store).toEqual({ writer: 'output:writer' });
    runtimeHarness.calls.length = 0;

    const noVisibleWriteRun = await executeDeck(
      createDeckDocument(
        [createAgent('reader', 'Reader'), createAgent('writer', 'Writer'), board],
        [{ id: 'edge_board_reader', source: board.id, target: 'reader' }],
      ),
      templates,
      { input: '' },
    );

    expect(runtimeHarness.calls.find((call) => call.cardId === 'reader')?.input).toBe('');
    expect(noVisibleWriteRun.blackboard?.store || {}).toEqual({});
    runtimeHarness.calls.length = 0;

    const noVisibleReadRun = await executeDeck(
      createDeckDocument(
        [createAgent('reader', 'Reader'), createAgent('writer', 'Writer'), board],
        [{ id: 'edge_writer_board', source: 'writer', target: board.id }],
      ),
      templates,
      { input: '' },
    );

    expect(runtimeHarness.calls.find((call) => call.cardId === 'reader')?.input).toBe('');
    expect(noVisibleReadRun.blackboard?.store).toEqual({ writer: 'output:writer' });
  });

  it('runs the assist starter spine through visible links only and only writes blackboard when the sink link exists', async () => {
    const board = createBlackboard();
    const starterNodes = [
      createAgent('main_chat', 'Main Chat'),
      createAgent('thinkgraph', 'ThinkGraph / Extract'),
      createAgent('research', 'Research Worker'),
      createAgent('summary', 'Summary Step'),
      board,
    ];

    const starterRun = await executeDeck(
      createDeckDocument(starterNodes, [
        { id: 'edge_main_chat_thinkgraph', source: 'main_chat', target: 'thinkgraph' },
        { id: 'edge_thinkgraph_research', source: 'thinkgraph', target: 'research' },
        { id: 'edge_research_summary', source: 'research', target: 'summary' },
        { id: 'edge_summary_board', source: 'summary', target: board.id },
      ]),
      templates,
      { input: 'user input' },
    );

    expect(starterRun.status).toBe('success');
    expect(starterRun.steps.map((step) => step.cardId)).toEqual([
      'main_chat',
      'thinkgraph',
      'research',
      'summary',
    ]);
    expect(starterRun.blackboard?.store).toEqual({ summary: 'output:summary' });
    runtimeHarness.calls.length = 0;

    const noBoardSinkRun = await executeDeck(
      createDeckDocument(starterNodes, [
        { id: 'edge_main_chat_thinkgraph', source: 'main_chat', target: 'thinkgraph' },
        { id: 'edge_thinkgraph_research', source: 'thinkgraph', target: 'research' },
        { id: 'edge_research_summary', source: 'research', target: 'summary' },
      ]),
      templates,
      { input: 'user input' },
    );

    expect(noBoardSinkRun.status).toBe('success');
    expect(noBoardSinkRun.steps.map((step) => step.cardId)).toEqual([
      'main_chat',
      'thinkgraph',
      'research',
      'summary',
    ]);
    expect(noBoardSinkRun.blackboard?.store || {}).toEqual({});
  });

  it('ignores legacy node policy payloads and keeps execution driven by visible links only', async () => {
    const legacyPolicyNode = {
      ...createAgent('a', 'A'),
      runtimePolicy: {
        inputSources: {
          user_input: false,
          previous_output: false,
          blackboard: true,
        },
        blackboardReadFields: ['findings'],
        blackboardWriteFields: ['next_move'],
        nextMoveAuthority: false,
      },
    } as AgentCardInstance;

    const deck = createDeckDocument(
      [
        legacyPolicyNode,
        createAgent('b', 'B'),
        createAgent('c', 'C'),
      ],
      [
        { id: 'edge_a_b', source: 'a', target: 'b' },
        { id: 'edge_b_c', source: 'b', target: 'c' },
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'user input' });

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['a', 'b', 'c']);
    expect(runtimeHarness.calls.map((call) => call.input)).toEqual([
      'user input',
      'output:a',
      'output:b',
    ]);
  });
});
