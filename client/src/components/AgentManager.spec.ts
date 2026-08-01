// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildActiveAgentManagerLocalConfig,
  buildAssignmentContextProjection,
  contextGraphLayers,
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

  it('projects only the materialized graph layers selected for the card context', () => {
    const runContext = {
      assignment: {
        assignmentId: 'assignment:one',
        correlationId: 'corr:one',
        instruction: 'Review the selected evidence.',
        state: 'claimed',
        runTrace: {},
        result: null,
      },
      deliveredContext: {
        graphViews: [
          { viewId: 'graphview:one', displayLabel: 'Review context', receivingRole: 'coder' },
        ],
        manifest: {
          manifestHash: 'manifest:one',
          records: [
            {
              authority: 'thinkgraph',
              kind: 'node',
              nativeId: 'thought:one',
              representation: 'A project interpretation',
              required: true,
              deliveryOrder: 1,
            },
            {
              authority: 'knowgraph',
              kind: 'node',
              nativeId: 'fact:one',
              representation: 'A sourced fact',
              required: true,
              deliveryOrder: 2,
            },
          ],
          unresolvedReferences: [],
        },
      },
    } as any;

    expect(contextGraphLayers(runContext)).toEqual([
      'agentgraph',
      'thinkgraph',
      'knowgraph',
    ]);
    const projection = buildAssignmentContextProjection(
      runContext,
      'project:one',
      ['agentgraph', 'knowgraph'],
    );

    expect(projection?.nodes.map((node) => node.id)).toEqual([
      'agentgraph:assignment:assignment:one',
      'agentgraph:graphview:graphview:one',
      'knowgraph:fact:one',
    ]);
    expect(projection?.edges.map((edge) => edge.predicate)).toEqual([
      'SELECTS_VIEW',
      'DELIVERS_CONTEXT',
    ]);
    expect(projection?.nodes.some((node) => node.id.includes('thought:one'))).toBe(false);
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
