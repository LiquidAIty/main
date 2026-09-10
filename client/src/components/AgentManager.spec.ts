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
  selectKnowledgeGraphProjection,
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
    { name: 'accessMode', options: ['chatgpt-account', 'openai-api', 'openrouter-api'] },
    { name: 'reasoningEffort', options: ['low', 'medium', 'high', 'xhigh'] },
    { name: 'delegationRole', options: ['off', 'profile', 'leaf', 'orchestrator', 'team'] },
    ...['runtimeProfile', 'modelKey', 'temperature', 'maxTokens', 'maxTurns'].map((name) => ({ name, options: [] })),
  ].map(({ name, options }) => ({ name, label: name, path: name, control: 'select',
    options: options.map((value) => ({ value, label: value })) })),
  catalogs: { 'configured-models': [
    { provider: 'openai', key: 'model-a', label: 'Model A', providerModelId: 'model-a' },
    { provider: 'openrouter', key: 'model-b', label: 'Model B', providerModelId: 'model-b' },
  ] },
};

function mockEditorFetch(optionsAvailable = true, toolsAvailable = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      modelKey: 'old-choice', providerModelId: 'old-execution-model', delegationRole: 'profile' };
    const persist = vi.fn(async (_document: typeof initial) => undefined);
    function Harness() {
      const [deck, setDeck] = React.useState(initial);
      const editor = useAgentBuilderCardEditor({ deck, setDeck, selectedCardId: card.id,
        persistDeck: persist, recordDeckWriteReason: () => undefined });
      return React.createElement(AgentManager, { agentType: 'agent_builder', activeTab: 'Runtime',
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
    render(React.createElement(AgentManager, { agentType: 'agent_builder', activeTab: 'Runtime',
      localConfig: { ...savedConfig, runtime_options: updated.runtimeOptions,
        provider: targetProvider, model_key: updated.runtimeOptions?.modelKey }, onSaveLocalConfig: onSave }));
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Model').value).toBe('catalog-choice'));
    await leaveEditor();
    expect(onSave.mock.calls[0][0].runtime_options.providerModelId).toBe('provider/model-version');
  });
  it('keeps every explicit prompt block independently editable and preserves all untouched bytes', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '# LIQUIDAITY_PROMPT_V1\r\n[ROLE]\r\nMain role\r\n\r\n[CURRENT PROJECT FRAME - THINKGRAPH FIRST]\r\n  Read the frame.  \r\n\r\n[GOAL]\r\nFirst goal\r\n[GOAL]\r\nSecond goal\r\n[MEMORY_POLICY]\r\nRetain sources\r\n## Research / sources\r\nUse primary sources.\r\n```text\r\n[EXAMPLE]\r\nLiteral example\r\n```\r\n';
    const props = { agentType: 'agent_builder' as const, cardId: 'card-one', projectId: 'p', deckId: 'd',
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
    render(React.createElement(AgentManager, { agentType: 'agent_builder', activeTab: 'Prompt',
      cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, role: 'Researcher', prompt_template: 'Existing instructions' }, onSaveLocalConfig: onSave }));
    expect((screen.getByLabelText('Role') as HTMLTextAreaElement).value).toBe('Researcher');
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Replacement instructions' } });
    await leaveEditor();
    expect(onSave.mock.calls[0][0].prompt_template).toBe('Replacement instructions');
    expect(onSave.mock.calls[0][0].role).toBe('Researcher');
  });

  it('saves current settings before Run and never runs after a failed save', async () => {
    mockEditorFetch();
    let rejectSave: (error: Error) => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const onRun = vi.fn();
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'CLI', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: onSave, onRunCard: onRun,
      showTaskComposer: true, promptTestInput: 'Read the project',
    }));
    fireEvent.click(screen.getByTestId('agent-manager-run'));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onRun).not.toHaveBeenCalled();
    await act(async () => { rejectSave(new Error('Could not save Card.')); });
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-manager-save-error').textContent).toContain('Could not save Card.');
  });

  it('stages profile edits across tabs and sends each changed setting only on leaving the Card', async () => {
    const fetchMock = mockEditorFetch();
    const fallback = fetchMock.getMockImplementation()!;
    const native = {
      soul: 'Original soul', skills: [{ name: 'research', enabled: true }],
      backgroundReview: { enabled: true, provider: 'auto', model: '', maxInputTokens: null },
      toolsets: [], mcpServers: [], honcho: null,
      learning: { count: 0, summary: '', buckets: [], graph: { nodes: [], edges: [], clusters: [], memory: [], stats: {} } },
    };
    const writes: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/hermes-profile/cards/')) {
        if (init?.method === 'POST') {
          const change = JSON.parse(String(init.body));
          writes.push(change.params);
          if ('soul' in change.params) native.soul = change.params.soul;
          if ('disabled_skills' in change.params) native.skills[0].enabled = !change.params.disabled_skills.includes('research');
          if ('background_review' in change.params) native.backgroundReview.enabled = change.params.background_review.enabled;
        }
        return { ok: true, json: async () => ({ ok: true, native: structuredClone(native), binding: { profile: 'saved-profile', mode: 'delegate' } }) };
      }
      return fallback(input);
    });
    const onSave = vi.fn();
    const props = { agentType: 'agent_builder' as const, cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: onSave };
    const view = render(React.createElement(AgentManager, { ...props, activeTab: 'Prompt' }));
    const soul = await screen.findByLabelText('Soul') as HTMLTextAreaElement;
    expect(soul.value).toBe('Original soul');
    fireEvent.change(soul, { target: { value: 'Updated soul' } });
    expect(soul.value).toBe('Updated soul');
    view.rerender(React.createElement(AgentManager, { ...props, activeTab: 'Memory' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'research' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Automatic learning' }));
    expect(writes).toEqual([]);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
    await leaveEditor();
    expect(writes).toEqual([
      { background_review: { enabled: false, provider: 'auto', model: '', max_input_tokens: null } },
      { soul: 'Updated soul' }, { disabled_skills: ['research'] },
    ]);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it.each([
    { kind: 'hermes', mode: 'main', profile: 'main-profile' },
    { kind: 'hermes', mode: 'delegate', profile: 'worker-profile' },
    { kind: 'autogen', mode: 'magentic_one' },
    { kind: 'autogen', mode: 'assistant' },
  ] as const)('preserves the fixed $kind/$mode binding without runtime conversion controls', async (runtime) => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, runtime }, onSaveLocalConfig: onSave,
    }));
    expect(screen.queryByTestId('agent-runtime-kind')).toBeNull();
    expect(screen.queryByTestId('agent-runtime-mode')).toBeNull();
    expect(screen.queryByTestId('agent-native-profile-status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-read profile' })).toBeNull();
    await waitFor(() => expect(screen.queryByText(/Loading runtime options/)).toBeNull());
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    for (const [saved] of onSave.mock.calls) expect(saved.runtime).toEqual(runtime);
  });

  it('edits one prompt block without losing legacy headings, repeated sections, or whitespace', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '# Existing instructions\r\n\r\n[ROLE]\r\n  Full role text  \r\n\r\n[RESEARCH]\r\nKeep this exact text.\r\n\r\n[GOAL]\r\nFind sources\r\n\r\n[GOAL]\r\nAdditional goal\r\n[MEMORY_POLICY]\r\nKeep sources\r\n';
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
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
      agentType: 'agent_builder', activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, prompt_template: original, output_contract: 'Citations' }, onSaveLocalConfig: onSave,
    }));
    expect((screen.getByLabelText('Output expectations') as HTMLTextAreaElement).value).toBe('Citations');
    fireEvent.change(screen.getByLabelText('Output expectations'), { target: { value: 'Citations and a table' } });
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].output_contract).toBe('Citations and a table');
    expect(onSave.mock.calls[0][0].prompt_template).toBe(original);
  });
  it.each([undefined, 'selected', 'all_healthy'] as const)('shows the saved %s tool policy without changing grants', async (policy) => {
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
      agentType: 'agent_builder', activeTab: 'Tools', cardId: 'card-one',
      projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, runtime_options: { toolCatalogPolicy: policy } },
      onSaveLocalConfig: onSave,
    }));
    const availableRead = await screen.findByRole('checkbox', { name: 'Include Web search' });
    expect((availableRead as HTMLInputElement).checked).toBe(policy === 'all_healthy');
    expect((screen.getByRole('checkbox', { name: 'Include calculator' }) as HTMLInputElement).checked).toBe(true);
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].tools).toEqual(savedConfig.tools);
    expect(onSave.mock.calls[0][0].runtime_options.toolCatalogPolicy).toBe(policy || 'selected');
  });

  it.each([false, true])('restores prompt sections and preserves untouched fields (edit: %s)', async (edit) => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '[ROLE]\nResearcher\n\n[GOAL]\nFind sources\n\n[CONSTRAINTS]\nCite evidence\n\n[IO_SCHEMA]\nMarkdown\n\n[MEMORY_POLICY]\nKeep sources';
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Prompt', cardId: 'card-one',
      projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, role: 'Researcher', prompt_template: original },
      onSaveLocalConfig: onSave,
    }));
    expect((screen.getByLabelText('Goal') as HTMLTextAreaElement).value).toBe('Find sources');
    expect(screen.queryByLabelText('Prompt')).toBeNull();
    if (edit) fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Find primary sources' } });
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    if (edit) {
      expect(saved.prompt_template).toContain('[GOAL]\nFind primary sources');
      expect(saved.prompt_template).toContain('[CONSTRAINTS]\nCite evidence');
      expect(saved.prompt_template).not.toContain('PROMPT_V1');
    } else {
      expect(saved.prompt_template).toBe(original);
    }
    expect(saved.runtime).toEqual(savedConfig.runtime);
  });

  it('preserves the internal profile binding without a profile editor', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Runtime', cardId: 'card-one', cardName: 'Research',
      projectId: 'p', deckId: 'd', localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    expect(screen.queryByLabelText('Hermes profile')).toBeNull();
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].runtime).toEqual(savedConfig.runtime);
  });
  it.each([undefined, 'off', 'profile', 'leaf', 'orchestrator', 'team'] as const)('preserves delegation %s without a separate controller toggle', async (enabled) => {
    mockEditorFetch();
    const onSave = vi.fn();
    const options = enabled === undefined ? {} : { delegationRole: enabled };
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, runtime_options: options }, onSaveLocalConfig: onSave,
    }));
    expect(screen.queryByLabelText('Control connected Cards')).toBeNull();
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    expect(saved.runtime_options.delegationRole).toBe(enabled);
    expect(Object.hasOwn(saved.runtime_options, 'delegationRole')).toBe(enabled !== undefined);
    expect(saved.runtime).toEqual(savedConfig.runtime);
    expect(saved.tools).toEqual(savedConfig.tools);
    expect(saved.prompt_template).toBe(savedConfig.prompt_template);
  });
  it('selects the existing Team capability without adding a Card policy', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    const selector = await screen.findByLabelText('Delegate task');
    await waitFor(() => expect((selector as HTMLSelectElement).disabled).toBe(false));
    expect(screen.queryByLabelText('Maximum workers')).toBeNull();
    fireEvent.change(selector, { target: { value: 'team' } });
    expect(screen.queryByLabelText('Maximum workers')).toBeNull();
    expect(screen.queryByLabelText('Retry limit')).toBeNull();
    expect(screen.queryByLabelText('Team lead model')).toBeNull();
    fireEvent.change(selector, { target: { value: 'profile' } });
    expect(screen.queryByLabelText('Maximum workers')).toBeNull();
    expect(screen.queryByLabelText('Control connected Cards')).toBeNull();
    await leaveEditor();
    expect(onSave.mock.calls[0][0].runtime_options.delegationRole).toBe('profile');
    expect(onSave.mock.calls[0][0].runtime_options.team).toBeUndefined();
    expect(onSave.mock.calls[0][0].runtime).toEqual(savedConfig.runtime);
  });
  it('shows native-contract runtime choices without full Builder discovery or implicit model replacement', async () => {
    const fetchMock = mockEditorFetch();
    const onSave = vi.fn();
    const before = JSON.stringify(savedConfig);
    const { container } = render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
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

  it.each([true, false])('retains unavailable saved provider/model values on Save (options available: %s)', async (available) => {
    mockEditorFetch(available);
    const config: AgentManagerLocalConfig = { ...savedConfig, provider: 'local_openai_compatible' };
    const before = JSON.stringify(config);
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Runtime', localConfig: config, onSaveLocalConfig: onSave,
    }));
    await waitFor(() => expect(screen.queryByText('Loading runtime options… Saved values are unchanged.')).toBeNull());
    const provider = screen.getByLabelText('Provider') as HTMLSelectElement;
    expect(provider.value).toBe('local_openai_compatible');
    expect(provider.selectedOptions[0].text).toContain('unavailable — saved');
    expect(provider.disabled).toBe(!available);
    expect(screen.getByLabelText<HTMLSelectElement>('Model').value).toBe('removed-model');
    if (!available) expect(screen.getByRole('alert').textContent).toContain('Runtime options unavailable');
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'local_openai_compatible', model_key: 'removed-model', runtime: config.runtime, tools: ['calculator'],
    }));
    expect(JSON.stringify(config)).toBe(before);
  });

  it('shows tool discovery failure without claiming an empty catalog or clearing saved grants', async () => {
    mockEditorFetch(true, false);
    const onSave = vi.fn();
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Tools', localConfig: savedConfig, onSaveLocalConfig: onSave,
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
      skills: ['research', 'planning'],
      toolsets: ['browser'],
      mcp_connection_ids: ['github', 'project-research'],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/api.?key|access.?token|refresh.?token|client.?secret/i);
  });

  it('serializes the selected two-owner runtime without implicit mode coercion', () => {
    const assistant = buildActiveAgentManagerLocalConfig({
      runtime: { kind: 'autogen', mode: 'assistant' },
      provider: 'openai',
      accessMode: 'openai-api',
      modelKey: 'gpt-test',
      reasoningEffort: '',
      temperature: '',
      maxTokens: '',
      maxTurns: '',
      promptTemplate: '',
      toolsText: '',
      skillsText: '',
      toolsetsText: '',
      mcpConnectionIdsText: '',
    });
    expect(assistant.runtime).toEqual({ kind: 'autogen', mode: 'assistant' });

    const coder = buildActiveAgentManagerLocalConfig({
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-test',
      reasoningEffort: '',
      temperature: '',
      maxTokens: '',
      maxTurns: '',
      promptTemplate: '',
      toolsText: 'card.update_configuration',
      skillsText: '',
      toolsetsText: 'file\nterminal',
      mcpConnectionIdsText: '',
    });
    expect(coder.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'coder' });
    expect(coder.access_mode).toBe('chatgpt-account');
    expect(coder.tools).toEqual(['card.update_configuration']);
    expect(coder.toolsets).toEqual(['file', 'terminal']);
  });

  it('keeps Card Save separate from one-operation native Apply', () => {
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
    expect(source).toContain("method: 'profiles.configure'");
    expect(nativeClient).toContain('/native`');
    expect(nativeClient).not.toMatch(/\/preview|expectedFingerprint|HermesCardDraft/);
    expect(source).not.toContain('runNativeApply(buildCurrentLocalPayload');
    expect(source).not.toContain('data-testid="native-background-review"');
    expect(source).toContain('aria-label="Memory provider"');
    expect(source).not.toContain('Contextualized GPT-plugin Main turns report Honcho bypassed');
    expect(source).toContain("runtimeMode === 'main' && nativeHermesState.native.honcho");
    expect(source).not.toContain('CardSubagentsTab');
    expect(source).not.toContain('Use account Luna');
    expect(source).toContain("localConfig.runtime_options?.toolCatalogPolicy === 'all_healthy' ? 'all_healthy' : 'selected'");
    expect(source).not.toContain("toolCatalogPolicy={runtimeKind === 'hermes' ? 'all_healthy'");
  });

  it('uses CLI while retaining exactly one mission composer', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );
    const pageSource = readFileSync(
      path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'),
      'utf8',
    );

    expect(pageSource).toContain(
      "const BUILDER_NODE_TABS = ['CLI', 'Prompt', 'Runtime', 'Memory', 'Tools'] as const;",
    );
    expect(pageSource).toContain('if (BUILDER_NODE_TABS.some((entry) => entry === tab))');
    expect(source).toContain("activeTab === 'CLI' && showTaskComposer");
    expect(source).toContain('agent-manager-prompt-surface');
    expect(source).toContain('agent-manager-knowledge-surface');
    expect(source).not.toContain("activeTab === 'Task'");
    expect(source.match(/aria-label="Dynamic context \/ input"/g)).toHaveLength(1);
    expect(source.match(/data-testid="agent-manager-run"/g)).toHaveLength(1);
    expect(source).toContain('await Promise.resolve(onSaveLocalConfig(payload))');
    expect(source).not.toContain('saveRevisionAtStartRef');
    expect(source.match(/setSaveCardStatus\('saved'\)/g)).toHaveLength(1);
    expect(source).not.toContain('A short fallback covers the no-op save');
    expect(pageSource).toContain("selectedCard?.runtime.kind === 'hermes' && selectedCard.runtime.mode === 'main'");
    expect(pageSource).toContain('showTaskComposer={showStandaloneTestControls}');
    expect(pageSource).not.toContain("['Invocation', 'Prompt', 'Knowledge', 'Capabilities', 'Runtime']");
  });

  it('keeps stable Card versions separate from transient Card input', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).not.toContain("data-testid=\"agent-manager-save\"");
    expect(source).toContain("data-testid=\"agent-manager-run\"");
    expect(source).toContain("registerCardLeave?.(saveOnCardLeave)");
    expect(source).not.toContain('Save Card Version');
    expect(source).toContain("data-testid=\"agent-manager-clear-invocation\"");
    expect(source).not.toContain('Prepare / Refresh');
    expect(source).toContain("{runBusy ? 'Running…' : 'Run'}");
    expect(source).toContain('Export Run input…');
    expect(source).not.toContain('Run Test');
  });

  it('prepares the exact Python materialization without dumping raw transport on the Card', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');
    const pageSource = readFileSync(
      path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'),
      'utf8',
    );

    expect(source).toContain('Dynamic context / input');
    expect(source).not.toContain('Python materializes this input with the saved Card');
    expect(source).not.toContain('Exact in-memory runtime packet');
    expect(source).not.toContain('Run telemetry receipt');
    expect(source).not.toContain('aria-label="Exact temporary runtime packet"');
    expect(pageSource).toContain('invocation: result?.invocation || null');
  });

  it('shows and exports the selected Run IDF with an explicit estimate breakdown', async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, fields: [], catalogs: { 'configured-models': [] } }),
    })));
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);
    vi.stubGlobal('prompt', vi.fn(() => 'research-baseline.idf'));
    const idfText = '{"actualGraphData":{},"stableSavedCardContext":{},"selectedToolsAndGrants":{},"dynamicContext":{}}\n';
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder',
      activeTab: 'Memory',
      cardId: 'card-one',
      localConfig: { runtime: { kind: 'autogen', mode: 'assistant' } },
      onSaveLocalConfig: vi.fn(),
      showTaskComposer: false,
      runInputs: {
        available: true,
        runId: 'run-one',
        idfText,
        inputSummary: {
          idfBytes: 600,
          estimatedModelVisibleTokens: 95,
          estimatedSystemContextTokens: 40,
          estimatedTaskTokens: 20,
          estimatedOutputContractTokens: 5,
          estimatedGraphContextTokens: 30,
        },
        idf: {
          actualGraphData: { recordCounts: { total: 2 }, authorities: ['CodeGraph'] },
          stableSavedCardContext: {},
          selectedToolsAndGrants: {},
          dynamicContext: {},
        },
      },
    }));

    expect(screen.queryByTestId('agent-manager-save')).toBeNull();
    const inputDetails = screen.getByTestId('selected-run-idf') as HTMLDetailsElement;
    expect(inputDetails.open).toBe(false);
    fireEvent.click(screen.getByText('Input', { selector: 'summary' }));
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('system 40');
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('graph 30');
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('task 20');
    expect(screen.getByTestId('selected-run-idf').textContent).not.toMatch(/\bIDD\b|\bIDF\b|Input Data (Dictionary|Definition)/i);
    fireEvent.click(screen.getByRole('button', { name: 'Export Run input…' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(idfText));
    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'research-baseline.idf',
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps real Run input inspection collapsed below Memory settings', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, fields: [], catalogs: { 'configured-models': [] } }),
    })));
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder',
      activeTab: 'Memory',
      cardId: 'card-one',
      localConfig: { runtime: { kind: 'autogen', mode: 'assistant' } },
      onSaveLocalConfig: vi.fn(),
      runInputs: {
        available: true,
        runId: 'run-one',
        idfText: '{}\n',
        inputSummary: { idfBytes: 190, estimatedGraphContextTokens: 42 },
        idf: {
          actualGraphData: { recordCounts: { total: 3 }, authorities: ['ThinkGraph', 'KnowGraph'], records: [] },
          stableSavedCardContext: {},
          selectedToolsAndGrants: {},
          dynamicContext: {},
        },
      },
    }));

    expect(screen.queryByTestId('selected-run-idf-graph')).toBeNull();
    expect((screen.getByTestId('selected-run-idf') as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByText(/sub-worker input/i)).toBeNull();
  });

  it('uses native learning and tool controls instead of passive or Card-side projections', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );
    const nativeClient = readFileSync(
      path.resolve(process.cwd(), 'client/src/features/agentbuilder/nativeHermesCard.ts'),
      'utf8',
    );

    expect(source).toContain('native-learning-graph');
    expect(source).toContain('data-testid="main-honcho-status"');
    expect(source).not.toContain('Secrets are never returned to the Card.');
    expect(source).toContain('onOpenNode={(id) => void openNativeLearningNode(id)}');
    expect(source).toContain("change: { method: 'learning.edit', params: { id, content } }");
    expect(nativeClient).toContain("method: 'learning.detail'");
    expect(source).toContain('data-testid="agent-manager-learn"');
    expect(source).not.toContain('Built-in tools: {nativeHermesState.binding.nativeTools');
    expect(source).not.toContain('Detailed graph, Learn, and mutation controls are intentionally deferred');
  });

  it('places one staged delegate or Mag One mission and exact graph data in transient Card state', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );
    const pageSource = readFileSync(
      path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'),
      'utf8',
    );
    const chatSource = readFileSync(
      path.resolve(
        process.cwd(),
        'client/src/features/agentbuilder/console/useAgentBuilderMainChat.ts',
      ),
      'utf8',
    );

    expect(chatSource).toContain("'nativeEvents'");
    expect(source).toContain('card-native-telemetry');
    expect(chatSource).toContain("['write_mag_one_instructions', 'card.run_assistant_agent', 'delegate_task']");
    expect(chatSource).toContain("['card.load_graph_references', 'card.run_assistant_agent', 'delegate_task']");
    expect(chatSource).toContain('onCardReviewStaged');
    expect(chatSource).toContain('onCardGraphReferenceLoaded');
    expect(pageSource).toContain('const [transientCardInputs, setTransientCardInputs]');
    expect(pageSource).toContain('const [transientCardGraphContext, setTransientCardGraphContext]');
    expect(pageSource).toContain('[target.id]: loaded.mission');
    expect(pageSource).toContain("target.runtime.kind === 'hermes' && target.runtime.mode === 'delegate'");
    expect(pageSource).toContain("target.runtime.kind === 'autogen' && target.runtime.mode === 'magentic_one'");
    expect(pageSource).toContain('invocation: null');
    expect(chatSource).not.toContain('reviewContext.idf');
    expect(pageSource).toContain('dataAnchors: (transientCardGraphContext[card.id] || [])');
    const sendOnceGuard = pageSource.search(/standaloneTestRequestRef\.current\[card\.id\]\r?\n      \|\| !canvasProjectId/);
    const correlationAllocation = pageSource.indexOf('const correlationId = `card-run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;');
    expect(sendOnceGuard).toBeGreaterThan(-1);
    expect(correlationAllocation).toBeGreaterThan(sendOnceGuard);
    expect(pageSource).not.toContain('(transientCardGraphContext[selectedCard.id] || []).length === 0');
    expect(pageSource).toContain('(item) => item.reference.required && !item.ready');
    expect(source).toContain("'knowledge-model-bound-projection'");
    expect(source).toContain('NativeGraphProjectionSurface');
    expect(source).toContain('loadedGraphProjection');
    expect(source).not.toContain('Saved Mag One workers');
    expect(source).toContain('onRemoveGraphReference');
    expect(source).toContain('onMoveGraphReference');
    expect(source).not.toContain('Read-only Mag One proposal');
    expect(pageSource).toContain('onCardReviewStaged: handleCardReviewStaged');
    expect(pageSource).toContain("String(transientCardInputs[card.id] || '').trim()");
    expect(pageSource).toContain('if (staged) continue;');
    expect(pageSource).toContain('standaloneHydrationGenerationRef.current');
    expect(source).toContain('knowledgeGraphProjection.nodes.length > 0');
    expect(pageSource).toContain('onCardGraphReferenceLoaded: handleCardGraphReferenceLoaded');
    expect(pageSource).not.toContain('persistTransientCardInputs');
    expect(pageSource).not.toContain('proposalHash');
  });

  it('shows the exact materialized native IDs instead of a stale loaded preview', () => {
    const loaded = {
      schemaVersion: 'native-card-context.v1',
      authority: 'mixed',
      projectId: 'project-1',
      nodes: [{ id: 'stale-node', label: 'Stale', mentionCount: 1 }],
      edges: [],
      counts: { nodes: 1, edges: 0 },
    };
    const materialized = {
      ...loaded,
      nodes: [{ id: 'native-node-current', label: 'Current', mentionCount: 1 }],
      edges: [{
        id: 'native-edge-current',
        source: 'native-node-current',
        target: 'native-node-current',
        predicate: 'SELF',
        mentionCount: 1,
      }],
      counts: { nodes: 1, edges: 1 },
    };

    const selected = selectKnowledgeGraphProjection(loaded, materialized);
    expect(selected.modelBound).toBe(true);
    expect(selected.projection.nodes.map((node) => node.id)).toEqual(['native-node-current']);
    expect(selected.projection.edges.map((edge) => edge.id)).toEqual(['native-edge-current']);
  });

  it('keeps the card identity fields without adding another persistence path', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain('cardName');
    expect(source).toContain('cardSubtext');
    expect(source).toContain('onChangeCardName');
    expect(source).toContain('onChangeCardSubtext');
    expect(source).toContain('Description');
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
    expect(source).toContain('Card connection references');
    expect(source).not.toContain('params: { description: nativeDescriptionDraft }');
    expect(source).toContain('changes.soul = nativeSoulDraft');
    expect(source).not.toContain('nativeProviderDraft');
    expect(source).not.toContain('nativeModelDraft');
    expect(source).toContain('changes.disabled_skills = nativeDisabledSkills');
    expect(source).toContain('changes.enabled_toolsets = nativeEnabledToolsets');
    expect(source).toContain('changes.enabled_mcp_servers = nativeEnabledMcpServers');
    expect(source).toContain('native-learning-graph');
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
