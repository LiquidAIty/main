import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import cardRuntime, { internalMainMcpRoutes, mainRoutes } from './cardRuntime.routes';
import cardEditor, { iddRoutes } from './cardEditor.routes';
import codegraph from './codegraph.routes';

const router = express.Router()
  .use('/cards', cardEditor, cardRuntime)
  .use('/main', internalMainMcpRoutes, mainRoutes)
  .use('/idd', iddRoutes)
  .use('/codegraph', codegraph);

const deckMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(async () => ({
    deck: {
      workspaceRoot: process.cwd(),
      nodes: [
        {
          id: 'card_main_chat',
          _cardRevisionId: 'revision:card_main_chat',
          title: 'Main',
          templateId: 'template_main_chat',
          prompt: 'Saved Main prompt',
          kind: 'main',
          runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
          runtimeOptions: {},
        },
        {
          id: 'card_test_delegate',
          _cardRevisionId: 'revision:card_test_delegate',
          title: 'Delegate',
          templateId: 'template_agent',
          prompt: 'Saved Delegate prompt',
          kind: 'agent',
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
        },
        {
          id: 'builder',
          _cardRevisionId: 'revision:builder',
          title: 'Builder',
          prompt: 'Saved Builder prompt',
          kind: 'agent',
          templateId: 'template_assist',
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
          runtimeOptions: {
            tools: ['card.create', 'card.update_configuration', 'canvas.upsert_wire'],
            nativeTools: ['memory'],
            skills: [],
            toolsets: ['computer_use'],
            mcpConnectionIds: [],
            provider: 'openai',
            modelKey: 'gpt-5.6-luna',
          },
        },
      ],
      edges: [
        { id: 'flow-main-delegate', source: 'card_main_chat', target: 'card_test_delegate', edgeType: 'flow' },
        { id: 'flow-main-builder', source: 'card_main_chat', target: 'builder', edgeType: 'flow' },
      ],
    } as any,
  })),
}));

const agentTerminalMocks = vi.hoisted(() => {
  const staged = new Map<string, { runId: string; message: string; cardId: string }>();
  const completed = new Map<string, Record<string, unknown>>();
  const cancelled = new Set<string>();
  const gatewayListeners = new Set<(event: Record<string, unknown>) => void>();
  const profileFor = (cardId: string) => cardId === 'card_main_chat'
    ? 'default'
    : cardId === 'builder' ? 'builder'
      : cardId === 'card_hermes_steward' ? 'liquidaity-hermes-steward' : 'delegate';
  const stateFor = (owner: any) => ({
    sessionId: `terminal:${owner.cardId}`,
    cardId: owner.cardId,
    profile: profileFor(owner.cardId),
    pid: 9000,
    gatewayPid: 9000,
    tuiPid: 9001,
    ptyId: `pty:${owner.cardId}`,
    nativeSessionId: `native:${profileFor(owner.cardId)}`,
    storedSessionId: `native:${profileFor(owner.cardId)}`,
    hermesHome: `C:\\profiles\\${profileFor(owner.cardId)}`,
    unavailableToolReasons: {},
    status: 'running',
    cols: 120,
    rows: 36,
  });
  const find = vi.fn((owner: any): ReturnType<typeof stateFor> | null => stateFor(owner));
  const open = vi.fn(async (owner: any) => stateFor(owner));
  const findCard = vi.fn((projectId: string, deckId: string, cardId: string) => {
    const owner = { userId: 'owner-user', projectId, deckId, cardId };
    return { owner, state: stateFor(owner) };
  });
  const history = vi.fn(async () => ({ count: 0, messages: [] as Array<Record<string, unknown>> }));
  const dispatchLearn = vi.fn(async (_profile: string, request: string) => (
    `NATIVE LEARN PROMPT: ${request}`
  ));
  const requestProfile = vi.fn(async (profile: string, method: string) => {
    if (method === 'profiles.describe') return {
      name: profile,
      description: 'Saved profile',
      soul: 'Saved profile instructions.',
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
  });
  const verifyConfiguration = vi.fn();
  const interrupt = vi.fn(async () => undefined);
  const complete = (
    runId: string,
    owner: any,
    text: string,
    overrides: Record<string, unknown> = {},
  ) => completed.set(runId, {
    state: 'completed',
    finalResult: text,
    hermesSessionId: `native:${profileFor(owner.cardId)}`,
    nativeRootId: null,
    nativeRunId: null,
    effectiveProvider: 'openai-codex',
    providerApiMode: 'codex_responses',
    providerInputTokens: owner.cardId === 'builder' ? 240 : null,
    providerOutputTokens: owner.cardId === 'builder' ? 20 : null,
    providerCachedTokens: owner.cardId === 'builder' ? 100 : null,
    providerReasoningTokens: owner.cardId === 'builder' ? 5 : null,
    totalCostUsd: owner.cardId === 'builder' ? 0.012 : null,
    ...overrides,
  });
  const stage = vi.fn((owner: any, sessionId: string, profile: string, prepared: any) => {
    if (profile !== profileFor(owner.cardId)) throw new Error('agent_terminal_staged_run_identity_mismatch');
    const record = {
      runId: String(prepared.runId),
      message: String(prepared.hermesTransport.request.message),
      cardId: owner.cardId,
    };
    staged.set(sessionId, record);
    return { runId: record.runId, message: record.message };
  });
  const finishSubmitted = (
    owner: any,
    sessionId: string,
    message: string,
    options?: any,
    text = owner.cardId === 'builder' ? 'Builder reply' : 'Real assistant reply.',
    overrides: Record<string, unknown> = {},
    includeNativeDefaults = true,
  ) => {
    const record = staged.get(sessionId);
    if (!record || record.message !== message || record.cardId !== owner.cardId) {
      throw new Error('agent_terminal_staged_run_identity_mismatch');
    }
    const nativeFields = includeNativeDefaults ? {
      effectiveProvider: 'openai-codex',
      providerApiMode: 'codex_responses',
      providerInputTokens: owner.cardId === 'builder' ? 240 : null,
      providerOutputTokens: owner.cardId === 'builder' ? 20 : null,
      providerCachedTokens: owner.cardId === 'builder' ? 100 : null,
      providerReasoningTokens: owner.cardId === 'builder' ? 5 : null,
      totalCostUsd: owner.cardId === 'builder' ? 0.012 : null,
      ...overrides,
    } : overrides;
    options?.onEvent?.({
      type: 'message.delta',
      session_id: `native:${profileFor(owner.cardId)}`,
      payload: { text },
    });
    const event = { type: 'message.complete', session_id: `native:${profileFor(owner.cardId)}`,
      payload: {
        status: 'complete',
        text,
        usage: nativeFields,
        effectiveProvider: nativeFields.effectiveProvider,
        providerApiMode: nativeFields.providerApiMode,
        nativeRootId: nativeFields.nativeRootId,
        nativeRunId: nativeFields.nativeRunId,
      } };
    options?.onEvent?.(event);
    return { text, status: 'complete', event };
  };
  const submit = vi.fn(async (owner: any, sessionId: string, message: string, options?: any) => (
    finishSubmitted(owner, sessionId, message, options)
  ));
  const cancelStaged = vi.fn(async (
    sessionId: string,
    errorSummary: string,
    state: 'failed' | 'cancelled' = 'failed',
  ) => {
    const record = staged.get(sessionId);
    if (!record) return false;
    staged.delete(sessionId);
    completed.set(record.runId, { state, finalResult: null, errorSummary });
    return true;
  });
  const completeStaged = vi.fn(async (sessionId: string, nativeSessionId: string, result: any) => {
    const record = staged.get(sessionId);
    if (!record) throw new Error('agent_terminal_staged_run_missing');
    staged.delete(sessionId);
    const owner = { cardId: record.cardId };
    const usage = result.event?.payload?.usage || {};
    complete(record.runId, owner, result.text, usage);
    return {
      hermesSessionId: nativeSessionId,
      nativeRootId: result.event?.payload?.nativeRootId ?? null,
      nativeRunId: result.event?.payload?.nativeRunId ?? null,
      effectiveProvider: result.event?.payload?.effectiveProvider ?? null,
      providerApiMode: result.event?.payload?.providerApiMode ?? null,
      inputTokens: usage.providerInputTokens ?? null,
      outputTokens: usage.providerOutputTokens ?? null,
      cachedTokens: usage.providerCachedTokens ?? null,
      reasoningTokens: usage.providerReasoningTokens ?? null,
      costUsd: usage.totalCostUsd ?? null,
    };
  });
  const abort = vi.fn(async () => undefined);
  const ownsRun = vi.fn((sessionId: string, runId: string) => (
    staged.get(sessionId)?.runId === runId || completed.has(runId)
  ));
  const requestCancellation = vi.fn((_sessionId: string, runId: string) => {
    cancelled.add(runId);
  });
  const activeRunId = vi.fn((sessionId: string) => staged.get(sessionId)?.runId || null);
  const subscribeGatewayEvents = vi.fn((_owner: any, _sessionId: string, listener: any) => {
    gatewayListeners.add(listener);
    return () => gatewayListeners.delete(listener);
  });
  const emitGatewayEvent = (event: Record<string, unknown>) => {
    for (const listener of gatewayListeners) listener(event);
  };
  const resolveHermesBotRosterProjections = vi.fn(async () => ([
    {
      cardId: 'card_main_chat', cardRevisionId: 'revision:card_main_chat',
      profile: 'default', title: 'Main', botEnabled: true,
      roster: ['delegate', 'builder'],
    },
    {
      cardId: 'card_test_delegate', cardRevisionId: 'revision:card_test_delegate',
      profile: 'delegate', title: 'Delegate', botEnabled: true, roster: ['default'],
    },
    {
      cardId: 'builder', cardRevisionId: 'revision:builder',
      profile: 'builder', title: 'Builder', botEnabled: true, roster: ['default'],
    },
  ]));
  return {
    staged, completed, cancelled, gatewayListeners, emitGatewayEvent,
    profileFor, stateFor, complete, finishSubmitted,
    manager: {
      find, findCard, open, history, verifyConfiguration, submit, interrupt,
      dispatchLearn, requestProfile, subscribeGatewayEvents,
    },
    resolveHermesBotRosterProjections,
    execution: { stage, completeStaged, cancelStaged, abort, ownsRun, requestCancellation, activeRunId },
  };
});

const chatSessionMocks = vi.hoisted(() => {
  const usage = {
    providerInputTokens: null,
    providerOutputTokens: null,
    totalCostUsd: null,
    usageAvailable: false,
    usageSource: 'unavailable',
    contextBreakdownJson: '',
  };
  return {
    getConversationMessages: vi.fn(async () => []),
    appendSharedConversationTurn: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    usage,
  };
});

const kanbanMocks = vi.hoisted(() => ({
  readHermesKanbanCardSnapshots: vi.fn(async () => []),
}));
const mcpClientMocks = vi.hoisted(() => {
  const listPythonAgentMcpCatalog = vi.fn(async (): Promise<any[]> => []);
  return {
  callPythonAgentMcpTool: vi.fn(async () => ({ ok: true })),
  listPythonAgentMcpCatalog,
  readPythonAgentMcpCatalog: vi.fn(async () => {
    try {
      return { state: 'available' as const, tools: await listPythonAgentMcpCatalog() };
    } catch {
      return { state: 'unavailable' as const, tools: [], reason: 'catalog_unavailable' as const };
    }
  }),
  resolvePythonAgentMcpServerSpec: vi.fn(() => ({
    type: 'http',
    url: 'http://127.0.0.1:8765/mcp',
    headers: { Authorization: 'Bearer test-builder-terminal-token' },
  })),
  };
});

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
      const agentBuilder = cardId === 'builder';
      const legacyKanban = cardId === 'card_legacy_kanban';
      const graphConfigured = graphAgent || legacyKanban;
      const delegateCard = cardId === 'card_test_delegate';
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
           runtimeProfile: mainChat ? 'default' : agentBuilder ? 'builder'
             : graphConfigured ? 'liquidaity-hermes-steward' : 'delegate',
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
          : delegateCard ? [{ authority: 'CodeGraph', nativeId: 'pkg.materialize_idf' }] : [],
        resolvedGraphProjection: {
          schemaVersion: 'native-card-context.v1',
          authority: 'mixed',
          projectId: body.projectId,
          nodes: delegateCard ? [{ id: 'pkg.materialize_idf', label: 'materialize_idf', mentionCount: 1 }] : [],
          edges: [],
          counts: { nodes: delegateCard ? 1 : 0, edges: 0 },
        },
        idf: {
          actualGraphData: {
            recordCounts: { total: delegateCard || graphConfigured ? 2 : 0 }, authorities: [], records: [],
            modelText: graphConfigured
              ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
              : delegateCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
          },
          stableSavedCardContext: {
            instructions: delegateCard ? 'Saved Delegate prompt' : 'Saved prompt',
            runtime: cardId === 'card_main_chat'
              ? { kind: 'hermes', mode: 'main', profile: 'default' }
              : delegateCard
                ? { kind: 'hermes', mode: 'delegate', profile: 'delegate' }
                : { kind: 'hermes', mode: legacyKanban ? 'kanban' : 'delegate', profile: 'liquidaity-hermes-steward' },
            provider: {
              accessMode: 'chatgpt-account', provider: 'openai',
              modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
            },
            runtimeOptions: {},
            outputRequirements: '',
          },
          selectedToolsAndGrants: {
            enabledTools: graphConfigured ? ['graphiti.search_nodes'] : delegateCard ? ['cbm.search_graph'] : [],
            toolDefinitions: [],
            nativeTools: graphConfigured ? ['memory'] : delegateCard ? ['terminal'] : [],
            skills: graphConfigured ? ['documentation'] : delegateCard ? ['repository-delegate'] : [],
            toolsets: delegateCard ? ['file', 'terminal'] : [],
            mcpConnectionIds: [],
          },
          dynamicContext: {
            task: String(mainChat ? body.message || '' : body.assignment || ''),

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
            systemPrompt: delegateCard ? 'Saved Delegate prompt' : 'Saved prompt',
            outputRequirements: '',
            graphContext: graphConfigured
              ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
              : delegateCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
            task: String(mainChat ? body.message || '' : body.assignment || ''),
            message: [
              graphConfigured
                ? '## Resolved ThinkGraph\nNative bounded context for think-root-1.'
                : delegateCard ? '## Resolved CodeGraph\n- pkg.materialize_idf' : '',
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
              : delegateCard
                ? { kind: 'hermes', mode: 'delegate', profile: 'delegate' }
                : { kind: 'hermes', mode: legacyKanban ? 'kanban' : 'delegate',
                    profile: agentBuilder ? 'builder' : 'liquidaity-hermes-steward' },
            provider: {
              accessMode: 'chatgpt-account', provider: 'openai',
              modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
            },
            runtimeOptions: {},
            enabledTools: agentBuilder ? ['card.update_configuration']
              : graphConfigured ? ['graphiti.search_nodes'] : delegateCard ? ['cbm.search_graph'] : [],
            toolDefinitions: [], nativeTools: graphConfigured ? ['memory'] : delegateCard ? ['terminal'] : [],
            skills: graphConfigured ? ['documentation'] : delegateCard ? ['repository-delegate'] : [],
            toolsets: delegateCard ? ['file', 'terminal'] : [], mcpConnectionIds: [],
          },
          inputFile: {
            workspace: 'C:\\runtime-inputs\\root-run',
            idfPath: 'C:\\runtime-inputs\\root-run\\in.idf',
            idfSha256: 'a'.repeat(64), idfBytes: 400,
          },
          cardIdentity: {
            cardId,
            title: cardId === 'card_main_chat' ? 'Main' : agentBuilder ? 'Builder' : delegateCard ? 'Delegate'
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
      for (const [runId, completion] of agentTerminalMocks.completed) {
        const existing = runRecords.get(runId);
        if (existing) runRecords.set(runId, { ...existing, ...completion, finishedAt: new Date().toISOString() });
      }
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
  query: vi.fn(async (sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> => {
    const projectId = String(params?.[0] || '');
    const ownerMatches = !sql.includes('owner_user_id = $2') || params?.[1] === 'owner-user';
    return {
      rows: projectId === 'project-1' && ownerMatches
        ? [{ id: projectId, name: 'Owned project', code: null, status: 'active',
            project_type: 'agent', owner_user_id: 'owner-user' }]
        : [],
    };
  }),
}));

vi.mock('../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckMocks.getDeckDocument,
}));

vi.mock('../conversations/store', () => ({
  appendSharedConversationTurn: chatSessionMocks.appendSharedConversationTurn,
  getConversationMessages: chatSessionMocks.getConversationMessages,
  listConversations: chatSessionMocks.listConversations,
}));

vi.mock('../hermes/agentTerminal', () => ({
  agentTerminalManager: agentTerminalMocks.manager,
  agentTerminalPresentationOptions: (_card: any, attachTui: boolean) => ({ attachTui }),
  requireAgentTerminalCard: (card: any) => {
    if (card?.runtime?.kind !== 'hermes' || !String(card?.runtime?.profile || '').trim()) {
      throw new Error('agent_terminal_card_runtime_unsupported');
    }
    return String(card.runtime.profile).trim();
  },
  resolveHermesBotRosterProjections: agentTerminalMocks.resolveHermesBotRosterProjections,
}));

vi.mock('../hermes/agentTerminalExecution', () => ({
  agentTerminalExecution: agentTerminalMocks.execution,
}));

vi.mock('./hermesKanban.routes', () => ({
  readHermesKanbanCardSnapshots: kanbanMocks.readHermesKanbanCardSnapshots,
}));

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  callPythonAgentMcpTool: mcpClientMocks.callPythonAgentMcpTool,
  listPythonAgentMcpCatalog: mcpClientMocks.listPythonAgentMcpCatalog,
  readPythonAgentMcpCatalog: mcpClientMocks.readPythonAgentMcpCatalog,
  resolvePythonAgentMcpServerSpec: mcpClientMocks.resolvePythonAgentMcpServerSpec,
}));

vi.mock('node-pty', () => ({ spawn: ptyMocks.spawn }));

vi.mock('../services/autogen/pythonRailsClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/autogen/pythonRailsClient')>(),
  ...orchestratorMocks,
}));

vi.mock('../db/pool', () => ({
  pool: { query: dbMocks.query },
}));

async function createApiServer(userId: string | null = 'owner-user'): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).userId = userId; next(); });
  app.use('/api', router);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('saved Card routes', () => {
  it.each([{ userId: null, status: 401 }])(
    'requires an authenticated local session for Main history and chat ($userId)', async ({ userId, status }) => {
      const { server, baseUrl } = await createApiServer(userId);
      agentTerminalMocks.manager.history.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      try {
        for (const endpoint of ['history', 'conversations', 'chat']) {
          const response = await fetch(`${baseUrl}/main/session/${endpoint}?projectId=project-1&conversationId=main`,
            endpoint === 'chat' ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: 'project-1', conversationId: 'main', message: 'hello' }) } : {});
          expect(response.status).toBe(status);
        }
        expect(agentTerminalMocks.manager.history).not.toHaveBeenCalled();
        expect(orchestratorMocks.requestPythonRailsJson).not.toHaveBeenCalled();
      } finally { await closeServer(server); }
    });

  it('projects only user and assistant messages from the one native Main Card session', async () => {
    agentTerminalMocks.manager.history.mockResolvedValueOnce({ count: 3, messages: [
      { role: 'user', text: 'Question' },
      { role: 'tool', text: 'private tool event' },
      { role: 'assistant', text: 'Answer' },
    ] });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/main/session/history?projectId=project-1&conversationId=other`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: true,
        sessionId: 'native:default',
        runtimeSessionId: 'terminal:card_main_chat',
        mainCardId: 'card_main_chat',
        messages: [
          { role: 'user', text: 'Question', speaker: { kind: 'user', label: 'You' },
            target: { cardId: 'card_main_chat', label: 'Main' } },
          { role: 'assistant', text: 'Answer', speaker: { cardId: 'card_main_chat', label: 'Main' } },
        ],
        terminalEvents: [],
      });
      expect(payload.addressableAgents).toEqual(expect.arrayContaining([
        expect.objectContaining({ cardId: 'builder', profile: 'builder', address: 'builder' }),
      ]));
      expect(agentTerminalMocks.manager.history).toHaveBeenCalledWith(
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat' },
        'terminal:card_main_chat',
      );
    } finally { await closeServer(server); }
  });

  it('reloads the persisted direct Builder exchange with the original speaker identities', async () => {
    chatSessionMocks.getConversationMessages.mockResolvedValueOnce([
      {
        role: 'user', status: 'complete', content: '@builder Reply exactly BUILDER_DIRECT_OK',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
          { kind: 'shared_chat_target', status: 'card', label: 'Builder', cardId: 'builder',
            profile: 'builder', address: 'builder' },
        ],
      },
      {
        role: 'assistant', status: 'complete', content: 'BUILDER_DIRECT_OK',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'card', label: 'Builder', cardId: 'builder',
            profile: 'builder', address: 'builder' },
        ],
      },
    ] as any);
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=direct-builder`,
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.messages).toEqual([
        {
          role: 'user', text: '@builder Reply exactly BUILDER_DIRECT_OK',
          speaker: { kind: 'user', label: 'You' },
          target: {
            kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder', address: 'builder',
          },
        },
        {
          role: 'assistant', text: 'BUILDER_DIRECT_OK',
          speaker: {
            kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder', address: 'builder',
          },
        },
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it('projects an exact autonomous native Main Gateway event without submitting another turn', async () => {
    agentTerminalMocks.manager.subscribeGatewayEvents.mockClear();
    agentTerminalMocks.manager.submit.mockClear();
    const { server, baseUrl } = await createApiServer();
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await fetch(
        `${baseUrl}/main/session/events?projectId=project-1&deckId=deck_builder`
          + '&conversationId=main&runtimeSessionId=terminal%3Acard_main_chat'
          + '&nativeSessionId=native%3Adefault',
        { signal: controller.signal },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(agentTerminalMocks.manager.subscribeGatewayEvents).toHaveBeenCalledWith(
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat' },
        'terminal:card_main_chat',
        expect.any(Function),
      );
      agentTerminalMocks.emitGatewayEvent({
        type: 'message.complete', session_id: 'native:default', seq: 9,
        payload: { text: 'Native Builder reply.' },
      });
      reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let body = '';
      for (let attempt = 0; attempt < 4 && !body.includes('event: gateway'); attempt += 1) {
        const part = await reader.read();
        if (part.done) break;
        body += decoder.decode(part.value, { stream: true });
      }
      expect(body).toContain('event: gateway');
      expect(body).toContain('"runtimeSessionId":"terminal:card_main_chat"');
      expect(body).toContain('"nativeSessionId":"native:default"');
      expect(body).toContain('"type":"message.complete"');
      expect(body).toContain('Native Builder reply.');
      expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
    } finally {
      await reader?.cancel().catch(() => undefined);
      controller.abort();
      await closeServer(server);
    }
  });

  it('rejects a stale application runtime identity before subscribing to native events', async () => {
    agentTerminalMocks.manager.subscribeGatewayEvents.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/events?projectId=project-1&deckId=deck_builder`
          + '&conversationId=main&runtimeSessionId=stale-runtime&nativeSessionId=native%3Adefault',
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        ok: false, error: 'main_gateway_runtime_identity_mismatch',
      });
      expect(agentTerminalMocks.manager.subscribeGatewayEvents).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('rejects a stale native Hermes session identity before subscribing to native events', async () => {
    agentTerminalMocks.manager.subscribeGatewayEvents.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/events?projectId=project-1&deckId=deck_builder`
          + '&conversationId=main&runtimeSessionId=terminal%3Acard_main_chat'
          + '&nativeSessionId=stale-native-session',
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        ok: false, error: 'main_gateway_native_session_identity_mismatch',
      });
      expect(agentTerminalMocks.manager.subscribeGatewayEvents).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('serves Main Chat at its own namespace', async () => {
    const { server, baseUrl } = await createApiServer();
    const origin = new URL(baseUrl).origin;
    try {
      const response = await fetch(`${origin}/api/main/session/driver?projectId=project-1`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true });
    } finally {
      await closeServer(server);
    }
  });

  it('observes the same ordinary Card Run through status without executing or rejoining another root', async () => {
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.set('terminal-root', {
      runId: 'terminal-root', projectId: 'p', deckId: 'd', cardId: 'research', state: 'running',
      runtimeKind: 'hermes', runtimeMode: 'delegate', runtimeProfile: 'research',
      startedAt: '2026-09-15T00:00:00Z',
      terminal: { cardName: 'Research', activeChildren: 1, parentRunIds: [], children: [{
        runId: 'child-run', cardId: 'research', cardName: 'Research', parentRunId: 'terminal-root',
        nativeChildId: 'native-child', state: 'running', startedAt: '2026-09-15T00:00:01Z',
      }] },
    });
    const { server, baseUrl } = await createApiServer();
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`${baseUrl}/cards/run`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            action: 'status', projectId: 'p', deckId: 'd', runId: 'terminal-root', includeTerminal: true, inspectOnly: true,
          }),
        });
        const body = await response.json() as any;
        expect(response.status).toBe(200);
        expect(body.result.terminal).toMatchObject({ runId: 'terminal-root', activeAgentCount: 2,
          events: [
            { id: 'terminal-root:session', kind: 'session', status: 'running' },
            { id: 'child-run:start', kind: 'child_started', nativeChildId: 'native-child' },
          ] });
      }
      expect(orchestratorMocks.requestPythonRailsJson.mock.calls.every(([route]) =>
        route === '/domain/runs/read' || route === '/domain/agentgraph/inspect')).toBe(true);
    } finally { await closeServer(server); }
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
      const response = await fetch(`${baseUrl}/idd/tools?selectedIds=calculator,missing.tool`);
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
      const response = await fetch(`${baseUrl}/idd/script-tools?policy=selected&selectedIds=canvas.inspect`);
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
        lastValidation: { status: 'valid', executionTested: false, errors: [], toolHandles: ['canvas.inspect'] },
        nativeSupport: {
          available: false, active: false, executor: null,
          reason: 'card_script_native_bridge_unavailable',
        },
        compiled: { toolHandles: ['canvas.inspect'] },
      });
    const { server, baseUrl } = await createApiServer();
    try {
      const script = {
        enabled: true,
        version: 3,
        source: 'def run(input, tools, output):\n    output.emit(tools.call("canvas.inspect", {}))',
      };
      const response = await fetch(`${baseUrl}/cards/script/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          selectedTools: ['canvas.inspect'],
          runtimeKind: 'hermes',
        }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json() as any;
      expect(payload.script.lastValidation.status).toBe('valid');
      expect(payload.script.nativeSupport).toMatchObject({
        available: false,
        active: false,
        reason: 'card_script_native_bridge_unavailable',
      });
      expect(payload.references.map((entry: any) => entry.canonicalId)).toEqual(['canvas.inspect']);
      const validationCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/card-script/validate',
      );
      const validationBody = JSON.parse(String(validationCall?.[1]?.body || '{}'));
      expect(validationBody).toEqual(expect.objectContaining({
        script,
        selectedTools: ['canvas.inspect'],
        defaultAgentTools: ['canvas.inspect'],
        nativeAvailable: false,
        paletteFingerprint: payload.paletteFingerprint,
      }));
    } finally { await closeServer(server); }
  });

  it('serves ordinary card-editor options without a Card read, full palette, or native tool discovery', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    deckMocks.getDeckDocument.mockClear();
    mcpClientMocks.listPythonAgentMcpCatalog.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/options`);
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
    } finally { await closeServer(server); }
  });

  it.each([null, new Error('sk-secret')])('fails ordinary card-editor options closed with a secret-safe error (%s)', async (failure) => {
    if (failure instanceof Error) orchestratorMocks.requestPythonRailsJson.mockRejectedValueOnce(failure);
    else orchestratorMocks.requestPythonRailsJson.mockResolvedValueOnce(failure);
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/options`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: 'runtime_options_unavailable' });
    } finally { await closeServer(server); }
  });

  it('materializes the full Builder card-editor palette through the literal IDD boundary', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/idd/card-editor?projectId=p&deckId=d&cardId=builder`,
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

  it('loads the selected ordinary Hermes Card catalog using its actual profile', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/idd/card-editor?projectId=p&deckId=d&cardId=card_main_chat`);
      expect(response.status).toBe(200);
      const call = orchestratorMocks.requestPythonRailsJson.mock.calls.find(([endpoint]) => endpoint === '/idd/card-editor/materialize');
      const body = JSON.parse(String(call?.[1]?.body));
      expect(body.selectedIds).toContain('profile:default');
    } finally { await closeServer(server); }
  });

  it('returns the current catalog for an AutoGen Card without loading a Hermes profile', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce({ deck: { nodes: [{ id: 'assistant',
      templateId: 'template_assist', runtime: { kind: 'autogen', mode: 'assistant' },
      runtimeOptions: { tools: ['canvas.inspect'] } }], edges: [] } } as any);
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/idd/card-editor?projectId=p&deckId=d&cardId=assistant`);
      expect(response.status).toBe(200);
      const call = orchestratorMocks.requestPythonRailsJson.mock.calls.find(([endpoint]) => endpoint === '/idd/card-editor/materialize');
      const body = JSON.parse(String(call?.[1]?.body));
      expect(body.selectedIds).toEqual(['template_assist', 'canvas.inspect']);
      expect(body.nativeOptions.some((option: any) => option.kind === 'profile')).toBe(false);
    } finally { await closeServer(server); }
  });

  it('projects native discovery and preserves missing saved selections without rewriting the Card', async () => {
    const card = { id: 'custom', templateId: 'removed_template',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
      runtimeOptions: { tools: ['removed.tool'], nativeTools: [], provider: 'openrouter', modelKey: 'removed-model' } };
    const before = JSON.stringify(card);
    deckMocks.getDeckDocument.mockResolvedValueOnce({ deck: { nodes: [card], edges: [] } } as any);
    mcpClientMocks.listPythonAgentMcpCatalog.mockResolvedValueOnce([{
      name: 'new.tool', sourceId: 'native-source', inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    }]);
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/idd/card-editor?projectId=p&deckId=d&cardId=custom`);
      expect(response.status).toBe(200);
      const call = orchestratorMocks.requestPythonRailsJson.mock.calls.find(([endpoint]) => endpoint === '/idd/card-editor/materialize');
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.selectedIds).toEqual([
        'removed_template', 'removed.tool', 'model:openrouter:removed-model',
        'profile:builder',
      ]);
      expect(body.nativeOptions).toEqual(expect.arrayContaining([{
        id: 'new.tool', kind: 'tool', owner: 'native-source', source: 'native-source', available: true,
        schema: { type: 'object', properties: { q: { type: 'string' } } },
      }, expect.objectContaining({
        id: 'profile:builder', kind: 'profile', owner: 'Hermes', available: true,
      })]));
      expect(JSON.stringify(card)).toBe(before);
    } finally { await closeServer(server); }
  });

  it('returns an empty history only for a successful empty read', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    agentTerminalMocks.manager.history.mockResolvedValueOnce({ count: 0, messages: [] });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true, sessionId: 'native:default', runtimeSessionId: 'terminal:card_main_chat',
        mainCardId: 'card_main_chat', messages: [], terminalEvents: [],
      });
      expect(orchestratorMocks.requestPythonRailsJson).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('returns a typed failure when the live Main Chat history snapshot is unavailable', async () => {
    agentTerminalMocks.manager.history.mockRejectedValueOnce(new Error('gateway_history_unavailable'));
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'main_cli_history_read_failed',
        messages: [],
      });
    } finally {
      await closeServer(server);
    }
  });

  it('does not expose conversation deletion outside the native Main Chat', async () => {
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
    } finally {
      await closeServer(server);
    }
  });

  it('returns the exact retained root inputs for one selected Run', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
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
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
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
          receipt: null,
        },
      });
      expect(agentTerminalMocks.execution.stage).toHaveBeenCalledWith(
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat' },
        'terminal:card_main_chat',
        'default',
        expect.objectContaining({ runId: 'corr-main-1' }),
        'main',
      );
      expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'card_main_chat' }),
        'terminal:card_main_chat',
        'Use saved Main.',
        expect.any(Object),
      );
      const beginCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      );
      expect(JSON.parse(String(beginCall?.[1]?.body || '{}'))).toMatchObject({
        assignment: 'Use saved Main.',
      });
      expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(
        ([endpoint]) => endpoint === '/domain/runs/finish',
      )).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  it('runs an ordinary Builder mission and forwards native usage once', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.execution.stage.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'builder',
          correlationId: 'corr-builder-1',
          conversationId: 'main',
          input: 'Update the selected Card prompt and explicit tools.',
          action: 'execute',
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json() as any;
      const beginCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      );
      expect(JSON.parse(String(beginCall?.[1]?.body || '{}'))).toMatchObject({
        cardId: 'builder',
        assignment: 'Update the selected Card prompt and explicit tools.',
      });
      expect(agentTerminalMocks.manager.submit).toHaveBeenCalledOnce();
      expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder' },
        'terminal:builder',
        'Update the selected Card prompt and explicit tools.',
        expect.any(Object),
      );
      expect(agentTerminalMocks.completed.get('corr-builder-1')).toMatchObject({
        state: 'completed', finalResult: 'Builder reply',
        providerInputTokens: 240, providerOutputTokens: 20,
        providerCachedTokens: 100, providerReasoningTokens: 5, totalCostUsd: 0.012,
      });
      expect(agentTerminalMocks.execution.stage).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'builder' }),
        'terminal:builder',
        'builder',
        expect.not.objectContaining({ builderOperation: expect.anything() }),
        'main',
      );
      expect(payload.result.transport).toMatchObject({
        terminalSessionId: 'terminal:builder', hermesSessionId: 'native:builder',
        effectiveProvider: 'openai-codex', providerApiMode: 'codex_responses',
      });

    } finally {
      await closeServer(server);
    }
  });

  it('runs a Builder construction mission without prewritten values and preserves unknown usage', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.execution.stage.mockClear();
    agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, message, options) => (
      agentTerminalMocks.finishSubmitted(owner, sessionId, message, options, 'Builder reply', {
        providerInputTokens: null,
        providerOutputTokens: null,
        providerCachedTokens: null,
        providerReasoningTokens: null,
        totalCostUsd: null,
      })
    ));
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'builder',
          correlationId: 'corr-builder-create-1',
          conversationId: 'main',
          input: 'Create one ordinary saved Assistant Card.',
          action: 'execute',
        }),
      });

      expect(response.status).toBe(200);
      expect(agentTerminalMocks.manager.submit).toHaveBeenCalledOnce();
      expect(agentTerminalMocks.completed.get('corr-builder-create-1')).toMatchObject({
        providerInputTokens: null, providerOutputTokens: null, totalCostUsd: null,
      });
      const staged = agentTerminalMocks.execution.stage.mock.calls[0]?.[3];
      expect(staged).not.toHaveProperty('builderOperation');
      expect(staged).not.toHaveProperty('buildTarget');
      expect(staged).not.toHaveProperty('effectTarget');

    } finally {
      await closeServer(server);
    }
  });

  it.each(['builderOperation', 'agentBuilderOperation', 'buildTarget', 'selectedCardTarget',
    'effectTarget', 'effectTargetCardId', 'effectTargetCardRevisionId', 'effectTargetDeckRevision'])(
    'rejects retired %s arguments before preparing or starting a Run', async (field) => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/cards/run`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', deckId: 'deck_builder',
            cardId: 'builder', correlationId: 'retired-packet',
            conversationId: 'main', input: 'Inspect the saved Card.', action: 'execute',
            [field]: { mode: 'edit' } }),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ ok: false,
          error: `card_run_fields_retired:${field}` });
        expect(orchestratorMocks.requestPythonRailsJson).not.toHaveBeenCalled();
      } finally { await closeServer(server); }
    });

  it('rejects the retired Kanban Card mode without creating a native root', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce({
      deck: {
        workspaceRoot: process.cwd(),
        nodes: [{
          id: 'card_legacy_kanban',
          runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
          runtimeOptions: {},
        }],
        edges: [],
      } as any,
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
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
    } finally {
      await closeServer(server);
    }
  });
  it('keeps passive Card-front status inspection read-only for a retained terminal root', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
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
      const response = await fetch(`${baseUrl}/cards/run`, {
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
      expect(orchestratorMocks.runRecords).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it.each([true, false])('uses only the conversation-scoped native Run selection (found=%s)', async (found) => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    const scoped = { runId: 'conversation-run', cardId: 'builder', conversationId: 'one',
      startedAt: '2026-09-07T12:00:00Z', state: 'completed', finalResult: 'This conversation',
      projectId: 'p', deckId: 'd', runtimeKind: 'hermes', runtimeMode: 'delegate', runtimeProfile: 'builder' };
    orchestratorMocks.runRecords.set('unrelated-run', { ...scoped, runId: 'unrelated-run', conversationId: 'two',
      finalResult: 'Other conversation', startedAt: '2026-09-07T13:00:00Z' });
    orchestratorMocks.runRecords.set(scoped.runId, scoped);
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint, init) => {
      expect(endpoint).toBe('/domain/agentgraph/inspect');
      expect(JSON.parse(String(init?.body))).toEqual({ projectId: 'p', deckId: 'd', cardId: 'builder',
        conversationId: 'one', directOnly: true, limit: 1 });
      return { runs: found ? [scoped] : [] };
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', inspectOnly: true, projectId: 'p', deckId: 'd',
          cardId: 'builder', conversationId: 'one' }),
      });
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      if (found) {
        expect(payload.result).toMatchObject({ runId: scoped.runId, conversationId: 'one',
          startedAt: scoped.startedAt, output: scoped.finalResult });
        const calls = orchestratorMocks.requestPythonRailsJson.mock.calls;
        expect(calls.map(([endpoint]) => endpoint)).toEqual(['/domain/agentgraph/inspect', '/domain/runs/read']);
        expect(JSON.parse(String(calls[1][1]?.body))).toMatchObject({ runId: scoped.runId });
      } else {
        expect(payload.result).toBeNull();
        expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledTimes(1);
      }
    } finally { await closeServer(server); }
  });

  it.each([
    { label: 'unknown', raw: null, expected: null },
    { label: 'explicit zero', raw: 0, expected: 0 },
  ])('preserves $label configured-Run cost and tool count', async ({ label, raw, expected }) => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    const runId = `usage-${label.replace(' ', '-')}`;
    orchestratorMocks.runRecords.set(runId, {
      runId,
      correlationId: runId,
      projectId: 'p',
      deckId: 'd',
      cardId: 'builder',
      runtimeKind: 'hermes',
      runtimeMode: 'delegate',
      runtimeProfile: 'builder',
      state: 'completed',
      finalResult: 'Done.',
      startedAt: '2026-09-10T12:00:00Z',
      finishedAt: '2026-09-10T12:00:01Z',
      toolCallCount: raw,
      totalCostUsd: raw,
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', inspectOnly: true,
          projectId: 'p', deckId: 'd', runId }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: { runId, toolCallCount: expected, costUsd: expected },
      });
    } finally { await closeServer(server); }
  });

  it('does not fall back to an ordinary Gateway turn for the retired Kanban Card mode', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
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
    } finally {
      await closeServer(server);
    }
  });
  it('runs the saved delegate Agent through one Python materialization', async () => {
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.execution.stage.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_test_delegate',
          senderCardId: 'card_main_chat',
          correlationId: 'corr-delegate-1',
          conversationId: 'main',
          input: 'Inspect the bounded code slice.',
          action: 'execute',
          cardRevisionId: 'revision:card_test_delegate',
        }),
      });

      expect(response.status).toBe(200);
      expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_test_delegate' },
        'terminal:card_test_delegate',
        '## Resolved CodeGraph\n- pkg.materialize_idf\n\nInspect the bounded code slice.',
        expect.any(Object),
      );
      const staged = agentTerminalMocks.execution.stage.mock.calls[0]?.[3];
      expect(staged.hermesTransport.request).toMatchObject({
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
        enabledTools: ['cbm.search_graph'],
        nativeTools: ['terminal'],
        toolsets: ['file', 'terminal'],
        skills: ['repository-delegate'],
      });
      expect(staged.hermesTransport.cardIdentity).toMatchObject({ cardId: 'card_test_delegate' });
      expect(orchestratorMocks.dispatchConfiguredRuntime).not.toHaveBeenCalled();
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: true,
        result: {
          cardId: 'card_test_delegate',
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

  it('hydrates one stored Delegate result by Card identity without another Run or Gateway turn', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.runRecords.set('delegate-graph-smoke-20260823-0736', {
      runId: 'delegate-graph-smoke-20260823-0736',
      correlationId: 'delegate-graph-smoke-20260823-0736',
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId: 'card_test_delegate',
      runtimeKind: 'hermes',
      runtimeMode: 'delegate',
      runtimeProfile: 'delegate',
      state: 'completed',
      finalResult: 'Exact stored native Delegate result.',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_test_delegate',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runId: 'delegate-graph-smoke-20260823-0736',
          correlationId: 'delegate-graph-smoke-20260823-0736',
          cardId: 'card_test_delegate',
          state: 'completed',
          resultReady: true,
          output: 'Exact stored native Delegate result.',
        },
      });
      expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      )).toBe(false);
      expect(orchestratorMocks.runRecords).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it('runs native Hermes /learn through the same materialized Delegate Card turn', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    agentTerminalMocks.manager.dispatchLearn.mockClear();
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.execution.stage.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_test_delegate',
          correlationId: 'corr-delegate-learn',
          conversationId: 'main',
          input: '/learn study the bounded repository context',
        }),
      });

      expect(response.status).toBe(200);
      expect(agentTerminalMocks.manager.dispatchLearn).toHaveBeenCalledTimes(1);
      expect(agentTerminalMocks.manager.dispatchLearn).toHaveBeenCalledWith(
        'delegate',
        'study the bounded repository context',
      );
      expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'card_test_delegate' }),
        'terminal:card_test_delegate',
        '## Resolved CodeGraph\n- pkg.materialize_idf\n\nNATIVE LEARN PROMPT: study the bounded repository context',
        expect.any(Object),
      );
      expect(agentTerminalMocks.execution.stage.mock.calls[0]?.[3].hermesTransport.request).toMatchObject({
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
      });
      expect(agentTerminalMocks.execution.stage.mock.calls[0]?.[3].hermesTransport.cardIdentity)
        .toMatchObject({ cardId: 'card_test_delegate' });
      const beginCalls = orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
        ([endpoint]) => endpoint === '/domain/runs/begin',
      );
      expect(beginCalls).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });

  it.each(['completed', 'failed'] as const)('accepts a background handoff before its native %s result and retains that result', async (state) => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    agentTerminalMocks.manager.submit.mockClear();
    let settle: (value: any) => void = () => undefined;
    let fail: (reason: Error) => void = () => undefined;
    const done = new Promise<any>((resolve, reject) => { settle = resolve; fail = reject; });
    agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, _message, _options) => {
      const record = agentTerminalMocks.staged.get(sessionId);
      if (!record) throw new Error('agent_terminal_staged_run_identity_mismatch');
      agentTerminalMocks.staged.delete(sessionId);
      try {
        await done;
        agentTerminalMocks.complete(record.runId, owner, 'Native graph proposal');
        return { text: 'Native graph proposal', status: 'completed', event: {
          type: 'message.complete', session_id: sessionId,
          payload: {
            status: 'completed', text: 'Native graph proposal', usage: {},
            effectiveProvider: 'openai-codex', providerApiMode: null,
            nativeRootId: null, nativeRunId: null,
          },
        } };
      } catch (error) {
        agentTerminalMocks.completed.set(record.runId, {
          state: 'failed', finalResult: null,
          errorSummary: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
    const { server, baseUrl } = await createApiServer();
    const controller = new AbortController();
    try {
      const request = fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ action: 'execute', projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card_test_delegate', correlationId: `background-${state}`, conversationId: 'main',
          senderCardId: 'card-main', originatingRunId: 'parent-run', input: 'Inspect graph evidence.', background: true }),
      });
      let response: Response | undefined;
      void request.then((value) => { response = value; }).catch(() => undefined);
      await vi.waitFor(() => expect(response).toBeDefined(), { timeout: 1500 });
      expect(response!.status).toBe(202);
      const accepted = await response!.json() as any;
      expect(accepted.result).toMatchObject({ runId: `background-${state}`, state: 'running', acceptedAt: expect.any(String) });
      expect(agentTerminalMocks.completed.has(`background-${state}`)).toBe(false);
      await vi.waitFor(() => expect(agentTerminalMocks.manager.submit).toHaveBeenCalledTimes(1));
      if (state === 'completed') settle({ finalText: 'Native graph proposal', usage: chatSessionMocks.usage, transport: {} });
      else fail(new Error('native failure'));
      await vi.waitFor(() => {
        expect(agentTerminalMocks.completed.get(`background-${state}`)).toMatchObject({ state });
      });
    } finally {
      controller.abort();
      settle({ finalText: 'cleanup', usage: chatSessionMocks.usage, transport: {} });
      await closeServer(server);
    }
  });

  it('keeps a configured Hermes turn durable after request disconnect and records late native completion', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.manager.interrupt.mockClear();
    let resolveTurn: (value: any) => void = () => undefined;
    const done = new Promise<any>((resolve) => {
      resolveTurn = resolve;
    });
    agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, _message, _options) => {
      const record = agentTerminalMocks.staged.get(sessionId);
      if (!record) throw new Error('agent_terminal_staged_run_identity_mismatch');
      agentTerminalMocks.staged.delete(sessionId);
      await done;
      agentTerminalMocks.complete(record.runId, owner, 'late delegate completion');
      return {
        text: 'late delegate completion', status: 'completed',
        event: { type: 'message.complete', session_id: sessionId,
          payload: {
            status: 'completed', text: 'late delegate completion', usage: {},
            effectiveProvider: 'openai-codex', providerApiMode: null,
            nativeRootId: null, nativeRunId: null,
          } },
      };
    });
    const controller = new AbortController();
    const { server, baseUrl } = await createApiServer();
    try {
      const request = fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_test_delegate',
          correlationId: 'corr-delegate-cancelled',
          conversationId: 'main',
          input: 'Inspect one symbol.',
          action: 'execute',
        }),
      }).catch((error) => error);
      await vi.waitFor(() => expect(agentTerminalMocks.manager.submit).toHaveBeenCalledTimes(1));
      controller.abort();
      await request;
      expect(agentTerminalMocks.manager.interrupt).not.toHaveBeenCalled();
      resolveTurn({
        finalText: 'late delegate completion',
        usage: chatSessionMocks.usage,
        transport: {},
      });
      await vi.waitFor(() => {
        expect(agentTerminalMocks.completed.get('corr-delegate-cancelled')).toMatchObject({
          state: 'completed', finalResult: 'late delegate completion',
        });
      });
    } finally {
      await closeServer(server);
    }
  });

  it('explicitly stops only the exact configured Hermes Run and rereads cancelled state', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestFingerprints.clear();
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.manager.interrupt.mockClear();
    agentTerminalMocks.execution.requestCancellation.mockClear();
    agentTerminalMocks.execution.cancelStaged.mockClear();
    let rejectTurn: (error: Error) => void = () => undefined;
    const done = new Promise<any>((_resolve, reject) => {
      rejectTurn = reject;
    });
    agentTerminalMocks.manager.submit.mockImplementationOnce(async () => done);
    agentTerminalMocks.manager.interrupt.mockImplementationOnce(async () => {
      rejectTurn(new Error('hermes_turn_cancelled'));
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const request = fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute', projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card_test_delegate', correlationId: 'corr-delegate-stopped',
          conversationId: 'main', input: 'Inspect one symbol.',
        }),
      });
      await vi.waitFor(() => expect(agentTerminalMocks.manager.submit).toHaveBeenCalled());
      const stoppedResponse = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stop', projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card_test_delegate', runId: 'corr-delegate-stopped',
        }),
      });
      const stopped = await stoppedResponse.json() as any;
      expect(stoppedResponse.status, JSON.stringify(stopped)).toBe(202);
      expect(stopped.result).toMatchObject({
        runId: 'corr-delegate-stopped', cardId: 'card_test_delegate',
        state: 'running', status: 'stopping',
      });
      expect(agentTerminalMocks.execution.requestCancellation).toHaveBeenCalledWith(
        'terminal:card_test_delegate',
        'corr-delegate-stopped',
      );
      expect(agentTerminalMocks.manager.interrupt).toHaveBeenCalledWith(
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_test_delegate' },
        'terminal:card_test_delegate',
      );
      await request;
      expect(agentTerminalMocks.execution.cancelStaged).toHaveBeenCalledWith(
        'terminal:card_test_delegate',
        'hermes_turn_cancelled',
        'cancelled',
      );
      expect(agentTerminalMocks.completed.get('corr-delegate-stopped')).toMatchObject({
        state: 'cancelled', errorSummary: 'hermes_turn_cancelled',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('routes Builder through the common Card-owned Gateway without the retired Builder terminal owner', async () => {
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.execution.stage.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'terminal-project-shared', deckId: 'deck_builder', cardId: 'builder',
          correlationId: 'builder-common-gateway', conversationId: 'main',
          input: 'Inspect the selected Card.', action: 'execute',
        }),
      });
      expect(response.status).toBe(200);
      expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
        { userId: 'owner-user', projectId: 'terminal-project-shared', deckId: 'deck_builder', cardId: 'builder' },
        'terminal:builder',
        'Inspect the selected Card.',
        expect.any(Object),
      );
      expect(agentTerminalMocks.execution.stage).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'builder' }),
        'terminal:builder',
        'builder',
        expect.any(Object),
        'main',
      );
    } finally {
      await closeServer(server);
    }
  });

  it('keeps programmatic Card turns on the structured Gateway entrance and out of raw PTY input', async () => {
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.execution.stage.mockClear();
    ptyMocks.spawn.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const assignedResponse = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'terminal-project-shared',
          deckId: 'deck_builder',
          cardId: 'card_test_delegate',
          senderCardId: 'card_main_chat',
          originatingRunId: 'main-parent-run',
          correlationId: 'main-delegate-assignment',
          conversationId: 'main',
          input: 'Inspect a different bounded symbol.',
          action: 'execute',
          cardRevisionId: 'revision:card_test_delegate',
        }),
      });
      expect(assignedResponse.status, await assignedResponse.text()).toBe(200);
      expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
        { userId: 'owner-user', projectId: 'terminal-project-shared', deckId: 'deck_builder', cardId: 'card_test_delegate' },
        'terminal:card_test_delegate',
        '## Resolved CodeGraph\n- pkg.materialize_idf\n\nInspect a different bounded symbol.',
        expect.any(Object),
      );
      expect(agentTerminalMocks.execution.stage.mock.calls[0]?.[3].hermesTransport.cardIdentity)
        .toMatchObject({ cardId: 'card_test_delegate' });
      expect(ptyMocks.spawn).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('sends the exact Python-retained root inputs to native Mag One', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockResolvedValueOnce({
      ok: true, runId: 'corr-mag-1', finalResponseText: 'Native Mag One response.',
      stopReason: 'Native completion',
      runtimeEvidence: { stage: 'completed', usage: { inputTokens: 11, outputTokens: 7 } },
      resultArtifact: { artifact_id: 'native-result-one' },
    });
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
      const response = await fetch(`${baseUrl}/cards/run`, {
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
          stopReason: 'Native completion',
          runtimeEvidence: { stage: 'completed' },
          resultArtifact: { artifact_id: 'native-result-one' },
        },
      });
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith(
        '/domain/runs/finish', expect.objectContaining({ body: expect.stringContaining('"providerInputTokens":11') }),
      );
    } finally {
      await closeServer(server);
    }
  });

  it('persists native Mag One safe failure stage without claiming completion', async () => {
    const { ConfiguredRuntimeFailure } = await import('../services/autogen/pythonRailsClient.js');
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async () => ({
      runId: 'failed-native-root', runtimeOwner: 'mag_one',
      nativeRuntimeRequest: { session: { runId: 'failed-native-root' } },
    }));
    orchestratorMocks.dispatchConfiguredRuntime.mockRejectedValueOnce(new ConfiguredRuntimeFailure({
      ok: false, runId: 'failed-native-root', error: 'magentic_run_failed',
      runtimeEvidence: { stage: 'native_stream', failure: { failure_code: 'codex_app_server_turn_failed' } },
    }));
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_magentic',
          correlationId: 'failed-native-root', input: 'Bounded test mission', action: 'execute' }),
      });
      expect(response.status).toBe(502);
      const finish = orchestratorMocks.requestPythonRailsJson.mock.calls
        .filter(([path]) => path === '/domain/runs/finish')
        .map(([, init]) => JSON.parse(String(init?.body)))
        .find((body) => body.runId === 'failed-native-root');
      expect(finish).toMatchObject({ state: 'failed', nativePhase: 'native_stream',
        errorCode: 'codex_app_server_turn_failed', errorSummary: 'magentic_run_failed' });
    } finally {
      await closeServer(server);
    }
  });

  it('resolves the OAuth identity grant and saved Main card without loading its runtime grants', async () => {
    const priorSecret = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'test-main-context-secret-0123456789abcdef';
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
      const response = await fetch(`${baseUrl}/main/context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LiquidAIty-Internal-MCP-Secret': process.env.LIQUIDAITY_INTERNAL_MCP_SECRET,
        },
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
      if (priorSecret === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
      else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = priorSecret;
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
            runId: 'run-old', cardId: 'card_test_delegate', authority: 'codegraph',
            operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.old'], nativeEdgeIds: [], nativeEdges: [],
            resultHash: '0'.repeat(64), truncated: false,
          }, {
            eventId: 'attention-code', timestamp: '2026-08-21T12:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
            runId: 'run-1', cardId: 'card_test_delegate', authority: 'codegraph',
            operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.alpha', 'pkg.beta'], nativeEdgeIds: ['calls-one'],
            nativeEdges: [{ id: 'calls-one', source: 'pkg.alpha', target: 'pkg.beta', predicate: 'CALLS' }],
            resultHash: 'a'.repeat(64), truncated: false,
          }, {
            eventId: 'attention-code', timestamp: '2026-08-21T12:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
            runId: 'run-1', cardId: 'card_test_delegate', authority: 'codegraph',
            operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.alpha', 'pkg.beta'], nativeEdgeIds: ['calls-one'],
            nativeEdges: [{ id: 'calls-one', source: 'pkg.alpha', target: 'pkg.beta', predicate: 'CALLS' }],
            resultHash: 'a'.repeat(64), truncated: false,
          }, {
            eventId: 'attention-agent', timestamp: '2026-08-21T12:00:01Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
            runId: 'run-1', cardId: 'card_test_delegate', authority: 'agentgraph',
            operation: 'read', toolName: 'agentgraph.inspect',
            nativeNodeIds: ['card_test_delegate'], nativeEdgeIds: [],
            resultHash: 'b'.repeat(64), truncated: false,
          }, {
            eventId: 'attention-other-conversation', timestamp: '2026-08-21T13:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', conversationId: 'other',
            runId: 'run-other', cardId: 'card_test_delegate', authority: 'codegraph',
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

    it('streams the current Card root and its internal native activity with original identities', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint: string, init: any) => {
        if (endpoint !== '/domain/agentgraph/inspect') return railsImplementation(endpoint, init);
        expect(JSON.parse(init.body)).toEqual({ projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card-delegate', directOnly: true, limit: 1 });
        return { runs: [{ runId: 'delegate-run', projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card-delegate', conversationId: 'delegate-conversation', state: 'running',
          materializedNativeReferences: [{ authority: 'CodeGraph', nativeId: 'pkg.materialized' }],
          attentionEvents: [{ eventId: 'delete-event', timestamp: '2026-08-27T12:00:02Z',
            projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-delegate', runId: 'delegate-run',
            authority: 'knowgraph', operation: 'write', change: 'delete', toolName: 'graphiti.delete_episode',
            nativeNodeIds: ['episode-one'], nativeEdgeIds: [], resultHash: 'c'.repeat(64),
          }, { eventId: 'direct-event', timestamp: '2026-08-27T12:00:00Z',
            projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-delegate', runId: 'delegate-run',
            authority: 'codegraph', operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.direct'], nativeEdgeIds: [], resultHash: 'a'.repeat(64),
          }, { eventId: 'child-event', timestamp: '2026-08-27T12:00:01Z', nativeChildId: 'native-child',
            projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-delegate', runId: 'delegate-run',
            authority: 'codegraph', operation: 'read', toolName: 'cbm.search_graph',
            nativeNodeIds: ['pkg.child'], nativeEdgeIds: [], resultHash: 'b'.repeat(64) }] },
          { runId: 'team-run', rootRunId: 'delegate-run', nativeChildId: 'team-root', cardId: 'card-delegate',
            deckId: 'deck_builder', state: 'completed', materializedNativeReferences: [],
            attentionEvents: [{ eventId: 'team-event', timestamp: '2026-08-27T12:00:03Z',
              projectId: 'project-1', deckId: 'deck_builder', cardId: 'card-delegate', runId: 'team-run',
              nativeChildId: 'team-worker', authority: 'codegraph', operation: 'read', toolName: 'cbm.search_graph',
              nativeNodeIds: ['pkg.team'], nativeEdgeIds: [], resultHash: 'd'.repeat(64) }] },
        ] };
      });
      const { server, baseUrl } = await createApiServer();
      const controller = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/main/session/attention?projectId=project-1&deckId=deck_builder&cardId=card-delegate&stream=true`,
          { signal: controller.signal });
        const part = await response.body!.getReader().read();
        const body = new TextDecoder().decode(part.value);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
        expect(body).toContain('event: session');
        expect(body).toContain('pkg.materialized');
        expect(body).toContain('event: native_attention');
        expect(body).toContain('pkg.direct');
        expect(body).toContain('pkg.child');
        expect(body).toContain('child-event');
        expect(body).toContain('pkg.team');
        expect(body).toContain('"rootRunId":"delegate-run"');
        expect(body).toContain('"runId":"team-run"');
        expect(body).toContain('"nativeChildId":"team-worker"');
        expect(body.indexOf('direct-event')).toBeLessThan(body.indexOf('delete-event'));
      } finally {
        controller.abort();
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        await closeServer(server);
      }
    });

    it('streams structured public text from Main\'s exact Gateway runtime with saved Card identity', async () => {
      agentTerminalMocks.manager.submit.mockClear();
      const { server, baseUrl } = await createApiServer('rotated-local-user');
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'attention', message: 'inspect' }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('event: session');
        expect(body).toContain('event: text');
        expect(body).toContain('Real assistant reply.');
        expect(body).not.toContain('terminalEvent');
        expect(body).not.toContain('event: tool_result');
        const sessionFrame = body.split('\n\n').find((frame) => frame.startsWith('event: session'))!;
        const session = JSON.parse(sessionFrame.split('\ndata: ')[1]);
        expect(session).toMatchObject({ cardId: 'card_main_chat', sessionId: 'native:default',
          driverSource: 'internal_chat',
          contextAuthorityMode: 'main_native_honcho',
          configuration: { profile: 'default', provider: 'openai', model: 'gpt-5.6-luna' } });
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat' },
          'terminal:card_main_chat',
          'inspect',
          expect.any(Object),
        );
        expect(agentTerminalMocks.completed.get(session.runId)).toMatchObject({
          state: 'completed', finalResult: 'Real assistant reply.', hermesSessionId: 'native:default',
        });
      } finally {
        await closeServer(server);
      }
    });

    it('preserves a long multiline direct Builder reply unchanged in the native Run and shared chat', async () => {
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      const fullReply = [
        'BUILDER_DIRECT_OK: the native Builder completion is intentionally longer than the retired shared-chat limit so this test proves the complete answer is accepted without a one-line restriction.',
        '',
        'Detailed Builder report:',
        '- The full multiline completion remains unchanged.',
        '- Shared chat receives these exact same bytes.',
      ].join('\n');
      expect(fullReply.length).toBeGreaterThan(140);
      agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, submitted, options) => (
        agentTerminalMocks.finishSubmitted(
          owner, sessionId, submitted, options, fullReply, {}, true,
        )
      ));
      const { server, baseUrl } = await createApiServer();
      try {
        const exactMessage = '@builder Reply exactly BUILDER_DIRECT_OK';
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'direct-builder', message: exactMessage }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('BUILDER_DIRECT_OK');
        const runFrame = body.split('\n\n').find((frame) => frame.startsWith('event: run'))!;
        const runEvent = JSON.parse(runFrame.split('\ndata: ')[1]);
        expect(runEvent).toMatchObject({
          cardId: 'builder', directAddressed: true, turnOwner: 'addressed_card',
          participant: { cardId: 'builder', profile: 'builder', label: 'Builder' },
        });
        const doneFrame = body.split('\n\n').find((frame) => frame.startsWith('event: done'))!;
        expect(JSON.parse(doneFrame.split('\ndata: ')[1]).fullText).toBe(fullReply);
        const railsCalls = orchestratorMocks.requestPythonRailsJson.mock.calls;
        expect(railsCalls.filter(([endpoint]) => endpoint === '/domain/main/runs/begin')).toHaveLength(0);
        const beginCalls = railsCalls.filter(([endpoint]) => endpoint === '/domain/runs/begin');
        expect(beginCalls).toHaveLength(1);
        expect(JSON.parse(String(beginCalls[0][1]?.body))).toMatchObject({
          cardId: 'builder', assignment: exactMessage, conversationId: 'direct-builder',
        });
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledTimes(1);
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder' },
          'terminal:builder',
          exactMessage,
          expect.objectContaining({ surface: 'card-shared-chat' }),
        );
        expect(chatSessionMocks.appendSharedConversationTurn).toHaveBeenCalledWith(expect.objectContaining({
          projectId: 'project-1',
          conversationId: 'direct-builder',
          messages: [
            expect.objectContaining({
              role: 'user', content: exactMessage,
              target: expect.objectContaining({ cardId: 'builder', profile: 'builder', label: 'Builder' }),
            }),
            expect.objectContaining({
              role: 'assistant', content: fullReply,
              speaker: expect.objectContaining({ cardId: 'builder', profile: 'builder', label: 'Builder' }),
            }),
          ],
        }));
        expect(agentTerminalMocks.completed.get(runEvent.runId)).toMatchObject({
          state: 'completed', finalResult: fullReply, hermesSessionId: 'native:builder',
        });
      } finally {
        await closeServer(server);
      }
    });

    it('attributes a failed direct Builder turn without invoking Main or recording fake delivery', async () => {
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      agentTerminalMocks.manager.submit.mockRejectedValueOnce(new Error('native_builder_unavailable'));
      const { server, baseUrl } = await createApiServer();
      try {
        const exactMessage = '@builder Native failure probe';
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'direct-builder-failure', message: exactMessage,
          }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        const runFrame = body.split('\n\n').find((frame) => frame.startsWith('event: run'))!;
        expect(JSON.parse(runFrame.split('\ndata: ')[1])).toMatchObject({
          state: 'preparing', cardId: 'builder', directAddressed: true,
          participant: { cardId: 'builder', profile: 'builder', label: 'Builder' },
        });
        const errorFrame = body.split('\n\n').find((frame) => frame.startsWith('event: error'))!;
        expect(JSON.parse(errorFrame.split('\ndata: ')[1])).toMatchObject({
          code: 'addressed_card_turn_failed', cardId: 'builder', directAddressed: true,
          participant: { cardId: 'builder', profile: 'builder', label: 'Builder' },
        });
        expect(body).not.toMatch(/sent|asked|delivered|dispatched/i);
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
          ([endpoint]) => endpoint === '/domain/main/runs/begin',
        )).toHaveLength(0);
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder' },
          'terminal:builder',
          exactMessage,
          expect.any(Object),
        );
        expect(chatSessionMocks.appendSharedConversationTurn).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('refuses an unavailable explicit address before any Card or Main execution', async () => {
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'unwired', message: '@unwired do work',
          }),
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
          ok: false, error: 'addressed_card_unavailable', address: 'unwired',
        });
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
          ([endpoint]) => endpoint === '/domain/main/runs/begin' || endpoint === '/domain/runs/begin',
        )).toHaveLength(0);
        expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
        expect(chatSessionMocks.appendSharedConversationTurn).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('supplies the completed direct exchange to Main only on the later unaddressed turn', async () => {
      chatSessionMocks.getConversationMessages.mockResolvedValueOnce([
        {
          role: 'user', status: 'complete', content: '@builder Reply exactly BUILDER_DIRECT_OK',
          visibleActivities: [
            { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
            { kind: 'shared_chat_target', status: 'card', label: 'Builder', cardId: 'builder',
              profile: 'builder', address: 'builder' },
          ],
        },
        {
          role: 'assistant', status: 'complete', content: 'BUILDER_DIRECT_OK',
          visibleActivities: [
            { kind: 'shared_chat_speaker', status: 'card', label: 'Builder', cardId: 'builder',
              profile: 'builder', address: 'builder' },
          ],
        },
      ] as any);
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'direct-builder', message: 'Who just replied to me?',
          }),
        });
        expect(response.status).toBe(200);
        await response.text();
        const begin = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([endpoint]) => endpoint === '/domain/main/runs/begin',
        );
        expect(begin).toBeDefined();
        expect(JSON.parse(String(begin?.[1]?.body))).toMatchObject({
          message: 'Who just replied to me?',
          sharedConversation: [
            {
              role: 'user', speakerLabel: 'You', targetCardId: 'builder', targetLabel: 'Builder',
              content: '@builder Reply exactly BUILDER_DIRECT_OK',
            },
            {
              role: 'assistant', speakerCardId: 'builder', speakerLabel: 'Builder',
              content: 'BUILDER_DIRECT_OK',
            },
          ],
        });
      } finally {
        await closeServer(server);
      }
    });

    it('keeps ordinary Main available and sends typed catalog unavailability to Card authority', async () => {
      mcpClientMocks.listPythonAgentMcpCatalog.mockRejectedValueOnce(
        new Error('MCP catalog unavailable'),
      );
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'catalog-down', message: 'Can you still answer?',
          }),
        });
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).toContain('event: done');
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledTimes(1);
        const beginCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([endpoint]) => endpoint === '/domain/main/runs/begin',
        );
        const beginBody = JSON.parse(String(beginCall?.[1]?.body || '{}'));
        expect(beginBody).toMatchObject({
          discoveredTools: [],
          discoveredToolCatalogState: 'unavailable',
        });
      } finally {
        await closeServer(server);
      }
    });

    it('persists and streams the native Main token totals without inventing cost', async () => {
      const usage = { providerInputTokens: 240, providerOutputTokens: 20,
        providerCachedTokens: 40, providerReasoningTokens: 6, totalCostUsd: null,
        usageAvailable: true, usageSource: 'native_gateway' };
      agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, message, options) => (
        agentTerminalMocks.finishSubmitted(owner, sessionId, message, options, 'Measured reply.', {
          providerInputTokens: 240,
          providerOutputTokens: 20,
          providerCachedTokens: 40,
          providerReasoningTokens: 6,
          totalCostUsd: null,
        })
      ));
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'chat', message: 'hello' }),
        });
        const body = await response.text();
        const doneFrame = body.split('\n\n').find((frame) => frame.startsWith('event: done'))!;
        expect(JSON.parse(doneFrame.split('\ndata: ')[1]).usage).toEqual(usage);
        const runId = JSON.parse(doneFrame.split('\ndata: ')[1]).runId;
        expect(agentTerminalMocks.completed.get(runId)).toMatchObject({
          finalResult: 'Measured reply.', providerInputTokens: 240,
          providerOutputTokens: 20, providerCachedTokens: 40,
          providerReasoningTokens: 6, totalCostUsd: null,
        });
      } finally { await closeServer(server); }
    });

    it('completes Main without automatic graph extraction', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'chat', message: 'complete without extraction' }),
        });
        expect(await response.text()).toContain('event: done');
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.map(([route]) => route)).toEqual([
          '/domain/main/runs/begin',
        ]);
      } finally { await closeServer(server); }
    });

    it('drives the same Main Chat bridge from the authenticated external-plugin doorway', async () => {
      const priorSecret = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
      process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'test-external-main-secret-0123456789abcdef';
      orchestratorMocks.requestPythonRailsJson.mockClear();
      agentTerminalMocks.manager.submit.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const denied = await fetch(`${baseUrl}/main/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', deckId: 'deck_builder',
            conversationId: 'external-mcp:grant-1', mainCardId: 'card_main_chat',
            message: 'untrusted direct request',
          }),
        });
        expect(denied.status).toBe(401);
        expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();

        const response = await fetch(`${baseUrl}/main/chat`, {
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
          nativeSessionId: 'native:default',
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
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
          expect.objectContaining({ cardId: 'card_main_chat' }),
          'terminal:card_main_chat',
          'hello from the connector',
          expect.any(Object),
        );
      } finally {
        if (priorSecret === undefined) delete process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
        else process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = priorSecret;
        await closeServer(server);
      }
    });

    it('does not project CLI bytes or private tool traffic into Chat', async () => {
      agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, message, options) => {
        options?.onEvent?.({
          type: 'terminal.output', session_id: 'native:default',
          payload: { text: '\u001b[31mprivate native bytes\u001b[0m' },
        });
        options?.onEvent?.({
          type: 'item.tool.call', session_id: 'native:default',
          payload: { name: 'private_tool', result: 'private result' },
        });
        return agentTerminalMocks.finishSubmitted(
          owner, sessionId, message, options, 'Public answer.',
        );
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
      agentTerminalMocks.manager.submit.mockClear();
      mcpClientMocks.callPythonAgentMcpTool.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'main', message: 'materialize exactly once',
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

        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledTimes(1);
        expect(agentTerminalMocks.manager.submit.mock.calls[0].slice(0, 3)).toEqual([
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat' },
          'terminal:card_main_chat',
          'materialize exactly once',
        ]);
        const modelInput = JSON.stringify({
          message: agentTerminalMocks.manager.submit.mock.calls[0][2],
        });
        expect(modelInput).not.toContain('serialized-card');
        expect(modelInput).not.toContain('stableSavedCardContext');
        expect(modelInput).not.toContain('runId');
        expect(modelInput).not.toContain('correlationId');
        const railsCalls = orchestratorMocks.requestPythonRailsJson.mock.calls;
        expect(railsCalls.map(([endpoint]) => endpoint)).toEqual([
          '/domain/main/runs/begin',
        ]);
        expect(railsCalls[0]?.[1]?.body).toContain('"message":"materialize exactly once"');
        expect(JSON.parse(String(railsCalls[0]?.[1]?.body))).toMatchObject({
          driverSource: 'internal_chat',
          dataAnchors: [{
            authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
            reason: 'Current production definition', required: true,
          }],
        });
        expect(mcpClientMocks.callPythonAgentMcpTool).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('ignores late structured bridge events after the SSE turn has completed', async () => {
      agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, message, options) => {
        const result = agentTerminalMocks.finishSubmitted(
          owner, sessionId, message, options, 'Finished before late event.',
        );
        setTimeout(() => options?.onEvent?.({
          type: 'message.delta', session_id: 'native:default', payload: { text: 'late native delta' },
        }), 0);
        return result;
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
      agentTerminalMocks.manager.submit.mockClear();
      agentTerminalMocks.manager.interrupt.mockClear();
      let resolveTurn: (value: any) => void = () => undefined;
      const done = new Promise<any>((resolve) => {
        resolveTurn = resolve;
      });
      agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, _message, _options) => {
        const record = agentTerminalMocks.staged.get(sessionId);
        if (!record) throw new Error('agent_terminal_staged_run_identity_mismatch');
        agentTerminalMocks.staged.delete(sessionId);
        await done;
        agentTerminalMocks.complete(record.runId, owner, 'Completed after disconnect.');
        return {
          text: 'Completed after disconnect.', status: 'completed',
          event: { type: 'message.complete', session_id: sessionId,
            payload: {
              status: 'completed', text: 'Completed after disconnect.', usage: {},
              effectiveProvider: 'openai-codex', providerApiMode: null,
              nativeRootId: null, nativeRunId: null,
            } },
        };
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
        await vi.waitFor(() => expect(agentTerminalMocks.manager.submit).toHaveBeenCalled());
        controller.abort();
        resolveTurn({ finalText: 'Completed after disconnect.', nativeSessionId: 's', nativeTurnId: 't' });
        await vi.waitFor(() => {
          const completion = [...agentTerminalMocks.completed.values()]
            .find((candidate) => candidate.finalResult === 'Completed after disconnect.');
          expect(completion).toMatchObject({ state: 'completed' });
        });
        expect(agentTerminalMocks.manager.interrupt).not.toHaveBeenCalled();
        expect(response.status).toBe(200);
      } finally {
        await closeServer(server);
      }
    });

    it('stops the exact active Main turn only through the explicit Stop route', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      agentTerminalMocks.manager.submit.mockClear();
      agentTerminalMocks.manager.interrupt.mockClear();
      agentTerminalMocks.execution.requestCancellation.mockClear();
      agentTerminalMocks.execution.cancelStaged.mockClear();
      let rejectTurn: (error: Error) => void = () => undefined;
      const done = new Promise<any>((_resolve, reject) => {
        rejectTurn = reject;
      });
      let activeRunId = '';
      agentTerminalMocks.manager.submit.mockImplementationOnce((_owner, sessionId) => {
        activeRunId = agentTerminalMocks.staged.get(sessionId)?.runId || '';
        return done;
      });
      agentTerminalMocks.manager.interrupt.mockImplementationOnce(async () => {
        rejectTurn(new Error('hermes_turn_cancelled'));
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const chatResponse = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'stop-main', message: 'hello' }),
        });
        await vi.waitFor(() => expect(agentTerminalMocks.manager.submit).toHaveBeenCalled());
        const stopResponse = await fetch(`${baseUrl}/main/session/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', expectedRunId: activeRunId }),
        });
        const stopped = await stopResponse.json() as any;
        expect(stopResponse.status, JSON.stringify(stopped)).toBe(202);
        expect(stopped).toMatchObject({ ok: true, runId: activeRunId, state: 'stopping' });
        expect(agentTerminalMocks.execution.requestCancellation).toHaveBeenCalledWith(
          'terminal:card_main_chat', activeRunId,
        );
        expect(agentTerminalMocks.manager.interrupt).toHaveBeenCalledWith(
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat' },
          'terminal:card_main_chat',
        );
        const stream = await chatResponse.text();
        expect(stream).toContain('hermes_turn_cancelled');
        expect(stream).toContain('event: end');
        expect(agentTerminalMocks.execution.cancelStaged).toHaveBeenCalledWith(
          'terminal:card_main_chat', 'hermes_turn_cancelled', 'cancelled',
        );
      } finally {
        await closeServer(server);
      }
    });

    it('emits a safe correlated SSE error when Main\'s Gateway turn fails', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      agentTerminalMocks.manager.submit.mockRejectedValueOnce(new Error('provider credential leaked'));
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
        expect(body).toContain('main_gateway_turn_failed');
        expect(body).toContain('"runId":"req_');
        expect(body).not.toContain('provider credential leaked');
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(
          ([route]) => route === '/domain/main/completed-pair',
        )).toBe(false);
      } finally {
        await closeServer(server);
      }
    });

    it('does not submit to the CLI when Python rails cannot begin the run', async () => {
      orchestratorMocks.requestPythonRailsJson
        .mockRejectedValueOnce(new Error('database unavailable'));
      agentTerminalMocks.manager.submit.mockClear();
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
        expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('renders native Gateway completion without a Run readback or optional transport fields', async () => {
      agentTerminalMocks.manager.submit.mockImplementationOnce(async (owner, sessionId, message, options) => (
        agentTerminalMocks.finishSubmitted(
          owner, sessionId, message, options, 'Gateway result without optional telemetry.',
          {}, false,
        )
      ));
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'result-db-failure', message: 'hello' }),
        });
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).toContain('event: done');
        expect(body).toContain('Gateway result without optional telemetry.');
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(
          ([route]) => route === '/domain/runs/read',
        )).toBe(false);
      } finally {
        await closeServer(server);
      }
    });
  });

});
