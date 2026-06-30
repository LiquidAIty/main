// CodeGraph / Codebase-Memory MCP caller — the real "code-based memory is an MCP" client glue.
// Extracted from the deleted graphContextBuilder so the live localcoder CBM scope gate keeps its
// MCP connection. Pure MCP stdio client: NO graph_liq reads, NO context-packet builder, no shitcode.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadMcpServersConfig } from '../../agents/mcp/mcpConfig';

export type CbmToolCaller = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<Record<string, any>>;

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function parseJsonText(text: unknown): Record<string, any> | null {
  if (typeof text !== 'string') return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function normalizeMcpToolResult(value: unknown): Record<string, any> {
  const record = asRecord(value);
  if (!record) return {};
  if (record.structuredContent && typeof record.structuredContent === 'object') {
    return asRecord(record.structuredContent) || {};
  }
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      const parsed = parseJsonText(asRecord(block)?.text);
      if (parsed) return parsed;
    }
  }
  return record;
}

async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function createCodebaseMemoryMcpCaller(
  repoPath: string,
): Promise<{ callTool: CbmToolCaller; close: () => Promise<void> }> {
  const config = loadMcpServersConfig();
  const server = config['codebase-memory'] as
    | { transport?: 'stdio'; command?: string; args?: string[] }
    | undefined;
  if (!server?.command) {
    throw new Error('cbm_mcp_config_missing: codebase-memory stdio command not configured');
  }
  if (server.transport && server.transport !== 'stdio') {
    throw new Error(`cbm_mcp_transport_unsupported: ${server.transport}`);
  }

  const client = new Client({ name: 'liquidaity-codegraph-context', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args || [],
    cwd: repoPath,
    stderr: 'pipe',
  });
  await withTimeout('cbm_mcp_connect', 15_000, () => client.connect(transport));
  return {
    callTool: async (tool, args) => {
      const result = await withTimeout('cbm_mcp_call', 30_000, () =>
        client.request(
          { method: 'tools/call', params: { name: tool, arguments: args } },
          CallToolResultSchema,
        ),
      );
      if (result.isError) {
        throw new Error(`cbm_tool_failed: ${tool}`);
      }
      return normalizeMcpToolResult(result);
    },
    close: () => transport.close().catch(() => undefined),
  };
}
