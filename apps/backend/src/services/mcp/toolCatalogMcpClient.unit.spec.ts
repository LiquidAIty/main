import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpMocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  listTools: vi.fn(async (): Promise<{ tools: any[] }> => ({ tools: [] })),
  transportInits: [] as Array<Record<string, any>>,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    onclose: (() => void) | undefined;
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
  closeToolCatalogMcpClient,
  listToolCatalog,
  readToolCatalog,
} from './toolCatalogMcpClient';

describe('Python Agent MCP client', () => {
  beforeEach(() => {
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = '0123456789abcdef0123456789abcdef';
    process.env.LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp';
    mcpMocks.close.mockClear();
    mcpMocks.connect.mockClear();
    mcpMocks.listTools.mockReset();
    mcpMocks.listTools.mockResolvedValue({ tools: [] });
    mcpMocks.transportInits.length = 0;
  });

  afterEach(async () => {
    await closeToolCatalogMcpClient();
    vi.unstubAllGlobals();
  });

  it('reports the optional catalog unavailable without waiting on tools/list', async () => {
    const readiness = vi.fn(async (_input: string | URL | Request) => ({
      ok: false,
      json: async () => ({ catalogState: 'initializing' }),
    }));
    vi.stubGlobal('fetch', readiness);

    await expect(readToolCatalog()).resolves.toEqual({
      state: 'unavailable',
      tools: [],
      unavailableFamilies: [],
      toolFailures: {},
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
            providerToolName: 'search_nodes',
            connectionKind: 'external-mcp',
            publication: 'external-mcp',
            access: 'read',
            available: true,
            grantEligible: true,
            canonicalInputSchema: { type: 'object', properties: {} },
            serverInjectedArguments: [],
            dispatcherContextArguments: [],
            dispatcherOwner: 'app.mcp_host._call_graphiti',
            authenticatedProjection: true,
          },
        },
      }],
    });

    await expect(readToolCatalog()).resolves.toMatchObject({
      state: 'available',
      unavailableFamilies: ['cbm'],
      tools: [{
        name: 'graphiti.search_nodes',
        sourceId: 'graphiti',
        providerToolName: 'search_nodes',
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

    await expect(readToolCatalog()).resolves.toEqual({
      state: 'unavailable',
      tools: [],
      unavailableFamilies: [],
      toolFailures: {},
      reason: 'catalog_unavailable',
    });
    expect(mcpMocks.listTools).not.toHaveBeenCalled();
  });

  it('keeps valid tools when one published descriptor is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ catalogState: 'ready', unavailableCatalogFamilies: [] }),
    })));
    mcpMocks.listTools.mockResolvedValueOnce({
      tools: [{
        name: 'cbm.search_graph',
        description: 'Search CodeGraph.',
        inputSchema: { type: 'object', properties: {} },
        _meta: { liquidaitySource: {
          sourceId: 'cbm', namespace: 'cbm', providerToolName: 'search_graph',
          connectionKind: 'external-mcp', publication: 'external-mcp', access: 'read',
          available: true, grantEligible: true,
          canonicalInputSchema: { type: 'object', properties: {} },
          serverInjectedArguments: [], dispatcherContextArguments: [],
          dispatcherOwner: 'app.mcp_host._call_cbm', authenticatedProjection: true,
        } },
      }, {
        name: 'graphiti.search_nodes',
        description: 'Missing source metadata.',
        inputSchema: { type: 'object', properties: {} },
      }],
    });

    await expect(readToolCatalog()).resolves.toMatchObject({
      state: 'available',
      tools: [{ name: 'cbm.search_graph' }],
      toolFailures: {
        'graphiti.search_nodes': 'tool_catalog_source_metadata_missing: graphiti.search_nodes',
      },
    });
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
    mcpMocks.listTools.mockResolvedValue({
      tools: [{
        name: 'cbm.search_graph',
        description: 'Search CodeGraph.',
        inputSchema: { type: 'object', properties: {} },
        _meta: {
          liquidaitySource: {
            sourceId: 'cbm',
            namespace: 'cbm',
            providerToolName: 'search_graph',
            connectionKind: 'external-mcp',
            publication: 'external-mcp',
            access: 'read',
            available: true,
            grantEligible: true,
            canonicalInputSchema: { type: 'object', properties: {} },
            serverInjectedArguments: [],
            dispatcherContextArguments: [],
            dispatcherOwner: 'app.mcp_host._call_cbm',
            authenticatedProjection: true,
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

    await listToolCatalog();
    await expect(readToolCatalog(principal)).resolves.toMatchObject({
      state: 'available',
      unavailableFamilies: [],
      tools: [{ name: 'cbm.search_graph', sourceId: 'cbm' }],
    });

    expect(mcpMocks.listTools).toHaveBeenCalledTimes(2);
    expect(readiness).toHaveBeenCalledOnce();
    expect(mcpMocks.listTools.mock.invocationCallOrder[1])
      .toBeLessThan(readiness.mock.invocationCallOrder[0]);
    expect(mcpMocks.close).toHaveBeenCalledOnce();
    const authorization = String(
      mcpMocks.transportInits[1]?.requestInit?.headers?.Authorization || '',
    );
    const payload = JSON.parse(
      Buffer.from(authorization.replace(/^Bearer /, '').split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.principal).toEqual(principal);
    await listToolCatalog();
    expect(mcpMocks.connect).toHaveBeenCalledTimes(2);
    expect(mcpMocks.listTools).toHaveBeenCalledTimes(3);
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
            providerToolName: 'search_graph',
            connectionKind: 'external-mcp',
            publication: 'external-mcp',
            access: 'read',
            available: true,
            grantEligible: true,
            canonicalInputSchema: { type: 'object', properties: {} },
            serverInjectedArguments: [],
            dispatcherContextArguments: [],
            dispatcherOwner: 'app.mcp_host._call_cbm',
            authenticatedProjection: true,
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

    await expect(readToolCatalog(principal)).resolves.toMatchObject({
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
