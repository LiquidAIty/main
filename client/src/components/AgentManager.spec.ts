// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildActiveAgentManagerLocalConfig,
} from './AgentManager';
import { GPT_CARD_MODEL_PRESETS } from '../features/agentbuilder/deck/deckPrimitives';

describe('AgentManager active builder config', () => {
  it('offers the three OpenRouter GPT comparison presets without choosing one automatically', () => {
    expect(GPT_CARD_MODEL_PRESETS).toEqual([
      { label: 'Luna', modelKey: 'openai/gpt-5.6-luna' },
      { label: 'Terra', modelKey: 'openai/gpt-5.6-terra' },
      { label: 'Sol', modelKey: 'openai/gpt-5.6-sol' },
    ]);
  });

  it('builds save payloads without legacy routing-like blackboard policy fields', () => {
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
    expect(Object.keys(payload)).not.toContain('input_sources');
    expect(Object.keys(payload)).not.toContain('blackboard_read_fields');
    expect(Object.keys(payload)).not.toContain('blackboard_write_fields');
    expect(Object.keys(payload)).not.toContain('next_move_authority');
  });

  it('no longer contains legacy blackboard policy control names in the active editor source', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).not.toContain('input_sources');
    expect(source).not.toContain('blackboard_read_fields');
    expect(source).not.toContain('blackboard_write_fields');
    expect(source).not.toContain('next_move_authority');
  });

  it('keeps the restored inspector free of identity, mode, and advanced panel inventions', () => {
    const filePath = path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx');
    const source = readFileSync(filePath, 'utf8');

    expect(source).not.toContain('Card identity');
    expect(source).not.toContain('Card mode');
    expect(source).not.toContain('Runtime Type');
    expect(source).not.toContain('Execution Mode');
    expect(source).not.toContain('Advanced');
    expect(source).not.toContain('GlassInspectorSection');
  });
});
