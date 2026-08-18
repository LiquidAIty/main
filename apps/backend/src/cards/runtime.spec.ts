import { describe, expect, it } from 'vitest';

import { resolveCardModelStrict } from './runtime';

describe('saved Card model lookup', () => {
  it('returns the exact saved OpenRouter model without fallback', () => {
    expect(
      resolveCardModelStrict({
        id: 'card_deepseek',
        runtime: { kind: 'autogen', mode: 'assistant' },
        runtimeOptions: {
          provider: 'openrouter',
          modelKey: 'deepseek/deepseek-v4-flash-0731',
        },
      }),
    ).toEqual({
      provider: 'openrouter',
      providerModelId: 'deepseek/deepseek-v4-flash-0731',
    });
  });

  it('rejects a saved provider that conflicts with the model registry', () => {
    expect(() =>
      resolveCardModelStrict({
        id: 'card_deepseek',
        runtime: { kind: 'autogen', mode: 'assistant' },
        runtimeOptions: {
          provider: 'openai',
          modelKey: 'deepseek/deepseek-v4-flash-0731',
        },
      }),
    ).toThrow(/card_model_config_mismatch/);
  });
});
