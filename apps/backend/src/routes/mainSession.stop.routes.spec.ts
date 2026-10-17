/**
 * Entity: Main Chat
 * Relationship: Verifies cancelling an addressed recipient interrupts the exact Hermes submission and settles the outer Run without persisting incomplete recipient output.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';
import type { HermesGatewayClient, HermesGatewayEvent } from '../services/hermesGateway';
import type { ProjectCardAuthority, ProjectCardBinding } from '../services/projectCardAuthority';

const conversationMocks = vi.hoisted(() => ({
  appendConversationReplyOnce: vi.fn(async () => undefined),
  appendConversationTurn: vi.fn(async () => undefined),
  getConversationMessages: vi.fn(async () => []),
}));

const lifecycleMocks = vi.hoisted(() => ({
  finishCardRun: vi.fn(async () => undefined),
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

function gateway(recipientWaiting: () => void) {
  const listeners = new Set<(value: HermesGatewayEvent) => void>();
  const emit = (value: HermesGatewayEvent) => listeners.forEach(listener => listener(value));
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
    onState: vi.fn(() => () => undefined),
    onRequest: vi.fn(() => () => undefined),
    request,
  } as unknown as HermesGatewayClient;
}

async function serve(): Promise<{ baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId: string }).userId = 'user-one';
    next();
  });
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
