import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const decks = vi.hoisted(() => ({
  deleteCardFromDeck: vi.fn(),
  getDeckDocument: vi.fn(),
  getV3ProjectBlob: vi.fn(),
  saveDeckDocument: vi.fn(),
}));
const membership = vi.hoisted(() => ({
  attachSavedCardToProject: vi.fn(),
  discardFreshMembership: vi.fn(),
  listSavedCardsForProject: vi.fn(),
}));
const startup = vi.hoisted(() => ({ reconcile: vi.fn() }));
const access = vi.hoisted(() => ({ requireOwnedProject: vi.fn() }));

vi.mock('../decks/store', () => decks);
vi.mock('../services/agentBuilderStore', () => membership);
vi.mock('../startup/pythonOwnedStartup', () => ({
  requestConnectedAgentTerminalReconcile: startup.reconcile,
}));
vi.mock('./projectAccess', () => access);

import decksRouter from './decks.routes';

const app = express().use(express.json()).use('/api/projects', decksRouter);
let server: Server | null = null;

async function request(init: RequestInit): Promise<Response> {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return fetch(
    `http://127.0.0.1:${address.port}/api/projects/project-one/decks/deck_builder/memberships`,
    init,
  );
}

afterEach(async () => {
  if (!server) return;
  const active = server;
  server = null;
  await new Promise<void>((resolve, reject) => active.close((error) => (
    error ? reject(error) : resolve()
  )));
});

const attachedCard = {
  id: 'card-research',
  _cardRevisionId: 'revision-existing',
};
const loadedBefore = {
  deck: { id: 'deck_builder', nodes: [attachedCard], edges: [] },
  meta: { deckRevision: 'deck-before' },
};
const loadedAfter = {
  deck: { id: 'deck_builder', nodes: [attachedCard], edges: [] },
  meta: { deckRevision: 'deck-after' },
};

beforeEach(() => {
  vi.clearAllMocks();
  access.requireOwnedProject.mockResolvedValue({ ownerUserId: 'owner-one' });
  membership.attachSavedCardToProject.mockResolvedValue({
    cardPresenceCreated: true,
    runtimeProfile: 'research',
  });
  membership.discardFreshMembership.mockResolvedValue(undefined);
  decks.getDeckDocument.mockResolvedValue(loadedBefore);
  decks.saveDeckDocument.mockResolvedValue(loadedAfter);
  startup.reconcile.mockResolvedValue([]);
});

function attachRequest(): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cardId: 'card-research',
      cardRevisionId: 'revision-existing',
      expectedDeckRevision: 'deck-before',
      position: { x: 700, y: 40 },
    }),
  };
}

describe('POST saved Card membership', () => {
  it('returns the durable Python result even when runtime reconciliation is deferred', async () => {
    startup.reconcile.mockRejectedValueOnce(new Error('runtime_temporarily_unavailable'));

    const response = await request(attachRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      ok: true,
      meta: { deckRevision: 'deck-after' },
    }));
    expect(membership.discardFreshMembership).not.toHaveBeenCalled();
  });

  it('compensates an uncommitted Python failure without leaving a fresh Card presence', async () => {
    decks.saveDeckDocument.mockRejectedValueOnce(new Error('python_save_failed'));

    const response = await request(attachRequest());

    expect(response.status).toBe(500);
    expect(membership.discardFreshMembership).toHaveBeenCalledWith(
      'project-one',
      'deck_builder',
      'card-research',
      'revision-existing',
      'owner-one',
      true,
      'deck-before',
    );
  });

  it('uses canonical readback when Python committed before its response failed', async () => {
    decks.saveDeckDocument.mockRejectedValueOnce(new Error('response_lost'));
    decks.getDeckDocument
      .mockResolvedValueOnce(loadedBefore)
      .mockResolvedValueOnce(loadedAfter);

    const response = await request(attachRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      ok: true,
      meta: { deckRevision: 'deck-after' },
    }));
    expect(membership.discardFreshMembership).not.toHaveBeenCalled();
  });
});
