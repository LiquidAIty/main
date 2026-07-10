export type Provider = "openai" | "openrouter";

export type ModelEntry = {
  label: string;
  provider: Provider;
  id: string;
  context?: number;
};

export const REPO_DEFAULT_MODEL_KEY = "gpt-5.1-chat-latest";

export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  // --- OpenAI GPT-5 family ---
  "gpt-5-nano": { label: "GPT-5 Nano", provider: "openai", id: "gpt-5-nano", context: 16384 },
  "gpt-5-mini": { label: "GPT-5 Mini", provider: "openai", id: "gpt-5-mini", context: 32768 },
  "gpt-5":      { label: "GPT-5 Full", provider: "openai", id: "gpt-5",      context: 32768 },
  "gpt-5.3": { label: "GPT-5.3", provider: "openai", id: "gpt-5.3", context: 32768 },
  "gpt-5.3-codex": { label: "GPT-5.3 Codex", provider: "openai", id: "gpt-5.3-codex", context: 32768 },
  "gpt-5.1-chat-latest": { label: "GPT-5.1 Chat Latest", provider: "openai", id: "gpt-5.1-chat-latest", context: 32768 },

  // --- OpenRouter (curated defaults) ---
  "or-openai-gpt-5-mini": { label: "OpenRouter OpenAI GPT-5 Mini", provider: "openrouter", id: "openai/gpt-5-mini", context: 32768 },
  "or-openai-gpt-5.1": { label: "OpenRouter OpenAI GPT-5.1", provider: "openrouter", id: "openai/gpt-5.1", context: 32768 },
  "openai/gpt-5.1-chat": { label: "OpenRouter OpenAI GPT-5.1 Chat", provider: "openrouter", id: "openai/gpt-5.1-chat", context: 128000 },
  "or-openai-gpt-5.1-chat": { label: "OpenRouter OpenAI GPT-5.1 Chat", provider: "openrouter", id: "openai/gpt-5.1-chat", context: 128000 },
  "or-anthropic-claude-3.7-sonnet": { label: "OpenRouter Claude 3.7 Sonnet", provider: "openrouter", id: "anthropic/claude-3.7-sonnet", context: 200000 },
  "or-google-gemini-2.5-pro": { label: "OpenRouter Gemini 2.5 Pro", provider: "openrouter", id: "google/gemini-2.5-pro", context: 1000000 },
  "or-deepseek-chat": { label: "OpenRouter DeepSeek Chat", provider: "openrouter", id: "deepseek/deepseek-chat", context: 65536 },
  "or-deepseek-reasoner": { label: "OpenRouter DeepSeek Reasoner", provider: "openrouter", id: "deepseek/deepseek-reasoner", context: 65536 },
  "z-ai/glm-5.2": { label: "OpenRouter Z.ai GLM 5.2", provider: "openrouter", id: "z-ai/glm-5.2", context: 1000000 },

  // Legacy aliases retained for existing saved configs.
  "or-openai-gpt-5.1-chat-latest": { label: "OpenRouter OpenAI GPT-5.1 Chat", provider: "openrouter", id: "openai/gpt-5.1-chat", context: 128000 },
  "or-openai-gpt-5": { label: "OpenRouter OpenAI GPT-5", provider: "openrouter", id: "openai/gpt-5", context: 32768 },
  "or-openai-gpt-5-nano": { label: "OpenRouter OpenAI GPT-5 Nano", provider: "openrouter", id: "openai/gpt-5-nano", context: 16384 },
  "kimi-k2-thinking": { label: "Kimi K2 Thinking", provider: "openrouter", id: "moonshotai/kimi-k2-thinking", context: 262144 },
  "kimi-k2-free": { label: "Kimi K2 Free", provider: "openrouter", id: "moonshotai/kimi-k2:free" },
  "deepseek-chat": { label: "DeepSeek Chat", provider: "openrouter", id: "deepseek/deepseek-chat" },
  "phi-4": { label: "Phi-4", provider: "openrouter", id: "microsoft/phi-4" }
};

export function resolveModel(key?: string): ModelEntry {
  const k = key ?? REPO_DEFAULT_MODEL_KEY;
  const m = MODEL_REGISTRY[k];
  if (!m) throw new Error(`Unknown model key: ${k}`);
  return m;
}

export function listModels() {
  return Object.entries(MODEL_REGISTRY).map(([k, v]) => ({ key: k, ...v }));
}

// Removed: resolve_model_by_role / agent_role (dead Sol-era role→model picker
// with zero callers). Cards own their model config; per-role TS model
// selection is exactly the pattern DONT.md bans.
