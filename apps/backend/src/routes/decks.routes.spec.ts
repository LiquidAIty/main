/**
 * Entity: Saved Cards
 * Relationship: This file verifies authorized saved Card deck loads and compare-and-set saves preserve exact Python-owned readback.
 * Entity: Projects
 * Relationship: This file verifies deck routes use and return the canonical owned Project identity instead of a supplied alias.
 * Entity: Authentication
 * Relationship: This file verifies each deck request is scoped through the owner-authorized Project boundary.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attachSavedCardToProject: vi.fn(),
  discardFreshMembership: vi.fn(),
  getDeckDocument: vi.fn(),
  listSavedCardsForProject: vi.fn(),
  requireOwnedProject: vi.fn(),
  saveDeckDocument: vi.fn(),
}));

vi.mock('../decks/deckDomainClient', () => ({
  getDeckDocument: mocks.getDeckDocument,
  saveDeckDocument: mocks.saveDeckDocument,
}));
vi.mock('../services/projectStore', () => ({
  attachSavedCardToProject: mocks.attachSavedCardToProject,
  discardFreshMembership: mocks.discardFreshMembership,
  listSavedCardsForProject: mocks.listSavedCardsForProject,
}));
vi.mock('./projectAccess', () => ({
  requireOwnedProject: mocks.requireOwnedProject,
}));

import router from './decks.routes';

async function request(path: string, init?: RequestInit): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const address = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(
      error => error ? reject(error) : resolve(),
    ));
  }
}

describe('deck route identity contract', () => {
  beforeEach(() => {
    mocks.requireOwnedProject.mockResolvedValue({
      ownerUserId: 'owner-one',
      projectId: 'project-canonical',
    });
    mocks.getDeckDocument.mockResolvedValue({
      deck: {
        id: 'deck_builder',
        name: 'Builder',
        nodes: [],
        edges: [],
        promptTemplates: [],
      },
      meta: { deckRevision: 'revision-one', deckSavedAt: '2026-10-16T00:00:00Z' },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  function setupCard(overrides: Record<string, unknown> = {}) {
    return { id: 'research-card', kind: 'agent', title: 'Research', enabled: true,
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'research' },
      runtimeOptions: { tools: ['graphiti.search_knows'] },
      _cardRevisionId: 'saved-revision', ...overrides };
  }

  async function connectTools(body: unknown = { expectedCardRevisionId: 'saved-revision' }) {
    return request('/api/projects/project-alias/decks/deck_builder/cards/research-card/app-tools', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  it('issues credentials only from the owned saved Card and never writes a deck or profile', async () => {
    vi.stubEnv('LIQUIDAITY_INTERNAL_MCP_SECRET', '0123456789abcdef0123456789abcdef');
    vi.stubEnv('LIQUIDAITY_INTERNAL_MCP_URL', 'http://127.0.0.1:8765/mcp');
    mocks.getDeckDocument.mockResolvedValue({ deck: { nodes: [setupCard()] }, meta: {} });
    const response = await connectTools();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json();
    expect(result).toMatchObject({ profile: 'research', cardId: 'research-card',
      cardRevisionId: 'saved-revision', tools: ['graphiti.search_knows'] });
    const claims = JSON.parse(Buffer.from(result.bearerToken.split('.')[1], 'base64url').toString());
    expect(claims.principal).toEqual({ kind: 'card-runtime', ownerUserId: 'owner-one',
      projectId: 'project-canonical', deckId: 'deck_builder', profile: 'research' });
    expect(mocks.getDeckDocument).toHaveBeenCalledWith('project-canonical', 'deck_builder');
    expect(mocks.saveDeckDocument).not.toHaveBeenCalled();
    expect(mocks.attachSavedCardToProject).not.toHaveBeenCalled();
  });

  it.each([
    [{ expectedCardRevisionId: 'saved-revision', profile: 'main' }],
    [{ expectedCardRevisionId: 'saved-revision', ownerUserId: 'another-owner' }],
    [{ expectedCardRevisionId: 'saved-revision', tools: ['*'] }], [{}],
  ])('rejects forged or incomplete setup inputs', async body => {
    expect((await connectTools(body)).status).toBe(400);
    expect(mocks.getDeckDocument).not.toHaveBeenCalled();
  });

  it.each([
    [[], 404], [[setupCard({ enabled: false })], 404],
    [[setupCard({ _cardRevisionId: 'newer-revision' })], 409],
    [[setupCard(), setupCard({ id: 'duplicate-profile' })], 409],
  ])('refuses absent, inactive, stale or ambiguous saved identities', async (nodes, expectedStatus) => {
    mocks.getDeckDocument.mockResolvedValue({ deck: { nodes }, meta: {} });
    const response = await connectTools();
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).not.toHaveProperty('bearerToken');
  });

  it('requires authentication and Project ownership before loading a Card', async () => {
    mocks.requireOwnedProject.mockImplementation(async (_req, res) => {
      res.status(401).json({ ok: false, error: 'project_owner_session_required' });
      return null;
    });
    expect((await connectTools()).status).toBe(401);
    expect(mocks.getDeckDocument).not.toHaveBeenCalled();
  });

  it('returns the canonical authorized Project identity with a deck load', async () => {
    const response = await request('/api/projects/project-alias/decks/deck_builder');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      projectId: 'project-canonical',
      deck: { id: 'deck_builder' },
      meta: { deckRevision: 'revision-one' },
    });
    expect(mocks.getDeckDocument).toHaveBeenCalledWith(
      'project-canonical',
      'deck_builder',
    );
  });

  it('forwards an explicit deletion only under the authorized Project identity', async () => {
    const document = { id: 'deck_builder', name: 'Builder', nodes: [], edges: [], promptTemplates: [] };
    mocks.saveDeckDocument.mockResolvedValue({ deck: document, meta: { deckRevision: 'next' } });
    const response = await request('/api/projects/project-alias/decks/deck_builder', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document, expectedRevision: 'before', removeCardId: 'card_worldsignals_agent' }),
    });
    expect(response.status).toBe(200);
    expect(mocks.saveDeckDocument).toHaveBeenCalledWith('project-canonical', 'deck_builder', document,
      { expectedRevision: 'before', removeCardId: 'card_worldsignals_agent' });
  });

  it('returns the same canonical identity with a successful compare-and-swap save', async () => {
    mocks.saveDeckDocument.mockResolvedValue({
      deck: {
        id: 'deck_builder',
        name: 'Builder',
        nodes: [],
        edges: [],
        promptTemplates: [],
      },
      meta: { deckRevision: 'revision-two', deckSavedAt: '2026-10-16T00:00:01Z' },
    });

    const document = {
      id: 'deck_builder',
      name: 'Builder',
      nodes: [],
      edges: [],
      promptTemplates: [],
    };
    const response = await request(
      '/api/projects/project-alias/decks/deck_builder',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, expectedRevision: 'revision-one' }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      projectId: 'project-canonical',
      deck: { id: 'deck_builder' },
      meta: { deckRevision: 'revision-two' },
    });
    expect(mocks.saveDeckDocument).toHaveBeenCalledWith(
      'project-canonical',
      'deck_builder',
      document,
      { expectedRevision: 'revision-one' },
    );
  });

});
