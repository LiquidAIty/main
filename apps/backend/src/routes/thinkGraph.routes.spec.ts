import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchThinkGraphProjection: vi.fn(),
  fetchThinkGraphNeighborhood: vi.fn(),
  requestPythonRailsJson: vi.fn(),
}));

vi.mock('./projectAccess', () => ({
  requireOwnedProject: vi.fn(async () => ({ ownerUserId: 'owner-one' })),
}));

vi.mock('../services/pythonRailsClient', () => ({
  fetchThinkGraphProjection: mocks.fetchThinkGraphProjection,
  fetchThinkGraphNeighborhood: mocks.fetchThinkGraphNeighborhood,
  requestPythonRailsJson: mocks.requestPythonRailsJson,
}));

import thinkGraphRoutes from './thinkGraph.routes';

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use('/api/thinkgraph', thinkGraphRoutes);
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
  mocks.requestPythonRailsJson.mockReset();
});

describe('ThinkGraph Engraphis read transport', () => {
  it('passes one exact Engraphis memory identity to the Engraphis neighborhood reader', async () => {
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

  it('rejects an expansion without both Engraphis identities', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/neighborhood?projectId=project-1`);
      expect(response.status).toBe(400);
      expect(mocks.fetchThinkGraphNeighborhood).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('retires one exact ThinkGraph relationship through Python rails', async () => {
    mocks.requestPythonRailsJson.mockResolvedValue({ ok: true, edgeId: 'edge-1' });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/retire-relationship`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'project-1', edgeId: 'edge-1' }),
      });
      expect(response.status).toBe(200);
      expect(mocks.requestPythonRailsJson).toHaveBeenCalledWith('/thinkgraph/operation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          operation: 'retire_relationship',
          arguments: { edgeId: 'edge-1' },
        }),
      });
    } finally {
      await closeServer(server);
    }
  });
});
