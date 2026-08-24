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
  parseNamedRuntimeInput,
  parseCardEditorInputDataDictionary,
  selectKnowledgeGraphProjection,
  toggleSavedToolAssignment,
} from './AgentManager';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AgentManager active builder config', () => {
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

  it('uses the historical five Card tabs and exactly one Task composer', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );
    const pageSource = readFileSync(
      path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'),
      'utf8',
    );

    expect(pageSource).toContain(
      "const BUILDER_NODE_TABS = ['Prompt', 'Knowledge', 'Tools', 'Runtime', 'Task'] as const;",
    );
    expect(source).toContain("activeTab === 'Task' && showTaskComposer");
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
    expect(source).not.toContain('agent-manager-save-icf');
    expect(source).toContain('Export ICF…');
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

  it('shows and exports the selected Run ICF with an explicit estimate breakdown', async () => {
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
    vi.stubGlobal('prompt', vi.fn(() => 'research-baseline.icf'));
    const icfText = '{"format":"liquidaity.input-context"}\n';
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder',
      activeTab: 'Task',
      cardId: 'card-one',
      localConfig: { runtime: { kind: 'autogen', mode: 'assistant' } },
      onSaveLocalConfig: vi.fn(),
      showTaskComposer: false,
      runInputs: {
        available: true,
        runId: 'run-one',
        icfText,
        igfText: '{"kind":"header","format":"liquidaity.input-graph"}\n',
        inputSummary: { icfBytes: 420, igfBytes: 180 },
        icf: { estimates: {
          totalModelVisibleTokens: 95,
          systemContextTokens: 40,
          taskTokens: 20,
          outputContractTokens: 5,
          graphContextTokens: 30,
        } },
        igf: { header: { recordCounts: { total: 2 }, authorities: ['CodeGraph'] }, records: [] },
      },
    }));

    expect(screen.getByTestId('selected-run-icf').textContent).toContain('Selected Run · in.icf');
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('system 40');
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('graph 30');
    expect(screen.getByTestId('selected-run-token-estimate').textContent).toContain('model-agnostic');
    fireEvent.click(screen.getByRole('button', { name: 'Export ICF…' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(icfText));
    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'research-baseline.icf',
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('imports only the ICF transient task and clears it without changing Card configuration', async () => {
    const onChangePromptTestInput = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, fields: [], catalogs: { 'configured-models': [] } }),
    })));
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder',
      activeTab: 'Task',
      cardId: 'card-one',
      localConfig: { runtime: { kind: 'autogen', mode: 'assistant' } },
      onSaveLocalConfig: vi.fn(),
      onChangePromptTestInput,
      showTaskComposer: false,
      runInputs: {
        available: true, runId: 'run-one', icf: { estimates: {} },
        igf: { header: { recordCounts: { total: 0 }, authorities: [] }, records: [] },
        inputSummary: { icfBytes: 1, igfBytes: 1 }, icfText: '{}\n', igfText: '{}\n',
      },
    }));
    const file = new File([], 'research-baseline.icf', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: async () => JSON.stringify({
        format: 'liquidaity.input-context',
        stable: {
          provider: { provider: 'ignored-provider' },
          runtime: { kind: 'hermes', mode: 'main', profile: 'ignored-profile' },
        },
        variable: { task: 'Imported bounded task.' },
        capabilities: { enabledTools: ['ignored-tool'] },
      }),
    });
    fireEvent.change(screen.getByLabelText('Import named .icf'), { target: { files: [file] } });
    await waitFor(() => expect(onChangePromptTestInput).toHaveBeenCalledWith('Imported bounded task.'));
    expect(screen.getByTestId('named-icf-inspection').textContent).toContain('Saved Card grants, profile, provider, and model were ignored');
    fireEvent.click(screen.getByRole('button', { name: 'Clear imported ICF' }));
    expect(onChangePromptTestInput).toHaveBeenLastCalledWith('');
  });

  it('previews the next ICF through the real Task control without creating a Run', () => {
    const onPreviewCard = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, fields: [], catalogs: { 'configured-models': [] } }),
    })));
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder',
      activeTab: 'Task',
      cardId: 'card-one',
      localConfig: { runtime: { kind: 'autogen', mode: 'assistant' } },
      onSaveLocalConfig: vi.fn(),
      promptTestInput: 'Preview this exact task.',
      onPreviewCard,
      runResult: {
        status: 'previewed', output: '', error: null, tools: [],
        invocation: {
          ephemeral: true, cardRevisionId: 'revision-one', cardRevision: 1,
          cardRevisionSha256: 'sha', runtimeOwner: 'autogen',
          icf: { format: 'liquidaity.input-context', variable: { task: 'Preview this exact task.' } },
          igf: { header: { recordCounts: { total: 0 } }, records: [] },
          cardIdentity: { cardId: 'card-one' },
        },
      },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview inputs' }));
    expect(onPreviewCard).toHaveBeenCalledOnce();
    expect(screen.getByTestId('next-icf-preview').textContent).toContain('No Run exists');
    expect(screen.getByTestId('next-icf-preview').textContent).toContain('Preview this exact task.');
  });

  it('shows and imports selected-Run IGF selections through the native-reread callback only', async () => {
    const onImportIgfSelections = vi.fn(async () => undefined);
    const onClearInvocation = vi.fn();
    const onClearGraphContext = vi.fn();
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, fields: [], catalogs: { 'configured-models': [] } }),
    })));
    vi.stubGlobal('prompt', vi.fn(() => 'research-baseline.igf'));
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    })));
    render(React.createElement(AgentManager, {
      agentType: 'agent_builder',
      activeTab: 'Knowledge',
      cardId: 'card-one',
      localConfig: { runtime: { kind: 'autogen', mode: 'assistant' } },
      onSaveLocalConfig: vi.fn(),
      onImportIgfSelections,
      onClearInvocation,
      onClearGraphContext,
      runInputs: {
        available: true,
        runId: 'run-one',
        icfText: '{}\n',
        igfText: '{"kind":"header","format":"liquidaity.input-graph"}\n',
        inputSummary: { icfBytes: 10, igfBytes: 180 },
        icf: { estimates: { graphContextTokens: 42 } },
        igf: {
          header: { recordCounts: { total: 3 }, authorities: ['ThinkGraph', 'KnowGraph'] },
          records: [],
        },
      },
    }));

    expect(screen.getByTestId('selected-run-igf').textContent).toContain('3 records');
    expect(screen.getByTestId('selected-run-igf').textContent).toContain('ThinkGraph, KnowGraph');
    expect(screen.getByTestId('selected-run-igf-token-estimate').textContent).toContain('42 tokens');
    expect(screen.getByTestId('selected-run-igf-token-estimate').textContent).toContain('model-agnostic');
    expect(screen.queryByText(/sub-worker input/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export IGF…' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith('{"kind":"header","format":"liquidaity.input-graph"}\n'));
    expect(close).toHaveBeenCalledOnce();
    const file = new File([], 'research-baseline.igf', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: async () => [
        JSON.stringify({ kind: 'header', format: 'liquidaity.input-graph' }),
        JSON.stringify({
          kind: 'selection', authority: 'CodeGraph', nativeId: 'pkg.materialize_input_pair',
          content: { reason: 'Current owner', required: true },
        }),
        '',
      ].join('\n'),
    });
    fireEvent.change(screen.getByLabelText('Import named .igf'), { target: { files: [file] } });
    await waitFor(() => expect(onImportIgfSelections).toHaveBeenCalledWith([{
      authority: 'CodeGraph', nativeId: 'pkg.materialize_input_pair', reason: 'Current owner',
      boundedExpansion: 1, resultLimit: 12, required: true,
    }]));
    expect(screen.getByTestId('named-igf-inspection').textContent).toContain('current native reread');
    fireEvent.click(screen.getByRole('button', { name: 'Clear imported IGF' }));
    expect(onClearGraphContext).toHaveBeenCalledOnce();
    expect(onClearInvocation).not.toHaveBeenCalled();
  });

  it('parses named ICF and IGF only for local inspection', () => {
    expect(parseNamedRuntimeInput('study.icf', '{"format":"liquidaity.input-context"}\n').kind).toBe('icf');
    expect(parseNamedRuntimeInput(
      'selection.igf',
      '{"kind":"header","format":"liquidaity.input-graph"}\n{"kind":"node"}\n',
    ).kind).toBe('igf');
    expect(() => parseNamedRuntimeInput('wrong.json', '{}')).toThrow('runtime_input_extension_invalid');
    expect(() => parseNamedRuntimeInput(
      'secret.icf',
      '{"format":"liquidaity.input-context","api_key":"forbidden"}',
    )).toThrow('input_file_secret_field_forbidden');
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
    expect(chatSource).toContain('onCardInvocationStaged');
    expect(chatSource).toContain('onCardGraphReferenceLoaded');
    expect(pageSource).toContain('const [transientCardInputs, setTransientCardInputs]');
    expect(pageSource).toContain('const [transientCardGraphContext, setTransientCardGraphContext]');
    expect(pageSource).toContain('[target.id]: loaded.mission');
    expect(pageSource).toContain("target.runtime.kind === 'hermes' && target.runtime.mode === 'delegate'");
    expect(pageSource).toContain("target.runtime.kind === 'autogen' && target.runtime.mode === 'magentic_one'");
    expect(pageSource).toContain('invocation: loaded.invocation');
    expect(pageSource).toContain('dataAnchors: (transientCardGraphContext[selectedCard.id] || [])');
    expect(source).toContain('Exact model-bound native graph context');
    expect(source).toContain('NativeGraphProjectionSurface');
    expect(source).toContain('loadedGraphProjection');
    expect(source).not.toContain('Saved Mag One workers');
    expect(source).toContain('onRemoveGraphReference');
    expect(source).toContain('onMoveGraphReference');
    expect(source).not.toContain('Read-only Mag One proposal');
    expect(pageSource).toContain('onCardInvocationStaged: handleCardInvocationStaged');
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
    const idd = readFileSync(path.resolve(process.cwd(), 'LiquidAIty.idd'), 'utf8');

    expect(source).toContain('cardName');
    expect(source).toContain('cardSubtext');
    expect(source).toContain('onChangeCardName');
    expect(source).toContain('onChangeCardSubtext');
    expect(source).toContain('Description');
    expect(source).not.toContain('Card mode');
    expect(source).not.toContain('Runtime Type');
    expect(idd).toContain('label = "Runtime mode"');
    expect(source).toContain('data-testid="agent-runtime-mode"');
    expect(source).toContain('Advanced runtime');
    expect(source).not.toContain('GlassInspectorSection');
    expect(source).not.toContain('roleBadge');
    expect(idd).toContain('label = "Temperature"');
    expect(idd).toContain('label = "Max tokens"');
    expect(idd).toContain('label = "Max turns"');
    expect(source).toContain('/api/coder/input-data-dictionary/card-editor');
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

  it('consumes IDD fields and materialized provider models without redefining them', () => {
    const parsed = parseCardEditorInputDataDictionary({
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
        { name: 'engraphis.recall', title: 'Recall', sourceIds: ['engraphis'] },
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
      'engraphis.recall',
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
