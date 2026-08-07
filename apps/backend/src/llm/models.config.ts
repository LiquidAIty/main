export type Provider = "openai" | "openrouter";

export type ModelEntry = {
  label: string;
  provider: Provider;
  id: string;
  context?: number;
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

/** Resolve a selectable model key to its registry entry. Throws on unknown or
 * removed keys — a persisted stale value fails honestly at resolution. */
export function resolveModel(key: string): ModelEntry {
  const m = MODEL_REGISTRY[key];
  if (!m) throw new Error(`Unknown model key: ${key}`);
  return m;
}
