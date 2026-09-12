import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserBySessionId: vi.fn(),
  getProjectCard: vi.fn(),
  getDeckDocument: vi.fn(),
  requireAgentTerminalCard: vi.fn((card: { id: string; runtime: { kind: string; profile: string } }) => {
    if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
    if (card.id === 'card_main_chat' || card.id === 'builder') {
      throw new Error('agent_terminal_card_excluded');
    }
    return card.runtime.profile;
  }),
}));

vi.mock('../auth/sessionStore', () => ({ getUserBySessionId: mocks.getUserBySessionId }));
vi.mock('../services/agentBuilderStore', () => ({ getProjectCard: mocks.getProjectCard }));
vi.mock('../decks/store', () => ({ getDeckDocument: mocks.getDeckDocument }));
vi.mock('../hermes/agentTerminal', () => ({
  agentTerminalManager: {}, requireAgentTerminalCard: mocks.requireAgentTerminalCard,
}));

import { createAgentTerminalRouter } from './agentTerminal.routes';

const card = {
  id: 'card_hermes_steward', runtime: { kind: 'hermes', mode: 'delegate', profile: 'research' },
  runtimeOptions: {}, tools: [], prompt: 'Saved prompt',
};
const deck = { id: 'deck_builder', workspaceRoot: process.cwd(), nodes: [card] };

function dependencies() {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'owner-1' }),
    getProject: vi.fn().mockResolvedValue({ id: 'project-1' }),
    getDeck: vi.fn().mockResolvedValue({ deck }),
    execution: { begin: vi.fn().mockResolvedValue({ runId: 'persisted-run' }), finish: vi.fn(), host: vi.fn() },
    manager: {
      authorizeNative: vi.fn().mockReturnValue({ userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId: card.id }),
      open: vi.fn().mockReturnValue({ sessionId: 'terminal-1', status: 'running' }),
      state: vi.fn(), subscribe: vi.fn(), verifyConfiguration: vi.fn(), input: vi.fn(),
      resize: vi.fn().mockReturnValue({ sessionId: 'terminal-1', cols: 120, rows: 30 }), stop: vi.fn(),
    },
  };
}

async function request(
  deps: ReturnType<typeof dependencies>, path: string, init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/agent-terminals', createAgentTerminalRouter(deps as any));
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/agent-terminals${path}`, init);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const json = (body: unknown, sid = 'owner-session'): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: `sid=${sid}` },
  body: JSON.stringify(body),
});

afterEach(() => vi.clearAllMocks());

describe('native Card terminal routes', () => {
  it('resolves native execution only from the process bearer and freshly verified Card', async () => {
    const deps = dependencies();
    const response = await request(deps, '/internal/terminal-1/begin', {
      ...json({ message: 'input', userId: 'foreign', cardId: 'builder' }),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer process-secret' },
    });
    expect(response.status).toBe(200);
    expect(deps.manager.authorizeNative).toHaveBeenCalledWith('terminal-1', 'Bearer process-secret');
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.getProject).toHaveBeenCalledWith('project-1', 'owner-1');
    expect(deps.manager.verifyConfiguration).toHaveBeenCalledWith(
      deps.manager.authorizeNative.mock.results[0].value, 'terminal-1', card, deck);
    expect(deps.execution.begin).toHaveBeenCalledWith(
      deps.manager.authorizeNative.mock.results[0].value, 'terminal-1', 'research', expect.any(Object));
  });

  it.each(['bearer', 'owner', 'configuration'])('denies native execution on %s mismatch before creating a Run', async (failure) => {
    const deps = dependencies();
    if (failure === 'bearer') deps.manager.authorizeNative.mockImplementation(() => { throw new Error('agent_terminal_native_unauthorized'); });
    if (failure === 'owner') deps.getProject.mockResolvedValue(null);
    if (failure === 'configuration') deps.manager.verifyConfiguration.mockImplementation(() => { throw new Error('agent_terminal_configuration_changed_stop_required'); });
    const response = await request(deps, '/internal/terminal-1/begin', json({ message: 'input' }));
    expect(response.status).toBe(400);
    expect(deps.execution.begin).not.toHaveBeenCalled();
  });

  it('requires an existing session before any project, deck, or PTY access', async () => {
    const deps = dependencies();
    const response = await request(deps, '/project-1/deck_builder/card_hermes_steward/open', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cols: 120, rows: 30 }),
    });
    expect(response).toEqual({ status: 401, body: { error: 'agent_terminal_existing_session_required' } });
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.getProject).not.toHaveBeenCalled();
    expect(deps.getDeck).not.toHaveBeenCalled();
    expect(deps.manager.open).not.toHaveBeenCalled();
  });

  it('denies a foreign project before loading its deck or opening a terminal', async () => {
    const deps = dependencies();
    deps.getProject.mockResolvedValue(null);
    const response = await request(deps, '/foreign/deck_builder/card_hermes_steward/open', json({ cols: 120, rows: 30 }));
    expect(response).toEqual({
      status: 403,
      body: { error: 'agent_terminal_project_access_denied: local account owner-1' },
    });
    const error = (response.body as { error: string }).error;
    expect(error).not.toContain('cmnz01p7x0000stwoniku9fh3');
    expect(error).not.toContain('owner-session');
    expect(error).not.toMatch(/token|secret|credential|password/i);
    expect(deps.getProject).toHaveBeenCalledWith('foreign', 'owner-1');
    expect(deps.getDeck).not.toHaveBeenCalled();
    expect(deps.manager.open).not.toHaveBeenCalled();
  });

  it('uses the exact URL Card and ignores body-supplied identity', async () => {
    const deps = dependencies();
    const response = await request(deps, '/project-1/deck_builder/card_hermes_steward/open', json({
      cols: 120, rows: 30, cardId: 'builder', projectId: 'foreign', deckId: 'other', userId: 'other-user',
    }));
    expect(response.status).toBe(200);
    expect(deps.getDeck).toHaveBeenCalledWith('project-1', 'deck_builder');
    expect(deps.manager.open).toHaveBeenCalledWith(
      { userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_hermes_steward' },
      card, deck, 120, 30,
    );
  });

  it.each(['card_main_chat', 'builder'])('rejects the excluded %s Card', async (cardId) => {
    const deps = dependencies();
    deps.getDeck.mockResolvedValue({ deck: { ...deck, nodes: [{ ...card, id: cardId }] } });
    const response = await request(deps, `/project-1/deck_builder/${cardId}/open`, json({ cols: 120, rows: 30 }));
    expect(response).toEqual({ status: 400, body: { error: 'agent_terminal_card_excluded' } });
    expect(deps.manager.open).not.toHaveBeenCalled();
  });

  it.each([{ cols: 1, rows: 30 }, { cols: 501, rows: 30 }, { cols: 120, rows: 0 }])(
    'rejects out-of-bounds resize payload %#', async (body) => {
      const deps = dependencies();
      const response = await request(deps, '/project-1/deck_builder/card_hermes_steward/terminal-1/resize', json(body));
      expect(response).toEqual({ status: 400, body: { error: 'agent_terminal_dimensions_invalid' } });
      expect(deps.manager.resize).not.toHaveBeenCalled();
    },
  );

  it('returns an unexpected dependency failure without rewriting it', async () => {
    const deps = dependencies();
    deps.getDeck.mockRejectedValue(new Error('deck_backend_unavailable'));
    const response = await request(deps, '/project-1/deck_builder/card_hermes_steward/open', json({ cols: 120, rows: 30 }));
    expect(response).toEqual({ status: 400, body: { error: 'deck_backend_unavailable' } });
    expect(deps.manager.open).not.toHaveBeenCalled();
  });

  it('ends an exited native session stream instead of holding server shutdown open', async () => {
    const deps = dependencies();
    const unsubscribe = vi.fn();
    deps.manager.subscribe.mockImplementation((_owner, _id, _after, listener) => {
      listener('state', { sessionId: 'terminal-1', status: 'exited', exitCode: 0 });
      return unsubscribe;
    });
    const app = express();
    app.use(cookieParser());
    app.use('/agent-terminals', createAgentTerminalRouter(deps as any));
    const server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/agent-terminals/project-1/deck_builder/card_hermes_steward/terminal-1/events`, {
        headers: { Cookie: 'sid=owner-session' }, signal: AbortSignal.timeout(2000),
      });
      expect(await response.text()).toContain('"status":"exited"');
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
