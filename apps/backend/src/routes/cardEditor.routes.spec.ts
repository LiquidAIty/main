import express from 'express';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestPythonRailsJson, getProjectCard } = vi.hoisted(() => ({
  requestPythonRailsJson: vi.fn(),
  getProjectCard: vi.fn(),
}));

vi.mock('../services/pythonRailsClient', () => ({ requestPythonRailsJson }));
vi.mock('../services/agentBuilderStore', () => ({ getProjectCard }));

import cardEditorRoutes from './cardEditor.routes';

const servers: Array<ReturnType<typeof createServer>> = [];

beforeEach(() => {
  requestPythonRailsJson.mockReset();
  getProjectCard.mockReset();
  getProjectCard.mockResolvedValue({ ownerUserId: 'user-1' });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

async function start() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId?: string }).userId = 'user-1';
    next();
  });
  app.use('/cards', cardEditorRoutes);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
  return `http://127.0.0.1:${address.port}/cards/run`;
}

describe('read-only Card Run projection', () => {
  it('projects saved Run history without owning execution', async () => {
    requestPythonRailsJson.mockResolvedValueOnce({
      ok: true,
      runs: [{
        runId: 'run-1', state: 'completed', acceptedAt: '2026-10-08T00:00:00.000Z',
        startedAt: '2026-10-08T00:00:01.000Z', finishedAt: '2026-10-08T00:00:03.000Z',
        model: 'gpt-5.6-sol', inputTokens: 10, outputTokens: 5, cachedTokens: null,
        reasoningTokens: 2, costUsd: 0.25, toolCallCount: 3,
      }],
    });
    const response = await fetch(await start(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'history', projectId: 'p', deckId: 'd', cardId: 'c', limit: 1 }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toEqual({
      cardId: 'c',
      latest: {
        state: 'completed', acceptedAt: '2026-10-08T00:00:00.000Z', model: 'gpt-5.6-sol',
        elapsedMs: 2_000, totalTokens: 17, costUsd: 0.25, costStatus: 'estimated',
        toolCallCount: 3,
      },
    });
    expect(requestPythonRailsJson).toHaveBeenCalledTimes(1);
    expect(requestPythonRailsJson.mock.calls[0][0]).toBe('/domain/runs/history');
  });

  it('reads Magnetic task state from the existing Hermes ledger adapter', async () => {
    requestPythonRailsJson
      .mockResolvedValueOnce({
        ok: true,
        runs: [{
          runId: 'run-mag', runtimeMode: 'magentic_one', hermesRootId: 't_root', state: 'running',
        }],
      })
      .mockResolvedValueOnce({
        ok: true, hermesRootId: 't_root', state: 'running', hermesStatus: 'running', hermesTasks: [],
      });
    const response = await fetch(await start(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'status', inspectOnly: true, projectId: 'p', deckId: 'd', cardId: 'card_magentic',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({
      cardId: 'card_magentic', runId: 'run-mag', hermesRootId: 't_root', state: 'running',
    });
    expect(requestPythonRailsJson.mock.calls.map((call) => call[0])).toEqual([
      '/domain/runs/history', '/magentic/execution/status',
    ]);
  });

  it('rejects execution ownership and non-inspection status calls', async () => {
    const endpoint = await start();
    for (const body of [
      { action: 'execute', projectId: 'p', deckId: 'd', cardId: 'c' },
      { action: 'status', projectId: 'p', deckId: 'd', cardId: 'c' },
    ]) {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(requestPythonRailsJson).not.toHaveBeenCalled();
  });
});
