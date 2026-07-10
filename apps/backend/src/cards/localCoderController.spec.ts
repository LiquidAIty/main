import { describe, expect, it } from 'vitest';

import {
  LOCAL_CODER_CONTROLLER_MODEL_KEY,
  LOCAL_CODER_CONTROLLER_PROVIDER,
  normalizeLocalCoderControllerCard,
} from './localCoderController';

describe('normalizeLocalCoderControllerCard', () => {
  it('upgrades stale controller models to the configured GPT default', () => {
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
    expect(normalized.runtimeOptions?.provider).toBe(LOCAL_CODER_CONTROLLER_PROVIDER);
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
