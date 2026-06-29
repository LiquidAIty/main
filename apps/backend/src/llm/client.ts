import { resolveModel } from "./models.config";
import { safeFetch } from "../security/safeFetch";
import {
  buildResponsesInput,
  buildResponsesPayload,
  extractResponsesText,
} from './responses';

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, allowHosts: string[] = []) {
  return safeFetch(url, { ...init, timeoutMs: ms, allowHosts });
}

export type InvokeOpts = { 
  modelKey?: string; 
  provider?: string;
  providerModelId?: string;
  temperature?: number; 
  maxTokens?: number; 
  system?: string; 
  jsonMode?: boolean;
  jsonSchema?: { name: string; schema: any; strict?: boolean };
  previousResponseId?: string | null;
  useResponsesApi?: boolean;
};

type RunLlmResult = {
  text: string;
  model: string;
  provider: 'openai' | 'openrouter';
  responseId?: string | null;
};

function providerErrorMessage(provider: string, status: number, payload: any): string {
  const code =
    payload?.error?.code ||
    payload?.error?.type ||
    payload?.code ||
    'unknown_error';
  const message =
    payload?.error?.message ||
    payload?.message ||
    `HTTP ${status}`;
  return `${provider}_error:${code}: ${message}`;
}

export async function runLLM(userContent: string, opts: InvokeOpts = {}): Promise<RunLlmResult> {
  const normalizedProvider = String(opts.provider || '').trim().toLowerCase();
  const explicitProvider = normalizedProvider === 'openai' || normalizedProvider === 'openrouter'
    ? (normalizedProvider as 'openai' | 'openrouter')
    : null;
  const explicitProviderModelId = String(opts.providerModelId || '').trim() || null;
  const modelKey = String(opts.modelKey || '').trim() || null;

  let provider: 'openai' | 'openrouter';
  let modelId: string;
  if (explicitProvider && explicitProviderModelId) {
    provider = explicitProvider;
    modelId = explicitProviderModelId;
  } else {
    let modelEntry;
    try {
      modelEntry = resolveModel(modelKey || undefined);
    } catch (err: any) {
      throw new Error(`model_not_configured: ${err.message}`);
    }
    provider = modelEntry.provider;
    modelId = modelEntry.id;
  }

  const temperature = opts.temperature ?? Number(process.env.DEFAULT_TEMPERATURE ?? 0.2);
  const max_tokens = opts.maxTokens ?? Number(process.env.DEFAULT_MAX_TOKENS ?? 2048);
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 20000);

  const callOpenRouter = async (modelId: string) => {
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
        model: modelId,
        messages: [
          { role: "system", content: opts.system ?? "You are a LiquidAIty agent." },
          { role: "user", content: userContent },
        ],
        temperature, max_tokens,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    }, timeout, allowOpenRouter);
    const j = await r.json() as any;

    if (!r.ok || j?.error) {
      throw new Error(providerErrorMessage("openrouter", r.status, j));
    }

    const text = j?.choices?.[0]?.message?.content ?? "";
    if (!text || !text.trim()) {
      throw new Error("openrouter_error:empty_response");
    }

    return { text, model: modelId, provider: "openrouter" as const, responseId: null };
  };

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new Error(`provider_key_missing: provider=openai`);
    }
    const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const useResponsesApi = opts.useResponsesApi === true;
    const url = `${base.replace(/\/+$/, "")}/${useResponsesApi ? 'responses' : 'chat/completions'}`;
    const allowOpenAI = (process.env.ALLOW_HOSTS_OPENAI || "api.openai.com").split(",").map(h => h.trim()).filter(Boolean);
    const body = useResponsesApi
      ? buildResponsesPayload({
          model: modelId,
          input: buildResponsesInput(opts.system ?? "You are a LiquidAIty agent.", userContent),
          response_format: opts.jsonSchema
            ? {
                type: 'json_schema',
                name: opts.jsonSchema.name,
                schema: opts.jsonSchema.schema,
                strict: opts.jsonSchema.strict ?? true,
              }
            : opts.jsonMode
              ? { type: 'json_object' }
              : { type: 'text' },
          temperature,
          max_output_tokens: max_tokens,
          previous_response_id: opts.previousResponseId ?? undefined,
        })
      : {
          model: modelId,
          messages: [
            { role: "system", content: opts.system ?? "You are a LiquidAIty agent." },
            { role: "user", content: userContent },
          ],
          // GPT-5 family compatibility (local to this branch): these models reject
          // `max_tokens` (require `max_completion_tokens`) and reject a custom temperature
          // (only the default is allowed) on chat/completions.
          ...(/^gpt-5/.test(modelId)
            ? { max_completion_tokens: max_tokens }
            : { temperature, max_tokens }),
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
        };
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, timeout, allowOpenAI);
    const j = await r.json() as any;

    if (!r.ok || j?.error) {
      throw new Error(providerErrorMessage("openai", r.status, j));
    }

    const text = useResponsesApi
      ? extractResponsesText(j)
      : j?.choices?.[0]?.message?.content ?? "";
    if (!text || !text.trim()) {
      throw new Error("openai_error:empty_response");
    }
    return {
      text,
      model: modelId,
      provider,
      responseId: useResponsesApi && typeof j?.id === 'string' ? j.id : null,
    };
  }

  if (provider === "openrouter") {
    return callOpenRouter(modelId);
  }

  throw new Error(`provider_not_supported: ${provider}`);
}
