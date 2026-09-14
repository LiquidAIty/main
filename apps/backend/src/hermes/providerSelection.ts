export type SavedHermesProviderSelection = {
  provider: unknown;
  accessMode: unknown;
  modelKey?: unknown;
  providerModelId?: unknown;
  openaiRuntime?: unknown;
};

export type NativeHermesProviderSelection = {
  savedProvider: 'openai' | 'openrouter' | 'local_openai_compatible';
  accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
  provider: string;
  model: string;
  apiMode: 'codex_app_server' | null;
  openaiRuntime: 'codex_app_server' | null;
  profileOpenaiRuntime: 'codex_app_server' | 'auto';
};

export type NativeHermesSubagentSelection = {
  savedProvider: NativeHermesProviderSelection['savedProvider'];
  accessMode: NativeHermesProviderSelection['accessMode'];
  provider: string;
  model: string;
};

function resolveProviderPair(provider: unknown, access: unknown): {
  savedProvider: NativeHermesProviderSelection['savedProvider'];
  accessMode: NativeHermesProviderSelection['accessMode'];
  provider: string;
} {
  const savedProvider = String(provider ?? '').trim().toLowerCase();
  const accessMode = String(access ?? '').trim().toLowerCase();
  const valid = (
    (savedProvider === 'openai' && ['chatgpt-account', 'openai-api'].includes(accessMode))
    || (savedProvider === 'openrouter' && accessMode === 'openrouter-api')
    || (savedProvider === 'local_openai_compatible' && accessMode === 'openai-api')
  );
  if (!savedProvider || !accessMode || !valid) {
    throw new Error(`hermes_saved_provider_access_mode_mismatch:${savedProvider}:${accessMode}`);
  }
  return {
    savedProvider: savedProvider as NativeHermesProviderSelection['savedProvider'],
    accessMode: accessMode as NativeHermesProviderSelection['accessMode'],
    provider: savedProvider === 'openai' && accessMode === 'chatgpt-account'
      ? 'openai-codex'
      : savedProvider,
  };
}

/**
 * Resolve the one current saved-Card transport without consulting environment,
 * profile state, provider availability, or a fallback registry.
 */
export function resolveSavedHermesProvider(
  value: SavedHermesProviderSelection,
): NativeHermesProviderSelection {
  const model = String(value.providerModelId ?? value.modelKey ?? '').trim();
  const openaiRuntime = String(value.openaiRuntime ?? '').trim().toLowerCase();
  if (!model) {
    throw new Error('hermes_saved_provider_selection_incomplete');
  }
  const pair = resolveProviderPair(value.provider, value.accessMode);
  if (openaiRuntime && openaiRuntime !== 'codex_app_server') {
    throw new Error(`hermes_saved_openai_runtime_invalid:${openaiRuntime}`);
  }
  if (openaiRuntime === 'codex_app_server') {
    if (pair.savedProvider !== 'openai' || pair.accessMode !== 'chatgpt-account') {
      throw new Error(
        `hermes_saved_provider_transport_unsupported:${pair.savedProvider}:${pair.accessMode}:${openaiRuntime}`,
      );
    }
    return {
      ...pair,
      model,
      apiMode: 'codex_app_server',
      openaiRuntime: 'codex_app_server',
      profileOpenaiRuntime: 'codex_app_server',
    };
  }
  return {
    ...pair,
    model,
    apiMode: null,
    openaiRuntime: null,
    profileOpenaiRuntime: 'auto',
  };
}

/** Validate a delegated child's independently saved native provider/model selector. */
export function resolveSavedHermesSubagent(
  value: Omit<SavedHermesProviderSelection, 'openaiRuntime'>,
): NativeHermesSubagentSelection {
  const model = String(value.providerModelId ?? value.modelKey ?? '').trim();
  if (!model) {
    throw new Error('hermes_saved_subagent_selection_incomplete');
  }
  const { savedProvider, accessMode, provider } = resolveProviderPair(
    value.provider,
    value.accessMode,
  );
  return { savedProvider, accessMode, provider, model };
}
