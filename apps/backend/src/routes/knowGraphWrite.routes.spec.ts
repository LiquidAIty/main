/**
 * Entity: KnowGraph
 * Relationship: This file verifies PDF ingestion and episode deletion forward only allowed fields and never expose Graphiti failure bodies.
 * Entity: Authentication
 * Relationship: This file proves KnowGraph writes require authenticated ownership of the exact Project.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import router from './knowGraphWrite.routes';

const mocks = vi.hoisted(() => ({
  getOwnedProjectByReference: vi.fn(),
}));

vi.mock('../services/projectStore', () => ({
  getOwnedProjectByReference: mocks.getOwnedProjectByReference,
}));

async function createApiServer(userId?: string): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
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

async function createKnowgraphServer(input: {
  ingestStatus?: number;
  ingestBody?: unknown;
  deleteStatus?: number;
  deleteBody?: unknown;
}): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.post('/ingest', (_req, res) => {
    res.status(input.ingestStatus ?? 200).json(input.ingestBody ?? { ok: true });
  });
  app.post('/delete_episode', (_req, res) => {
    res.status(input.deleteStatus ?? 200).json(input.deleteBody ?? { ok: true });
  });
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function uploadBody(projectId: string): FormData {
  const body = new FormData();
  body.append('project_id', projectId);
  body.append('document_id', 'document-1');
  body.append('file', new Blob(['%PDF-1.4 route proof'], { type: 'application/pdf' }), 'source.pdf');
  return body;
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.getOwnedProjectByReference.mockReset();
  delete process.env.KNOWGRAPH_URL;
});

describe('KnowGraph document project authority', () => {
  it('resolves the authenticated project selector to its canonical id before Graphiti ingest', async () => {
    process.env.KNOWGRAPH_URL = 'http://knowgraph.test';
    mocks.getOwnedProjectByReference.mockResolvedValueOnce({ id: 'project-canonical' });
    const realFetch = globalThis.fetch.bind(globalThis);
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).startsWith('http://knowgraph.test/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              status: 'ingested',
              project_id: 'project-canonical',
              document_id: 'document-1',
              source_name: 'source.pdf',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return realFetch(input, init);
    });

    const { server, baseUrl } = await createApiServer('user-1');
    try {
      const body = uploadBody('project-alias');
      body.append('prompt_template', 'This retired Card prompt must not reach Graphiti.');
      const response = await fetch(`${baseUrl}/ingest`, {
        method: 'POST',
        body,
      });
      expect(response.status).toBe(200);
      expect(mocks.getOwnedProjectByReference).toHaveBeenCalledWith('project-alias', 'user-1');
      const forwardedCall = upstreamFetch.mock.calls.find(([input]) =>
        String(input).startsWith('http://knowgraph.test/'),
      );
      const forwardedBody = forwardedCall?.[1]?.body as FormData;
      expect(forwardedBody.get('project_id')).toBe('project-canonical');
      expect(forwardedBody.get('document_id')).toBe('document-1');
      expect(forwardedBody.get('prompt_template')).toBeNull();
      const forwardedHeaders = new Headers(forwardedCall?.[1]?.headers);
      expect(forwardedHeaders.get('x-agent-id')).toBeNull();
      expect(forwardedHeaders.get('x-agent-provider')).toBeNull();
      expect(forwardedHeaders.get('x-agent-model-key')).toBeNull();
      expect(forwardedHeaders.get('x-agent-model-id')).toBeNull();
    } finally {
      await closeServer(server);
    }
  });

  it('rejects a project outside the authenticated user before Graphiti ingest', async () => {
    mocks.getOwnedProjectByReference.mockResolvedValueOnce(null);
    const upstreamFetch = vi.spyOn(globalThis, 'fetch');
    const { server, baseUrl } = await createApiServer('user-1');
    try {
      const response = await fetch(`${baseUrl}/ingest`, {
        method: 'POST',
        body: uploadBody('someone-elses-project'),
      });
      expect(response.status).toBe(404);
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects an unauthenticated upload before project lookup or ingest', async () => {
    const upstreamFetch = vi.spyOn(globalThis, 'fetch');
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/ingest`, {
        method: 'POST',
        body: uploadBody('project-1'),
      });
      expect(response.status).toBe(401);
      expect(mocks.getOwnedProjectByReference).not.toHaveBeenCalled();
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });

  it('proxies one authenticated project-scoped Graphiti episode deletion', async () => {
    process.env.KNOWGRAPH_URL = 'http://knowgraph.test';
    mocks.getOwnedProjectByReference.mockResolvedValueOnce({ id: 'project-canonical' });
    const realFetch = globalThis.fetch.bind(globalThis);
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input) === 'http://knowgraph.test/delete_episode') {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true, graphiti_episode_uuid: 'episode-1',
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(input, init);
    });
    const { server, baseUrl } = await createApiServer('user-1');
    try {
      const response = await fetch(`${baseUrl}/delete-episode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: 'project-alias', graphiti_episode_uuid: 'episode-1',
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true, graphiti_episode_uuid: 'episode-1',
      });
      const forwarded = upstreamFetch.mock.calls.find(([input]) => (
        String(input) === 'http://knowgraph.test/delete_episode'
      ));
      expect(JSON.parse(String(forwarded?.[1]?.body))).toEqual({
        project_id: 'project-canonical', graphiti_episode_uuid: 'episode-1',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('projects an upstream ingest refusal without exposing its body', async () => {
    const upstream = await createKnowgraphServer({
      ingestStatus: 429,
      ingestBody: {
        error: {
          message: 'secret-provider-diagnostic insufficient_quota',
        },
      },
    });
    process.env.KNOWGRAPH_URL = upstream.baseUrl;
    mocks.getOwnedProjectByReference.mockResolvedValueOnce({ id: 'project-canonical' });
    const api = await createApiServer('user-1');
    try {
      const response = await fetch(`${api.baseUrl}/ingest`, {
        method: 'POST',
        body: uploadBody('project-alias'),
      });
      expect(response.status).toBe(429);
      const payload = await response.json();
      expect(payload).toEqual({
        ok: false,
        error: {
          code: 'knowgraph_ingest_rate_limited',
          message: 'KnowGraph ingest is temporarily rate limited.',
        },
      });
      expect(JSON.stringify(payload)).not.toContain('secret-provider-diagnostic');
      expect(payload).not.toHaveProperty('upstream');
    } finally {
      await closeServer(api.server);
      await closeServer(upstream.server);
    }
  });

  it('returns a stable unavailable error without exposing a transport exception', async () => {
    const closedUpstream = await createKnowgraphServer({});
    process.env.KNOWGRAPH_URL = closedUpstream.baseUrl;
    await closeServer(closedUpstream.server);
    mocks.getOwnedProjectByReference.mockResolvedValueOnce({ id: 'project-canonical' });
    const api = await createApiServer('user-1');
    try {
      const response = await fetch(`${api.baseUrl}/ingest`, {
        method: 'POST',
        body: uploadBody('project-alias'),
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          code: 'knowgraph_ingest_unavailable',
          message: 'KnowGraph ingest service is unavailable.',
        },
      });
    } finally {
      await closeServer(api.server);
    }
  });

  it('projects an upstream deletion failure without exposing its body', async () => {
    const upstream = await createKnowgraphServer({
      deleteStatus: 500,
      deleteBody: {
        error: 'secret-graphiti-delete-diagnostic',
      },
    });
    process.env.KNOWGRAPH_URL = upstream.baseUrl;
    mocks.getOwnedProjectByReference.mockResolvedValueOnce({ id: 'project-canonical' });
    const api = await createApiServer('user-1');
    try {
      const response = await fetch(`${api.baseUrl}/delete-episode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: 'project-alias',
          graphiti_episode_uuid: 'episode-1',
        }),
      });
      expect(response.status).toBe(500);
      const payload = await response.json();
      expect(payload).toEqual({
        ok: false,
        error: {
          code: 'knowgraph_delete_upstream_500',
          message: 'KnowGraph deletion failed at the configured provider.',
        },
      });
      expect(JSON.stringify(payload)).not.toContain('secret-graphiti-delete-diagnostic');
      expect(payload).not.toHaveProperty('upstream');
    } finally {
      await closeServer(api.server);
      await closeServer(upstream.server);
    }
  });
});
