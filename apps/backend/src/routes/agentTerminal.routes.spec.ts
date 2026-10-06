import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    if (!['delegate', 'magentic_one'].includes((card.runtime as { mode?: string }).mode || '')) {
      throw new Error('agent_terminal_runtime_mode_unsupported');
    }
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
  }, attachTui: boolean) => selected.id === 'builder'
    ? { workingDirectory: 'repo-workspace', attachTui }
    : { attachTui },
}));

import { createAgentTerminalRouter } from './agentTerminal.routes';

const card = {
  id: 'builder', runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
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
      state: vi.fn(), subscribe: vi.fn(), verifyConfiguration: vi.fn(),
      interrupt: vi.fn(),
      resize: vi.fn().mockReturnValue({ sessionId: 'terminal-1', cols: 120, rows: 30 }),
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

it('keeps the owned terminal boundary free of retired product terminology', () => {
  const ownedPaths = [
    'apps/backend/src/hermes/agentTerminal.ts',
    'apps/backend/src/hermes/runtime/cardTurn.ts',
    'apps/backend/src/routes/agentTerminal.routes.ts',
    'apps/backend/src/hermes/agentTerminal.spec.ts',
    'apps/backend/src/hermes/runtime/cardTurn.spec.ts',
    'apps/backend/src/hermes/agentTerminalLaunch.spec.ts',
    'apps/backend/src/routes/agentTerminal.routes.spec.ts',
    'client/src/features/agentbuilder/console/AgentTerminalPanel.tsx',
    'client/src/features/agentbuilder/console/agentTerminalClient.ts',
    'client/src/features/agentbuilder/console/HarnessChatPanel.tsx',
    'client/src/features/agentbuilder/console/AgentTerminalPanel.spec.tsx',
    'client/src/features/agentbuilder/console/agentTerminalClient.spec.ts',
    'client/src/features/agentbuilder/console/HarnessChatPanel.spec.tsx',
  ];
  const prohibited = [
    ['na', 'tive'].join(''),
    ['liquid', 'aity'].join(''),
  ];
  for (const file of ownedPaths) {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const token of prohibited) expect(source.toLowerCase()).not.toContain(token);
  }
});

describe('saved Card terminal routes', () => {
  it('requires an existing session before any project, deck, or PTY access', async () => {
    const deps = dependencies();
    const response = await request(deps, '/project-1/deck_builder/builder/open', {
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
    const response = await request(deps, '/foreign/deck_builder/builder/open', json({ cols: 120, rows: 30 }));
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
    const response = await request(deps, '/project-1/deck_builder/builder/open', json({
      cols: 120, rows: 30, cardId: 'untrusted-card', projectId: 'foreign', deckId: 'other', userId: 'other-user',
    }));
    expect(response.status).toBe(200);
    expect(deps.getUser).toHaveBeenCalledWith('owner-session');
    expect(deps.getProject).toHaveBeenCalledWith('project-1');
    expect(deps.getDeck).toHaveBeenCalledWith('project-1', 'deck_builder');
    expect(deps.manager.open).toHaveBeenCalledWith(
      { userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder' },
      card, deck, 120, 30, { workingDirectory: 'repo-workspace', attachTui: true },
    );
  });

  it('uses the server-loaded project owner after authenticating the browser session', async () => {
    const deps = dependencies();
    deps.getUser.mockResolvedValue({ id: 'foreign-user' });
    const response = await request(
      deps,
      '/project-1/deck_builder/builder/open',
      json({ cols: 120, rows: 30 }),
    );
    expect(response.status).toBe(200);
    expect(deps.getProject).toHaveBeenCalledWith('project-1');
    expect(deps.manager.open).toHaveBeenCalledWith(
      { userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder' },
      card, deck, 120, 30, { workingDirectory: 'repo-workspace', attachTui: true },
    );
  });

  it('opens the exact saved Builder Card and profile', async () => {
    const deps = dependencies();
    const cardId = 'builder';
    const selected = { ...card, templateId: 'template_assist' };
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
      { workingDirectory: 'repo-workspace', attachTui: true },
    );
  });

  it('preserves an ordinary saved Card terminal', async () => {
    const deps = dependencies();
    const selected = {
      ...card,
      id: 'card_signal',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'signal' },
    };
    const selectedDeck = { ...deck, nodes: [selected] };
    deps.getDeck.mockResolvedValue({ deck: selectedDeck });
    const response = await request(
      deps,
      '/project-1/deck_builder/card_signal/open',
      json({ cols: 120, rows: 30 }),
    );
    expect(response.status).toBe(200);
    expect(deps.manager.open).toHaveBeenCalledWith(
      { userId: 'owner-1', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_signal' },
      selected,
      selectedDeck,
      120,
      30,
      { attachTui: true },
    );
  });

  it.each(['single', 'unsupported'])('rejects unsupported runtime mode %s before manager dispatch', async (mode) => {
    const deps = dependencies();
    const selected = { ...card, runtime: { ...card.runtime, mode } };
    deps.getDeck.mockResolvedValue({ deck: { ...deck, nodes: [selected] } });
    const response = await request(
      deps,
      '/project-1/deck_builder/builder/open',
      json({ cols: 120, rows: 30 }),
    );
    expect(response).toEqual({
      status: 400,
      body: { error: 'agent_terminal_runtime_mode_unsupported' },
    });
    expect(deps.manager.open).not.toHaveBeenCalled();
  });

  it.each([{ cols: 1, rows: 30 }, { cols: 501, rows: 30 }, { cols: 120, rows: 0 }])(
    'rejects out-of-bounds resize payload %#', async (body) => {
      const deps = dependencies();
      const response = await request(deps, '/project-1/deck_builder/builder/terminal-1/resize', json(body));
      expect(response).toEqual({ status: 400, body: { error: 'agent_terminal_dimensions_invalid' } });
      expect(deps.manager.resize).not.toHaveBeenCalled();
    },
  );

  it('returns an unexpected dependency failure without rewriting it', async () => {
    const deps = dependencies();
    deps.getDeck.mockRejectedValue(new Error('deck_backend_unavailable'));
    const response = await request(deps, '/project-1/deck_builder/builder/open', json({ cols: 120, rows: 30 }));
    expect(response).toEqual({ status: 400, body: { error: 'deck_backend_unavailable' } });
    expect(deps.manager.open).not.toHaveBeenCalled();
  });

  it('ends an exited hermes session stream instead of holding server shutdown open', async () => {
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
      const response = await fetch(`http://127.0.0.1:${port}/agent-terminals/project-1/deck_builder/builder/terminal-1/events`, {
        headers: { Cookie: 'sid=owner-session' }, signal: AbortSignal.timeout(2000),
      });
      expect(await response.text()).toContain('"status":"exited"');
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
