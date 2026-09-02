import { describe, expect, it } from 'vitest';

import type { AgentCardInstance } from '../../../types/agentgraph';
import {
  buildAgentBuilderOperation,
  buildAgentBuilderProposal,
  parseAgentBuilderPalette,
  parseAgentBuilderTools,
} from './agentBuilderOperation';

const selected: AgentCardInstance = {
  id: 'card_selected', kind: 'agent', templateId: 'template_assist', title: 'Selected',
  _cardRevisionId: 'card-revision-selected',
  prompt: 'Old prompt', runtime: { kind: 'autogen', mode: 'assistant' },
  runtimeOptions: { tools: ['web_search'] }, parentGraphId: null,
  position: { x: 0, y: 0 }, status: 'ready',
};

describe('Agent Builder operation composer', () => {
  it('projects only buildable IDD templates and current configured models', () => {
    const result = parseAgentBuilderPalette({
      templates: {
        template_assist: { label: 'Custom assistant' },
        template_magentic: { label: 'Magentic-One' },
      },
      catalogs: { 'configured-models': [{
        provider: 'openai', key: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
        label: 'Luna',
      }] },
    });
    expect(result.templates).toEqual([{ id: 'template_assist', label: 'Custom assistant' }]);
    expect(result.models[0]).toMatchObject({
      provider: 'openai', modelKey: 'gpt-5.6-luna', accessMode: 'chatgpt-account',
    });
  });

  it('builds an exact edit operation without unrelated stable fields', () => {
    expect(buildAgentBuilderOperation({
      mode: 'edit', target: selected, templateId: '', title: '', role: '',
      prompt: 'New prompt', tools: ['web_search', 'web_search'], model: null,
      deckRevision: 'deck-revision-one',
    })).toEqual({
      mode: 'edit', expectedDeckRevision: 'deck-revision-one',
      targetCardId: 'card_selected', targetCardRevisionId: 'card-revision-selected',
      prompt: 'New prompt', tools: ['web_search'],
    });
  });

  it('builds a basic ordinary create operation and rejects system templates', () => {
    const model = {
      provider: 'openai', modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
      accessMode: 'chatgpt-account' as const, label: 'Luna',
    };
    expect(buildAgentBuilderOperation({
      mode: 'create', target: null, templateId: 'template_assist', title: 'Researcher',
      role: 'Grounded researcher', prompt: 'Research with citations.', tools: ['web_search'], model,
      deckRevision: 'deck-revision-one',
    })).toMatchObject({
      mode: 'create', templateId: 'template_assist', title: 'Researcher',
      role: 'Grounded researcher', prompt: 'Research with citations.', tools: ['web_search'],
      model: { modelKey: 'gpt-5.6-luna' },
    });
    expect(() => buildAgentBuilderOperation({
      mode: 'create', target: null, templateId: 'template_magentic', title: 'No',
      role: 'No', prompt: 'No', tools: [], model, deckRevision: 'deck-revision-one',
    })).toThrow('Choose one buildable IDD template.');
  });

  it('uses only available current tool-catalog entries', () => {
    expect(parseAgentBuilderTools({ references: [
      { canonicalId: 'web_search', namespace: 'web', displayName: 'Web', access: 'read', availability: 'available' },
      { canonicalId: 'stale.tool', access: 'write', availability: 'disabled' },
    ] })).toEqual([{ id: 'web_search', label: 'Web', access: 'read', category: 'web' }]);
  });

  it('renders a concise exact create configuration or selected-Card diff', () => {
    const edit = buildAgentBuilderOperation({
      mode: 'edit', target: selected, templateId: '', title: '', role: '',
      prompt: 'New prompt', tools: ['canvas.inspect'], model: null,
      deckRevision: 'deck-revision-one',
    });
    expect(buildAgentBuilderProposal(edit, selected)).toEqual({
      mode: 'edit', expectedDeckRevision: 'deck-revision-one',
      targetCardId: 'card_selected', targetCardRevisionId: 'card-revision-selected',
      changes: {
        prompt: { from: 'Old prompt', to: 'New prompt' },
        tools: { from: ['web_search'], to: ['canvas.inspect'] },
      },
    });
    const create = buildAgentBuilderOperation({
      mode: 'create', target: null, templateId: 'template_assist', title: 'Planner',
      role: 'Plans', prompt: 'Plan.', tools: [], deckRevision: 'deck-revision-one', model: {
        provider: 'openai', modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
        accessMode: 'chatgpt-account', label: 'Luna',
      },
    });
    expect(buildAgentBuilderProposal(create, null)).toMatchObject({
      mode: 'create', expectedDeckRevision: 'deck-revision-one', configuration: {
        templateId: 'template_assist', title: 'Planner', role: 'Plans', prompt: 'Plan.',
      },
    });
  });
});
