import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendReply: vi.fn(),
  appendTurn: vi.fn(),
  getMessages: vi.fn(async () => []),
  listConversations: vi.fn(async () => []),
  getDeck: vi.fn(),
  getProject: vi.fn(async () => ({ ownerUserId: 'owner-1' })),
  requestRails: vi.fn(),
  readCatalog: vi.fn(async () => ({
    state: 'ready', unavailableFamilies: [], toolFailures: [], tools: [],
  })),
  gateway: vi.fn(),
  materializeProfile: vi.fn(async (_request, card) => ({
    model: { provider: 'openai-codex', default: card.runtimeOptions.providerModelId },
  })),
  savedRoster: vi.fn(() => []),
  authorizeTool: vi.fn(() => 'Bearer target-run'),
  resolveToolUrl: vi.fn(() => 'http://127.0.0.1:9009/mcp'),
  authorizeInternal: vi.fn((value) => value === 'test-internal-secret'),
}));

vi.mock('../conversations/store', () => ({
  appendSharedConversationReplyOnce: mocks.appendReply,
  appendSharedConversationTurn: mocks.appendTurn,
  getConversationMessages: mocks.getMessages,
  listConversations: mocks.listConversations,
}));
vi.mock('../decks/store', () => ({
  BUILDER_CARD_ID: 'builder',
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: mocks.getDeck,
}));
vi.mock('../services/agentBuilderStore', () => ({
  getProjectCard: mocks.getProject,
}));
vi.mock('../services/pythonRailsClient', () => ({
  requestPythonRailsJson: mocks.requestRails,
}));
vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  readPythonAgentMcpCatalog: mocks.readCatalog,
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
  internalMcpBridgeSecretAuthorized: mocks.authorizeInternal,
  resolveInternalMcpUrl: mocks.resolveToolUrl,
}));

import {
  mainSessionInternalRoutes,
  mainSessionRoutes,
} from './mainSession.routes';

type GatewayEvent = {
  type: string;
  session_id: string;
  payload: Record<string, unknown>;
};

class FakeGateway {
  calls: Array<{ method: string; params: Record<string, any> }> = [];
  listeners = new Set<(event: GatewayEvent) => void>();
  blockTarget = false;
  failTarget = false;
  promptIssuedResolve!: () => void;
  promptIssued = new Promise<void>((resolve) => { this.promptIssuedResolve = resolve; });

  onEvent(listener: (event: GatewayEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: GatewayEvent) {
    for (const listener of this.listeners) listener(event);
  }

  async request<T>(method: string, params: Record<string, any> = {}): Promise<T> {
    this.calls.push({ method, params: structuredClone(params) });
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
    if (method === 'session.active_list') {
      return { sessions: [{ id: 'live-source', session_key: 'stored-source' }] } as T;
    }
    if (method === 'prompt.submit') {
      this.promptIssuedResolve();
      if (!this.blockTarget) {
        queueMicrotask(() => {
          this.emit({
            type: 'prompt.submission.started',
            session_id: params.session_id,
            payload: { submission_id: params.submission_id },
          });
          this.emit({
            type: this.failTarget ? 'error' : 'message.complete',
            session_id: params.session_id,
            payload: {
              submission_id: params.submission_id,
              ...(this.failTarget
                ? { message: 'target failed honestly' }
                : { status: 'complete', text: 'actual specialist result' }),
            },
          });
        });
      }
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
) {
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
    workspaceRoot: '',
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

async function start(gateway: FakeGateway, savedDeck = deck()) {
  mocks.gateway.mockResolvedValue(gateway);
  mocks.getDeck.mockResolvedValue({ deck: savedDeck });
  const finishes: Array<Record<string, any>> = [];
  const begins: Array<Record<string, any>> = [];
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
      const canonicalId = isThink ? 'engraphis_recall_context' : 'graphiti.add_memory';
      return {
        runId: payload.runId,
        hermesTransport: {
          cardIdentity: { cardId: payload.cardId },
          request: {
            runtime: {
              kind: 'hermes', mode: 'delegate',
              profile: isThink ? 'thinkgraph' : 'knowgraph',
            },
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
    if (path === '/domain/runs/finish') {
      finishes.push(payload);
      return { ok: true, runId: payload.runId };
    }
    throw new Error(`unexpected_rails_path:${path}`);
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId?: string }).userId = 'owner-1';
    next();
  });
  app.use('/main/session', mainSessionInternalRoutes);
  app.use('/main/session', mainSessionRoutes);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/main/session`,
    begins,
    finishes,
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
  it('runs the exact saved ThinkGraph Card as a normal child Run without shared-chat writes', async () => {
    const gateway = new FakeGateway();
    const { base, begins, finishes } = await start(gateway);
    const response = await fetch(`${base}/internal/specialists`, {
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
    const { base, begins, finishes } = await start(gateway);
    const controller = new AbortController();
    const pending = fetch(`${base}/internal/specialists`, {
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
      state: 'failed',
      errorSummary: 'hermes_turn_cancelled',
    })]);
    expect(mocks.appendTurn).not.toHaveBeenCalled();
    expect(mocks.appendReply).not.toHaveBeenCalled();
  });

  it('returns only the bounded failed target receipt after a begun target failure', async () => {
    const gateway = new FakeGateway();
    gateway.failTarget = true;
    const { base, begins, finishes } = await start(gateway);
    const response = await fetch(`${base}/internal/specialists`, {
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
      errorSummary: 'target failed honestly',
    })]);
  });

  it('keeps source Stop scoped to the exact source submission', async () => {
    const gateway = new FakeGateway();
    const { base } = await start(gateway);
    const response = await fetch(`${base}/stop`, {
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
      const response = await fetch(`${base}/internal/specialists`, {
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
    const response = await fetch(`${base}/internal/specialists`, {
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
    const response = await fetch(`${base}/internal/specialists`, {
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
    ['thinkgraph.reason', 'card_thinkgraph', 'tools', [], 'thinkgraph_recall_grant_required'],
    ['knowgraph.research', 'card_knowgraph', 'toolsets', [], 'knowgraph_web_toolset_required'],
    ['knowgraph.research', 'card_knowgraph', 'skills', [], 'knowgraph_grounded_citations_skill_required'],
    ['knowgraph.research', 'card_knowgraph', 'tools', [], 'knowgraph_add_memory_grant_required'],
  ] as const)(
    'requires the saved specialist configuration for %s (%s)',
    async (operation, targetId, field, value, expectedError) => {
      const gateway = new FakeGateway();
      const savedDeck = deck();
      const target = savedDeck.nodes.find((node) => node.id === targetId)!;
      (target.runtimeOptions as Record<string, unknown>)[field] = [...value];
      const { base, begins, finishes } = await start(gateway, savedDeck);
      const response = await fetch(`${base}/internal/specialists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-liquidaity-internal-mcp-secret': 'test-internal-secret',
        },
        body: JSON.stringify(specialistBody(operation)),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ ok: false, error: expectedError });
      expect(begins).toHaveLength(0);
      expect(finishes).toHaveLength(0);
      expect(gateway.calls).toHaveLength(0);
    },
  );
});
