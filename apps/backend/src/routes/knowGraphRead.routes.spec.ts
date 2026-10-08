import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import router, {
  boundedKnowGraphProperties,
  portableKnowGraphFact,
} from './knowGraphRead.routes';

const mocks = vi.hoisted(() => ({
  getOwnedProjectByReference: vi.fn(),
}));

vi.mock('../services/projectStore', () => ({
  getOwnedProjectByReference: mocks.getOwnedProjectByReference,
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
});

describe('KnowGraph read projection', () => {
  it('keeps Graphiti provenance but excludes embedding vectors from bounded UI projections', () => {
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

  it('projects one Graphiti fact as a portable sourced temporal Know', () => {
    expect(portableKnowGraphFact(
      'fact-1',
      'RELATES_TO',
      {
        name: 'partners with',
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
      graphitiStore: 'neo4j',
      portableKind: 'know',
      graphitiFactUuid: 'fact-1',
      graphitiRelationshipType: 'RELATES_TO',
      graphitiRelation: 'partners with',
      fact: 'Alpha partners with Beta.',
      sourceEntity: { uuid: 'entity-a', name: 'Alpha' },
      targetEntity: { uuid: 'entity-b', name: 'Beta' },
      supportingEpisodeUuids: ['episode-1', 'episode-2'],
      temporalStatus: 'current',
    });
  });

  it('passively projects stored Jev metadata without replacing Graphiti fact fields', () => {
    const properties = portableKnowGraphFact(
      'fact-1',
      'RELATES_TO',
      {
        name: 'was awarded a launch services contract by',
        fact: 'NASA awarded Rocket Lab a launch services contract.',
        episodes: ['episode-1'],
        valid_at: '2026-09-01T00:00:00Z',
        jev_relation_winner: 'PROVIDES',
        jev_relation_distribution_json: JSON.stringify({
          PROVIDES: 0.92,
          ASSOCIATED_WITH: 0.08,
        }),
        jev_label_confidence: 0.92,
        jev_requested_model: 'typesafe/jev-1.13',
        jev_resolved_model: 'typesafe/jev-1.13',
        jev_evaluated_at: '2026-09-24T12:00:00Z',
        jev_question_schema_version: 'knowgraph.relationship-choice.v2',
        jev_ontology_version: 'jev.semantic-relationships.v1',
        jev_ontology_hash: 'hash-1',
      },
      { uuid: 'rocket-lab', name: 'Rocket Lab' },
      { uuid: 'nasa', name: 'NASA' },
    );

    expect(properties).toMatchObject({
      graphitiFactUuid: 'fact-1',
      graphitiRelation: 'was awarded a launch services contract by',
      fact: 'NASA awarded Rocket Lab a launch services contract.',
      supportingEpisodeUuids: ['episode-1'],
      validAt: '2026-09-01T00:00:00Z',
      jevCanonicalRelation: 'PROVIDES',
      relationship_strength: 0.92,
      jev: {
        graphitiFactUuid: 'fact-1',
        status: 'success',
        winner: 'PROVIDES',
        distribution: { PROVIDES: 0.92, ASSOCIATED_WITH: 0.08 },
        label_confidence: 0.92,
      },
    });
  });
});

describe('KnowGraph read route project authority', () => {
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
        `${authenticated.baseUrl}/expand?project_id=project-alias&node_id=node-1`,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        ok: false,
        error: { message: 'KnowGraph project not found.' },
      });
      expect(mocks.getOwnedProjectByReference).toHaveBeenCalledWith('project-alias', 'user-1');
    } finally {
      await closeServer(authenticated.server);
    }
  });
});
