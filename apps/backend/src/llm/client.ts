import { resolveModel } from "./models.config";
import { safeFetch } from "../security/safeFetch";

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, allowHosts: string[] = []) {
  return safeFetch(url, { ...init, timeoutMs: ms, allowHosts });
}

export type InvokeOpts = { 
  modelKey?: string; 
  temperature?: number; 
  maxTokens?: number; 
  system?: string; 
  jsonMode?: boolean;
  jsonSchema?: { name: string; schema: any; strict?: boolean };
};

export async function runLLM(userContent: string, opts: InvokeOpts = {}) {
  let m;
  try {
    m = resolveModel(opts.modelKey);
  } catch (err: any) {
    throw new Error(`model_not_configured: ${err.message}`);
  }

  const temperature = opts.temperature ?? Number(process.env.DEFAULT_TEMPERATURE ?? 0.2);
  const max_tokens = opts.maxTokens ?? Number(process.env.DEFAULT_MAX_TOKENS ?? 2048);
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 20000);

  if (m.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new Error(`provider_key_missing: provider=openai`);
    }
    const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const url = `${base.replace(/\/+$/, "")}/chat/completions`;
    const allowOpenAI = (process.env.ALLOW_HOSTS_OPENAI || "api.openai.com").split(",").map(h => h.trim()).filter(Boolean);
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: m.id,
        messages: [
          { role: "system", content: opts.system ?? "You are a LiquidAIty agent." },
          { role: "user", content: userContent },
        ],
        temperature, max_tokens,
        ...(opts.jsonSchema ? { 
          response_format: { 
            type: "json_schema",
            json_schema: {
              name: opts.jsonSchema.name,
              schema: opts.jsonSchema.schema,
              strict: opts.jsonSchema.strict ?? true
            }
          } 
        } : opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    }, timeout, allowOpenAI);
    const j = await r.json() as any;
    return { text: j?.choices?.[0]?.message?.content ?? "", model: m.id, provider: m.provider };
  }

  if (m.provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new Error(`provider_key_missing: provider=openrouter`);
    }
    const base = process.env.OPENROUTER_BASE_URL || "https://api.openrouter.ai";
    const url = `${base.replace(/\/+$/, "")}/chat/completions`;
    const allowOpenRouter = (process.env.ALLOW_HOSTS_OPENROUTER || "api.openrouter.ai,openrouter.ai").split(",").map(h => h.trim()).filter(Boolean);
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: m.id,
        messages: [
          { role: "system", content: opts.system ?? "You are a LiquidAIty agent." },
          { role: "user", content: userContent },
        ],
        temperature, max_tokens,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    }, timeout, allowOpenRouter);
    const j = await r.json() as any;
    const text = j?.choices?.[0]?.message?.content ?? "";
    
    // Log empty responses to help diagnose model issues
    if (!text || !text.trim()) {
      console.error('[LLM] empty response from OpenRouter', {
        model: m.id,
        status: r.status,
        has_choices: Boolean(j?.choices),
        choice_count: j?.choices?.length || 0,
        error: j?.error,
        response_preview: JSON.stringify(j).slice(0, 200)
      });
    }
    
    return { text, model: m.id, provider: m.provider };
  }

  throw new Error(`provider_not_supported: ${m.provider}`);
}
