import { resolveModel } from "./models.config";
import { safeFetch } from "../security/safeFetch";

async function fetchWithTimeout(url: string, init: RequestInit, ms: number, allowHosts: string[] = []) {
  return safeFetch(url, { ...init, timeoutMs: ms, allowHosts });
}

export type InvokeOpts = { modelKey?: string; temperature?: number; maxTokens?: number; system?: string };

export async function runLLM(userContent: string, opts: InvokeOpts = {}) {
  const m = resolveModel(opts.modelKey);
  const temperature = opts.temperature ?? Number(process.env.DEFAULT_TEMPERATURE ?? 0.2);
  const max_tokens = opts.maxTokens ?? Number(process.env.DEFAULT_MAX_TOKENS ?? 2048);
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 20000);

  if (m.provider === "openai") {
    const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const url = `${base.replace(/\/+$/, "")}/chat/completions`;
    const allowOpenAI = (process.env.ALLOW_HOSTS_OPENAI || "api.openai.com").split(",").map(h => h.trim()).filter(Boolean);
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: m.id,
        messages: [
          { role: "system", content: opts.system ?? "You are a LiquidAIty agent." },
          { role: "user", content: userContent },
        ],
        temperature, max_tokens,
      }),
    }, timeout, allowOpenAI);
    const j = await r.json() as any;
    return { text: j?.choices?.[0]?.message?.content ?? "", model: m.id, provider: m.provider };
  }

  if (m.provider === "openrouter") {
    const base = process.env.OPENROUTER_BASE_URL || "https://api.openrouter.ai";
    const url = `${base.replace(/\/+$/, "")}/chat/completions`;
    const allowOpenRouter = (process.env.ALLOW_HOSTS_OPENROUTER || "api.openrouter.ai,openrouter.ai").split(",").map(h => h.trim()).filter(Boolean);
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: m.id,
        messages: [
          { role: "system", content: opts.system ?? "You are a LiquidAIty agent." },
          { role: "user", content: userContent },
        ],
        temperature, max_tokens,
      }),
    }, timeout, allowOpenRouter);
    const j = await r.json() as any;
    return { text: j?.choices?.[0]?.message?.content ?? "", model: m.id, provider: m.provider };
  }

  throw new Error(`Unsupported provider: ${m.provider}`);
}
