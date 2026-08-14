export type Provider = "openai" | "openrouter";

export type ModelEntry = {
  label: string;
  provider: Provider;
  id: string;
  context?: number;
};

export type ConfiguredModelOption = {
  provider: Provider;
  key: string;
  label: string;
  providerModelId: string;
  default: boolean;
};

/**
 * The ACTIVE, selectable model catalog. Account-login entries are the currently
 * supported OpenAI GPT-5 family. OpenRouter entries are curated defaults that
 * were ALL confirmed present in the live provider catalog (checked 2026-08-05).
 *
 * No stale/discontinued entries are retained here: anything absent is an
 * unknown key at resolution time and fails honestly.
 */
export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  // --- OpenAI GPT-5.6 family (account-login / OAuth runtime) ---
  "gpt-5.6-sol": { label: "GPT-5.6 Sol", provider: "openai", id: "gpt-5.6-sol", context: 1_050_000 },
  "gpt-5.6-terra": { label: "GPT-5.6 Terra", provider: "openai", id: "gpt-5.6-terra", context: 1_050_000 },
  "gpt-5.6-luna": { label: "GPT-5.6 Luna", provider: "openai", id: "gpt-5.6-luna", context: 1_050_000 },

  // --- OpenRouter (curated defaults, all confirmed in the live catalog) ---
  "or-google-gemini-2.5-pro": { label: "OpenRouter Gemini 2.5 Pro", provider: "openrouter", id: "google/gemini-2.5-pro", context: 1000000 },
  "or-deepseek-chat": { label: "OpenRouter DeepSeek Chat", provider: "openrouter", id: "deepseek/deepseek-chat", context: 65536 },
  "deepseek/deepseek-v4-flash-0731": { label: "OpenRouter DeepSeek V4 Flash 0731", provider: "openrouter", id: "deepseek/deepseek-v4-flash-0731" },
  "z-ai/glm-5.2": { label: "OpenRouter Z.ai GLM 5.2", provider: "openrouter", id: "z-ai/glm-5.2", context: 1000000 }
};

/** Materialize the saved-card model choices from the canonical runtime registry.
 * The IDD validates these records before the card editor consumes them. */
export function listConfiguredModelOptions(openaiDefault: string): ConfiguredModelOption[] {
  const byProviderAndKey = new Map<string, ConfiguredModelOption>();
  const add = (option: ConfiguredModelOption) => {
    const identity = `${option.provider}:${option.key}`;
    if (!byProviderAndKey.has(identity)) byProviderAndKey.set(identity, option);
  };

  for (const [key, model] of Object.entries(MODEL_REGISTRY)) {
    add({
      provider: model.provider,
      key,
      label: model.label,
      providerModelId: model.id,
      default: model.provider === 'openai' && key === openaiDefault,
    });
    if (model.provider === 'openrouter') {
      add({
        provider: model.provider,
        key: model.id,
        label: `${model.label} (Direct ID)`,
        providerModelId: model.id,
        default: false,
      });
    }
  }

  if (![...byProviderAndKey.values()].some(
    (option) => option.provider === 'openai' && option.key === openaiDefault,
  )) {
    add({
      provider: 'openai',
      key: openaiDefault,
      label: `${openaiDefault} (default)`,
      providerModelId: openaiDefault,
      default: true,
    });
  }
  return [...byProviderAndKey.values()];
}

/** Resolve a selectable model key to its registry entry. Throws on unknown or
 * removed keys — a persisted stale value fails honestly at resolution. */
export function resolveModel(key: string): ModelEntry {
  const m = MODEL_REGISTRY[key];
  if (!m) throw new Error(`Unknown model key: ${key}`);
  return m;
}
