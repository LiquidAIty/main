import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const conversation = vi.hoisted(() => ({
  appendReply: vi.fn(async () => ({ inserted: true })),
  appendTurn: vi.fn(async () => []),
  history: vi.fn(async () => []),
  settle: vi.fn(async () => ({})),
}));
const runtime = vi.hoisted(() => ({
  attachMainImages: vi.fn(async () => undefined),
  execute: vi.fn(),
  session: vi.fn(async () => ({
    sessionId: 'stored-main',
    liveHandle: 'live-main',
    info: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
  })),
}));
const runs = vi.hoisted(() => ({
  finish: vi.fn(async () => undefined),
  prepare: vi.fn(),
  start: vi.fn(async () => undefined),
}));
const gateway = vi.hoisted(() => ({
  request: vi.fn(async (method: string) => (
    method === 'session.interrupt' ? { status: 'interrupted' } : {}
  )),
  onEvent: vi.fn(() => () => undefined),
  onState: vi.fn(() => () => undefined),
  onRequest: vi.fn(() => () => undefined),
  connect: vi.fn(async () => undefined),
  close: vi.fn(),
  connectionState: 'open',
}));

vi.mock('../conversations/store', () => ({
  appendConversationReplyOnce: conversation.appendReply,
  appendConversationTurn: conversation.appendTurn,
  getConversationMessages: conversation.history,
  settleConversationMessage: conversation.settle,
}));
vi.mock('../cardRuntime/cardSessions', () => ({
  resolveMainSession: runtime.session,
}));
vi.mock('../cardRuntime/mainTurn', () => ({
  attachMainImages: runtime.attachMainImages,
  executeMainTurn: runtime.execute,
}));
vi.mock('../cardRuntime/profileMaterialization', () => ({
  savedCardAgentRoster: () => ['knowgraph'],
}));
vi.mock('../services/cardRuntimeGateway', () => ({
  cardRuntimeGateway: vi.fn(async () => gateway),
}));
vi.mock('../services/cardRunLifecycle', () => ({
  finishCardRun: runs.finish,
  cardRuntimeUsageFields: () => ({}),
  prepareCardRun: runs.prepare,
  startCardRun: runs.start,
}));
vi.mock('../services/projectStore', () => ({
  getOwnedProjectByReference: vi.fn(async () => ({
    id: 'project-session-one', ownerUserId: 'owner-one',
  })),
}));
vi.mock('../services/projectCardAuthority', () => ({
  projectCardAuthority: vi.fn(async () => ({
    deck: { id: 'deck-one', nodes: [], edges: [] },
    main: {
      card: { id: 'main', runtime: { kind: 'hermes', mode: 'main', profile: 'main' } },
      cardRevisionId: 'revision-main',
      profile: 'main',
      title: 'Main',
      address: 'Main',
    },
    cards: [{
      card: { id: 'knowgraph', runtime: { kind: 'hermes', mode: 'delegate', profile: 'knowgraph' } },
      cardRevisionId: 'revision-knowgraph',
      profile: 'knowgraph',
      title: 'KnowGraph',
      address: 'KnowGraph',
    }],
  })),
}));
vi.mock('../services/mcp/internalMcpAuth', () => ({
  internalMcpProcessSecretAuthorized: () => false,
}));
vi.mock('../auth/externalIdentityGrantStore', () => ({
  resolveExternalIdentityProjectGrant: vi.fn(async () => null),
}));

import router from './mainSession.routes';

let server: Server | null = null;
let baseUrl = '';

async function listen(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = 'owner-one';
    next();
  });
  app.use('/api/main/session', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function close(): Promise<void> {
  const current = server;
  server = null;
  if (!current) return;
  await new Promise<void>((resolve, reject) => current.close((error) => (
    error ? reject(error) : resolve()
  )));
}

function chatBody() {
  return {
    projectId: 'project-one',
    deckId: 'deck-one',
    message: '@KnowGraph research the current evidence',
    clientMessageId: 'msg_00000000-0000-4000-8000-000000000001',
    clientReplyMessageId: 'msg_00000000-0000-4000-8000-000000000002',
  };
}

describe('Main web route over Card agent communication', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    gateway.request.mockImplementation(async (method: string) => (
      method === 'session.interrupt' ? { status: 'interrupted' } : {}
    ));
    runs.prepare.mockResolvedValue({
      runId: 'run-one',
      request: {
        message: '@KnowGraph research the current evidence',
        images: [],
        unavailableTools: [],
        provider: { provider: 'openai-codex', providerModelId: 'gpt-6.1-sol' },
      },
    });
    runtime.execute.mockImplementation(async (args: Record<string, any>) => {
      await args.onAdmitted();
      args.onEvent({
        type: 'message.delta', session_id: 'live-main', payload: { text: 'Sourced answer' },
      });
      return {
        text: 'Sourced answer',
        toolCalls: 1,
        providerTurnRef: 'turn-one',
        event: { type: 'message.complete', payload: { status: 'complete', usage: {} } },
      };
    });
    await listen();
  });

  afterEach(close);

  it('passes the raw @Name prompt to Main and emits the established SSE contract', async () => {
    const response = await fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody()),
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('event: run');
    expect(body).toContain('event: session');
    expect(body).toContain('event: text');
    expect(body).toContain('event: done');
    expect(body).toContain('event: end');
    expect(runtime.execute).toHaveBeenCalledOnce();
    expect(runtime.execute.mock.calls[0][0].text).toBe('@KnowGraph research the current evidence');
    expect(runs.start).toHaveBeenCalledWith({
      runId: 'run-one', submissionId: 'run-one', hermesSessionRef: 'stored-main',
    });
    expect(runs.finish).toHaveBeenCalledOnce();
    const appended = conversation.appendTurn.mock.calls as unknown as Array<[
      { messages: Array<{ target: unknown }> }
    ]>;
    expect(appended[0][0].messages[0].target).toMatchObject({
      label: 'KnowGraph', profile: 'knowgraph', address: 'KnowGraph',
    });
    expect(conversation.appendReply).toHaveBeenCalledOnce();
  });

  it('returns the exact wired agent roster in history', async () => {
    const response = await fetch(
      `${baseUrl}/api/main/session/history?projectId=project-one&deckId=deck-one`,
    );
    const payload = await response.json() as Record<string, any>;
    expect(response.status).toBe(200);
    expect(payload.addressableAgents).toEqual([{
      cardId: 'knowgraph',
      cardRevisionId: 'revision-knowgraph',
      profile: 'knowgraph',
      title: 'KnowGraph',
      address: 'KnowGraph',
    }]);
  });

  it('steers additional text into the active Main turn without creating another Run', async () => {
    let finishTurn!: (value: Record<string, unknown>) => void;
    runtime.execute.mockImplementation(async (args: Record<string, any>) => {
      await args.onAdmitted();
      return new Promise((resolve) => { finishTurn = resolve; });
    });
    gateway.request.mockImplementation(async (method: string) => {
      if (method === 'prompt.submit') return { status: 'steered' };
      if (method === 'session.interrupt') return { status: 'interrupted' };
      return {};
    });
    const first = fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody()),
    });
    while (!runs.start.mock.calls.length) await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...chatBody(),
        message: 'Also compare the downside case.',
        clientMessageId: 'msg_00000000-0000-4000-8000-000000000003',
        clientReplyMessageId: 'msg_00000000-0000-4000-8000-000000000004',
      }),
    });
    const secondBody = await second.text();
    expect(second.status).toBe(200);
    expect(secondBody).toContain('"state":"steered"');
    expect(runs.prepare).toHaveBeenCalledOnce();
    expect(gateway.request).toHaveBeenCalledWith('prompt.submit', {
      session_id: 'live-main',
      profile: 'main',
      text: 'Also compare the downside case.',
    });
    finishTurn({
      text: 'Combined answer',
      toolCalls: 0,
      providerTurnRef: 'turn-one',
      event: { type: 'message.complete', payload: { status: 'complete', usage: {} } },
    });
    await first;
  });

  it('stops an active turn with standard session.interrupt only', async () => {
    let rejectTurn!: (error: Error) => void;
    runtime.execute.mockImplementation(async (args: Record<string, any>) => {
      await args.onAdmitted();
      return new Promise((_resolve, reject) => {
        rejectTurn = reject;
        args.stopSignal.addEventListener('abort', () => reject(new Error('card_turn_cancelled')));
      });
    });
    const chat = fetch(`${baseUrl}/api/main/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody()),
    });
    while (!runs.start.mock.calls.length) await new Promise((resolve) => setTimeout(resolve, 0));
    const stopped = await fetch(`${baseUrl}/api/main/session/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-one', deckId: 'deck-one', expectedRunId: 'run-one',
      }),
    });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ ok: true, runId: 'run-one', state: 'stopping' });
    expect(gateway.request).toHaveBeenCalledWith('session.interrupt', {
      session_id: 'live-main', profile: 'main',
    });
    await chat;
    rejectTurn?.(new Error('test cleanup'));
  });
});
