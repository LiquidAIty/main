import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
// Static imports: NodeNext ESM rejects extensionless dynamic import('./coder.routes')
// after the '.routes' infix strip. vitest hoists vi.mock() above these.
import router from './coder.routes';
import {
  ensurePersistentCoderTerminal,
} from '../hermes/coderTerminal';

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
    cancelHermesRun: vi.fn(),
    cancelHermesSession: vi.fn(),
    answerHermesSession: vi.fn(),
    dispatchHermesLearnCommand: vi.fn(async (_profile: string, request: string) => `NATIVE LEARN PROMPT: ${request}`),
    deleteHermesHistory: vi.fn(async () => ({ sessionId: 'persisted-session', deleted: true })),
    readHermesHistory: vi.fn(async (): Promise<any> => ({ sessionId: null, messages: [] })),
    readHermesRunSnapshot: vi.fn((): any => null),
    startHermesTurn: vi.fn(),
    usage,
  };
  mocks.startHermesTurn.mockImplementation(async (_params: unknown, _onEvent: (event: any) => void) => ({
    done: Promise.resolve({ finalText: 'Real assistant reply.', usage }),
    cancel: mocks.lastCancel,
    answer: vi.fn(),
  }));
  return mocks;
});

const kanbanMocks = vi.hoisted(() => ({
  readHermesKanbanSessionUsage: vi.fn(async () => ({
    toolCallCount: 7,
    providerInputTokens: 120,
    providerOutputTokens: 45,
    providerCachedTokens: 30,
    providerReasoningTokens: 12,
    totalCostUsd: 0,
  })),
  startNativeHermesKanbanTurn: vi.fn(async (params: any, _onEvent?: unknown, _options?: unknown) => ({
    done: Promise.resolve({
      finalText: 'Native root synthesis.',
      usage: {
        providerInputTokens: null,
        providerOutputTokens: null,
        totalCostUsd: null,
        usageAvailable: false,
        usageSource: 'hermes_native_kanban_unavailable',
        contextBreakdownJson: '',
      },
      transport: {
        threadId: 't_native_root',
        turnId: '41',
        authMode: null,
        planType: 'hermes-native-kanban',
        nativeTaskId: 't_native_root',
        nativeRunId: 41,
        nativeStatus: 'done',
      },
    }),
    cancel: vi.fn(),
    answer: vi.fn(),
    resolved: {
      cardId: params.cardId,
      provider: params.provider,
      modelKey: params.modelKey,
      providerModelId: params.providerModelId,
    },
    runtime: {
      executable: 'hermes-acp.exe',
      pid: 42,
      hermesHome: 'Hermes/.hermes',
      sessionId: 't_native_root',
      transport: 'hermes-kanban',
    },
  })),
}));

const kanbanRecoveryMocks = vi.hoisted(() => ({
  reconcileTerminalKanbanRun: vi.fn(() => true),
  startKanbanRunMonitor: vi.fn((_runId: string, monitor: () => Promise<void>) => {
    void monitor();
    return true;
  }),
}));

const mcpClientMocks = vi.hoisted(() => ({
  callPythonAgentMcpTool: vi.fn(async () => ({ ok: true })),
  listPythonAgentMcpCatalog: vi.fn(async (): Promise<any[]> => []),
  resolvePythonAgentMcpServerSpec: vi.fn(() => ({
    type: 'http',
    url: 'http://127.0.0.1:8765/mcp',
    headers: { Authorization: 'Bearer test-coder-terminal-token' },
  })),
}));

const ptyMocks = vi.hoisted(() => {
  const children: any[] = [];
  const spawn = vi.fn((_file: string, _args: string[], _options: Record<string, unknown>) => {
    const dataListeners: Array<(data: string) => void> = [];
    const exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];
    const child = {
      pid: 4242 + children.length,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (listener: (data: string) => void) => {
        dataListeners.push(listener);
        return { dispose: () => undefined };
      },
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListeners.push(listener);
        return { dispose: () => undefined };
      },
      emitData: (data: string) => dataListeners.forEach((listener) => listener(data)),
      emitExit: (exitCode: number, signal?: number) => (
        exitListeners.forEach((listener) => listener({ exitCode, signal }))
      ),
    };
    children.push(child);
    return child;
  });
  return { children, spawn };
});

const orchestratorMocks = vi.hoisted(() => {
  const runRecords = new Map<string, any>();
  const requestFingerprints = new Map<string, string>();
  return {
  runRecords,
  requestFingerprints,
  dispatchConfiguredRuntime: vi.fn(async (): Promise<any> => ({
    ok: true,
    runId: 'run-mag-one',
    finalResponseText: 'Native Mag One response.',
  })),
  requestPythonRailsJson: vi.fn(async (endpoint: string, init?: RequestInit): Promise<any> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    if (endpoint === '/tools/manifest') return { tools: [] };
    if (endpoint === '/idd/tools/materialize') return { references: body.tools };
    if (endpoint === '/card-editor/options') {
      return {
        fields: [{ name: 'provider', label: 'Provider', path: 'provider', control: 'select' }],
        catalogs: { 'configured-models': body.models },
      };
    }
    if (endpoint === '/idd/card-editor/materialize') {
      return {
        dictionary: { name: 'LiquidAIty', version: 4, purpose: 'agent-builder' },
        fields: [{ name: 'provider', label: 'Provider', path: 'provider', control: 'select' }],
        catalogs: { 'configured-models': body.models },
      };
    }
    if (endpoint === '/domain/main/prepare') {
      const cardId = 'card_main_chat';
      const runtime = { kind: 'hermes', mode: 'main', profile: 'default' };
      const provider = {
        accessMode: 'chatgpt-account', provider: 'openai',
        modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
      };
      const callConfiguration = {
        systemPrompt: 'Saved prompt',
        runtime,
        provider,
        runtimeOptions: {},
        enabledTools: [],
        nativeTools: [],
        skills: [],
        toolsets: [],
        mcpConnectionIds: [],
      };
      return {
        projectId: body.projectId,
        deckId: body.deckId,
        cardRevisionId: `revision:${cardId}`,
        message: String(body.message || ''),
        runtimeOwner: 'hermes',
        cardIdentity: {
          cardId,
          title: 'Main',
        },
        ...(!body.message
          ? { sessionProfile: callConfiguration }
          : {
              idf: {
                actualGraphData: { recordCounts: { total: 0 }, authorities: [], records: [], modelText: '' },
                stableSavedCardContext: {
                  instructions: callConfiguration.systemPrompt,
                  runtime, provider,
                  runtimeOptions: {},
                  outputRequirements: '',
                },
                selectedToolsAndGrants: {
                  enabledTools: callConfiguration.enabledTools,
                  toolDefinitions: [], nativeTools: callConfiguration.nativeTools,
                  skills: callConfiguration.skills, toolsets: callConfiguration.toolsets,
                  mcpConnectionIds: callConfiguration.mcpConnectionIds,
                },
                dynamicContext: { task: String(body.message || '') },
              },
              inputSummary: { idfBytes: 180 },
            }),
      };
    }
    if (endpoint === '/domain/runs/begin' || endpoint === '/domain/main/runs/begin') {
      const mainChat = endpoint === '/domain/main/runs/begin';
      const cardId = mainChat ? 'card_main_chat' : body.cardId;
      const autoKanban = cardId === 'card_hermes_steward';
      const coderCard = cardId === 'card_local_coder';
      const requestKey = [body.projectId, body.deckId, cardId, body.cardRevisionId || '', body.assignment || body.message || ''].join('|');
      const existingRunId = requestFingerprints.get(requestKey);
      const resolvedRunId = existingRunId || body.runId;
      if (!existingRunId) {
        requestFingerprints.set(requestKey, resolvedRunId);
        runRecords.set(resolvedRunId, {
          runId: resolvedRunId,
          correlationId: body.correlationId,
           cardId,
           state: 'running',
           runtimeKind: 'hermes',
           runtimeMode: mainChat ? 'main' : autoKanban ? 'kanban' : 'delegate',
           runtimeProfile: mainChat ? 'default' : autoKanban ? 'liquidaity-hermes-steward' : 'coder',
           startedAt: new Date().toISOString(),
        });
      }
      return {
        runId: resolvedRunId,
        correlationId: runRecords.get(resolvedRunId)?.correlationId || body.correlationId,
        rejoined: Boolean(existingRunId),
        cardRevisionId: body.cardRevisionId,
        runtimeOwner: 'hermes',
        resolvedNativeReads: autoKanban
          ? [{ authority: 'ThinkGraph', nativeId: 'think-root-1' }]
          : coderCard ? [{ authority: 'CodeGraph', nativeId: 'pkg.materialize_idf' }] : [],
        resolvedGraphProjection: {
          schemaVersion: 'native-card-context.v1',
          authority: 'mixed',
          projectId: body.projectId,
          nodes: coderCard ? [{ id: 'pkg.materialize_idf', label: 'materialize_idf', mentionCount: 1 }] : [],
          edges: [],
          counts: { nodes: coderCard ? 1 : 0, edges: 0 },
        },
        idf: {
          actualGraphData: {
            recordCounts: { total: coderCard || autoKanban ? 2 : 0 }, authorities: [], records: [],
            modelText: autoKanban
              ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
              : coderCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
          },
          stableSavedCardContext: {
            instructions: coderCard ? 'Saved Coder prompt' : 'Saved prompt',
            runtime: cardId === 'card_main_chat'
              ? { kind: 'hermes', mode: 'main', profile: 'default' }
              : coderCard
                ? { kind: 'hermes', mode: 'delegate', profile: 'coder' }
                : { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
            provider: {
              accessMode: 'chatgpt-account', provider: 'openai',
              modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
            },
            runtimeOptions: {},
            outputRequirements: '',
          },
          selectedToolsAndGrants: {
            enabledTools: autoKanban ? ['graphiti.search_nodes'] : coderCard ? ['cbm.search_graph'] : [],
            toolDefinitions: [],
            nativeTools: autoKanban ? ['memory'] : coderCard ? ['terminal'] : [],
            skills: autoKanban ? ['documentation'] : coderCard ? ['repository-coder'] : [],
            toolsets: coderCard ? ['file', 'terminal'] : [],
            mcpConnectionIds: [],
          },
          dynamicContext: { task: String(mainChat ? body.message || '' : body.assignment || '') },
        },
        inputSummary: { idfBytes: 400 },
        inputFile: {
          workspace: 'C:\\runtime-inputs\\root-run',
          idfPath: 'C:\\runtime-inputs\\root-run\\in.idf',
          idfSha256: 'a'.repeat(64), idfBytes: 400,
        },
        hermesTransport: {
          request: {
            systemPrompt: coderCard ? 'Saved Coder prompt' : 'Saved prompt',
            outputRequirements: '',
            graphContext: autoKanban
              ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
              : coderCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
            task: String(mainChat ? body.message || '' : body.assignment || ''),
            message: [
              autoKanban
                ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
                : coderCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
              String(mainChat ? body.message || '' : body.assignment || ''),
            ].filter(Boolean).join('\n\n'),
            kanbanMission: autoKanban ? [
              '## Resolved ThinkGraph',
              'Native bounded context for think-root-1.',
              '',
              String(body.assignment || ''),
            ].join('\n') : '',
            runtime: cardId === 'card_main_chat'
              ? { kind: 'hermes', mode: 'main', profile: 'default' }
              : coderCard
                ? { kind: 'hermes', mode: 'delegate', profile: 'coder' }
                : { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
            provider: {
              accessMode: 'chatgpt-account', provider: 'openai',
              modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
            },
            runtimeOptions: {},
            enabledTools: autoKanban ? ['graphiti.search_nodes'] : coderCard ? ['cbm.search_graph'] : [],
            toolDefinitions: [], nativeTools: autoKanban ? ['memory'] : coderCard ? ['terminal'] : [],
            skills: autoKanban ? ['documentation'] : coderCard ? ['repository-coder'] : [],
            toolsets: coderCard ? ['file', 'terminal'] : [], mcpConnectionIds: [],
          },
          inputFile: {
            workspace: 'C:\\runtime-inputs\\root-run',
            idfPath: 'C:\\runtime-inputs\\root-run\\in.idf',
            idfSha256: 'a'.repeat(64), idfBytes: 400,
          },
          delegationTargets: cardId === 'card_main_chat' ? [{
            cardId: 'card_local_coder',
            title: 'Coder',
            runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
            prompt: 'Saved Coder prompt',
            provider: 'openai',
            modelKey: 'gpt-5.6-terra',
            providerModelId: 'gpt-5.6-terra',
            accessMode: 'chatgpt-account',
            tools: ['cbm.search_graph'],
            nativeTools: ['terminal'],
            skills: ['repository-coder'],
            toolsets: ['terminal'],
            mcpConnectionIds: [],
          }] : [],
          cardIdentity: {
            cardId,
            title: cardId === 'card_main_chat' ? 'Main' : coderCard ? 'Coder' : 'Hermes steward',
          },
        },
      };
    }
    if (endpoint === '/domain/runs/progress') {
      runRecords.set(body.runId, { ...(runRecords.get(body.runId) || {}), ...body });
      return { ok: true, runId: body.runId, updated: true };
    }
    if (endpoint === '/domain/runs/finish') {
      runRecords.set(body.runId, {
        ...(runRecords.get(body.runId) || {}),
        ...body,
        finishedAt: new Date().toISOString(),
        finalResult: body.finalResult ?? null,
      });
      return { receipt: { runId: body.runId, state: body.state } };
    }
    if (endpoint === '/domain/runs/read') {
      const records = [...runRecords.values()];
      const run = records.find((record) => (
        (body.runId && record.runId === body.runId)
        || (body.correlationId && record.correlationId === body.correlationId)
        || (body.nativeRootId && record.nativeRootId === body.nativeRootId)
        || (body.cardId && record.cardId === body.cardId)
      ));
      return {
        ok: true,
        run: run ? {
          ...run,
          inputTokens: run.providerInputTokens,
          outputTokens: run.providerOutputTokens,
          cachedTokens: run.providerCachedTokens,
          reasoningTokens: run.providerReasoningTokens,
          costUsd: run.totalCostUsd,
          result: run.finalResult,
        } : null,
      };
    }
    if (endpoint === '/domain/runs/input-files') {
      return {
        ok: true,
        available: true,
        runId: body.runId,
        idf: {
          actualGraphData: { recordCounts: { total: 1 }, authorities: ['CodeGraph'], records: [] },
          stableSavedCardContext: {},
          selectedToolsAndGrants: {},
          dynamicContext: {},
        },
        inputSummary: { idfBytes: 400, estimatedModelVisibleTokens: 42 },
        idfText: '{"actualGraphData":{},"stableSavedCardContext":{},"selectedToolsAndGrants":{},"dynamicContext":{}}\n',
      };
    }
    if (endpoint === '/domain/agentgraph/inspect') {
      return {
        ok: true,
        runs: [],
        attentionEvents: body.runId ? [
          { operation: 'read', runId: body.runId },
          { operation: 'read', runId: body.runId },
          { operation: 'write', runId: body.runId },
        ] : [],
      };
    }
    return {};
  }),
  };
});

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
  cancelHermesRun: chatSessionMocks.cancelHermesRun,
  cancelHermesSession: chatSessionMocks.cancelHermesSession,
  answerHermesSession: chatSessionMocks.answerHermesSession,
  dispatchHermesLearnCommand: chatSessionMocks.dispatchHermesLearnCommand,
  deleteHermesHistory: chatSessionMocks.deleteHermesHistory,
  readHermesHistory: chatSessionMocks.readHermesHistory,
  readHermesRunSnapshot: chatSessionMocks.readHermesRunSnapshot,
  startHermesTurn: chatSessionMocks.startHermesTurn,
}));

vi.mock('./hermesKanban.routes', () => ({
  readHermesKanbanSessionUsage: kanbanMocks.readHermesKanbanSessionUsage,
  startNativeHermesKanbanTurn: kanbanMocks.startNativeHermesKanbanTurn,
}));

vi.mock('../hermes/kanbanRunRecovery', () => kanbanRecoveryMocks);

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  callPythonAgentMcpTool: mcpClientMocks.callPythonAgentMcpTool,
  listPythonAgentMcpCatalog: mcpClientMocks.listPythonAgentMcpCatalog,
  resolvePythonAgentMcpServerSpec: mcpClientMocks.resolvePythonAgentMcpServerSpec,
}));

vi.mock('node-pty', () => ({ spawn: ptyMocks.spawn }));

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
  it('observes the same ordinary Card Run through status without executing or rejoining another root', async () => {
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
    orchestratorMocks.runRecords.set('terminal-root', {
      runId: 'terminal-root', projectId: 'p', deckId: 'd', cardId: 'research', state: 'running',
      runtimeKind: 'hermes', runtimeMode: 'delegate', runtimeProfile: 'research',
      terminal: { cardName: 'Research', activeChildren: 1, children: [], parentRunIds: [],
        transcript: { sessionId: null, unavailableReason: 'native_session_identity_unavailable' } },
    });
    chatSessionMocks.readHermesRunSnapshot.mockReturnValue({
      runId: 'terminal-root', projectId: 'p', deckId: 'd', cardId: 'research', cardName: 'Research',
      sessionId: 'native-exact', fullText: 'Actual model output', textSequence: 1, textTimestamp: null, tools: [],
    });
    const { server, baseUrl } = await createApiServer();
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            action: 'status', projectId: 'p', deckId: 'd', runId: 'terminal-root', includeTerminal: true, inspectOnly: true,
          }),
        });
        const body = await response.json() as any;
        expect(response.status).toBe(200);
        expect(body.result.terminal).toMatchObject({ runId: 'terminal-root', activeAgentCount: 2,
          events: [{ id: 'terminal-root:model', kind: 'model', text: 'Actual model output' }] });
      }
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      expect(orchestratorMocks.requestPythonRailsJson.mock.calls.every(([route]) =>
        route === '/domain/runs/read' || route === '/domain/agentgraph/inspect')).toBe(true);
    } finally { chatSessionMocks.readHermesRunSnapshot.mockReturnValue(null); await closeServer(server); }
  });

  it.each(['research', 'coder'])('reads/deletes only the stored exclusive %s transcript and never changes the accepted Run result', async (profile) => {
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const run = { runId: 'terminal-root', projectId: 'p', deckId: 'd', cardId: 'research', state: 'completed',
      finalResult: 'Accepted result', runtimeKind: 'hermes', runtimeMode: 'delegate', runtimeProfile: profile,
      terminal: { cardName: 'Research', parentRunIds: [], transcript: { sessionId: 'stored-session', unavailableReason: null } } };
    orchestratorMocks.runRecords.set(run.runId, run);
    chatSessionMocks.readHermesHistory.mockResolvedValueOnce({ sessionId: 'stored-session', messages: [], events: [{ kind: 'text', text: 'Real history' }] });
    chatSessionMocks.deleteHermesHistory.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      for (const action of ['transcript', 'delete_transcript']) {
        const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            action, projectId: 'p', deckId: 'd', cardId: 'research', runId: run.runId,
            sessionId: 'browser-must-not-select-this', profile: 'wrong-profile',
          }),
        });
        expect(response.status).toBe(200);
      }
      expect(chatSessionMocks.deleteHermesHistory).toHaveBeenCalledWith({
        sessionKey: '', profile, sessionId: 'stored-session', terminal: true,
      });
      expect(orchestratorMocks.runRecords.get(run.runId)).toBe(run);
      expect(orchestratorMocks.requestPythonRailsJson.mock.calls.every(([route]) => route === '/domain/runs/read')).toBe(true);
    } finally { await closeServer(server); }
  });

  it.each(['shared', 'active', 'wrong-card', 'wrong-project', 'wrong-deck', 'specialized'])(
    'refuses %s transcript deletion before calling Hermes', async (reason) => {
      chatSessionMocks.deleteHermesHistory.mockClear();
      orchestratorMocks.runRecords.clear();
      orchestratorMocks.runRecords.set('terminal-root', {
        runId: 'terminal-root', projectId: reason === 'wrong-project' ? 'other' : 'p',
        deckId: reason === 'wrong-deck' ? 'other' : 'd', cardId: reason === 'wrong-card' ? 'other' : 'research',
        state: reason === 'active' ? 'running' : 'completed', runtimeKind: 'hermes', runtimeMode: reason === 'specialized' ? 'kanban' : 'delegate',
        runtimeProfile: 'research',
        terminal: { transcript: { sessionId: 's', unavailableReason: reason === 'shared' ? 'native_session_shared_or_unmapped_runs' : null } },
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            action: 'delete_transcript', projectId: 'p', deckId: 'd', cardId: 'research', runId: 'terminal-root',
          }),
        });
        expect(response.status).toBe(409);
        expect(chatSessionMocks.deleteHermesHistory).not.toHaveBeenCalled();
      } finally { await closeServer(server); }
    },
  );

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

  it('serves ordinary card-editor options without a Card read, full palette, or native tool discovery', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    deckMocks.getDeckDocument.mockClear();
    mcpClientMocks.listPythonAgentMcpCatalog.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/card-editor/options`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(Object.keys(payload).sort()).toEqual(['catalogs', 'fields', 'ok']);
      expect(payload.fields).toEqual([expect.objectContaining({ name: 'provider' })]);
      expect(payload.catalogs['configured-models']).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: 'openai', key: 'gpt-5.6-luna' }),
        expect.objectContaining({ provider: 'openrouter' }),
      ]));
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledExactlyOnceWith(
        '/card-editor/options', expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(String(orchestratorMocks.requestPythonRailsJson.mock.calls[0][1]?.body));
      expect(Object.keys(body)).toEqual(['models']);
      expect(deckMocks.getDeckDocument).not.toHaveBeenCalled();
      expect(mcpClientMocks.listPythonAgentMcpCatalog).not.toHaveBeenCalled();
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
    } finally { await closeServer(server); }
  });

  it.each([null, new Error('sk-secret')])('fails ordinary card-editor options closed with a secret-safe error (%s)', async (failure) => {
    if (failure instanceof Error) orchestratorMocks.requestPythonRailsJson.mockRejectedValueOnce(failure);
    else orchestratorMocks.requestPythonRailsJson.mockResolvedValueOnce(failure);
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/card-editor/options`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: 'runtime_options_unavailable' });
    } finally { await closeServer(server); }
  });

  it('materializes the full Builder card-editor palette through the literal IDD boundary', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/input-data-dictionary/card-editor`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: true,
        dictionary: { name: 'LiquidAIty', version: 4, purpose: 'agent-builder' },
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

  it('projects native discovery and preserves missing saved selections without rewriting the Card', async () => {
    const card = { id: 'custom', templateId: 'template_assist', runtime: { kind: 'autogen', mode: 'assistant' },
      runtimeOptions: { tools: ['removed.tool'], nativeTools: [], provider: 'openrouter', modelKey: 'removed-model' } };
    const before = JSON.stringify(card);
    deckMocks.getDeckDocument.mockResolvedValueOnce({ deck: { nodes: [card], edges: [] } } as any);
    mcpClientMocks.listPythonAgentMcpCatalog.mockResolvedValueOnce([{
      name: 'new.tool', sourceId: 'native-source', inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    }]);
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/input-data-dictionary/card-editor?projectId=p&deckId=d&cardId=custom`);
      expect(response.status).toBe(200);
      const call = orchestratorMocks.requestPythonRailsJson.mock.calls.find(([endpoint]) => endpoint === '/idd/card-editor/materialize');
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.selectedIds).toEqual(['template_assist', 'removed.tool', 'model:openrouter:removed-model']);
      expect(body.nativeOptions).toEqual([{
        id: 'new.tool', kind: 'tool', owner: 'native-source', source: 'native-source', available: true,
        schema: { type: 'object', properties: { q: { type: 'string' } } },
      }]);
      expect(JSON.stringify(card)).toBe(before);
    } finally { await closeServer(server); }
  });

  it('returns an empty history only for a successful empty read', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.readHermesHistory.mockClear();
    chatSessionMocks.readHermesHistory.mockResolvedValueOnce({ sessionId: null, messages: [] });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, sessionId: null, messages: [] });
      expect(orchestratorMocks.requestPythonRailsJson).not.toHaveBeenCalled();
      expect(chatSessionMocks.readHermesHistory).toHaveBeenCalledWith({
        sessionKey: 'project-1:main:card_main_chat',
        profile: 'default',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('returns a typed failure when native Hermes history cannot be read', async () => {
    chatSessionMocks.readHermesHistory.mockRejectedValueOnce(
      new Error('hermes_acp_transport_closed'),
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

  it('deletes only the exact selected native Main conversation', async () => {
    chatSessionMocks.deleteHermesHistory.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        sessionId: 'persisted-session',
        deleted: true,
      });
      expect(chatSessionMocks.deleteHermesHistory).toHaveBeenCalledWith({
        sessionKey: 'project-1:main:card_main_chat',
        profile: 'default',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('returns the exact retained root inputs for one selected Run', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inputs',
          projectId: 'project-1',
          deckId: 'deck_builder',
          runId: 'run-one',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          available: true,
          runId: 'run-one',
          idf: {
            actualGraphData: { recordCounts: { total: 1 } },
          },
          inputSummary: { estimatedModelVisibleTokens: 42 },
        },
      });
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith(
        '/domain/runs/input-files',
        expect.objectContaining({ body: expect.stringContaining('run-one') }),
      );
    } finally {
      await closeServer(server);
    }
  });

  it('executes the one Python materialization for the current Card input', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
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
        message: 'Use saved Main.',
      });
      const beginCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      );
      expect(JSON.parse(String(beginCall?.[1]?.body || '{}'))).toMatchObject({
        assignment: 'Use saved Main.',
      });
      const finishCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/domain/runs/finish',
      );
      expect(JSON.parse(String(finishCall?.[1]?.body || '{}'))).toMatchObject({
        runId: 'corr-main-1',
        state: 'completed',
        finalResult: 'Real assistant reply.',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('uses ACP to create and join one native Hermes Kanban root task', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
    kanbanMocks.startNativeHermesKanbanTurn.mockClear();
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
          cardRevisionId: 'revision:card_hermes_steward',
        }),
      });
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(202);
      expect(payload).toMatchObject({
        ok: true,
        result: {
          status: 'queued',
          state: 'running',
          runId: 'corr-steward-1',
          nativeRootId: 't_native_root',
          runtimeOwner: 'hermes',
          transport: expect.objectContaining({
            nativeTaskId: 't_native_root',
            planType: 'hermes-native-kanban',
          }),
          resultReady: false,
        },
      });
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      expect(kanbanMocks.startNativeHermesKanbanTurn).toHaveBeenCalledTimes(1);
      expect(kanbanMocks.startNativeHermesKanbanTurn.mock.calls[0]?.[0]).toMatchObject({
        cardId: 'card_hermes_steward',
        title: 'Hermes steward',
        prompt: 'Saved prompt',
        runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
        provider: 'openai',
        providerModelId: 'gpt-5.6-luna',
        nativeMission: [
          '## Resolved ThinkGraph',
          'Native bounded context for think-root-1.',
          '',
          'Prepare one bounded documentation result.',
        ].join('\n'),
      });
      await vi.waitFor(() => expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(
        ([endpoint, init]) => endpoint === '/domain/runs/finish'
          && JSON.parse(String(init?.body || '{}')).state === 'completed',
      )).toBe(true));
      const finishCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint, init]) => endpoint === '/domain/runs/finish'
          && JSON.parse(String(init?.body || '{}')).state === 'completed',
      );
      expect(JSON.parse(String(finishCall?.[1]?.body || '{}'))).toMatchObject({
        runId: 'corr-steward-1',
        providerThreadRef: 't_native_root',
        providerTurnRef: '41',
        finalResult: 'Native root synthesis.',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('keeps one Kanban Card Run alive across disconnect, progress, exact retry, and rejoin', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    kanbanMocks.startNativeHermesKanbanTurn.mockClear();
    let resolveNative: (value: any) => void = () => undefined;
    let completed = false;
    let progressListener: ((progress: any) => Promise<void> | void) | undefined;
    const cancel = vi.fn();
    const done = new Promise<any>((resolve) => {
      resolveNative = (value) => {
        completed = true;
        resolve(value);
      };
    });
    kanbanMocks.startNativeHermesKanbanTurn.mockImplementationOnce(
      async (params: any, _onEvent: unknown, options: any) => {
        progressListener = options?.onProgress;
        return {
          done,
          cancel,
          answer: vi.fn(),
          resolved: {
            cardId: params.cardId,
            provider: params.provider,
            modelKey: params.modelKey,
            providerModelId: params.providerModelId,
          },
          runtime: {
            executable: 'hermes-acp.exe',
            pid: 42,
            hermesHome: 'Hermes/.hermes',
            sessionId: 't_625de6e8',
            transport: 'hermes-kanban',
          },
        };
      },
    );
    const { server, baseUrl } = await createApiServer();
    const submission = {
      projectId: 'project-async',
      deckId: 'deck_builder',
      cardId: 'card_hermes_steward',
      correlationId: 'run-kanban-durable',
      conversationId: 'conversation-main-async',
      input: 'Use the retained provider-free lifecycle fixture.',
      action: 'execute',
      cardRevisionId: 'revision:card_hermes_steward',
    };
    try {
      const controller = new AbortController();
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(submission),
      });
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runId: 'run-kanban-durable',
          nativeRootId: 't_625de6e8',
          state: 'running',
          resultReady: false,
        },
      });
      expect(completed).toBe(false);
      controller.abort();
      expect(cancel).not.toHaveBeenCalled();

      await progressListener?.({
        nativeRootId: 't_625de6e8',
        nativeRunId: 4,
        phase: 'working',
        tasksCompleted: 2,
        tasksTotal: 5,
        activeWorkers: 2,
        workerSessionIds: ['worker-luna-1', 'worker-luna-2'],
      });
      const runningResponse = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          projectId: 'project-async',
          deckId: 'deck_builder',
          runId: 'run-kanban-durable',
        }),
      });
      await expect(runningResponse.json()).resolves.toMatchObject({
        result: {
          runId: 'run-kanban-durable',
          nativeRootId: 't_625de6e8',
          status: 'working',
          tasksCompleted: 2,
          tasksTotal: 5,
          activeWorkers: 2,
          graphReads: 2,
          graphWrites: 1,
          resultReady: false,
        },
      });

      const retryResponse = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...submission, correlationId: 'retry-correlation-must-not-win' }),
      });
      await expect(retryResponse.json()).resolves.toMatchObject({
        result: { runId: 'run-kanban-durable', nativeRootId: 't_625de6e8' },
      });
      expect(kanbanMocks.startNativeHermesKanbanTurn).toHaveBeenCalledTimes(1);

      resolveNative({
        finalText: 'Retained native root synthesis.',
        usage: chatSessionMocks.usage,
        transport: { threadId: 't_625de6e8', turnId: '4' },
      });
      await vi.waitFor(() => {
        expect(orchestratorMocks.runRecords.get('run-kanban-durable')).toMatchObject({
          state: 'completed',
          finalResult: 'Retained native root synthesis.',
          toolCallCount: 7,
          providerCachedTokens: 30,
          providerReasoningTokens: 12,
        });
      });
      const completeResponse = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          projectId: 'project-async',
          deckId: 'deck_builder',
          nativeRootId: 't_625de6e8',
        }),
      });
      await expect(completeResponse.json()).resolves.toMatchObject({
        result: {
          runId: 'run-kanban-durable',
          status: 'complete',
          state: 'completed',
          output: 'Retained native root synthesis.',
          toolCallCount: 7,
          inputTokens: 120,
          outputTokens: 45,
          cachedTokens: 30,
          reasoningTokens: 12,
          resultReady: true,
        },
      });
      expect(orchestratorMocks.runRecords).toHaveLength(1);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('starts same-ID terminal reconciliation from status without creating another Run or root', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    kanbanRecoveryMocks.reconcileTerminalKanbanRun.mockClear();
    kanbanMocks.startNativeHermesKanbanTurn.mockClear();
    orchestratorMocks.runRecords.set('run-failed-transport', {
      runId: 'run-failed-transport',
      correlationId: 'run-failed-transport',
      projectId: 'project-rejoin',
      deckId: 'deck_builder',
      cardId: 'card_hermes_steward',
      runtimeKind: 'hermes',
      runtimeMode: 'kanban',
      runtimeProfile: 'liquidaity-hermes-steward',
      state: 'failed',
      nativeRootId: 't_retained_root',
      nativePhase: 'failed',
      finalResult: null,
      startedAt: new Date().toISOString(),
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          projectId: 'project-rejoin',
          deckId: 'deck_builder',
          runId: 'run-failed-transport',
        }),
      });
      await expect(response.json()).resolves.toMatchObject({
        result: {
          runId: 'run-failed-transport',
          nativeRootId: 't_retained_root',
          state: 'failed',
        },
      });
      expect(kanbanRecoveryMocks.reconcileTerminalKanbanRun).toHaveBeenCalledWith({
        runId: 'run-failed-transport',
        projectId: 'project-rejoin',
        deckId: 'deck_builder',
        cardId: 'card_hermes_steward',
        nativeRootId: 't_retained_root',
        runtimeProfile: 'liquidaity-hermes-steward',
      });
      expect(orchestratorMocks.runRecords).toHaveLength(1);
      expect(kanbanMocks.startNativeHermesKanbanTurn).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('keeps passive Card-front status inspection read-only for a retained terminal root', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    kanbanRecoveryMocks.reconcileTerminalKanbanRun.mockClear();
    kanbanMocks.startNativeHermesKanbanTurn.mockClear();
    orchestratorMocks.runRecords.set('run-failed-transport', {
      runId: 'run-failed-transport',
      correlationId: 'run-failed-transport',
      projectId: 'project-rejoin',
      deckId: 'deck_builder',
      cardId: 'card_hermes_steward',
      runtimeKind: 'hermes',
      runtimeMode: 'kanban',
      runtimeProfile: 'liquidaity-hermes-steward',
      state: 'failed',
      nativeRootId: 't_retained_root',
      nativePhase: 'failed',
      finalResult: null,
      startedAt: new Date().toISOString(),
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          inspectOnly: true,
          projectId: 'project-rejoin',
          deckId: 'deck_builder',
          runId: 'run-failed-transport',
        }),
      });
      await expect(response.json()).resolves.toMatchObject({
        result: {
          runId: 'run-failed-transport',
          nativeRootId: 't_retained_root',
          state: 'failed',
        },
      });
      expect(kanbanRecoveryMocks.reconcileTerminalKanbanRun).not.toHaveBeenCalled();
      expect(kanbanMocks.startNativeHermesKanbanTurn).not.toHaveBeenCalled();
      expect(orchestratorMocks.runRecords).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it('fails Kanban closed without retrying through ordinary ACP', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
    kanbanMocks.startNativeHermesKanbanTurn.mockRejectedValueOnce(
      new Error('hermes_kanban_gateway_not_running'),
    );
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_hermes_steward',
          correlationId: 'corr-steward-failed',
          conversationId: 'conversation-main-1',
          senderCardId: 'card_main_chat',
          input: 'Fail closed.',
          action: 'execute',
        }),
      });
      expect(response.status).toBe(502);
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      const failedFinish = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint, init]) => endpoint === '/domain/runs/finish'
          && JSON.parse(String(init?.body || '{}')).state === 'failed',
      );
      expect(failedFinish).toBeTruthy();
    } finally {
      await closeServer(server);
    }
  });

  it('runs the preserved Coder Card through one Python materialization', async () => {
    chatSessionMocks.startHermesTurn.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockClear();
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
          cardRevisionId: 'revision:card_local_coder',
        }),
      });

      expect(response.status).toBe(200);
      expect(chatSessionMocks.startHermesTurn).toHaveBeenCalledTimes(1);
      expect(chatSessionMocks.startHermesTurn.mock.calls[0]?.[0]).toMatchObject({
        cardId: 'card_local_coder',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
        tools: ['cbm.search_graph'],
        nativeTools: ['terminal'],
        toolsets: ['file', 'terminal'],
        message: '## Resolved CodeGraph\n- pkg.materialize_idf\n\nInspect the bounded code slice.',
      });
      expect(chatSessionMocks.startHermesTurn.mock.calls[0]?.[0]).not.toHaveProperty('skills');
      expect(chatSessionMocks.startHermesTurn.mock.calls[0]?.[0].toolsets).not.toContain('hermes-acp');
      expect(orchestratorMocks.dispatchConfiguredRuntime).not.toHaveBeenCalled();
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: true,
        result: {
          cardId: 'card_local_coder',
          runtimeOwner: 'hermes',
          output: 'Real assistant reply.',
          invocation: {
            resolvedGraphProjection: {
              nodes: [{ id: 'pkg.materialize_idf' }],
              edges: [],
            },
          },
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  it('hydrates one stored Coder result by Card identity without another Run or ACP turn', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    chatSessionMocks.startHermesTurn.mockClear();
    orchestratorMocks.runRecords.set('coder-graph-smoke-20260823-0736', {
      runId: 'coder-graph-smoke-20260823-0736',
      correlationId: 'coder-graph-smoke-20260823-0736',
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId: 'card_local_coder',
      runtimeKind: 'hermes',
      runtimeMode: 'delegate',
      runtimeProfile: 'coder',
      state: 'completed',
      finalResult: 'Exact stored native Coder result.',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_local_coder',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runId: 'coder-graph-smoke-20260823-0736',
          correlationId: 'coder-graph-smoke-20260823-0736',
          cardId: 'card_local_coder',
          state: 'completed',
          resultReady: true,
          output: 'Exact stored native Coder result.',
        },
      });
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      )).toBe(false);
      expect(orchestratorMocks.runRecords).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it('runs native Hermes /learn through the same materialized Coder Card turn', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    chatSessionMocks.dispatchHermesLearnCommand.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_local_coder',
          correlationId: 'corr-coder-learn',
          conversationId: 'main',
          input: '/learn study the bounded repository context',
        }),
      });

      expect(response.status).toBe(200);
      expect(chatSessionMocks.dispatchHermesLearnCommand).toHaveBeenCalledTimes(1);
      expect(chatSessionMocks.dispatchHermesLearnCommand).toHaveBeenCalledWith(
        'coder',
        'study the bounded repository context',
      );
      expect(chatSessionMocks.startHermesTurn).toHaveBeenCalledTimes(1);
      expect(chatSessionMocks.startHermesTurn.mock.calls[0]?.[0]).toMatchObject({
        cardId: 'card_local_coder',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
        message: '## Resolved CodeGraph\n- pkg.materialize_idf\n\nNATIVE LEARN PROMPT: study the bounded repository context',
      });
      const beginCalls = orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      );
      expect(beginCalls).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it('keeps a configured Hermes turn durable after request disconnect and records late native completion', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    chatSessionMocks.startHermesTurn.mockClear();
    let resolveTurn: (value: any) => void = () => undefined;
    const done = new Promise<any>((resolve) => {
      resolveTurn = resolve;
    });
    const cancel = vi.fn();
    chatSessionMocks.startHermesTurn.mockResolvedValueOnce({
      done,
      cancel,
      answer: vi.fn(),
      resolved: {
        cardId: 'card_local_coder',
        provider: 'openai',
        modelKey: 'gpt-5.6-luna',
        providerModelId: 'gpt-5.6-luna',
      },
    });
    const controller = new AbortController();
    const { server, baseUrl } = await createApiServer();
    try {
      const request = fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_local_coder',
          correlationId: 'corr-coder-cancelled',
          conversationId: 'main',
          input: 'Inspect one symbol.',
          action: 'execute',
        }),
      }).catch((error) => error);
      await vi.waitFor(() => expect(chatSessionMocks.startHermesTurn).toHaveBeenCalledTimes(1));
      controller.abort();
      await request;
      expect(cancel).not.toHaveBeenCalled();
      resolveTurn({
        finalText: 'late coder completion',
        usage: chatSessionMocks.usage,
        transport: {},
      });
      await vi.waitFor(() => {
        const finishCalls = orchestratorMocks.requestPythonRailsJson.mock.calls
          .filter(([endpoint]) => endpoint === '/domain/runs/finish')
          .map(([, init]) => JSON.parse(String(init?.body || '{}')))
          .filter((body) => body.runId === 'corr-coder-cancelled');
        expect(finishCalls).toHaveLength(1);
        expect(finishCalls[0]?.state).toBe('completed');
      });
    } finally {
      await closeServer(server);
    }
  });

  it('explicitly stops only the exact configured Hermes Run and rereads cancelled state', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    chatSessionMocks.startHermesTurn.mockClear();
    let rejectTurn: (error: Error) => void = () => undefined;
    const done = new Promise<any>((_resolve, reject) => {
      rejectTurn = reject;
    });
    chatSessionMocks.cancelHermesRun.mockImplementationOnce(() => rejectTurn(new Error('hermes_turn_cancelled')));
    chatSessionMocks.startHermesTurn.mockResolvedValueOnce({
      done,
      cancel: vi.fn(),
      answer: vi.fn(),
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const request = fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute', projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card_local_coder', correlationId: 'corr-coder-stopped',
          conversationId: 'main', input: 'Inspect one symbol.',
        }),
      });
      await vi.waitFor(() => expect(chatSessionMocks.startHermesTurn).toHaveBeenCalled());
      const stoppedResponse = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stop', projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card_local_coder', runId: 'corr-coder-stopped',
        }),
      });
      const stopped = await stoppedResponse.json() as any;
      expect(stoppedResponse.status, JSON.stringify(stopped)).toBe(202);
      expect(stopped.result).toMatchObject({
        runId: 'corr-coder-stopped', cardId: 'card_local_coder',
        state: 'running', status: 'stopping',
      });
      expect(chatSessionMocks.cancelHermesRun).toHaveBeenCalledWith('coder', 'corr-coder-stopped');
      await request;
      const finishCalls = orchestratorMocks.requestPythonRailsJson.mock.calls
        .filter(([endpoint]) => endpoint === '/domain/runs/finish')
        .map(([, init]) => JSON.parse(String(init?.body || '{}')))
        .filter((body) => body.runId === 'corr-coder-stopped');
      expect(finishCalls).toHaveLength(1);
      expect(finishCalls[0]).toMatchObject({
        state: 'cancelled', nativePhase: 'cancelled', errorCode: 'configured_card_run_stopped',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('exposes only the startup-owned saved Coder Hermes CLI ConPTY', async () => {
    ptyMocks.spawn.mockClear();
    mcpClientMocks.resolvePythonAgentMcpServerSpec.mockClear();
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.startHermesTurn.mockClear();
    const startupSession = ensurePersistentCoderTerminal();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/hermes/coder-terminal/sessions`);
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: startupSession.id,
          ownerCardId: 'card_local_coder',
          state: 'running',
          transportMode: 'pty',
          profile: 'coder',
          runtimeSource: 'repository_hermes_cli',
          executable: expect.stringMatching(/Hermes[\\/]venv[\\/]Scripts[\\/]hermes\.exe$/),
          hermesHome: expect.stringMatching(/Hermes[\\/]\.hermes$/),
          pid: expect.any(Number),
        }),
      ]));
      expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
      expect(ptyMocks.spawn.mock.calls[0]?.[0]).toMatch(/Hermes[\\/]venv[\\/]Scripts[\\/]hermes\.exe$/);
      expect(ptyMocks.spawn.mock.calls[0]?.[1]).toEqual([
        '-p', 'coder',
        'chat',
        '--cli',
        '--in', expect.any(String),
      ]);
      expect(ptyMocks.spawn.mock.calls[0]?.[2]).toMatchObject({
        useConpty: true,
        env: expect.objectContaining({
          HERMES_HOME: expect.stringMatching(/Hermes[\\/]\.hermes$/),
        }),
      });
      expect(ptyMocks.spawn.mock.calls[0]?.[0]).not.toMatch(/powershell/i);
      expect(mcpClientMocks.resolvePythonAgentMcpServerSpec).not.toHaveBeenCalled();
      expect(orchestratorMocks.requestPythonRailsJson).not.toHaveBeenCalled();
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      const createResponse = await fetch(`${baseUrl}/hermes/coder-terminal/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(createResponse.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });

  it('forwards raw terminal bytes only to PTY and keeps Main assignment on real ACP', async () => {
    chatSessionMocks.startHermesTurn.mockImplementation(async () => ({
      done: Promise.resolve({
        finalText: 'native coder output',
        usage: chatSessionMocks.usage,
        transport: {},
      }),
      cancel: chatSessionMocks.lastCancel,
      answer: vi.fn(),
      resolved: {
        cardId: 'card_local_coder',
        provider: 'openai',
        modelKey: 'gpt-5.6-luna',
        providerModelId: 'gpt-5.6-luna',
      },
    }));
    chatSessionMocks.startHermesTurn.mockClear();
    const spawnCount = ptyMocks.spawn.mock.calls.length;
    const startupSession = ensurePersistentCoderTerminal();
    expect(ptyMocks.spawn).toHaveBeenCalledTimes(spawnCount);
    const child = ptyMocks.children.find((candidate) => candidate.pid === startupSession.pid);
    if (!child) throw new Error('startup_terminal_child_missing');
    const { server, baseUrl } = await createApiServer();
    try {
      const outputController = new AbortController();
      const outputResponse = await fetch(
        `${baseUrl}/hermes/coder-terminal/sessions/${startupSession.id}/pty`,
        { signal: outputController.signal },
      );
      expect(outputResponse.status).toBe(200);
      expect(outputResponse.headers.get('content-type')).toBe('application/octet-stream');
      const reader = outputResponse.body?.getReader();
      expect(reader).toBeDefined();
      child.emitData('\u001b[32mreal Hermes PTY output\u001b[0m\r\n');
      const output = await reader!.read();
      expect(new TextDecoder().decode(output.value)).toBe(
        '\u001b[32mreal Hermes PTY output\u001b[0m\r\n',
      );

      const directResponse = await fetch(
        `${baseUrl}/hermes/coder-terminal/sessions/${startupSession.id}/input`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: 'Inspect one bounded symbol.\r' }),
        },
      );
      expect(directResponse.status).toBe(200);
      expect(child.write).toHaveBeenCalledWith('Inspect one bounded symbol.\r');

      const resizeResponse = await fetch(
        `${baseUrl}/hermes/coder-terminal/sessions/${startupSession.id}/resize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 166, rows: 47 }),
        },
      );
      expect(resizeResponse.status).toBe(200);
      expect(child.resize).toHaveBeenCalledWith(166, 47);

      const assignedResponse = await fetch(`${baseUrl}/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'terminal-project-shared',
          deckId: 'deck_builder',
          cardId: 'card_local_coder',
          senderCardId: 'card_main_chat',
          originatingRunId: 'main-parent-run',
          correlationId: 'main-coder-assignment',
          conversationId: 'main',
          input: 'Inspect a different bounded symbol.',
          action: 'execute',
          cardRevisionId: 'revision:card_local_coder',
        }),
      });
      expect(assignedResponse.status, await assignedResponse.text()).toBe(200);
      expect(chatSessionMocks.startHermesTurn).toHaveBeenCalledTimes(1);
      expect(chatSessionMocks.startHermesTurn.mock.calls[0]?.[0]).toMatchObject({
        cardId: 'card_local_coder',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
      });
      expect(child.write).toHaveBeenCalledTimes(1);
      const terminalSession = await fetch(
        `${baseUrl}/hermes/coder-terminal/sessions/${startupSession.id}`,
      ).then((response) => response.json());
      expect(terminalSession.session.state).toBe('running');
      expect(terminalSession).not.toHaveProperty('transcript');
      const stopResponse = await fetch(
        `${baseUrl}/hermes/coder-terminal/sessions/${startupSession.id}/stop`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      expect(stopResponse.status).toBe(404);
      expect(child.kill).not.toHaveBeenCalled();
      outputController.abort();
    } finally {
      await closeServer(server);
    }
  });

  it('sends the exact Python-retained root inputs to native Mag One', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockClear();
    const nativeRuntimeRequest = {
      session: {
        sessionId: 'deck_builder:card_magentic:corr-mag-1',
        projectId: 'project-1',
        deckId: 'deck_builder',
        cardId: 'card_magentic',
        turnId: 'corr-mag-1',
        runId: 'corr-mag-1',
        route: 'deck_runtime',
        orchestrator: 'magentic_one',
        startedAt: '2026-08-17T00:00:00Z',
      },
      inputFile: {
        workspace: 'C:\\runtime-inputs\\mag-root',
        idfPath: 'C:\\runtime-inputs\\mag-root\\in.idf',
        idfSha256: 'c'.repeat(64),
        idfBytes: 500,
      },
      participants: [],
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
    it('reads only the latest conversation-scoped native attention Run through AGE', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint: string) => {
        if (endpoint !== '/domain/agentgraph/inspect') return railsImplementation(endpoint);
        return {
          runs: [{ attentionEvents: [{
            eventId: 'attention-old', timestamp: '2026-08-21T11:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
            runId: 'run-old', cardId: 'card_local_coder', authority: 'codegraph',
            operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.old'], nativeEdgeIds: [], nativeEdges: [],
            resultHash: '0'.repeat(64), truncated: false,
          }, {
            eventId: 'attention-code', timestamp: '2026-08-21T12:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
            runId: 'run-1', cardId: 'card_local_coder', authority: 'codegraph',
            operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.alpha', 'pkg.beta'], nativeEdgeIds: ['calls-one'],
            nativeEdges: [{ id: 'calls-one', source: 'pkg.alpha', target: 'pkg.beta', predicate: 'CALLS' }],
            resultHash: 'a'.repeat(64), truncated: false,
          }, {
            eventId: 'attention-code', timestamp: '2026-08-21T12:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
            runId: 'run-1', cardId: 'card_local_coder', authority: 'codegraph',
            operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.alpha', 'pkg.beta'], nativeEdgeIds: ['calls-one'],
            nativeEdges: [{ id: 'calls-one', source: 'pkg.alpha', target: 'pkg.beta', predicate: 'CALLS' }],
            resultHash: 'a'.repeat(64), truncated: false,
          }, {
            eventId: 'attention-agent', timestamp: '2026-08-21T12:00:01Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
            runId: 'run-1', cardId: 'card_local_coder', authority: 'agentgraph',
            operation: 'read', toolName: 'agentgraph.inspect',
            nativeNodeIds: ['card_local_coder'], nativeEdgeIds: [],
            resultHash: 'b'.repeat(64), truncated: false,
          }, {
            eventId: 'attention-other-conversation', timestamp: '2026-08-21T13:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'other',
            runId: 'run-other', cardId: 'card_local_coder', authority: 'codegraph',
            operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.other'], nativeEdgeIds: [], nativeEdges: [],
            resultHash: 'c'.repeat(64), truncated: false,
          }] }],
        };
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/attention?projectId=project-1&deckId=deck_builder&conversationId=main`);
        const body = await response.json() as any;
        expect(response.status).toBe(200);
        expect(body.events).toEqual([expect.objectContaining({
          eventId: 'attention-code', authority: 'codegraph', nativeNodeIds: ['pkg.alpha', 'pkg.beta'],
          nativeEdges: [{ id: 'calls-one', source: 'pkg.alpha', target: 'pkg.beta', predicate: 'CALLS' }],
        })]);
        expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith('/domain/agentgraph/inspect',
          expect.objectContaining({ body: JSON.stringify({ projectId: 'project-1', deckId: 'deck_builder',
            limit: 50, conversationId: 'main' }) }));
      } finally {
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        await closeServer(server);
      }
    });

    it('streams the existing AGE contract for non-Main Cards and asks for direct current-Run scope', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint: string, init: any) => {
        if (endpoint !== '/domain/agentgraph/inspect') return railsImplementation(endpoint, init);
        expect(JSON.parse(init.body)).toEqual({ projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card-coder', directOnly: true, limit: 1 });
        return { runs: [{ runId: 'coder-run', projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card-coder', conversationId: 'coder-conversation', state: 'running',
          materializedNativeReferences: [{ authority: 'CodeGraph', nativeId: 'pkg.materialized' }],
          attentionEvents: [{ eventId: 'delete-event', timestamp: '2026-08-27T12:00:02Z',
            projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-coder', runId: 'coder-run',
            authority: 'knowgraph', operation: 'write', change: 'delete', toolName: 'graphiti.delete_episode',
            nativeNodeIds: ['episode-one'], nativeEdgeIds: [], resultHash: 'c'.repeat(64),
          }, { eventId: 'direct-event', timestamp: '2026-08-27T12:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-coder', runId: 'coder-run',
            authority: 'codegraph', operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.direct'], nativeEdgeIds: [], resultHash: 'a'.repeat(64),
          }, { eventId: 'child-event', timestamp: '2026-08-27T12:00:01Z', nativeChildId: 'native-child',
            projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-coder', runId: 'coder-run',
            authority: 'codegraph', operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.child'], nativeEdgeIds: [], resultHash: 'b'.repeat(64) }] }] };
      });
      const { server, baseUrl } = await createApiServer();
      const controller = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/main/session/attention?projectId=project-1&deckId=deck_builder&cardId=card-coder&stream=true`,
          { signal: controller.signal });
        const part = await response.body!.getReader().read();
        const body = new TextDecoder().decode(part.value);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
        expect(body).toContain('event: session');
        expect(body).toContain('pkg.materialized');
        expect(body).toContain('event: native_attention');
        expect(body).toContain('pkg.direct');
        expect(body).not.toContain('pkg.child');
        expect(body).not.toContain('child-event');
        expect(body.indexOf('direct-event')).toBeLessThan(body.indexOf('delete-event'));
      } finally {
        controller.abort();
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        await closeServer(server);
      }
    });

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
          runtime: { sessionId: 'native-main-session' },
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
        const frames = body.split('\n\n').filter((frame) => frame.startsWith('event: tool_result'));
        const event = JSON.parse(frames[0].split('\ndata: ')[1]);
        expect(event.terminalEvent).toMatchObject({ projectId: 'project-1', cardId: 'card_main_chat',
          runId: event.runId, kind: 'tool_result', toolUseId: 'tool-1', status: 'completed' });
        const sessionFrame = body.split('\n\n').find((frame) => frame.startsWith('event: session'))!;
        const session = JSON.parse(sessionFrame.split('\ndata: ')[1]);
        expect(session).toMatchObject({ runId: event.runId, sessionId: 'native-main-session',
          terminalEvent: { sessionId: 'native-main-session', runId: event.runId } });
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(([route, init]) => {
          if (route !== '/domain/runs/finish') return false;
          const payload = JSON.parse(String(init?.body));
          return payload.runId === event.runId && payload.finalResult === 'Done.' && payload.providerThreadRef === 'native-main-session';
        })).toBe(true);
      } finally {
        await closeServer(server);
      }
    });

    it('emits only compact Python-owned native attention events after a graph tool result', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint: string, init?: RequestInit) => {
        if (endpoint !== '/domain/agentgraph/inspect') return railsImplementation(endpoint, init);
        const request = JSON.parse(String(init?.body || '{}'));
        return {
          ok: true,
          runs: [{
            runId: request.runId,
            attentionEvents: [{
              eventId: 'native-attention:event-one',
              timestamp: '2026-08-18T12:00:00Z',
              projectId: request.projectId,
              deckId: request.deckId,
              conversationId: request.conversationId,
              runId: request.runId,
              cardId: 'card_main_chat',
              authority: 'codegraph',
              operation: 'read',
              toolName: 'cbm.search_graph',
              nativeNodeIds: ['pkg._runtime_owner'],
              nativeEdgeIds: [],
              resultHash: 'a'.repeat(64),
              truncated: false,
            }],
          }],
        };
      });
      chatSessionMocks.startHermesTurn.mockImplementationOnce(async (_params: unknown, onEvent: (event: any) => void) => {
        onEvent({
          kind: 'tool_result',
          toolName: 'mcp__main_runtime__cbm_search_graph',
          toolUseId: 'tool-1',
          output: 'human-readable ordinary tool output',
          isError: false,
        });
        return {
          done: Promise.resolve({ finalText: 'Done.', usage: chatSessionMocks.usage }),
          cancel: chatSessionMocks.lastCancel,
          answer: vi.fn(),
          resolved: {
            cardId: 'card_main_chat', provider: 'openai',
            modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
          },
        };
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'attention-event', message: 'inspect' }),
        });
        const body = await response.text();
        expect(body).toContain('event: native_attention');
        expect(body).toContain('"toolName":"cbm.search_graph"');
        expect(body).toContain('"nativeNodeIds":["pkg._runtime_owner"]');
        expect(body).not.toContain('results');
      } finally {
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        await closeServer(server);
      }
    });

    it('uses one Python materialization and keeps telemetry out of the model input', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.startHermesTurn.mockClear();
      chatSessionMocks.lastCancel.mockClear();
      mcpClientMocks.callPythonAgentMcpTool.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'main', message: 'hello',
            dataAnchors: [{
              authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
              reason: 'Current production definition', priority: 0,
              boundedExpansion: 1, resultLimit: 12, required: true,
            }],
          }),
        });
        expect(response.status).toBe(200);
        // Drain the SSE stream to completion.
        await response.text();

        expect(chatSessionMocks.startHermesTurn).toHaveBeenCalledTimes(1);
        expect(chatSessionMocks.startHermesTurn.mock.calls[0][0]).toMatchObject({
          sessionKey: 'project-1:main:card_main_chat',
          message: 'hello',
          prompt: 'Saved prompt',
          runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
        });
        const modelInput = JSON.stringify({
          prompt: chatSessionMocks.startHermesTurn.mock.calls[0][0].prompt,
          message: chatSessionMocks.startHermesTurn.mock.calls[0][0].message,
        });
        expect(modelInput).not.toContain('serialized-card');
        expect(modelInput).not.toContain('stableSavedCardContext');
        expect(modelInput).not.toContain('runId');
        expect(modelInput).not.toContain('correlationId');
        expect(modelInput.match(/Saved prompt/g)).toHaveLength(1);
        const railsCalls = orchestratorMocks.requestPythonRailsJson.mock.calls;
        expect(railsCalls.map(([endpoint]) => endpoint)).toEqual([
          '/domain/main/runs/begin',
          '/domain/runs/finish',
        ]);
        expect(railsCalls[0]?.[1]?.body).toContain('"message":"hello"');
        expect(JSON.parse(String(railsCalls[0]?.[1]?.body))).toMatchObject({
          dataAnchors: [{
            authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
            reason: 'Current production definition', required: true,
          }],
        });
        expect(railsCalls[1]?.[1]?.body).toContain('"state":"completed"');

        // The obsolete post-chat pair handoff must never fire from this route.
        expect(mcpClientMocks.callPythonAgentMcpTool).not.toHaveBeenCalled();
        expect(chatSessionMocks.lastCancel).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('ignores late ACP events after the SSE turn has completed', async () => {
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

    it('keeps Main running after the browser disconnects and persists native completion', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      let resolveTurn: (value: any) => void = () => undefined;
      const done = new Promise<any>((resolve) => {
        resolveTurn = resolve;
      });
      const cancel = vi.fn();
      chatSessionMocks.startHermesTurn.mockResolvedValueOnce({
        done,
        cancel,
        answer: vi.fn(),
        resolved: {
          cardId: 'card_main_chat', provider: 'openai',
          modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
        },
      });
      const controller = new AbortController();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'durable', message: 'hello' }),
        });
        await vi.waitFor(() => expect(chatSessionMocks.startHermesTurn).toHaveBeenCalled());
        controller.abort();
        resolveTurn({ finalText: 'Completed after disconnect.', usage: chatSessionMocks.usage, transport: {} });
        await vi.waitFor(() => {
          const finish = orchestratorMocks.requestPythonRailsJson.mock.calls
            .filter(([endpoint]) => endpoint === '/domain/runs/finish')
            .map(([, init]) => JSON.parse(String(init?.body || '{}')))
            .find((body) => body.state === 'completed');
          expect(finish).toBeTruthy();
        });
        expect(response.status).toBe(200);
        expect(cancel).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('stops the exact active Main turn only through the explicit Stop route', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      let rejectTurn: (error: Error) => void = () => undefined;
      const done = new Promise<any>((_resolve, reject) => {
        rejectTurn = reject;
      });
      chatSessionMocks.cancelHermesSession.mockImplementationOnce(() => {
        rejectTurn(new Error('hermes_turn_cancelled'));
        return 'run-main-stop';
      });
      chatSessionMocks.startHermesTurn.mockResolvedValueOnce({
        done,
        cancel: vi.fn(),
        answer: vi.fn(),
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const chatResponse = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'stop-main', message: 'hello' }),
        });
        await vi.waitFor(() => expect(chatSessionMocks.startHermesTurn).toHaveBeenCalled());
        const stopResponse = await fetch(`${baseUrl}/main/session/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', deckId: 'deck_builder', conversationId: 'stop-main' }),
        });
        const stopped = await stopResponse.json() as any;
        expect(stopResponse.status, JSON.stringify(stopped)).toBe(202);
        expect(stopped).toMatchObject({ ok: true, runId: 'run-main-stop', state: 'stopping' });
        expect(chatSessionMocks.cancelHermesSession).toHaveBeenCalledWith(
          'default',
          'project-1:stop-main:card_main_chat',
        );
        const stream = await chatResponse.text();
        expect(stream).toContain('harness_turn_cancelled');
        expect(stream).toContain('event: end');
        const cancelledFinishes = orchestratorMocks.requestPythonRailsJson.mock.calls
          .filter(([endpoint]) => endpoint === '/domain/runs/finish')
          .map(([, init]) => JSON.parse(String(init?.body || '{}')))
          .filter((body) => body.state === 'cancelled');
        expect(cancelledFinishes).toHaveLength(1);
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

    it('does not call the model when Python rails cannot begin the run', async () => {
      orchestratorMocks.requestPythonRailsJson
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
