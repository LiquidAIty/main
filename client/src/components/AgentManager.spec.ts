import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildActiveAgentManagerLocalConfig } from './AgentManager';

describe('AgentManager active builder config', () => {
  it('builds save payloads without legacy routing-like blackboard policy fields', () => {
    const payload = buildActiveAgentManagerLocalConfig({
      runtimeBinding: 'main_chat',
      provider: 'openai',
      modelKey: 'gpt-test',
      temperature: 0.2,
      maxTokens: 800,
      promptTemplate: 'test prompt',
      toolsText: 'web',
      knowledgeText: 'docs',
      responseFormatText: '',
    });

    expect(payload).toEqual({
      runtime_binding: 'main_chat',
      provider: 'openai',
      model_key: 'gpt-test',
      temperature: 0.2,
      max_tokens: 800,
      prompt_template: 'test prompt',
      tools: ['web'],
      knowledge_sources: ['docs'],
      response_format: null,
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
});
