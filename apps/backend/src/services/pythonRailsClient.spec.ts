import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
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

  it('uses the configured Python rails URL and preserves HTTP error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ detail: 'provider_failure' }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await expect(
      requestPythonRailsJson('/magentic/execution/status', {
        method: 'POST',
        body: JSON.stringify({ hermesRootId: 't_1' }),
      }),
    ).rejects.toThrow('python_rails_http_500:provider_failure');
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

});
