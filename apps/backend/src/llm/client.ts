import { resolveModel } from "./models.config";

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

export type InvokeOpts = { modelKey?: string; temperature?: number; maxTokens?: number; system?: string };

export async function runLLM(userContent: string, opts: InvokeOpts = {}) {
  const m = resolveModel(opts.modelKey);
  const temperature = opts.temperature ?? Number(process.env.DEFAULT_TEMPERATURE ?? 0.2);
  const max_tokens = opts.maxTokens ?? Number(process.env.DEFAULT_MAX_TOKENS ?? 2048);
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 20000);

  if (m.provider === "openai") {
    const r = await fetchWithTimeout(`${process.env.OPENAI_BASE_URL}/chat/completions`, {
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
    }, timeout);
    const j = await r.json() as any;
    return { text: j?.choices?.[0]?.message?.content ?? "", model: m.id, provider: m.provider };
  }

  if (m.provider === "openrouter") {
    const r = await fetchWithTimeout(`${process.env.OPENROUTER_BASE_URL}/chat/completions`, {
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
    }, timeout);
    const j = await r.json() as any;
    return { text: j?.choices?.[0]?.message?.content ?? "", model: m.id, provider: m.provider };
  }

  throw new Error(`Unsupported provider: ${m.provider}`);
}
