import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const mcpMocks = vi.hoisted(() => ({
  callTool: vi.fn(async (): Promise<CallToolResult> => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  })),
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  listTools: vi.fn(async (): Promise<{ tools: any[] }> => ({ tools: [] })),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    callTool = mcpMocks.callTool;
    close = mcpMocks.close;
    connect = mcpMocks.connect;
    listTools = mcpMocks.listTools;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {},
}));

import {
  callPythonAgentMcpTool,
  closePythonAgentMcpClient,
  readPythonAgentMcpCatalog,
} from './pythonAgentMcpClient';

describe('Python Agent MCP client', () => {
  beforeEach(() => {
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = '0123456789abcdef0123456789abcdef';
    process.env.LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp';
    mcpMocks.callTool.mockClear();
    mcpMocks.close.mockClear();
    mcpMocks.connect.mockClear();
    mcpMocks.listTools.mockClear();
  });

  afterEach(async () => {
    await closePythonAgentMcpClient();
    vi.unstubAllGlobals();
  });

  it('uses the SDK default deadline for an ordinary tool call', async () => {
    await callPythonAgentMcpTool('ordinary.tool', { value: 1 });
    expect(mcpMocks.callTool).toHaveBeenCalledWith({
      name: 'ordinary.tool',
      arguments: { value: 1 },
    });
  });

  it('reports the optional catalog unavailable without waiting on tools/list', async () => {
    const readiness = vi.fn(async () => ({
      ok: false,
      json: async () => ({ catalogState: 'initializing' }),
    }));
    vi.stubGlobal('fetch', readiness);

    await expect(readPythonAgentMcpCatalog()).resolves.toEqual({
      state: 'unavailable',
      tools: [],
      reason: 'catalog_unavailable',
    });
    expect(readiness).toHaveBeenCalledOnce();
    expect(String(readiness.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8765/health/catalog');
    expect(mcpMocks.listTools).not.toHaveBeenCalled();
  });

  it('reads the complete catalog only after the host reports ready', async () => {
    const readiness = vi.fn(async () => ({
      ok: true,
      json: async () => ({ catalogState: 'ready' }),
    }));
    vi.stubGlobal('fetch', readiness);
    mcpMocks.listTools.mockResolvedValueOnce({
      tools: [{
        name: 'cbm.search_graph',
        description: 'Search CodeGraph.',
        inputSchema: { type: 'object', properties: {} },
        _meta: {
          liquidaitySource: {
            sourceId: 'cbm',
            namespace: 'cbm',
            nativeName: 'search_graph',
            connectionKind: 'external-mcp',
          },
        },
      }],
    });

    await expect(readPythonAgentMcpCatalog()).resolves.toMatchObject({
      state: 'available',
      tools: [{
        name: 'cbm.search_graph',
        sourceId: 'cbm',
        nativeName: 'search_graph',
      }],
    });
    expect(String(readiness.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8765/health/catalog');
    expect(mcpMocks.listTools).toHaveBeenCalledOnce();
  });
});
