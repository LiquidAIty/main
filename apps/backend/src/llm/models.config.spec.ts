import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY } from './models.config';

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
    expect(MODEL_REGISTRY[KEY]).toEqual({
      label: 'OpenRouter DeepSeek V4 Pro 0813',
      provider: 'openrouter',
      id: KEY,
    });
  });
});
