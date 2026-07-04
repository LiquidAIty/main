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
  runCardWithContract: vi.fn(async () => ({
    output: 'The audit is complete. No further work is needed.',
    status: 'success' as const,
    startedAt: '2026-06-16T00:00:00.000Z',
    endedAt: '2026-06-16T00:00:01.000Z',
    magenticTrace: { plan: { task_ledger: { user_goal: 'Fix flagged items', plan: '1. patch' } } },
  })),
  buildMagOneRoutingDiagnostics: vi.fn(() => ({
    blockedReason: null,
    eligibleBusConnectedAgents: [],
    selectedExecutionPath: [],
  })),
}));

const cbmScopeMocks = vi.hoisted(() => ({
  runLocalCoderCbmScopeGate: vi.fn(async () => ({
    indexRan: true,
    indexStatus: 'indexed',
    project: 'C-Projects-main',
    sourceRoot: 'C:/Projects/main',
    nodes: 10,
    edges: 20,
    indexedFiles: 11,
    requiredFiles: [],
    missingRequiredFiles: [],
    excludedFilesFound: [],
    scopeStatus: 'ok',
    editAllowed: true,
    blockedReason: '',
  })),
}));

const chatSessionMocks = vi.hoisted(() => ({
  appendMessage: vi.fn(async (msg: { role: string }) => ({
    messageId: `${msg.role}-msg-1`,
  })),
  getConversationMessages: vi.fn(async () => []),
  startGrpcTurn: vi.fn(async (_params: unknown, _onEvent: (event: any) => void) => ({
    done: Promise.resolve({ finalText: 'Real assistant reply.' }),
    cancel: vi.fn(),
    answer: vi.fn(),
  })),
}));

const mcpClientMocks = vi.hoisted(() => ({
  callPythonAgentMcpTool: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../services/graphContext/cbmScopeGate', () => ({
  runLocalCoderCbmScopeGate: cbmScopeMocks.runLocalCoderCbmScopeGate,
}));

vi.mock('../cards/runtime', () => ({
  runCardWithContract: runtimeMocks.runCardWithContract,
  buildMagOneRoutingDiagnostics: runtimeMocks.buildMagOneRoutingDiagnostics,
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
  it('feeds the previous Task Ledger, Progress Ledger and real TaskResult into a Magentic-One reasoning turn', async () => {
    runtimeMocks.runCardWithContract.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const taskLedger = { user_goal: 'Audit code', plan: '1. read' };
      const progressLedger = { progress_summary: 'dispatched', next_actor: 'LocalCoder' };
      const taskResult = { status: 'completed', result: 'audit complete', files_changed: ['x.ts'] };
      const response = await fetch(`${baseUrl}/openclaude/console/result_feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          targetRoot: 'C:/Projects/main',
          taskLedger,
          progressLedger,
          runTaskPayload: { task_ledger: taskLedger, progress_ledger: progressLedger },
          taskResult,
          cards: [{ id: 'card_magentic', runtimeType: 'magentic_one' }],
          edges: [],
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      // Chat uses Magentic-One's own interpretation, not a TS-invented verdict.
      expect(payload.interpretation).toContain('complete');
      // A revised / next Task Ledger only comes from real Mag One output.
      expect(payload.plan).toMatchObject({ task_ledger: { user_goal: 'Fix flagged items' } });

      expect(runtimeMocks.runCardWithContract).toHaveBeenCalledTimes(1);
      const callArgs = runtimeMocks.runCardWithContract.mock.calls[0] as unknown as any[];
      const context = callArgs[3];
      expect(context.priorPlanContext.task_ledger).toEqual(taskLedger);
      expect(context.priorPlanContext.progress_ledger).toEqual(progressLedger);
      expect(context.resultFeedback).toEqual(taskResult);
      // No raw user input is used as the feedback source.
      const feedbackInstruction = String(callArgs[2] || '');
      expect(feedbackInstruction).toContain('result-interpretation turn');
      expect(JSON.stringify(context)).not.toMatch(/userInput|userText/);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects a result-feedback turn with no TaskResult (no fabricated completion)', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/result_feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          taskLedger: { user_goal: 'Audit code' },
          cards: [{ id: 'card_magentic', runtimeType: 'magentic_one' }],
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
      expect(payload.error).toBe('result_feedback_missing_task_result');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects a result-feedback turn with no Task Ledger', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/result_feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          taskResult: { status: 'completed' },
          cards: [{ id: 'card_magentic', runtimeType: 'magentic_one' }],
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
      expect(payload.error).toBe('result_feedback_missing_task_ledger');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects the removed plain task OpenClaude run', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'pretend to code' }),
      });
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: 'openclaude_plain_task_run_removed_use_localcoder_run',
      });
    } finally {
      await closeServer(server);
    }
  });

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

  it('cannot bypass a blocked CBM freshness/scope gate through the LocalCoder route', async () => {
    cbmScopeMocks.runLocalCoderCbmScopeGate.mockResolvedValueOnce({
      indexRan: true,
      indexStatus: 'indexed',
      project: 'C-Projects-main',
      sourceRoot: 'C:/Projects/main',
      nodes: 10,
      edges: 20,
      indexedFiles: 10,
      requiredFiles: ['repo-intake/localcoder-boundary.md'],
      missingRequiredFiles: ['repo-intake/localcoder-boundary.md'],
      excludedFilesFound: [],
      scopeStatus: 'blocked',
      editAllowed: false,
      blockedReason: 'cbm_scope_required_files_missing: repo-intake/localcoder-boundary.md',
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
      expect(payload.report.blockers.join(' ')).toContain('cbm_scope_required_files_missing');
      expect(payload.cbmScopeGate.editAllowed).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  describe('/openclaude/session/chat', () => {
    it('persists the user and assistant messages and never dispatches the old post-chat ThinkGraph pair handoff', async () => {
      chatSessionMocks.appendMessage.mockClear();
      chatSessionMocks.startGrpcTurn.mockClear();
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
        const appendedRoles = chatSessionMocks.appendMessage.mock.calls.map((call) => (call[0] as any).role);
        expect(appendedRoles).toContain('user');
        expect(appendedRoles).toContain('assistant');
        const appendedAssistantContent = chatSessionMocks.appendMessage.mock.calls.find(
          (call) => (call[0] as any).role === 'assistant',
        )?.[0] as any;
        expect(appendedAssistantContent.content).toBe('Real assistant reply.');

        // The obsolete post-chat pair handoff must never fire from this route.
        expect(mcpClientMocks.callPythonAgentMcpTool).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });
  });
});
