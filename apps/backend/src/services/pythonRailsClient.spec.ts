/**
 * Entity: Python Rails
 * Relationship: Verifies the backend's single configured Python rails transport, typed failure boundaries, timeouts, and exact ThinkGraph and KnowGraph read endpoints.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchCodeGraphRead,
  fetchKnowGraphNeighborhood,
  fetchKnowGraphProjection,
  fetchThinkGraphNeighborhood,
  PythonRailsHttpError,
  PythonRailsResponseError,
  requestPythonRailsJson,
} from './pythonRailsClient';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('pythonRailsClient', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    process.env.PYTHON_RAILS_URL = 'http://python-rails:8001';
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the configured Python rails URL and preserves HTTP error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ detail: 'provider_failure' }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const request = requestPythonRailsJson('/magnetic/taskgraph/status', {
      method: 'POST',
      body: JSON.stringify({ hermesRootId: 't_1' }),
    });
    await expect(request).rejects.toMatchObject({
      name: 'PythonRailsHttpError',
      code: 'python_rails_http_500',
      status: 500,
      detail: 'provider_failure',
      message: 'provider_failure',
    } satisfies Partial<PythonRailsHttpError>);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/magnetic/taskgraph/status',
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

  it('normalizes a real reset and timeout to one unavailable transport error', async () => {
    const resetServer = createServer((request) => request.socket.destroy());
    process.env.PYTHON_RAILS_URL = await listen(resetServer);
    try {
      await expect(requestPythonRailsJson('/reset', { method: 'GET' }))
        .rejects.toMatchObject({ code: 'PYTHON_RAILS_UNAVAILABLE' });
    } finally {
      await close(resetServer);
    }

    const timeoutServer = createServer((request, response) => {
      request.once('aborted', () => response.destroy());
    });
    process.env.PYTHON_RAILS_URL = await listen(timeoutServer);
    try {
      await expect(requestPythonRailsJson(
        '/timeout',
        { method: 'GET' },
        { timeoutMs: 20 },
      )).rejects.toMatchObject({ code: 'PYTHON_RAILS_UNAVAILABLE' });
    } finally {
      await close(timeoutServer);
    }
  });

  it('keeps real HTTP failures distinct and types invalid successful JSON', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/invalid') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('not-json');
        return;
      }
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ detail: 'rails_not_ready' }));
    });
    process.env.PYTHON_RAILS_URL = await listen(server);
    try {
      await expect(requestPythonRailsJson('/invalid', { method: 'GET' }))
        .rejects.toBeInstanceOf(PythonRailsResponseError);
      await expect(requestPythonRailsJson('/unavailable', { method: 'GET' }))
        .rejects.toMatchObject({
          name: 'PythonRailsHttpError',
          code: 'python_rails_http_503',
          detail: 'rails_not_ready',
        } satisfies Partial<PythonRailsHttpError>);
    } finally {
      await close(server);
    }
  });

  it('uses the Engraphis ThinkGraph neighborhood endpoint without fallback', async () => {
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

  it('uses the Graphiti projection and neighborhood endpoints without fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ nodes: [], relationships: [] }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await fetchKnowGraphProjection('p1', 200);
    await fetchKnowGraphNeighborhood('p1', 'node-1', 50);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://python-rails:8001/knowgraph/projection?projectId=p1&limit=200',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://python-rails:8001/knowgraph/neighborhood?projectId=p1&nodeId=node-1&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('transports one fixed-purpose CodeGraph read without reshaping it', async () => {
    const responseBody = {
      schemaVersion: 'codegraph.read.v1',
      status: 'partial',
      mode: 'projection',
      errors: [{ code: 'metadata_changed' }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(responseBody),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await expect(fetchCodeGraphRead({
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId: 'builder',
      mode: 'projection',
    })).resolves.toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/codegraph/read',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'builder',
          mode: 'projection',
        }),
      }),
    );
  });

});
