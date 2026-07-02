// @graph entity: PythonAgentMcpClient
// @graph role: harness-mcp-client-to-python-agent-host
//
// THE Harness-side MCP client for the Python Agent MCP host (app/mcp_host.py).
// The Harness control plane calls agent capabilities through this MCP boundary —
// never by direct HTTP to Python runtime endpoints. One lazy stdio connection
// (official @modelcontextprotocol/sdk client); a dead transport is honestly
// re-created on the NEXT call — a failed call itself is never retried.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function firstExisting(candidates: string[], kind: string): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`python_agent_mcp_${kind}_not_found: checked ${candidates.join(' | ')}`);
}

function resolvePythonCommand(): string {
  const fromEnv = String(process.env.LIQUIDAITY_PY_MCP_PYTHON || '').trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return firstExisting(
    [
      path.resolve(process.cwd(), 'apps/python-models/.venv/Scripts/python.exe'),
      path.resolve(process.cwd(), '../../apps/python-models/.venv/Scripts/python.exe'),
    ],
    'python',
  );
}

function resolveHostPath(): string {
  const fromEnv = String(process.env.LIQUIDAITY_PY_MCP_HOST || '').trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return firstExisting(
    [
      path.resolve(process.cwd(), 'apps/python-models/app/mcp_host.py'),
      path.resolve(process.cwd(), '../../apps/python-models/app/mcp_host.py'),
    ],
    'host',
  );
}

let clientPromise: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: resolvePythonCommand(),
    args: [resolveHostPath()],
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'liquidaity-harness', version: '0.1.0' });
  client.onclose = () => {
    // Honest teardown: the NEXT call re-connects lazily; no in-flight retry.
    clientPromise = null;
  };
  await client.connect(transport);
  return client;
}

function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export type PythonMcpToolResult = { ok: boolean; [key: string]: unknown };

/** Call one tool on the Python Agent MCP host and parse its JSON text result. */
export async function callPythonAgentMcpTool(
  name: string,
  args: Record<string, unknown>,
): Promise<PythonMcpToolResult> {
  const client = await getClient();
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = String((content[0] as { text?: unknown })?.text ?? '').trim();
  if (!text) throw new Error(`python_agent_mcp_empty_result: ${name}`);
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`python_agent_mcp_invalid_result: ${name}`);
  }
  return parsed as PythonMcpToolResult;
}

/** List the tools the Python Agent MCP host exposes (discovery proof). */
export async function listPythonAgentMcpTools(): Promise<string[]> {
  const client = await getClient();
  const result = await client.listTools();
  return (result.tools || []).map((tool) => tool.name).sort();
}
