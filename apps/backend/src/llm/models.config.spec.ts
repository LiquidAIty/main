/**
 * Entity: Model Selection
 * Relationship: Verifies pinned model identities and provider classifications remain available to the canonical Card model selector without compatibility aliases.
 */

import { describe, it, expect } from 'vitest';
import { listConfiguredModelOptions, MODEL_REGISTRY } from './models.config';

// Canonical model catalog: DeepSeek V4 Flash 0731 is a first-class entry,
// selectable through the canonical Card options and IDD projections.
describe('canonical model catalog — DeepSeek V4 Flash 0731', () => {
  const KEY = 'deepseek/deepseek-v4-flash-0731';

  it('registers the canonical entry with the expected fields', () => {
    const entry = MODEL_REGISTRY[KEY];
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      label: 'OpenRouter DeepSeek V4 Flash 0731',
      provider: 'openrouter',
      id: 'deepseek/deepseek-v4-flash-0731',
    });
  });

  it('is classified as an OpenRouter model for the card selector', () => {
    // The Card options projection groups this same registry by provider.
    const openrouterKeys = Object.entries(MODEL_REGISTRY)
      .filter(([, model]) => model.provider === 'openrouter')
      .map(([key]) => key);
    expect(openrouterKeys).toContain(KEY);
  });

});

describe('canonical model catalog — DeepSeek V4 Pro 0813', () => {
  const KEY = 'deepseek/deepseek-v4-pro-0813';

  it('keeps the exact pinned OpenRouter model without an alias', () => {
    expect(MODEL_REGISTRY[KEY]).toMatchObject({
      label: 'OpenRouter DeepSeek V4 Pro 0813',
      provider: 'openrouter',
      id: KEY,
      autoModelFacts: { eligible: false },
    });
  });
});

describe('configured model options', () => {
  it('projects each canonical registry key exactly once without Direct ID aliases', () => {
    const options = listConfiguredModelOptions('gpt-5.6-luna');

    expect(options.map((option) => option.key)).toEqual(Object.keys(MODEL_REGISTRY));
    expect(new Set(options.map((option) => `${option.provider}:${option.key}`)).size)
      .toBe(options.length);
    expect(options.filter((option) => option.default).map((option) => option.key))
      .toEqual(['gpt-5.6-luna']);
    expect(options.some((option) => option.label.includes('Direct ID'))).toBe(false);
  });

  it('rejects a configured default that is not a canonical OpenAI registry key', () => {
    expect(() => listConfiguredModelOptions('gpt-invented-default'))
      .toThrow('configured_openai_default_unknown');
    expect(() => listConfiguredModelOptions('or-deepseek-chat'))
      .toThrow('configured_openai_default_unknown');
  });
});
