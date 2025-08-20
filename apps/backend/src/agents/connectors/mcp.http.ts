export async function askMCP(question: string, params?: any): Promise<string> {
  const url = process.env.MCP_HTTP_URL;
  if (!url) throw new Error('MCP not configured');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, params }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}: ${text.slice(0, 300)}`);
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
