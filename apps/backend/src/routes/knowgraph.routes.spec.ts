import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import router, {
  boundedKnowGraphProperties,
  portableKnowGraphFact,
} from './knowgraph.routes';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  pool: { query: mocks.poolQuery },
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

  it('projects one native Graphiti fact as a portable sourced temporal Know', () => {
    expect(portableKnowGraphFact(
      'fact-1',
      'RELATES_TO',
      {
        name: 'PARTNERS_WITH',
        fact: 'Alpha partners with Beta.',
        episodes: ['episode-1', 'episode-2'],
        created_at: '2026-09-23T12:00:00Z',
        reference_time: '2026-09-01T00:00:00Z',
        valid_at: '2026-09-01T00:00:00Z',
      },
      { uuid: 'entity-a', name: 'Alpha' },
      { uuid: 'entity-b', name: 'Beta' },
    )).toMatchObject({
      authority: 'know',
      nativeStore: 'graphiti/neo4j',
      portableKind: 'know',
      nativeFactUuid: 'fact-1',
      nativeRelationshipType: 'RELATES_TO',
      nativeRelation: 'PARTNERS_WITH',
      fact: 'Alpha partners with Beta.',
      sourceEntity: { uuid: 'entity-a', name: 'Alpha' },
      targetEntity: { uuid: 'entity-b', name: 'Beta' },
      supportingEpisodeUuids: ['episode-1', 'episode-2'],
      temporalStatus: 'current',
    });
  });

  it('passively projects stored Jev metadata without replacing native fact fields', () => {
    const properties = portableKnowGraphFact(
      'fact-1',
      'RELATES_TO',
      {
        name: 'was awarded a launch services contract by',
        fact: 'NASA awarded Rocket Lab a launch services contract.',
        episodes: ['episode-1'],
        valid_at: '2026-09-01T00:00:00Z',
        jev_relation_winner: 'CONTRACTS_WITH',
        jev_relation_distribution_json: JSON.stringify({
          CONTRACTS_WITH: 0.92,
          OTHER_RELATION: 0.08,
        }),
        jev_label_confidence: 0.92,
        jev_requested_model: 'typesafe/jev-1.13',
        jev_resolved_model: 'typesafe/jev-1.13',
        jev_evaluated_at: '2026-09-24T12:00:00Z',
        jev_question_schema_version: 'knowgraph.relationship.v1',
        jev_ontology_version: 'knowgraph.v1',
        jev_ontology_hash: 'hash-1',
      },
      { uuid: 'rocket-lab', name: 'Rocket Lab' },
      { uuid: 'nasa', name: 'NASA' },
    );

    expect(properties).toMatchObject({
      nativeFactUuid: 'fact-1',
      nativeRelation: 'was awarded a launch services contract by',
      fact: 'NASA awarded Rocket Lab a launch services contract.',
      supportingEpisodeUuids: ['episode-1'],
      validAt: '2026-09-01T00:00:00Z',
      jevCanonicalRelation: 'CONTRACTS_WITH',
      relationship_strength: 0.92,
      jev: {
        nativeFactUuid: 'fact-1',
        status: 'success',
        winner: 'CONTRACTS_WITH',
        distribution: { CONTRACTS_WITH: 0.92, OTHER_RELATION: 0.08 },
        label_confidence: 0.92,
      },
    });
  });

  it('resolves the authenticated project selector to its canonical id before Graphiti ingest', async () => {
    process.env.KNOWGRAPH_URL = 'http://knowgraph.test';
    mocks.poolQuery.mockResolvedValueOnce({ rows: [{ id: 'project-canonical' }] });
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
      expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining('owner_user_id'), [
        'user-1',
        'project-alias',
      ]);
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
    mocks.poolQuery.mockResolvedValueOnce({ rows: [] });
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
      expect(mocks.poolQuery).not.toHaveBeenCalled();
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });
});
