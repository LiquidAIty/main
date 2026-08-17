import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchThinkGraphProjection: vi.fn(),
  projectLiveThinkGraph: vi.fn(),
}));

vi.mock('../services/autogen/pythonRailsClient', () => ({
  fetchThinkGraphProjection: mocks.fetchThinkGraphProjection,
  projectLiveThinkGraph: mocks.projectLiveThinkGraph,
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
  mocks.projectLiveThinkGraph.mockReset();
});

describe('ThinkGraph live projection transport', () => {
  it('passes one bounded current-turn request to Python rails unchanged', async () => {
    mocks.projectLiveThinkGraph.mockResolvedValue({
      schemaVersion: 'thinkgraph.live.projection.v1',
      projectId: 'project-1',
      nodes: [],
      edges: [],
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const payload = {
        projectId: 'project-1',
        conversationId: 'main',
        runId: 'turn-1',
        observedAt: '2026-08-09T12:00:00.000Z',
        state: 'active',
        streams: [{
          source: 'reasoning',
          sourceId: 'reasoning-1',
          text: 'bounded native reasoning text',
        }],
        maxNodes: 24,
        maxEdges: 40,
      };
      const response = await fetch(`${baseUrl}/live-projection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      expect(mocks.projectLiveThinkGraph).toHaveBeenCalledWith(payload);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects unknown source types before Python rails', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/live-projection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          conversationId: 'main',
          runId: 'turn-1',
          observedAt: '2026-08-09T12:00:00.000Z',
          state: 'active',
          streams: [{ source: 'invented', sourceId: 'x', text: 'text' }],
        }),
      });

      expect(response.status).toBe(400);
      expect(mocks.projectLiveThinkGraph).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });
});
