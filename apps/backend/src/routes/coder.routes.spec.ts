import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
// Static imports: NodeNext ESM rejects extensionless dynamic import('./coder.routes')
// after the '.routes' infix strip. vitest hoists vi.mock() above these.
import router from './coder.routes';
import {
  ensurePersistentCoderTerminal,
  ensurePersistentMainTerminal,
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
        {
          id: 'card_agent_builder',
          kind: 'agent',
          templateId: 'template_agent_builder',
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'agent-builder' },
          runtimeOptions: {
            tools: ['card.create', 'card.update_configuration', 'canvas.upsert_wire'],
            nativeTools: ['memory'],
            skills: [],
            toolsets: ['hermes-acp', 'computer_use'],
            mcpConnectionIds: [],
            provider: 'openai',
            modelKey: 'gpt-5.6-luna',
          },
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
    materializeHermesProfileSelections: vi.fn(async () => ({
      native: { name: 'default', toolsets: [], mcp_servers: [] },
    })),
    requestHermesNative: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'profiles.describe') return {
        name: String(params?.name || 'agent-builder'),
        description: 'Agent Builder',
        soul: 'Build saved agents.',
        model: { provider: 'openai-codex', default: 'gpt-5.6-luna' },
        skills: [],
        toolsets: [],
        mcp_servers: [],
      };
      if (method === 'mcp.servers.list') return { servers: [] };
      if (method === 'learning.frames') return { count: 0, summary: '', buckets: [] };
      if (method === 'tools.show') return { sections: [] };
      if (method === 'plugins.list') return { plugins: [] };
      return {};
    }),
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

const mainCliBridgeMocks = vi.hoisted(() => ({
  history: vi.fn((): any => null),
  status: vi.fn(() => ({
    ready: true,
    activeDriver: null,
    activeContextAuthorityMode: null,
    runId: null,
  })),
  submit: vi.fn(async (args: any) => {
    args.onEvent({
      requestId: 'main-cli-request',
      runId: args.runId,
      kind: 'started',
      nativeSessionId: 'native-main-session',
      nativeTurnId: 'native-main-turn',
      contextAuthorityMode: args.driverSource === 'external_plugin'
        ? 'plugin_context_only'
        : 'main_native_honcho',
    });
    args.onEvent({
      requestId: 'main-cli-request',
      runId: args.runId,
      kind: 'projection',
      projection: {
        schemaVersion: 'liquidaity.main.projection.v1',
        id: `${args.runId}:answer:1`,
        category: 'conversation.answer',
        status: 'completed',
        sequence: 1,
        timestamp: '2026-08-31T12:00:00.000Z',
        text: 'Real assistant reply.',
      },
    });
    return {
      finalText: 'Real assistant reply.',
      nativeSessionId: 'native-main-session',
      nativeTurnId: 'native-main-turn',
      contextAuthorityMode: args.driverSource === 'external_plugin'
        ? 'plugin_context_only'
        : 'main_native_honcho',
    };
  }),
  requestCancel: vi.fn((_runId: string) => false),
}));

const kanbanMocks = vi.hoisted(() => ({
  readHermesKanbanCardSnapshots: vi.fn(async () => []),
}));
const kanbanRecoveryMocks = vi.hoisted(() => ({
  reconcileTerminalKanbanRun: vi.fn(() => true),
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
    if (endpoint === '/card-script/header') {
      return {
        schemaVersion: 'liquidaity.card-script.header.v1',
        version: 4,
        hash: 'a'.repeat(64),
        source: '# generated header',
        definitions: {},
        selectedTools: body.selectedTools,
        catalogToolCount: body.catalogTools?.length || 0,
        cardId: body.cardId || '',
      };
    }
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
      const graphAgent = cardId === 'card_hermes_steward';
      const agentBuilder = cardId === 'card_agent_builder';
      const builderTargetId = agentBuilder
        ? String(body.builderOperation?.targetCardId || '').trim()
        : '';
      const legacyKanban = cardId === 'card_legacy_kanban';
      const graphConfigured = graphAgent || legacyKanban;
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
           runtimeMode: mainChat ? 'main' : legacyKanban ? 'kanban' : 'delegate',
           runtimeProfile: mainChat ? 'default' : agentBuilder ? 'agent-builder'
             : graphConfigured ? 'liquidaity-hermes-steward' : 'coder',
           startedAt: new Date().toISOString(),
        });
      }
      return {
        runId: resolvedRunId,
        correlationId: runRecords.get(resolvedRunId)?.correlationId || body.correlationId,
        rejoined: Boolean(existingRunId),
        deckRevision: 'deck-revision-one',
        cardRevisionId: body.cardRevisionId,
        runtimeOwner: 'hermes',
        resolvedNativeReads: graphConfigured
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
            recordCounts: { total: coderCard || graphConfigured ? 2 : 0 }, authorities: [], records: [],
            modelText: graphConfigured
              ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
              : coderCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
          },
          stableSavedCardContext: {
            instructions: coderCard ? 'Saved Coder prompt' : 'Saved prompt',
            runtime: cardId === 'card_main_chat'
              ? { kind: 'hermes', mode: 'main', profile: 'default' }
              : coderCard
                ? { kind: 'hermes', mode: 'delegate', profile: 'coder' }
                : { kind: 'hermes', mode: legacyKanban ? 'kanban' : 'delegate', profile: 'liquidaity-hermes-steward' },
            provider: {
              accessMode: 'chatgpt-account', provider: 'openai',
              modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
            },
            runtimeOptions: {},
            outputRequirements: '',
          },
          selectedToolsAndGrants: {
            enabledTools: graphConfigured ? ['graphiti.search_nodes'] : coderCard ? ['cbm.search_graph'] : [],
            toolDefinitions: [],
            nativeTools: graphConfigured ? ['memory'] : coderCard ? ['terminal'] : [],
            skills: graphConfigured ? ['documentation'] : coderCard ? ['repository-coder'] : [],
            toolsets: coderCard ? ['file', 'terminal'] : [],
            mcpConnectionIds: [],
          },
          dynamicContext: {
            task: String(mainChat ? body.message || '' : body.assignment || ''),
            selectedCardTarget: builderTargetId ? {
              cardId: builderTargetId,
              cardRevisionId: `revision:${builderTargetId}`,
              deckRevision: 'deck-revision-one',
              title: 'Selected Assistant',
              templateId: 'template_assist',
              role: 'Selected specialist',
              prompt: 'Old prompt',
              runtime: { kind: 'autogen', mode: 'assistant' },
              runtimeOptions: { tools: [] },
            } : null,
          },
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
            graphContext: graphConfigured
              ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
              : coderCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
            task: String(mainChat ? body.message || '' : body.assignment || ''),
            buildTarget: builderTargetId ? {
              cardId: builderTargetId,
              cardRevisionId: `revision:${builderTargetId}`,
              deckRevision: 'deck-revision-one',
              title: 'Selected Assistant',
              templateId: 'template_assist',
              role: 'Selected specialist',
              prompt: 'Old prompt',
              runtime: { kind: 'autogen', mode: 'assistant' },
              runtimeOptions: { tools: [] },
            } : null,
            message: [
              graphConfigured
                ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
                : coderCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
              String(mainChat ? body.message || '' : body.assignment || ''),
            ].filter(Boolean).join('\n\n'),
            kanbanMission: legacyKanban ? [
              '## Resolved ThinkGraph',
              'Native bounded context for think-root-1.',
              '',
              String(body.assignment || ''),
            ].join('\n') : '',
            runtime: cardId === 'card_main_chat'
              ? { kind: 'hermes', mode: 'main', profile: 'default' }
              : coderCard
                ? { kind: 'hermes', mode: 'delegate', profile: 'coder' }
                : { kind: 'hermes', mode: legacyKanban ? 'kanban' : 'delegate',
                    profile: agentBuilder ? 'agent-builder' : 'liquidaity-hermes-steward' },
            provider: {
              accessMode: 'chatgpt-account', provider: 'openai',
              modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
            },
            runtimeOptions: {},
            enabledTools: agentBuilder ? ['card.update_configuration']
              : graphConfigured ? ['graphiti.search_nodes'] : coderCard ? ['cbm.search_graph'] : [],
            toolDefinitions: [], nativeTools: graphConfigured ? ['memory'] : coderCard ? ['terminal'] : [],
            skills: graphConfigured ? ['documentation'] : coderCard ? ['repository-coder'] : [],
            toolsets: coderCard ? ['file', 'terminal'] : [], mcpConnectionIds: [],
          },
          inputFile: {
            workspace: 'C:\\runtime-inputs\\root-run',
            idfPath: 'C:\\runtime-inputs\\root-run\\in.idf',
            idfSha256: 'a'.repeat(64), idfBytes: 400,
          },
          delegationTargets: cardId === 'card_main_chat' ? [{
            cardId: 'card_local_coder',
            cardRevisionId: 'revision:card_local_coder',
            title: 'Coder',
            profile: 'coder',
            description: 'Local repository patch/test execution',
          }] : [],
          cardIdentity: {
            cardId,
            title: cardId === 'card_main_chat' ? 'Main' : coderCard ? 'Coder'
              : graphAgent ? 'Graph Agent' : 'Retired Kanban history',
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
  buildHermesHostSessionProjection: (args: any, _env: unknown, executionContextId: string) => ({
    mcpServers: [{
      name: 'main-runtime-test', url: 'http://127.0.0.1:4000/mcp', headers: [],
    }],
    sessionMeta: { hermes: { sessionConfig: {
      enabledToolsets: ['mcp-main-runtime-test'],
      enabledTools: [],
      delegationRoles: [],
      hostSessionKey: args.sessionKey,
      systemPrompt: args.prompt,
      executionContextId,
      toolCallMeta: { 'host/execution-context': executionContextId },
    } } },
  }),
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
  materializeHermesProfileSelections: chatSessionMocks.materializeHermesProfileSelections,
  requestHermesNative: chatSessionMocks.requestHermesNative,
  startHermesTurn: chatSessionMocks.startHermesTurn,
}));

vi.mock('../hermes/mainCliBridge', () => ({
  contextAuthorityModeForDriver: (driverSource: string) => (
    driverSource === 'external_plugin' ? 'plugin_context_only' : 'main_native_honcho'
  ),
  mainCliBridge: mainCliBridgeMocks,
  mainCliBridgeToken: 'test-main-cli-bridge-token',
}));

vi.mock('./hermesKanban.routes', () => ({
  readHermesKanbanCardSnapshots: kanbanMocks.readHermesKanbanCardSnapshots,
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

  it('limits the Script IDE palette to the exact selected Card tools', async () => {
    mcpClientMocks.listPythonAgentMcpCatalog.mockResolvedValueOnce([{
      name: 'canvas.inspect',
      title: 'Inspect canvas',
      description: 'Read the saved canvas.',
      sourceId: 'liquidaity',
      namespace: 'canvas',
      nativeName: 'canvas.inspect',
      connectionKind: 'application-mcp',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    }, {
      name: 'card.update_configuration',
      title: 'Update Card',
      description: 'Update saved Card configuration.',
      sourceId: 'liquidaity',
      namespace: 'card',
      nativeName: 'card.update_configuration',
      connectionKind: 'application-mcp',
      inputSchema: { type: 'object', properties: { cardId: { type: 'string' } } },
      annotations: { readOnlyHint: false },
    }]);
    orchestratorMocks.requestPythonRailsJson
      .mockResolvedValueOnce({ tools: [] })
      .mockResolvedValueOnce({
        references: [{
          canonicalId: 'canvas.inspect', kind: 'tool', namespace: 'canvas',
          sourceIds: ['liquidaity'], displayName: 'Inspect canvas',
          shortDescription: 'Read the saved canvas.', availability: 'available', access: 'read',
          contracts: [{
            sourceId: 'liquidaity', nativeName: 'canvas.inspect', connectionKind: 'application-mcp',
            available: true, description: 'Read the saved canvas.', inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
          }],
        }, {
          canonicalId: 'card.update_configuration', kind: 'tool', namespace: 'card',
          sourceIds: ['liquidaity'], displayName: 'Update Card',
          shortDescription: 'Update saved Card configuration.', availability: 'available', access: 'write',
          contracts: [{
            sourceId: 'liquidaity', nativeName: 'card.update_configuration', connectionKind: 'application-mcp',
            available: true, description: 'Update saved Card configuration.',
            inputSchema: { type: 'object', properties: { cardId: { type: 'string' } } },
            annotations: { readOnlyHint: false },
          }],
        }],
      });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/input-data-dictionary/script-tools?policy=selected&selectedIds=canvas.inspect`);
      expect(response.status).toBe(200);
      const payload = await response.json() as any;
      expect(payload.ok).toBe(true);
      expect(payload.references.map((entry: any) => entry.canonicalId)).toEqual(['canvas.inspect']);
      expect(payload.paletteFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(payload.header).toMatchObject({
        schemaVersion: 'liquidaity.card-script.header.v1',
        selectedTools: ['canvas.inspect'],
      });
      const headerCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/card-script/header',
      );
      const headerBody = JSON.parse(String(headerCall?.[1]?.body || '{}'));
      expect(headerBody).toEqual(expect.objectContaining({
        selectedTools: ['canvas.inspect'],
        defaultAgentTools: ['canvas.inspect'],
      }));
    } finally { await closeServer(server); }
  });

  it('validates Card Python against the same selected-tool palette used by the editor', async () => {
    mcpClientMocks.listPythonAgentMcpCatalog.mockResolvedValueOnce([{
      name: 'canvas.inspect', title: 'Inspect canvas', description: 'Read the saved canvas.',
      sourceId: 'liquidaity', namespace: 'canvas', nativeName: 'canvas.inspect',
      connectionKind: 'application-mcp', inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    }]);
    orchestratorMocks.requestPythonRailsJson
      .mockResolvedValueOnce({ tools: [] })
      .mockResolvedValueOnce({
        references: [{
          canonicalId: 'canvas.inspect', kind: 'tool', namespace: 'canvas', sourceIds: ['liquidaity'],
          displayName: 'Inspect canvas', shortDescription: 'Read the saved canvas.',
          availability: 'available', access: 'read', contracts: [{
            sourceId: 'liquidaity', nativeName: 'canvas.inspect', connectionKind: 'application-mcp',
            available: true, description: 'Read the saved canvas.', inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
          }],
        }],
      })
      .mockResolvedValueOnce({
        enabled: true, version: 3, sourceHash: 'source-hash', compiledHash: 'compiled-hash',
        validation: { valid: true, errors: [], warnings: [] },
        compiled: { toolHandles: ['canvas.inspect'] },
      });
    const { server, baseUrl } = await createApiServer();
    try {
      const script = {
        enabled: true,
        version: 3,
        source: 'def run(input, tools, output):\n    output.emit(tools.call("canvas.inspect", {}))',
      };
      const response = await fetch(`${baseUrl}/card-script/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          selectedTools: ['canvas.inspect'],
          toolCatalogPolicy: 'selected',
          runtimeKind: 'hermes',
        }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json() as any;
      expect(payload.script.validation.valid).toBe(true);
      expect(payload.references.map((entry: any) => entry.canonicalId)).toEqual(['canvas.inspect']);
      const validationCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/card-script/validate',
      );
      const validationBody = JSON.parse(String(validationCall?.[1]?.body || '{}'));
      expect(validationBody).toEqual(expect.objectContaining({
        script,
        selectedTools: ['canvas.inspect'],
        defaultAgentTools: ['canvas.inspect'],
        nativeAvailable: true,
        paletteFingerprint: payload.paletteFingerprint,
      }));
    } finally { await closeServer(server); }
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
      const response = await fetch(
        `${baseUrl}/input-data-dictionary/card-editor?projectId=p&deckId=d&cardId=card_agent_builder`,
      );
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

  it.each(['card_local_coder', 'card_main_chat'])(
    'does not load the full Builder palette for ordinary Card %s', async (cardId) => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(
          `${baseUrl}/input-data-dictionary/card-editor?projectId=p&deckId=d&cardId=${cardId}`,
        );
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          ok: false,
          error: 'input_data_dictionary_card_editor_unavailable',
          fields: [],
          catalogs: { 'configured-models': [] },
        });
        expect(orchestratorMocks.requestPythonRailsJson).not.toHaveBeenCalledWith(
          '/idd/card-editor/materialize',
          expect.anything(),
        );
      } finally { await closeServer(server); }
    },
  );

  it('projects native discovery and preserves missing saved selections without rewriting the Card', async () => {
    const card = { id: 'custom', templateId: 'template_agent_builder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'agent-builder' },
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
      expect(body.selectedIds).toEqual([
        'template_agent_builder', 'removed.tool', 'model:openrouter:removed-model',
        'profile:agent-builder',
      ]);
      expect(body.nativeOptions).toEqual(expect.arrayContaining([{
        id: 'new.tool', kind: 'tool', owner: 'native-source', source: 'native-source', available: true,
        schema: { type: 'object', properties: { q: { type: 'string' } } },
      }, expect.objectContaining({
        id: 'profile:agent-builder', kind: 'profile', owner: 'Hermes', available: true,
      })]));
      expect(JSON.stringify(card)).toBe(before);
    } finally { await closeServer(server); }
  });

  it('returns an empty history only for a successful empty read', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    chatSessionMocks.readHermesHistory.mockClear();
    mainCliBridgeMocks.history.mockReturnValueOnce({ sessionId: null, messages: [], projections: [] });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true, sessionId: null, messages: [], terminalEvents: [],
      });
      expect(orchestratorMocks.requestPythonRailsJson).not.toHaveBeenCalled();
      expect(chatSessionMocks.readHermesHistory).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('returns a typed failure when the live Main CLI history snapshot is unavailable', async () => {
    mainCliBridgeMocks.history.mockReturnValueOnce(null);
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'main_cli_history_bridge_unavailable',
        messages: [],
      });
    } finally {
      await closeServer(server);
    }
  });

  it('does not expose conversation deletion outside the native Main CLI', async () => {
    chatSessionMocks.deleteHermesHistory.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(405);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'main_cli_history_is_native_owned',
      });
      expect(chatSessionMocks.deleteHermesHistory).not.toHaveBeenCalled();
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

  it('binds an Agent Builder Run to one selected Card snapshot', async () => {
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
          cardId: 'card_agent_builder',
          builderOperation: {
            mode: 'edit',
            expectedDeckRevision: 'deck-revision-one',
            targetCardId: 'card_selected_target',
            targetCardRevisionId: 'revision:card_selected_target',
            prompt: 'Updated prompt',
            tools: [],
          },
          correlationId: 'corr-builder-1',
          conversationId: 'main',
          input: 'Update the selected Card prompt and explicit tools.',
          action: 'execute',
        }),
      });

      expect(response.status).toBe(200);
      const beginCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      );
      expect(JSON.parse(String(beginCall?.[1]?.body || '{}'))).toMatchObject({
        cardId: 'card_agent_builder',
        builderOperation: {
          mode: 'edit',
          expectedDeckRevision: 'deck-revision-one',
          targetCardId: 'card_selected_target',
          targetCardRevisionId: 'revision:card_selected_target',
        },
      });
      expect(chatSessionMocks.startHermesTurn.mock.calls[0][0]).toMatchObject({
        cardId: 'card_agent_builder',
        buildTarget: {
          cardId: 'card_selected_target',
          cardRevisionId: 'revision:card_selected_target',
          deckRevision: 'deck-revision-one',
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  it('rejects the retired Kanban Card mode without creating a native root', async () => {
    chatSessionMocks.startHermesTurn.mockClear();

    const app = express();
    app.use(express.json());
    app.use('/api/coder', router);
    const server = app.listen(0);
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server_address_unavailable');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/coder/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-one',
          deckId: 'deck-one',
          cardId: 'card_legacy_kanban',
          action: 'execute',
          input: 'This mode is retired.',
          runId: 'run-retired',
          correlationId: 'correlation-retired',
        }),
      });
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: 'hermes_kanban_card_mode_retired',
      });
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('starts same-ID terminal reconciliation from status without creating another Run or root', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    kanbanRecoveryMocks.reconcileTerminalKanbanRun.mockClear();
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
    } finally {
      await closeServer(server);
    }
  });

  it('keeps passive Card-front status inspection read-only for a retained terminal root', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    kanbanRecoveryMocks.reconcileTerminalKanbanRun.mockClear();
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
      expect(orchestratorMocks.runRecords).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it('does not fall back to ordinary ACP for the retired Kanban Card mode', async () => {
    chatSessionMocks.startHermesTurn.mockClear();

    const app = express();
    app.use(express.json());
    app.use('/api/coder', router);
    const server = app.listen(0);
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server_address_unavailable');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/coder/mcp-bridge/run_configured_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-one',
          deckId: 'deck-one',
          cardId: 'card_legacy_kanban',
          action: 'execute',
          input: 'No fallback.',
          runId: 'run-retired-no-fallback',
          correlationId: 'correlation-retired-no-fallback',
        }),
      });
      expect(response.status).toBe(502);
      expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
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

    it('streams structured public text from the native Main CLI bridge with saved Card identity', async () => {
      chatSessionMocks.startHermesTurn.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'attention', message: 'inspect' }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('event: session');
        expect(body).toContain('event: projection');
        expect(body).toContain('Real assistant reply.');
        expect(body).not.toContain('terminalEvent');
        expect(body).not.toContain('event: tool_result');
        const sessionFrame = body.split('\n\n').find((frame) => frame.startsWith('event: session'))!;
        const session = JSON.parse(sessionFrame.split('\ndata: ')[1]);
        expect(session).toMatchObject({ cardId: 'card_main_chat', sessionId: 'native-main-session',
          nativeTurnId: 'native-main-turn', driverSource: 'internal_chat',
          contextAuthorityMode: 'main_native_honcho',
          configuration: { honchoTurnStatus: 'native_fail_open' } });
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(([route, init]) => {
          if (route !== '/domain/runs/finish') return false;
          const payload = JSON.parse(String(init?.body));
          return payload.runId === session.runId && payload.finalResult === 'Real assistant reply.'
            && payload.providerThreadRef === 'native-main-session';
        })).toBe(true);
        expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('drives the same Main CLI bridge from the authenticated external-plugin doorway', async () => {
      const priorSecret = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
      process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'test-external-main-secret-0123456789abcdef';
      orchestratorMocks.requestPythonRailsJson.mockClear();
      mainCliBridgeMocks.submit.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const denied = await fetch(`${baseUrl}/mcp-bridge/external_main_chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', deckId: 'deck_builder',
            conversationId: 'external-mcp:grant-1', mainCardId: 'card_main_chat',
            message: 'untrusted direct request',
          }),
        });
        expect(denied.status).toBe(401);
        expect(mainCliBridgeMocks.submit).not.toHaveBeenCalled();

        const response = await fetch(`${baseUrl}/mcp-bridge/external_main_chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-LiquidAIty-Internal-MCP-Secret': process.env.LIQUIDAITY_INTERNAL_MCP_SECRET,
          },
          body: JSON.stringify({
            projectId: 'project-1',
            deckId: 'deck_builder',
            conversationId: 'external-mcp:grant-1',
            mainCardId: 'card_main_chat',
            message: 'hello from the connector',
          }),
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          ok: true,
          cardId: 'card_main_chat',
          driverSource: 'external_plugin',
          contextAuthorityMode: 'plugin_context_only',
          finalText: 'Real assistant reply.',
          configuration: { honchoTurnStatus: 'bypassed' },
        });
        const begin = JSON.parse(String(
          orchestratorMocks.requestPythonRailsJson.mock.calls[0]?.[1]?.body,
        ));
        expect(begin).toMatchObject({
          projectId: 'project-1',
          deckId: 'deck_builder',
          conversationId: 'external-mcp:grant-1',
          driverSource: 'external_plugin',
          message: 'hello from the connector',
        });
        expect(mainCliBridgeMocks.submit).toHaveBeenCalledWith(expect.objectContaining({
          driverSource: 'external_plugin',
          message: 'hello from the connector',
        }));
      } finally {
        if (priorSecret === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
        else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = priorSecret;
        await closeServer(server);
      }
    });

    it('does not project CLI bytes or private tool traffic into Chat', async () => {
      mainCliBridgeMocks.submit.mockImplementationOnce(async (args: any) => {
        args.onEvent({ requestId: 'r', runId: args.runId, kind: 'text', delta: 'Public answer.' });
        return {
          finalText: 'Public answer.', nativeSessionId: 's', nativeTurnId: 't',
          contextAuthorityMode: 'main_native_honcho',
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
        expect(body).toContain('Public answer.');
        expect(body).not.toContain('tool_result');
        expect(body).not.toContain('native_attention');
        expect(body).not.toContain('\u001b[');
      } finally {
        await closeServer(server);
      }
    });

    it('uses one Python materialization and keeps telemetry out of the model input', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.startHermesTurn.mockClear();
      mainCliBridgeMocks.submit.mockClear();
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

        expect(mainCliBridgeMocks.submit).toHaveBeenCalledTimes(1);
        expect(mainCliBridgeMocks.submit.mock.calls[0][0]).toMatchObject({
          driverSource: 'internal_chat',
          message: 'hello',
        });
        const modelInput = JSON.stringify({
          message: mainCliBridgeMocks.submit.mock.calls[0][0].message,
        });
        expect(modelInput).not.toContain('serialized-card');
        expect(modelInput).not.toContain('stableSavedCardContext');
        expect(modelInput).not.toContain('runId');
        expect(modelInput).not.toContain('correlationId');
        const railsCalls = orchestratorMocks.requestPythonRailsJson.mock.calls;
        expect(railsCalls.map(([endpoint]) => endpoint)).toEqual([
          '/domain/main/runs/begin',
          '/domain/runs/finish',
        ]);
        expect(railsCalls[0]?.[1]?.body).toContain('"message":"hello"');
        expect(JSON.parse(String(railsCalls[0]?.[1]?.body))).toMatchObject({
          driverSource: 'internal_chat',
          dataAnchors: [{
            authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
            reason: 'Current production definition', required: true,
          }],
        });
        expect(railsCalls[1]?.[1]?.body).toContain('"state":"completed"');

        // The obsolete post-chat pair handoff must never fire from this route.
        expect(mcpClientMocks.callPythonAgentMcpTool).not.toHaveBeenCalled();
        expect(chatSessionMocks.startHermesTurn).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('ignores late structured bridge events after the SSE turn has completed', async () => {
      mainCliBridgeMocks.submit.mockImplementationOnce(async (args: any) => {
        setTimeout(() => args.onEvent({
          requestId: 'late', runId: args.runId, kind: 'text', delta: 'late native delta',
        }), 0);
        return {
          finalText: 'Finished before late event.',
          nativeSessionId: 'native-main-session',
          nativeTurnId: 'native-main-turn',
          contextAuthorityMode: 'main_native_honcho',
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
        expect(body).not.toContain('late native delta');
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
      mainCliBridgeMocks.submit.mockImplementationOnce(() => done);
      const controller = new AbortController();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'durable', message: 'hello' }),
        });
        await vi.waitFor(() => expect(mainCliBridgeMocks.submit).toHaveBeenCalled());
        controller.abort();
        resolveTurn({ finalText: 'Completed after disconnect.', nativeSessionId: 's', nativeTurnId: 't' });
        await vi.waitFor(() => {
          const finish = orchestratorMocks.requestPythonRailsJson.mock.calls
            .filter(([endpoint]) => endpoint === '/domain/runs/finish')
            .map(([, init]) => JSON.parse(String(init?.body || '{}')))
            .find((body) => body.state === 'completed');
          expect(finish).toBeTruthy();
        });
        expect(response.status).toBe(200);
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
      let activeRunId = '';
      mainCliBridgeMocks.submit.mockImplementationOnce((args: any) => {
        activeRunId = args.runId;
        return done;
      });
      mainCliBridgeMocks.requestCancel.mockImplementationOnce((runId: string) => {
        if (runId !== activeRunId) return false;
        rejectTurn(new Error('main_cli_turn_cancelled'));
        return true;
      });
      const terminal = ensurePersistentMainTerminal();
      expect(ptyMocks.spawn).toHaveBeenCalledWith(
        expect.stringMatching(/Hermes[\\/]venv[\\/]Scripts[\\/]hermes\.exe$/),
        ['-p', 'liquidaity-main', 'chat', '--cli', '--in', expect.any(String)],
        expect.objectContaining({
          env: expect.objectContaining({
            LIQUIDAITY_MAIN_BRIDGE_URL: 'http://127.0.0.1:4000/api/internal/main-cli',
            LIQUIDAITY_MAIN_BRIDGE_TOKEN: 'test-main-cli-bridge-token',
          }),
          useConpty: true,
        }),
      );
      const { server, baseUrl } = await createApiServer();
      try {
        const chatResponse = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'stop-main', message: 'hello' }),
        });
        await vi.waitFor(() => expect(mainCliBridgeMocks.submit).toHaveBeenCalled());
        const stopResponse = await fetch(`${baseUrl}/main/session/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRunId: activeRunId }),
        });
        const stopped = await stopResponse.json() as any;
        expect(stopResponse.status, JSON.stringify(stopped)).toBe(202);
        expect(stopped).toMatchObject({ ok: true, runId: activeRunId, state: 'stopping' });
        expect(mainCliBridgeMocks.requestCancel).toHaveBeenCalledWith(activeRunId);
        const child = ptyMocks.children.find((candidate: any) => candidate.pid === terminal.pid);
        expect(child.write).toHaveBeenCalledWith('\x03');
        const stream = await chatResponse.text();
        expect(stream).toContain('main_cli_turn_cancelled');
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

    it('emits a safe correlated SSE error when the native Main bridge fails', async () => {
      mainCliBridgeMocks.submit.mockRejectedValueOnce(new Error('provider credential leaked'));
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
        expect(body).toContain('main_cli_turn_failed');
        expect(body).toContain('"runId":"req_');
        expect(body).not.toContain('provider credential leaked');
      } finally {
        await closeServer(server);
      }
    });

    it('does not submit to the CLI when Python rails cannot begin the run', async () => {
      orchestratorMocks.requestPythonRailsJson
        .mockRejectedValueOnce(new Error('database unavailable'));
      mainCliBridgeMocks.submit.mockClear();
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
        });
        expect(mainCliBridgeMocks.submit).not.toHaveBeenCalled();
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
        expect(body).toContain('main_run_persistence_failed');
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
