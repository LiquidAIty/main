import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const mcpMocks = vi.hoisted(() => ({
  callTool: vi.fn(async (): Promise<CallToolResult> => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  })),
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  listTools: vi.fn(async (): Promise<{ tools: any[] }> => ({ tools: [] })),
  transportInits: [] as Array<Record<string, any>>,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    onclose: (() => void) | undefined;
    callTool = mcpMocks.callTool;
    connect = mcpMocks.connect;
    listTools = mcpMocks.listTools;

    async close() {
      await mcpMocks.close();
      this.onclose?.();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    constructor(_url: URL, options: Record<string, any>) {
      mcpMocks.transportInits.push(options);
    }
  },
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
    mcpMocks.transportInits.length = 0;
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
    const readiness = vi.fn(async (_input: string | URL | Request) => ({
      ok: false,
      json: async () => ({ catalogState: 'initializing' }),
    }));
    vi.stubGlobal('fetch', readiness);

    await expect(readPythonAgentMcpCatalog()).resolves.toEqual({
      state: 'unavailable',
      tools: [],
      unavailableFamilies: [],
      reason: 'catalog_unavailable',
    });
    expect(readiness).toHaveBeenCalledOnce();
    expect(String(readiness.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8765/health/catalog');
    expect(mcpMocks.listTools).not.toHaveBeenCalled();
  });

  it('reads the complete catalog only after the host reports ready', async () => {
    const readiness = vi.fn(async (_input: string | URL | Request) => ({
      ok: true,
      json: async () => ({
        catalogState: 'ready',
        unavailableCatalogFamilies: ['cbm'],
      }),
    }));
    vi.stubGlobal('fetch', readiness);
    mcpMocks.listTools.mockResolvedValueOnce({
      tools: [{
        name: 'graphiti.search_nodes',
        description: 'Search KnowGraph.',
        inputSchema: { type: 'object', properties: {} },
        _meta: {
          liquidaitySource: {
            sourceId: 'graphiti',
            namespace: 'graphiti',
            nativeName: 'search_nodes',
            connectionKind: 'external-mcp',
          },
        },
      }],
    });

    await expect(readPythonAgentMcpCatalog()).resolves.toMatchObject({
      state: 'available',
      unavailableFamilies: ['cbm'],
      tools: [{
        name: 'graphiti.search_nodes',
        sourceId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    expect(String(readiness.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8765/health/catalog');
    expect(mcpMocks.listTools).toHaveBeenCalledOnce();
  });

  it('fails the probe closed when unavailable-family diagnostics are malformed', async () => {
    const readiness = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        catalogState: 'ready',
        unavailableCatalogFamilies: ['card'],
      }),
    }));
    vi.stubGlobal('fetch', readiness);

    await expect(readPythonAgentMcpCatalog()).resolves.toEqual({
      state: 'unavailable',
      tools: [],
      unavailableFamilies: [],
      reason: 'catalog_unavailable',
    });
    expect(mcpMocks.listTools).not.toHaveBeenCalled();
  });

  it('late-binds the exact authorized Card-runtime catalog before probing its result', async () => {
    const readiness = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        catalogState: 'ready',
        unavailableCatalogFamilies: [],
      }),
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
    const principal = {
      kind: 'card-runtime' as const,
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
      parentRunId: 'run-one',
      callerCardId: 'builder',
      callerRuntimeKind: 'hermes' as const,
      callerRuntimeMode: 'delegate' as const,
      grantedTools: ['cbm.search_graph'],
      presentedTools: ['cbm.search_graph'],
    };

    await callPythonAgentMcpTool('ordinary.before', {});
    await expect(readPythonAgentMcpCatalog(principal)).resolves.toMatchObject({
      state: 'available',
      unavailableFamilies: [],
      tools: [{ name: 'cbm.search_graph', sourceId: 'cbm' }],
    });

    expect(mcpMocks.listTools).toHaveBeenCalledOnce();
    expect(readiness).toHaveBeenCalledOnce();
    expect(mcpMocks.listTools.mock.invocationCallOrder[0])
      .toBeLessThan(readiness.mock.invocationCallOrder[0]);
    expect(mcpMocks.close).toHaveBeenCalledOnce();
    const authorization = String(
      mcpMocks.transportInits[1]?.requestInit?.headers?.Authorization || '',
    );
    const payload = JSON.parse(
      Buffer.from(authorization.replace(/^Bearer /, '').split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.principal).toEqual(principal);
    await callPythonAgentMcpTool('ordinary.after', {});
    expect(mcpMocks.connect).toHaveBeenCalledTimes(2);
  });

  it('uses a runless materializer principal and reports only its authorized optional family', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        catalogState: 'ready',
        unavailableCatalogFamilies: ['cbm', 'graphiti'],
      }),
    })));
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
    const principal = {
      kind: 'materializer-read' as const,
      projectId: 'project-one',
      deckId: 'deck-one',
      callerCardId: 'builder',
      conversationId: 'main',
      grantedTools: ['card.create'],
      grantedConnections: ['cbm'],
    };

    await expect(readPythonAgentMcpCatalog(principal)).resolves.toMatchObject({
      state: 'available',
      unavailableFamilies: ['cbm'],
      tools: [{ name: 'cbm.search_graph' }],
    });

    const authorization = String(
      mcpMocks.transportInits[0]?.requestInit?.headers?.Authorization || '',
    );
    const payload = JSON.parse(
      Buffer.from(authorization.replace(/^Bearer /, '').split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.principal).toEqual(principal);
  });
});
