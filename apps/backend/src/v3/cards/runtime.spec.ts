import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, AgentTemplate, DeckEdge } from '../types';

const llmHarness = vi.hoisted(() => ({
  runLLM: vi.fn(),
}));

const registryHarness = vi.hoisted(() => ({
  getTool: vi.fn(),
}));

vi.mock('../../llm/client', () => ({
  runLLM: llmHarness.runLLM,
}));

vi.mock('../../agents/registry', () => ({
  getTool: registryHarness.getTool,
}));

import { resolveEffectiveAgent, runCardWithContract } from './runtime';

const templates: AgentTemplate[] = [
  {
    id: 'worker',
    name: 'Worker',
    model: 'or-openai-gpt-5.1-chat-latest',
    provider: 'openrouter',
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
  edgeType: DeckEdge['edgeType'] = 'graph_flow',
  metadata: DeckEdge['metadata'] = undefined,
): DeckEdge {
  return metadata ? { id, source, target, edgeType, metadata } : { id, source, target, edgeType };
}

describe('runCardWithContract runtime dispatch', () => {
  beforeEach(() => {
    llmHarness.runLLM.mockReset();
    registryHarness.getTool.mockReset();
  });

  it('runs assistant_agent cards on the local single-agent path', async () => {
    const card = createCard('assistant_card', 'assistant_agent');
    card.runtimeBinding = 'main_chat';
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');
    llmHarness.runLLM.mockResolvedValue({
      text: 'assistant output',
      model: 'openai/gpt-5.1-chat',
      provider: 'openrouter',
      responseId: null,
    });

    const result = await runCardWithContract(card, effective, 'hello world', {
      userInput: 'hello world',
      blackboard: null,
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
      model: 'openai/gpt-5.1-chat',
      provider: 'openrouter',
      responseId: null,
    });

    const result = await runCardWithContract(card, effective, 'use the tool', {
      userInput: 'use the tool',
      blackboard: null,
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

  it('fails clear when an assist tool is unsupported', async () => {
    const card = createCard('assistant_bad_tool', 'assistant_agent');
    card.overrides = { tools: ['graph_lookup'] };
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');
    registryHarness.getTool.mockReturnValue(undefined);

    const result = await runCardWithContract(card, effective, 'bad tool input', {
      userInput: 'bad tool input',
      blackboard: null,
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('assistant_tool_not_supported');
    expect(llmHarness.runLLM).not.toHaveBeenCalled();
  });

  it('fails legacy participant-driven runtimes instead of executing hidden members', async () => {
    const card = createCard('selector_team', 'selector');
    (card as any).participants = [{ cardId: 'worker_a' }];
    const effective = resolveEffectiveAgent(card, templates);
    if (!effective) throw new Error('missing_effective_agent');

    const result = await runCardWithContract(card, effective, 'legacy input', {
      userInput: 'legacy input',
      blackboard: null,
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
      blackboard: null,
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
      blackboard: null,
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
      blackboard: null,
      allCards: [graph, stepA, stepB],
      allEdges: [edge('edge_a_b', 'step_a', 'step_b', 'graph_flow')],
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
      blackboard: null,
      allCards: [graph, stepLeft, stepRight, stepMerge],
      allEdges: [
        edge('edge_left_merge', 'step_left', 'step_merge', 'graph_flow', { mergeIntent: 'summarize_all' }),
        edge('edge_right_merge', 'step_right', 'step_merge', 'graph_flow', { mergeIntent: 'summarize_all' }),
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

    llmHarness.runLLM
      .mockResolvedValueOnce({ text: '{"selectedCardId":"assist_head","directResponseText":null}' })
      .mockResolvedValueOnce({ text: 'head output' });

    const result = await runCardWithContract(magentic, effectiveMagentic, 'route this', {
      userInput: 'route this',
      blackboard: null,
      allCards: [magentic, head],
      allEdges: [edge('edge_magentic_head', 'magentic', 'assist_head', 'magentic_option')],
      allTemplates: templates,
    });

    expect(result.status).toBe('success');
    expect(result.runtimeType).toBe('magentic_one');
    expect(result.output).toBe('head output');
    expect(llmHarness.runLLM).toHaveBeenCalledTimes(2);
  });

  it('lets magentic call a visible top-level Assist workflow and returns one consolidated output', async () => {
    const magentic = createCard('magentic', 'magentic_one');
    const head = createCard('assist_head', 'assistant_agent');
    const next = createCard('assist_next', 'assistant_agent');
    const effectiveMagentic = resolveEffectiveAgent(magentic, templates);
    if (!effectiveMagentic) throw new Error('missing_effective_agent');

    llmHarness.runLLM
      .mockResolvedValueOnce({ text: '{"selectedCardId":"assist_head","directResponseText":null}' })
      .mockResolvedValueOnce({ text: 'head output' })
      .mockResolvedValueOnce({ text: 'next output' })
      .mockResolvedValueOnce({ text: 'clean consolidated visible workflow answer' });

    const result = await runCardWithContract(magentic, effectiveMagentic, 'route this workflow', {
      userInput: 'route this workflow',
      blackboard: null,
      allCards: [magentic, head, next],
      allEdges: [
        edge('edge_magentic_head', 'magentic', 'assist_head', 'magentic_option'),
        edge('edge_head_next', 'assist_head', 'assist_next', 'graph_flow'),
      ],
      allTemplates: templates,
    });

    expect(result.status).toBe('success');
    expect(result.runtimeType).toBe('magentic_one');
    expect(result.output).toBe('clean consolidated visible workflow answer');
    expect(llmHarness.runLLM).toHaveBeenCalledTimes(4);
  });
});
