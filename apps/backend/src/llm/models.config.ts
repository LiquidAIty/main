// Entity: Card Profiles
// Relationship: This file defines the canonical configured provider/model identities that saved Card profiles may select.
// Entity: IDD
// Relationship: This file projects the exact configured model records consumed by the IDD-backed Card editor selector.
export type Provider = "openai" | "openrouter";

export type ModelEntry = {
  label: string;
  provider: Provider;
  id: string;
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
 * supported OpenAI GPT families. OpenRouter entries are curated defaults that
 * were ALL confirmed present in the live provider catalog (checked 2026-08-05).
 *
 * No stale/discontinued entries are retained here: anything absent is an
 * unknown key at resolution time and fails honestly.
 */
export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  // Confirmed by the authenticated Hermes openai-codex catalog, 2026-11-09.
  "gpt-6.1-sol": {
    label: "GPT-6.1 Sol", provider: "openai", id: "gpt-6.1-sol",
  },
  "gpt-6.1-terra": {
    label: "GPT-6.1 Terra", provider: "openai", id: "gpt-6.1-terra",
  },
  "gpt-6-astra": {
    label: "GPT-6 Astra", provider: "openai", id: "gpt-6-astra",
  },
  "gpt-6-sol": {
    label: "GPT-6 Sol", provider: "openai", id: "gpt-6-sol",
  },
  "gpt-6-luna": {
    label: "GPT-6 Luna", provider: "openai", id: "gpt-6-luna",
  },
  // --- OpenAI GPT-5.6 family (account-login / OAuth runtime) ---
  "gpt-5.6-sol": {
    label: "GPT-5.6 Sol", provider: "openai", id: "gpt-5.6-sol",
  },
  "gpt-5.6-terra": {
    label: "GPT-5.6 Terra", provider: "openai", id: "gpt-5.6-terra",
  },
  "gpt-5.6-luna": {
    label: "GPT-5.6 Luna", provider: "openai", id: "gpt-5.6-luna",
  },

  // --- OpenRouter (curated defaults, all confirmed in the live catalog) ---
  "or-google-gemini-2.5-pro": { label: "OpenRouter Gemini 2.5 Pro", provider: "openrouter", id: "google/gemini-2.5-pro" },
  "or-deepseek-chat": { label: "OpenRouter DeepSeek Chat", provider: "openrouter", id: "deepseek/deepseek-chat" },
  "deepseek/deepseek-v4-pro-0813": { label: "OpenRouter DeepSeek V4 Pro 0813", provider: "openrouter", id: "deepseek/deepseek-v4-pro-0813" },
  "deepseek/deepseek-v4-flash-0731": { label: "OpenRouter DeepSeek V4 Flash 0731", provider: "openrouter", id: "deepseek/deepseek-v4-flash-0731" },
  "z-ai/glm-5.2": { label: "OpenRouter Z.ai GLM 5.2", provider: "openrouter", id: "z-ai/glm-5.2" }
};

/** Project the saved-card model choices from the canonical runtime registry.
 * The IDD validates these records before the card editor consumes them. */
export function listConfiguredModelOptions(openaiDefault: string): ConfiguredModelOption[] {
  if (MODEL_REGISTRY[openaiDefault]?.provider !== 'openai') {
    throw new Error('configured_openai_default_unknown');
  }
  return Object.entries(MODEL_REGISTRY).map(([key, model]) => ({
      provider: model.provider,
      key,
      label: model.label,
      providerModelId: model.id,
      default: model.provider === 'openai' && key === openaiDefault,
    }));
}
