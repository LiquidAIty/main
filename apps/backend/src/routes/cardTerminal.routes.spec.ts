// Entity: Card Terminals
// Relationship: This file verifies terminal preflight and WebSocket upgrades preserve exact Card identity, normalize close frames, and refuse Main or Magnetic Cards.
// Entity: Hermes Card Sessions
// Relationship: This file verifies the terminal binds to the exact returned Hermes profile and session before exposing its same-origin stream path.
// Entity: Credentials
// Relationship: This file verifies unauthenticated upgrades are refused and reusable Gateway credentials or upstream ports never enter the browser response.

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import type { DeckCard, DeckDocument } from '../types';

const mocks = vi.hoisted(() => ({
  cardProjectSession: vi.fn(),
  getOwnedProjectByReference: vi.fn(),
  getUserBySessionId: vi.fn(),
  hermesGateway: vi.fn(),
  projectCardAuthority: vi.fn(),
}));

vi.mock('../auth/sessionStore', () => ({
  getUserBySessionId: mocks.getUserBySessionId,
}));
vi.mock('../services/projectStore', () => ({
  getOwnedProjectByReference: mocks.getOwnedProjectByReference,
}));
vi.mock('../services/projectCardAuthority', () => ({
  projectCardAuthority: mocks.projectCardAuthority,
}));
vi.mock('../services/hermesGateway', () => ({
  hermesGateway: mocks.hermesGateway,
}));
vi.mock('../hermes/botMode', () => ({
  cardProjectSession: mocks.cardProjectSession,
}));
vi.mock('../services/workingDirectories', () => ({
  resolveBuilderProjectCodeDirectory: vi.fn(() => 'C:/Projects/LiquidAIty/main'),
  resolveProductChatWorkingDirectory: vi.fn(() => 'C:/Projects/LiquidAIty/main'),
}));

import router, {
  installCardTerminalUpgrade,
  terminalCloseFrame,
} from './cardTerminal.routes';

const servers: Server[] = [];

function card(mode: 'main' | 'delegate' | 'magentic_one'): DeckCard {
  return {
    id: mode === 'delegate' ? 'builder' : `card-${mode}`,
    templateId: 'template-test',
    title: mode,
    runtime: { kind: 'hermes', mode, profile: mode === 'delegate' ? 'builder' : mode },
    position: { x: 0, y: 0 },
  };
}

function authority(target: DeckCard) {
  const deck: DeckDocument = {
    id: 'deck_builder',
    name: 'Deck',
    version: 1,
    promptTemplates: [],
    nodes: [target],
    edges: [],
  };
  const binding = {
    card: target,
    cardRevisionId: 'revision-one',
    profile: target.runtime.profile,
    title: target.title,
    address: target.title,
  };
  return { deck, cards: [binding], main: binding };
}

async function serve(target = card('delegate')): Promise<string> {
  mocks.projectCardAuthority.mockResolvedValue(authority(target));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId: string }).userId = 'owner-one';
    next();
  });
  app.use('/api/card-terminals', router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  installCardTerminalUpgrade(server);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe('Card terminal authenticated proxy contract', () => {
  beforeEach(() => {
    vi.stubEnv('HERMES_DASHBOARD_SESSION_TOKEN', 'a'.repeat(64));
    vi.stubEnv('HERMES_GATEWAY_URL', 'ws://127.0.0.1:9119/api/ws');
    mocks.getOwnedProjectByReference.mockResolvedValue({
      id: 'project-one',
      ownerUserId: 'owner-one',
    });
    mocks.hermesGateway.mockResolvedValue({});
    mocks.cardProjectSession.mockResolvedValue({
      sessionId: 'session-builder',
    });
    mocks.getUserBySessionId.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve());
    })));
  });

  it('returns exact identity and same-origin path without a reusable Hermes credential', async () => {
    const baseUrl = await serve();
    const response = await fetch(
      `${baseUrl}/api/card-terminals/project-one/deck_builder/builder/open`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      projectId: 'project-one',
      deckId: 'deck_builder',
      cardId: 'builder',
      profile: 'builder',
      sessionId: 'session-builder',
      cols: 100,
      rows: 30,
      websocketPath: '/api/card-terminals/project-one/deck_builder/builder/stream',
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('a'.repeat(64));
    expect(serialized).not.toContain('9119');
    expect(serialized).not.toContain('terminalChannelKey');
    expect(serialized).not.toContain('websocketUrl');
  });

  it('normalizes reserved or oversized upstream close frames before forwarding them', () => {
    expect(terminalCloseFrame(1005, '')).toEqual({ code: 1000, reason: '' });
    expect(terminalCloseFrame(1006, 'abnormal')).toEqual({
      code: 1011,
      reason: 'abnormal',
    });
    expect(terminalCloseFrame(4321, 'x'.repeat(200))).toEqual({
      code: 4321,
      reason: 'x'.repeat(123),
    });
  });

  it.each([
    ['main', 'terminal_main_headless'],
    ['magentic_one', 'terminal_card_unavailable'],
  ] as const)('refuses a %s Card terminal', async (mode, error) => {
    const baseUrl = await serve(card(mode));
    const cardId = mode === 'main' ? 'card-main' : 'card-magentic_one';
    const response = await fetch(
      `${baseUrl}/api/card-terminals/project-one/deck_builder/${cardId}/open`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error });
  });

  it('refuses a WebSocket upgrade with no authenticated application session', async () => {
    const baseUrl = await serve();
    const target = baseUrl.replace('http:', 'ws:')
      + '/api/card-terminals/project-one/deck_builder/builder/stream';
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(target);
      socket.once('unexpected-response', (_request, response) => {
        resolve(response.statusCode || 0);
        response.destroy();
      });
      socket.once('error', (error) => {
        if ((error as Error).message.includes('Unexpected server response')) return;
        reject(error);
      });
    });

    expect(status).toBe(401);
    expect(mocks.projectCardAuthority).toHaveBeenCalledTimes(0);
  });
});
