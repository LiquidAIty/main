/**
 * Entity: Saved Cards
 * Relationship: Verifies authorized deck loads and compare-and-set saves consistently use and return the canonical owned Project identity.
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
