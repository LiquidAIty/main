import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
// Static imports: NodeNext ESM rejects extensionless dynamic import('./coder.routes')
// after the '.routes' infix strip. vitest hoists vi.mock() above these.
import router from './coder.routes';

const planningMocks = vi.hoisted(() => ({
  packet: {
    id: 'packet-prepared',
    projectId: 'project-1',
    repoPath: 'C:\\Projects\\main',
    objective: 'Run the localcoder.',
    planExcerpt: 'Living plan.',
    contextSummary: 'Real context assembled.',
    codeAnchors: ['apps/backend/src/routes/coder.routes.ts'],
    cbmQueries: ['search_graph coder'],
    guardrails: ['No fake success.'],
    allowedFiles: ['apps/backend/src/routes/coder.routes.ts'],
    forbiddenWork: ['No specs/.'],
    proofRequired: ['Compile.'],
    reportFormat: 'Make a bounded task list and return a task-by-task CoderReport.',
    stopConditions: ['Stop after one report.'],
    writeMode: 'edit',
  },
}));

const runtimeMocks = vi.hoisted(() => ({
  runConfiguredCard: vi.fn(async () => ({
    status: 'completed' as const,
    output: 'ok',
  })),
  resolveCardModelStrict: vi.fn(() => ({
    provider: 'openrouter',
    providerModelId: 'z-ai/glm-5.2',
  })),
  resolveCardTools: vi.fn((card: { tools?: unknown } | null) => (
    Array.isArray(card?.tools) ? card.tools.map(String) : []
  )),
}));

const deckMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(async () => ({
    deck: {
      nodes: [
        {
          id: 'card_main_chat',
          kind: 'main',
          runtimeType: 'main_chat',
          runtimeOptions: { binding: 'main_chat' },
        },
        {
          id: 'card_local_coder',
          kind: 'agent',
          runtimeType: 'local_coder',
          runtimeBinding: 'local_coder',
        },
      ],
      edges: [],
    } as any,
  })),
}));

const cbmScopeMocks = vi.hoisted(() => ({
  runLocalCoderCbmScopeGate: vi.fn(async () => ({
    sourceRoot: 'C:/Projects/main',
    scopeStatus: 'ok',
    editAllowed: true,
    blockedReason: '',
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
    beginConversationRun: vi.fn(async (input: { runId: string }) => ({
      runId: input.runId,
      userMessage: { messageId: 'user-msg-1' },
    })),
    markConversationRunRunning: vi.fn(async () => undefined),
    completeConversationRun: vi.fn(async () => ({ resultMessageId: 'assistant-msg-1' })),
    failConversationRun: vi.fn(async () => undefined),
    cancelConversationRun: vi.fn(async () => undefined),
    getConversationMessages: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    lastCancel: vi.fn(),
    startGrpcTurn: vi.fn(),
    resolveMainChatRuntimeConfig: vi.fn(),
    usage,
  };
  mocks.startGrpcTurn.mockImplementation(async (_params: unknown, _onEvent: (event: any) => void) => ({
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
  listPythonAgentMcpCatalog: vi.fn(async () => []),
}));

const orchestratorMocks = vi.hoisted(() => ({
  fetchAgentCardContext: vi.fn(async () => ({ ok: true })),
  requestPythonRailsJson: vi.fn(async (): Promise<any> => ({ tools: [] })),
}));

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../services/graphContext/cbmScopeGate', () => ({
  runLocalCoderCbmScopeGate: cbmScopeMocks.runLocalCoderCbmScopeGate,
}));

vi.mock('../cards/runtime', () => ({
  runConfiguredCard: runtimeMocks.runConfiguredCard,
  resolveCardModelStrict: runtimeMocks.resolveCardModelStrict,
  resolveCardTools: runtimeMocks.resolveCardTools,
}));

vi.mock('../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckMocks.getDeckDocument,
}));

vi.mock('../conversations/store', () => ({
  beginConversationRun: chatSessionMocks.beginConversationRun,
  markConversationRunRunning: chatSessionMocks.markConversationRunRunning,
  completeConversationRun: chatSessionMocks.completeConversationRun,
  failConversationRun: chatSessionMocks.failConversationRun,
  cancelConversationRun: chatSessionMocks.cancelConversationRun,
  getConversationMessages: chatSessionMocks.getConversationMessages,
  listConversations: chatSessionMocks.listConversations,
}));

vi.mock('../coder/openclaude/session/grpcChatClient', () => ({
  deriveSessionId: (projectId: string, conversationId: string) => `${projectId}:${conversationId}`,
  resolveMainChatRuntimeConfig: chatSessionMocks.resolveMainChatRuntimeConfig,
  startGrpcTurn: chatSessionMocks.startGrpcTurn,
}));

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  callPythonAgentMcpTool: mcpClientMocks.callPythonAgentMcpTool,
  listPythonAgentMcpCatalog: mcpClientMocks.listPythonAgentMcpCatalog,
}));

vi.mock('../services/autogen/autogenOrchestratorClient', () => orchestratorMocks);

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
  // Force a deterministic blocked state via a broken explicit command so these
  // route tests never spawn a real coder process, regardless of whether the
  // vendored runtime is built or API keys are exported on the test machine.
  const BROKEN_COMMAND = 'node C:/liquidaity/nonexistent/openclaude.mjs';

  it('projects both Python-owned tool catalogs without TypeScript assignment policy', async () => {
    mcpClientMocks.listPythonAgentMcpCatalog.mockResolvedValueOnce([
      {
        name: 'run_coder_subagent',
        capability: {
          runtimeCompatibility: ['harness_mcp'],
          assignableRuntimeBindings: ['main_chat'],
          assignableRuntimeTypes: [],
          cardAssignable: true,
        },
      },
    ] as any);
    orchestratorMocks.requestPythonRailsJson.mockResolvedValueOnce({
      tools: [
        {
          id: 'run_local_coder',
          displayName: 'Local Coder',
          description: 'Run the saved Coder.',
          capability: {
            runtimeCompatibility: ['autogen'],
            assignableRuntimeBindings: ['local_coder'],
            assignableRuntimeTypes: ['local_coder'],
            cardAssignable: true,
          },
        },
      ],
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/tool-library`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.tools).toEqual([
        expect.objectContaining({
          name: 'run_coder_subagent',
          capability: expect.objectContaining({ assignableRuntimeBindings: ['main_chat'] }),
        }),
        expect.objectContaining({
          name: 'run_local_coder',
          title: 'Local Coder',
          capability: expect.objectContaining({ assignableRuntimeTypes: ['local_coder'] }),
        }),
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it('returns an empty history only for a successful empty read', async () => {
    chatSessionMocks.getConversationMessages.mockResolvedValueOnce([]);
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/openclaude/session/history?projectId=project-1&conversationId=main`,
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
        `${baseUrl}/openclaude/session/history?projectId=project-1&conversationId=main`,
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

  it('reports Coder idle from the live session owner instead of AgentGraph history', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/coder_status`, {
        method: 'POST',
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        state: 'idle',
        running: false,
        liveSessions: [],
        authority: 'openclaude_console_session_manager',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('forwards only AgentGraph assignment identities on the configured-card bridge', async () => {
    runtimeMocks.runConfiguredCard.mockClear();
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
          instructionId: 'instruction:one',
          senderCardId: 'card_main_chat',
          parentRunId: 'req_1234abcd',
          input: 'Use the stored handoff.',
        }),
      });
      expect(response.status).toBe(200);
      expect(runtimeMocks.runConfiguredCard).toHaveBeenCalledWith({
        projectId: 'project-1',
        deckId: 'deck_builder',
        cardId: 'card_worker',
        correlationId: 'corr-1',
        conversationId: 'conv-1',
        instructionId: 'instruction:one',
        senderCardId: 'card_main_chat',
        parentRunId: 'req_1234abcd',
        input: 'Use the stored handoff.',
      });
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
          runtimeOptions: { binding: 'main_chat' },
        }],
        edges: [],
      },
    });
    const runtimeResolutionCallsBefore =
      chatSessionMocks.resolveMainChatRuntimeConfig.mock.calls.length;
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
      expect(chatSessionMocks.resolveMainChatRuntimeConfig.mock.calls.length)
        .toBe(runtimeResolutionCallsBefore);
    } finally {
      await closeServer(server);
    }
  });

  async function withBrokenRuntime<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env.LOCALCODER_COMMAND;
    process.env.LOCALCODER_COMMAND = BROKEN_COMMAND;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.LOCALCODER_COMMAND;
      else process.env.LOCALCODER_COMMAND = previous;
    }
  }

  it('fails closed on the headless LocalCoder status route when nothing runnable', async () => {
    await withBrokenRuntime(async () => {
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/localcoder/status`);
        const payload = await response.json();
        expect(response.status).toBe(424);
        expect(payload.ok).toBe(false);
        expect(payload.inspection.ready).toBe(false);
        expect(payload.inspection.missing.join(' ')).toContain(
          'localcoder_explicit_command_script_not_found',
        );
      } finally {
        await closeServer(server);
      }
    });
  });

  it('returns an exact blocked CoderReport from the LocalCoder run route without launching a coder', async () => {
    await withBrokenRuntime(async () => {
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/localcoder/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'packet-route',
            projectId: 'project-1',
            repoPath: process.cwd(),
            objective: 'Run LocalCoder.',
            planExcerpt: 'First loop.',
            contextSummary: 'Route proof.',
            codeAnchors: ['apps/backend/src/coder'],
            cbmQueries: ['search_graph LocalCoder'],
            guardrails: ['No fake success.'],
            allowedFiles: ['apps/backend/src/coder/**'],
            forbiddenWork: ['No specs/.'],
            proofRequired: ['Compile.'],
            reportFormat: 'CoderReport JSON',
            stopConditions: ['Stop after one job.'],
          }),
        });
        const payload = await response.json();
        expect(response.status).toBe(424);
        expect(payload.ok).toBe(false);
        expect(payload.report.status).toBe('blocked');
        expect(payload.report.coderPacketId).toBe('packet-route');
        expect(payload.report.blockers.join(' ')).toContain(
          'localcoder_explicit_command_script_not_found',
        );
        expect(payload.cbmScopeGate.editAllowed).toBe(true);
      } finally {
        await closeServer(server);
      }
    });
  });

  it('blocks the LocalCoder route when the structural edit-scope is invalid', async () => {
    cbmScopeMocks.runLocalCoderCbmScopeGate.mockResolvedValueOnce({
      sourceRoot: 'C:/Projects/main',
      scopeStatus: 'blocked',
      editAllowed: false,
      blockedReason: 'edit_scope_root_not_found: /nonexistent',
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/localcoder/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...planningMocks.packet,
          id: 'packet-scope-blocked',
          writeMode: 'read-only',
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(424);
      expect(payload.ok).toBe(false);
      expect(payload.report.status).toBe('blocked');
      expect(payload.report.blockers.join(' ')).toContain('edit_scope_root_not_found');
      expect(payload.cbmScopeGate.editAllowed).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  describe('/openclaude/session/chat', () => {
    it('persists one durable conversation run without a post-chat graph handoff', async () => {
      chatSessionMocks.beginConversationRun.mockClear();
      chatSessionMocks.markConversationRunRunning.mockClear();
      chatSessionMocks.completeConversationRun.mockClear();
      chatSessionMocks.startGrpcTurn.mockClear();
      chatSessionMocks.lastCancel.mockClear();
      mcpClientMocks.callPythonAgentMcpTool.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'main', message: 'hello' }),
        });
        expect(response.status).toBe(200);
        // Drain the SSE stream to completion.
        await response.text();

        // The user message + pending run are atomic, then the resolved saved
        // card metadata and final assistant result complete the same run.
        expect(chatSessionMocks.startGrpcTurn).toHaveBeenCalledTimes(1);
        expect(chatSessionMocks.startGrpcTurn.mock.calls[0][0]).not.toHaveProperty('investigationContext');
        expect(chatSessionMocks.beginConversationRun).toHaveBeenCalledWith(expect.objectContaining({
          projectId: 'project-1',
          deckId: 'deck_builder',
          conversationId: 'main',
          userContent: 'hello',
          runId: expect.stringMatching(/^req_/),
        }));
        expect(chatSessionMocks.markConversationRunRunning).toHaveBeenCalledWith(expect.objectContaining({
          runId: expect.stringMatching(/^req_/),
          invokingCardId: 'card_main_chat',
          provider: 'openai',
          providerModelId: 'gpt-5.6-luna',
        }));
        expect(chatSessionMocks.completeConversationRun).toHaveBeenCalledWith(expect.objectContaining({
          runId: expect.stringMatching(/^req_/),
          assistantContent: 'Real assistant reply.',
        }));

        // The obsolete post-chat pair handoff must never fire from this route.
        expect(mcpClientMocks.callPythonAgentMcpTool).not.toHaveBeenCalled();
        expect(chatSessionMocks.lastCancel).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('ignores late gRPC events after the SSE turn has completed', async () => {
      chatSessionMocks.beginConversationRun.mockClear();
      chatSessionMocks.completeConversationRun.mockClear();
      chatSessionMocks.lastCancel.mockClear();
      chatSessionMocks.startGrpcTurn.mockImplementationOnce(async (_params: unknown, onEvent: (event: any) => void) => {
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
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
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
      chatSessionMocks.startGrpcTurn.mockRejectedValueOnce(new Error('provider credential leaked'));
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'failure', message: 'hello' }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('event: error');
        expect(body).toContain('harness_turn_failed');
        expect(body).toContain('"correlationId":"req_');
        expect(body).toContain('/api/coder/openclaude/session/chat');
        expect(body).not.toContain('provider credential leaked');
      } finally {
        await closeServer(server);
      }
    });

    it('does not call the model when the user message and pending run cannot be persisted', async () => {
      chatSessionMocks.beginConversationRun.mockRejectedValueOnce(new Error('database unavailable'));
      chatSessionMocks.startGrpcTurn.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'no-db', message: 'hello' }),
        });
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
          ok: false,
          error: 'conversation_persistence_unavailable',
          correlationId: expect.stringMatching(/^req_/),
        });
        expect(chatSessionMocks.startGrpcTurn).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('withholds the done event and records failure when final result persistence fails', async () => {
      chatSessionMocks.completeConversationRun.mockRejectedValueOnce(new Error('write failed'));
      chatSessionMocks.failConversationRun.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'result-db-failure', message: 'hello' }),
        });
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).toContain('harness_run_persistence_failed');
        expect(body).not.toContain('event: done');
        expect(chatSessionMocks.failConversationRun).toHaveBeenCalledWith(
          expect.stringMatching(/^req_/),
          'harness_run_persistence_failed',
          expect.stringContaining('write failed'),
        );
      } finally {
        await closeServer(server);
      }
    });
  });

});
