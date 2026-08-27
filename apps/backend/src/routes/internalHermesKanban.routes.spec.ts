import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Request } from 'express';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isLoopbackSocketRequest } from '../security/requestAccess';
import { createInternalHermesKanbanRouter } from './internalHermesKanban.routes';

const servers: Server[] = [];

function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      servers.push(server);
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe('internal Hermes Kanban worker bearer route', () => {
  it('returns the issued bearer and canonical MCP URL over a loopback socket', async () => {
    const issue = vi.fn(async () => ({ bearer: 'b'.repeat(96), context: {} as never }));
    const app = express();
    app.use(express.json());
    app.use('/api/internal/hermes-kanban', createInternalHermesKanbanRouter(issue as never));
    const { baseUrl } = await listen(app);

    const response = await fetch(`${baseUrl}/api/internal/hermes-kanban/worker-bearer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 't_worker' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, bearer: 'b'.repeat(96), mcpUrl: 'http://127.0.0.1:8765/mcp',
    });
    expect(issue).toHaveBeenCalledOnce();
  });

  it('does not trust a forged loopback Host header from a non-loopback socket', () => {
    const request = {
      headers: { host: '127.0.0.1:4000' },
      socket: { remoteAddress: '203.0.113.7' },
    } as unknown as Request;
    expect(isLoopbackSocketRequest(request)).toBe(false);
  });

  it('never exposes an internal issuer error or bearer-like text', async () => {
    const issue = vi.fn(async () => {
      throw new Error('signer failed with Bearer super-secret-value');
    });
    const app = express();
    app.use(express.json());
    app.use('/api/internal/hermes-kanban', createInternalHermesKanbanRouter(issue as never));
    const { baseUrl } = await listen(app);

    const response = await fetch(`${baseUrl}/api/internal/hermes-kanban/worker-bearer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(503);
    expect(body).toContain('hermes_kanban_worker_bearer_unavailable');
    expect(body).not.toContain('super-secret-value');
    expect(body).not.toContain('Bearer');
  });
});
