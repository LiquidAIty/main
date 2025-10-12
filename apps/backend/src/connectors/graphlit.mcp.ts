// Graphlit MCP client - thin wrapper over MCP tool endpoints
// We chose Graphlit for ingestion/embeddings/retrieval via MCP so we don't maintain data connectors

import { assertUrlAllowed } from '../security/urlGuard';

const GRAPHLIT_MCP_URL = process.env.GRAPHLIT_MCP_URL || '';
const GRAPHLIT_API_KEY = process.env.GRAPHLIT_API_KEY || '';
const ALLOWED_HOSTS = (process.env.ALLOWED_INGEST_HOSTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

async function callGraphlitMCP(endpoint: string, body: any): Promise<any> {
  if (!GRAPHLIT_MCP_URL) {
    console.warn('[Graphlit] MCP URL not configured');
    return { error: 'Graphlit MCP not configured' };
  }
  
  const url = `${GRAPHLIT_MCP_URL}${endpoint}`;
  await assertUrlAllowed(url, { allowHosts: ALLOWED_HOSTS.length ? ALLOWED_HOSTS : [
    'raw.githubusercontent.com',
    'github.com',
    'huggingface.co',
    'api.graphlit.io',
    'arxiv.org'
  ] });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GRAPHLIT_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error(`Graphlit MCP error: ${response.statusText}`);
  }
  
  return response.json();
}

export async function ingest(params: {
  url?: string;
  file?: string;
  text?: string;
  metadata?: Record<string, any>;
}): Promise<{ contentId: string; status: string }> {
  const result = await callGraphlitMCP('/ingest', params);
  return result;
}

export async function embed(params: {
  query?: string;
  doc?: string;
}): Promise<{ embedding: number[] }> {
  const result = await callGraphlitMCP('/embed', params);
  return result;
}

export async function retrieve(params: {
  query: string;
  filters?: Record<string, any>;
  limit?: number;
}): Promise<{ documents: Array<{ id: string; content: string; score: number; metadata?: any }> }> {
  const result = await callGraphlitMCP('/retrieve', { ...params, limit: params.limit || 5 });
  return result;
}
