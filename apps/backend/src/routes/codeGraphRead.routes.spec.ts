/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: CodeGraph
 * Relationship: This file verifies browser CodeGraph reads remain fixed-purpose and preserve typed provider unavailability without a fallback.
 * Entity: Authentication
 * Relationship: This file verifies each CodeGraph read resolves the canonical owner-scoped Project before dispatch.
 * Entity: Builder Card
 * Relationship: This file verifies the server injects the persisted Builder Card and deck and rejects any browser-authored provider or tool scope.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchCodeGraphRead: vi.fn(),
  requireOwnedProject: vi.fn(async () => ({
    ownerUserId: 'owner-1',
    projectId: 'canonical-project-1',
  })),
}));

vi.mock('../services/pythonRailsClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/pythonRailsClient')>()),
  fetchCodeGraphRead: mocks.fetchCodeGraphRead,
}));
vi.mock('./projectAccess', () => ({
  requireOwnedProject: mocks.requireOwnedProject,
}));

import codeGraphReadRoutes from './codeGraphRead.routes';

async function createServer(): Promise<{ server: Server; url: string }> {
  const app = express();
  app.use(express.json());
  app.use('/api/codegraph', codeGraphReadRoutes);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/api/codegraph/read` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.fetchCodeGraphRead.mockReset();
  mocks.requireOwnedProject.mockReset();
  mocks.requireOwnedProject.mockResolvedValue({
    ownerUserId: 'owner-1', projectId: 'canonical-project-1',
  });
});

describe('CodeGraph read transport', () => {
  it('injects canonical Project and Builder scope', async () => {
    mocks.fetchCodeGraphRead.mockResolvedValue({
      schemaVersion: 'codegraph.read.v1', status: 'ready', mode: 'file',
    });
    const { server, url } = await createServer();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-alias', mode: 'file', filePath: 'client/src/example.ts',
        }),
      });
      expect(response.status).toBe(200);
      expect(mocks.requireOwnedProject).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), 'project-alias',
      );
      expect(mocks.fetchCodeGraphRead).toHaveBeenCalledWith({
        projectId: 'canonical-project-1',
        deckId: 'deck_builder',
        cardId: 'builder',
        mode: 'file',
        filePath: 'client/src/example.ts',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('rejects browser-authored provider scope before dispatch', async () => {
    const { server, url } = await createServer();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', mode: 'projection', tool: 'cbm.delete_project',
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false, error: 'codegraph_scope_override_forbidden',
      });
      expect(mocks.requireOwnedProject).not.toHaveBeenCalled();
      expect(mocks.fetchCodeGraphRead).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('preserves a typed provider-unavailable result without fallback', async () => {
    mocks.fetchCodeGraphRead.mockResolvedValue({
      schemaVersion: 'codegraph.read.v1',
      status: 'unavailable',
      mode: 'projection',
      errors: [{ code: 'codegraph_saved_tool_not_granted' }],
    });
    const { server, url } = await createServer();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'project-1', mode: 'projection' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'unavailable' });
      expect(mocks.fetchCodeGraphRead).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });
});
