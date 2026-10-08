import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const systemEdges = vi.hoisted(() => ([
  { id: 'main-builder', source: 'card_main_chat', target: 'builder', edgeType: 'flow' },
]));
const store = vi.hoisted(() => ({
  createProject: vi.fn(),
  discardFreshProject: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
}));
const decks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(),
  saveDeckDocument: vi.fn(),
}));
const access = vi.hoisted(() => ({
  requireOwnedProject: vi.fn(),
  authenticatedUserId: vi.fn(),
}));
const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));

vi.mock('../services/projectStore', () => ({
  ...store,
}));
vi.mock('../decks/defaultProjectDeck', () => ({
  DEFAULT_PROJECT_DECK_ID: 'deck_builder',
  DEFAULT_PROJECT_EDGES: systemEdges,
}));
vi.mock('../decks/store', () => decks);
vi.mock('./projectAccess', () => access);
vi.mock('../db/pool', () => ({ pool: database }));

import projectsRouter from './projects.routes';

const app = express().use(express.json()).use('/api/projects', projectsRouter);
let server: Server | null = null;

async function request(path: string, init?: RequestInit): Promise<Response> {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

afterEach(async () => {
  if (!server) return;
  const active = server;
  server = null;
  await new Promise<void>((resolve, reject) => active.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  access.authenticatedUserId.mockReturnValue('owner-one');
  store.createProject.mockResolvedValue({
    id: 'project-new', name: 'New Project', code: 'new-project', status: 'active', project_type: 'agent',
  });
  decks.getDeckDocument.mockResolvedValue({
    deck: { id: 'deck_builder', name: 'Agent Card Deck', version: 10, nodes: [], edges: [], promptTemplates: [] },
    meta: { deckRevision: 'seed-revision' },
  });
  decks.saveDeckDocument.mockResolvedValue({
    deck: { id: 'deck_builder', edges: systemEdges },
    meta: { deckRevision: 'topology-revision' },
  });
});

describe('POST /api/projects', () => {
  it('finishes the server-owned System6 deck and needs no browser deck document', async () => {
    const response = await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project', code: 'new-project', project_type: 'agent' }),
    });

    expect(response.status).toBe(200);
    expect(store.createProject).toHaveBeenCalledWith(
      'New Project', 'new-project', 'agent', 'owner-one',
    );
    expect(decks.getDeckDocument).toHaveBeenCalledWith('project-new', 'deck_builder');
    expect(decks.saveDeckDocument).toHaveBeenCalledWith(
      'project-new',
      'deck_builder',
      expect.objectContaining({ edges: systemEdges }),
      { expectedRevision: 'seed-revision' },
    );
    expect(store.discardFreshProject).not.toHaveBeenCalled();
  });

  it('removes the fresh relational shell if System6 topology finalization fails', async () => {
    decks.saveDeckDocument.mockRejectedValueOnce(new Error('topology_failed'));
    store.discardFreshProject.mockResolvedValue(undefined);

    const response = await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project', project_type: 'agent' }),
    });

    expect(response.status).toBe(500);
    expect(store.discardFreshProject).toHaveBeenCalledWith('project-new', 'owner-one');
  });

});
