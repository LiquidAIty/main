// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildActiveAgentManagerLocalConfig,
  canChooseCardExecutionMode,
  buildInputDictionarySelectedRows,
  buildDisplayedToolRows,
  toggleSavedToolAssignment,
} from './AgentManager';

describe('AgentManager active builder config', () => {
  it('builds the exact active local configuration payload', () => {
    const payload = buildActiveAgentManagerLocalConfig({
      runtimeBinding: 'main_chat',
      executionMode: 'auto-kanban',
      provider: 'openai',
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
      runtime_binding: 'main_chat',
      execution_mode: 'single',
      provider: 'openai',
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

  it('offers one execution-mode field only to ordinary cards', () => {
    expect(canChooseCardExecutionMode('assist', 'assistant_agent')).toBe(true);
    expect(canChooseCardExecutionMode(null, 'assistant_agent')).toBe(true);
    expect(canChooseCardExecutionMode('main_chat', 'assistant_agent')).toBe(false);
    expect(canChooseCardExecutionMode('local_coder', 'assistant_agent')).toBe(false);
    expect(canChooseCardExecutionMode(null, 'magentic_one')).toBe(false);

    const ordinary = buildActiveAgentManagerLocalConfig({
      runtimeBinding: 'assist',
      executionMode: 'auto-kanban',
      provider: 'openai',
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
    expect(ordinary.execution_mode).toBe('auto-kanban');
  });

  it('restores the canonical Save and Run actions without the regressed Run Test', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    // Restored first-class card editor contract: Save and Run are separate,
    // exact-label, production actions.
    expect(source).toContain("data-testid=\"agent-manager-save\"");
    expect(source).toContain("data-testid=\"agent-manager-run\"");
    expect(source).toContain("'Save'");
    expect(source).toContain("'Run'");
    // The regressed half-state is gone: no Run Test, no Save Card substitute.
    expect(source).not.toContain('Run Test');
    expect(source).not.toContain('Save Card');
  });

  it('keeps the card identity fields without adding another persistence path', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).toContain('cardName');
    expect(source).toContain('cardSubtext');
    expect(source).toContain('onChangeCardName');
    expect(source).toContain('onChangeCardSubtext');
    expect(source).toContain('Description');
    expect(source).not.toContain('Card mode');
    expect(source).not.toContain('Runtime Type');
    expect(source).toContain('Execution mode');
    expect(source).toContain('data-testid="agent-execution-mode"');
    expect(source).toContain('Advanced runtime');
    expect(source).not.toContain('GlassInspectorSection');
    expect(source).not.toContain('roleBadge');
    expect(source).toContain('Temperature');
    expect(source).toContain('Max tokens');
    expect(source).toContain('Max turns');
    expect(source).toContain('Enabled skills');
    expect(source).toContain('MCP connections');
    expect(source).toContain('Connection references only');
    expect(source).not.toContain('Profile selector');
    expect(source).not.toContain('HERMES_HOME');
  });

  it('separates Main availability from saved assignment across authority families', () => {
    const rows = buildDisplayedToolRows(
      [
        { name: 'engraphis.recall', title: 'Recall', capability: { cardAssignable: true, assignableRuntimeBindings: ['main_chat'] } },
        { name: 'graphiti.search_nodes', title: 'Search nodes', capability: { cardAssignable: true, assignableRuntimeBindings: ['hermes_steward'] } },
        { name: 'cbm.search_graph', title: 'Search graph', capability: { cardAssignable: true, assignableRuntimeBindings: ['local_coder'] } },
        { name: 'canvas.inspect', title: 'Inspect canvas', capability: { cardAssignable: true, assignableRuntimeBindings: ['main_chat'] } },
        { name: 'main.context', capability: { cardAssignable: false, assignableRuntimeBindings: [] } },
      ],
      ['graphiti.search_nodes', 'mystery.tool'],
      'main_chat',
      'assistant_agent',
    );

    expect(rows.map((row) => row.name)).toEqual([
      'graphiti.search_nodes',
      'mystery.tool',
      'engraphis.recall',
      'canvas.inspect',
    ]);
    expect(rows[0]).toMatchObject({ title: 'Search nodes', availability: 'incompatible' });
    expect(rows[1]).toEqual({ name: 'mystery.tool', availability: 'stale' });
    expect(rows.find((row) => row.name === 'cbm.search_graph')).toBeUndefined();
    expect(rows.find((row) => row.name === 'main.context')).toBeUndefined();
  });

  it('uses runtime-owned compatibility metadata instead of graph-authority policy', () => {
    const catalog = [
      { name: 'cbm.search_graph', capability: { cardAssignable: true, assignableRuntimeBindings: ['local_coder'] } },
      { name: 'write_mag_one_instructions', capability: { cardAssignable: true, assignableRuntimeBindings: ['hermes_steward'] } },
      { name: 'run_local_coder', capability: { cardAssignable: true, assignableRuntimeBindings: ['local_coder'] } },
      { name: 'main.context', capability: { cardAssignable: false } },
    ];

    expect(
      buildDisplayedToolRows(catalog, [], 'local_coder', 'assistant_agent').map((row) => row.name),
    ).toEqual(['cbm.search_graph', 'run_local_coder']);
    expect(
      buildDisplayedToolRows(catalog, [], 'hermes_steward', 'assistant_agent').map((row) => row.name),
    ).toEqual(['write_mag_one_instructions']);
    expect(toggleSavedToolAssignment([], 'cbm.search_graph', false)).toEqual([]);
  });

  it('coalesces duplicate catalog names by the current runtime without duplicating saved state', () => {
    const rows = buildDisplayedToolRows(
      [
        { name: 'web_search', title: 'Harness search', capability: { cardAssignable: true, assignableRuntimeBindings: ['main_chat'] } },
        { name: 'web_search', title: 'AutoGen search', capability: { cardAssignable: true, assignableRuntimeTypes: ['magentic_one'] } },
      ],
      ['web_search'],
      'assist',
      'magentic_one',
    );

    expect(rows).toEqual([
      expect.objectContaining({ name: 'web_search', title: 'AutoGen search', availability: 'available' }),
    ]);
  });

  it('keeps a saved registered but incompatible tool visible and removable', () => {
    const rows = buildDisplayedToolRows(
      [{ name: 'write_mag_one_instructions', capability: { cardAssignable: true, assignableRuntimeBindings: ['hermes_steward'] } }],
      ['write_mag_one_instructions'],
      'main_chat',
      'assistant_agent',
    );

    expect(rows).toEqual([
      expect.objectContaining({ name: 'write_mag_one_instructions', availability: 'incompatible' }),
    ]);
  });

  it('shows a saved non-assignable tool only as removable assigned state', () => {
    const rows = buildDisplayedToolRows(
      [{ name: 'main.context', capability: { cardAssignable: false } }],
      ['main.context'],
      'main_chat',
      'assistant_agent',
    );

    expect(rows).toEqual([
      expect.objectContaining({ name: 'main.context', availability: 'not_assignable' }),
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
      namespace: 'catalog',
      displayName: `Tool ${index}`,
      capability: {
        cardAssignable: true,
        assignableRuntimeBindings: ['main_chat'],
      },
    }));
    const page = allReferences.slice(4_000, 4_100);
    const selected = buildInputDictionarySelectedRows(
      [allReferences[9_999]],
      ['removed.tool'],
      'main_chat',
      'assistant_agent',
    );

    expect(page).toHaveLength(100);
    expect(selected).toEqual([
      expect.objectContaining({ name: 'catalog.tool.9999', availability: 'available' }),
      { name: 'removed.tool', availability: 'stale' },
    ]);
    expect(page.some((reference) => reference.canonicalId === 'catalog.tool.9999')).toBe(false);
  });

  it('keeps an incompatible selected dictionary tool removable', () => {
    expect(
      buildInputDictionarySelectedRows(
        [{
          canonicalId: 'write_mag_one_instructions',
          capability: {
            cardAssignable: true,
            assignableRuntimeBindings: ['hermes_steward'],
          },
        }],
        [],
        'main_chat',
        'assistant_agent',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'write_mag_one_instructions',
        availability: 'incompatible',
      }),
    ]);
  });

  it('recognizes a private native agent capability as a valid Coder selection', () => {
    expect(
      buildInputDictionarySelectedRows(
        [{
          canonicalId: 'run_local_coder',
          kind: 'agent',
          sourceId: 'local_coder',
          displayName: 'Local Coder',
          capability: {
            cardAssignable: true,
            assignableRuntimeBindings: ['local_coder'],
          },
        }],
        [],
        'local_coder',
        'assistant_agent',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'run_local_coder',
        kind: 'agent',
        sourceId: 'local_coder',
        availability: 'available',
      }),
    ]);
  });
});
