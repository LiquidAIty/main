// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Tool Catalog
// Relationship: This file verifies catalog metadata preserves provider identity, availability, eligibility, profile ceilings, pagination, and isolated descriptor failures.
// Entity: MCP Host
// Relationship: This file verifies readiness gates catalog reads, one authenticated connection is reused, every page is consumed, and cursor cycles fail closed.
// Entity: Credentials
// Relationship: This file verifies the MCP transport receives only the signed catalog-reader principal and rejects unauthenticated published projections.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpMocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  listTools: vi.fn(async (_params?: { cursor?: string }): Promise<{
    tools: any[];
    nextCursor?: string;
  }> => ({ tools: [] })),
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

function descriptor(name: string, sourceId: string, providerToolName: string) {
  return {
    name,
    description: `Description for ${name}`,
    inputSchema: { type: 'object', properties: {} },
    _meta: { liquidaitySource: {
      sourceId,
      namespace: sourceId,
      providerToolName,
      connectionKind: 'external-mcp',
      publication: 'external-mcp',
      access: 'read',
      available: true,
      grantEligible: true,
      grantProfiles: [],
      canonicalInputSchema: { type: 'object', properties: {} },
      serverInjectedArguments: [],
      dispatcherContextArguments: [],
      dispatcherOwner: `provider.${providerToolName}`,
      authenticatedProjection: true,
    } },
  };
}

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
            grantProfiles: [],
            canonicalInputSchema: { type: 'object', properties: {} },
            serverInjectedArguments: [],
            dispatcherContextArguments: [],
            dispatcherOwner: 'app.mcp_provider_operations.call_graphiti_operation',
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
          available: true, grantEligible: true, grantProfiles: [],
          canonicalInputSchema: { type: 'object', properties: {} },
          serverInjectedArguments: [], dispatcherContextArguments: [],
          dispatcherOwner: 'app.mcp_provider_operations.call_cbm_operation', authenticatedProjection: true,
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

  it('reuses one catalog-reader connection for canonical catalog reads', async () => {
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
            grantProfiles: [],
            canonicalInputSchema: { type: 'object', properties: {} },
            serverInjectedArguments: [],
            dispatcherContextArguments: [],
            dispatcherOwner: 'app.mcp_provider_operations.call_cbm_operation',
            authenticatedProjection: true,
          },
        },
      }],
    });
    await expect(readToolCatalog()).resolves.toMatchObject({
      state: 'available',
      unavailableFamilies: [],
      tools: [{ name: 'cbm.search_graph', sourceId: 'cbm' }],
    });
    await listToolCatalog();

    expect(mcpMocks.listTools).toHaveBeenCalledTimes(2);
    expect(readiness).toHaveBeenCalledOnce();
    const authorization = String(
      mcpMocks.transportInits[0]?.requestInit?.headers?.Authorization || '',
    );
    const payload = JSON.parse(
      Buffer.from(authorization.replace(/^Bearer /, '').split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.principal).toEqual({ kind: 'catalog-reader' });
    expect(mcpMocks.connect).toHaveBeenCalledOnce();
    expect(mcpMocks.close).not.toHaveBeenCalled();
  });

  it('reads every MCP page and rejects a cursor cycle', async () => {
    mcpMocks.listTools
      .mockResolvedValueOnce({
        tools: [descriptor('cbm.search_graph', 'cbm', 'search_graph')],
        nextCursor: 'page-two',
      })
      .mockResolvedValueOnce({
        tools: [descriptor('graphiti.search_nodes', 'graphiti', 'search_nodes')],
      });

    await expect(listToolCatalog()).resolves.toMatchObject([
      { name: 'cbm.search_graph' },
      { name: 'graphiti.search_nodes' },
    ]);
    expect(mcpMocks.listTools).toHaveBeenNthCalledWith(1, undefined);
    expect(mcpMocks.listTools).toHaveBeenNthCalledWith(2, { cursor: 'page-two' });

    mcpMocks.listTools
      .mockReset()
      .mockResolvedValue({ tools: [], nextCursor: 'cycle' });
    await expect(listToolCatalog()).rejects.toThrow('tool_catalog_cursor_cycle');
  });

  it('rejects an unauthenticated published projection', async () => {
    const unauthenticated = descriptor('cbm.search_graph', 'cbm', 'search_graph');
    unauthenticated._meta.liquidaitySource.authenticatedProjection = false;
    mcpMocks.listTools.mockResolvedValue({ tools: [unauthenticated] });

    await expect(listToolCatalog()).rejects.toThrow(
      'tool_catalog_source_metadata_invalid: cbm.search_graph',
    );
  });
});
