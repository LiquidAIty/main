/**
 * Entity: Main Chat
 * Relationship: This file verifies Main cancellation reports the exact active state and persists no incomplete recipient output as conversation speech.
 * Entity: Bot Mode Delegation
 * Relationship: This file verifies an addressed Builder turn interrupts the exact recipient submission rather than Main or an unrelated Card.
 * Entity: Run Ledger
 * Relationship: This file verifies socket failure settles the outer Run as failed and explicit interruption settles it as cancelled without fabricated provider evidence.
 * Entity: Authentication
 * Relationship: This file verifies external Main entry requires the supervised internal seam, one verified identity grant, and the exact current saved Main binding.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';
import type { HermesGatewayClient, HermesGatewayEvent } from '../services/hermesGateway';
import type { ProjectCardAuthority, ProjectCardBinding } from '../services/projectCardAuthority';

type FinishCardRunPayload = Parameters<
  typeof import('../services/cardRunLifecycle').finishCardRun
>[0];

const conversationMocks = vi.hoisted(() => ({
  appendConversationReplyOnce: vi.fn(async () => undefined),
  appendConversationTurn: vi.fn(async () => undefined),
  getConversationMessages: vi.fn(async () => []),
}));

const lifecycleMocks = vi.hoisted(() => ({
  finishCardRun: vi.fn(async (_payload: FinishCardRunPayload) => undefined),
  prepareCardRun: vi.fn(async () => ({
    runId: 'run-one',
    request: {
      message: '@Builder investigate the exact issue',
      provider: {
        provider: 'openai',
        accessMode: 'chatgpt-account',
        providerModelId: 'gpt-5.6-sol',
      },
      runtime: { mode: 'main' },
      runtimeOptions: {},
      scriptPresentation: { mode: 'tools' },
      presentedTools: [],
      unavailableTools: [],
      images: [],
    },
  })),
  startCardRun: vi.fn(async () => undefined),
}));

const projectMocks = vi.hoisted(() => ({
  assertHermesProfileOwner: vi.fn(async () => undefined),
  getOwnedProjectByReference: vi.fn(async () => ({
    id: 'project-one',
    ownerUserId: 'user-one',
  })),
  projectCardAuthority: vi.fn(),
}));

const gatewayMocks = vi.hoisted(() => ({
  hermesGateway: vi.fn(),
}));

const externalEntryMocks = vi.hoisted(() => ({
  resolveExternalIdentityProjectGrant: vi.fn(async () => ({
    grantId: 'grant-one',
    userId: 'user-one',
    projectId: 'project-one',
    projectName: 'Project One',
  })),
  internalMcpProcessSecretAuthorized: vi.fn((value: unknown) => (
    value === 'internal-secret'
  )),
}));

vi.mock('../conversations/store', () => conversationMocks);
vi.mock('../services/projectStore', () => ({
  assertHermesProfileOwner: projectMocks.assertHermesProfileOwner,
  getOwnedProjectByReference: projectMocks.getOwnedProjectByReference,
}));
vi.mock('../services/projectCardAuthority', async () => {
  const actual = await vi.importActual<typeof import('../services/projectCardAuthority')>(
    '../services/projectCardAuthority',
  );
  return { ...actual, projectCardAuthority: projectMocks.projectCardAuthority };
});
vi.mock('../services/hermesGateway', () => ({
  hermesGateway: gatewayMocks.hermesGateway,
}));
vi.mock('../auth/externalIdentityGrantStore', () => ({
  resolveExternalIdentityProjectGrant: externalEntryMocks.resolveExternalIdentityProjectGrant,
}));
vi.mock('../services/mcp/internalMcpAuth', () => ({
  internalMcpProcessSecretAuthorized: externalEntryMocks.internalMcpProcessSecretAuthorized,
}));
vi.mock('../services/cardRunLifecycle', async () => {
  const actual = await vi.importActual<typeof import('../services/cardRunLifecycle')>(
    '../services/cardRunLifecycle',
  );
  return {
    ...actual,
    finishCardRun: lifecycleMocks.finishCardRun,
    prepareCardRun: lifecycleMocks.prepareCardRun,
    startCardRun: lifecycleMocks.startCardRun,
    internalCardTurnEndpoint: vi.fn(() => 'http://127.0.0.1:4000/api/card-turn'),
  };
});
vi.mock('../hermes/profileMaterialization', async () => {
  const actual = await vi.importActual<typeof import('../hermes/profileMaterialization')>(
    '../hermes/profileMaterialization',
  );
  const profile = async (_request: unknown, card: DeckCard) => ({
    name: card.runtime.profile,
    model: { provider: 'openai-codex', default: 'gpt-5.6-sol' },
  });
  return {
    ...actual,
    ensureSavedCardProfile: vi.fn(profile),
    materializeSavedCardProfile: vi.fn(profile),
  };
});
vi.mock('../services/mcp/toolCatalogMcpClient', () => ({
  readToolCatalog: vi.fn(async () => ({
    state: 'available', tools: [], unavailableFamilies: [], toolFailures: {},
  })),
}));
vi.mock('../services/workingDirectories', () => ({
  resolveBuilderProjectCodeDirectory: vi.fn(() => 'C:/Projects/LiquidAIty/main'),
  resolveProductChatWorkingDirectory: vi.fn(() => 'C:/Projects/LiquidAIty/main'),
}));

import router from './mainSession.routes';

const servers: Server[] = [];

function card(id: string, title: string, profile: string, mode: 'main' | 'delegate'): DeckCard {
  return {
    id,
    title,
    enabled: true,
    runtime: { kind: 'hermes', mode, profile },
    runtimeOptions: {},
  } as DeckCard;
}

function binding(value: DeckCard): ProjectCardBinding {
  return {
    card: value,
    cardRevisionId: `revision-${value.id}`,
    profile: value.runtime.profile,
    title: value.title,
    address: value.title,
  };
}

function authority(): ProjectCardAuthority {
  const main = card('card-main', 'Main', 'main', 'main');
  const builder = card('builder', 'Builder', 'builder', 'delegate');
  const deck = {
    id: 'deck_builder',
    name: 'Test deck',
    projectId: 'project-one',
    promptTemplates: [],
    nodes: [main, builder],
    edges: [{
      id: 'main-builder',
      source: main.id,
      target: builder.id,
      edgeType: 'flow',
      enabled: true,
    }],
    version: 1,
  } as DeckDocument;
  const cards = deck.nodes.map(binding);
  return { deck, cards, main: cards[0] };
}

function event(
  type: HermesGatewayEvent['type'],
  sessionId: string,
  payload: Record<string, unknown>,
): HermesGatewayEvent {
  return { type, session_id: sessionId, payload } as HermesGatewayEvent;
}

function gateway(recipientWaiting: () => void, disconnectAfterStart = false) {
  const listeners = new Set<(value: HermesGatewayEvent) => void>();
  const stateListeners = new Set<(value: string) => void>();
  const emit = (value: HermesGatewayEvent) => listeners.forEach(listener => listener(value));
  const emitState = (value: string) => stateListeners.forEach(listener => listener(value));
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const profile = String(params.profile || '');
    if (method === 'session.list') {
      return { sessions: [{ resolved_id: `stored-${profile}` }] };
    }
    if (method === 'session.resume' || method === 'session.activate') {
      return {
        session_id: `live-${profile}`,
        stored_session_id: `stored-${profile}`,
        messages_omitted: true,
        info: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      };
    }
    if (method === 'prompt.submit') {
      queueMicrotask(() => {
        emit(event('prompt.submission.started', 'live-main', { submission_id: 'run-one' }));
        if (disconnectAfterStart) {
          emitState('closed');
          return;
        }
        emit(event('tool.start', 'live-main', {
          submission_id: 'run-one',
          name: 'message_agent',
          tool_id: 'tool-one',
          args: { target: '@Builder' },
        }));
        emit(event('tool.complete', 'live-main', {
          submission_id: 'run-one',
          name: 'message_agent',
          tool_id: 'tool-one',
          result: {
            status: 'queued',
            delivery_id: 'delivery-one',
            process_id: 'process-one',
            reply_delivery: 'direct',
          },
        }));
        emit(event('prompt.submission.started', 'live-builder', {
          submission_id: '__bot_dm__delivery-one',
        }));
        emit(event('message.complete', 'live-main', {
          submission_id: 'run-one',
          status: 'complete',
          text: '[SILENT]',
        }));
        recipientWaiting();
      });
      return { status: 'streaming' };
    }
    if (method === 'session.interrupt') {
      expect(params).toEqual({
        session_id: 'live-builder',
        expected_submission_id: '__bot_dm__delivery-one',
      });
      emit(event('message.complete', 'live-builder', {
        submission_id: '__bot_dm__delivery-one',
        status: 'interrupted',
        text: 'partial result that must not persist',
      }));
      return { status: 'interrupted' };
    }
    throw new Error(`unexpected_gateway_method:${method}`);
  });
  return {
    connectionState: 'open',
    connect: vi.fn(async () => undefined),
    close: vi.fn(),
    onEvent: vi.fn((listener: (value: HermesGatewayEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    onState: vi.fn((listener: (value: string) => void) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    }),
    onRequest: vi.fn(() => () => undefined),
    request,
  } as unknown as HermesGatewayClient;
}

async function serve(withBrowserUser = true): Promise<{ baseUrl: string }> {
  const app = express();
  app.use(express.json());
  if (withBrowserUser) {
    app.use((req, _res, next) => {
      (req as typeof req & { userId: string }).userId = 'user-one';
      next();
    });
  }
  app.use('/api/main/session', router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  vi.clearAllMocks();
});

describe('Main direct-recipient stop settlement', () => {
  it('accepts only a supervised external identity and exact saved Main binding', async () => {
    const fakeGateway = gateway(() => undefined, true);
    gatewayMocks.hermesGateway.mockResolvedValue(fakeGateway);
    projectMocks.projectCardAuthority.mockResolvedValue(authority());
    const { baseUrl } = await serve(false);

    const chat = await fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LiquidAIty-Internal-MCP-Secret': 'internal-secret',
      },
      body: JSON.stringify({
        projectId: 'project-one',
        deckId: 'deck_builder',
        message: '@Builder investigate the exact issue',
        clientMessageId: 'msg_00000000-0000-4000-8000-000000000005',
        clientReplyMessageId: 'msg_00000000-0000-4000-8000-000000000006',
        externalIssuer: 'https://tenant.example/',
        externalSubject: 'auth0|owner',
        expectedMainCardId: 'card-main',
      }),
    });
    const stream = await chat.text();

    expect(chat.status).toBe(200);
    expect(stream).toContain('event: run');
    expect(stream).toContain('event: end');
    expect(externalEntryMocks.resolveExternalIdentityProjectGrant).toHaveBeenCalledWith(
      'https://tenant.example/', 'auth0|owner',
    );
    expect(projectMocks.getOwnedProjectByReference).toHaveBeenCalledWith(
      'project-one', 'user-one',
    );
  });

  it('refuses an external request whose saved Main binding changed', async () => {
    projectMocks.projectCardAuthority.mockResolvedValue(authority());
    const { baseUrl } = await serve(false);

    const chat = await fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LiquidAIty-Internal-MCP-Secret': 'internal-secret',
      },
      body: JSON.stringify({
        projectId: 'project-one',
        deckId: 'deck_builder',
        message: '@Builder investigate the exact issue',
        clientMessageId: 'msg_00000000-0000-4000-8000-000000000007',
        clientReplyMessageId: 'msg_00000000-0000-4000-8000-000000000008',
        externalIssuer: 'https://tenant.example/',
        externalSubject: 'auth0|owner',
        expectedMainCardId: 'stale-main',
      }),
    });

    expect(chat.status).toBe(409);
    expect(await chat.json()).toEqual({
      ok: false,
      error: 'external_main_card_binding_changed',
    });
    expect(conversationMocks.appendConversationTurn).not.toHaveBeenCalled();
    expect(lifecycleMocks.prepareCardRun).not.toHaveBeenCalled();
  });

  it('fails and settles the outer Run when the Hermes socket closes mid-turn', async () => {
    const fakeGateway = gateway(() => undefined, true);
    gatewayMocks.hermesGateway.mockResolvedValue(fakeGateway);
    projectMocks.projectCardAuthority.mockResolvedValue(authority());
    const { baseUrl } = await serve();

    const chat = await fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-one',
        deckId: 'deck_builder',
        message: '@Builder investigate the exact issue',
        clientMessageId: 'msg_00000000-0000-4000-8000-000000000003',
        clientReplyMessageId: 'msg_00000000-0000-4000-8000-000000000004',
      }),
    });
    const stream = await chat.text();

    expect(chat.status).toBe(200);
    expect(stream).toContain('"code":"hermes_gateway_closed_during_turn"');
    expect(stream).toContain('event: end');
    expect(lifecycleMocks.finishCardRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-one',
      state: 'failed',
      errorCode: 'hermes_turn_failed',
      errorSummary: 'hermes_gateway_closed_during_turn',
    }));
    expect(conversationMocks.appendConversationReplyOnce).not.toHaveBeenCalled();
  });

  it('settles a pre-session Gateway failure without fabricated provider evidence', async () => {
    gatewayMocks.hermesGateway.mockRejectedValue(
      new Error('WebSocket heartbeat acknowledgement timed out'),
    );
    projectMocks.projectCardAuthority.mockResolvedValue(authority());
    const { baseUrl } = await serve();

    const chat = await fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-one',
        deckId: 'deck_builder',
        message: '@Builder investigate the exact issue',
        clientMessageId: 'msg_00000000-0000-4000-8000-000000000005',
        clientReplyMessageId: 'msg_00000000-0000-4000-8000-000000000006',
      }),
    });
    const stream = await chat.text();

    expect(chat.status).toBe(200);
    expect(stream).toContain('"code":"WebSocket heartbeat acknowledgement timed out"');
    expect(stream).toContain('event: end');
    expect(lifecycleMocks.finishCardRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-one',
      state: 'failed',
      errorCode: 'hermes_turn_failed',
      errorSummary: 'WebSocket heartbeat acknowledgement timed out',
    }));
    const settlement = lifecycleMocks.finishCardRun.mock.calls.at(-1)?.[0];
    expect(settlement).not.toHaveProperty('effectiveProvider');
    expect(settlement).not.toHaveProperty('provider');
    expect(settlement).not.toHaveProperty('model');
    expect(settlement?.hermesSessionRef).toBeUndefined();
    expect(conversationMocks.appendConversationReplyOnce).not.toHaveBeenCalled();
  });

  it('interrupts the exact recipient, cancels the outer Run, and persists no partial reply', async () => {
    let markRecipientWaiting!: () => void;
    const recipientWaiting = new Promise<void>((resolve) => { markRecipientWaiting = resolve; });
    const fakeGateway = gateway(markRecipientWaiting);
    gatewayMocks.hermesGateway.mockResolvedValue(fakeGateway);
    projectMocks.projectCardAuthority.mockResolvedValue(authority());
    const { baseUrl } = await serve();

    const chatRequest = fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-one',
        deckId: 'deck_builder',
        message: '@Builder investigate the exact issue',
        clientMessageId: 'msg_00000000-0000-4000-8000-000000000001',
        clientReplyMessageId: 'msg_00000000-0000-4000-8000-000000000002',
      }),
    });

    const chat = await chatRequest;
    const streamRequest = chat.text();
    await Promise.race([
      recipientWaiting,
      streamRequest.then((text) => {
        throw new Error(`chat_ended_before_recipient_wait:${text}`);
      }),
    ]);
    const stopped = await fetch(`${baseUrl}/api/main/session/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-one',
        deckId: 'deck_builder',
        expectedRunId: 'run-one',
      }),
    });
    const stream = await streamRequest;

    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ ok: true, runId: 'run-one', state: 'stopping' });
    expect(chat.status).toBe(200);
    expect(stream).toContain('"state":"cancelled"');
    expect(stream).not.toContain('partial result that must not persist');
    expect(lifecycleMocks.finishCardRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-one',
      state: 'cancelled',
      finalResult: undefined,
      errorCode: 'hermes_turn_cancelled',
    }));
    expect(conversationMocks.appendConversationReplyOnce).not.toHaveBeenCalled();
    expect(conversationMocks.appendConversationTurn).toHaveBeenCalledOnce();
  });
});
