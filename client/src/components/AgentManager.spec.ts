// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildActiveAgentManagerLocalConfig,
  buildInputDictionarySelectedRows,
  buildDisplayedToolRows,
  parseCardEditorInputDataDictionary,
  toggleSavedToolAssignment,
} from './AgentManager';

describe('AgentManager active builder config', () => {
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
      toolsText: 'cbm.search_graph',
      skillsText: '',
      toolsetsText: 'file\nterminal',
      mcpConnectionIdsText: '',
    });
    expect(coder.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: 'coder' });
    expect(coder.access_mode).toBe('chatgpt-account');
    expect(coder.tools).toEqual(['cbm.search_graph']);
    expect(coder.toolsets).toEqual(['file', 'terminal']);
  });

  it('keeps stable Card versions separate from transient Card input', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain("data-testid=\"agent-manager-save\"");
    expect(source).toContain("data-testid=\"agent-manager-run\"");
    expect(source).toContain('Save Card Version');
    expect(source).toContain('Run transient');
    expect(source).not.toContain('agent-manager-save-idf');
    expect(source).not.toContain('agent-manager-export-idf');
    expect(source).not.toContain('Run Test');
  });

  it('previews the exact Python materialization without assembling it in TypeScript', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');
    const pageSource = readFileSync(
      path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'),
      'utf8',
    );

    expect(source).toContain('Dynamic context / input');
    expect(source).toContain('Python combines this input with the saved Card');
    expect(source).toContain('value={JSON.stringify(runResult.invocation.idf, null, 2)}');
    expect(source).toContain('readOnly');
    expect(pageSource).toContain('invocation: result.invocation || null');
  });

  it('places the exact Mag One proposal in unsaved per-Card input state', () => {
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

    expect(chatSource).toContain("event.toolName === 'write_mag_one_instructions'");
    expect(chatSource).toContain('onMagOneInstructionsProposed');
    expect(pageSource).toContain('const [transientCardInputs, setTransientCardInputs]');
    expect(pageSource).toContain('[target.id]: proposal.instructions');
    expect(source).toContain('Read-only Mag One proposal');
    expect(source).toContain('Completion:');
    expect(source).toContain('writes/effects');
    expect(source).toContain('This review does not save Cards, change wires, or launch Mag One.');
    expect(pageSource).toContain('onMagOneInstructionsProposed: handleMagOneInstructionsProposed');
    expect(pageSource).not.toContain('persistTransientCardInputs');
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
    expect(source).toContain('Enabled skills');
    expect(source).toContain('MCP connections');
    expect(source).toContain('Connection references only');
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
