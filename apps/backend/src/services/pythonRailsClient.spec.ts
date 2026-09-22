import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeConnectedAgents,
  fetchThinkGraphNeighborhood,
  requestPythonRailsJson,
} from './pythonRailsClient';

describe('pythonRailsClient', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    process.env.PYTHON_RAILS_URL = 'http://python-rails:8001';
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
  });

  it('forwards exact Project/Deck identity for the Python-owned Mag One roster', async () => {
    const request = vi.fn(async () => ({
      ok: true,
      projectId: 'project-1',
      deckId: 'deck-1',
      orchestratorCardId: 'card_magentic',
      connectedAgents: [{
        cardId: 'card_worker',
        title: 'Worker',
        model: { modelKey: 'model-1', provider: 'openai' },
        tools: [],
        connected: true,
        executionReady: true,
        readinessState: 'ready',
        readinessReason: null,
      }],
    }));

    const result = await describeConnectedAgents(
      {
        projectId: 'project-1',
        deckId: 'deck-1',
        discoveredToolNames: ['cbm.search_graph'],
        discoveredToolCatalogState: 'available',
        unavailableToolCatalogFamilies: [],
      },
      request as any,
    );

    expect(request).toHaveBeenCalledWith(
      '/domain/mag-one/project-1/deck-1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discoveredToolNames: ['cbm.search_graph'],
          discoveredToolCatalogState: 'available',
          unavailableToolCatalogFamilies: [],
        }),
      },
    );
    expect(result.connectedAgents.map((agent) => agent.cardId)).toEqual(['card_worker']);
  });

  it('rejects missing Mag One roster identity and malformed Python responses', async () => {
    await expect(
      describeConnectedAgents({
        projectId: '',
        deckId: 'deck-1',
        discoveredToolNames: [],
        discoveredToolCatalogState: 'unavailable',
        unavailableToolCatalogFamilies: [],
      }, vi.fn() as any),
    ).rejects.toThrow('projectId_and_deckId_required');
    await expect(
      describeConnectedAgents(
        {
          projectId: 'project-1',
          deckId: 'deck-1',
          discoveredToolNames: [],
          discoveredToolCatalogState: 'unavailable',
          unavailableToolCatalogFamilies: [],
        },
        vi.fn(async () => ({ ok: true, connectedAgents: [] })) as any,
      ),
    ).rejects.toThrow('mag_one_connected_agents_response_invalid');
  });

  it('uses the configured Python rails URL and preserves HTTP error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ detail: 'native_failure' }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await expect(
      requestPythonRailsJson('/magentic/execution/status', {
        method: 'POST',
        body: JSON.stringify({ nativeRootId: 't_1' }),
      }),
    ).rejects.toThrow('python_rails_http_500:native_failure');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/magentic/execution/status',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns the required unavailable code when Python rails cannot be reached', async () => {
    const connectionError = new Error('connect refused') as Error & {
      cause?: { code: string };
    };
    connectionError.cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(connectionError) as any);

    await expect(
      requestPythonRailsJson('/health', { method: 'GET' }),
    ).rejects.toThrow('PYTHON_RAILS_UNAVAILABLE');
  });

  it('uses the native ThinkGraph neighborhood endpoint without fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        schemaVersion: 'thinkgraph.engraphis.v1',
        projectId: 'p1',
        nodes: [],
        edges: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as any);
    await fetchThinkGraphNeighborhood('p1', 'mem-1');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/thinkgraph/neighborhood?projectId=p1&canonicalId=mem-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
