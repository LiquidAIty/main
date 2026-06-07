import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, AgentTemplate, DeckEdge } from '../types';

const llmHarness = vi.hoisted(() => ({
  runLLM: vi.fn(),
}));

const registryHarness = vi.hoisted(() => ({
  getTool: vi.fn(),
}));

const autogenHarness = vi.hoisted(() => ({
  orchestrateWithAutoGen: vi.fn(),
}));

vi.mock('../../llm/client', () => ({
  runLLM: llmHarness.runLLM,
}));

vi.mock('../../agents/registry', () => ({
  getTool: registryHarness.getTool,
}));

vi.mock('../../services/autogen/autogenOrchestratorClient', () => ({
  orchestrateWithAutoGen: autogenHarness.orchestrateWithAutoGen,
}));

import { resolveEffectiveAgent, runCardWithContract } from './runtime';

const templates: AgentTemplate[] = [
  {
    id: 'worker',
    name: 'Worker',
    model: 'gpt-5.1-chat-latest',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
];

function createCard(
  id: string,
  runtimeType: AgentCardInstance['runtimeType'] = 'assistant_agent',
): AgentCardInstance {
  return {
    id,
    kind: 'agent',
    templateId: 'worker',
    title: id,
    prompt: `Prompt for ${id}`,
    position: { x: 0, y: 0 },
    runtimeType,
    runtimeOptions: {},
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

describe('runCardWithContract runtime dispatch', () => {
  beforeEach(() => {
    llmHarness.runLLM.mockReset();
    registryHarness.getTool.mockReset();
    autogenHarness.orchestrateWithAutoGen.mockReset();
  });

  it('runs assistant_agent cards on the local single-agent path', async () => {
    const card = createCard('assistant_card', 'assistant_agent');
    card.runtimeBinding = 'main_chat';
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');
    llmHarness.runLLM.mockResolvedValue({
      text: 'assistant output',
      model: 'gpt-5.1-chat-latest',
      provider: 'openai',
      responseId: null,
    });

    const result = await runCardWithContract(card, effective, 'hello world', {
      userInput: 'hello world',
    });

    expect(result.status).toBe('success');
    expect(result.runtimeType).toBe('assistant_agent');
    expect(result.runtimeBinding).toBe('main_chat');
    expect(result.output).toBe('assistant output');
    expect(llmHarness.runLLM).toHaveBeenCalledTimes(1);
  });

  it('runs configured assist tools through the tool-capable runtime path', async () => {
    const card = createCard('assistant_tool_card', 'assistant_agent');
    card.overrides = { tools: ['openai'] };
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');
    const toolRun = vi.fn().mockResolvedValue({
      ok: true,
      output: 'tool result payload',
    });
    registryHarness.getTool.mockReturnValue({
      id: 'openai',
      name: 'OpenAI',
      run: toolRun,
    });
    llmHarness.runLLM.mockResolvedValue({
      text: 'final answer using tool output',
      model: 'gpt-5.1-chat-latest',
      provider: 'openai',
      responseId: null,
    });

    const result = await runCardWithContract(card, effective, 'use the tool', {
      userInput: 'use the tool',
      projectId: 'project_test',
      deckId: 'deck_test',
    });

    expect(result.status).toBe('success');
    expect(result.output).toBe('final answer using tool output');
    expect(toolRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'use the tool',
        cardId: 'assistant_tool_card',
        projectId: 'project_test',
        deckId: 'deck_test',
      }),
    );
    expect(llmHarness.runLLM).toHaveBeenCalledTimes(1);
  });

  it('emits raw tool and assistant message events when real text exists', async () => {
    const card = createCard('assistant_tool_card', 'assistant_agent');
    card.overrides = { tools: ['openai'] };
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');
    const events: Array<Record<string, unknown>> = [];
    const toolRun = vi.fn().mockResolvedValue({
      ok: true,
      output: 'tool result payload',
    });
    registryHarness.getTool.mockReturnValue({
      id: 'openai',
      name: 'OpenAI',
      run: toolRun,
    });
    llmHarness.runLLM.mockResolvedValue({
      text: 'final answer using tool output',
      model: 'gpt-5.1-chat-latest',
      provider: 'openai',
      responseId: null,
    });

    const result = await runCardWithContract(card, effective, 'use the tool', {
      userInput: 'use the tool',
      projectId: 'project_test',
      deckId: 'deck_test',
      onRuntimeEvent: (event) => events.push(event as unknown as Record<string, unknown>),
    });

    expect(result.status).toBe('success');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'message',
          type: 'message',
          cardId: 'assistant_tool_card',
          role: 'tool',
          content: 'tool result payload',
        }),
        expect.objectContaining({
          kind: 'message',
          type: 'message',
          cardId: 'assistant_tool_card',
          role: 'assistant',
          content: 'final answer using tool output',
        }),
      ]),
    );
  });

  it('fails clear when an assist tool is unsupported', async () => {
    const card = createCard('assistant_bad_tool', 'assistant_agent');
    card.overrides = { tools: ['graph_lookup'] };
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');
    registryHarness.getTool.mockReturnValue(undefined);

    const result = await runCardWithContract(card, effective, 'bad tool input', {
      userInput: 'bad tool input',
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('assistant_tool_not_supported');
    expect(llmHarness.runLLM).not.toHaveBeenCalled();
  });

  it('fails legacy participant-driven runtimes instead of executing hidden members', async () => {
    const card = createCard('selector_team', 'assistant_agent');
    (card as any).runtimeType = 'selector';
    (card as any).participants = [{ cardId: 'worker_a' }];
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');

    const result = await runCardWithContract(card, effective, 'legacy input', {
      userInput: 'legacy input',
      allCards: [card, createCard('worker_a')],
      allTemplates: templates,
    });

    expect(result.status).toBe('error');
    expect(result.runtimeType).toBe('selector');
    expect(result.error).toContain('team_runtime_not_supported');
    expect(llmHarness.runLLM).not.toHaveBeenCalled();
  });

  it('runs assistant_agent swarm mode and returns one consolidated output', async () => {
    const card = createCard('swarm_worker', 'assistant_agent');
    card.runtimeOptions = {
      executionMode: 'swarm',
      swarmMaxWorkers: 2,
      useSocietyOfMindConsolidation: true,
    };
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');

    llmHarness.runLLM
      .mockResolvedValueOnce({ text: 'worker angle one' })
      .mockResolvedValueOnce({ text: 'worker angle two' })
      .mockResolvedValueOnce({ text: 'clean consolidated swarm answer' });

    const result = await runCardWithContract(card, effective, 'swarm input', {
      userInput: 'swarm input',
    });

    expect(result.status).toBe('success');
    expect(result.runtimeType).toBe('assistant_agent');
    expect(result.output).toBe('clean consolidated swarm answer');
    expect(llmHarness.runLLM).toHaveBeenCalledTimes(3);
  });

  it('runs assist swarm mode with configured tools and still returns one consolidated output', async () => {
    const card = createCard('swarm_tool_worker', 'assistant_agent');
    card.runtimeOptions = {
      executionMode: 'swarm',
      swarmMaxWorkers: 2,
      useSocietyOfMindConsolidation: true,
    };
    card.overrides = { tools: ['openai'] };
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');
    const toolRun = vi.fn().mockResolvedValue({
      ok: true,
      output: 'tool worker payload',
    });
    registryHarness.getTool.mockReturnValue({
      id: 'openai',
      name: 'OpenAI',
      run: toolRun,
    });

    llmHarness.runLLM
      .mockResolvedValueOnce({ text: 'worker answer one' })
      .mockResolvedValueOnce({ text: 'worker answer two' })
      .mockResolvedValueOnce({ text: 'clean consolidated swarm tool answer' });

    const result = await runCardWithContract(card, effective, 'swarm tool input', {
      userInput: 'swarm tool input',
    });

    expect(result.status).toBe('success');
    expect(result.output).toBe('clean consolidated swarm tool answer');
    expect(toolRun).toHaveBeenCalledTimes(2);
    expect(llmHarness.runLLM).toHaveBeenCalledTimes(3);
  });

  it('runs graph_flow from visible orange step cards and returns one consolidated output', async () => {
    const graph = createCard('graph_head', 'graph_flow');
    graph.runtimeOptions = { useSocietyOfMindConsolidation: true };

    const stepA = createCard('step_a', 'assistant_agent');
    stepA.parentGraphId = graph.id;
    const stepB = createCard('step_b', 'assistant_agent');
    stepB.parentGraphId = graph.id;

    const effectiveGraph = resolveEffectiveAgent(graph, templates);
    if (!effectiveGraph) throw new Error('missing_effective_agent');

    llmHarness.runLLM
      .mockResolvedValueOnce({ text: 'step A output' })
      .mockResolvedValueOnce({ text: 'step B output' })
      .mockResolvedValueOnce({ text: 'graph consolidated output' });

    const result = await runCardWithContract(graph, effectiveGraph, 'graph input', {
      userInput: 'graph input',
      allCards: [graph, stepA, stepB],
      allEdges: [edge('edge_a_b', 'step_a', 'step_b', 'flow')],
      allTemplates: templates,
    });

    expect(result.status).toBe('success');
    expect(result.runtimeType).toBe('graph_flow');
    expect(result.output).toBe('graph consolidated output');
    expect(llmHarness.runLLM).toHaveBeenCalledTimes(3);
  });

  it('passes structured summarize_all inputs through the graph_flow runtime', async () => {
    const graph = createCard('graph_head', 'graph_flow');
    graph.runtimeOptions = { useSocietyOfMindConsolidation: true };

    const stepLeft = createCard('step_left', 'assistant_agent');
    stepLeft.parentGraphId = graph.id;
    const stepRight = createCard('step_right', 'assistant_agent');
    stepRight.parentGraphId = graph.id;
    const stepMerge = createCard('step_merge', 'assistant_agent');
    stepMerge.parentGraphId = graph.id;

    const effectiveGraph = resolveEffectiveAgent(graph, templates);
    if (!effectiveGraph) throw new Error('missing_effective_agent');

    llmHarness.runLLM
      .mockResolvedValueOnce({ text: 'left output' })
      .mockResolvedValueOnce({ text: 'right output' })
      .mockResolvedValueOnce({ text: 'merged output' })
      .mockResolvedValueOnce({ text: 'graph summarized output' });

    const result = await runCardWithContract(graph, effectiveGraph, 'graph summarize input', {
      userInput: 'graph summarize input',
      allCards: [graph, stepLeft, stepRight, stepMerge],
      allEdges: [
        edge('edge_left_merge', 'step_left', 'step_merge', 'flow', { mergeIntent: 'summarize_all' }),
        edge('edge_right_merge', 'step_right', 'step_merge', 'flow', { mergeIntent: 'summarize_all' }),
      ],
      allTemplates: templates,
    });

    const mergeInput = llmHarness.runLLM.mock.calls[2]?.[0];

    expect(result.status).toBe('success');
    expect(result.runtimeType).toBe('graph_flow');
    expect(String(mergeInput || '')).toContain('"type": "deck_merge_input"');
    expect(String(mergeInput || '')).toContain('"mergeIntent": "summarize_all"');
    expect(String(mergeInput || '')).toContain('"sourceCardId": "step_left"');
    expect(String(mergeInput || '')).toContain('"sourceCardId": "step_right"');
  });

  it('uses blue callable heads for magentic_one instead of hidden participants', async () => {
    const magentic = createCard('magentic', 'magentic_one');
    const head = createCard('assist_head', 'assistant_agent');
    const effectiveMagentic = resolveEffectiveAgent(magentic, templates);
    if (!effectiveMagentic) throw new Error('missing_effective_agent');

    autogenHarness.orchestrateWithAutoGen.mockResolvedValueOnce({
      ok: true,
      finalResponseText: 'head output',
    });

    const result = await runCardWithContract(magentic, effectiveMagentic, 'route this', {
      userInput: 'route this',
      allCards: [magentic, head],
      allEdges: [edge('edge_magentic_head', 'magentic', 'assist_head', 'magentic_option')],
      allTemplates: templates,
    });

    expect(result.status).toBe('success');
    expect(result.runtimeType).toBe('magentic_one');
    expect(result.output).toBe('head output');
    expect(autogenHarness.orchestrateWithAutoGen).toHaveBeenCalledTimes(1);
  });

  it('answers directly when magentic_one has no callable heads', async () => {
    const magentic = createCard('magentic', 'magentic_one');
    const effectiveMagentic = resolveEffectiveAgent(magentic, templates);
    if (!effectiveMagentic) throw new Error('missing_effective_agent');

    const result = await runCardWithContract(magentic, effectiveMagentic, 'answer this', {
      userInput: 'answer this',
      allCards: [magentic],
      allEdges: [],
      allTemplates: templates,
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('No valid locked research runtime path resolved');
  });

  it('routes magentic_one to python autogen when executionBackend is enabled', async () => {
    const magentic = createCard('magentic', 'magentic_one');
    magentic.runtimeOptions = {
      executionBackend: 'python_autogen',
      provider: 'openai',
      modelKey: 'gpt-5.1-chat-latest',
    };
    const head = createCard('assist_head', 'assistant_agent');
    head.runtimeBinding = 'research_agent';
    const disconnected = createCard('disconnected_assist', 'assistant_agent');
    const localCoder = createCard('local_coder_head', 'local_coder');
    const graphFlow = createCard('graph_flow_head', 'graph_flow');
    const effectiveMagentic = resolveEffectiveAgent(magentic, templates);
    if (!effectiveMagentic) throw new Error('missing_effective_agent');
    autogenHarness.orchestrateWithAutoGen.mockResolvedValue({
      ok: true,
      finalResponseText: 'python autogen output',
    });

    const result = await runCardWithContract(magentic, effectiveMagentic, 'route this', {
      userInput: 'route this',
      projectId: 'project_test',
      deckId: 'deck_test',
      deckName: 'Deck Test',
      workspaceObjectContext: {
        activeSurface: 'chat',
        workspaceView: 'canvas',
        selectedObjectId: 'card_magentic',
        selectedObjectType: 'magentic_one',
        selectedObjectTitle: 'Magentic-One',
        selectedText: 'Answer with one short sentence.',
        openObjectSummary: 'Magentic-One is selected on the Agent Canvas.',
        activeMagenticParticipants: ['assist_head'],
        availableCanvasAgents: ['magentic', 'assist_head', 'disconnected_assist', 'local_coder_head'],
        excludedAgents: ['local_coder_head'],
      },
      allCards: [magentic, head, disconnected, localCoder, graphFlow],
      allEdges: [
        edge('edge_magentic_head', 'magentic', 'assist_head', 'magentic_option'),
        edge('edge_magentic_local_coder', 'magentic', 'local_coder_head', 'magentic_option'),
        edge('edge_magentic_graph_flow', 'magentic', 'graph_flow_head', 'magentic_option'),
        edge('edge_unrelated_flow', 'disconnected_assist', 'assist_head', 'flow'),
      ],
      allTemplates: templates,
    });

    expect(result.status).toBe('success');
    expect(result.runtimeType).toBe('magentic_one');
    expect(result.output).toBe('python autogen output');
    expect(autogenHarness.orchestrateWithAutoGen).toHaveBeenCalledTimes(1);
    const request = autogenHarness.orchestrateWithAutoGen.mock.calls[0]?.[0];
    expect(request.session.modelKey).toBe('gpt-5.1-chat-latest');
    expect(request.session.providerModelId).toBe('gpt-5.1-chat-latest');
    expect(request.workspaceObjectContext).toEqual({
      activeSurface: 'chat',
      workspaceView: 'canvas',
      selectedObjectId: 'card_magentic',
      selectedObjectType: 'magentic_one',
      selectedObjectTitle: 'Magentic-One',
      selectedText: 'Answer with one short sentence.',
      openObjectSummary: 'Magentic-One is selected on the Agent Canvas.',
      activeMagenticParticipants: ['assist_head'],
      availableCanvasAgents: ['magentic', 'assist_head', 'disconnected_assist', 'local_coder_head'],
      excludedAgents: ['local_coder_head'],
    });
    expect(request.cardRuntime.participants).toEqual([
      expect.objectContaining({
        cardId: 'assist_head',
        runtimeType: 'assistant_agent',
        runtimeBinding: 'research_agent',
        role: 'researcher',
        connectedTo: 'magentic',
        providerModelId: 'gpt-5.1-chat-latest',
      }),
    ]);
    expect(request.cardRuntime.participants.map((participant: { cardId: string }) => participant.cardId)).not.toContain(
      'disconnected_assist',
    );
    expect(request.cardRuntime.magentic?.unsupportedCallableHeads).toEqual([
      expect.objectContaining({ cardId: 'local_coder_head', runtimeType: 'local_coder' }),
      expect.objectContaining({ cardId: 'graph_flow_head', runtimeType: 'graph_flow' }),
    ]);
    expect(request.cardRuntime.graphFlow?.edges).toEqual([
      {
        id: 'edge_magentic_head',
        source: 'magentic',
        target: 'assist_head',
        edgeType: 'magentic_option',
      },
    ]);
    expect(llmHarness.runLLM).not.toHaveBeenCalled();
  });



  it('resolves callable head cards direction-agnostically for magentic_option edges', async () => {
    const magentic = createCard('magentic', 'magentic_one');
    const headA = createCard('assist_head_a', 'assistant_agent');
    const headB = createCard('assist_head_b', 'assistant_agent');
    const effectiveMagentic = resolveEffectiveAgent(magentic, templates);
    if (!effectiveMagentic) throw new Error('missing_effective_agent');

    autogenHarness.orchestrateWithAutoGen.mockResolvedValueOnce({
      ok: true,
      finalResponseText: 'head A output',
    });

    const result = await runCardWithContract(magentic, effectiveMagentic, 'route this', {
      userInput: 'route this',
      allCards: [magentic, headA, headB],
      allEdges: [
        edge('edge_magentic_head_a', 'magentic', 'assist_head_a', 'magentic_option'),
        edge('edge_head_b_magentic', 'assist_head_b', 'magentic', 'magentic_option'),
      ],
      allTemplates: templates,
    });

    if (result.status !== 'success') {
      console.log('Error:', result.error);
    }
    expect(result.status).toBe('success');
    expect(result.output).toBe('head A output');
    expect(autogenHarness.orchestrateWithAutoGen).toHaveBeenCalledTimes(1);
    const payload = autogenHarness.orchestrateWithAutoGen.mock.calls[0]?.[0];
    expect(payload?.cardRuntime?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cardId: 'assist_head_a' }),
        expect.objectContaining({ cardId: 'assist_head_b' })
      ])
    );
  });
});
