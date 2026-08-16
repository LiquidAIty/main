import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, resolveModel } from './models.config';

// Canonical model catalog: DeepSeek V4 Flash 0731 is a first-class entry,
// selectable through the normal OpenRouter card path (config.routes.ts
// serializes MODEL_REGISTRY for the Agent Card model selector).
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

  it('resolves through resolveModel (backend validation path)', () => {
    expect(resolveModel(KEY)).toEqual({
      label: 'OpenRouter DeepSeek V4 Flash 0731',
      provider: 'openrouter',
      id: 'deepseek/deepseek-v4-flash-0731',
    });
  });

  it('is classified as an OpenRouter model for the card selector', () => {
    // Mirrors the GET /api/config/models openrouter filtering in config.routes.ts.
    const openrouterKeys = Object.entries(MODEL_REGISTRY)
      .filter(([, model]) => model.provider === 'openrouter')
      .map(([key]) => key);
    expect(openrouterKeys).toContain(KEY);
  });

  it('still rejects unknown model keys (no validation bypass)', () => {
    expect(() => resolveModel('deepseek/not-a-real-model')).toThrow(
      /Unknown model key/,
    );
  });
});

describe('canonical model catalog — DeepSeek V4 Pro 0813', () => {
  const KEY = 'deepseek/deepseek-v4-pro-0813';

  it('resolves the exact pinned OpenRouter model without an alias', () => {
    expect(resolveModel(KEY)).toEqual({
      label: 'OpenRouter DeepSeek V4 Pro 0813',
      provider: 'openrouter',
      id: KEY,
    });
  });
});
