import { safeFetch } from '../security/safeFetch';

export async function createOpenRouterEmbedding(input: string, model: string): Promise<number[]> {
  const base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const url = `${base.replace(/\/+$/, '')}/embeddings`;
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 20000);
  const allowOpenRouter = (process.env.ALLOW_HOSTS_OPENROUTER || 'api.openrouter.ai,openrouter.ai')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const r = await safeFetch(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input }),
      timeoutMs: timeout,
      allowHosts: allowOpenRouter,
      maxBytes: 25_000_000,
    },
  );

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`OpenRouter embeddings failed: HTTP ${r.status}${detail ? `: ${detail.slice(0, 800)}` : ''}`);
  }

  const j = (await r.json().catch(() => null)) as any;
  const emb = j?.data?.[0]?.embedding ?? j?.data?.embedding ?? j?.embedding;
  if (!Array.isArray(emb)) {
    throw new Error('OpenRouter embeddings parse failed: missing data[0].embedding');
  }
  return emb.map((v: any) => Number(v));
}
