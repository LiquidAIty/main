import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, AgentTemplate, DeckDocument, DeckEdge } from '../types';

const runtimeHarness = vi.hoisted(() => ({
  calls: [] as Array<{ cardId: string; input: string; context: Record<string, unknown> }>,
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

function edge(
  id: string,
  source: string,
  target: string,
  edgeType: DeckEdge['edgeType'] = 'flow',
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
      context: Record<string, unknown>,
    ) => {
      runtimeHarness.calls.push({ cardId: card.id, input, context });
      return {
        output: `output:${card.id}`,
        status: 'success',
        startedAt: '2026-03-27T00:00:00.000Z',
        endedAt: '2026-03-27T00:00:01.000Z',
        runtimeBinding: card.runtimeBinding ?? null,
        runtimeType: card.runtimeType ?? 'assistant_agent',
        inputSummary: input,
        outputSummary: `output:${card.id}`,
      };
    });
  });

  it('uses explicit flow edges to determine top-level execution order', async () => {
    const deck = createDeckDocument(
      [createAgent('c', 'C'), createAgent('a', 'A'), createAgent('b', 'B')],
      [
        edge('edge_a_b', 'a', 'b', 'flow'),
        edge('edge_b_c', 'b', 'c', 'flow'),
      ],
    );

    const run = await executeDeck(deck, templates, { input: '' });

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['a', 'b', 'c']);
  });

  it('normalizes compact workspace object context for card runtime calls and run snapshots', async () => {
    const deck = createDeckDocument([createAgent('a', 'A')], []);
    const run = await executeDeck(deck, templates, {
      input: 'context test',
      workspaceObjectContext: {
        activeSurface: 'canvas',
        workspaceView: 'canvas',
        selectedObjectId: 'card_a',
        selectedObjectType: 'assistant_agent',
        selectedObjectTitle: 'A',
        selectedText: 'x'.repeat(260),
        openObjectSummary: 'y'.repeat(420),
        activeMagenticParticipants: Array.from({ length: 14 }, (_, index) => `Participant ${index}`),
        availableCanvasAgents: ['A', 'A', 'B'],
        excludedAgents: ['Local Coder'],
      },
    });

    const context = runtimeHarness.calls[0]?.context.workspaceObjectContext as any;
    expect(context.selectedText).toHaveLength(240);
    expect(context.openObjectSummary).toHaveLength(400);
    expect(context.activeMagenticParticipants).toHaveLength(12);
    expect(context.availableCanvasAgents).toEqual(['A', 'B']);
    expect(run.workspaceObjectContext).toEqual(context);
  });

  it('ignores legacy blackboard nodes in visible flow routing', async () => {
    const board = {
      id: 'node_blackboard',
      kind: 'blackboard',
      templateId: 'blackboard',
      title: 'Blackboard',
      prompt: '',
      position: { x: 0, y: 0 },
    } as unknown as AgentCardInstance;
    const run = await executeDeck(
      createDeckDocument(
        [createAgent('reader', 'Reader'), createAgent('writer', 'Writer'), board],
        [
          edge('edge_writer_board', 'writer', board.id, 'flow'),
          edge('edge_board_reader', board.id, 'reader', 'flow'),
        ],
      ),
      templates,
      { input: '' },
    );

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId).sort()).toEqual(['reader', 'writer']);
    expect(runtimeHarness.calls.find((call) => call.cardId === 'reader')?.input).toBe('');
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

  it('treats python_autogen Magentic-One as the run boundary before legacy flow edges', async () => {
    const magentic = createAgent('magentic', 'Magentic', 'magentic_one');
    magentic.runtimeOptions = { executionBackend: 'python_autogen' };
    const deck = createDeckDocument(
      [
        magentic,
        createAgent('legacy_next', 'Legacy Next', 'assistant_agent'),
        createAgent('assist_head', 'Assist Head', 'assistant_agent'),
      ],
      [
        edge('edge_magentic_head', 'magentic', 'assist_head', 'magentic_option'),
        edge('edge_magentic_legacy_next', 'magentic', 'legacy_next', 'flow'),
      ],
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
        [edge('edge_step_a_step_b', 'step_a', 'step_b', 'flow')],
      ),
      templates,
      { input: 'graph input' },
    );

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['graph_head']);
  });

  it('preserves legacy condition expressions as inert metadata instead of executing them', async () => {
    const deck = createDeckDocument(
      [createAgent('entry', 'Entry'), createAgent('fresh_path', 'Fresh Path'), createAgent('stale_path', 'Stale Path')],
      [
        edge('edge_entry_fresh', 'entry', 'fresh_path', 'flow'),
        edge(
          'edge_entry_stale',
          'entry',
          'stale_path',
          'flow',
          {
            executionMode: 'conditional',
            conditionExpression: 'blackboard.store.stale === true',
          },
        ),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'check freshness' });

    expect(run.status).toBe('success');
    expect(run.steps.filter((step) => step.status === 'success').map((step) => step.cardId)).toEqual([
      'entry',
      'fresh_path',
    ]);
    expect(run.steps.find((step) => step.cardId === 'stale_path')?.status).toBe('skipped');
    expect(run.steps.find((step) => step.cardId === 'stale_path')?.routeInfo?.notes || []).toContain(
      'Edge "edge_entry_stale": Conditional edge skipped because expression "blackboard.store.stale === true" is preserved-only legacy metadata in this runtime.',
    );
  });

  it('skips unsupported or false conditional routes without flattening the rest of the graph', async () => {
    const deck = createDeckDocument(
      [createAgent('entry', 'Entry'), createAgent('required_path', 'Required'), createAgent('conditional_path', 'Conditional')],
      [
        edge('edge_entry_required', 'entry', 'required_path', 'flow'),
        edge(
          'edge_entry_conditional',
          'entry',
          'conditional_path',
          'flow',
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
        edge('edge_entry_required', 'entry', 'required_branch', 'flow'),
        edge(
          'edge_entry_optional',
          'entry',
          'optional_branch',
          'flow',
          { executionMode: 'optional' },
        ),
        edge(
          'edge_required_join',
          'required_branch',
          'join',
          'flow',
          {
            executionMode: 'required',
            mergeIntent: 'all_inputs',
          },
        ),
        edge(
          'edge_optional_join',
          'optional_branch',
          'join',
          'flow',
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

  it('keeps legacy flow edges on their existing unconditional all-inputs behavior', async () => {
    const deck = createDeckDocument(
      [createAgent('a', 'A'), createAgent('b', 'B'), createAgent('c', 'C')],
      [
        edge('edge_a_b', 'a', 'b', 'flow'),
        edge('edge_b_c', 'b', 'c', 'flow'),
      ],
    );

    const run = await executeDeck(deck, templates, { input: 'legacy path' });
    const stepB = run.steps.find((step) => step.cardId === 'b');

    expect(run.status).toBe('success');
    expect(run.steps.map((step) => step.cardId)).toEqual(['a', 'b', 'c']);
    expect(stepB?.routeInfo?.mergeIntent).toBe('legacy_default');
    expect(stepB?.routeInfo?.notes || []).toContain(
      'Merge policy used legacy flow defaults because no edge metadata was present.',
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
        edge('edge_entry_left', 'entry', 'left', 'flow'),
        edge('edge_entry_right', 'entry', 'right', 'flow'),
        edge('edge_left_join', 'left', 'join', 'flow', { mergeIntent: 'all_inputs' }),
        edge('edge_right_join', 'right', 'join', 'flow', { mergeIntent: 'all_inputs' }),
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
        edge('edge_entry_left', 'entry', 'left', 'flow'),
        edge('edge_entry_right', 'entry', 'right', 'flow'),
        edge('edge_left_join', 'left', 'join', 'flow', { mergeIntent: 'any_input' }),
        edge('edge_right_join', 'right', 'join', 'flow', { mergeIntent: 'any_input' }),
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
        edge('edge_entry_left', 'entry', 'left', 'flow'),
        edge('edge_entry_right', 'entry', 'right', 'flow'),
        edge('edge_left_join', 'left', 'join', 'flow', { mergeIntent: 'first_success' }),
        edge('edge_right_join', 'right', 'join', 'flow', { mergeIntent: 'first_success' }),
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
        edge('edge_entry_left', 'entry', 'left', 'flow'),
        edge('edge_entry_right', 'entry', 'right', 'flow'),
        edge('edge_left_synth', 'left', 'synth', 'flow', { mergeIntent: 'summarize_all' }),
        edge('edge_right_synth', 'right', 'synth', 'flow', { mergeIntent: 'summarize_all' }),
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
        edge('edge_entry_left', 'entry', 'left', 'flow'),
        edge(
          'edge_entry_right',
          'entry',
          'right',
          'flow',
          { executionMode: 'conditional', conditionType: 'never' },
        ),
        edge('edge_left_merge', 'left', 'merge', 'flow', { mergeIntent: 'all_inputs' }),
        edge('edge_right_merge', 'right', 'merge', 'flow', { mergeIntent: 'all_inputs' }),
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
