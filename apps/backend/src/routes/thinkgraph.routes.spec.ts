import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchThinkGraphProjection: vi.fn(),
  fetchThinkGraphNeighborhood: vi.fn(),
  requestHermesExtension: vi.fn(),
}));

vi.mock('../hermes/mainAdapter', () => ({ requestHermesExtension: mocks.requestHermesExtension }));


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
  mocks.requestHermesExtension.mockReset();
  vi.unstubAllEnvs();
});

describe('ThinkGraph native read transport', () => {
  it('preserves the engine messages and selected account model on the private extraction route', async () => {
    const secret = 'extraction-transport-contract-secret';
    vi.stubEnv('LIQUIDAITY_INTERNAL_MCP_SECRET', secret);
    const body = { profile: 'thinkgraph', model: 'gpt-5.6-luna', reasoningEffort: 'low',
      messages: [{ role: 'system', content: 'Engine prompt' }, { role: 'user', content: 'Engine input' }] };
    const result = { content: '{"facts":[]}', provider: 'openai-codex', model: body.model };
    mocks.requestHermesExtension.mockResolvedValue(result);
    const { server, baseUrl } = await createApiServer();
    try {
      const denied = await fetch(`${baseUrl}/extraction-completion`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(denied.status).toBe(403);
      expect(mocks.requestHermesExtension).not.toHaveBeenCalled();
      const accepted = await fetch(`${baseUrl}/extraction-completion`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify(body) });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual(result);
      expect(mocks.requestHermesExtension).toHaveBeenCalledWith('_model/complete', body);
    } finally { await closeServer(server); }
  });
  it('passes one exact native memory identity to the Engraphis neighborhood reader', async () => {
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
