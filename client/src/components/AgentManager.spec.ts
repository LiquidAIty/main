// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildActiveAgentManagerLocalConfig,
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

  it('restores the existing card identity fields without adding another persistence path', () => {
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
    expect(source).not.toContain('Save Card');
    expect(source).not.toContain('>Temperature<');
    expect(source).not.toContain('>Max Tokens<');
  });
});
