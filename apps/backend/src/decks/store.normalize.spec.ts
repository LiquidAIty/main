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

// Persistence proof: a card's SELECTED tool ids survive the deck-store sanitizer
// verbatim — the save/load roundtrip can never rewrite, reorder-filter, or
// substitute a card's tool assignment (the ThinkGraph card depends on exactly
// [read_thinkgraph_scope, apply_thinkgraph_patch] surviving).
describe('deck store runtime-options tool persistence', () => {
  it('preserves selected tool ids exactly as saved', () => {
    const out = normalizeRuntimeOptions({
      tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'],
    });
    expect(out?.tools).toEqual(['read_thinkgraph_scope', 'apply_thinkgraph_patch']);
  });

  it('trims whitespace but never renames or invents tool ids', () => {
    const out = normalizeRuntimeOptions({ tools: ['  read_thinkgraph_scope  ', '', 42] });
    expect(out?.tools).toEqual(['read_thinkgraph_scope']);
  });

  it('an absent selection stays absent — no default tools are injected', () => {
    expect(normalizeRuntimeOptions({})?.tools).toBe(null);
  });
});
