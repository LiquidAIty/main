import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
// Static imports: NodeNext ESM rejects extensionless dynamic import('./coder.routes')
// after the '.routes' infix strip. vitest hoists vi.mock() above these.
import router from './coder.routes';

const deckMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(async () => ({
    deck: {
      nodes: [
        {
          id: 'card_main_chat',
          kind: 'main',
          runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
          runtimeOptions: {},
        },
        {
          id: 'card_local_coder',
          kind: 'agent',
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
        },
      ],
      edges: [],
    } as any,
  })),
}));

const chatSessionMocks = vi.hoisted(() => {
  const usage = {
    providerInputTokens: null,
    providerOutputTokens: null,
    totalCostUsd: null,
    usageAvailable: false,
    usageSource: 'unavailable',
    contextBreakdownJson: '',
  };
  const mocks = {
    getConversationMessages: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    lastCancel: vi.fn(),
    requestHermesCodexAccount: vi.fn(async (profile: string, method: string) => {
      expect(profile).toBe('default');
      if (method === 'account/read') {
        return {
          result: {
            account: { type: 'chatgpt', email: 'owner@example.com', planType: 'pro' },
            requiresOpenaiAuth: true,
          },
          notifications: [{ method: 'account/updated', params: { authMode: 'chatgpt' } }],
        };
      }
      if (method === 'account/rateLimits/read') {
        return {
          result: { rateLimits: { primary: { usedPercent: 12 } } },
          notifications: [],
        };
      }
      return { result: {}, notifications: [] };
    }),
    startHermesTurn: vi.fn(),
    usage,
  };
  mocks.startHermesTurn.mockImplementation(async (_params: unknown, _onEvent: (event: any) => void) => ({
    done: Promise.resolve({ finalText: 'Real assistant reply.', usage }),
    cancel: mocks.lastCancel,
    answer: vi.fn(),
    resolved: {
      cardId: 'card_main_chat',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
    },
  }));
  return mocks;
});

const mcpClientMocks = vi.hoisted(() => ({
  callPythonAgentMcpTool: vi.fn(async () => ({ ok: true })),
  listPythonAgentMcpCatalog: vi.fn(async (): Promise<any[]> => []),
}));

const kanbanMocks = vi.hoisted(() => ({
  runHermesKanbanCardTask: vi.fn(async () => ({
    taskId: 't_native-steward',
    runId: 40,
    snapshot: {
      task: { id: 't_native-steward', status: 'running', result: null },
      runs: [{ id: 40, status: 'running' }],
    },
  })),
  waitForHermesKanbanCardTask: vi.fn(async () => ({
    taskId: 't_native-steward',
    runId: 41,
    snapshot: {
      task: {
        id: 't_native-steward',
        status: 'done',
        result: 'Authentic native Kanban result.',
      },
      runs: [{ id: 41, status: 'done' }],
    },
  })),
}));

const orchestratorMocks = vi.hoisted(() => ({
  dispatchConfiguredRuntime: vi.fn(async (): Promise<any> => ({
    ok: true,
    runId: 'run-mag-one',
    idfId: 'transient:run-mag-one',
    finalResponseText: 'Native Mag One response.',
  })),
  requestPythonRailsJson: vi.fn(async (endpoint: string, init?: RequestInit): Promise<any> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    if (endpoint === '/tools/manifest') return { tools: [] };
    if (endpoint === '/idd/tools/materialize') return { references: body.tools };
    if (endpoint === '/idd/card-editor/materialize') {
      return {
        dictionary: { name: 'LiquidAIty', version: 1, idfFormat: 'mixed-markdown' },
        fields: [{ name: 'provider', label: 'Provider', path: 'provider', control: 'select' }],
        catalogs: { 'configured-models': body.models },
      };
    }
    if (endpoint === '/domain/cards/preview' || endpoint === '/domain/main/preview') {
      const cardId = endpoint === '/domain/main/preview' ? 'card_main_chat' : body.cardId;
      return {
        projectId: body.projectId,
        deckId: body.deckId,
        cardRevisionId: `revision:${cardId}`,
        exactIdf: `# IDF\n\n${body.assignment}`,
        runtimeOwner: 'hermes',
        cardContext: {
          cardId,
          title: cardId === 'card_main_chat' ? 'Main' : 'Worker',
          runtime: cardId === 'card_main_chat'
            ? { kind: 'hermes', mode: 'main', profile: 'default' }
            : { kind: 'hermes', mode: 'delegate', profile: 'worker' },
          provider: 'openai',
          modelKey: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
          accessMode: 'chatgpt-account',
          tools: [],
        },
      };
    }
    if (endpoint === '/domain/runs/begin') {
      const autoKanban = body.cardId === 'card_hermes_steward';
      const coderCard = body.cardId === 'card_local_coder';
      return {
        runId: body.runId,
        cardRevisionId: body.cardRevisionId,
        runtimeOwner: 'hermes',
        hermesTransport: {
          systemPrompt: 'Saved prompt',
          message: body.exactIdf,
          cardContext: {
            cardId: body.cardId,
            title: body.cardId === 'card_main_chat' ? 'Main' : coderCard ? 'Coder' : 'Hermes steward',
            runtime: body.cardId === 'card_main_chat'
              ? { kind: 'hermes', mode: 'main', profile: 'default' }
              : coderCard
                ? { kind: 'hermes', mode: 'delegate', profile: 'coder' }
                : { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
            provider: 'openai',
            modelKey: 'gpt-5.6-luna',
            providerModelId: 'gpt-5.6-luna',
            accessMode: 'chatgpt-account',
            tools: autoKanban ? ['graphiti.search_nodes'] : coderCard ? ['cbm.search_graph'] : [],
            nativeTools: autoKanban ? ['memory'] : [],
            skills: autoKanban ? ['documentation'] : [],
            toolsets: coderCard ? ['file', 'terminal'] : [],
            mcpConnectionIds: [],
          },
          nativeHermesDelegates: [],
        },
      };
    }
    if (endpoint === '/domain/runs/finish') {
      return { receipt: { runId: body.runId, state: body.state } };
    }
    if (endpoint === '/domain/idfs/save') {
      return {
        ok: true,
        savedIdf: {
          idfId: '11111111-1111-4111-8111-111111111111',
          revision: 1,
          projectId: body.projectId,
          deckId: body.deckId,
          targetCardId: body.cardId,
          targetCardRevisionId: body.cardRevisionId,
          contentMarkdown: body.exactIdf,
          contentSha256: 'a'.repeat(64),
        },
      };
    }
    if (endpoint.startsWith('/domain/idfs/project-1/revision/')) {
      return {
        ok: true,
        savedIdf: {
          idfId: '11111111-1111-4111-8111-111111111111',
          revision: 1,
          contentMarkdown: '# IDF\n\nRepeatable input.',
        },
        inspection: { assignment: 'Repeatable input.' },
      };
    }
    if (endpoint.startsWith('/domain/idfs/project-1/deck_builder')) {
      return {
        ok: true,
        projectId: 'project-1',
        deckId: 'deck_builder',
        savedIdfs: [{
          idfId: '11111111-1111-4111-8111-111111111111',
          revision: 1,
          targetCardId: 'card_worker',
        }],
      };
    }
    return {};
  }),
}));

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckMocks.getDeckDocument,
}));

vi.mock('../conversations/store', () => ({
  getConversationMessages: chatSessionMocks.getConversationMessages,
  listConversations: chatSessionMocks.listConversations,
}));

vi.mock('../hermes/mainAdapter', () => ({
  deriveHermesSessionKey: (projectId: string, conversationId: string, cardId: string) => `${projectId}:${conversationId}:${cardId}`,
  providerForHermes: (provider: string, accessMode?: string) => (
    provider === 'openai' && accessMode === 'chatgpt-account'
      ? 'openai-codex'
      : provider
  ),
  requestHermesCodexAccount: chatSessionMocks.requestHermesCodexAccount,
  startHermesTurn: chatSessionMocks.startHermesTurn,
}));

vi.mock('./hermesKanban.routes', () => ({
  runHermesKanbanCardTask: kanbanMocks.runHermesKanbanCardTask,
  waitForHermesKanbanCardTask: kanbanMocks.waitForHermesKanbanCardTask,
}));

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  callPythonAgentMcpTool: mcpClientMocks.callPythonAgentMcpTool,
  listPythonAgentMcpCatalog: mcpClientMocks.listPythonAgentMcpCatalog,
}));

vi.mock('../services/autogen/pythonRailsClient', () => orchestratorMocks);

vi.mock('../db/pool', () => ({
  pool: { query: dbMocks.query },
}));

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use('/api/coder', router);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/coder` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('coder routes', () => {
  it('reads the managed ChatGPT account and rate limits through Hermes transport', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/main/codex-account?projectId=project-1`);
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        accessMode: 'chatgpt-account',
        account: { type: 'chatgpt', email: 'owner@example.com', planType: 'pro' },
        rateLimits: { rateLimits: { primary: { usedPercent: 12 } } },
      });
      expect(chatSessionMocks.requestHermesCodexAccount).toHaveBeenCalledWith(
        'default',
        'account/read',
        { refreshToken: false },
      );
    } finally {
      await closeServer(server);
    }
  });
  it('passes factual live contracts to the one IDD and returns its current vocabulary', async () => {
    mcpClientMocks.listPythonAgentMcpCatalog.mockResolvedValueOnce([{
      name: 'cbm.search_graph',
      title: 'Search graph',
      description: 'Search CodeGraph.',
      sourceId: 'cbm',
      namespace: 'cbm',
      nativeName: 'search_graph',
      connectionKind: 'external-mcp',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    }]);
    orchestratorMocks.requestPythonRailsJson.mockResolvedValueOnce({
      tools: [{
        name: 'calculator',
        nativeName: 'calculator',
        kind: 'tool',
        sourceId: 'python_runtime',
        namespace: 'python',
        connectionKind: 'private-runtime',
        description: 'Evaluate bounded arithmetic.',
        inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
      }],
    }).mockResolvedValueOnce({
      references: [
        {
          canonicalId: 'cbm.search_graph', kind: 'tool', namespace: 'cbm',
          sourceIds: ['cbm'], displayName: 'Search graph', shortDescription: 'Search CodeGraph.',
          availability: 'available', contracts: [{
            sourceId: 'cbm', nativeName: 'search_graph', connectionKind: 'external-mcp',
            available: true, description: 'Search CodeGraph.',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            annotations: { readOnlyHint: true },
          }],
        },
        {
          canonicalId: 'calculator', kind: 'tool', namespace: 'python',
          sourceIds: ['python_runtime'], displayName: 'Calculator',
          shortDescription: 'Evaluate bounded arithmetic.', availability: 'available',
          contracts: [{
            sourceId: 'python_runtime', nativeName: 'calculator', connectionKind: 'private-runtime',
            available: true, description: 'Evaluate bounded arithmetic.',
            inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
          }],
        },
      ],
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/input-data-dictionary/tools?selectedIds=calculator,missing.tool`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.references).toHaveLength(2);
      expect(payload.references).toEqual(expect.arrayContaining([
        expect.objectContaining({
          canonicalId: 'cbm.search_graph',
          kind: 'tool',
          sourceIds: ['cbm'],
          contracts: [expect.objectContaining({ annotations: { readOnlyHint: true } })],
        }),
        expect.objectContaining({
          canonicalId: 'calculator',
          kind: 'tool',
          displayName: 'Calculator',
          sourceIds: ['python_runtime'],
        }),
      ]));
      expect(payload.selectedKnownReferences.map((entry: any) => entry.canonicalId)).toEqual(['calculator']);
      expect(payload.unresolvedSelectedIds).toEqual(['missing.tool']);
      const materializeCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/idd/tools/materialize',
      );
      const materializeBody = JSON.parse(String(materializeCall?.[1]?.body || '{}'));
      expect(materializeBody.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'cbm.search_graph', annotations: { readOnlyHint: true } }),
        expect.objectContaining({ name: 'calculator', sourceId: 'python_runtime' }),
      ]));
    } finally {
      await closeServer(server);
    }
  });

  it('materializes configured card-editor choices through the literal IDD boundary', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/input-data-dictionary/card-editor`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: true,
        dictionary: { name: 'LiquidAIty', version: 1 },
        fields: [expect.objectContaining({ name: 'provider' })],
      });
      expect(payload.catalogs['configured-models']).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: 'openai', key: 'gpt-5.6-luna' }),
        expect.objectContaining({ provider: 'openrouter' }),
      ]));
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith(
        '/idd/card-editor/materialize',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      await closeServer(server);
    }
  });

  it('returns an empty history only for a successful empty read', async () => {
    chatSessionMocks.getConversationMessages.mockResolvedValueOnce([]);
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, messages: [] });
    } finally {
      await closeServer(server);
    }
  });

  it('returns a typed failure when conversation persistence cannot be read', async () => {
    chatSessionMocks.getConversationMessages.mockRejectedValueOnce(
      new Error('database_connection_lost'),
    );
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'conversation_history_read_failed',
        messages: [],
      });
    } finally {
      await closeServer(server);
    }
  });

  it('forwards a transient assignment to Python for configured-card preview', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_worker',
          correlationId: 'corr-1',
          conversationId: 'conv-1',
          parentRunId: 'req_1234abcd',
          input: 'Use the stored handoff.',
          action: 'materialize',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          status: 'previewed',
          invocation: {
            cardRevisionId: 'revision:card_worker',
            exactIdf: '# IDF\n\nUse the stored handoff.',
          },
        },
      });
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith(
        '/domain/cards/preview',
        expect.objectContaining({ body: expect.stringContaining('Use the stored handoff.') }),
      );
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('executes only the exact Inspector invocation accepted by Python rails', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
    const exactIdf = '\n# IDF\n\nUse saved Main.\n ';
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_main_chat',
          correlationId: 'corr-main-1',
          conversationId: 'main',
          input: 'Use saved Main.',
          action: 'execute',
          exactIdf,
          cardRevisionId: 'revision:card_main_chat',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          status: 'completed',
          output: 'Real assistant reply.',
          cardRevisionId: 'revision:card_main_chat',
          receipt: { runId: 'corr-main-1', state: 'completed' },
        },
      });
      expect(chatSessionMocks.startHermesTurn).toHaveBeenCalledTimes(1);
      expect(chatSessionMocks.startHermesTurn.mock.calls[0][0]).toMatchObject({
        message: exactIdf,
      });
      const beginCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      );
      expect(JSON.parse(String(beginCall?.[1]?.body || '{}')).exactIdf).toBe(exactIdf);
    } finally {
      await closeServer(server);
    }
  });

  it('routes a saved auto-kanban Hermes card through the native Kanban owner', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
    kanbanMocks.runHermesKanbanCardTask.mockClear();
    kanbanMocks.waitForHermesKanbanCardTask.mockClear();
    const exactIdf = [
      '# LiquidAIty IDF',
      '',
      'profile: liquidaity-hermes-steward',
      'nativeTools: memory',
      'tools: graphiti.search_nodes',
      '',
      'Prepare one bounded documentation result.',
    ].join('\n');
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_hermes_steward',
          correlationId: 'corr-steward-1',
          conversationId: 'conversation-main-1',
          originatingRunId: 'run-main-parent-1',
          senderCardId: 'card_main_chat',
          input: 'Prepare one bounded documentation result.',
          action: 'execute',
          exactIdf,
          cardRevisionId: 'revision:card_hermes_steward',
        }),
      });
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(payload).toMatchObject({
        ok: true,
        result: {
          status: 'completed',
          output: 'Authentic native Kanban result.',
          runtimeOwner: 'hermes',
          transport: {
            threadId: 't_native-steward',
            turnId: '41',
            planType: 'hermes-auto-kanban',
            nativeTaskId: 't_native-steward',
            nativeRunId: 41,
            nativeStatus: 'done',
          },
          receipt: { runId: 'corr-steward-1', state: 'completed' },
        },
      });
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      expect(kanbanMocks.runHermesKanbanCardTask).toHaveBeenCalledWith({
        projectId: 'project-1',
        deckId: 'deck_builder',
        correlationId: 'corr-steward-1',
        conversationId: 'conversation-main-1',
        parentRunId: 'run-main-parent-1',
        cardId: 'card_hermes_steward',
        title: 'Hermes steward',
        prompt: 'Saved prompt',
        profile: 'liquidaity-hermes-steward',
        provider: 'openai-codex',
        providerModelId: 'gpt-5.6-luna',
        skills: ['documentation'],
        input: exactIdf,
      });
      expect(kanbanMocks.waitForHermesKanbanCardTask).toHaveBeenCalledWith(
        'liquidaity-hermes-steward',
        't_native-steward',
      );
      const finishCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint, init]) => endpoint === '/domain/runs/finish'
          && JSON.parse(String(init?.body || '{}')).state === 'completed',
      );
      expect(JSON.parse(String(finishCall?.[1]?.body || '{}'))).toMatchObject({
        runId: 'corr-steward-1',
        providerThreadRef: 't_native-steward',
        providerTurnRef: '41',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('runs the preserved Coder Card through its Hermes profile and exact IDF', async () => {
    chatSessionMocks.startHermesTurn.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockClear();
    const exactIdf = '# IDF\n\nInspect the bounded code slice.';
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_local_coder',
          senderCardId: 'card_main_chat',
          correlationId: 'corr-coder-1',
          conversationId: 'main',
          input: 'Inspect the bounded code slice.',
          action: 'execute',
          exactIdf,
          cardRevisionId: 'revision:card_local_coder',
        }),
      });

      expect(response.status).toBe(200);
      expect(chatSessionMocks.startHermesTurn).toHaveBeenCalledTimes(1);
      expect(chatSessionMocks.startHermesTurn.mock.calls[0]?.[0]).toMatchObject({
        cardId: 'card_local_coder',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
        tools: ['cbm.search_graph'],
        toolsets: ['file', 'terminal'],
        message: exactIdf,
      });
      expect(orchestratorMocks.dispatchConfiguredRuntime).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          cardId: 'card_local_coder',
          runtimeOwner: 'hermes',
          output: 'Real assistant reply.',
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  it('sends the exact Python-prepared outer mission to native Mag One', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockClear();
    const nativeRuntimeRequest = {
      session: {
        sessionId: 'deck_builder:card_magentic:corr-mag-1',
        projectId: 'project-1',
        turnId: 'corr-mag-1',
        runId: 'corr-mag-1',
        route: 'deck_runtime',
        orchestrator: 'magentic_one',
        modelProvider: 'openrouter',
        modelKey: 'deepseek/deepseek-v4-pro-0813',
        providerModelId: 'deepseek/deepseek-v4-pro-0813',
        startedAt: '2026-08-17T00:00:00Z',
      },
      idf: {
        idfId: 'transient:corr-mag-1',
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'main',
        runId: 'corr-mag-1',
        originatingCardId: 'card_magentic',
        version: 1,
        systemText: 'Saved Mag One prompt',
        userText: 'Coordinate the mission.',
        cardContext: {},
        dynamicContextMarkdown: '',
        nativeReferences: [],
        modelInputMarkdown: '# IDF\n\nCoordinate the mission.',
        contentMarkdown: '# IDF\n\nCoordinate the mission.',
        contentSha256: 'a'.repeat(64),
        createdAt: '2026-08-17T00:00:00Z',
      },
      cardRuntime: {},
    };
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/begin');
      return {
        runtimeOwner: 'mag_one',
        cardRevisionId: 'revision:card_magentic',
        nativeRuntimeRequest,
      };
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_magentic',
          correlationId: 'corr-mag-1',
          conversationId: 'main',
          input: 'Coordinate the mission.',
          action: 'execute',
          exactIdf: '# IDF\n\nCoordinate the mission.',
          cardRevisionId: 'revision:card_magentic',
        }),
      });
      expect(response.status).toBe(200);
      expect(orchestratorMocks.dispatchConfiguredRuntime).toHaveBeenCalledWith(nativeRuntimeRequest);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runtimeOwner: 'mag_one',
          output: 'Native Mag One response.',
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  it('forwards explicit saved-IDF writes and reads only to Python rails', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const exactIdf = '\n# IDF\n\nRepeatable input.\n ';
    const { server, baseUrl } = await createApiServer();
    try {
      const saveResponse = await fetch(`${baseUrl}/mcp-bridge/idfs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_worker',
          assignment: 'Repeatable input.',
          cardRevisionId: 'revision:card_worker',
          exactIdf,
        }),
      });
      expect(saveResponse.status).toBe(200);
      await expect(saveResponse.json()).resolves.toMatchObject({
        ok: true,
        savedIdf: { revision: 1, targetCardId: 'card_worker' },
      });
      const saveCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/domain/idfs/save',
      );
      expect(JSON.parse(String(saveCall?.[1]?.body || '{}')).exactIdf).toBe(exactIdf);

      const listResponse = await fetch(
        `${baseUrl}/mcp-bridge/idfs?projectId=project-1&deckId=deck_builder&cardId=card_worker`,
      );
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toMatchObject({
        savedIdfs: [{ revision: 1, targetCardId: 'card_worker' }],
      });
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith(
        '/domain/idfs/project-1/deck_builder?cardId=card_worker',
        { method: 'GET' },
      );
    } finally {
      await closeServer(server);
    }
  });

  it('resolves the OAuth identity grant and saved Main card without loading its runtime grants', async () => {
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        grant_id: '70f63a4d-1a67-4dcc-a8ee-cce267572747',
        user_id: 'user-1',
        project_id: '20ac92da-01fd-4cf6-97cc-0672421e751a',
        project_name: 'Main Chat',
      }],
    });
    deckMocks.getDeckDocument.mockResolvedValueOnce({
      deck: {
        nodes: [{
          id: 'card_main_chat',
          runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
        }],
        edges: [],
      },
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/external_main_context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issuer: 'https://tenant.auth0.com/', subject: 'auth0|jeremiah' }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        context: {
          projectId: '20ac92da-01fd-4cf6-97cc-0672421e751a',
          deckId: 'deck_builder',
          conversationId: 'external-mcp:70f63a4d-1a67-4dcc-a8ee-cce267572747',
          mainCardId: 'card_main_chat',
        },
      });
      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.stringContaining('p.owner_user_id = g.user_id'),
        ['https://tenant.auth0.com', 'auth0|jeremiah'],
      );
    } finally {
      await closeServer(server);
    }
  });

  describe('/main/session/chat', () => {
    it('adds the saved invoking Card identity to native tool results already on the SSE stream', async () => {
      chatSessionMocks.startHermesTurn.mockImplementationOnce(async (_params: unknown, onEvent: (event: any) => void) => {
        onEvent({
          kind: 'tool_result',
          toolName: 'cbm.search_graph',
          toolUseId: 'tool-1',
          output: '{"results":[]}',
          isError: false,
        });
        return {
          done: Promise.resolve({ finalText: 'Done.', usage: chatSessionMocks.usage }),
          cancel: chatSessionMocks.lastCancel,
          answer: vi.fn(),
          resolved: {
            cardId: 'card_main_chat',
            provider: 'openai',
            modelKey: 'gpt-5.6-luna',
            providerModelId: 'gpt-5.6-luna',
          },
        };
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'attention', message: 'inspect' }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('event: tool_result');
        expect(body).toContain('"invokingCardId":"card_main_chat"');
      } finally {
        await closeServer(server);
      }
    });

    it('uses Python-owned prompt-free run lifecycle without a post-chat graph handoff', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.startHermesTurn.mockClear();
      chatSessionMocks.lastCancel.mockClear();
      mcpClientMocks.callPythonAgentMcpTool.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'main', message: 'hello' }),
        });
        expect(response.status).toBe(200);
        // Drain the SSE stream to completion.
        await response.text();

        expect(chatSessionMocks.startHermesTurn).toHaveBeenCalledTimes(1);
        expect(chatSessionMocks.startHermesTurn.mock.calls[0][0]).toMatchObject({
          sessionKey: 'project-1:main:card_main_chat',
          message: '# IDF\n\nhello',
          runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
        });
        const railsCalls = orchestratorMocks.requestPythonRailsJson.mock.calls;
        expect(railsCalls.map(([endpoint]) => endpoint)).toEqual([
          '/domain/main/preview',
          '/domain/runs/begin',
          '/domain/runs/finish',
        ]);
        expect(railsCalls[1]?.[1]?.body).toContain('"exactIdf":"# IDF\\n\\nhello"');
        expect(railsCalls[2]?.[1]?.body).toContain('"state":"completed"');

        // The obsolete post-chat pair handoff must never fire from this route.
        expect(mcpClientMocks.callPythonAgentMcpTool).not.toHaveBeenCalled();
        expect(chatSessionMocks.lastCancel).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('ignores late gRPC events after the SSE turn has completed', async () => {
      chatSessionMocks.lastCancel.mockClear();
      chatSessionMocks.startHermesTurn.mockImplementationOnce(async (_params: unknown, onEvent: (event: any) => void) => {
        const done = Promise.resolve({ finalText: 'Finished before late event.', usage: chatSessionMocks.usage });
        void done.then(() => {
          setTimeout(() => onEvent({ kind: 'error', message: 'late grpc reset' }), 0);
        });
        return {
          done,
          cancel: chatSessionMocks.lastCancel,
          answer: vi.fn(),
          resolved: {
            cardId: 'card_main_chat',
            provider: 'openai',
            modelKey: 'gpt-5.6-luna',
            providerModelId: 'gpt-5.6-luna',
          },
        };
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'late', message: 'hello' }),
        });
        const body = await response.text();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(response.status).toBe(200);
        expect(body).toContain('event: end');
        expect(body).not.toContain('late grpc reset');
        expect(chatSessionMocks.lastCancel).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('emits a safe, correlated SSE error when the Harness turn fails', async () => {
      chatSessionMocks.startHermesTurn.mockRejectedValueOnce(new Error('provider credential leaked'));
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'failure', message: 'hello' }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('event: error');
        expect(body).toContain('harness_turn_failed');
        expect(body).toContain('"correlationId":"req_');
        expect(body).toContain('/api/coder/main/session/chat');
        expect(body).not.toContain('provider credential leaked');
      } finally {
        await closeServer(server);
      }
    });

    it('persists and exposes an empty Codex app-server completion as its exact failure', async () => {
      chatSessionMocks.startHermesTurn.mockRejectedValueOnce(
        new Error('codex_app_server_empty_completion'),
      );
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1',
            conversationId: 'empty-codex',
            message: 'hello',
          }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('event: error');
        expect(body).toContain('codex_app_server_empty_completion');
        expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith(
          '/domain/runs/finish',
          expect.objectContaining({
            body: expect.stringContaining('"errorCode":"codex_app_server_empty_completion"'),
          }),
        );
      } finally {
        await closeServer(server);
      }
    });

    it('does not call the model when Python rails cannot begin the run', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson
        .mockImplementationOnce(railsImplementation)
        .mockRejectedValueOnce(new Error('database unavailable'));
      chatSessionMocks.startHermesTurn.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'no-db', message: 'hello' }),
        });
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
          ok: false,
          error: 'main_domain_preparation_failed',
          correlationId: expect.stringMatching(/^req_/),
        });
        expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('withholds the done event when Python run completion fails', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson
        .mockImplementationOnce(railsImplementation)
        .mockImplementationOnce(railsImplementation)
        .mockRejectedValueOnce(new Error('write failed'));
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'result-db-failure', message: 'hello' }),
        });
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).toContain('harness_run_persistence_failed');
        expect(body).not.toContain('event: done');
        expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenLastCalledWith(
          '/domain/runs/finish',
          expect.objectContaining({ body: expect.stringContaining('"state":"failed"') }),
        );
      } finally {
        await closeServer(server);
      }
    });
  });

});
