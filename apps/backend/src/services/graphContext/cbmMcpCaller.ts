// Thin CodeGraph transport to the native Codebase Memory MCP server.
// CBM remains the only repository indexer, graph store, schema, and search authority.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadMcpServersConfig } from '../../agents/mcp/mcpConfig';

export type CbmToolCaller = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<Record<string, any>>;

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
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
  const configured = config['codebase-memory'] as
    | { transport?: 'stdio'; command?: string; args?: string[] }
    | undefined;
  if (!configured?.command) {
    throw new Error('cbm_mcp_config_missing: codebase-memory stdio command not configured');
  }
  if (configured.transport && configured.transport !== 'stdio') {
    throw new Error(`cbm_mcp_transport_unsupported: ${configured.transport}`);
  }

  const client = new Client({ name: 'liquidaity-codegraph', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: configured.command,
    args: configured.args || [],
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
      const normalized = normalizeMcpToolResult(result);
      if (result.isError) {
        const nativeError = String(normalized.error || normalized.message || 'native_error');
        throw new Error(`cbm_tool_failed:${tool}:${nativeError}`);
      }
      return normalized;
    },
    close: async () => {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    },
  };
}
