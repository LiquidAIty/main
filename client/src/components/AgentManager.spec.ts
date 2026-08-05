// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildActiveAgentManagerLocalConfig,
  buildDisplayedToolRows,
  toggleSavedToolAssignment,
} from './AgentManager';

describe('AgentManager active builder config', () => {
  it('builds the exact active local configuration payload', () => {
    const payload = buildActiveAgentManagerLocalConfig({
      runtimeBinding: 'main_chat',
      provider: 'openai',
      modelKey: 'gpt-test',
      temperature: 0.2,
      maxTokens: 800,
      promptTemplate: 'test prompt',
      toolsText: 'web',
    });

    expect(payload).toEqual({
      runtime_binding: 'main_chat',
      provider: 'openai',
      model_key: 'gpt-test',
      temperature: 0.2,
      max_tokens: 800,
      prompt_template: 'test prompt',
      tools: ['web'],
    });
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
    expect(source).not.toContain('Execution Mode');
    expect(source).not.toContain('Advanced');
    expect(source).not.toContain('GlassInspectorSection');
    expect(source).not.toContain('roleBadge');
    expect(source).not.toContain('>Temperature<');
    expect(source).not.toContain('>Max Tokens<');
  });

  it('keeps saved tools visible when they are outside the card authority', () => {
    const rows = buildDisplayedToolRows(
      [
        { name: 'engraphis.recall', title: 'Recall', capability: { graphAuthority: 'engraphis' } },
        { name: 'graphiti.search_nodes', title: 'Search nodes', capability: { graphAuthority: 'graphiti' } },
        { name: 'cbm.search_graph', title: 'Search graph', capability: { graphAuthority: 'cbm' } },
      ],
      ['graphiti.search_nodes', 'mystery.tool', 'cbm.search_graph'],
      'engraphis',
    );

    expect(rows.map((row) => row.name)).toEqual([
      'engraphis.recall',
      'graphiti.search_nodes',
      'mystery.tool',
      'cbm.search_graph',
    ]);
    expect(rows[1]).toMatchObject({ title: 'Search nodes' });
    expect(rows[2]).toEqual({ name: 'mystery.tool' });
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
});
