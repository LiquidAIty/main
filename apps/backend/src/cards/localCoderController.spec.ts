import { describe, expect, it } from 'vitest';

import { normalizeLocalCoderControllerCard, type CardLike } from './localCoderController';

describe('normalizeLocalCoderControllerCard', () => {
  it('keeps the card-selected provider and model (card authority — no override, no blacklist)', () => {
    const card: CardLike = {
      id: 'card_local_coder',
      templateId: 'template_local_coder',
      runtimeBinding: 'local_coder',
      runtimeType: 'local_coder',
      runtimeOptions: {
        provider: 'openrouter',
        modelKey: 'z-ai/glm-5.2',
        tools: [],
      },
    };
    const normalized = normalizeLocalCoderControllerCard(card);

    expect(normalized.runtimeType).toBe('local_coder');
    expect(normalized.runtimeBinding).toBe('local_coder');
    expect(normalized.runtimeOptions?.provider).toBe('openrouter');
    expect(normalized.runtimeOptions?.modelKey).toBe('z-ai/glm-5.2');
    expect(normalized.runtimeOptions?.tools).toEqual(['run_local_coder']);
  });

  it('normalizes identity and injects run_local_coder even when the card omits them', () => {
    const card: CardLike = {
      id: 'card_local_coder',
      templateId: 'template_local_coder',
      runtimeOptions: { provider: 'openai', modelKey: 'gpt-4o-mini' },
    };
    const normalized = normalizeLocalCoderControllerCard(card);

    expect(normalized.runtimeType).toBe('local_coder');
    expect(normalized.runtimeBinding).toBe('local_coder');
    // Provider/model are left exactly as the card set them — no forced default.
    expect(normalized.runtimeOptions?.provider).toBe('openai');
    expect(normalized.runtimeOptions?.modelKey).toBe('gpt-4o-mini');
    expect(normalized.runtimeOptions?.tools).toEqual(['run_local_coder']);
  });

  it('does not rewrite unrelated cards', () => {
    const card: CardLike = {
      id: 'card_research_agent',
      runtimeBinding: 'research_agent',
      runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5-mini', tools: [] },
    };

    expect(normalizeLocalCoderControllerCard(card)).toEqual(card);
  });
});
