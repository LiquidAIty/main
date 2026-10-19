/**
 * Entity: Projects
 * Relationship: This file verifies Project creation and deletion return exact owner-scoped identities and report partial-state failures honestly.
 *
 * Entity: Saved Cards
 * Relationship: This file verifies Project creation persists and returns the source-default saved Card roster, recovers committed readback, and compensates only a proven absent deck.
 * Entity: Card Topology
 * Relationship: This file verifies the persisted Project deck includes the source-default Card topology without substituting another seed.
 * Entity: Authentication
 * Relationship: This file verifies Project lifecycle routes use the authenticated canonical owner identity for creation and deletion.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProjectDeck } from '../decks/defaultProjectDeck';

const mocks = vi.hoisted(() => ({
  authenticatedUserId: vi.fn(),
  createProject: vi.fn(),
  discardFreshProject: vi.fn(),
  getDeckDocument: vi.fn(),
  listOwnedProjects: vi.fn(),
  requireOwnedProject: vi.fn(),
  saveDeckDocument: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../db/pool', () => ({ pool: { connect: mocks.connect } }));
vi.mock('../decks/deckDomainClient', () => ({
  getDeckDocument: mocks.getDeckDocument,
  saveDeckDocument: mocks.saveDeckDocument,
}));
vi.mock('../services/projectStore', () => ({
  createProject: mocks.createProject,
  discardFreshProject: mocks.discardFreshProject,
  listOwnedProjects: mocks.listOwnedProjects,
}));
vi.mock('./projectAccess', () => ({
  authenticatedUserId: mocks.authenticatedUserId,
  requireOwnedProject: mocks.requireOwnedProject,
}));

import router from './projects.routes';

async function request(path: string, init: RequestInit): Promise<Response> {
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

describe('Project route lifecycle', () => {
  beforeEach(() => {
    mocks.authenticatedUserId.mockReturnValue('owner-one');
    mocks.createProject.mockResolvedValue({
      id: 'project-new', name: 'New Project', code: 'new-project', status: 'active',
    });
    mocks.getDeckDocument.mockResolvedValue({
      deck: null,
      meta: { deckRevision: null },
    });
    mocks.saveDeckDocument.mockResolvedValue({
      deck: createDefaultProjectDeck(),
      meta: { deckRevision: 'deck-created', deckSavedAt: '2026-10-16T00:00:00Z' },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('persists and returns the exact backend-owned canonical deck', async () => {
    const response = await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project', code: 'new-project' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      projectId: 'project-new',
      project: { id: 'project-new' },
      deck: {
        id: 'deck_builder',
        nodes: [
          { id: 'card_main_chat' },
          { id: 'builder' },
          { id: 'card_thinkgraph' },
          { id: 'card_magentic' },
          { id: 'card_team' },
          { id: 'card_knowgraph' },
        ],
      },
      meta: { deckRevision: 'deck-created' },
    });
    expect(mocks.saveDeckDocument).toHaveBeenCalledWith(
      'project-new',
      'deck_builder',
      createDefaultProjectDeck(),
      { expectedRevision: null },
    );
    expect(mocks.discardFreshProject).not.toHaveBeenCalled();
  });

  it('returns exact canonical readback when the write response is lost after commit', async () => {
    const persisted = createDefaultProjectDeck();
    mocks.saveDeckDocument.mockRejectedValue(new Error('python_rails_reset'));
    mocks.getDeckDocument.mockResolvedValue({
      deck: persisted,
      meta: { deckRevision: 'deck-recovered', deckSavedAt: '2026-10-16T00:00:00Z' },
    });

    const response = await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      projectId: 'project-new',
      deck: { id: 'deck_builder' },
      meta: { deckRevision: 'deck-recovered' },
    });
    expect(mocks.discardFreshProject).not.toHaveBeenCalled();
  });

  it('does not delete a potentially committed Project when canonical readback is unavailable', async () => {
    mocks.saveDeckDocument.mockRejectedValue(new Error('python_rails_reset'));
    mocks.getDeckDocument.mockRejectedValue(new Error('python_rails_unavailable'));

    const response = await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'project_initialization_outcome_unknown',
    });
    expect(mocks.discardFreshProject).not.toHaveBeenCalled();
  });

  it('reports a failed creation compensation instead of hiding partial state', async () => {
    mocks.saveDeckDocument.mockRejectedValue(new Error('deck_initialization_failed'));
    mocks.discardFreshProject.mockRejectedValue(new Error('retained_child_state'));

    const response = await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project', code: 'new-project' }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'project_initialization_compensation_failed',
    });
    expect(mocks.discardFreshProject).toHaveBeenCalledWith('project-new', 'owner-one');
  });

  it('uses the canonical authorized Project ID for code-based deletion', async () => {
    const statements: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values });
        if (sql.startsWith('DELETE FROM ag_catalog.projects')) {
          return { rowCount: 1, rows: [{ id: 'project-canonical' }] };
        }
        return { rowCount: null, rows: [] };
      }),
      release: vi.fn(),
    };
    mocks.requireOwnedProject.mockResolvedValue({
      ownerUserId: 'owner-one',
      projectId: 'project-canonical',
    });
    mocks.connect.mockResolvedValue(client);

    const response = await request('/api/projects/project-code', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deleted: 'project-canonical' });
    const deletion = statements.find(({ sql }) => sql.startsWith('DELETE FROM ag_catalog.projects'));
    expect(deletion?.values).toEqual(['project-canonical', 'owner-one']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
