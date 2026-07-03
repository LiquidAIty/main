// /api/thinkgraph/projection is NARROW TRANSPORT: it validates the project
// reference and returns the Python ThinkGraphProjectionV1 response UNCHANGED.
// These tests prove the route never shapes, relabels, or supplements the
// projection — and fails honestly when the Python authority is unavailable.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

const clientMocks = vi.hoisted(() => ({
  fetchThinkGraphProjection: vi.fn<(projectId: string, limit?: number) => Promise<unknown>>(),
}));

vi.mock('../services/autogen/autogenOrchestratorClient', () => ({
  fetchThinkGraphProjection: clientMocks.fetchThinkGraphProjection,
}));

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const express = (await import('express')).default;
  const router = (await import('./thinkgraph.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/thinkgraph', router);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/thinkgraph` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('thinkgraph projection transport route', () => {
  it('returns the Python projection byte-for-byte unchanged (no shaping, no extra fields)', async () => {
    // Deliberately includes fields this route knows nothing about — they must
    // survive untouched, proving zero transformation happens in transport.
    const pythonProjection = {
      schemaVersion: 'thinkgraph.projection.v1',
      projectId: 'proj-1',
      nodes: [
        {
          id: 'hyp_a',
          label: 'Hypothesis A',
          kind: 'resource',
          sourceRef: 'tg:msg_1',
          provenance: { correlationId: 'tg:msg_1', futureField: 'passthrough' },
          visual: { nodeClass: 'resource', x: null, y: null },
        },
      ],
      edges: [
        {
          id: 'stmt_1|subj',
          source: 'hyp_a',
          target: 'stmt_1',
          label: 'depends_on',
          predicate: 'depends_on',
          visual: { edgeClass: 'semantic_relation', directed: true },
        },
      ],
      pythonOnlyFutureField: { untouched: true },
    };
    clientMocks.fetchThinkGraphProjection.mockResolvedValueOnce(pythonProjection);

    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/projection?projectId=proj-1`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(pythonProjection);
      expect(clientMocks.fetchThinkGraphProjection).toHaveBeenCalledWith('proj-1', undefined);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects a missing project reference without calling Python', async () => {
    clientMocks.fetchThinkGraphProjection.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/projection`);
      expect(response.status).toBe(400);
      expect(clientMocks.fetchThinkGraphProjection).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('reports an honest 502 when the Python authority is unavailable — no fallback projection', async () => {
    clientMocks.fetchThinkGraphProjection.mockRejectedValueOnce(
      new Error('PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=http://127.0.0.1:8003/thinkgraph/projection'),
    );
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/projection?projectId=proj-1`);
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(String(body.error)).toContain('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
      expect(body.nodes).toBeUndefined(); // never a fake empty graph
    } finally {
      await closeServer(server);
    }
  });
});
