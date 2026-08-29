import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import router, { boundedKnowGraphProperties } from './knowgraph.routes';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  getDeckDocument: vi.fn(),
  resolveCardModelStrict: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: mocks.getDeckDocument,
}));

vi.mock('../cards/runtime', () => ({
  resolveCardModelStrict: mocks.resolveCardModelStrict,
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

function uploadBody(projectId: string): FormData {
  const body = new FormData();
  body.append('project_id', projectId);
  body.append('document_id', 'document-1');
  body.append('file', new Blob(['%PDF-1.4 route proof'], { type: 'application/pdf' }), 'source.pdf');
  return body;
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.poolQuery.mockReset();
  mocks.getDeckDocument.mockReset();
  mocks.resolveCardModelStrict.mockReset();
  delete process.env.KNOWGRAPH_URL;
});

describe('KnowGraph PDF upload project authority', () => {
  it('keeps native provenance but excludes embedding vectors from bounded UI projections', () => {
    expect(boundedKnowGraphProperties({
      uuid: 'node-1',
      source: 'Graphiti',
      name_embedding: [0.1, 0.2],
      embedding: [0.3],
      embedding_1024: [0.4],
      entity_edges: ['edge-1'],
    })).toEqual({
      uuid: 'node-1',
      source: 'Graphiti',
      entity_edges: ['edge-1'],
    });
  });

  it('resolves the authenticated project selector to its canonical id before Graphiti ingest', async () => {
    process.env.KNOWGRAPH_URL = 'http://knowgraph.test';
    mocks.poolQuery.mockResolvedValueOnce({ rows: [{ id: 'project-canonical' }] });
    mocks.getDeckDocument.mockResolvedValueOnce({
      deck: {
        nodes: [{
          id: 'card_hermes_steward',
          prompt: 'Preserve source provenance.',
          runtimeOptions: { provider: 'openrouter', modelKey: 'deepseek' },
        }],
      },
    });
    mocks.resolveCardModelStrict.mockReturnValueOnce({
      provider: 'openrouter',
      providerModelId: 'deepseek/deepseek-chat',
    });
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
      const response = await fetch(`${baseUrl}/ingest`, {
        method: 'POST',
        body: uploadBody('project-alias'),
      });
      expect(response.status).toBe(200);
      expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining('owner_user_id'), [
        'user-1',
        'project-alias',
      ]);
      expect(mocks.getDeckDocument).toHaveBeenCalledWith('project-canonical', 'deck_builder');
      expect(mocks.resolveCardModelStrict).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'card_hermes_steward' }),
      );
      const forwardedCall = upstreamFetch.mock.calls.find(([input]) =>
        String(input).startsWith('http://knowgraph.test/'),
      );
      const forwardedBody = forwardedCall?.[1]?.body as FormData;
      expect(forwardedBody.get('project_id')).toBe('project-canonical');
      expect(forwardedBody.get('document_id')).toBe('document-1');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects a project outside the authenticated user before model configuration or ingest', async () => {
    mocks.poolQuery.mockResolvedValueOnce({ rows: [] });
    const upstreamFetch = vi.spyOn(globalThis, 'fetch');
    const { server, baseUrl } = await createApiServer('user-1');
    try {
      const response = await fetch(`${baseUrl}/ingest`, {
        method: 'POST',
        body: uploadBody('someone-elses-project'),
      });
      expect(response.status).toBe(404);
      expect(mocks.getDeckDocument).not.toHaveBeenCalled();
      expect(mocks.resolveCardModelStrict).not.toHaveBeenCalled();
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
      expect(mocks.poolQuery).not.toHaveBeenCalled();
      expect(mocks.getDeckDocument).not.toHaveBeenCalled();
      expect(mocks.resolveCardModelStrict).not.toHaveBeenCalled();
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });
});
