import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

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
  const mocks = {
    appendMessage: vi.fn(async (msg: { role: string }) => ({
      messageId: `${msg.role}-msg-1`,
    })),
    getConversationMessages: vi.fn(async () => []),
    lastCancel: vi.fn(),
    startGrpcTurn: vi.fn(),
  };
  mocks.startGrpcTurn.mockImplementation(async (_params: unknown, _onEvent: (event: any) => void) => ({
    done: Promise.resolve({ finalText: 'Real assistant reply.' }),
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

const graphViewMocks = vi.hoisted(() => ({
  persistGraphViewOnPython: vi.fn(async (view: unknown) => ({ ok: true, view })),
  fetchGraphViewsFromPython: vi.fn(async () => ({ ok: true, views: [] })),
}));

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../services/graphContext/cbmScopeGate', () => ({
  runLocalCoderCbmScopeGate: cbmScopeMocks.runLocalCoderCbmScopeGate,
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

vi.mock('../db/pool', () => ({
  pool: { query: dbMocks.query },
}));

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const express = (await import('express')).default;
  const router = (await import('./coder.routes')).default;
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

  it('keeps the Hermes report bridge closed outside an active native investigation', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/hermes_write_report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentRunId: 'req_not_active', reportMarkdown: '# Report', summary: 'No active turn.' }),
      });
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'hermes_investigation_context_not_active',
      });
      expect(response.status).toBe(409);
      const readResponse = await fetch(`${baseUrl}/mcp-bridge/hermes_read_report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentRunId: 'req_not_active' }),
      });
      await expect(readResponse.json()).resolves.toEqual({
        ok: false,
        error: 'hermes_investigation_context_not_active',
      });
      expect(readResponse.status).toBe(409);
    } finally {
      await closeServer(server);
    }
  });

  it('returns 424 with an exact blocker from the LocalCoder status route when nothing runnable', async () => {
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
    it('validates, persists, activates, and consumes the exact Graph View', async () => {
      const runtimeHandback = {
        schemaVersion: 'graph-view.v1', viewId: 'candidate-1:active:req-1', authority: 'codegraph', status: 'active',
        projectId: 'project-1', conversationId: 'main', producingRole: 'user', receivingRole: 'main_chat',
        rootCanonicalNodeIds: ['symbol:one'], includedCanonicalNodeIds: ['symbol:one'], includedRelationships: [], query: 'selected code', filter: { nodeTypes: [], trustStates: [] }, hopDepth: 0, provenanceRefs: [], parentViewId: 'candidate-1',
        records: [{ canonicalId: 'symbol:one', summary: 'Selected symbol', selectionReason: 'User selected', provenanceRefs: [], estimatedCharacters: 15, estimatedTokens: 4 }],
        omittedNeighborCount: 2, createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T01:00:00Z', invocationId: 'req-1',
        runtime: { provider: 'openai', model: 'gpt-5.1-chat-latest', role: 'main_chat', invocationId: 'req-1', attachedAt: '2026-07-15T01:00:00Z', includedRecords: 1, excludedRecords: 2, contextCharacters: 500, estimatedTokens: 125 },
      };
      chatSessionMocks.startGrpcTurn.mockImplementationOnce(async () => ({
        done: Promise.resolve({ finalText: 'Used bounded context.' }), cancel: vi.fn(), answer: vi.fn(),
        resolved: { cardId: 'card_main_chat', provider: 'openai', modelKey: 'gpt-5.1-chat-latest', providerModelId: 'gpt-5.1-chat-latest' },
        runtimeGraphViews: [runtimeHandback],
      }));
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'main', message: 'Use this.',
            graphViews: [{ ...runtimeHandback, viewId: 'candidate-1', status: 'candidate', projectId: 'spoofed', conversationId: 'spoofed', parentViewId: undefined, invocationId: undefined, runtime: undefined }],
          }),
        });
        const body = await response.text();
        const supplied = (chatSessionMocks.startGrpcTurn.mock.calls.at(-1)?.[0] as any).graphViews[0];
        expect(supplied).toMatchObject({ viewId: 'candidate-1', projectId: 'project-1', conversationId: 'main', status: 'candidate' });
        expect(body).toContain('event: graph_view');
        expect(body).toContain('"status":"consumed"');
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
        expect((chatSessionMocks.startGrpcTurn.mock.calls[0][0] as any).investigationContext).toEqual({
          projectId: 'project-1', conversationId: 'main', focusNodeIds: [], requestedOutcome: null,
        });
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
        const done = Promise.resolve({ finalText: 'Finished before late event.' });
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

  it('accepts an ordinary Hermes turn with no graph selection and keeps focus optional', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/session/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          conversationId: 'main',
          message: 'Investigate.',
          investigationContext: { focusNodeIds: [], requestedOutcome: 'Investigate.' },
        }),
      });
      expect(response.status).toBe(200);
      await response.text();
      expect((chatSessionMocks.startGrpcTurn.mock.calls.at(-1)?.[0] as any).investigationContext).toEqual({
        projectId: 'project-1', conversationId: 'main', focusNodeIds: [], requestedOutcome: 'Investigate.',
      });
    } finally {
      await closeServer(server);
    }
  });
});

describe('Hermes memory project authority', () => {
  it('accepts the real ag_catalog project id and returns that exact identity', async () => {
    const projectId = '20ac92da-01fd-4cf6-97cc-0672421e751a';
    dbMocks.query.mockResolvedValueOnce({ rows: [{ id: projectId }] });
    const { resolveHermesProjectId } = await import('./coder.routes');
    await expect(resolveHermesProjectId(projectId)).resolves.toBe(projectId);
    expect(dbMocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM ag_catalog.projects'),
      [projectId],
    );
  });

  it('fails visibly for an unknown project and never guesses a legacy identity', async () => {
    const unknown = '00000000-0000-0000-0000-000000000404';
    dbMocks.query.mockResolvedValueOnce({ rows: [] });
    const { resolveHermesProjectId } = await import('./coder.routes');
    await expect(resolveHermesProjectId(unknown)).rejects.toThrow(`hermes_project_not_found: ${unknown}`);
  });
});
