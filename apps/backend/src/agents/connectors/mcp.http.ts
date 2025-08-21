import fetch from 'node-fetch';

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

// Simple HTTP shim for MCP-style tool calls.
// Env:
//   MCP_HTTP_BASE: optional base URL for MCP gateway (e.g., http://localhost:8080)
//   MCP_HTTP_KEY:  optional bearer/API key header
const BASE = (process.env.MCP_HTTP_BASE || '').replace(/\/$/, '');
const KEY  = process.env.MCP_HTTP_KEY || '';

export async function callMcpTool(server: string, tool: string, args: any = {}) {
  if (!server || !tool) throw new Error('mcp_call requires server and tool');
  if (!BASE) throw new Error('MCP HTTP base not configured (set MCP_HTTP_BASE)');
  const url = `${BASE}/mcp/${encodeURIComponent(server)}/tools/${encodeURIComponent(tool)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
    },
    body: JSON.stringify({ args }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MCP call failed: ${res.status} ${res.statusText} ${text}`);
  }
  try {
    return await res.json();
  } catch {
    return {};
  }
}
