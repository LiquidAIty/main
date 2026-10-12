import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requestPythonRailsJson: vi.fn() }));

vi.mock('./projectAccess', () => ({
  requireOwnedProject: vi.fn(async () => ({ ownerUserId: 'owner-one' })),
}));
vi.mock('../services/pythonRailsClient', () => ({
  requestPythonRailsJson: mocks.requestPythonRailsJson,
}));

import projectGraphRoutes from './projectGraph.routes';

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use('/api/project-graph', projectGraphRoutes);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/project-graph` };
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.requestPythonRailsJson.mockReset();
});

describe('Project graph current-request context transport', () => {
  it('forwards exact Entity refs and current query without interpreting either', async () => {
    const entity = {
      canonicalName: 'Rocket Lab', authority: 'both',
      engraphisEntityId: 'think-rocket', graphitiEntityId: 'know-rocket',
    };
    mocks.requestPythonRailsJson.mockResolvedValue({
      schemaVersion: 'project-entity-context.v1', entities: [{ ...entity }],
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/entity-context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', query: 'current user request',
          context: 'bounded context', limit: 1, entities: [entity],
        }),
      });
      expect(response.status).toBe(200);
      expect(mocks.requestPythonRailsJson).toHaveBeenCalledWith('/graph/entity-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', query: 'current user request',
          context: 'bounded context', limit: 1, entities: [entity],
        }),
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('rejects an inspector result count outside the bounded native candidate window', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/entity-context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', query: 'current user request', limit: 13,
          entities: [{
            canonicalName: 'Rocket Lab', authority: 'knowgraph',
            graphitiEntityId: 'know-rocket',
          }],
        }),
      });
      expect(response.status).toBe(400);
      expect(mocks.requestPythonRailsJson).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
