/**
 * Entity: ThinkGraph
 * Relationship: Verifies owner-scoped Engraphis projections, exact neighborhood reads, bounded retirement, required identities, and honest Python failure projection.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchThinkGraphProjection: vi.fn(),
  fetchThinkGraphNeighborhood: vi.fn(),
  requestPythonRailsJson: vi.fn(),
  requireOwnedProject: vi.fn(async (..._args: unknown[]): Promise<{
    ownerUserId: string;
  } | null> => ({ ownerUserId: 'owner-one' })),
}));

vi.mock('./projectAccess', () => ({
  requireOwnedProject: mocks.requireOwnedProject,
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
  mocks.requireOwnedProject.mockReset();
  mocks.requireOwnedProject.mockResolvedValue({ ownerUserId: 'owner-one' });
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

  it('forwards an owner-scoped full projection and reports Python failure', async () => {
    mocks.fetchThinkGraphProjection.mockResolvedValue({
      schemaVersion: 'thinkgraph.engraphis.v1',
      projectId: 'project-1',
      nodes: [],
      edges: [],
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const success = await fetch(`${baseUrl}/projection?projectId=project-1`);
      expect(success.status).toBe(200);
      expect(mocks.requireOwnedProject).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), 'project-1',
      );
      expect(mocks.fetchThinkGraphProjection).toHaveBeenCalledWith('project-1');

      mocks.fetchThinkGraphProjection.mockRejectedValueOnce(
        new Error('engraphis_unavailable'),
      );
      const failure = await fetch(`${baseUrl}/projection?projectId=project-1`);
      expect(failure.status).toBe(502);
      expect(await failure.json()).toEqual({ error: 'engraphis_unavailable' });
    } finally {
      await closeServer(server);
    }
  });

  it('retires one exact memory only after Project authorization', async () => {
    mocks.requestPythonRailsJson.mockResolvedValue({ ok: true, retired: 'memory-one' });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/retire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'project-1', memoryId: 'memory-one' }),
      });
      expect(response.status).toBe(200);
      expect(mocks.requestPythonRailsJson).toHaveBeenCalledWith(
        '/thinkgraph/operation',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            projectId: 'project-1',
            operation: 'retire',
            arguments: { memoryId: 'memory-one' },
          }),
        }),
      );

      mocks.requireOwnedProject.mockImplementationOnce(async (...args: unknown[]) => {
        const res = args[1] as Response;
        res.status(404).json({ ok: false, error: 'project_not_found' });
        return null;
      });
      const denied = await fetch(`${baseUrl}/retire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'project-other', memoryId: 'memory-one' }),
      });
      expect(denied.status).toBe(404);
      expect(mocks.requestPythonRailsJson).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });

});
