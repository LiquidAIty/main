import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readCardRun: vi.fn(async () => ({ runId: 'req_parent', state: 'running' })),
  requestPythonRailsJson: vi.fn(async () => ({
    ok: true,
    runId: 'req_magnetic',
    hermesRootId: 'root-magnetic',
    state: 'running',
  })),
  projectCardAuthority: vi.fn(async () => {
    const main = {
      card: {
        id: 'card_main_chat', title: 'Main', enabled: true,
        runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      },
      cardRevisionId: 'revision-main', profile: 'main', title: 'Main', address: 'Main',
    };
    const magnetic = {
      card: {
        id: 'card_magentic', title: 'Magnetic', enabled: true,
        runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
      },
      cardRevisionId: 'revision-magnetic', profile: 'card_magentic',
      title: 'Magnetic', address: 'Magnetic',
    };
    return {
      deck: { id: 'deck_builder', nodes: [main.card, magnetic.card], edges: [] },
      cards: [main, magnetic],
      main,
    };
  }),
}));

vi.mock('../services/cardRunLifecycle', () => ({
  hermesProfileModelSelection: vi.fn(),
  finishCardRun: vi.fn(),
  hermesUsageFields: vi.fn(() => ({})),
  prepareCardRun: vi.fn(),
  readCardRun: mocks.readCardRun,
  startCardRun: vi.fn(),
}));
vi.mock('../hermes/profileMaterialization', () => ({
  hermesProfileModelSelection: vi.fn(),
}));
vi.mock('../services/mcp/internalMcpAuth', () => ({
  internalMcpProcessSecretAuthorized: vi.fn(() => true),
}));
vi.mock('../services/projectCardAuthority', () => ({
  projectCardAuthority: mocks.projectCardAuthority,
}));
vi.mock('../services/pythonRailsClient', () => ({
  requestPythonRailsJson: mocks.requestPythonRailsJson,
}));

import router from './cardTurnInternal.routes';

const servers: Server[] = [];

async function serve(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/api/card-turn', router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  vi.clearAllMocks();
});

describe('internal Magnetic Bot Mode handoff', () => {
  it('starts the existing Magnetic taskgraph for one exact Main message_agent delivery', async () => {
    const baseUrl = await serve();
    const response = await fetch(`${baseUrl}/api/card-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start_magnetic',
        projectId: 'project-one',
        deckId: 'deck_builder',
        conversationId: 'project-one',
        cardId: 'card_magentic',
        profile: 'card_magentic',
        senderProfile: 'main',
        originatingRunId: 'req_parent',
        runId: 'req_magnetic',
        message: 'One Builder-authored PromptSpec.',
        notification: {
          sessionId: 'main-session',
          notifyPlatform: 'api_server',
          notifyChatId: 'main-session',
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true, runId: 'req_magnetic', hermesRootId: 'root-magnetic',
    });
    expect(mocks.readCardRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'req_parent', cardId: 'card_main_chat', profile: 'main',
    }));
    expect(mocks.requestPythonRailsJson).toHaveBeenCalledWith(
      '/magnetic/taskgraph/start',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('One Builder-authored PromptSpec.'),
      }),
      { timeoutMs: 180_000 },
    );
  });

  it('does not allow the Magnetic runtime through the ordinary Card-turn actions', async () => {
    const baseUrl = await serve();
    const response = await fetch(`${baseUrl}/api/card-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'prepare',
        projectId: 'project-one', deckId: 'deck_builder', conversationId: 'project-one',
        cardId: 'card_magentic', profile: 'card_magentic', senderProfile: 'main',
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'card_turn_target_unavailable' });
    expect(mocks.requestPythonRailsJson).not.toHaveBeenCalled();
  });
});
