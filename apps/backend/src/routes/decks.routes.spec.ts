/**
 * Entity: Saved Cards
 * Relationship: This file verifies authorized saved Card deck loads and compare-and-set saves preserve exact Python-owned readback.
 * Entity: Projects
 * Relationship: This file verifies deck routes use and return the canonical owned Project identity instead of a supplied alias.
 * Entity: Authentication
 * Relationship: This file verifies each deck request is scoped through the owner-authorized Project boundary.
 * Entity: Card Profiles
 * Relationship: This file verifies profile credential publication is derived only from unique enabled saved Hermes Cards after profile-owner checks.
 * Entity: MCP Host
 * Relationship: This file verifies each projected Card profile receives a Project/deck/profile-scoped internal MCP bearer without cacheable transport.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attachSavedCardToProject: vi.fn(),
  assertCardProfileOwner: vi.fn(),
  createInternalMcpBearer: vi.fn(),
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
  assertCardProfileOwner: mocks.assertCardProfileOwner,
  discardFreshMembership: mocks.discardFreshMembership,
  listSavedCardsForProject: mocks.listSavedCardsForProject,
}));
vi.mock('../services/mcp/internalMcpAuth', () => ({
  createInternalMcpBearer: mocks.createInternalMcpBearer,
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
    mocks.assertCardProfileOwner.mockResolvedValue(undefined);
    mocks.createInternalMcpBearer.mockImplementation(({ profile }: { profile: string }) => (
      `scoped-${profile}`
    ));
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

  it('mints one no-store MCP credential for each unique enabled saved Hermes profile', async () => {
    mocks.getDeckDocument.mockResolvedValue({
      deck: {
        id: 'deck_builder',
        name: 'Trading',
        nodes: [
          { id: 'main', enabled: true, runtime: { kind: 'hermes', mode: 'main', profile: 'main' } },
          { id: 'know', enabled: true, runtime: { kind: 'hermes', mode: 'delegate', profile: 'knowgraph' } },
          { id: 'disabled', enabled: false, runtime: { kind: 'hermes', mode: 'delegate', profile: 'ignored' } },
          { id: 'local', enabled: true, runtime: { kind: 'python', mode: 'delegate', profile: 'not-hermes' } },
        ],
        edges: [],
        promptTemplates: [],
      },
      meta: { deckRevision: 'revision-one', deckSavedAt: '2026-10-16T00:00:00Z' },
    });

    const response = await request(
      '/api/projects/project-alias/decks/deck_builder/profile-credentials',
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      projectId: 'project-canonical',
      deckId: 'deck_builder',
      credentials: [
        { profile: 'knowgraph', bearer: 'scoped-knowgraph' },
        { profile: 'main', bearer: 'scoped-main' },
      ],
    });
    expect(mocks.assertCardProfileOwner.mock.calls).toEqual([
      ['knowgraph', 'owner-one'],
      ['main', 'owner-one'],
    ]);
    expect(mocks.createInternalMcpBearer).toHaveBeenCalledWith({
      kind: 'card-runtime',
      ownerUserId: 'owner-one',
      projectId: 'project-canonical',
      deckId: 'deck_builder',
      profile: 'knowgraph',
    });
  });

  it('refuses duplicate saved Card profiles instead of minting ambiguous credentials', async () => {
    mocks.getDeckDocument.mockResolvedValue({
      deck: {
        id: 'deck_builder',
        name: 'Invalid',
        nodes: [
          { id: 'one', runtime: { kind: 'hermes', mode: 'delegate', profile: 'shared' } },
          { id: 'two', runtime: { kind: 'hermes', mode: 'delegate', profile: 'shared' } },
        ],
        edges: [],
        promptTemplates: [],
      },
      meta: { deckRevision: 'revision-one', deckSavedAt: '2026-10-16T00:00:00Z' },
    });

    const response = await request(
      '/api/projects/project-alias/decks/deck_builder/profile-credentials',
      { method: 'POST' },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'persisted_card_profile_unavailable',
    });
    expect(mocks.createInternalMcpBearer).not.toHaveBeenCalled();
  });
});
