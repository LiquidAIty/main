export type Provider = "openai" | "openrouter";

export type ModelEntry = {
  label: string;
  provider: Provider;
  id: string;
  context?: number;
};

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  // --- OpenAI GPT-5 family ---
  "gpt-5-nano": { label: "GPT-5 Nano", provider: "openai", id: "gpt-5-nano", context: 16384 },
  "gpt-5-mini": { label: "GPT-5 Mini", provider: "openai", id: "gpt-5-mini", context: 32768 },
  "gpt-5":      { label: "GPT-5 Full", provider: "openai", id: "gpt-5",      context: 32768 },
  "gpt-5.3": { label: "GPT-5.3", provider: "openai", id: "gpt-5.3", context: 32768 },
  "gpt-5.3-codex": { label: "GPT-5.3 Codex", provider: "openai", id: "gpt-5.3-codex", context: 32768 },
  "gpt-5.6-sol": { label: "GPT-5.6 Sol (Codex app-server)", provider: "openai", id: "gpt-5.6-sol", context: 1048576 },
  "gpt-5.1-chat-latest": { label: "GPT-5.1 Chat Latest", provider: "openai", id: "gpt-5.1-chat-latest", context: 32768 },

  // --- OpenRouter (curated defaults) ---
  "or-openai-gpt-5-mini": { label: "OpenRouter OpenAI GPT-5 Mini", provider: "openrouter", id: "openai/gpt-5-mini", context: 32768 },
  "or-openai-gpt-5.1": { label: "OpenRouter OpenAI GPT-5.1", provider: "openrouter", id: "openai/gpt-5.1", context: 32768 },
  "openai/gpt-5.1-chat": { label: "OpenRouter OpenAI GPT-5.1 Chat", provider: "openrouter", id: "openai/gpt-5.1-chat", context: 128000 },
  "or-openai-gpt-5.1-chat": { label: "OpenRouter OpenAI GPT-5.1 Chat", provider: "openrouter", id: "openai/gpt-5.1-chat", context: 128000 },
  "openai/gpt-5.6-luna": { label: "OpenRouter OpenAI GPT-5.6 Luna", provider: "openrouter", id: "openai/gpt-5.6-luna", context: 1048576 },
  "openai/gpt-5.6-terra": { label: "OpenRouter OpenAI GPT-5.6 Terra", provider: "openrouter", id: "openai/gpt-5.6-terra", context: 1048576 },
  "openai/gpt-5.6-sol": { label: "OpenRouter OpenAI GPT-5.6 Sol", provider: "openrouter", id: "openai/gpt-5.6-sol", context: 1048576 },
  "or-anthropic-claude-3.7-sonnet": { label: "OpenRouter Claude 3.7 Sonnet", provider: "openrouter", id: "anthropic/claude-3.7-sonnet", context: 200000 },
  "or-google-gemini-2.5-pro": { label: "OpenRouter Gemini 2.5 Pro", provider: "openrouter", id: "google/gemini-2.5-pro", context: 1000000 },
  "or-deepseek-chat": { label: "OpenRouter DeepSeek Chat", provider: "openrouter", id: "deepseek/deepseek-chat", context: 65536 },
  "or-deepseek-reasoner": { label: "OpenRouter DeepSeek Reasoner", provider: "openrouter", id: "deepseek/deepseek-reasoner", context: 65536 },
  "z-ai/glm-5.2": { label: "OpenRouter Z.ai GLM 5.2", provider: "openrouter", id: "z-ai/glm-5.2", context: 1000000 }
};

export function resolveModel(key: string): ModelEntry {
  const m = MODEL_REGISTRY[key];
  if (!m) throw new Error(`Unknown model key: ${key}`);
  return m;
}

// Removed: resolve_model_by_role / agent_role (dead Sol-era role→model picker
// with zero callers). Cards own their model config; per-role TS model
// selection is exactly the pattern DONT.md bans.
