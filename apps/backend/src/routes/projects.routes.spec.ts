import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      deck: { id: 'deck_builder', name: 'Deck', nodes: [], edges: [], promptTemplates: [] },
      meta: { deckRevision: 'deck-before' },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
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
