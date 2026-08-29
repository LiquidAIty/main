import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchThinkGraphProjection: vi.fn(),
  fetchThinkGraphNeighborhood: vi.fn(),
}));

vi.mock('../services/autogen/pythonRailsClient', () => ({
  fetchThinkGraphProjection: mocks.fetchThinkGraphProjection,
  fetchThinkGraphNeighborhood: mocks.fetchThinkGraphNeighborhood,
}));

import router from './thinkgraph.routes';

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
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

afterEach(() => {
  vi.restoreAllMocks();
  mocks.fetchThinkGraphProjection.mockReset();
  mocks.fetchThinkGraphNeighborhood.mockReset();
});

describe('ThinkGraph native read transport', () => {
  it('passes one exact native memory identity to the Constellation neighborhood reader', async () => {
    mocks.fetchThinkGraphNeighborhood.mockResolvedValue({
      centerId: 'mem-1',
      nodes: [{ id: 'mem-1' }, { id: 'mem-2' }],
      edges: [{ id: 'edge-1', source: 'mem-1', target: 'mem-2' }],
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/neighborhood?projectId=project-1&canonicalId=mem-1`);
      expect(response.status).toBe(200);
      expect(mocks.fetchThinkGraphNeighborhood).toHaveBeenCalledWith('project-1', 'mem-1');
      expect(await response.json()).toMatchObject({ centerId: 'mem-1' });
    } finally {
      await closeServer(server);
    }
  });

  it('rejects an expansion without both native identities', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/neighborhood?projectId=project-1`);
      expect(response.status).toBe(400);
      expect(mocks.fetchThinkGraphNeighborhood).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });
});
