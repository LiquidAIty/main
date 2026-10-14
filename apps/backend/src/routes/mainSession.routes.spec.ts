import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express, { type Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendReply: vi.fn(),
  appendTurn: vi.fn(),
  getConversationMessages: vi.fn(),
  listConversations: vi.fn(),
  getOwnedProjectByReference: vi.fn(),
  sharedChatAuthority: vi.fn(),
  hermesGateway: vi.fn(),
  requestPythonRailsJson: vi.fn(),
  readToolCatalog: vi.fn(),
  materializeSavedCardProfile: vi.fn(),
  savedCardBotRoster: vi.fn(),
  hermesCalls: [] as Array<{ method: string; params: Record<string, unknown> }>,
}));

vi.mock('../conversations/store', () => ({
  appendSharedConversationReplyOnce: mocks.appendReply,
  appendSharedConversationTurn: mocks.appendTurn,
  getConversationMessages: mocks.getConversationMessages,
  listConversations: mocks.listConversations,
}));
vi.mock('../services/projectStore', () => ({
  getOwnedProjectByReference: mocks.getOwnedProjectByReference,
}));
vi.mock('../services/savedCardAuthority', async () => {
  const actual = await vi.importActual<typeof import('../services/savedCardAuthority')>(
    '../services/savedCardAuthority',
  );
  return { ...actual, sharedChatAuthority: mocks.sharedChatAuthority };
});
vi.mock('../services/hermesGateway', () => ({ hermesGateway: mocks.hermesGateway }));
vi.mock('../services/pythonRailsClient', () => ({
  requestPythonRailsJson: mocks.requestPythonRailsJson,
}));
vi.mock('../services/mcp/internalMcpAuth', () => ({
  internalMcpAuthorization: () => 'Bearer test',
  resolveInternalMcpUrl: () => 'http://127.0.0.1:8765/mcp',
}));
vi.mock('../services/mcp/toolCatalogMcpClient', () => ({
  readToolCatalog: mocks.readToolCatalog,
}));
vi.mock('../hermes/profileMaterialization', () => ({
  materializeSavedCardProfile: mocks.materializeSavedCardProfile,
  savedCardBotRoster: mocks.savedCardBotRoster,
}));

import mainSessionRoutes from './mainSession.routes';

const mainCard = {
  id: 'card_main_chat',
  _cardRevisionId: 'revision-main',
  templateId: 'main',
  title: 'Main',
  prompt: '# Main',
  runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
  runtimeOptions: {},
  position: { x: 0, y: 0 },
};
const addressableMain = {
  card: mainCard,
  cardRevisionId: 'revision-main',
  profile: 'main',
  title: 'Main',
  address: 'Main',
  aliases: ['card_main_chat', 'main'],
};

const app = express()
  .use(express.json())
  .use((req, _res, next) => {
    (req as Request & { userId: string }).userId = 'owner-one';
    next();
  })
  .use('/main/session', mainSessionRoutes);

let server: Server | null = null;
let baseUrl = '';

async function request(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  if (!server) {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server?.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
  return fetch(`${baseUrl}/main/session${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hermesCalls.length = 0;
  mocks.getOwnedProjectByReference.mockResolvedValue({ ownerUserId: 'owner-one' });
  mocks.sharedChatAuthority.mockResolvedValue({
    deck: { id: 'deck_builder', nodes: [mainCard], edges: [], promptTemplates: [], version: 1 },
    main: addressableMain,
    cards: [addressableMain],
  });
  mocks.getConversationMessages.mockResolvedValue([]);
  mocks.listConversations.mockResolvedValue([]);
  mocks.appendTurn.mockResolvedValue(undefined);
  mocks.appendReply.mockResolvedValue(undefined);
  mocks.readToolCatalog.mockResolvedValue({
    state: 'available', tools: [], unavailableFamilies: [], toolFailures: {},
  });
  mocks.savedCardBotRoster.mockReturnValue([]);
  mocks.materializeSavedCardProfile.mockResolvedValue({
    capability_fingerprint: '0123456789ab',
    model: { provider: 'openai-codex', default: 'gpt-5.6-sol' },
  });
  mocks.requestPythonRailsJson.mockImplementation(async (path: string, init: RequestInit) => {
    if (path === '/domain/runs/begin') {
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      return {
        runId: payload.runId,
        hermesTransport: {
          cardIdentity: { cardId: 'card_main_chat' },
          request: {
            runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
            runtimeOptions: { openaiRuntime: 'codex_app_server' },
            provider: { provider: 'openai-codex', providerModelId: 'gpt-5.6-sol' },
            message: payload.assignment,
            images: payload.images,
            toolDefinitions: [],
            enabledTools: [],
            unavailableTools: [],
          },
        },
      };
    }
    if (path === '/domain/runs/finish') return { ok: true };
    throw new Error(`unexpected_python_path:${path}`);
  });

  let listener: ((event: Record<string, any>) => void) | null = null;
  const client = {
    onEvent(candidate: (event: Record<string, any>) => void) {
      listener = candidate;
      return () => { listener = null; };
    },
    async request(method: string, params: Record<string, unknown> = {}) {
      mocks.hermesCalls.push({ method, params: structuredClone(params) });
      if (method === 'session.list') {
        return { sessions: [{ id: 'stored-main', resolved_id: 'stored-main' }] };
      }
      if (method === 'session.resume') {
        return {
          session_id: 'live-main', stored_session_id: 'stored-main',
          info: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
        };
      }
      if (method === 'session.activate') {
        return {
          session_id: 'live-main',
          stored_session_id: 'stored-main',
          messages_omitted: true,
          info: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
        };
      }
      if (method === 'image.attach_bytes') return { ok: true };
      if (method === 'voice.toggle') {
        if (params.action === 'status') {
          return {
            enabled: false,
            tts: false,
            available: true,
            audio_available: true,
            stt_available: true,
            details: '',
          };
        }
        if (params.action === 'on') return { enabled: true, tts: false };
        if (params.action === 'tts') return { enabled: true, tts: true };
        if (params.action === 'off') return { enabled: false, tts: false, status: 'off' };
      }
      if (method === 'voice.record') {
        return { status: params.action === 'start' ? 'recording' : 'stopped' };
      }
      if (method === 'prompt.submit') {
        queueMicrotask(() => {
          const submissionId = String(params.submission_id);
          listener?.({
            type: 'prompt.submission.started', session_id: 'live-main',
            payload: { submission_id: submissionId },
          });
          listener?.({
            type: 'message.complete', session_id: 'live-main',
            payload: {
              submission_id: submissionId,
              status: 'complete',
              text: 'Main reply',
              usage: {},
            },
          });
        });
        return { status: 'streaming' };
      }
      throw new Error(`unexpected_hermes_method:${method}`);
    },
  };
  mocks.hermesGateway.mockResolvedValue(client);
});

afterEach(async () => {
  if (!server) return;
  const active = server;
  server = null;
  await new Promise<void>((resolve, reject) => (
    active.close((error) => error ? reject(error) : resolve())
  ));
});

describe('Main Bot Mode turn transport', () => {
  it('uses the one current Card-run preparation endpoint and assignment contract', async () => {
    const response = await request('/chat', {
      projectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'main',
      message: 'Hello Main',
      clientMessageId: 'msg_11111111-1111-4111-8111-111111111111',
      clientReplyMessageId: 'msg_22222222-2222-4222-8222-222222222222',
      images: [{
        name: 'proof.png',
        mediaType: 'image/png',
        dataUrl: 'data:image/png;base64,AA==',
        kind: 'user-upload',
      }],
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('event: done');
    expect(body).toContain('Main reply');
    const begin = mocks.requestPythonRailsJson.mock.calls.find(([path]) => (
      path === '/domain/runs/begin'
    ));
    expect(begin).toBeTruthy();
    const payload = JSON.parse(String(begin?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      projectId: 'project-one',
      deckId: 'deck_builder',
      cardId: 'card_main_chat',
      conversationId: 'main',
      assignment: 'Hello Main',
      images: [expect.objectContaining({ name: 'proof.png', mediaType: 'image/png' })],
    });
    expect(payload).not.toHaveProperty('message');
    expect(payload).not.toHaveProperty('sharedConversation');
    expect(mocks.requestPythonRailsJson.mock.calls.some(([path]) => (
      path === '/domain/main/runs/begin'
    ))).toBe(false);
    expect(mocks.hermesCalls.find(({ method }) => method === 'session.activate')?.params)
      .toEqual({
        profile: 'main',
        session_id: 'live-main',
        omit_messages: true,
        bot_mode_roster: [],
      });
    expect(mocks.hermesCalls.find(({ method }) => method === 'prompt.submit')?.params)
      .toMatchObject({
        session_id: 'live-main',
        profile: 'main',
        text: 'Hello Main',
        bot_mode_roster: [],
        expected_profile_capability_fingerprint: '0123456789ab',
      });
    expect(mocks.hermesCalls.find(({ method }) => method === 'image.attach_bytes')?.params)
      .toMatchObject({
        session_id: 'live-main',
        profile: 'main',
        content_base64: 'AA==',
        filename: 'proof.png',
      });
  });

  it('persists the user message before a later Run-preparation rejection', async () => {
    mocks.requestPythonRailsJson.mockRejectedValueOnce(new Error('saved_card_preparation_rejected'));

    const response = await request('/chat', {
      projectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'main',
      message: 'Keep this rejected message.',
      clientMessageId: 'msg_33333333-3333-4333-8333-333333333333',
      clientReplyMessageId: 'msg_44444444-4444-4444-8444-444444444444',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'saved_card_preparation_rejected',
    });
    expect(mocks.appendTurn).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-one',
      conversationId: 'main',
      messages: [expect.objectContaining({
        messageId: 'msg_33333333-3333-4333-8333-333333333333',
        content: 'Keep this rejected message.',
      })],
    }));
    expect(mocks.appendTurn.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.requestPythonRailsJson.mock.invocationCallOrder[0]);
    expect(mocks.hermesGateway).not.toHaveBeenCalled();
  });

  it('uses Hermes native voice toggle and record methods for Main Bot Mode', async () => {
    const controller = new AbortController();
    const response = await request('/voice/start', {
      projectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'main',
      tts: true,
    }, controller.signal);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    const frame = new TextDecoder().decode(first.value || new Uint8Array());
    expect(frame).toContain('event: ready');
    expect(frame).toContain('"recordStatus":"recording"');
    controller.abort();
    await reader.cancel().catch(() => undefined);

    expect(mocks.hermesCalls.filter(({ method }) => method === 'voice.toggle')
      .map(({ params }) => params.action)).toEqual(['status', 'on', 'tts']);
    expect(mocks.hermesCalls.find(({ method, params }) => (
      method === 'voice.record' && params.action === 'start'
    ))?.params).toMatchObject({ session_id: 'live-main', profile: 'main' });

    const stopped = await request('/voice/stop', {
      projectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'main',
      cancel: false,
    });
    expect(stopped.status).toBe(200);
    await expect(stopped.json()).resolves.toMatchObject({ ok: true, state: 'stopped' });
  });
});
