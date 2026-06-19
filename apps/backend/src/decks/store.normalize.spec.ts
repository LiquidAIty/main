import { describe, expect, it } from 'vitest';

import { normalizeRuntimeOptions } from './store';

// Persistence proof: the local SLM provider survives the deck-store sanitizer, so a
// card's local-model selection is written into (and read back from) the deck JSON.
describe('deck store runtime-options provider persistence', () => {
  it('preserves the local SLM provider + model on save', () => {
    const out = normalizeRuntimeOptions({
      provider: 'local_openai_compatible',
      modelKey: 'local-gemma-slm',
    });
    expect(out?.provider).toBe('local_openai_compatible');
    expect(out?.modelKey).toBe('local-gemma-slm');
  });

  it('still keeps cloud providers', () => {
    expect(normalizeRuntimeOptions({ provider: 'openai' })?.provider).toBe('openai');
    expect(normalizeRuntimeOptions({ provider: 'openrouter' })?.provider).toBe('openrouter');
  });

  it('drops unknown providers', () => {
    expect(normalizeRuntimeOptions({ provider: 'bogus' })?.provider).toBe(null);
  });
});
