import express from 'express';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestPythonRailsJson, getOwnedProjectByReference } = vi.hoisted(() => ({
  requestPythonRailsJson: vi.fn(),
  getOwnedProjectByReference: vi.fn(),
}));

vi.mock('../services/pythonRailsClient', () => ({ requestPythonRailsJson }));
vi.mock('../services/projectStore', () => ({ getOwnedProjectByReference }));

import cardRunReadRoutes from './cardRunRead.routes';

const servers: Array<ReturnType<typeof createServer>> = [];

beforeEach(() => {
  requestPythonRailsJson.mockReset();
  getOwnedProjectByReference.mockReset();
  getOwnedProjectByReference.mockResolvedValue({ ownerUserId: 'user-1' });
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
  app.use('/cards', cardRunReadRoutes);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
  return `http://127.0.0.1:${address.port}/cards/runs/read`;
}

describe('read-only Card Run projection', () => {
  it('projects exact native token parts and total from the started Run', async () => {
    requestPythonRailsJson.mockResolvedValueOnce({
      ok: true,
      runs: [{
        runId: 'run-1', state: 'completed', acceptedAt: '2026-10-08T00:00:00.000Z',
        startedAt: '2026-10-08T00:00:01.000Z', finishedAt: '2026-10-08T00:00:03.000Z',
        model: 'gpt-5.6-sol', inputTokens: 10, outputTokens: 5, cachedTokens: null,
        reasoningTokens: 2, providerTotalTokens: 17, costUsd: 0.25,
        costStatus: 'actual', toolCallCount: 3,
        autoToolsDecision: { status: 'selected', candidateCount: 4, selectedToolIds: ['a'] },
        autoModelDecision: { status: 'selected', selectedConfidencePercentage: 97 },
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
        state: 'completed', startedAt: '2026-10-08T00:00:01.000Z', model: 'gpt-5.6-sol',
        elapsedMs: 2_000, inputTokens: 10, outputTokens: 5, cachedTokens: null,
        reasoningTokens: 2, totalTokens: 17, costUsd: 0.25, costStatus: 'actual',
        toolCallCount: 3,
        autoToolsDecision: { status: 'selected', candidateCount: 4, selectedToolIds: ['a'] },
        autoModelDecision: { status: 'selected', selectedConfidencePercentage: 97 },
      },
    });
    expect(requestPythonRailsJson).toHaveBeenCalledTimes(1);
    expect(requestPythonRailsJson.mock.calls[0][0]).toBe('/domain/runs/history');
  });

  it('keeps incomplete usage and tool-call observations null', async () => {
    requestPythonRailsJson.mockResolvedValueOnce({
      ok: true,
      runs: [{
        runId: 'run-unknown', state: 'failed', inputTokens: 10,
        outputTokens: null, toolCallCount: null,
      }],
    });
    const response = await fetch(await start(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'history', projectId: 'p', deckId: 'd', cardId: 'c' }),
    });
    const body = await response.json();

    expect(body.result.latest.totalTokens).toBeNull();
    expect(body.result.latest.toolCallCount).toBeNull();
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
      activeWorkers: 0,
    });
    expect(requestPythonRailsJson.mock.calls.map((call) => call[0])).toEqual([
      '/domain/runs/history', '/magnetic/taskgraph/status',
    ]);
  });

  it('derives Magnetic active workers only from current non-root running tasks', async () => {
    requestPythonRailsJson
      .mockResolvedValueOnce({
        ok: true,
        runs: [{
          runId: 'run-mag', runtimeMode: 'magentic_one', hermesRootId: 't_root', state: 'running',
        }],
      })
      .mockResolvedValueOnce({
        ok: true,
        hermesRootId: 't_root',
        state: 'running',
        hermesStatus: 'todo',
        hermesTasks: [
          { taskId: 't_root', status: 'running' },
          { taskId: 'worker-running', status: 'running' },
          { taskId: 'worker-ready', status: 'ready' },
          { taskId: 'worker-done', status: 'done' },
        ],
      });
    const response = await fetch(await start(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'status', inspectOnly: true, projectId: 'p', deckId: 'd', cardId: 'card_magentic',
      }),
    });
    const body = await response.json();

    expect(body.result.activeWorkers).toBe(1);
    expect(requestPythonRailsJson.mock.calls.map((call) => call[0])).toEqual([
      '/domain/runs/history', '/magnetic/taskgraph/status',
    ]);
  });

  it('does not present a ready-but-unclaimed Magnetic root as running', async () => {
    requestPythonRailsJson
      .mockResolvedValueOnce({
        ok: true,
        runs: [{
          runId: 'run-mag', runtimeMode: 'magentic_one', hermesRootId: 't_root', state: 'pending',
        }],
      })
      .mockResolvedValueOnce({
        ok: true,
        hermesRootId: 't_root',
        state: 'pending',
        hermesStatus: 'ready',
        hermesTasks: [{ taskId: 't_root', status: 'ready' }],
      });

    const response = await fetch(await start(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'status', inspectOnly: true, projectId: 'p', deckId: 'd', cardId: 'card_magentic',
      }),
    });
    const body = await response.json();

    expect(body.result).toMatchObject({ state: 'pending', activeWorkers: 0 });
  });

  it('projects terminal Hermes state without settling the outer Run from a read', async () => {
    requestPythonRailsJson
      .mockResolvedValueOnce({
        ok: true,
        runs: [{
          runId: 'run-mag', runtimeMode: 'magentic_one', hermesRootId: 't_root', state: 'pending',
        }],
      })
      .mockResolvedValueOnce({
        ok: true,
        hermesRootId: 't_root',
        hermesRunId: 'attempt-final',
        hermesStatus: 'done',
        state: 'completed',
        configuredProvider: 'openai-codex',
        configuredProviderApiMode: 'codex_app_server',
        configuredModel: 'gpt-5.6-sol',
        finalResult: 'Exact Hermes synthesis.',
        hermesTasks: [
          { taskId: 't_root', status: 'done' },
          { taskId: 'worker-done', status: 'done' },
        ],
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
      runId: 'run-mag', state: 'pending', hermesExecutionState: 'completed', activeWorkers: 0,
      finalResult: 'Exact Hermes synthesis.',
    });
    expect(requestPythonRailsJson.mock.calls.map((call) => call[0])).toEqual([
      '/domain/runs/history', '/magnetic/taskgraph/status',
    ]);
  });

  it('does not settle an already-terminal outer Magnetic Run again', async () => {
    requestPythonRailsJson
      .mockResolvedValueOnce({
        ok: true,
        runs: [{
          runId: 'run-mag', runtimeMode: 'magentic_one', hermesRootId: 't_root', state: 'completed',
        }],
      })
      .mockResolvedValueOnce({
        ok: true,
        hermesRootId: 't_root',
        hermesStatus: 'done',
        state: 'completed',
        finalResult: 'Exact Hermes synthesis.',
        hermesTasks: [{ taskId: 't_root', status: 'done' }],
      });

    const response = await fetch(await start(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'status', inspectOnly: true, projectId: 'p', deckId: 'd', cardId: 'card_magentic',
      }),
    });
    const body = await response.json();

    expect(body.result).toMatchObject({ state: 'completed', hermesExecutionState: 'completed' });
    expect(requestPythonRailsJson.mock.calls.map((call) => call[0])).toEqual([
      '/domain/runs/history', '/magnetic/taskgraph/status',
    ]);
  });

  it('keeps ordinary active-worker state unknown when no Hermes count was observed', async () => {
    requestPythonRailsJson.mockResolvedValueOnce({
      ok: true,
      runs: [{ runId: 'run-1', runtimeMode: 'delegate', state: 'running' }],
    });
    const response = await fetch(await start(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'status', inspectOnly: true, projectId: 'p', deckId: 'd', cardId: 'card-one',
      }),
    });
    const body = await response.json();

    expect(body.result).toMatchObject({
      cardId: 'card-one', runId: 'run-1', state: 'running', activeWorkers: null,
    });
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
