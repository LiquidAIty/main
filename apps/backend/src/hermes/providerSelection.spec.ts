import { describe, expect, it } from 'vitest';
import { resolveSavedHermesProvider } from './providerSelection';

describe('saved Hermes provider selection', () => {
  it.each([
    ['openai', 'chatgpt-account', 'openai-codex'],
    ['openai', 'openai-api', 'openai'],
    ['openrouter', 'openrouter-api', 'openrouter'],
    ['local_openai_compatible', 'openai-api', 'local_openai_compatible'],
  ])('leaves %s/%s native API-mode selection to Hermes', (provider, accessMode, nativeProvider) => {
    expect(resolveSavedHermesProvider({
      provider,
      accessMode,
      providerModelId: 'saved-model',
    })).toEqual({
      savedProvider: provider,
      accessMode,
      provider: nativeProvider,
      model: 'saved-model',
      apiMode: null,
      openaiRuntime: null,
      profileOpenaiRuntime: 'auto',
    });
  });

  it('selects App Server only from explicit supported saved authority', () => {
    expect(resolveSavedHermesProvider({
      provider: 'openai',
      accessMode: 'chatgpt-account',
      providerModelId: 'saved-model',
      openaiRuntime: 'codex_app_server',
    })).toMatchObject({
      provider: 'openai-codex',
      apiMode: 'codex_app_server',
      openaiRuntime: 'codex_app_server',
      profileOpenaiRuntime: 'codex_app_server',
    });
    expect(() => resolveSavedHermesProvider({
      provider: 'openrouter',
      accessMode: 'openrouter-api',
      providerModelId: 'saved-model',
      openaiRuntime: 'codex_app_server',
    })).toThrow('hermes_saved_provider_transport_unsupported');
  });

  it('rejects invalid provider/access pairs without a fallback', () => {
    expect(() => resolveSavedHermesProvider({
      provider: 'openrouter',
      accessMode: 'chatgpt-account',
      providerModelId: 'saved-model',
    })).toThrow('hermes_saved_provider_access_mode_mismatch');
  });
});
