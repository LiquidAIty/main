import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeckCard } from '../types';

const mocks = vi.hoisted(() => ({
  appendReply: vi.fn(),
  appendTurn: vi.fn(),
  getMessages: vi.fn(async () => []),
  getDeck: vi.fn(),
  getOwnedProjectByReference: vi.fn(async () => ({ ownerUserId: 'owner-1' })),
  getInternalProjectById: vi.fn(async () => ({ ownerUserId: 'owner-1' })),
  requestRails: vi.fn(),
  readCatalog: vi.fn(async () => ({
    state: 'available', unavailableFamilies: [], toolFailures: {}, tools: [],
  })),
  gateway: vi.fn(),
  materializeProfile: vi.fn(async (_request, card) => ({
    model: { provider: 'openai-codex', default: card.runtimeOptions.providerModelId },
    capability_fingerprint: '0123456789ab',
  })),
  savedRoster: vi.fn(() => []),
  authorizeTool: vi.fn(() => 'Bearer target-run'),
  resolveToolUrl: vi.fn(() => 'http://127.0.0.1:9009/mcp'),
  authorizeInternal: vi.fn((value) => value === 'test-internal-secret'),
}));

vi.mock('../conversations/store', () => ({
  appendSharedConversationReplyOnce: mocks.appendReply,
  appendSharedConversationUserMessageOnce: mocks.appendTurn,
  getConversationMessages: mocks.getMessages,
}));
vi.mock('../decks/deckDomainClient', () => ({
  BUILDER_CARD_ID: 'builder',
  getDeckDocument: mocks.getDeck,
}));
vi.mock('../decks/defaultProjectDeck', () => ({
  DEFAULT_PROJECT_DECK_ID: 'deck_builder',
}));
vi.mock('../services/projectStore', () => ({
  getOwnedProjectByReference: mocks.getOwnedProjectByReference,
  getInternalProjectById: mocks.getInternalProjectById,
}));
vi.mock('../services/pythonRailsClient', () => ({
  requestPythonRailsJson: mocks.requestRails,
}));
vi.mock('../services/mcp/toolCatalogMcpClient', () => ({
  readToolCatalog: mocks.readCatalog,
}));
vi.mock('../services/hermesGateway', () => ({
  hermesGateway: mocks.gateway,
}));
vi.mock('../hermes/profileMaterialization', () => ({
  materializeSavedCardProfile: mocks.materializeProfile,
  savedCardBotRoster: mocks.savedRoster,
}));
vi.mock('../services/mcp/internalMcpAuth', () => ({
  internalMcpAuthorization: mocks.authorizeTool,
  internalMcpProcessSecretAuthorized: mocks.authorizeInternal,
  resolveInternalMcpUrl: mocks.resolveToolUrl,
}));

import savedSpecialistRoutes from './savedSpecialist.routes';
import sharedChatRoutes from './sharedChat.routes';

type GatewayEvent = {
  type: string;
  session_id: string;
  payload: Record<string, unknown>;
};

class FakeGateway {
  readonly connectionState = 'open';
  calls: Array<{ method: string; params: Record<string, any> }> = [];
  listeners = new Set<(event: GatewayEvent) => void>();
  stateListeners = new Set<(state: string) => void>();
  blockTarget = false;
  failTarget = false;
  structuredFailure: Record<string, unknown> | null = null;
  responsesByProfile = new Map<string, string>();
  promptIssuedResolve!: () => void;
  promptIssued = new Promise<void>((resolve) => { this.promptIssuedResolve = resolve; });

  onEvent(listener: (event: GatewayEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: (state: string) => void) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  emit(event: GatewayEvent) {
    for (const listener of this.listeners) listener(event);
  }

  async request<T>(method: string, params: Record<string, any> = {}): Promise<T> {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'profiles.describe') {
      return { name: String(params.name), model: {} } as T;
    }
    if (method === 'session.list') {
      if (params.profile === 'builder') {
        return { sessions: [{ id: 'stored-source', resolved_id: 'stored-source' }] } as T;
      }
      return { sessions: [] } as T;
    }
    if (method === 'session.create') {
      return {
        session_id: `live-${params.profile}`,
        stored_session_id: `stored-${params.profile}`,
        info: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      } as T;
    }
    if (method === 'session.resume') {
      return {
        session_id: `live-${params.profile}`,
        stored_session_id: String(params.session_id),
        info: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      } as T;
    }
    if (method === 'session.active_list') {
      return { sessions: [{ id: 'live-source', session_key: 'stored-source' }] } as T;
    }
    if (method === 'session.activate') {
      return {
        session_id: String(params.session_id),
        stored_session_id: params.profile === 'builder'
          ? 'stored-source'
          : `stored-${params.profile}`,
        messages_omitted: true,
        info: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      } as T;
    }
    if (method === 'prompt.submit') {
      this.promptIssuedResolve();
      queueMicrotask(() => {
        this.emit({
          type: 'prompt.submission.started',
          session_id: params.session_id,
          payload: { submission_id: params.submission_id },
        });
        if (!this.blockTarget) {
          this.emit({
            type: this.failTarget && !this.structuredFailure ? 'error' : 'message.complete',
            session_id: params.session_id,
            payload: {
              submission_id: params.submission_id,
              ...(this.structuredFailure
                ? {
                    status: 'error',
                    error: 'Tool execution failed honestly.',
                    error_surface: this.structuredFailure,
                  }
                : this.failTarget
                ? { message: 'target failed honestly' }
                : {
                    status: 'complete',
                    text: this.responsesByProfile.get(String(params.profile))
                      || 'actual specialist result',
                  }),
              turn_usage: { model: 'gpt-5.6-sol' },
            },
          });
        }
      });
      return { status: 'streaming' } as T;
    }
    if (method === 'session.interrupt') return { status: 'interrupted' } as T;
    throw new Error(`unexpected_gateway_method:${method}`);
  }
}

function card(
  id: string,
  title: string,
  profile: string,
  mode: 'main' | 'delegate',
  runtimeOptions: Record<string, unknown> = {},
): DeckCard {
  return {
    id,
    _cardRevisionId: `revision-${id}`,
    templateId: id,
    title,
    role: '',
    prompt: `# ${title}`,
    runtime: { kind: 'hermes', mode, profile },
    runtimeOptions: {
      provider: 'openai',
      providerModelId: 'gpt-5.6-sol',
      ...runtimeOptions,
    },
    position: { x: 0, y: 0 },
  };
}

function deck() {
  return {
    id: 'deck_builder',
    name: 'Builder',
    projectCodeFolder: '',
    version: 1,
    promptTemplates: [],
    edges: [],
    nodes: [
      card('card_main_chat', 'Main', 'main', 'main'),
      card('builder', 'Builder', 'builder', 'delegate'),
      card('card_thinkgraph', 'ThinkGraph', 'thinkgraph', 'delegate', {
        tools: ['engraphis_recall_context'],
      }),
      card('card_knowgraph', 'KnowGraph', 'knowgraph', 'delegate', {
        tools: ['graphiti.add_memory'],
        skills: ['grounded-citations'],
        toolsets: ['web'],
      }),
    ],
  };
}

const servers: Server[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function start(gateway: FakeGateway, savedDeck = deck(), completedPairDeck = savedDeck) {
  mocks.gateway.mockResolvedValue(gateway);
  let deckReadCount = 0;
  mocks.getDeck.mockImplementation(async () => ({
    deck: deckReadCount++ === 0 ? savedDeck : completedPairDeck,
  }));
  const finishes: Array<Record<string, any>> = [];
  const starts: Array<Record<string, any>> = [];
  const begins: Array<Record<string, any>> = [];
  const mainBegins: Array<Record<string, any>> = [];
  const pairPreparations: Array<Record<string, any>> = [];
  const pairSettlements: Array<Record<string, any>> = [];
  mocks.requestRails.mockImplementation(async (path: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body || '{}'));
    if (path === '/domain/runs/read') {
      return {
        ok: true,
        run: {
          runId: 'req_source', projectId: 'project-1', deckId: 'deck_builder',
          conversationId: 'conversation-1', cardId: 'builder', state: 'running',
        },
      };
    }
    if (path === '/domain/runs/begin') {
      begins.push(payload);
      const isThink = payload.cardId === 'card_thinkgraph';
      const profile = isThink
        ? 'thinkgraph'
        : payload.cardId === 'builder' ? 'builder' : 'knowgraph';
      const canonicalId = isThink ? 'engraphis_recall_context' : 'graphiti.add_memory';
      return {
        runId: payload.runId,
        cardRevisionId: payload.cardRevisionId,
        hermesTransport: {
          cardIdentity: { cardId: payload.cardId },
          request: {
            runtime: {
              kind: 'hermes', mode: 'delegate',
              profile,
            },
            provider: { provider: 'openai', providerModelId: 'gpt-5.6-sol' },
            message: payload.assignment,
            images: [],
            enabledTools: [canonicalId],
            unavailableTools: [],
            toolDefinitions: [{
              canonicalId,
              publications: ['card-runtime'],
              available: true,
              description: canonicalId,
              inputSchema: { type: 'object', properties: {} },
            }],
          },
        },
      };
    }
    if (path === '/domain/main/runs/begin') {
      mainBegins.push(payload);
      return {
        runId: payload.runId,
        cardRevisionId: payload.cardRevisionId,
        hermesTransport: {
          cardIdentity: { cardId: 'card_main_chat' },
          request: {
            runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
            provider: { provider: 'openai', providerModelId: 'gpt-5.6-sol' },
            message: payload.message,
            images: [],
            enabledTools: [],
            unavailableTools: [],
            toolDefinitions: [],
          },
        },
      };
    }
    if (path === '/thinkgraph/completed-pair/prepare') {
      pairPreparations.push(payload);
      return {
        ok: true,
        projectId: payload.projectId,
        pairReference: 'pair-main-one',
        intakeOperation: 'pending',
        structuredExtractionRequired: true,
        revision: 1,
        revisionChanged: false,
        preparation: { status: 'completed_without_graph_mutation' },
        enrichmentSchema: { type: 'object', properties: { facts: { type: 'array' } } },
        enrichmentPrompt: 'Extract exactly one Think.',
        enrichmentInput: { exact_main_response: payload.mainResponse },
      };
    }
    if (path === '/thinkgraph/completed-pair/settle') {
      pairSettlements.push(payload);
      return {
        ok: true,
        revision: 2,
        revisionChanged: true,
        changedNodeIds: ['think-node'],
        changedEdgeIds: ['think-edge'],
        affectedNodeIds: ['think-node'],
      };
    }
    if (path === '/domain/runs/finish') {
      finishes.push(payload);
      return {
        ok: true,
        runId: payload.runId,
        state: payload.state,
        runRecord: { state: payload.state },
      };
    }
    if (path === '/domain/runs/start') {
      starts.push(payload);
      return {
        ok: true,
        runId: payload.runId,
        correlationId: payload.correlationId,
        submissionId: payload.submissionId,
        state: 'running',
      };
    }
    throw new Error(`unexpected_rails_path:${path}`);
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId?: string }).userId = 'owner-1';
    next();
  });
  app.use('/saved-specialists', savedSpecialistRoutes);
  app.use('/shared-chat', sharedChatRoutes);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    begins,
    finishes,
    starts,
    mainBegins,
    pairPreparations,
    pairSettlements,
  };
}

function specialistBody(operation: 'thinkgraph.reason' | 'knowgraph.research') {
  return {
    operation,
    request: 'Use the saved specialist.',
    dataAnchors: [],
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'conversation-1',
    sourceCardId: 'builder',
    sourceRunId: 'req_source',
  };
}

describe('fixed saved specialist Card tools', () => {
  it('settles an accepted Main Run once when Hermes fails before a session binding exists', async () => {
    const gateway = new FakeGateway();
    const { base, finishes, starts, mainBegins } = await start(gateway);
    mocks.gateway.mockRejectedValueOnce(new Error('hermes_gateway_unavailable'));

    const response = await fetch(`${base}/shared-chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'conversation-1',
        message: 'Question.',
        clientMessageId: 'msg_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        clientReplyMessageId: 'msg_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain('hermes_gateway_unavailable');
    expect(stream).not.toContain('"state":"running"');
    expect(mainBegins).toHaveLength(1);
    expect(starts).toEqual([]);
    expect(mainBegins[0]).toMatchObject({
      cardId: 'card_main_chat',
      cardRevisionId: 'revision-card_main_chat',
    });
    expect(finishes).toEqual([expect.objectContaining({
      runId: mainBegins[0].runId,
      state: 'failed',
      errorCode: 'hermes_gateway_unavailable',
      errorSummary: 'hermes_gateway_unavailable',
    })]);
  });

  it('rejects a mismatched Python Card revision before profile or session work', async () => {
    const gateway = new FakeGateway();
    const { base, finishes } = await start(gateway);
    mocks.requestRails.mockImplementationOnce(async (_path: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body || '{}'));
      return {
        runId: payload.runId,
        cardRevisionId: 'revision-other',
        hermesTransport: {
          cardIdentity: { cardId: 'card_main_chat' },
          request: {
            runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
            message: payload.message,
          },
        },
      };
    });

    const response = await fetch(`${base}/shared-chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'conversation-1',
        message: 'Question.',
        clientMessageId: 'msg_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        clientReplyMessageId: 'msg_ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'saved_card_preparation_identity_mismatch',
    });
    expect(gateway.calls).toHaveLength(0);
    expect(finishes).toEqual([expect.objectContaining({
      state: 'failed',
      errorCode: 'saved_card_preparation_identity_mismatch',
      errorSummary: 'saved_card_preparation_identity_mismatch',
    })]);
  });

  it('does not rewrite a completed Run when reply persistence fails afterward', async () => {
    const gateway = new FakeGateway();
    gateway.responsesByProfile.set('main', 'Completed answer.');
    mocks.appendReply.mockRejectedValueOnce(new Error('conversation_reply_write_failed'));
    const { base, finishes, starts, mainBegins } = await start(gateway);

    const response = await fetch(`${base}/shared-chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'conversation-1',
        message: 'Question.',
        clientMessageId: 'msg_cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        clientReplyMessageId: 'msg_dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain('conversation_reply_write_failed');
    expect(mainBegins).toHaveLength(1);
    expect(starts).toEqual([expect.objectContaining({
      runId: mainBegins[0].runId,
      correlationId: mainBegins[0].runId,
      submissionId: mainBegins[0].runId,
      hermesSessionRef: 'stored-main',
    })]);
    expect(stream.indexOf('"state":"preparing"')).toBeLessThan(
      stream.indexOf('"state":"running"'),
    );
    expect(finishes).toEqual([expect.objectContaining({
      runId: mainBegins[0].runId,
      state: 'completed',
      finalResult: 'Completed answer.',
      effectiveProvider: 'openai-codex',
      providerApiMode: 'codex_app_server',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      toolCallCount: 0,
    })]);
  });

  it('marks the exact Main Run failed and surfaces settlement failure when completion cannot settle', async () => {
    const gateway = new FakeGateway();
    gateway.responsesByProfile.set('main', 'Completed answer.');
    const { base, finishes, mainBegins } = await start(gateway);
    const normalRails = mocks.requestRails.getMockImplementation()!;
    let rejectFirstSettlement = true;
    mocks.requestRails.mockImplementation(async (path: string, init: RequestInit) => {
      if (path === '/domain/runs/finish' && rejectFirstSettlement) {
        rejectFirstSettlement = false;
        throw new Error('python_settlement_unavailable');
      }
      return normalRails(path, init);
    });

    const response = await fetch(`${base}/shared-chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'conversation-1',
        message: 'Question.',
        clientMessageId: 'msg_77777777-7777-4777-8777-777777777777',
        clientReplyMessageId: 'msg_88888888-8888-4888-8888-888888888888',
      }),
    });
    const stream = await response.text();

    expect(response.status).toBe(200);
    expect(stream).toContain('saved_card_settlement_failed:python_settlement_unavailable');
    expect(mainBegins).toHaveLength(1);
    expect(finishes).toEqual([expect.objectContaining({
      runId: mainBegins[0].runId,
      state: 'failed',
      errorCode: 'saved_card_settlement_failed',
      errorSummary: 'saved_card_settlement_failed:python_settlement_unavailable',
    })]);
    expect(mocks.appendReply).not.toHaveBeenCalled();
  });

  it('runs one automatic saved ThinkGraph child only after an ordinary Main completion', async () => {
    const gateway = new FakeGateway();
    gateway.responsesByProfile.set('main', 'Main answer naming Rocket Lab.');
    gateway.responsesByProfile.set('thinkgraph', JSON.stringify({
      facts: [{
        content: 'Rocket Lab uses Electron.',
        title: 'Rocket Lab and Electron',
        mtype: 'episodic',
        importance: 0.8,
        keywords: ['Rocket Lab', 'Electron'],
        entities: ['Rocket Lab', 'Electron'],
        relations: [{ source: 'Rocket Lab', relation: 'uses', target: 'Electron' }],
        think: { summary: 'Rocket Lab uses Electron.' },
      }],
    }));
    const currentThinkGraphDeck = deck();
    const currentThinkGraphCard = currentThinkGraphDeck.nodes.find(
      (item) => item.id === 'card_thinkgraph',
    )!;
    currentThinkGraphCard._cardRevisionId = 'revision-card_thinkgraph-current';
    const {
      base, begins, finishes, mainBegins, pairPreparations, pairSettlements,
    } = await start(gateway, deck(), currentThinkGraphDeck);
    const response = await fetch(`${base}/shared-chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'conversation-1',
        message: 'Explain Rocket Lab.',
        clientMessageId: 'msg_11111111-1111-4111-8111-111111111111',
        clientReplyMessageId: 'msg_22222222-2222-4222-8222-222222222222',
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain('event: done');
    expect(stream).toContain('Main answer naming Rocket Lab.');
    await vi.waitFor(() => expect(pairSettlements).toHaveLength(1));

    expect(mainBegins).toHaveLength(1);
    expect(pairPreparations).toEqual([expect.objectContaining({
      runId: mainBegins[0].runId,
      cardId: 'card_main_chat',
      userMessage: 'Explain Rocket Lab.',
      mainResponse: 'Main answer naming Rocket Lab.',
    })]);
    expect(begins).toHaveLength(1);
    expect(begins[0]).toMatchObject({
      cardId: 'card_thinkgraph',
      cardRevisionId: 'revision-card_thinkgraph-current',
      senderCardId: 'card_main_chat',
      originatingRunId: mainBegins[0].runId,
      sharedConversation: [],
    });
    expect(begins[0].assignment).toContain('OUTPUT_SCHEMA:');
    expect(pairSettlements[0]).toMatchObject({
      pairReference: 'pair-main-one',
      structuredOutput: expect.stringContaining('Rocket Lab uses Electron.'),
      cardRun: {
        runId: begins[0].runId,
        cardId: 'card_thinkgraph',
        revisionId: 'revision-card_thinkgraph-current',
        profile: 'thinkgraph',
        hermesSessionId: 'live-thinkgraph',
        resolvedProvider: 'openai-codex',
        resolvedModel: 'gpt-5.6-sol',
      },
    });
    expect(finishes.map((item) => [item.runId, item.state])).toEqual([
      [mainBegins[0].runId, 'completed'],
      [begins[0].runId, 'completed'],
    ]);
    const promptSubmissions = gateway.calls.filter(
      ({ method }) => method === 'prompt.submit',
    );
    expect(promptSubmissions).toHaveLength(2);
    expect(promptSubmissions.every(({ params }) => (
      Array.isArray(params.bot_mode_roster)
      && params.bot_mode_roster.length === 0
      && params.expected_profile_capability_fingerprint === '0123456789ab'
    ))).toBe(true);
  });

  it('does not run completed-pair intake for a directly addressed non-Main Card', async () => {
    const gateway = new FakeGateway();
    gateway.responsesByProfile.set('builder', 'Builder answer.');
    const { base, pairPreparations } = await start(gateway);
    const response = await fetch(`${base}/shared-chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'conversation-1',
        message: '@Builder inspect this.',
        targetCardId: 'builder',
        clientMessageId: 'msg_33333333-3333-4333-8333-333333333333',
        clientReplyMessageId: 'msg_44444444-4444-4444-8444-444444444444',
      }),
    });

    expect(response.status).toBe(200);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pairPreparations).toHaveLength(0);
  });

  it('runs the exact saved ThinkGraph Card as a normal child Run without shared-chat writes', async () => {
    const gateway = new FakeGateway();
    const { base, begins, finishes } = await start(gateway);
    const response = await fetch(`${base}/saved-specialists/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
      },
      body: JSON.stringify(specialistBody('thinkgraph.reason')),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({
      ok: true,
      status: 'completed',
      operation: 'thinkgraph.reason',
      targetCardId: 'card_thinkgraph',
      targetRunId: expect.stringMatching(/^req_[0-9a-f]{16}$/),
      targetCardRevisionId: 'revision-card_thinkgraph',
      result: 'actual specialist result',
    });
    expect(begins).toHaveLength(1);
    expect(begins[0]).toMatchObject({
      cardId: 'card_thinkgraph',
      originatingRunId: 'req_source',
      assignment: 'Use the saved specialist.',
      sharedConversation: [],
    });
    expect(begins[0]).not.toHaveProperty('senderCardId');
    expect(finishes).toEqual([expect.objectContaining({
      runId: result.targetRunId,
      state: 'completed',
      finalResult: 'actual specialist result',
    })]);
    const submitted = gateway.calls.find((call) => call.method === 'prompt.submit');
    expect(submitted?.params).toMatchObject({
      session_id: 'live-thinkgraph',
      profile: 'thinkgraph',
      submission_id: result.targetRunId,
      tool_endpoint: 'http://127.0.0.1:9009/mcp',
      tool_authorization: 'Bearer target-run',
    });
    expect(mocks.appendTurn).not.toHaveBeenCalled();
    expect(mocks.appendReply).not.toHaveBeenCalled();
  });

  it('request cancellation interrupts the exact target submission and settles the child failed once', async () => {
    const gateway = new FakeGateway();
    gateway.blockTarget = true;
    const { base, begins, finishes, starts } = await start(gateway);
    const controller = new AbortController();
    const pending = fetch(`${base}/saved-specialists/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
      },
      body: JSON.stringify(specialistBody('thinkgraph.reason')),
      signal: controller.signal,
    });
    await gateway.promptIssued;
    const childRunId = begins[0].runId;
    await vi.waitFor(() => expect(starts).toEqual([expect.objectContaining({
      runId: childRunId,
      correlationId: childRunId,
      submissionId: childRunId,
      hermesSessionRef: 'stored-thinkgraph',
    })]));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(finishes).toHaveLength(1));

    const interrupts = gateway.calls.filter((call) => call.method === 'session.interrupt');
    expect(interrupts).toEqual([
      {
        method: 'session.interrupt',
        params: {
          session_id: 'live-thinkgraph',
          expected_submission_id: childRunId,
        },
      },
    ]);
    expect(finishes).toEqual([expect.objectContaining({
      runId: childRunId,
      state: 'cancelled',
      errorCode: 'hermes_turn_cancelled',
      errorSummary: 'hermes_turn_cancelled',
    })]);
    expect(mocks.appendTurn).not.toHaveBeenCalled();
    expect(mocks.appendReply).not.toHaveBeenCalled();
  });

  it('returns only the bounded failed target result after a begun target failure', async () => {
    const gateway = new FakeGateway();
    gateway.failTarget = true;
    const { base, begins, finishes } = await start(gateway);
    const response = await fetch(`${base}/saved-specialists/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
      },
      body: JSON.stringify(specialistBody('knowgraph.research')),
    });
    const targetRunId = begins[0].runId;

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      status: 'failed',
      operation: 'knowgraph.research',
      targetCardId: 'card_knowgraph',
      targetRunId,
      error: 'target failed honestly',
    });
    expect(finishes).toEqual([expect.objectContaining({
      runId: targetRunId,
      state: 'failed',
      errorCode: 'hermes_session_error',
      errorSummary: 'target failed honestly',
    })]);
  });

  it('marks the exact specialist Run failed when its completion settlement fails', async () => {
    const gateway = new FakeGateway();
    const { base, begins, finishes } = await start(gateway);
    const normalRails = mocks.requestRails.getMockImplementation()!;
    let rejectFirstSettlement = true;
    mocks.requestRails.mockImplementation(async (path: string, init: RequestInit) => {
      if (path === '/domain/runs/finish' && rejectFirstSettlement) {
        rejectFirstSettlement = false;
        throw new Error('python_settlement_unavailable');
      }
      return normalRails(path, init);
    });

    const response = await fetch(`${base}/saved-specialists/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
      },
      body: JSON.stringify(specialistBody('knowgraph.research')),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe('saved_card_settlement_failed:python_settlement_unavailable');
    expect(finishes).toEqual([expect.objectContaining({
      runId: begins[0].runId,
      state: 'failed',
      errorCode: 'saved_card_settlement_failed',
      errorSummary: 'saved_card_settlement_failed:python_settlement_unavailable',
    })]);
  });

  it('persists Hermes structured tool failure identity without a generic turn code', async () => {
    const gateway = new FakeGateway();
    gateway.failTarget = true;
    gateway.structuredFailure = {
      layer: 'tool',
      code: 'tool_execution_failed',
      retryable: false,
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
    };
    const { base, begins, finishes } = await start(gateway);
    const response = await fetch(`${base}/saved-specialists/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
      },
      body: JSON.stringify(specialistBody('knowgraph.research')),
    });

    expect(response.status).toBe(502);
    expect(finishes).toEqual([expect.objectContaining({
      runId: begins[0].runId,
      state: 'failed',
      errorCode: 'tool_execution_failed',
      errorSummary: 'Tool execution failed honestly.',
      effectiveProvider: 'openai-codex',
      providerApiMode: 'codex_app_server',
      model: 'gpt-5.6-sol',
      toolCallCount: 0,
    })]);
  });

  it('keeps source Stop scoped to the exact source submission', async () => {
    const gateway = new FakeGateway();
    const { base } = await start(gateway);
    const response = await fetch(`${base}/shared-chat/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'conversation-1',
        expectedRunId: 'req_source',
        expectedCardId: 'builder',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, runId: 'req_source', state: 'stopping',
    });
    expect(gateway.calls.filter((call) => call.method === 'session.interrupt')).toEqual([{
      method: 'session.interrupt',
      params: {
        session_id: 'live-source',
        expected_submission_id: 'req_source',
      },
    }]);
  });

  it('allows two sequential calls without roster or shadow-lifecycle authorization', async () => {
    const gateway = new FakeGateway();
    const { base, begins, finishes } = await start(gateway);
    const results = [];
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${base}/saved-specialists/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
        },
        body: JSON.stringify(specialistBody('thinkgraph.reason')),
      });
      expect(response.status).toBe(200);
      results.push(await response.json());
    }

    expect(begins).toHaveLength(2);
    expect(finishes).toHaveLength(2);
    expect(new Set(results.map((result) => result.targetRunId)).size).toBe(2);
    expect(begins.every((payload) => !('senderCardId' in payload))).toBe(true);
    expect(mocks.savedRoster).toHaveBeenCalledTimes(2);
    expect(mocks.savedRoster.mock.results.every((entry) => entry.value.length === 0)).toBe(true);
  });

  it('rejects a source Run that is not still running before beginning the target', async () => {
    const gateway = new FakeGateway();
    const { base, begins, finishes } = await start(gateway);
    mocks.requestRails.mockImplementationOnce(async () => ({
      ok: true,
      run: {
        runId: 'req_source', projectId: 'project-1', deckId: 'deck_builder',
        conversationId: 'conversation-1', cardId: 'builder', state: 'completed',
      },
    }));
    const response = await fetch(`${base}/saved-specialists/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
      },
      body: JSON.stringify(specialistBody('knowgraph.research')),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'saved_specialist_source_run_unavailable',
    });
    expect(begins).toHaveLength(0);
    expect(finishes).toHaveLength(0);
    expect(gateway.calls).toHaveLength(0);
  });

  it('rejects a specialist self-call before beginning a child Run', async () => {
    const gateway = new FakeGateway();
    const { base, begins, finishes } = await start(gateway);
    const response = await fetch(`${base}/saved-specialists/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
      },
      body: JSON.stringify({
        ...specialistBody('thinkgraph.reason'),
        sourceCardId: 'card_thinkgraph',
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'saved_specialist_self_call_rejected',
    });
    expect(begins).toHaveLength(0);
    expect(finishes).toHaveLength(0);
    expect(gateway.calls).toHaveLength(0);
  });

  it.each([
    ['thinkgraph.reason', 'card_thinkgraph'],
    ['knowgraph.research', 'card_knowgraph'],
  ] as const)(
    'does not impose hard-coded tool or skill gates on %s',
    async (operation, targetId) => {
      const gateway = new FakeGateway();
      const savedDeck = deck();
      const target = savedDeck.nodes.find((node) => node.id === targetId)!;
      target.runtimeOptions = {
        ...target.runtimeOptions,
        tools: [],
        toolsets: [],
        skills: [],
      };
      const { base, begins, finishes } = await start(gateway, savedDeck);
      const response = await fetch(`${base}/saved-specialists/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
        },
        body: JSON.stringify(specialistBody(operation)),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, status: 'completed' });
      expect(begins).toHaveLength(1);
      expect(finishes).toHaveLength(1);
      expect(gateway.calls.some((call) => call.method === 'prompt.submit')).toBe(true);
    },
  );
});
