import { safeFetch } from '../../security/safeFetch';

const BASE = process.env.N8N_BASE_URL?.replace(/\/$/, '');
const KEY  = process.env.N8N_API_KEY || '';
const ALLOWED_HOSTS = (process.env.ALLOWED_INGEST_HOSTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export async function n8nCallWebhook(pathOrUrl: string, payload: Record<string, unknown> = {}) {
  if (!pathOrUrl && !BASE) throw new Error('n8n not configured');
  const url = pathOrUrl?.startsWith('http')
    ? pathOrUrl
    : `${BASE}${pathOrUrl?.startsWith('/') ? '' : '/'}${pathOrUrl}`;

  const res = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(KEY ? { 'X-N8N-API-KEY': KEY } : {}) },
    body: JSON.stringify(payload),
    allowHosts: ALLOWED_HOSTS.length ? ALLOWED_HOSTS : [
      'n8n.yourdomain.com',
      'localhost',
      '127.0.0.1'
    ]
  });
  if (!res.ok) throw new Error(`n8n webhook failed: ${res.status} ${await res.text()}`);
  try { return await res.json(); } catch { return {}; }
}

export async function askN8N(workflow: string, payload?: Record<string, unknown>): Promise<string> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) throw new Error('n8n not configured');
  const resp = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow, payload }),
    allowHosts: ALLOWED_HOSTS.length ? ALLOWED_HOSTS : [
      'n8n.yourdomain.com',
      'localhost',
      '127.0.0.1'
    ]
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`n8n HTTP ${resp.status}: ${text.slice(0, 300)}`);
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      const first = firstStringField(data as Record<string, unknown>);
      if (first) return first;
      return JSON.stringify(data);
    }
    return text;
  } catch {
    return text;
  }
}

function firstStringField(obj: Record<string, unknown>): string | undefined {
  for (const value of Object.values(obj)) {
    if (typeof value === 'string') return value;
  }
  return undefined;
}
