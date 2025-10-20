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

  // --- OpenRouter ---
  "kimi-k2-free": { label: "Kimi K2 Free", provider: "openrouter", id: "moonshotai/kimi-k2:free" },
  "deepseek-chat":{ label: "DeepSeek Chat", provider: "openrouter", id: "deepseek/deepseek-chat" },
  "phi-4":        { label: "Phi-4", provider: "openrouter", id: "microsoft/phi-4" }
};

export function resolveModel(key?: string): ModelEntry {
  const k = key ?? process.env.DEFAULT_MODEL ?? "gpt-5-nano";
  const m = MODEL_REGISTRY[k];
  if (!m) throw new Error(`Unknown model key: ${k}`);
  return m;
}

export function listModels() {
  return Object.entries(MODEL_REGISTRY).map(([k, v]) => ({ key: k, ...v }));
}

export type agent_role = 'orchestrator' | 'worker';

export function resolve_model_by_role(role: agent_role) {
  const p = (process.env.SOL_PRIMARY || 'openai').toLowerCase();
  const via_openai = p === 'openai';

  if (role === 'orchestrator') {
    // force orchestrator to openai gpt-5
    const model = {
      provider: 'openai',
      id: 'gpt-4-turbo-preview',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY || '',
      maxTokens: Number(process.env.DEFAULT_MAX_TOKENS ?? 2048),
    };
    console.log('[LLM] provider=%s model=%s temp=%s', model.provider, model.id, 'default');
    return model;
  }

  // worker: prefer openai gpt-5-mini/gpt-5-nano if SOL_PRIMARY=openai, else fall back to openrouter model
  if (via_openai) {
    const model = {
      provider: 'openai',
      id: 'gpt-4o-mini',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY || '',
      maxTokens: Number(process.env.DEFAULT_MAX_TOKENS ?? 2048),
    };
    console.log('[LLM] provider=%s model=%s temp=%s', model.provider, model.id, 'default');
    return model;
  }
  const model = {
    provider: 'openrouter',
    id: process.env.OPENROUTER_DEFAULT_MODEL || 'moonshotai/kimi-k2:free',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || '',
    temperature: Number(process.env.DEFAULT_TEMPERATURE ?? 0.2),
    maxTokens: Number(process.env.DEFAULT_MAX_TOKENS ?? 2048),
  };
  console.log('[LLM] provider=%s model=%s temp=%s', model.provider, model.id, model.temperature);
  return model;
}
