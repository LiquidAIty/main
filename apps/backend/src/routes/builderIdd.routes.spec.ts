import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestPythonRailsJson, listToolCatalog } = vi.hoisted(() => ({
  requestPythonRailsJson: vi.fn(),
  listToolCatalog: vi.fn(),
}));

vi.mock('../services/pythonRailsClient', () => ({ requestPythonRailsJson }));
vi.mock('../services/mcp/toolCatalogMcpClient', () => ({ listToolCatalog }));

import { loadLiveToolCatalog } from './builderIdd.routes';

beforeEach(() => {
  requestPythonRailsJson.mockReset();
  listToolCatalog.mockReset();
});

describe('flat Card tool catalog projection', () => {
  it('sends only live MCP descriptors to the canonical definitions endpoint', async () => {
    const liveMcpDescriptor = {
      name: 'cbm.search_graph',
      title: 'Search graph',
      description: 'Search indexed repository structure.',
      sourceId: 'cbm',
      namespace: 'cbm',
      providerToolName: 'search_graph',
      connectionKind: 'external-mcp',
      publication: 'external-mcp',
      access: 'read',
      available: true,
      grantEligible: true,
      inputSchema: { type: 'object', properties: {} },
      canonicalInputSchema: { type: 'object', properties: {} },
      serverInjectedArguments: [],
      dispatcherContextArguments: [],
      dispatcherOwner: 'app.mcp_provider_operations.call_cbm_operation',
      authenticatedProjection: true,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
    const flatDefinition = {
      canonicalId: 'cbm.search_graph',
      provider: 'cbm',
      providerToolName: 'search_graph',
      namespace: 'cbm',
      publications: ['card-runtime', 'external-mcp'],
      displayName: 'Search graph',
      description: 'Search indexed repository structure.',
      available: true,
      grantEligible: true,
      access: 'read',
      inputSchema: { type: 'object', properties: {} },
      canonicalInputSchema: { type: 'object', properties: {} },
      serverInjectedArguments: [],
      dispatcherContextArguments: [],
      dispatcherOwner: 'app.mcp_provider_operations.call_cbm_operation',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
    listToolCatalog.mockResolvedValue([liveMcpDescriptor]);
    requestPythonRailsJson.mockResolvedValue({ references: [flatDefinition] });

    const catalog = await loadLiveToolCatalog();

    expect(listToolCatalog).toHaveBeenCalledTimes(1);
    expect(requestPythonRailsJson).toHaveBeenCalledTimes(1);
    expect(requestPythonRailsJson).toHaveBeenCalledWith('/tools/catalog/definitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerTools: [liveMcpDescriptor] }),
    });
    expect(catalog.references).toEqual([flatDefinition]);
  });
});
