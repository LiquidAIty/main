import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHermesBotDmRouter } from './hermesBotDm.routes';

const source = {
  id: 'card_main_chat', kind: 'agent', templateId: 'main', title: 'Main', prompt: 'Main prompt',
  _cardRevisionId: 'revision-main',
  runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
  runtimeOptions: { delegationRole: 'profile' }, position: { x: 0, y: 0 },
};
const builder = {
  id: 'builder', kind: 'agent', templateId: 'builder', title: 'Builder', prompt: 'Builder prompt',
  _cardRevisionId: 'revision-builder',
  runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
  runtimeOptions: {}, position: { x: 1, y: 1 },
};
const flow = {
  id: 'main-builder', source: source.id, target: builder.id, edgeType: 'flow', enabled: true,
};

function savedDeck(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deck-1', name: 'Deck', version: 1, promptTemplates: [],
    nodes: [structuredClone(source), structuredClone(builder)], edges: [structuredClone(flow)],
    ...overrides,
  } as any;
}

function dependencies(deck = savedDeck()) {
  const sourceOwner = {
    userId: 'owner-1', projectId: 'project-1', deckId: 'deck-1', cardId: source.id,
  };
  const sourceState = {
    sessionId: 'source-session', cardId: source.id, profile: 'main', pid: 1, gatewayPid: 1,
    tuiPid: null, ptyId: null, nativeSessionId: 'source-native',
    storedSessionId: 'source-stored', hermesHome: 'source-home', status: 'running', cols: 120, rows: 36,
  };
  const receivingOwner = { ...sourceOwner, cardId: builder.id };
  const receivingState = {
    sessionId: 'receiving-session', cardId: builder.id, profile: 'builder', pid: 2, gatewayPid: 2,
    tuiPid: null, ptyId: null, nativeSessionId: 'receiving-native',
    storedSessionId: 'receiving-stored', hermesHome: 'receiving-home', status: 'running', cols: 120, rows: 36,
  };
  return {
    sourceOwner,
    sourceState,
    receivingOwner,
    receivingState,
    isLoopbackSocketRequest: vi.fn().mockReturnValue(true),
    getProjectCard: vi.fn().mockResolvedValue({
      id: 'project-1', ownerUserId: 'owner-1', name: 'Project', code: null,
    }),
    getDeckDocument: vi.fn().mockResolvedValue({ deck }),
    requestPythonRailsJson: vi.fn().mockResolvedValue({
      ok: true,
      projectId: sourceOwner.projectId,
      deckId: sourceOwner.deckId,
      sourceCardId: sourceOwner.cardId,
      card: {
        cardId: builder.id,
        title: builder.title,
        profile: builder.runtime.profile,
        description: '',
        cardRevisionId: builder._cardRevisionId,
      },
    }),
    requireAgentTerminalCard: vi.fn((card: any, currentDeck: any) => {
      if (card.runtime?.kind !== 'hermes' || !String(card.runtime.profile || '').trim()) {
        throw new Error('agent_terminal_profile_missing');
      }
      if (card.enabled === false || card.runtimeOptions?.enabled === false) {
        throw new Error('agent_terminal_card_disabled');
      }
      if (currentDeck.nodes.some((other: any) => other.id !== card.id
        && other.runtime?.kind === 'hermes'
        && other.runtime.profile.trim().toLowerCase() === card.runtime.profile.trim().toLowerCase())) {
        throw new Error('agent_terminal_profile_shared');
      }
      return card.runtime.profile.trim();
    }),
    agentTerminalManager: {
      authenticateBotDmRequest: vi.fn().mockResolvedValue({
        owner: sourceOwner,
        state: sourceState,
        request: {
          version: 1, expiresAt: Date.now() + 30_000, nonce: 'nonce-1',
          sourceStoredSessionId: 'source-stored',
          target: '@Builder', message: 'Please inspect this.',
        },
      }),
      findCard: vi.fn().mockReturnValue({ owner: receivingOwner, state: receivingState }),
      verifyConfiguration: vi.fn(),
      submitBotMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
}

async function request(deps: ReturnType<typeof dependencies>, body: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/hermes-bot-dm', createHermesBotDmRouter(deps as any));
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/hermes-bot-dm/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const envelope = { keyId: 'key-1', payload: 'signed-payload', signature: 'signed-value' };

afterEach(() => vi.clearAllMocks());

describe('managed Hermes Bot-DM host route', () => {
  it('rejects non-loopback sockets before authentication', async () => {
    const deps = dependencies();
    deps.isLoopbackSocketRequest.mockReturnValue(false);
    expect(await request(deps, envelope)).toEqual({
      status: 403, body: { error: 'hermes_bot_dm_loopback_required' },
    });
    expect(deps.agentTerminalManager.authenticateBotDmRequest).not.toHaveBeenCalled();
  });

  it('maps every authenticator rejection to one secret-free status', async () => {
    const deps = dependencies();
    deps.agentTerminalManager.authenticateBotDmRequest.mockRejectedValue(
      new Error('signature_invalid:do-not-leak-this-key'),
    );
    const response = await request(deps, envelope);
    expect(response).toEqual({
      status: 401, body: { error: 'hermes_bot_dm_authentication_failed' },
    });
    expect(JSON.stringify(response)).not.toContain('do-not-leak');
  });

  it('rejects an authenticated source whose saved owner cannot be loaded', async () => {
    const deps = dependencies();
    deps.getProjectCard.mockResolvedValue(null);
    expect(await request(deps, envelope)).toEqual({
      status: 403, body: { error: 'hermes_bot_dm_source_identity_invalid' },
    });
    expect(deps.getProjectCard).toHaveBeenCalledWith('project-1', 'owner-1');
    expect(deps.getDeckDocument).not.toHaveBeenCalled();
    expect(deps.agentTerminalManager.findCard).not.toHaveBeenCalled();
  });

  it('rejects a stale authenticated source session before resolving the target', async () => {
    const deps = dependencies();
    deps.agentTerminalManager.authenticateBotDmRequest.mockResolvedValue({
      owner: deps.sourceOwner,
      state: { ...deps.sourceState, status: 'exited' },
      request: {
        version: 1, expiresAt: Date.now() + 30_000, nonce: 'nonce-1',
        sourceStoredSessionId: 'source-stored',
        target: 'builder', message: 'Hello',
      },
    });
    expect(await request(deps, envelope)).toEqual({
      status: 409, body: { error: 'hermes_bot_dm_source_runtime_stale' },
    });
    expect(deps.agentTerminalManager.findCard).not.toHaveBeenCalled();
  });

  it('uses Python Card-domain authority and passes only server-derived Card identities', async () => {
    const deps = dependencies();
    await request(deps, envelope);
    expect(deps.requestPythonRailsJson).toHaveBeenCalledOnce();
    const [endpoint, init] = deps.requestPythonRailsJson.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe('/domain/hermes-bot-dm/authorize');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init.body))).toEqual({
      projectId: deps.sourceOwner.projectId,
      deckId: deps.sourceOwner.deckId,
      sourceCardId: deps.sourceOwner.cardId,
      targetProfile: '@Builder',
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('ownerUserId');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('targetCardId');
  });

  it('fails on Python authorization denial before consulting the runtime map', async () => {
    const deps = dependencies();
    deps.requestPythonRailsJson.mockRejectedValue(
      new Error('python_rails_http_403:hermes_bot_dm_card_not_authorized'),
    );
    expect(await request(deps, envelope)).toEqual({
      status: 403, body: { error: 'hermes_bot_dm_card_unauthorized' },
    });
    expect(deps.agentTerminalManager.findCard).not.toHaveBeenCalled();
  });

  it('leaves source delegation policy to Python Card-domain authority', async () => {
    const deck = savedDeck();
    deck.nodes[0].runtimeOptions.delegationRole = 'off';
    const deps = dependencies(deck);
    deps.requestPythonRailsJson.mockRejectedValue(
      new Error('python_rails_http_403:hermes_bot_dm_card_not_authorized'),
    );
    expect(await request(deps, envelope)).toEqual({
      status: 403, body: { error: 'hermes_bot_dm_card_unauthorized' },
    });
    expect(deps.requestPythonRailsJson).toHaveBeenCalledOnce();
    expect(deps.agentTerminalManager.findCard).not.toHaveBeenCalled();
  });

  it('fails closed when Python Card-domain authority is unavailable', async () => {
    const deps = dependencies();
    deps.requestPythonRailsJson.mockRejectedValue(new Error('PYTHON_AUTOGEN_RAILS_UNAVAILABLE'));
    expect(await request(deps, envelope)).toEqual({
      status: 503, body: { error: 'hermes_bot_dm_authority_unavailable' },
    });
    expect(deps.agentTerminalManager.findCard).not.toHaveBeenCalled();
  });

  it.each([
    ['python_rails_http_404:project_not_found', 409, 'hermes_bot_dm_source_runtime_stale'],
    ['python_rails_http_404:deck_not_found', 409, 'hermes_bot_dm_source_runtime_stale'],
    ['python_rails_http_400:target_profile_required', 403, 'hermes_bot_dm_card_unauthorized'],
    ['python_rails_http_400:deck_document_invalid', 502, 'hermes_bot_dm_authority_response_invalid'],
    ['python_rails_http_403:unexpected_authority_error', 502, 'hermes_bot_dm_authority_response_invalid'],
  ])('maps Python authority error %s exactly', async (message, status, error) => {
    const deps = dependencies();
    deps.requestPythonRailsJson.mockRejectedValue(new Error(message));
    expect(await request(deps, envelope)).toEqual({ status, body: { error } });
    expect(deps.agentTerminalManager.findCard).not.toHaveBeenCalled();
  });

  it('rejects a mismatched or malformed Python authority response', async () => {
    const deps = dependencies();
    deps.requestPythonRailsJson.mockResolvedValue({
      ok: true,
      projectId: deps.sourceOwner.projectId,
      deckId: deps.sourceOwner.deckId,
      sourceCardId: deps.sourceOwner.cardId,
      card: {
        cardId: builder.id,
        title: 42,
        profile: 'builder',
        description: '',
        cardRevisionId: 'revision-builder',
      },
    });
    expect(await request(deps, envelope)).toEqual({
      status: 502, body: { error: 'hermes_bot_dm_authority_response_invalid' },
    });
    expect(deps.agentTerminalManager.findCard).not.toHaveBeenCalled();
  });

  it('rejects a receiving Card changed after Python authorization', async () => {
    const deck = savedDeck();
    deck.nodes[1]._cardRevisionId = 'revision-builder-new';
    const deps = dependencies(deck);
    expect(await request(deps, envelope)).toEqual({
      status: 409, body: { error: 'hermes_bot_dm_card_runtime_stale' },
    });
    expect(deps.agentTerminalManager.findCard).not.toHaveBeenCalled();
  });

  it('fails closed when the exact receiving Card runtime is unavailable', async () => {
    const deps = dependencies();
    deps.agentTerminalManager.findCard.mockReturnValue(null);
    expect(await request(deps, envelope)).toEqual({
      status: 503, body: { error: 'hermes_bot_dm_card_runtime_unavailable' },
    });
  });

  it('rejects stale receiving Card identity and current-configuration drift', async () => {
    const deps = dependencies();
    deps.agentTerminalManager.findCard.mockReturnValue({
      owner: { ...deps.receivingOwner, userId: 'other-owner' }, state: deps.receivingState,
    });
    expect(await request(deps, envelope)).toEqual({
      status: 409, body: { error: 'hermes_bot_dm_card_runtime_stale' },
    });
  });

  it('stops after exact Card/runtime authorization when Hermes exposes no completion identity', async () => {
    const deps = dependencies();
    const sourceBefore = structuredClone(deps.sourceState);
    const receivingBefore = structuredClone(deps.receivingState);
    const response = await request(deps, envelope);
    expect(response).toEqual({
      status: 501,
      body: { error: 'hermes_bot_dm_native_completion_identity_unavailable' },
    });
    expect(deps.agentTerminalManager.authenticateBotDmRequest)
      .toHaveBeenCalledWith('key-1', 'signed-payload', 'signed-value');
    expect(deps.agentTerminalManager.verifyConfiguration).toHaveBeenNthCalledWith(
      1, deps.sourceOwner, 'source-session', expect.objectContaining({ id: source.id }), expect.any(Object),
    );
    expect(deps.agentTerminalManager.findCard).toHaveBeenCalledWith('project-1', 'deck-1', 'builder');
    expect(deps.agentTerminalManager.verifyConfiguration).toHaveBeenNthCalledWith(
      2, deps.receivingOwner, 'receiving-session', expect.objectContaining({ id: builder.id }), expect.any(Object),
    );
    expect(deps.agentTerminalManager.submitBotMessage).toHaveBeenCalledOnce();
    expect(deps.agentTerminalManager.submitBotMessage).toHaveBeenCalledWith(
      deps.receivingOwner,
      'receiving-session',
      'Message from 🤖 main (@main): Please inspect this.',
    );
    expect(deps.sourceState).toEqual(sourceBefore);
    expect(deps.receivingState).toEqual(receivingBefore);
  });

  it('rejects caller-supplied identity fields before authentication', async () => {
    const deps = dependencies();
    expect(await request(deps, { ...envelope, projectId: 'foreign', cardId: 'builder' })).toEqual({
      status: 400, body: { error: 'hermes_bot_dm_request_invalid' },
    });
    expect(deps.agentTerminalManager.authenticateBotDmRequest).not.toHaveBeenCalled();
    expect(deps.getProjectCard).not.toHaveBeenCalled();
  });
});
