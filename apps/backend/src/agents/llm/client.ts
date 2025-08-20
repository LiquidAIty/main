import OpenAI from 'openai';

export type Provider = 'openai' | 'openrouter';

export function makeOpenAIChat(
  provider: Provider,
  opt?: { apiKey?: string; baseURL?: string; model?: string }
) {
  if (provider === 'openrouter') {
    const apiKey  = opt?.apiKey  ?? process.env.OPENROUTER_API_KEY!;
    const baseURL = opt?.baseURL ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
    const model   = opt?.model   ?? process.env.OPENROUTER_MODEL    ?? 'deepseek/deepseek-chat';
    const client  = new OpenAI({ apiKey, baseURL });
    return { client, model, apiKey, baseURL };
  }
  // OpenAI default
  const apiKey  = opt?.apiKey  ?? process.env.OPENAI_API_KEY!;
  const baseURL = opt?.baseURL; // usually undefined for OpenAI
  const model   = opt?.model   ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const client  = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  return { client, model, apiKey, baseURL };
}
