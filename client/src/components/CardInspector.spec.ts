// @vitest-environment jsdom

import React from 'react';
import useAgentBuilderCardEditor from '../features/agentbuilder/state/useAgentBuilderCardEditor';
import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCardConfigurationFromEditorFields,
  buildInputDictionarySelectedRows,
  parseCardEditorOptions,
  type CardEditorConfiguration,
  toggleSavedToolAssignment,
} from '../features/agentbuilder/cardConfigurationEditor';
import { CardInspector as CardInspectorComponent } from './CardInspector';

let leaveCard: (() => Promise<boolean>) | null = null;
function CardInspector(
  props: Partial<React.ComponentProps<typeof CardInspectorComponent>>
    & Pick<React.ComponentProps<typeof CardInspectorComponent>, 'activeTab'>,
) {
  return React.createElement(CardInspectorComponent, {
    cardId: 'card-one',
    projectId: 'p',
    deckId: 'd',
    cardName: 'Agent',
    onChangeCardName: () => undefined,
    localConfig: savedConfig,
    onSaveLocalConfig: () => undefined,
    orangeConnections: [],
    ...props,
    registerCardDraftFlush: (save) => { leaveCard = save; },
  });
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
    ...['runtimeProfile', 'modelKey'].map((name) => ({ name, options: [] })),
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
  autoModelCandidates: [
    { provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'model-a', eligible: true },
  ],
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
    // Hermes profile discovery is independent of ordinary runtime choices.
    return { ok: false, json: async () => ({ ok: false, error: 'Hermes profile unavailable.' }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const savedConfig: CardEditorConfiguration = {
  runtime: { kind: 'hermes', mode: 'delegate', profile: 'saved-profile' },
  provider: 'openai', access_mode: 'chatgpt-account', model_key: 'removed-model',
  prompt_template: 'Saved prompt', tools: ['calculator'], skills: [], toolsets: [], mcp_connection_ids: [],
};

describe('CardInspector active builder config', () => {
  it('saves only the two Hermes non-Magnetic automatic switches', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const view = render(React.createElement(CardInspector, {
      activeTab: 'Runtime', localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Auto Model').disabled).toBe(false));
    fireEvent.click(screen.getByLabelText('Auto Model'));
    view.rerender(React.createElement(CardInspector, {
      activeTab: 'Tools', localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    fireEvent.click(screen.getByLabelText('AutoTools'));
    await leaveEditor();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      runtime_options: expect.objectContaining({ autoModel: true, autoTools: true }),
    }));
    expect(screen.queryByLabelText('autoSelect')).toBeNull();
    expect(screen.queryByLabelText('jevContext')).toBeNull();
  });
  it('does not mount or poll the Runtime dashboard while another tab is active', async () => {
    const fetchMock = mockEditorFetch();
    render(React.createElement(CardInspector, {
      activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: vi.fn(),
    }));
    expect(await screen.findByLabelText('Role')).toBeTruthy();
    expect(screen.queryByTestId('card-run-metrics')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/cards/runs/read')).toBe(false);
  });

  it('places the latest Run receipt before configuration in the existing Runtime tab', async () => {
    mockEditorFetch();
    render(React.createElement(CardInspector, {
      activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: vi.fn(),
    }));

    const surface = screen.getByTestId('card-inspector-runtime-surface');
    const receipt = screen.getByTestId('card-run-metrics');
    const configuration = screen.getByRole('region', { name: 'Runtime configuration' });
    expect(surface.contains(receipt)).toBe(true);
    expect(receipt.compareDocumentPosition(configuration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText('Project code folder')).toBeNull();
  });

  it('sets Builder\'s Project code folder through the explicit Project callback', async () => {
    mockEditorFetch();
    const onSetProjectCodeFolder = vi.fn(async (_folder: string) => undefined);
    render(React.createElement(CardInspector, {
      activeTab: 'Runtime',
      cardId: 'builder',
      projectId: 'project-one',
      deckId: 'deck_builder',
      localConfig: savedConfig,
      onSaveLocalConfig: vi.fn(),
      projectCodeFolder: 'original-agent-ui',
      onSetProjectCodeFolder,
    }));

    const input = await screen.findByLabelText<HTMLInputElement>('Project code folder');
    expect(input.value).toBe('original-agent-ui');
    fireEvent.change(input, { target: { value: '  new-agent-ui  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set folder' }));

    await waitFor(() => expect(onSetProjectCodeFolder).toHaveBeenCalledWith('new-agent-ui'));
    expect((await screen.findByText('Folder path saved.')).textContent).toBe('Folder path saved.');
  });

  it('shares one in-flight flush and drains edits made while the first save is pending', async () => {
    mockEditorFetch();
    let releaseFirstSave: () => void = () => undefined;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    let saveCalls = 0;
    const onSave = vi.fn((_config: CardEditorConfiguration) => {
      saveCalls += 1;
      return saveCalls === 1 ? firstSave : Promise.resolve();
    });
    render(React.createElement(CardInspector, {
      activeTab: 'Prompt',
      cardId: 'card-one',
      projectId: 'p',
      deckId: 'd',
      localConfig: {
        ...savedConfig,
        prompt_template: '[ROLE]\nOriginal role\n\n[GOAL]\nOriginal goal',
      },
      onSaveLocalConfig: onSave,
    }));

    fireEvent.change(await screen.findByLabelText('Role'), {
      target: { value: 'First revision role' },
    });
    expect(leaveCard).not.toBeNull();
    let firstFlush!: Promise<boolean>;
    let duplicateFlush!: Promise<boolean>;
    act(() => {
      firstFlush = leaveCard!();
      duplicateFlush = leaveCard!();
    });
    expect(duplicateFlush).toBe(firstFlush);
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: 'Second revision goal' },
    });
    let flushResult = false;
    await act(async () => {
      releaseFirstSave();
      flushResult = await firstFlush;
    });

    expect(flushResult).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[0][0].prompt_template).toContain('[ROLE]\nFirst revision role');
    expect(onSave.mock.calls[0][0].prompt_template).toContain('[GOAL]\nOriginal goal');
    expect(onSave.mock.calls[1][0].prompt_template).toContain('[ROLE]\nFirst revision role');
    expect(onSave.mock.calls[1][0].prompt_template).toContain('[GOAL]\nSecond revision goal');
  });

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
      return React.createElement(CardInspector, { activeTab: 'Runtime',
        cardId: card.id, projectId: 'p', deckId: 'd',
        localConfig: editor.selectedCardConfig || undefined,
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
    render(React.createElement(CardInspector, { activeTab: 'Runtime',
      localConfig: { ...savedConfig, runtime_options: updated.runtimeOptions,
        provider: targetProvider, model_key: updated.runtimeOptions?.modelKey }, onSaveLocalConfig: onSave }));
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Model').value).toBe('catalog-choice'));
    await leaveEditor();
    expect(onSave).not.toHaveBeenCalled();
  });
  it('keeps every explicit prompt block independently editable and preserves all untouched bytes', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '# LIQUIDAITY_PROMPT_V1\r\n[ROLE]\r\nMain role\r\n\r\n[CURRENT PROJECT FRAME - THINKGRAPH FIRST]\r\n  Read the frame.  \r\n\r\n[GOAL]\r\nFirst goal\r\n[REVIEW_NOTES]\r\nSecond goal\r\n[MEMORY_POLICY]\r\nRetain sources\r\n## Research / sources\r\nUse primary sources.\r\n```text\r\n[EXAMPLE]\r\nLiteral example\r\n```\r\n';
    const props = { cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, prompt_template: original }, onSaveLocalConfig: onSave };
    const view = render(React.createElement(CardInspector, { ...props, activeTab: 'Prompt' }));
    expect((screen.getByLabelText('Role') as HTMLTextAreaElement).value).toBe('Main role');
    expect((screen.getByLabelText('Goal') as HTMLTextAreaElement).value).toBe('First goal');
    expect((screen.getByLabelText('REVIEW_NOTES', { exact: true }) as HTMLTextAreaElement).value).toBe('Second goal');
    expect((screen.getByLabelText('Memory policy') as HTMLTextAreaElement).value).toBe('Retain sources');
    expect((screen.getByLabelText('Research / sources') as HTMLTextAreaElement).value).toContain('[EXAMPLE]');
    expect(screen.queryByLabelText('EXAMPLE')).toBeNull();
    fireEvent.change(screen.getByLabelText('CURRENT PROJECT FRAME - THINKGRAPH FIRST'), { target: { value: 'Read the current frame.' } });
    fireEvent.change(screen.getByLabelText('REVIEW_NOTES', { exact: true }), { target: { value: 'Replacement goal' } });
    view.rerender(React.createElement(CardInspector, { ...props, activeTab: 'Runtime' }));
    view.rerender(React.createElement(CardInspector, { ...props, activeTab: 'Prompt' }));
    expect((screen.getByLabelText('CURRENT PROJECT FRAME - THINKGRAPH FIRST') as HTMLTextAreaElement).value).toBe('Read the current frame.');
    await leaveEditor();
    const expected = original.replace('Read the frame.', 'Read the current frame.').replace('Second goal', 'Replacement goal');
    expect(onSave.mock.calls[0][0].prompt_template).toBe(expected);
    expect(onSave.mock.calls[0][0].output_contract).toBeUndefined();
    expect(onSave.mock.calls[0][0].role).toBeUndefined();
    view.rerender(React.createElement(CardInspector, { ...props, activeTab: 'Prompt', localConfig: onSave.mock.calls[0][0] }));
    expect((screen.getByLabelText('REVIEW_NOTES', { exact: true }) as HTMLTextAreaElement).value).toBe('Replacement goal');
  });

  it('adds one editable teammate prompt block only for enabled outbound orange connections', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const props = {
      activeTab: 'Prompt',
      localConfig: {
        ...savedConfig,
        prompt_template: '[ROLE]\nCoordinate the work.',
        runtime_options: { orchestrator: true },
      },
      orangeConnections: [
        { cardId: 'card_main_chat', title: 'Main', direction: 'incoming' as const },
        { cardId: 'card_worldsignals_agent', title: 'WorldSignals', direction: 'outgoing' as const },
      ],
      onSaveLocalConfig: onSave,
    };
    const view = render(React.createElement(CardInspector, props));

    expect((screen.getByLabelText('Orchestrator') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('WorldSignals')).toBeTruthy();
    expect(screen.queryByText('Main')).toBeNull();
    expect(document.body.textContent).not.toContain('From @Main');
    const teammates = screen.getByLabelText('All connected agents') as HTMLTextAreaElement;
    expect(teammates.placeholder).toContain('WorldSignals is a connected teammate.');
    fireEvent.change(teammates, {
      target: { value: 'WorldSignals is a connected teammate. Call it for fresh launch and satellite evidence.' },
    });

    await leaveEditor();

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].runtime_options.orchestrator).toBe(true);
    expect(onSave.mock.calls[0][0].prompt_template).toContain(
      '[ALL CONNECTED AGENTS]\nWorldSignals is a connected teammate. Call it for fresh launch and satellite evidence.',
    );
    view.rerender(React.createElement(CardInspector, {
      ...props,
      localConfig: onSave.mock.calls[0][0],
    }));
    expect((screen.getByLabelText('All connected agents') as HTMLTextAreaElement).value).toBe(
      'WorldSignals is a connected teammate. Call it for fresh launch and satellite evidence.',
    );
  });

  it('keeps the teammate block peripheral until the orchestrator has an outbound orange connection', () => {
    mockEditorFetch();
    const view = render(React.createElement(CardInspector, {
      activeTab: 'Prompt',
      localConfig: { ...savedConfig, runtime_options: { orchestrator: true } },
      orangeConnections: [],
      onSaveLocalConfig: vi.fn(),
    }));

    expect(screen.queryByLabelText('All connected agents')).toBeNull();
    view.rerender(React.createElement(CardInspector, {
      activeTab: 'Prompt',
      localConfig: { ...savedConfig, runtime_options: { orchestrator: false } },
      orangeConnections: [
        { cardId: 'card_worldsignals_agent', title: 'WorldSignals', direction: 'outgoing' },
      ],
      onSaveLocalConfig: vi.fn(),
    }));
    expect(screen.queryByLabelText('All connected agents')).toBeNull();
  });

  it('edits the one saved connected-agent block instead of appending a duplicate', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(CardInspector, {
      activeTab: 'Prompt',
      localConfig: {
        ...savedConfig,
        prompt_template: [
          '[ROLE]',
          'Coordinate the work.',
          '',
          '[ALL CONNECTED AGENTS]',
          'WorldSignals is a connected teammate. Use it for earlier signal work.',
        ].join('\n'),
        runtime_options: { orchestrator: true },
      },
      orangeConnections: [
        { cardId: 'card_worldsignals_agent', title: 'WorldSignals', direction: 'outgoing' },
      ],
      onSaveLocalConfig: onSave,
    }));

    fireEvent.change(screen.getByLabelText('All connected agents'), {
      target: { value: 'WorldSignals is a connected teammate. Use it for current signal work.' },
    });
    await leaveEditor();

    const savedPrompt = String(onSave.mock.calls[0][0].prompt_template);
    expect(savedPrompt.match(/\[ALL CONNECTED AGENTS\]/g)).toHaveLength(1);
    expect(savedPrompt).toContain('Use it for current signal work.');
    expect(savedPrompt).not.toContain('Use it for earlier signal work.');
  });

  it('preserves saved teammate guidance when its outbound edge is no longer present', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const prompt = [
      '[ROLE]',
      'Coordinate the work.',
      '',
      '[ALL CONNECTED AGENTS]',
      'WorldSignals is a connected teammate. Use it for current signal work.',
    ].join('\n');
    render(React.createElement(CardInspector, {
      activeTab: 'Prompt',
      localConfig: {
        ...savedConfig,
        prompt_template: prompt,
        runtime_options: { orchestrator: true },
      },
      orangeConnections: [],
      onSaveLocalConfig: onSave,
    }));

    expect(screen.queryByLabelText('All connected agents')).toBeNull();
    fireEvent.change(screen.getByLabelText('Role'), {
      target: { value: 'Coordinate current work.' },
    });
    await leaveEditor();

    expect(onSave.mock.calls[0][0].prompt_template).toBe(
      prompt.replace('Coordinate the work.', 'Coordinate current work.'),
    );
  });

  it('keeps unsectioned instructions out of Role and does not add an untouched role on save', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(CardInspector, { activeTab: 'Prompt',
      cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, role: 'Researcher', prompt_template: 'Existing instructions' }, onSaveLocalConfig: onSave }));
    expect((screen.getByLabelText('Role') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Replacement instructions' } });
    await leaveEditor();
    expect(onSave.mock.calls[0][0].prompt_template).toBe('Replacement instructions');
    expect(onSave.mock.calls[0][0].role).toBe('Researcher');
  });

  it('does not expose a Card-local Results or dynamic-input surface', () => {
    mockEditorFetch();
    render(React.createElement(CardInspector, {
      activeTab: 'Tools', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: vi.fn(),
    }));
    expect(screen.queryByText('Results')).toBeNull();
    expect(screen.queryByLabelText('Dynamic context / input')).toBeNull();
    expect(screen.queryByTestId('card-inspector-run')).toBeNull();
  });

  it('uses PromptBlocks as the only Soul editor and opens real learning-frame nodes without background writes', async () => {
    const fetchMock = mockEditorFetch();
    const fallback = fetchMock.getMockImplementation()!;
    const profileState = {
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
          profile: structuredClone(profileState),
          binding: { profile: 'saved-profile', mode: 'delegate' },
        }) };
      }
      return fallback(input);
    });
    const onSave = vi.fn();
    const props = { cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: onSave };
    const view = render(React.createElement(CardInspector, { ...props, activeTab: 'Prompt' }));
    expect(await screen.findByLabelText('Role')).toBeTruthy();
    expect(screen.queryByLabelText('Soul')).toBeNull();
    expect(screen.queryByTestId('agent-profile-soul')).toBeNull();
    view.rerender(React.createElement(CardInspector, { ...props, activeTab: 'Skills' }));
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
    render(React.createElement(CardInspector, {
      activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, runtime }, onSaveLocalConfig: onSave,
    }));
    expect(screen.queryByTestId('agent-runtime-kind')).toBeNull();
    expect(screen.queryByTestId('agent-runtime-mode')).toBeNull();
    expect(screen.queryByTestId('agent-hermes-profile-status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-read profile' })).toBeNull();
    await waitFor(() => expect(screen.queryByText(/Loading runtime options/)).toBeNull());
    await leaveEditor();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects duplicate canonical prompt sections without mutating the saved Card', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '# Existing instructions\r\n\r\n[ROLE]\r\n  Full role text  \r\n\r\n[RESEARCH]\r\nKeep this exact text.\r\n\r\n[GOAL]\r\nFind sources\r\n\r\n[GOAL]\r\nAdditional goal\r\n[MEMORY_POLICY]\r\nKeep sources\r\n';
    render(React.createElement(CardInspector, {
      activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, role: 'Old short role', prompt_template: original }, onSaveLocalConfig: onSave,
    }));
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Find primary sources' } });
    await leaveEditor();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('card_prompt_duplicate_section:GOAL'));
    expect(screen.getByRole('alert').textContent).toContain('Keep exactly one [GOAL] block before saving.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a duplicate canonical section introduced inside an edited field', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(CardInspector, {
      activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: {
        ...savedConfig,
        prompt_template: '[ROLE]\nResearcher\n[GOAL]\nFind sources',
      },
      onSaveLocalConfig: onSave,
    }));
    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: 'Find current sources\n[ROLE]\nInjected duplicate role' },
    });
    await leaveEditor();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('card_prompt_duplicate_section:ROLE'));
    expect(screen.getByRole('alert').textContent).toContain('Keep exactly one [ROLE] block before saving.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each(['OUTPUT_CONTRACT', 'OUTPUT_REQUIREMENTS'])(
    'rejects a duplicate output section introduced while migrating legacy %s text',
    async (legacyAlias) => {
      mockEditorFetch();
      const onSave = vi.fn();
      render(React.createElement(CardInspector, {
        activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
        localConfig: {
          ...savedConfig,
          prompt_template: '[ROLE]\nResearcher\n[GOAL]\nFind sources',
          output_contract: `Citations\n[${legacyAlias}]\nInjected duplicate output`,
        },
        onSaveLocalConfig: onSave,
      }));
      fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Find current sources' } });
      await leaveEditor();
      await waitFor(() => expect(screen.getByRole('alert').textContent)
        .toContain('card_prompt_duplicate_section:OUTPUT_EXPECTATIONS'));
      expect(screen.getByRole('alert').textContent)
        .toContain('Keep exactly one [OUTPUT_EXPECTATIONS] block before saving.');
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it('migrates legacy output expectations into the canonical prompt and clears output_contract', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '[ROLE]\nResearch\n[GOAL]\nFind sources\n[MEMORY_POLICY]\nRetain sources';
    render(React.createElement(CardInspector, {
      activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, prompt_template: original, output_contract: 'Citations' }, onSaveLocalConfig: onSave,
    }));
    expect((screen.getByLabelText('Output expectations') as HTMLTextAreaElement).value).toBe('Citations');
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Find current sources' } });
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].output_contract).toBeUndefined();
    expect(onSave.mock.calls[0][0].prompt_template).toBe(
      `${original.replace('Find sources', 'Find current sources')}\n\n[OUTPUT_EXPECTATIONS]\nCitations`,
    );
  });

  it('keeps presentation role metadata unchanged when the prompt ROLE block changes', async () => {
    mockEditorFetch();
    const onSave = vi.fn();
    render(React.createElement(CardInspector, {
      activeTab: 'Prompt', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: { ...savedConfig, role: 'Presentation role', prompt_template: '[ROLE]\nRuntime role' },
      onSaveLocalConfig: onSave,
    }));
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Updated runtime role' } });
    await leaveEditor();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      role: 'Presentation role',
      prompt_template: '[ROLE]\nUpdated runtime role',
    });
  });
  it('adds an explicit saved tool grant without implicit catalog grants', async () => {
    const fetchMock = mockEditorFetch();
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input) => {
      if (String(input).startsWith('/api/idd/tools?')) {
        return { ok: true, json: async () => ({ ok: true,
          references: [{
            canonicalId: 'web_search', provider: 'python_runtime',
            providerToolName: 'web_search', displayName: 'Web search',
            access: 'read', available: true,
          }],
          selectedKnownReferences: [], unresolvedSelectedIds: ['calculator'], total: 1 }) };
      }
      return fallback(input);
    });
    const onSave = vi.fn();
    render(React.createElement(CardInspector, {
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

  it('selects Hermes toolsets through the saved Card configuration and shows profile readback', async () => {
    const fetchMock = mockEditorFetch();
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/hermes-profile/cards/')) {
        return { ok: true, json: async () => ({
          ok: true,
          profile: {
            name: 'saved-profile',
            description: '',
            soul: 'Saved prompt',
            model: { provider: 'openai-codex', default: 'removed-model' },
            skills: [],
            toolsets: [
              {
                name: 'web',
                label: 'Web',
                description: 'Search and read web sources.',
                enabled: true,
                tool_count: 3,
              },
              {
                name: 'terminal',
                label: 'Terminal',
                description: 'Run terminal commands.',
                enabled: false,
                tool_count: 2,
              },
            ],
            toolsetsPinned: true,
            mcpServers: [],
            learning: { count: 0, summary: [], buckets: [] },
          },
          binding: { profile: 'saved-profile', mode: 'delegate' },
        }) };
      }
      return fallback(input, init);
    });
    const onSave = vi.fn();
    render(React.createElement(CardInspector, {
      activeTab: 'Tools',
      cardId: 'card-one',
      projectId: 'p',
      deckId: 'd',
      localConfig: { ...savedConfig, toolsets: ['web'] },
      onSaveLocalConfig: onSave,
    }));

    const web = await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Enable Hermes Web' });
    const terminal = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Enable Hermes Terminal' });
    expect(web.checked).toBe(true);
    expect(terminal.checked).toBe(false);
    expect(screen.getByTestId('hermes-toolsets').textContent).toContain('Web · web');
    expect(screen.getByTestId('hermes-toolsets').textContent).toContain('3 tools · Profile readback: enabled');
    expect(screen.getByTestId('hermes-toolsets').textContent).toContain('2 tools · Profile readback: disabled');

    fireEvent.click(terminal);
    await leaveEditor();

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].toolsets).toEqual(['web', 'terminal']);
    expect(fetchMock.mock.calls.some(([, request]) => request?.method === 'POST')).toBe(false);
  });

  it.each([false, true])('restores prompt sections and preserves untouched fields (edit: %s)', async (edit) => {
    mockEditorFetch();
    const onSave = vi.fn();
    const original = '[ROLE]\nResearcher\n\n[GOAL]\nFind sources\n\n[CONSTRAINTS]\nCite evidence\n\n[IO_SCHEMA]\nMarkdown\n\n[MEMORY_POLICY]\nKeep sources';
    render(React.createElement(CardInspector, {
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
    render(React.createElement(CardInspector, {
      activeTab: 'Runtime', cardId: 'card-one', cardName: 'Research',
      projectId: 'p', deckId: 'd', localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    expect(screen.queryByLabelText('Hermes profile')).toBeNull();
    await leaveEditor();
    expect(onSave).not.toHaveBeenCalled();
    expect(savedConfig.runtime.profile).toBe('saved-profile');
  });
  it('shows saved-contract runtime choices without full Builder discovery or implicit model replacement', async () => {
    const fetchMock = mockEditorFetch();
    const onSave = vi.fn();
    const before = JSON.stringify(savedConfig);
    const { container } = render(React.createElement(CardInspector, {
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
    render(React.createElement(CardInspector, {
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
    render(React.createElement(CardInspector, {
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

  it('does not project the new selector over a preserved Auto Team Card', async () => {
    mockEditorFetch();
    render(React.createElement(CardInspector, {
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
    const config: CardEditorConfiguration = { ...savedConfig, provider: 'local_openai_compatible' };
    const before = JSON.stringify(config);
    const onSave = vi.fn();
    render(React.createElement(CardInspector, {
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
    render(React.createElement(CardInspector, {
      activeTab: 'Tools', localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    expect(screen.getByText('Loading tools…')).not.toBeNull();
    expect((await screen.findByRole('alert')).textContent).toBe('Tool options unavailable. Saved selections are unchanged.');
    expect(screen.queryByText('0 tools')).toBeNull();
    expect(screen.queryByText('No tools match this search.')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Include calculator').checked).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('builds the exact active local configuration payload', () => {
    const payload = buildCardConfigurationFromEditorFields({
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-test',
      promptTemplate: 'test prompt',
      toolsText: 'web\ncanvas.inspect\ncard.update_configuration',
      skillsText: 'research\nplanning',
      toolsetsText: 'browser',
      mcpConnectionIdsText: 'github\nproject-research',
    });

    expect(payload).toEqual({
      runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
      provider: 'openai',
      access_mode: 'chatgpt-account',
      model_key: 'gpt-test',
      prompt_template: 'test prompt',
      tools: ['web', 'canvas.inspect', 'card.update_configuration'],
      skills: ['research', 'planning'],
      toolsets: ['browser'],
      mcp_connection_ids: ['github', 'project-research'],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/api.?key|access.?token|refresh.?token|client.?secret/i);
  });

  it('serializes the selected two-owner runtime without implicit mode coercion', () => {
    const assistant = buildCardConfigurationFromEditorFields({
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'assistant' },
      provider: 'openai',
      accessMode: 'openai-api',
      modelKey: 'gpt-test',
      promptTemplate: '',
      toolsText: '',
      skillsText: '',
      toolsetsText: '',
      mcpConnectionIdsText: '',
    });
    expect(assistant.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'assistant' });

    const delegate = buildCardConfigurationFromEditorFields({
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-test',
      promptTemplate: '',
      toolsText: 'card.update_configuration\ncanvas.inspect',
      skillsText: '',
      toolsetsText: 'file\nterminal',
      mcpConnectionIdsText: '',
    });
    expect(delegate.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'delegate' });
    expect(delegate.access_mode).toBe('chatgpt-account');
    expect(delegate.tools).toEqual(['card.update_configuration', 'canvas.inspect']);
    expect(delegate.toolsets).toEqual(['file', 'terminal']);
  });

  it('consumes configured provider models without redefining them', () => {
    const parsed = parseCardEditorOptions({
      fields: [],
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

    expect(parsed.fields).toEqual([]);
    expect(parsed.modelsByProvider.openrouter).toEqual([
      {
        key: 'provider/model',
        label: 'Provider Model',
        providerModelId: 'provider/model',
      },
    ]);
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
      provider: 'catalog',
      providerToolName: `tool.${index}`,
      namespace: 'catalog',
      displayName: `Tool ${index}`,
      available: true,
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
          provider: 'main_mcp',
          providerToolName: 'retired.tool',
          available: false,
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
          provider: 'python_runtime',
          providerToolName: 'card.update_configuration',
          displayName: 'Update Card configuration',
          available: true,
          access: 'write',
        }],
        [],
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'card.update_configuration',
        availability: 'available',
      }),
    ]);
  });
});
