import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
// Static imports: NodeNext ESM rejects extensionless dynamic import('./coder.routes')
// after the '.routes' infix strip. vitest hoists vi.mock() above these.
import router from './coder.routes';

const runtimeMocks = vi.hoisted(() => ({
  runConfiguredCard: vi.fn(async () => ({
    status: 'completed' as const,
    output: 'ok',
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
    appendMessage: vi.fn(async (msg: { role: string }) => ({
      messageId: `${msg.role}-msg-1`,
    })),
    getConversationMessages: vi.fn(async () => []),
    lastCancel: vi.fn(),
    startGrpcTurn: vi.fn(),
    usage,
  };
  mocks.startGrpcTurn.mockImplementation(async (_params: unknown, _onEvent: (event: any) => void) => ({
    done: Promise.resolve({ finalText: 'Real assistant reply.', usage }),
    cancel: mocks.lastCancel,
    answer: vi.fn(),
    resolved: {
      cardId: 'card_main_chat',
      provider: 'openai',
      modelKey: 'gpt-5.1-chat-latest',
      providerModelId: 'gpt-5.1-chat-latest',
    },
    runtimeGraphViews: [],
  }));
  return mocks;
});

const mcpClientMocks = vi.hoisted(() => ({
  callPythonAgentMcpTool: vi.fn(async () => ({ ok: true })),
}));

// Shape mirrors what coder.routes.ts consumes from the unified model-context
// response (graphViews array, modelContext text, measurements object or null).
// Typing the mock return stops TS from narrowing measurements to literal `null`
// and graphViews to `never[]`, which would reject the richer override values.
type UnifiedModelContextResult = {
  ok: boolean;
  projectionId?: string;
  graphViews: Record<string, unknown>[];
  modelContext: string;
  measurements: { characters: number; estimatedTokens: number } | null;
};

const graphViewMocks = vi.hoisted(() => ({
  persistGraphViewOnPython: vi.fn(async (view: unknown) => ({ ok: true, view })),
  fetchGraphViewsFromPython: vi.fn(async () => ({ ok: true, views: [] })),
  fetchUnifiedModelContext: vi.fn<() => Promise<UnifiedModelContextResult>>(async () => ({
    ok: true,
    graphViews: [],
    modelContext: '',
    measurements: null,
  })),
  fetchDoorwayContext: vi.fn(async () => ({ ok: true, views: [], modelContext: '' })),
}));

vi.mock('../cards/runtime', () => ({
  runConfiguredCard: runtimeMocks.runConfiguredCard,
}));

vi.mock('../conversations/store', () => ({
  appendMessage: chatSessionMocks.appendMessage,
  getConversationMessages: chatSessionMocks.getConversationMessages,
}));

vi.mock('../coder/openclaude/session/grpcChatClient', () => ({
  deriveSessionId: (projectId: string, conversationId: string) => `${projectId}:${conversationId}`,
  startGrpcTurn: chatSessionMocks.startGrpcTurn,
}));

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  callPythonAgentMcpTool: mcpClientMocks.callPythonAgentMcpTool,
}));

vi.mock('../services/autogen/autogenOrchestratorClient', () => graphViewMocks);

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
  describe('/openclaude/session/chat', () => {
    it('rejects browser-supplied Graph View content — the browser is never the membership authority', async () => {
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'main', message: 'Use this.',
            graphViews: [{ viewId: 'spoofed-view', authority: 'codegraph' }],
          }),
        });
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ ok: false, error: expect.stringContaining('browser_graph_views_removed') });
        expect(chatSessionMocks.startGrpcTurn).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Use this.' }), expect.anything());
      } finally {
        await closeServer(server);
      }
    });

    it('resolves the projection server-side by id and delivers compact context, activating and consuming the same views', async () => {
      const serverView = {
        schemaVersion: 'graph-view.v1', viewId: 'codegraph:server-1', authority: 'codegraph', status: 'candidate',
        projectId: 'project-1', conversationId: 'main', producingRole: 'codegraph', receivingRole: 'main_chat',
        rootCanonicalNodeIds: ['symbol:one'], includedCanonicalNodeIds: ['symbol:one'], includedRelationships: [], query: 'selected code', filter: { nodeTypes: [], trustStates: [] }, hopDepth: 0, provenanceRefs: [],
        records: [{ canonicalId: 'symbol:one', summary: 'Selected symbol', selectionReason: 'Projection membership', provenanceRefs: [], estimatedCharacters: 15, estimatedTokens: 4 }],
        omittedNeighborCount: 2, createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T01:00:00Z',
      };
      const compact = '[LIQUIDAITY_GRAPH_CONTEXT]\nprojection: unified:abc123 | project: project-1 | conversation: main | role: main_chat\n- [Function] one (symbol:one)';
      graphViewMocks.fetchUnifiedModelContext.mockResolvedValueOnce({
        ok: true, projectionId: 'unified:abc123', graphViews: [serverView], modelContext: compact,
        measurements: { characters: compact.length, estimatedTokens: 40 },
      });
      const activeView = { ...serverView, status: 'active', invocationId: 'req-1', runtime: { provider: 'openai', model: 'gpt-5.1-chat-latest', role: 'main_chat', invocationId: 'req-1', attachedAt: '2026-07-15T01:00:00Z', includedRecords: 1, excludedRecords: 2, contextCharacters: compact.length, estimatedTokens: 40 } };
      chatSessionMocks.startGrpcTurn.mockImplementationOnce(async () => ({
        done: Promise.resolve({ finalText: 'Used bounded context.', usage: chatSessionMocks.usage }), cancel: vi.fn(), answer: vi.fn(),
        resolved: { cardId: 'card_main_chat', provider: 'openai', modelKey: 'gpt-5.1-chat-latest', providerModelId: 'gpt-5.1-chat-latest' },
        runtimeGraphViews: [activeView],
      }));
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'main', message: 'Use this.', projectionId: 'unified:abc123' }),
        });
        const body = await response.text();
        expect(graphViewMocks.fetchUnifiedModelContext).toHaveBeenCalledWith(expect.objectContaining({
          projectionId: 'unified:abc123', projectId: 'project-1', conversationId: 'main', role: 'main_chat',
        }));
        const supplied = chatSessionMocks.startGrpcTurn.mock.calls.at(-1)?.[0] as any;
        // The turn receives the compact text + the server-resolved views (server scope preserved).
        expect(supplied.graphContext).toBe(compact);
        expect(supplied.graphViews[0]).toMatchObject({ viewId: 'codegraph:server-1', projectId: 'project-1', conversationId: 'main', status: 'candidate' });
        // Measured context cost is surfaced to the browser before the answer.
        expect(body).toContain('event: context_measurement');
        expect(body).toContain('unified:abc123');
        // Lifecycle unchanged: active views consumed at turn end.
        expect(body).toContain('event: graph_view');
        expect(body).toContain('"status":"consumed"');
      } finally {
        await closeServer(server);
      }
    });

    it('fails honestly when the projection cannot be resolved — never a silent contextless fallback', async () => {
      graphViewMocks.fetchUnifiedModelContext.mockRejectedValueOnce(new Error('thinkgraph_http_409:projection_superseded: current is unified:def456'));
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'main', message: 'Use this.', projectionId: 'unified:stale' }),
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
          ok: false,
          error: expect.stringContaining('projection_superseded'),
          projectionId: 'unified:stale',
        });
      } finally {
        await closeServer(server);
      }
    });

    it('persists the user and assistant messages and never dispatches the old post-chat ThinkGraph pair handoff', async () => {
      chatSessionMocks.appendMessage.mockClear();
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

        // Real chat turn still runs and both messages are still persisted.
        expect(chatSessionMocks.startGrpcTurn).toHaveBeenCalledTimes(1);
        expect((chatSessionMocks.startGrpcTurn.mock.calls[0][0] as any).investigationContext).toBeUndefined();
        const appendedRoles = chatSessionMocks.appendMessage.mock.calls.map((call) => (call[0] as any).role);
        expect(appendedRoles).toContain('user');
        expect(appendedRoles).toContain('assistant');
        const appendedAssistantContent = chatSessionMocks.appendMessage.mock.calls.find(
          (call) => (call[0] as any).role === 'assistant',
        )?.[0] as any;
        expect(appendedAssistantContent.content).toBe('Real assistant reply.');

        // The obsolete post-chat pair handoff must never fire from this route.
        expect(mcpClientMocks.callPythonAgentMcpTool).not.toHaveBeenCalled();
        expect(chatSessionMocks.lastCancel).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('ignores late gRPC events after the SSE turn has completed', async () => {
      chatSessionMocks.appendMessage.mockClear();
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
            modelKey: 'gpt-5.1-chat-latest',
            providerModelId: 'gpt-5.1-chat-latest',
          },
          runtimeGraphViews: [],
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
  });

});
