// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import React from 'react';
import useAgentBuilderCardEditor from '../features/agentbuilder/state/useAgentBuilderCardEditor';
import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildActiveAgentManagerLocalConfig,
  buildInputDictionarySelectedRows,
  buildDisplayedToolRows,
  AgentManager as AgentManagerComponent,
  hasHermesModelDrift,
  parseCardEditorOptions,
  type AgentManagerLocalConfig,
  toggleSavedToolAssignment,
} from './AgentManager';

let leaveCard: (() => Promise<boolean>) | null = null;
function AgentManager(props: React.ComponentProps<typeof AgentManagerComponent>) {
  return React.createElement(AgentManagerComponent, { ...props, registerCardLeave: (save) => { leaveCard = save; } });
}
async function leaveEditor() {
  expect(leaveCard).not.toBeNull();
  await act(async () => { await leaveCard?.(); });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const runtimeOptions = {
  ok: true,
  fields: [
    { name: 'provider', options: ['openai', 'openrouter'] },
    { name: 'subagentType', label: 'Subagents', path: 'runtimeOptions.subagentType', control: 'select', options: ['none', 'leaf', 'recursive'] },
    { name: 'accessMode', options: ['chatgpt-account', 'openai-api', 'openrouter-api'] },
    { name: 'reasoningEffort', options: ['low', 'medium', 'high', 'xhigh'] },
    ...['runtimeProfile', 'modelKey', 'temperature', 'maxTokens', 'maxTurns'].map((name) => ({ name, options: [] })),
  ].map((field) => ({
    ...field,
    label: field.label || field.name,
    path: field.path || field.name,
    control: field.control || 'select',
    options: field.options.map((value) => ({ value, label: value })),
  })),
  catalogs: { 'configured-models': [
    { provider: 'openai', key: 'model-a', label: 'Model A', providerModelId: 'model-a' },
    { provider: 'openrouter', key: 'model-b', label: 'Model B', providerModelId: 'model-b' },
  ] },
};

function mockEditorFetch(optionsAvailable = true, toolsAvailable = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/cards/options') {
      return { ok: optionsAvailable, json: async () => optionsAvailable ? runtimeOptions : { ok: false } };
    }
    if (url.startsWith('/api/idd/tools?')) {
      return { ok: toolsAvailable, json: async () => ({ ok: toolsAvailable, references: [],
        selectedKnownReferences: [], unresolvedSelectedIds: ['calculator'], total: 0 }) };
    }
    // Native profile discovery is independent of ordinary runtime choices.
    return { ok: false, json: async () => ({ ok: false, error: 'Native profile unavailable.' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const savedConfig: AgentManagerLocalConfig = {
  runtime: { kind: 'hermes', mode: 'delegate', profile: 'saved-profile' },
  provider: 'openai', access_mode: 'chatgpt-account', model_key: 'removed-model',
  prompt_template: 'Saved prompt', tools: ['calculator'], skills: [], toolsets: [], mcp_connection_ids: [],
};

describe('AgentManager active builder config', () => {
  it.each(['openai', 'openrouter'] as const)('saves the selected %s catalog model ID through the Card editor and retains it on reopen', async (targetProvider) => {
    const fetchMock = mockEditorFetch();
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input) => String(input) === '/api/cards/options'
      ? { ok: true, json: async () => ({ ...runtimeOptions, catalogs: { 'configured-models': [
          { provider: targetProvider, key: 'catalog-choice', label: 'Selected model', providerModelId: 'provider/model-version' },
        ] } }) }
      : originalFetch(input));
    const initial = structuredClone(INITIAL_DECK);
    const card = initial.nodes.find(node => node.id === 'card_main_chat')!;
    card.runtimeOptions = { ...card.runtimeOptions, provider: 'openai', accessMode: 'chatgpt-account',
      modelKey: 'old-choice', providerModelId: 'old-execution-model' };
    const persist = vi.fn(async (_document: typeof initial) => undefined);
    function Harness() {
      const [deck, setDeck] = React.useState(initial);
      const editor = useAgentBuilderCardEditor({ deck, setDeck, selectedCardId: card.id,
        persistDeck: persist, recordDeckWriteReason: () => undefined });
      return React.createElement(AgentManager, { activeTab: 'Runtime',
        cardId: card.id, projectId: 'p', deckId: 'd', localConfig: editor.selectedCardConfig,
        onSaveLocalConfig: editor.handleSaveSelectedCardConfig });
    }
    const view = render(React.createElement(Harness));
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Model').disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: targetProvider } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'catalog-choice' } });
    await leaveEditor();
    expect(persist).toHaveBeenCalledOnce();
    const saved = persist.mock.calls[0][0];
    const updated = saved.nodes.find(node => node.id === card.id)!;
    expect(updated.runtimeOptions).toMatchObject({ ...card.runtimeOptions, provider: targetProvider,
      modelKey: 'catalog-choice', providerModelId: 'provider/model-version' });
    expect(updated.prompt).toBe(card.prompt);
    expect(updated.runtime).toEqual(card.runtime);
    expect(saved.edges).toEqual(initial.edges);
    expect(saved.nodes.filter(node => node.id !== card.id)).toEqual(initial.nodes.filter(node => node.id !== card.id));
    view.unmount();
    const onSave = vi.fn();
    render(React.createElement(AgentManager, { activeTab: 'Runtime',
      localConfig: { ...savedConfig, runtime_options: updated.runtimeOptions,
        provider: targetProvider, model_key: updated.runtimeOptions?.modelKey }, onSaveLocalConfig: onSave }));
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Model').value).toBe('catalog-choice'));
    await leaveEditor();
    expect(onSave).not.toHaveBeenCalled();
  });
  it('keeps every explicit prompt block independently editable and preserves all untouched bytes', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '# LIQUIDAITY_PROMPT_V1\r\n[ROLE]\r\nMain role\r\n\r\n[CURRENT PROJECT FRAME - THINKGRAPH FIRST]\r\n  Read the frame.  \r\n\r\n[GOAL]\r\nFirst goal\r\n[GOAL]\r\nSecond goal\r\n[MEMORY_POLICY]\r\nRetain sources\r\n## Research / sources\r\nUse primary sources.\r\n```text\r\n[EXAMPLE]\r\nLiteral example\r\n```\r\n';
    const props = { cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, prompt_template: original, output_contract: 'Citations' }, onSaveLocalConfig: onSave };
    const view = render(React.createElement(AgentManager, { ...props, activeTab: 'Prompt' }));
    expect((screen.getByLabelText('Role') as HTMLTextAreaElement).value).toBe('Main role');
    expect((screen.getByLabelText('Goal') as HTMLTextAreaElement).value).toBe('First goal');
    expect((screen.getByLabelText('GOAL', { exact: true }) as HTMLTextAreaElement).value).toBe('Second goal');
    expect((screen.getByLabelText('Memory policy') as HTMLTextAreaElement).value).toBe('Retain sources');
    expect((screen.getByLabelText('Research / sources') as HTMLTextAreaElement).value).toContain('[EXAMPLE]');
    expect(screen.queryByLabelText('EXAMPLE')).toBeNull();
    fireEvent.change(screen.getByLabelText('CURRENT PROJECT FRAME - THINKGRAPH FIRST'), { target: { value: 'Read the current frame.' } });
    fireEvent.change(screen.getByLabelText('GOAL', { exact: true }), { target: { value: 'Replacement goal' } });
    view.rerender(React.createElement(AgentManager, { ...props, activeTab: 'Runtime' }));
    view.rerender(React.createElement(AgentManager, { ...props, activeTab: 'Prompt' }));
    expect((screen.getByLabelText('CURRENT PROJECT FRAME - THINKGRAPH FIRST') as HTMLTextAreaElement).value).toBe('Read the current frame.');
    await leaveEditor();
    const expected = original.replace('Read the frame.', 'Read the current frame.').replace('Second goal', 'Replacement goal');
    expect(onSave.mock.calls[0][0].prompt_template).toBe(expected);
    expect(onSave.mock.calls[0][0].output_contract).toBe('Citations');
    expect(onSave.mock.calls[0][0].role).toBeUndefined();
    view.rerender(React.createElement(AgentManager, { ...props, activeTab: 'Prompt', localConfig: onSave.mock.calls[0][0] }));
    expect((screen.getByLabelText('GOAL', { exact: true }) as HTMLTextAreaElement).value).toBe('Replacement goal');
  });

  it('keeps unsectioned instructions out of Role and does not add an untouched role on save', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(AgentManager, { activeTab: 'Prompt',
      cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, role: 'Researcher', prompt_template: 'Existing instructions' }, onSaveLocalConfig: onSave }));
    expect((screen.getByLabelText('Role') as HTMLTextAreaElement).value).toBe('Researcher');
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Replacement instructions' } });
    await leaveEditor();
    expect(onSave.mock.calls[0][0].prompt_template).toBe('Replacement instructions');
    expect(onSave.mock.calls[0][0].role).toBe('Researcher');
  });

  it('does not expose a Card-local Results or dynamic-input surface', () => {
    mockEditorFetch();
    render(React.createElement(AgentManager, {
      activeTab: 'Tools', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: vi.fn(),
    }));
    expect(screen.queryByText('Results')).toBeNull();
    expect(screen.queryByLabelText('Dynamic context / input')).toBeNull();
    expect(screen.queryByTestId('agent-manager-run')).toBeNull();
  });

  it('uses PromptBlocks as the only Soul editor and opens real learning-frame nodes without background writes', async () => {
    const fetchMock = mockEditorFetch();
    const fallback = fetchMock.getMockImplementation()!;
    const native = {
      soul: 'Original soul', skills: [{ name: 'research', enabled: true }],
      toolsets: [], mcpServers: [], honcho: null,
      learning: {
        count: 1,
        summary: ['1 memory'],
        buckets: [{
          index: 0,
          label: 'Today',
          date: '2026-09-21',
          skills: 0,
          memories: 1,
          total: 1,
          category: 'memory',
          color: '#72D7C7',
          nodes: [{
            id: 'memory:today:0',
            glyph: 'M',
            label: 'Freshness',
            fullLabel: 'Freshness note',
            meta: 'memory',
            body: 'Original learning content',
            style: 'memory',
          }],
        }],
      },
    };
    const writes: Array<{ method: string; params: Record<string, unknown> }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/hermes-profile/cards/')) {
        if (init?.method === 'POST') {
          const change = JSON.parse(String(init.body));
          if (change.method === 'learning.detail') {
            return { ok: true, json: async () => ({
              ok: true,
              result: {
                ok: true,
                kind: 'memory',
                id: 'memory:today:0',
                label: 'Freshness note',
                content: 'Original learning content',
              },
            }) };
          }
          writes.push({ method: change.method, params: change.params });
        }
        return { ok: true, json: async () => ({
          ok: true,
          result: { ok: true },
          native: structuredClone(native),
          binding: { profile: 'saved-profile', mode: 'delegate' },
        }) };
      }
      return fallback(input);
    });
    const onSave = vi.fn();
    const props = { cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: onSave };
    const view = render(React.createElement(AgentManager, { ...props, activeTab: 'Prompt' }));
    expect(await screen.findByLabelText('Role')).toBeTruthy();
    expect(screen.queryByLabelText('Soul')).toBeNull();
    expect(screen.queryByTestId('agent-profile-soul')).toBeNull();
    view.rerender(React.createElement(AgentManager, { ...props, activeTab: 'Skills' }));
    const skills = await screen.findByLabelText('Card skill grants');
    fireEvent.change(skills, { target: { value: 'research' } });
    expect(screen.queryByRole('checkbox', { name: 'research' })).toBeNull();
    expect(screen.getByTestId('effective-hermes-skills').textContent).toContain('research · enabled');
    expect(screen.queryByRole('checkbox', { name: 'Automatic learning' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Learning' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Freshness note' }));
    const learningContent = await screen.findByRole('textbox', { name: 'Learning' });
    expect((learningContent as HTMLTextAreaElement).value).toBe('Original learning content');
    fireEvent.change(learningContent, { target: { value: 'Updated learning content' } });
    expect(writes).toEqual([]);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
    await leaveEditor();
    expect(writes).toEqual([{
      method: 'learning.edit',
      params: { id: 'memory:today:0', content: 'Updated learning content' },
    }]);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].skills).toEqual(['research']);
  });

  it.each([
    { kind: 'hermes', mode: 'main', profile: 'main-profile' },
    { kind: 'hermes', mode: 'delegate', profile: 'worker-profile' },
    { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
  ] as const)('preserves the fixed $kind/$mode binding without runtime conversion controls', async (runtime) => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, runtime }, onSaveLocalConfig: onSave,
    }));
    expect(screen.queryByTestId('agent-runtime-kind')).toBeNull();
    expect(screen.queryByTestId('agent-runtime-mode')).toBeNull();
    expect(screen.queryByTestId('agent-native-profile-status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-read profile' })).toBeNull();
    await waitFor(() => expect(screen.queryByText(/Loading runtime options/)).toBeNull());
    await leaveEditor();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('edits one prompt block without losing legacy headings, repeated sections, or whitespace', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '# Existing instructions\r\n\r\n[ROLE]\r\n  Full role text  \r\n\r\n[RESEARCH]\r\nKeep this exact text.\r\n\r\n[GOAL]\r\nFind sources\r\n\r\n[GOAL]\r\nAdditional goal\r\n[MEMORY_POLICY]\r\nKeep sources\r\n';
    render(React.createElement(AgentManager, {
      activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, role: 'Old short role', prompt_template: original }, onSaveLocalConfig: onSave,
    }));
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Find primary sources' } });
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].prompt_template).toBe(original.replace('Find sources', 'Find primary sources'));
    expect(onSave.mock.calls[0][0].role).toBe('Old short role');
  });

  it('saves output expectations to the existing output contract without rewriting memory instructions', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '[ROLE]\nResearch\n[MEMORY_POLICY]\nRetain sources';
    render(React.createElement(AgentManager, {
      activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, prompt_template: original, output_contract: 'Citations' }, onSaveLocalConfig: onSave,
    }));
    expect((screen.getByLabelText('Output expectations') as HTMLTextAreaElement).value).toBe('Citations');
    fireEvent.change(screen.getByLabelText('Output expectations'), { target: { value: 'Citations and a table' } });
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].output_contract).toBe('Citations and a table');
    expect(onSave.mock.calls[0][0].prompt_template).toBe(original);
  });
  it('adds an explicit saved tool grant without implicit catalog grants', async () => {
    const fetchMock = mockEditorFetch();
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input) => {
      if (String(input).startsWith('/api/idd/tools?')) {
        return { ok: true, json: async () => ({ ok: true,
          references: [{ canonicalId: 'web_search', displayName: 'Web search', access: 'read', availability: 'available' }],
          selectedKnownReferences: [], unresolvedSelectedIds: ['calculator'], total: 1 }) };
      }
      return fallback(input);
    });
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      activeTab: 'Tools', cardId: 'card-one',
      projectId: 'p', deckId: 'd',
      localConfig: savedConfig,
      onSaveLocalConfig: onSave,
    }));
    await screen.findByRole('checkbox', { name: 'Include calculator' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selected only' }));
    const availableRead = await screen.findByRole('checkbox', { name: 'Include Web search' });
    expect((availableRead as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Include calculator' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(availableRead);
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].tools).toEqual(['calculator', 'web_search']);
  });

  it.each([false, true])('restores prompt sections and preserves untouched fields (edit: %s)', async (edit) => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '[ROLE]\nResearcher\n\n[GOAL]\nFind sources\n\n[CONSTRAINTS]\nCite evidence\n\n[IO_SCHEMA]\nMarkdown\n\n[MEMORY_POLICY]\nKeep sources';
    render(React.createElement(AgentManager, {
      activeTab: 'Prompt', cardId: 'card-one',
      projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, role: 'Researcher', prompt_template: original },
      onSaveLocalConfig: onSave,
    }));
    expect((screen.getByLabelText('Goal') as HTMLTextAreaElement).value).toBe('Find sources');
    expect(screen.queryByLabelText('Prompt')).toBeNull();
    if (edit) fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Find primary sources' } });
    await leaveEditor();
    if (edit) {
      await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      const saved = onSave.mock.calls[0][0];
      expect(saved.prompt_template).toContain('[GOAL]\nFind primary sources');
      expect(saved.prompt_template).toContain('[CONSTRAINTS]\nCite evidence');
      expect(saved.prompt_template).not.toContain('PROMPT_V1');
      expect(saved.runtime).toEqual(savedConfig.runtime);
    } else {
      expect(onSave).not.toHaveBeenCalled();
      expect((screen.getByLabelText('Goal') as HTMLTextAreaElement).value).toBe('Find sources');
    }
  });

  it('preserves the internal profile binding without a profile editor', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      activeTab: 'Runtime', cardId: 'card-one', cardName: 'Research',
      projectId: 'p', deckId: 'd', localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    expect(screen.queryByLabelText('Hermes profile')).toBeNull();
    await leaveEditor();
    expect(onSave).not.toHaveBeenCalled();
    expect(savedConfig.runtime.profile).toBe('saved-profile');
  });
  it('shows native-contract runtime choices without full Builder discovery or implicit model replacement', async () => {
    const fetchMock = mockEditorFetch();
    const onSave = vi.fn();
    const before = JSON.stringify(savedConfig);
    const { container } = render(React.createElement(AgentManager, {
      activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    const provider = screen.getByLabelText('Provider') as HTMLSelectElement;
    const model = screen.getByLabelText('Model') as HTMLSelectElement;
    await waitFor(() => expect(provider.disabled).toBe(false));
    expect(screen.queryByLabelText('Runtime')).toBeNull();
    expect(screen.queryByLabelText('Runtime mode')).toBeNull();
    expect(model.value).toBe('removed-model');
    expect(model.selectedOptions[0].text).toBe('removed-model (unavailable — saved)');
    expect(onSave).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/input-data-dictionary/card-editor'))).toBe(false);
    expect(container.textContent).not.toMatch(/\bIDD\b|\bIDF\b|Input Data (Dictionary|Definition)/i);

    fireEvent.change(provider, { target: { value: 'openrouter' } });
    expect(model.value).toBe('removed-model');
    expect(screen.getByRole('option', { name: 'Model B' })).not.toBeNull();
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      runtime: savedConfig.runtime, provider: 'openrouter', model_key: 'removed-model',
      prompt_template: savedConfig.prompt_template, tools: ['calculator'],
    }));
    expect(JSON.stringify(savedConfig)).toBe(before);
  });

  it('keeps task-ledger configuration off Magnetic runtime', async () => {
    mockEditorFetch();
    render(React.createElement(AgentManager, {
      activeTab: 'Runtime', cardId: 'card-magnetic', projectId: 'p', deckId: 'd',
      localConfig: {
        ...savedConfig,
        runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
        runtime_options: {},
      },
      onSaveLocalConfig: vi.fn(),
    }));
    await waitFor(() => expect(screen.queryByText(/Loading runtime options/)).toBeNull());
    expect(screen.queryByRole('combobox', { name: 'Subagents' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Subagent model' })).toBeNull();
  });

  it('saves one exact temporary-subagent type and shows its model only when enabled', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      activeTab: 'Runtime',
      localConfig: {
        ...savedConfig,
        runtime_options: { subagentType: 'none' },
      },
      onSaveLocalConfig: onSave,
    }));

    const selector = await screen.findByRole('combobox', { name: 'Subagents' }) as HTMLSelectElement;
    expect(selector.value).toBe('none');
    expect([...selector.options].map((option) => option.textContent)).toEqual(['None', 'Leaf', 'Recursive']);
    expect(screen.queryByRole('combobox', { name: 'Subagent model' })).toBeNull();

    fireEvent.change(selector, { target: { value: 'leaf' } });
    expect(await screen.findByRole('combobox', { name: 'Subagent model' })).toBeTruthy();
    await leaveEditor();
    expect(onSave.mock.calls[0][0].runtime_options.subagentType).toBe('leaf');
  });

  it('does not project the new selector over a preserved native Auto Team Card', async () => {
    mockEditorFetch();
    render(React.createElement(AgentManager, {
      activeTab: 'Runtime',
      localConfig: {
        ...savedConfig,
        runtime_options: {
          team: { mode: 'auto' },
          subagentModel: {
            provider: 'openai', accessMode: 'chatgpt-account',
            modelKey: 'model-a', providerModelId: 'model-a',
          },
        } as any,
      },
      onSaveLocalConfig: vi.fn(),
    }));

    await waitFor(() => expect(screen.queryByText(/Loading runtime options/)).toBeNull());
    expect(screen.queryByRole('combobox', { name: 'Subagents' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Subagent model' })).toBeTruthy();
  });

  it.each([true, false])('retains unavailable saved provider/model values on Save (options available: %s)', async (available) => {
    mockEditorFetch(available);
    const config: AgentManagerLocalConfig = { ...savedConfig, provider: 'local_openai_compatible' };
    const before = JSON.stringify(config);
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      activeTab: 'Runtime', localConfig: config, onSaveLocalConfig: onSave,
    }));
    await waitFor(() => expect(screen.queryByText('Loading runtime options… Saved values are unchanged.')).toBeNull());
    const provider = screen.getByLabelText('Provider') as HTMLSelectElement;
    expect(provider.value).toBe('local_openai_compatible');
    expect(provider.selectedOptions[0].text).toContain('unavailable — saved');
    expect(provider.disabled).toBe(!available);
    expect(screen.getByLabelText<HTMLSelectElement>('Model').value).toBe('removed-model');
    if (!available) expect(screen.getByRole('alert').textContent).toContain('Runtime options unavailable');
    await leaveEditor();
    expect(onSave).not.toHaveBeenCalled();
    expect(JSON.stringify(config)).toBe(before);
  });

  it('shows tool discovery failure without claiming an empty catalog or clearing saved grants', async () => {
    mockEditorFetch(true, false);
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      activeTab: 'Tools', localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    expect(screen.getByText('Loading tools…')).not.toBeNull();
    expect((await screen.findByRole('alert')).textContent).toBe('Tool options unavailable. Saved selections are unchanged.');
    expect(screen.queryByText('0 tools')).toBeNull();
    expect(screen.queryByText('No tools match this search.')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Include calculator').checked).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reports only an exact saved Card to native profile model mismatch', () => {
    expect(hasHermesModelDrift('gpt-5.6-terra', 'gpt-5.6-luna')).toBe(true);
    expect(hasHermesModelDrift('gpt-5.6-luna', 'gpt-5.6-luna')).toBe(false);
    expect(hasHermesModelDrift('', 'gpt-5.6-luna')).toBe(false);
  });

  it('builds the exact active local configuration payload', () => {
    const payload = buildActiveAgentManagerLocalConfig({
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-test',
      reasoningEffort: 'medium',
      temperature: 0.2,
      maxTokens: 800,
      maxTurns: 12,
      promptTemplate: 'test prompt',
      toolsText: 'web',
      nativeToolsText: 'memory\nterminal',
      skillsText: 'research\nplanning',
      toolsetsText: 'browser',
      mcpConnectionIdsText: 'github\nproject-research',
    });

    expect(payload).toEqual({
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      provider: 'openai',
      access_mode: 'chatgpt-account',
      model_key: 'gpt-test',
      reasoning_effort: 'medium',
      temperature: 0.2,
      max_tokens: 800,
      max_turns: 12,
      prompt_template: 'test prompt',
      tools: ['web'],
      native_tools: ['memory', 'terminal'],
      skills: ['research', 'planning'],
      toolsets: ['browser'],
      mcp_connection_ids: ['github', 'project-research'],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/api.?key|access.?token|refresh.?token|client.?secret/i);
  });

  it('serializes the selected two-owner runtime without implicit mode coercion', () => {
    const assistant = buildActiveAgentManagerLocalConfig({
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'assistant' },
      provider: 'openai',
      accessMode: 'openai-api',
      modelKey: 'gpt-test',
      reasoningEffort: '',
      temperature: '',
      maxTokens: '',
      maxTurns: '',
      promptTemplate: '',
      toolsText: '',
      nativeToolsText: '',
      skillsText: '',
      toolsetsText: '',
      mcpConnectionIdsText: '',
    });
    expect(assistant.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'assistant' });

    const delegate = buildActiveAgentManagerLocalConfig({
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-test',
      reasoningEffort: '',
      temperature: '',
      maxTokens: '',
      maxTurns: '',
      promptTemplate: '',
      toolsText: 'card.update_configuration',
      nativeToolsText: 'memory',
      skillsText: '',
      toolsetsText: 'file\nterminal',
      mcpConnectionIdsText: '',
    });
    expect(delegate.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'delegate' });
    expect(delegate.access_mode).toBe('chatgpt-account');
    expect(delegate.tools).toEqual(['card.update_configuration']);
    expect(delegate.native_tools).toEqual(['memory']);
    expect(delegate.toolsets).toEqual(['file', 'terminal']);
  });

  it('keeps Card Save separate from the bounded learning operations', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );
    const nativeClient = readFileSync(
      path.resolve(process.cwd(), 'client/src/features/agentbuilder/nativeHermesCard.ts'),
      'utf8',
    );

    expect(source).toContain('await Promise.resolve(onSaveLocalConfig(payload))');
    expect(source).not.toContain('Saving this Card cannot change the profile.');
    expect(source).not.toMatch(/applyNativeHermesCard|previewNativeHermesCard|buildHermesCardDraftFromLocalConfig/);
    expect(source).not.toContain("method: 'profiles.configure'");
    expect(nativeClient).toContain('/native`');
    expect(nativeClient).not.toMatch(/\/preview|expectedFingerprint|HermesCardDraft/);
    expect(source).not.toContain('runNativeApply(buildCurrentLocalPayload');
    expect(source).not.toContain('data-testid="native-background-review"');
    expect(source).not.toContain('aria-label="Memory provider"');
    expect(source).not.toContain('Contextualized GPT-plugin Main turns report Honcho bypassed');
    expect(source).not.toContain('nativeHermesState?.native.honcho');
    expect(source).not.toContain('CardSubagentsTab');
    expect(source).not.toContain('Use account Luna');
  });

  it('keeps the general Card tabs configuration-only and leaves CLI ownership to the page', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );
    const pageSource = readFileSync(
      path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'),
      'utf8',
    );

    expect(pageSource).toContain(
      "const BUILDER_NODE_TABS = ['Prompt', 'Runtime', 'Memory', 'Skills', 'Tools'] as const;",
    );
    expect(pageSource).toContain('if (BUILDER_NODE_TABS.some((entry) => entry === tab))');
    expect(source).toContain('agent-manager-prompt-surface');
    expect(source).toContain('agent-manager-memory');
    expect(source).toContain('agent-manager-skills');
    expect(source).not.toContain("activeTab === 'Results'");
    expect(source).not.toContain('Dynamic context / input');
    expect(source).not.toContain('data-testid="agent-manager-run"');
    expect(source).toContain('await Promise.resolve(onSaveLocalConfig(payload))');
    expect(source).not.toContain('saveRevisionAtStartRef');
    expect(source.match(/setSaveCardStatus\('saved'\)/g)).toHaveLength(1);
    expect(source).not.toContain('A short fallback covers the no-op save');
    expect(pageSource).toContain("tab === 'CLI'");
    expect(pageSource).toContain("selectedNode.runtime.mode === 'magentic_one'");
    expect(pageSource).not.toContain('showTaskComposer');
    expect(pageSource).not.toContain("['Invocation', 'Prompt', 'Knowledge', 'Capabilities', 'Runtime']");
  });

  it('keeps saved grants editable and effective Hermes state read-only', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );
    const nativeClient = readFileSync(
      path.resolve(process.cwd(), 'client/src/features/agentbuilder/nativeHermesCard.ts'),
      'utf8',
    );

    expect(source).toContain('data-testid="agent-manager-skills"');
    expect(source).toContain('data-testid="effective-hermes-skills"');
    expect(source).not.toContain('data-testid="main-honcho-status"');
    expect(source).toContain('data-testid="effective-hermes-runtime"');
    expect(source).toContain('aria-label="Card skill grants"');
    expect(source).toContain('Hermes capabilities');
    expect(source).toContain('Hermes toolsets');
    expect(source).toContain('External MCP connection references');
    expect(source).not.toContain('changes.disabled_skills');
    expect(source).not.toContain('changes.enabled_toolsets');
    expect(source).not.toContain('changes.enabled_mcp_servers');
    expect(source).toContain('onClick={() => void openNativeLearningNode(node.id)}');
    expect(source).toContain("change: { method: 'learning.edit', params: { id, content } }");
    expect(nativeClient).toContain("method: 'learning.detail'");
    expect(source).not.toContain('Automatic learning');
    expect(source).not.toContain('background_review');
    expect(nativeClient).not.toContain('backgroundReview');
    expect(nativeClient).not.toContain('StarmapGraph');
    expect(source).toContain('const [showSelectedToolsOnly, setShowSelectedToolsOnly] = useState(true)');
  });

  it('keeps the card identity fields without adding another persistence path', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain('cardName');
    expect(source).toContain('onChangeCardName');
    expect(source).not.toMatch(/\bCard mode\b/);
    expect(source).not.toContain('Runtime Type');
    expect(source).not.toContain('aria-label="Runtime mode"');
    expect(source).not.toContain('data-testid="agent-runtime-mode"');
    expect(source).toContain('Advanced runtime');
    expect(source).not.toContain('GlassInspectorSection');
    expect(source).not.toContain('roleBadge');
    expect(source).toContain('aria-label="Temperature"');
    expect(source).toContain('aria-label="Max tokens"');
    expect(source).toContain('aria-label="Max turns"');
    expect(source).toContain('/api/cards/options');
    expect(source).not.toContain('/api/idd/card-editor');
    expect(source).not.toContain('/api/config/models');
    expect(source).not.toContain('<option value="openai">');
    expect(source).toContain('Card skill grants');
    expect(source).toContain('Hermes capabilities');
    expect(source).toContain('Hermes toolsets');
    expect(source).toContain('External MCP connection references');
    expect(source).not.toContain('params: { description: nativeDescriptionDraft }');
    expect(source).not.toContain('nativeSoulDraft');
    expect(source).not.toContain('changes.soul');
    expect(source).not.toContain('agent-profile-soul');
    expect(source).not.toContain("renderSectionBody('Soul')");
    expect(source).not.toContain('nativeProviderDraft');
    expect(source).not.toContain('nativeModelDraft');
    expect(source).not.toContain('changes.disabled_skills');
    expect(source).not.toContain('changes.enabled_toolsets');
    expect(source).not.toContain('changes.enabled_mcp_servers');
    expect(source).toContain('data-testid="effective-hermes-runtime"');
    expect(source).not.toContain('Detailed graph, Learn, and mutation controls are intentionally deferred');
    expect(source).not.toContain('Profile selector');
    expect(source).not.toContain('HERMES_HOME');
  });

  it('consumes executable fields and configured provider models without redefining them', () => {
    const parsed = parseCardEditorOptions({
      fields: [
        {
          name: 'temperature',
          label: 'Temperature',
          path: 'runtimeOptions.temperature',
          control: 'number',
          minimum: 0,
          step: 0.1,
        },
      ],
      catalogs: {
        'configured-models': [
          {
            provider: 'openrouter',
            key: 'provider/model',
            label: 'Provider Model',
            providerModelId: 'provider/model',
            default: false,
          },
        ],
      },
    });

    expect(parsed.fields).toEqual([
      expect.objectContaining({ name: 'temperature', minimum: 0, step: 0.1 }),
    ]);
    expect(parsed.modelsByProvider.openrouter).toEqual([
      {
        key: 'provider/model',
        label: 'Provider Model',
        providerModelId: 'provider/model',
      },
    ]);
  });

  it('shows the one IDD vocabulary without runtime assignability filtering', () => {
    const rows = buildDisplayedToolRows(
      [
        { name: 'engraphis_recall_context', title: 'Context', sourceIds: ['main_mcp'] },
        { name: 'graphiti.search_nodes', title: 'Search nodes', sourceIds: ['graphiti'] },
        { name: 'cbm.search_graph', title: 'Search graph', sourceIds: ['cbm'] },
        { name: 'canvas.inspect', title: 'Inspect canvas', sourceIds: ['main_mcp'] },
        { name: 'main.context', sourceIds: ['main_mcp'] },
      ],
      ['graphiti.search_nodes', 'mystery.tool'],
    );

    expect(rows.map((row) => row.name)).toEqual([
      'graphiti.search_nodes',
      'mystery.tool',
      'engraphis_recall_context',
      'cbm.search_graph',
      'canvas.inspect',
      'main.context',
    ]);
    expect(rows[0]).toMatchObject({ title: 'Search nodes', availability: 'available' });
    expect(rows[1]).toEqual({ name: 'mystery.tool', availability: 'stale' });
  });

  it('rejects duplicate IDs because the IDD must materialize one entry per tool', () => {
    expect(() => buildDisplayedToolRows(
      [{ name: 'web_search' }, { name: 'web_search' }],
      [],
    )).toThrow('duplicate_idd_tool:web_search');
  });

  it('changes only the exact saved assignment and preserves order', () => {
    expect(toggleSavedToolAssignment(['first', 'hidden', 'last'], 'hidden', false)).toEqual([
      'first',
      'last',
    ]);
    expect(toggleSavedToolAssignment(['first', 'last'], 'first', true)).toEqual(['first', 'last']);
    expect(toggleSavedToolAssignment(['first', 'last'], 'new.tool', true)).toEqual([
      'first',
      'last',
      'new.tool',
    ]);
  });

  it('projects selected dictionary entries separately from a bounded 10k-entry page', () => {
    const allReferences = Array.from({ length: 10_000 }, (_, index) => ({
      canonicalId: `catalog.tool.${index}`,
      namespace: 'catalog',
      displayName: `Tool ${index}`,
      sourceIds: ['catalog'],
      availability: 'available' as const,
      access: 'write' as const,
    }));
    const page = allReferences.slice(4_000, 4_100);
    const selected = buildInputDictionarySelectedRows(
      [allReferences[9_999]],
      ['removed.tool'],
    );

    expect(page).toHaveLength(100);
    expect(selected).toEqual([
      expect.objectContaining({ name: 'catalog.tool.9999', availability: 'available' }),
      { name: 'removed.tool', availability: 'stale' },
    ]);
    expect(page.some((reference) => reference.canonicalId === 'catalog.tool.9999')).toBe(false);
  });

  it('keeps a currently unavailable selected dictionary tool removable', () => {
    expect(
      buildInputDictionarySelectedRows(
        [{
          canonicalId: 'retired.tool',
          sourceIds: ['main_mcp'],
          availability: 'disabled',
          access: 'write',
        }],
        [],
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'retired.tool',
        availability: 'disabled',
      }),
    ]);
  });

  it('recognizes a declared private Python write capability as a valid Card selection', () => {
    expect(
      buildInputDictionarySelectedRows(
        [{
          canonicalId: 'card.update_configuration',
          kind: 'tool',
          sourceIds: ['python_runtime'],
          displayName: 'Update Card configuration',
          availability: 'available',
          access: 'write',
        }],
        [],
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'card.update_configuration',
        kind: 'tool',
        sourceIds: ['python_runtime'],
        availability: 'available',
      }),
    ]);
  });
});
