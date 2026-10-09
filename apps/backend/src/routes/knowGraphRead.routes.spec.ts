import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import router from './knowGraphRead.routes';

const mocks = vi.hoisted(() => ({
  getOwnedProjectByReference: vi.fn(),
  fetchKnowGraphProjection: vi.fn(),
  fetchKnowGraphNeighborhood: vi.fn(),
}));

vi.mock('../services/projectStore', () => ({
  getOwnedProjectByReference: mocks.getOwnedProjectByReference,
}));

vi.mock('../services/pythonRailsClient', () => ({
  fetchKnowGraphProjection: mocks.fetchKnowGraphProjection,
  fetchKnowGraphNeighborhood: mocks.fetchKnowGraphNeighborhood,
}));

async function createApiServer(userId?: string): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).userId = userId;
      next();
    });
  }
  app.use('/api/knowgraph', router);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/knowgraph` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.getOwnedProjectByReference.mockReset();
  mocks.fetchKnowGraphProjection.mockReset();
  mocks.fetchKnowGraphNeighborhood.mockReset();
});

describe('KnowGraph read route project authority and transport', () => {
  it('keeps the graph and expand input errors at their existing URLs', async () => {
    const { server, baseUrl } = await createApiServer('user-1');
    try {
      const graphResponse = await fetch(`${baseUrl}/graph`);
      const expandResponse = await fetch(`${baseUrl}/expand?projectId=project-1`);

      expect(graphResponse.status).toBe(400);
      expect(await graphResponse.json()).toEqual({
        ok: false,
        error: { message: 'projectId is required' },
      });
      expect(expandResponse.status).toBe(400);
      expect(await expandResponse.json()).toEqual({
        ok: false,
        error: { message: 'projectId and nodeId are required' },
      });
      expect(mocks.getOwnedProjectByReference).not.toHaveBeenCalled();
      expect(mocks.fetchKnowGraphProjection).not.toHaveBeenCalled();
      expect(mocks.fetchKnowGraphNeighborhood).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('preserves unauthenticated and unowned project results', async () => {
    const anonymous = await createApiServer();
    try {
      const response = await fetch(`${anonymous.baseUrl}/graph?projectId=project-1`);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        error: { message: 'Authentication required.' },
      });
      expect(mocks.getOwnedProjectByReference).not.toHaveBeenCalled();
    } finally {
      await closeServer(anonymous.server);
    }

    mocks.getOwnedProjectByReference.mockResolvedValueOnce(null);
    const authenticated = await createApiServer('user-1');
    try {
      const response = await fetch(
        `${authenticated.baseUrl}/expand?project_id=project-code&node_id=node-1`,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        ok: false,
        error: { message: 'KnowGraph project not found.' },
      });
      expect(mocks.getOwnedProjectByReference).toHaveBeenCalledWith('project-code', 'user-1');
      expect(mocks.fetchKnowGraphNeighborhood).not.toHaveBeenCalled();
    } finally {
      await closeServer(authenticated.server);
    }
  });

  it('forwards the canonical Project and bounded graph limit without reshaping', async () => {
    const projection = {
      nodes: [{ id: 'entity-1', label: 'Alpha', type: 'Entity', source: 'know', properties: {} }],
      relationships: [],
    };
    mocks.getOwnedProjectByReference.mockResolvedValueOnce({ id: 'project-uuid' });
    mocks.fetchKnowGraphProjection.mockResolvedValueOnce(projection);
    const { server, baseUrl } = await createApiServer('user-1');
    try {
      const response = await fetch(`${baseUrl}/graph?projectId=project-code&limit=9999`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(projection);
      expect(mocks.getOwnedProjectByReference).toHaveBeenCalledWith('project-code', 'user-1');
      expect(mocks.fetchKnowGraphProjection).toHaveBeenCalledWith('project-uuid', 500);
    } finally {
      await closeServer(server);
    }
  });

  it('forwards exact node identity and one-hop bounds without reshaping', async () => {
    const neighborhood = { nodes: [], relationships: [] };
    mocks.getOwnedProjectByReference.mockResolvedValueOnce({ id: 'project-uuid' });
    mocks.fetchKnowGraphNeighborhood.mockResolvedValueOnce(neighborhood);
    const { server, baseUrl } = await createApiServer('user-1');
    try {
      const response = await fetch(
        `${baseUrl}/expand?project_id=project-code&node_id=node-1&limit=0&depth=8`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(neighborhood);
      expect(mocks.fetchKnowGraphNeighborhood).toHaveBeenCalledWith(
        'project-uuid',
        'node-1',
        1,
      );
    } finally {
      await closeServer(server);
    }
  });
});
