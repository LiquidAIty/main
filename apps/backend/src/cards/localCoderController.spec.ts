import { describe, expect, it } from 'vitest';

import {
  LOCAL_CODER_CONTROLLER_MODEL_KEY,
  normalizeLocalCoderControllerCard,
} from './localCoderController';

describe('normalizeLocalCoderControllerCard', () => {
  it('upgrades the broken mini controller model to the proven 5.1 default', () => {
    const normalized = normalizeLocalCoderControllerCard({
      id: 'card_local_coder',
      templateId: 'template_local_coder',
      runtimeBinding: 'local_coder',
      runtimeType: 'local_coder',
      runtimeOptions: {
        provider: 'openai',
        modelKey: 'gpt-5-mini',
        tools: ['run_local_coder'],
      },
    });

    expect(normalized.runtimeType).toBe('local_coder');
    expect(normalized.runtimeBinding).toBe('local_coder');
    expect(normalized.runtimeOptions?.provider).toBe('openai');
    expect(normalized.runtimeOptions?.modelKey).toBe(LOCAL_CODER_CONTROLLER_MODEL_KEY);
    expect(normalized.runtimeOptions?.tools).toEqual(['run_local_coder']);
  });

  it('does not rewrite unrelated cards', () => {
    const card = {
      id: 'card_thinkgraph_agent',
      runtimeBinding: 'thinkgraph_agent',
      runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5-mini', tools: [] },
    };

    expect(normalizeLocalCoderControllerCard(card)).toEqual(card);
  });
});
