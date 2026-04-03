import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, AgentTemplate, DeckDocument, DeckEdge, V3Blackboard } from '../types';

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

function createAgent(id: string, title: string, runtimeType: AgentCardInstance['runtimeType'] = 'assistant_agent'): AgentCardInstance {
  return {
    id,
    kind: 'agent',
    templateId: 'worker',
    title,
    prompt: '',
    position: { x: 0, y: 0 },
    runtimeType,
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

function edge(
  id: string,
  source: string,
  target: string,
  edgeType: DeckEdge['edgeType'] = 'graph_flow',
  metadata: DeckEdge['metadata'] = undefined,
): DeckEdge {
  return metadata ? { id, source, target, edgeType, metadata } : { id, source, target, edgeType };
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
        runtimeType: card.runtimeType ?? 'assistant_agent',
        inputSummary: input,
        outputSummary: `output:${card.id}`,
        blackboardWrite: null,
        blackboard: context.blackboard ?? null,
      };
    });
  });

  it('uses explicit orange graph_flow edges to determine top-level execution order', async () => {
    const deck = createDeckDocument(
      [createAgent('c', 'C'), createAgent('a', 'A'), createAgent('b', 'B')],
      [
        edge('edge_a_b', 'a', 'b', 'graph_flow'),
        edge('edge_b_c', 'b', 'c', 'graph_flow'),
      ],
    );

    const run = await executeDeck(deck, templates, { input: '' });

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['a', 'b', 'c']);
  });

  it('does not derive runnable edges from blackboard links', async () => {
    const board = createBlackboard();
    const run = await executeDeck(
      createDeckDocument(
        [createAgent('reader', 'Reader'), createAgent('writer', 'Writer'), board],
        [
          edge('edge_writer_board', 'writer', board.id, 'graph_flow'),
          edge('edge_board_reader', board.id, 'reader', 'graph_flow'),
        ],
      ),
      templates,
      { input: '' },
    );

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['reader', 'writer']);
    expect(runtimeHarness.calls.find((call) => call.cardId === 'reader')?.input).toBe('');
    expect(run.blackboard?.store).toEqual({ writer: 'output:writer' });
  });

  it('does not auto-run blue magentic_option targets as top-level deck steps', async () => {
    const deck = createDeckDocument(
      [
        createAgent('magentic', 'Magentic', 'magentic_one'),
        createAgent('assist_head', 'Assist Head', 'assistant_agent'),
      ],
      [edge('edge_magentic_head', 'magentic', 'assist_head', 'magentic_option')],
    );

    const run = await executeDeck(deck, templates, { input: 'route this' });

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['magentic']);
  });

  it('keeps graph-owned assist steps out of top-level deck scheduling', async () => {
    const graph = createAgent('graph_head', 'Graph Head', 'graph_flow');
    const stepA = createAgent('step_a', 'Step A', 'assistant_agent');
    stepA.parentGraphId = graph.id;
    const stepB = createAgent('step_b', 'Step B', 'assistant_agent');
    stepB.parentGraphId = graph.id;

    const run = await executeDeck(
      createDeckDocument(
        [graph, stepA, stepB],
        [edge('edge_step_a_step_b', 'step_a', 'step_b', 'graph_flow')],
      ),
      templates,
      { input: 'graph input' },
    );

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['graph_head']);
  });

  it('runs conditional edges only when a supported blackboard expression passes', async () => {
    const deck = createDeckDocument(
      [createAgent('entry', 'Entry'), createAgent('fresh_path', 'Fresh Path'), createAgent('stale_path', 'Stale Path')],
      [
        edge('edge_entry_fresh', 'entry', 'fresh_path', 'graph_flow'),
        edge(
          'edge_entry_stale',
          'entry',
          'stale_path',
          'graph_flow',
          {
            executionMode: 'conditional',
            conditionExpression: 'blackboard.store.stale === true',
          },
        ),
      ],
    );

    const run = await executeDeck(deck, templates, {
      input: 'check freshness',
      blackboard: { store: { stale: 'true' } } as V3Blackboard,
    });

    expect(run.status).toBe('success');
    expect(run.steps.filter((step) => step.status === 'success').map((step) => step.cardId)).toEqual([
      'entry',
      'fresh_path',
      'stale_path',
    ]);
    expect(run.steps.find((step) => step.cardId === 'stale_path')?.routeInfo?.notes || []).toContain(
      'Edge "edge_entry_stale": Conditional edge ran because blackboard.store.stale === true passed.',
    );
  });

  it('skips unsupported or false conditional routes without flattening the rest of the graph', async () => {
    const deck = createDeckDocument(
      [createAgent('entry', 'Entry'), createAgent('required_path', 'Required'), createAgent('conditional_path', 'Conditional')],
      [
        edge('edge_entry_required', 'entry', 'required_path', 'graph_flow'),
        edge(
          'edge_entry_conditional',
          'entry',
          'conditional_path',
          'graph_flow',
          {
            executionMode: 'conditional',
            conditionType: 'never',
          },
        ),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'branch test' });
    const stepByCardId = new Map(run.steps.map((step) => [step.cardId, step]));

    expect(run.status).toBe('success');
    expect(stepByCardId.get('entry')?.status).toBe('success');
    expect(stepByCardId.get('required_path')?.status).toBe('success');
    expect(stepByCardId.get('conditional_path')?.status).toBe('skipped');
    expect(stepByCardId.get('conditional_path')?.routeInfo?.notes || []).toContain(
      'Edge "edge_entry_conditional": Conditional edge skipped because conditionType=never.',
    );
  });

  it('waits only for required upstream inputs when optional routes are present', async () => {
    const deck = createDeckDocument(
      [
        createAgent('entry', 'Entry'),
        createAgent('required_branch', 'Required Branch'),
        createAgent('optional_branch', 'Optional Branch'),
        createAgent('join', 'Join'),
      ],
      [
        edge('edge_entry_required', 'entry', 'required_branch', 'graph_flow'),
        edge(
          'edge_entry_optional',
          'entry',
          'optional_branch',
          'graph_flow',
          { executionMode: 'optional' },
        ),
        edge(
          'edge_required_join',
          'required_branch',
          'join',
          'graph_flow',
          {
            executionMode: 'required',
            mergeIntent: 'all_inputs',
          },
        ),
        edge(
          'edge_optional_join',
          'optional_branch',
          'join',
          'graph_flow',
          {
            executionMode: 'optional',
            mergeIntent: 'all_inputs',
          },
        ),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'merge optional' });
    const joinStep = run.steps.find((step) => step.cardId === 'join');

    expect(run.status).toBe('success');
    expect(joinStep?.status).toBe('success');
    expect(joinStep?.routeInfo?.mergeIntent).toBe('all_inputs');
    expect(joinStep?.routeInfo?.notes || []).toContain('Merge policy all_inputs is active for this node.');
  });

  it('keeps legacy graph_flow edges on their existing unconditional all-inputs behavior', async () => {
    const deck = createDeckDocument(
      [createAgent('a', 'A'), createAgent('b', 'B'), createAgent('c', 'C')],
      [
        edge('edge_a_b', 'a', 'b', 'graph_flow'),
        edge('edge_b_c', 'b', 'c', 'graph_flow'),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'legacy path' });
    const stepB = run.steps.find((step) => step.cardId === 'b');

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['a', 'b', 'c']);
    expect(stepB?.routeInfo?.mergeIntent).toBe('legacy_default');
    expect(stepB?.routeInfo?.notes || []).toContain(
      'Merge policy used legacy graph_flow defaults because no edge metadata was present.',
    );
  });

  it('waits for all required upstream inputs before firing an all_inputs merge', async () => {
    const deck = createDeckDocument(
      [
        createAgent('entry', 'Entry'),
        createAgent('left', 'Left'),
        createAgent('right', 'Right'),
        createAgent('join', 'Join'),
      ],
      [
        edge('edge_entry_left', 'entry', 'left', 'graph_flow'),
        edge('edge_entry_right', 'entry', 'right', 'graph_flow'),
        edge('edge_left_join', 'left', 'join', 'graph_flow', { mergeIntent: 'all_inputs' }),
        edge('edge_right_join', 'right', 'join', 'graph_flow', { mergeIntent: 'all_inputs' }),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'wait for both' });

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['entry', 'left', 'right', 'join']);
    expect(runtimeHarness.calls.find((call) => call.cardId === 'join')?.input).toBe(
      ['output:left', 'output:right'].join('\n\n'),
    );
  });

  it('fires any_input on the first available upstream result', async () => {
    const deck = createDeckDocument(
      [
        createAgent('entry', 'Entry'),
        createAgent('left', 'Left'),
        createAgent('right', 'Right'),
        createAgent('join', 'Join'),
      ],
      [
        edge('edge_entry_left', 'entry', 'left', 'graph_flow'),
        edge('edge_entry_right', 'entry', 'right', 'graph_flow'),
        edge('edge_left_join', 'left', 'join', 'graph_flow', { mergeIntent: 'any_input' }),
        edge('edge_right_join', 'right', 'join', 'graph_flow', { mergeIntent: 'any_input' }),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'take any' });
    const joinStep = run.steps.find((step) => step.cardId === 'join');

    expect(run.status).toBe('success');
    expect(joinStep?.routeInfo?.mergeIntent).toBe('any_input');
    expect(joinStep?.routeInfo?.inputSources).toEqual([
      expect.objectContaining({
        sourceCardId: 'left',
        output: 'output:left',
      }),
    ]);
    expect(runtimeHarness.calls.find((call) => call.cardId === 'join')?.input).toBe('output:left');
  });

  it('fires first_success on the first successful upstream result', async () => {
    const deck = createDeckDocument(
      [
        createAgent('entry', 'Entry'),
        createAgent('left', 'Left'),
        createAgent('right', 'Right'),
        createAgent('join', 'Join'),
      ],
      [
        edge('edge_entry_left', 'entry', 'left', 'graph_flow'),
        edge('edge_entry_right', 'entry', 'right', 'graph_flow'),
        edge('edge_left_join', 'left', 'join', 'graph_flow', { mergeIntent: 'first_success' }),
        edge('edge_right_join', 'right', 'join', 'graph_flow', { mergeIntent: 'first_success' }),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'take first success' });
    const joinStep = run.steps.find((step) => step.cardId === 'join');

    expect(run.status).toBe('success');
    expect(joinStep?.routeInfo?.mergeIntent).toBe('first_success');
    expect(joinStep?.routeInfo?.inputSources).toEqual([
      expect.objectContaining({
        sourceCardId: 'left',
        output: 'output:left',
      }),
    ]);
    expect(runtimeHarness.calls.find((call) => call.cardId === 'join')?.input).toBe('output:left');
  });

  it('passes structured upstream inputs into summarize_all merges', async () => {
    const deck = createDeckDocument(
      [
        createAgent('entry', 'Entry'),
        createAgent('left', 'Left'),
        createAgent('right', 'Right'),
        createAgent('synth', 'Synth'),
      ],
      [
        edge('edge_entry_left', 'entry', 'left', 'graph_flow'),
        edge('edge_entry_right', 'entry', 'right', 'graph_flow'),
        edge('edge_left_synth', 'left', 'synth', 'graph_flow', { mergeIntent: 'summarize_all' }),
        edge('edge_right_synth', 'right', 'synth', 'graph_flow', { mergeIntent: 'summarize_all' }),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'summarize branches' });
    const synthCall = runtimeHarness.calls.find((call) => call.cardId === 'synth');
    const synthStep = run.steps.find((step) => step.cardId === 'synth');

    expect(run.status).toBe('success');
    expect(synthStep?.routeInfo?.mergeIntent).toBe('summarize_all');
    expect(synthStep?.routeInfo?.inputMode).toBe('structured_merge');
    expect(synthCall?.input || '').toContain('"type": "deck_merge_input"');
    expect(synthCall?.input || '').toContain('"mergeIntent": "summarize_all"');
    expect(synthCall?.input || '').toContain('"sourceCardId": "left"');
    expect(synthCall?.input || '').toContain('"sourceCardId": "right"');
  });

  it('keeps runtime behavior explainable from visible graph edges and active metadata only', async () => {
    const deck = createDeckDocument(
      [
        createAgent('entry', 'Entry'),
        createAgent('left', 'Left'),
        createAgent('right', 'Right'),
        createAgent('merge', 'Merge'),
      ],
      [
        edge('edge_entry_left', 'entry', 'left', 'graph_flow'),
        edge(
          'edge_entry_right',
          'entry',
          'right',
          'graph_flow',
          { executionMode: 'conditional', conditionType: 'never' },
        ),
        edge('edge_left_merge', 'left', 'merge', 'graph_flow', { mergeIntent: 'all_inputs' }),
        edge('edge_right_merge', 'right', 'merge', 'graph_flow', { mergeIntent: 'all_inputs' }),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'visible only' });
    const mergeStep = run.steps.find((step) => step.cardId === 'merge');
    const rightStep = run.steps.find((step) => step.cardId === 'right');

    expect(run.status).toBe('success');
    expect(rightStep?.status).toBe('skipped');
    expect(mergeStep?.routeInfo?.inputSources).toEqual([
      expect.objectContaining({
        sourceCardId: 'left',
      }),
    ]);
    expect((mergeStep?.routeInfo?.notes || []).join('\n')).not.toContain('hidden');
  });
});
