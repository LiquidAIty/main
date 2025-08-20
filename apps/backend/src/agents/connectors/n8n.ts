export async function askN8N(workflow: string, payload?: any): Promise<string> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) throw new Error('n8n not configured');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow, payload }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`n8n HTTP ${resp.status}: ${text.slice(0, 300)}`);
  try {
    const data: any = JSON.parse(text);
    return data?.text ?? firstStringField(data) ?? JSON.stringify(data);
  } catch {
    return text;
  }
}

function firstStringField(obj: any): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}
