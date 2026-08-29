// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildActiveAgentManagerLocalConfig,
  buildInputDictionarySelectedRows,
  buildDisplayedToolRows,
  AgentManager,
  hasHermesModelDrift,
  parseCardEditorOptions,
  type AgentManagerLocalConfig,
  selectKnowledgeGraphProjection,
  toggleSavedToolAssignment,
} from './AgentManager';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const runtimeOptions = {
  ok: true,
  fields: [
    { name: 'runtimeKind', options: ['hermes', 'autogen'] },
    { name: 'runtimeMode', options: ['main', 'delegate', 'kanban', 'assistant', 'magentic_one'] },
    { name: 'provider', options: ['openai', 'openrouter'] },
    { name: 'accessMode', options: ['chatgpt-account', 'openai-api', 'openrouter-api'] },
    { name: 'reasoningEffort', options: ['low', 'medium', 'high', 'xhigh'] },
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
    if (url === '/api/coder/card-editor/options') {
      return { ok: optionsAvailable, json: async () => optionsAvailable ? runtimeOptions : { ok: false } };
    }
    if (url.startsWith('/api/coder/input-data-dictionary/tools?')) {
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
  it('shows native-contract runtime choices without full Builder discovery or implicit model replacement', async () => {
    const fetchMock = mockEditorFetch();
    const onSave = vi.fn();
    const before = JSON.stringify(savedConfig);
    const { container } = render(React.createElement(AgentManager, {
      agentType: 'agent_builder', activeTab: 'Runtime', cardId: 'card-one', projectId: 'p', deckId: 'd',
      localConfig: savedConfig, onSaveLocalConfig: onSave,
    }));
    const provider = screen.getByLabelText('Saved Card provider') as HTMLSelectElement;
    const model = screen.getByLabelText('Saved Card model') as HTMLSelectElement;
    await waitFor(() => expect(provider.disabled).toBe(false));
    expect([...screen.getByLabelText<HTMLSelectElement>('Runtime').options].map((option) => option.value))
      .toEqual(['hermes', 'autogen']);
    expect(model.value).toBe('removed-model');
    expect(model.selectedOptions[0].text).toBe('removed-model (unavailable — saved)');
    expect(onSave).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/input-data-dictionary/card-editor'))).toBe(false);
    expect(container.textContent).not.toMatch(/\bIDD\b|\bIDF\b|Input Data (Dictionary|Definition)/i);

    fireEvent.change(provider, { target: { value: 'openrouter' } });
    expect(model.value).toBe('removed-model');
    expect(screen.getByRole('option', { name: 'Model B' })).not.toBeNull();
    fireEvent.click(screen.getByTestId('agent-manager-save'));
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
    const provider = screen.getByLabelText('Saved Card provider') as HTMLSelectElement;
    expect(provider.value).toBe('local_openai_compatible');
    expect(provider.selectedOptions[0].text).toContain('unavailable — saved');
    expect(provider.disabled).toBe(!available);
    expect(screen.getByLabelText<HTMLSelectElement>('Saved Card model').value).toBe('removed-model');
    if (!available) expect(screen.getByRole('alert').textContent).toContain('Runtime options unavailable');
    fireEvent.click(screen.getByTestId('agent-manager-save'));
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
    expect(source).toContain('Saving this Card cannot change the profile.');
    expect(source).not.toMatch(/applyNativeHermesCard|previewNativeHermesCard|buildHermesCardDraftFromLocalConfig/);
    expect(source).toContain("method: 'profiles.configure'");
    expect(nativeClient).toContain('/native`');
    expect(nativeClient).not.toMatch(/\/preview|expectedFingerprint|HermesCardDraft/);
    expect(source).not.toContain('runNativeApply(buildCurrentLocalPayload');
  });

  it('replaces Task with Terminal while retaining exactly one mission composer', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );
    const pageSource = readFileSync(
      path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'),
      'utf8',
    );

    expect(pageSource).toContain(
      "const BUILDER_NODE_TABS = ['Prompt', 'Knowledge', 'Tools', 'Runtime', 'Terminal'] as const;",
    );
    expect(source).toContain("activeTab === 'Terminal' && showTaskComposer");
    expect(source).not.toContain("activeTab === 'Task'");
    expect(source.match(/aria-label="Dynamic context \/ input"/g)).toHaveLength(1);
    expect(source.match(/data-testid="agent-manager-run"/g)).toHaveLength(1);
    expect(source).toContain('saveRevisionAtStartRef.current = openDeckRevision ?? null');
    expect(source).toContain('openDeckRevision !== saveRevisionAtStartRef.current');
    expect(source.match(/setSaveCardStatus\('saved'\)/g)).toHaveLength(1);
    expect(source).not.toContain('A short fallback covers the no-op save');
    expect(pageSource).toContain("selectedCard?.runtime.kind === 'hermes' && selectedCard.runtime.mode === 'main'");
    expect(pageSource).toContain('showTaskComposer={showStandaloneTestControls}');
    expect(pageSource).not.toContain("['Invocation', 'Prompt', 'Knowledge', 'Capabilities', 'Runtime']");
  });

  it('keeps stable Card versions separate from transient Card input', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain("data-testid=\"agent-manager-save\"");
    expect(source).toContain("data-testid=\"agent-manager-run\"");
    expect(source).toContain('Save Card Version');
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
    expect(source).toContain('Python materializes this input with the saved Card');
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
      activeTab: 'Terminal',
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

    expect(screen.getByTestId('selected-run-idf').textContent).toContain('Selected Run · input');
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('system 40');
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('graph 30');
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('saved Run input');
    expect(screen.getByTestId('selected-run-idf').textContent).not.toMatch(/\bIDD\b|\bIDF\b|Input Data (Dictionary|Definition)/i);
    fireEvent.click(screen.getByRole('button', { name: 'Export Run input…' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(idfText));
    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'research-baseline.idf',
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('shows selected-Run actual graph data inside the one retained IDF', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, fields: [], catalogs: { 'configured-models': [] } }),
    })));
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder',
      activeTab: 'Knowledge',
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

    expect(screen.getByTestId('selected-run-idf-graph').textContent).toContain('3 records');
    expect(screen.getByTestId('selected-run-idf-graph').textContent).toContain('ThinkGraph, KnowGraph');
    expect(screen.getByTestId('selected-run-idf-graph-token-estimate').textContent).toContain('42 tokens');
    expect(screen.getByTestId('selected-run-idf-graph-token-estimate').textContent).toContain('saved Run input');
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
    expect(source).toContain('openNativeLearningNode(node.id)');
    expect(source).toContain('applyNativeLearningEdit()');
    expect(nativeClient).toContain("method: 'learning.detail'");
    expect(source).toContain('data-testid="agent-manager-learn"');
    expect(source).not.toContain('Built-in tools: {nativeHermesState.binding.nativeTools');
    expect(source).not.toContain('Detailed graph, Learn, and mutation controls are intentionally deferred');
  });

  it('places one staged Coder or Mag One mission and exact graph data in transient Card state', () => {
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
    expect(chatSource).toContain("['write_mag_one_instructions', 'card.run_assistant_agent']");
    expect(chatSource).toContain("['card.load_graph_references', 'card.run_assistant_agent']");
    expect(chatSource).toContain('onCardReviewStaged');
    expect(chatSource).toContain('onCardGraphReferenceLoaded');
    expect(pageSource).toContain('const [transientCardInputs, setTransientCardInputs]');
    expect(pageSource).toContain('const [transientCardGraphContext, setTransientCardGraphContext]');
    expect(pageSource).toContain('[target.id]: loaded.mission');
    expect(pageSource).toContain("target.runtime.kind === 'hermes' && target.runtime.mode === 'delegate'");
    expect(pageSource).toContain("target.runtime.kind === 'autogen' && target.runtime.mode === 'magentic_one'");
    expect(pageSource).toContain('invocation: null');
    expect(chatSource).not.toContain('reviewContext.idf');
    expect(pageSource).toContain('dataAnchors: (transientCardGraphContext[selectedCard.id] || [])');
    expect(source).toContain('Exact model-bound native graph context');
    expect(source).toContain('NativeGraphProjectionSurface');
    expect(source).toContain('loadedGraphProjection');
    expect(source).not.toContain('Saved Mag One workers');
    expect(source).toContain('onRemoveGraphReference');
    expect(source).toContain('onMoveGraphReference');
    expect(source).not.toContain('Read-only Mag One proposal');
    expect(pageSource).toContain('onCardReviewStaged: handleCardReviewStaged');
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
    expect(source).toContain('aria-label="Runtime mode"');
    expect(source).toContain('data-testid="agent-runtime-mode"');
    expect(source).toContain('Advanced runtime');
    expect(source).not.toContain('GlassInspectorSection');
    expect(source).not.toContain('roleBadge');
    expect(source).toContain('aria-label="Temperature"');
    expect(source).toContain('aria-label="Max tokens"');
    expect(source).toContain('aria-label="Max turns"');
    expect(source).toContain('/api/coder/card-editor/options');
    expect(source).not.toContain('/api/coder/input-data-dictionary/card-editor');
    expect(source).not.toContain('/api/config/models');
    expect(source).not.toContain('<option value="openai">');
    expect(source).toContain('Card skill grants');
    expect(source).toContain('Card connection references');
    expect(source).toContain('References existing LiquidAIty connections by ID');
    expect(source).toContain('Apply Role to profile');
    expect(source).toContain('Apply Soul to profile');
    expect(source).toContain('Apply Model');
    expect(source).toContain('Apply Skills');
    expect(source).toContain('Apply Toolsets');
    expect(source).toContain('Apply Connections');
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
        { name: 'constellation.context', title: 'Context', sourceIds: ['constellation'] },
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
      'constellation.context',
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
