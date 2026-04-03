// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentCardRuntimeType } from '../types/agentgraph';
import {
  AgentManager,
  buildActiveAgentManagerLocalConfig,
  getRuntimeTypeVisibleFieldLabels,
  type AgentManagerLocalConfig,
} from './AgentManager';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<() => void> = [];

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()?.();
  }
  document.body.innerHTML = '';
});

function createLocalConfig(
  runtimeType: AgentCardRuntimeType,
  overrides: Partial<AgentManagerLocalConfig> = {},
): AgentManagerLocalConfig {
  return {
    runtime_binding: null,
    runtime_type: runtimeType,
    runtime_options: {},
    parent_graph_id: null,
    provider: 'openai',
    model_key: 'gpt-5-mini',
    temperature: 0.2,
    max_tokens: 800,
    prompt_template: 'test prompt',
    tools: ['web_search'],
    knowledge_sources: ['docs://source-a'],
    response_format: { type: 'json_schema', schema: { type: 'object' } },
    ...overrides,
  };
}

function renderManager(options?: {
  activeTab?: string;
  localConfig?: AgentManagerLocalConfig;
  graphOwnerOptions?: Array<{ cardId: string; title: string }>;
  onSaveLocalConfig?: ReturnType<typeof vi.fn>;
}) {
  const onSaveLocalConfig = options?.onSaveLocalConfig || vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(AgentManager, {
        projectId: 'project_test',
        agentType: 'agent_builder',
        activeTab: options?.activeTab || 'Runtime',
        localConfig: options?.localConfig || createLocalConfig('assistant_agent'),
        graphOwnerOptions: options?.graphOwnerOptions || [],
        onSaveLocalConfig,
        promptTestInput: '',
        onChangePromptTestInput: vi.fn(),
        onRunPromptTest: vi.fn(),
      }),
    );
  });

  mountedRoots.push(() =>
    act(() => {
      root.unmount();
      container.remove();
    }),
  );

  return { container, onSaveLocalConfig };
}

describe('AgentManager runtime editor', () => {
  it('builds save payloads for assistant swarm without participants', () => {
    const payload = buildActiveAgentManagerLocalConfig({
      runtimeBinding: '',
      runtimeType: 'assistant_agent',
      runtimeOptions: {
        executionMode: 'swarm',
        swarmMaxWorkers: 4,
        swarmWorkerPromptTemplate: 'worker {workerIndex}',
        useSocietyOfMindConsolidation: true,
      },
      parentGraphId: 'card_graph_head',
      provider: 'openai',
      modelKey: 'gpt-5-mini',
      temperature: 0.4,
      maxTokens: 900,
      promptTemplate: 'prompt body',
      toolsText: 'web_search\ngraph_lookup',
      knowledgeText: 'docs://source-a\ndocs://source-b',
      responseFormatText: '{"type":"json_schema","schema":{"type":"object"}}',
      existingResponseFormat: { type: 'json_schema', schema: { type: 'legacy' } },
    });

    expect(payload).toEqual({
      runtime_binding: null,
      runtime_type: 'assistant_agent',
      runtime_options: {
        provider: 'openai',
        modelKey: 'gpt-5-mini',
        temperature: 0.4,
        maxTokens: 900,
        executionMode: 'swarm',
        swarmMaxWorkers: 4,
        swarmWorkerPromptTemplate: 'worker {workerIndex}',
        useSocietyOfMindConsolidation: true,
      },
      parent_graph_id: 'card_graph_head',
      provider: 'openai',
      model_key: 'gpt-5-mini',
      temperature: 0.4,
      max_tokens: 900,
      prompt_template: 'prompt body',
      tools: ['web_search', 'graph_lookup'],
      knowledge_sources: ['docs://source-a', 'docs://source-b'],
      response_format: { type: 'json_schema', schema: { type: 'object' } },
    });
  });

  it('preserves advanced legacy runtime options in save payloads', () => {
    const payload = buildActiveAgentManagerLocalConfig({
      runtimeBinding: '',
      runtimeType: 'selector',
      runtimeOptions: {
        provider: 'openai',
        modelKey: 'gpt-5-mini',
        temperature: 0.3,
        maxTokens: 1200,
        selectorPrompt: 'Choose the most grounded route.',
        allowRepeatedSpeaker: false,
        emitTeamEvents: true,
      },
      parentGraphId: '',
      provider: 'openai',
      modelKey: 'gpt-5-mini',
      temperature: 0.3,
      maxTokens: 1200,
      promptTemplate: 'selector prompt',
      toolsText: 'web_search',
      knowledgeText: 'docs://source-a',
      responseFormatText: '{"type":"json_schema","schema":{"type":"object"}}',
      existingResponseFormat: null,
    });

    expect(payload.runtime_type).toBe('selector');
    expect(payload.runtime_options).toEqual({
      provider: 'openai',
      modelKey: 'gpt-5-mini',
      temperature: 0.3,
      maxTokens: 1200,
      selectorPrompt: 'Choose the most grounded route.',
      allowRepeatedSpeaker: false,
      emitTeamEvents: true,
    });
  });

  it('shows only the active runtime fields that now apply', () => {
    expect(getRuntimeTypeVisibleFieldLabels('assistant_agent')).toEqual([
      'Runtime Type',
      'Provider',
      'Model',
      'Temperature',
      'Max Tokens',
      'Execution Mode',
    ]);
    expect(getRuntimeTypeVisibleFieldLabels('assistant_agent', 'swarm')).toEqual([
      'Runtime Type',
      'Provider',
      'Model',
      'Temperature',
      'Max Tokens',
      'Execution Mode',
      'Swarm Max Workers',
      'Swarm Worker Prompt Template',
    ]);
    expect(getRuntimeTypeVisibleFieldLabels('magentic_one')).toEqual([
      'Runtime Type',
      'Provider',
      'Model',
      'Temperature',
      'Max Tokens',
      'Max Turns',
      'Max Stalls',
      'Final Answer Prompt',
    ]);
    expect(getRuntimeTypeVisibleFieldLabels('graph_flow')).toEqual([
      'Runtime Type',
      'Provider',
      'Model',
      'Temperature',
      'Max Tokens',
      'Consolidate Result',
    ]);
  });

  it('renders runtime-specific fields without surfacing workflow ownership in the normal Assist editor', () => {
    const { container, onSaveLocalConfig } = renderManager({
      localConfig: createLocalConfig('assistant_agent'),
    });

    expect(container.textContent).toContain('Execution Mode');
    expect(container.textContent).not.toContain('Workflow Ownership');
    expect(container.textContent).not.toContain('Max Turns');
    expect(container.textContent).not.toContain('Final Answer Prompt');

    const executionMode = container.querySelector('[aria-label="Execution Mode"]') as HTMLSelectElement;
    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save Card');
    if (!saveButton) throw new Error('missing_save_button');

    act(() => {
      executionMode.value = 'swarm';
      executionMode.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('Swarm Max Workers');
    expect(container.textContent).toContain('Swarm Worker Prompt Template');

    act(() => {
      saveButton.click();
    });

    expect(onSaveLocalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_type: 'assistant_agent',
        parent_graph_id: null,
        knowledge_sources: ['docs://source-a'],
        response_format: { type: 'json_schema', schema: { type: 'object' } },
      }),
    );
  });

  it('preserves the raw prompt when saving without structured prompt edits', () => {
    const localConfig = createLocalConfig('assistant_agent', {
      prompt_template: 'RAW PROMPT THAT SHOULD STAY AS-IS',
    });
    const { container, onSaveLocalConfig } = renderManager({
      activeTab: 'Prompt',
      localConfig,
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save Card');
    if (!saveButton) throw new Error('missing_save_button');

    expect(container.textContent).not.toContain('Prompt Template (Raw)');

    act(() => {
      saveButton.click();
    });

    expect(onSaveLocalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt_template: 'RAW PROMPT THAT SHOULD STAY AS-IS',
      }),
    );
  });

  it('restores the Knowledge tab and preserves knowledge/schema on save', () => {
    const localConfig = createLocalConfig('assistant_agent', {
      knowledge_sources: ['docs://source-a', 'docs://source-b'],
      response_format: { type: 'json_schema', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } },
    });
    const { container, onSaveLocalConfig } = renderManager({
      activeTab: 'Knowledge',
      localConfig,
    });

    expect(container.textContent).toContain('Knowledge Sources');
    expect(container.textContent).toContain('Response Format JSON');

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save Card');
    if (!saveButton) throw new Error('missing_save_button');

    act(() => {
      saveButton.click();
    });

    expect(onSaveLocalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledge_sources: ['docs://source-a', 'docs://source-b'],
        response_format: {
          type: 'json_schema',
          schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        },
      }),
    );
  });

  it('keeps legacy graph_flow available only as a compatibility runtime when already present', () => {
    const { container } = renderManager({
      activeTab: 'Runtime',
      localConfig: createLocalConfig('graph_flow'),
    });

    const runtimeType = container.querySelector('[aria-label="Runtime Type"]') as HTMLSelectElement;
    const optionValues = Array.from(runtimeType.options).map((option) => ({
      value: option.value,
      disabled: option.disabled,
      label: option.textContent?.trim(),
    }));

    expect(optionValues).toEqual([
      { value: 'assistant_agent', disabled: false, label: 'Assist' },
      { value: 'magentic_one', disabled: false, label: 'Magentic' },
      { value: 'graph_flow', disabled: true, label: 'Legacy Workflow (compat)' },
    ]);
    expect(container.textContent).toContain('legacy compatibility runtime');
  });

  it('shows advanced runtime JSON for legacy team runtimes and preserves it on save', () => {
    const localConfig = createLocalConfig('selector', {
      runtime_options: {
        provider: 'openai',
        modelKey: 'gpt-5-mini',
        selectorPrompt: 'Pick the best worker.',
        allowRepeatedSpeaker: false,
        emitTeamEvents: true,
      },
    });
    const { container, onSaveLocalConfig } = renderManager({
      activeTab: 'Runtime',
      localConfig,
    });

    expect(container.textContent).toContain('Advanced Runtime Options JSON');

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save Card');
    if (!saveButton) throw new Error('missing_save_button');

    act(() => {
      saveButton.click();
    });

    expect(onSaveLocalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime_type: 'selector',
        runtime_options: expect.objectContaining({
          selectorPrompt: 'Pick the best worker.',
          allowRepeatedSpeaker: false,
          emitTeamEvents: true,
        }),
      }),
    );
  });

  it('keeps tools in the Tools tab only', () => {
    const { container, onSaveLocalConfig } = renderManager({
      activeTab: 'Tools',
      localConfig: createLocalConfig('assistant_agent', {
        tools: ['web_search', 'graph_lookup'],
      }),
    });
    const textArea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save Card');
    expect(textArea?.value).toContain('web_search');
    if (!textArea || !saveButton) throw new Error('missing_tools_controls');

    act(() => {
      saveButton.click();
    });

    expect(onSaveLocalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ['web_search', 'graph_lookup'],
        knowledge_sources: ['docs://source-a'],
        response_format: { type: 'json_schema', schema: { type: 'object' } },
      }),
    );
  });
});
