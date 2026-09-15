import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserBySessionId: vi.fn(),
  getProjectCard: vi.fn(),
  getDeckDocument: vi.fn(),
  requireAgentTerminalCard: vi.fn((card: { id: string; runtime: { kind: string; profile: string } }) => {
    if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
    if (!card.runtime.profile) throw new Error('agent_terminal_profile_missing');
    return card.runtime.profile;
  }),
}));

vi.mock('../auth/sessionStore', () => ({ getUserBySessionId: mocks.getUserBySessionId }));
vi.mock('../services/agentBuilderStore', () => ({ getProjectCard: mocks.getProjectCard }));
vi.mock('../decks/store', () => ({ getDeckDocument: mocks.getDeckDocument }));
vi.mock('../hermes/agentTerminal', () => ({
  agentTerminalManager: {},
  requireAgentTerminalCard: mocks.requireAgentTerminalCard,
  agentTerminalPresentationOptions: (selected: {
    id: string;
    runtime: { mode: string };
  }, attachTui: boolean) => (
    selected.runtime.mode === 'main'
      ? { workingDirectory: 'neutral-workspace', attachTui: false }
      : selected.id === 'builder'
        ? { workingDirectory: 'repo-workspace', attachTui }
        : { attachTui }
  ),
}));

import { createAgentTerminalRouter } from './agentTerminal.routes';

const card = {
  id: 'card_signal_analyst', runtime: { kind: 'hermes', mode: 'delegate', profile: 'signal-analyst' },
  runtimeOptions: {}, tools: [], prompt: 'Saved prompt',
};
const deck = { id: 'deck_builder', workspaceRoot: process.cwd(), nodes: [card] };

function dependencies() {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'current-local-user' }),
    getProject: vi.fn().mockResolvedValue({ id: 'project-1', ownerUserId: 'owner-1' }),
    getDeck: vi.fn().mockResolvedValue({ deck }),
    manager: {
      open: vi.fn().mockResolvedValue({ sessionId: 'terminal-1', status: 'running' }),
      state: vi.fn(), subscribe: vi.fn(), verifyConfiguration: vi.fn(), input: vi.fn(),
      interrupt: vi.fn(),
      resize: vi.fn().mockReturnValue({ sessionId: 'terminal-1', cols: 120, rows: 30 }),
      detachTui: vi.fn().mockReturnValue({ sessionId: 'terminal-1', status: 'running', ptyId: null }),
    },
  };
}

async function request(
  deps: ReturnType<typeof dependencies>, path: string, init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(cookieParser() as unknown as RequestHandler);
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
  it('requires an existing session before any project, deck, or PTY access', async () => {
    const deps = dependencies();
    const response = await request(deps, '/project-1/deck_builder/card_signal_analyst/open', {
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
    const response = await request(deps, '/foreign/deck_builder/card_signal_analyst/open', json({ cols: 120, rows: 30 }));
    expect(response).toEqual({
      status: 403,
      body: { error: 'agent_terminal_project_access_denied' },
    });
    const error = (response.body as { error: string }).error;
    expect(error).not.toContain('cmnz01p7x0000stwoniku9fh3');
    expect(error).not.toContain('owner-session');
    expect(error).not.toMatch(/token|secret|credential|password/i);
    expect(deps.getProject).toHaveBeenCalledWith('foreign');
    expect(deps.getDeck).not.toHaveBeenCalled();
    expect(deps.manager.open).not.toHaveBeenCalled();
  });

  it('uses the exact URL Card and ignores body-supplied identity', async () => {
    const deps = dependencies();
    const response = await request(deps, '/project-1/deck_builder/card_signal_analyst/open', json({
      cols: 120, rows: 30, cardId: 'builder', projectId: 'foreign', deckId: 'other', userId: 'other-user',
    }));
    expect(response.status).toBe(200);
    expect(deps.getUser).toHaveBeenCalledWith('owner-session');
    expect(deps.getProject).toHaveBeenCalledWith('project-1');
    expect(deps.getDeck).toHaveBeenCalledWith('project-1', 'deck_builder');
    expect(deps.manager.open).toHaveBeenCalledWith(
      { userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_signal_analyst' },
      card, deck, 120, 30, { attachTui: true },
    );
  });

  it('uses the server-loaded project owner after authenticating the browser session', async () => {
    const deps = dependencies();
    deps.getUser.mockResolvedValue({ id: 'foreign-user' });
    const response = await request(
      deps,
      '/project-1/deck_builder/card_signal_analyst/open',
      json({ cols: 120, rows: 30 }),
    );
    expect(response.status).toBe(200);
    expect(deps.getProject).toHaveBeenCalledWith('project-1');
    expect(deps.manager.open).toHaveBeenCalledWith(
      { userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_signal_analyst' },
      card, deck, 120, 30, { attachTui: true },
    );
  });

  it.each([
    {
      cardId: 'card_main_chat',
      selected: { ...card, id: 'card_main_chat', runtime: { kind: 'hermes', mode: 'main', profile: 'main' } },
      options: { workingDirectory: 'neutral-workspace', attachTui: false },
    },
    {
      cardId: 'builder',
      selected: { ...card, id: 'builder', templateId: 'template_assist' },
      options: { workingDirectory: 'repo-workspace', attachTui: true },
    },
  ])('accepts $cardId through the common Card runtime with its structural presentation', async ({ cardId, selected, options }) => {
    const deps = dependencies();
    const selectedDeck = { ...deck, nodes: [selected] };
    deps.getDeck.mockResolvedValue({ deck: selectedDeck });
    const response = await request(deps, `/project-1/deck_builder/${cardId}/open`, json({ cols: 120, rows: 30 }));
    expect(response.status).toBe(200);
    expect(deps.manager.open).toHaveBeenCalledWith(
      { userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId },
      selected,
      selectedDeck,
      120,
      30,
      options,
    );
  });

  it.each([{ cols: 1, rows: 30 }, { cols: 501, rows: 30 }, { cols: 120, rows: 0 }])(
    'rejects out-of-bounds resize payload %#', async (body) => {
      const deps = dependencies();
      const response = await request(deps, '/project-1/deck_builder/card_signal_analyst/terminal-1/resize', json(body));
      expect(response).toEqual({ status: 400, body: { error: 'agent_terminal_dimensions_invalid' } });
      expect(deps.manager.resize).not.toHaveBeenCalled();
    },
  );

  it('returns an unexpected dependency failure without rewriting it', async () => {
    const deps = dependencies();
    deps.getDeck.mockRejectedValue(new Error('deck_backend_unavailable'));
    const response = await request(deps, '/project-1/deck_builder/card_signal_analyst/open', json({ cols: 120, rows: 30 }));
    expect(response).toEqual({ status: 400, body: { error: 'deck_backend_unavailable' } });
    expect(deps.manager.open).not.toHaveBeenCalled();
  });

  it('detaches the visible TUI without stopping the Card-owned Gateway runtime', async () => {
    const deps = dependencies();
    const response = await request(
      deps,
      '/project-1/deck_builder/card_signal_analyst/terminal-1/stop',
      json({}),
    );
    expect(response).toEqual({
      status: 200,
      body: { sessionId: 'terminal-1', status: 'running', ptyId: null },
    });
    expect(deps.manager.detachTui).toHaveBeenCalledWith(
      { userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_signal_analyst' },
      'terminal-1',
    );
  });

  it('ends an exited native session stream instead of holding server shutdown open', async () => {
    const deps = dependencies();
    const unsubscribe = vi.fn();
    deps.manager.subscribe.mockImplementation((_owner, _id, _after, listener) => {
      listener('state', { sessionId: 'terminal-1', status: 'exited', exitCode: 0 });
      return unsubscribe;
    });
    const app = express();
    app.use(cookieParser() as unknown as RequestHandler);
    app.use('/agent-terminals', createAgentTerminalRouter(deps as any));
    const server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/agent-terminals/project-1/deck_builder/card_signal_analyst/terminal-1/events`, {
        headers: { Cookie: 'sid=owner-session' }, signal: AbortSignal.timeout(2000),
      });
      expect(await response.text()).toContain('"status":"exited"');
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
