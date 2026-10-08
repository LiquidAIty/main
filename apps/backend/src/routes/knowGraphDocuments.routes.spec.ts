import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import router from './knowGraphDocuments.routes';

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

  it('proxies one authenticated project-scoped Graphiti fact deletion', async () => {
    process.env.KNOWGRAPH_URL = 'http://knowgraph.test';
    mocks.getOwnedProjectByReference.mockResolvedValueOnce({ id: 'project-canonical' });
    const realFetch = globalThis.fetch.bind(globalThis);
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input) === 'http://knowgraph.test/delete_fact') {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true, kind: 'fact', graphiti_fact_uuid: 'fact-1',
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(input, init);
    });
    const { server, baseUrl } = await createApiServer('user-1');
    try {
      const response = await fetch(`${baseUrl}/delete-fact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: 'project-alias', graphiti_fact_uuid: 'fact-1', kind: 'fact',
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, kind: 'fact', graphiti_fact_uuid: 'fact-1' });
      const forwarded = upstreamFetch.mock.calls.find(([input]) => (
        String(input) === 'http://knowgraph.test/delete_fact'
      ));
      expect(JSON.parse(String(forwarded?.[1]?.body))).toEqual({
        project_id: 'project-canonical', graphiti_fact_uuid: 'fact-1', kind: 'fact',
      });
    } finally {
      await closeServer(server);
    }
  });
});
