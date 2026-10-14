import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express, { type Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnedProjectByReference: vi.fn(),
  hermesGateway: vi.fn(),
  sharedChatAuthority: vi.fn(),
}));

vi.mock('../services/projectStore', () => ({
  getOwnedProjectByReference: mocks.getOwnedProjectByReference,
}));
vi.mock('../services/hermesGateway', () => ({
  hermesGateway: mocks.hermesGateway,
}));
vi.mock('../services/savedCardAuthority', () => ({
  sharedChatAuthority: mocks.sharedChatAuthority,
}));

import cardTerminalRoutes from './cardTerminal.routes';

const app = express()
  .use(express.json())
  .use((req, _res, next) => {
    (req as Request & { userId: string }).userId = 'owner-one';
    next();
  })
  .use('/card-terminals', cardTerminalRoutes);

let server: Server | null = null;
const originalToken = process.env.HERMES_DASHBOARD_SESSION_TOKEN;
const originalGatewayUrl = process.env.HERMES_GATEWAY_URL;

async function request(cardId: string): Promise<Response> {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return fetch(
    `http://127.0.0.1:${address.port}/card-terminals/project-one/deck_builder/${cardId}/open`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'main' }),
    },
  );
}

function card(id: string, mode: 'main' | 'delegate') {
  return {
    card: {
      id,
      runtime: { kind: 'hermes', mode, profile: id === 'builder' ? 'builder' : 'main' },
    },
    profile: id === 'builder' ? 'builder' : 'main',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HERMES_DASHBOARD_SESSION_TOKEN = 'a'.repeat(64);
  process.env.HERMES_GATEWAY_URL = 'ws://127.0.0.1:9119/api/ws';
  mocks.getOwnedProjectByReference.mockResolvedValue({ ownerUserId: 'owner-one' });
  mocks.hermesGateway.mockResolvedValue({ request: vi.fn() });
});

afterEach(async () => {
  if (server) {
    const active = server;
    server = null;
    await new Promise<void>((resolve, reject) => (
      active.close((error) => error ? reject(error) : resolve())
    ));
  }
  if (originalToken === undefined) delete process.env.HERMES_DASHBOARD_SESSION_TOKEN;
  else process.env.HERMES_DASHBOARD_SESSION_TOKEN = originalToken;
  if (originalGatewayUrl === undefined) delete process.env.HERMES_GATEWAY_URL;
  else process.env.HERMES_GATEWAY_URL = originalGatewayUrl;
});

describe('Card terminal boundary', () => {
  it('keeps Main headless and never opens a PTY for the Bot Mode front door', async () => {
    mocks.sharedChatAuthority.mockResolvedValue({ cards: [card('card_main_chat', 'main')] });

    const response = await request('card_main_chat');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'terminal_main_headless' });
    expect(mocks.hermesGateway).not.toHaveBeenCalled();
  });
});
