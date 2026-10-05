import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import cardRuntime, {
  internalMainMcpRoutes,
  jevAttentionTelemetry,
  mainRoutes,
  materializerReadPrincipalForSavedCard,
  waitForCompletedPairThinkGraphLifecycles,
  waitForRequestFulfillmentAssessments,
} from './cardRuntime.routes';
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
        {
          id: 'card_thinkgraph',
          _cardRevisionId: 'revision:card_thinkgraph',
          title: 'ThinkGraph',
          prompt: 'Saved ThinkGraph prompt',
          kind: 'agent',
          templateId: 'template_assist',
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'thinkgraph' },
          runtimeOptions: {
            provider: 'openai',
            modelKey: 'gpt-5.6-luna',
          },
        },
        {
          id: 'card_magentic',
          _cardRevisionId: 'revision:card_magentic',
          title: 'Magnetic',
          prompt: 'Saved Mag One prompt',
          kind: 'agent',
          templateId: 'template_magentic',
          runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
          runtimeOptions: {
            provider: 'openai',
            accessMode: 'chatgpt-account',
            modelKey: 'gpt-5.6-sol',
            providerModelId: 'gpt-5.6-sol',
          },
        },
      ],
      edges: [
        { id: 'flow-main-delegate', source: 'card_main_chat', target: 'card_test_delegate', edgeType: 'flow' },
        { id: 'flow-main-builder', source: 'card_main_chat', target: 'builder', edgeType: 'flow' },
        { id: 'flow-main-thinkgraph', source: 'card_main_chat', target: 'card_thinkgraph', edgeType: 'flow' },
        { id: 'flow-main-magnetic', source: 'card_main_chat', target: 'card_magentic', edgeType: 'flow' },
      ],
    } as any,
  })),
}));

const agentTerminalMocks = vi.hoisted(() => {
  const staged = new Map<string, {
    runId: string; message: string; cardId: string; owner: any;
  }>();
  const completed = new Map<string, Record<string, unknown>>();
  const completedTurnGenerations = new Map<string, number>();
  const cancelled = new Set<string>();
  const gatewayListeners = new Set<(event: Record<string, unknown>) => void>();
  const profileFor = (cardId: string) => cardId === 'card_main_chat'
    ? 'default'
    : cardId === 'card_magentic' ? 'card_magentic'
    : cardId === 'card_team' ? 'team'
    : cardId === 'builder' ? 'builder'
      : cardId === 'card_thinkgraph' ? 'thinkgraph'
      : cardId === 'card_knowgraph' ? 'knowgraph'
      : cardId === 'card_hermes_steward' ? 'liquidaity-hermes-steward' : 'delegate';
  const stateFor = (owner: any) => {
    return ({
    sessionId: `terminal:${owner.cardId}`,
    cardId: owner.cardId,
    profile: profileFor(owner.cardId),
    pid: 9000,
    gatewayPid: 9000,
    tuiPid: 9001,
    ptyId: `pty:${owner.cardId}`,
    nativeSessionId: `native:${profileFor(owner.cardId)}`,
    storedSessionId: `native:${profileFor(owner.cardId)}`,
    completedTurnGeneration: completedTurnGenerations.get(
      `terminal:${owner.cardId}`,
    ) || 0,
    completedNativeRunId: null,
    hermesHome: `C:\\profiles\\${profileFor(owner.cardId)}`,
    unavailableToolReasons: {},
    status: 'running',
    cols: 120,
    rows: 36,
  });
  };
  const find = vi.fn((owner: any): ReturnType<typeof stateFor> | null => stateFor(owner));
  const state = vi.fn((owner: any) => stateFor(owner));
  const open = vi.fn(async (owner: any) => stateFor(owner));
  const magenticCardToolAuthority = vi.fn((owner: any) => ({
    cardId: owner.cardId,
    cardRevisionId: `revision:${owner.cardId}`,
    profile: profileFor(owner.cardId),
    configurationFingerprint: 'a'.repeat(64),
  }));
  const findCard = vi.fn((
    projectId: string, deckId: string, cardId: string,
  ): { owner: any; state: ReturnType<typeof stateFor> } | null => {
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
  const startVoiceCapture = vi.fn(async () => ({
    enabled: true,
    tts: true,
    available: true,
    audioAvailable: true,
    sttAvailable: true,
    details: '',
    recordStatus: 'recording',
  }));
  const stopVoiceCapture = vi.fn(async (_owner: any, _id: string, options?: { cancel?: boolean }) => ({
    enabled: options?.cancel !== true,
    tts: options?.cancel !== true,
    available: true,
    audioAvailable: true,
    sttAvailable: true,
    details: '',
    recordStatus: 'stopped',
  }));
  const complete = (
    runId: string,
    owner: any,
    text: string,
    overrides: Record<string, unknown> = {},
  ) => completed.set(runId, {
    state: 'completed',
    finalResult: text,
    hermesSessionId: stateFor(owner).nativeSessionId,
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
      owner,
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
      session_id: stateFor(owner).nativeSessionId,
      payload: { text },
    });
    const event = { type: 'message.complete', session_id: stateFor(owner).nativeSessionId,
      payload: {
        status: 'complete',
        text,
        usage: nativeFields,
        effectiveProvider: nativeFields.effectiveProvider,
        providerApiMode: nativeFields.providerApiMode,
        actualProvider: nativeFields.actualProvider || nativeFields.effectiveProvider,
        actualModel: nativeFields.actualModel || 'gpt-5.6-luna',
        exposedTools: nativeFields.exposedTools || [],
        executionEvidence: nativeFields.executionEvidence || [],
        executionEvidenceComplete: nativeFields.executionEvidenceComplete ?? true,
        executionEvidenceError: nativeFields.executionEvidenceError,
        nativeRootId: nativeFields.nativeRootId,
        nativeRunId: nativeFields.nativeRunId,
      } };
    options?.onEvent?.(event);
    const completedTurnGeneration = (completedTurnGenerations.get(sessionId) || 0) + 1;
    completedTurnGenerations.set(sessionId, completedTurnGeneration);
    return {
      text,
      status: 'complete',
      event,
      completedTurnGeneration,
      completedNativeRunId: nativeFields.nativeRunId ?? null,
    };
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
    const owner = record.owner;
    const usage = result.event?.payload?.usage || {};
    complete(record.runId, owner, result.text, usage);
    return {
      hermesSessionId: nativeSessionId,
      nativeRootId: result.event?.payload?.nativeRootId ?? null,
      nativeRunId: result.event?.payload?.nativeRunId ?? null,
      effectiveProvider: result.event?.payload?.effectiveProvider ?? null,
      providerApiMode: result.event?.payload?.providerApiMode ?? null,
      actualModel: result.event?.payload?.actualModel ?? null,
      exposedTools: result.event?.payload?.exposedTools ?? [],
      executionEvidence: result.event?.payload?.executionEvidence ?? [],
      executionEvidenceComplete: result.event?.payload?.executionEvidenceComplete === true,
      executionEvidenceError: result.event?.payload?.executionEvidenceError ?? null,
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
  const queueNativeContextCompaction = vi.fn(async (
    _owner: any, identity: any, onReceipt?: (receipt: any) => void,
  ) => {
    const receipt = {
      status: 'compressed',
      terminalSessionId: identity.sessionId,
      nativeSessionId: identity.nativeSessionId,
      storedSessionId: identity.storedSessionId,
      profile: identity.profile,
      focusApplied: false,
      beforeMessages: 12,
      afterMessages: 4,
      beforeTokens: 1200,
      afterTokens: 400,
      errorCode: null,
    };
    onReceipt?.(receipt);
    return receipt;
  });
  const resolveHermesBotRosterProjections = vi.fn(async () => ([
    {
      cardId: 'card_main_chat', cardRevisionId: 'revision:card_main_chat',
      profile: 'default', title: 'Main', botEnabled: true,
      roster: ['delegate', 'builder', 'thinkgraph', 'card_magentic'],
    },
    {
      cardId: 'card_test_delegate', cardRevisionId: 'revision:card_test_delegate',
      profile: 'delegate', title: 'Delegate', botEnabled: true, roster: [],
    },
    {
      cardId: 'builder', cardRevisionId: 'revision:builder',
      profile: 'builder', title: 'Builder', botEnabled: true, roster: [],
    },
    {
      cardId: 'card_thinkgraph', cardRevisionId: 'revision:card_thinkgraph',
      profile: 'thinkgraph', title: 'ThinkGraph', botEnabled: true, roster: [],
    },
    {
      cardId: 'card_magentic', cardRevisionId: 'revision:card_magentic',
      profile: 'card_magentic', title: 'Magnetic', botEnabled: true, roster: [],
    },
  ]));
  return {
    staged, completed, cancelled, gatewayListeners, emitGatewayEvent,
    profileFor, stateFor, complete, finishSubmitted,
    manager: {
      find, findCard, state, open, history, verifyConfiguration, submit, interrupt,
      dispatchLearn, requestProfile, subscribeGatewayEvents, magenticCardToolAuthority,
      queueNativeContextCompaction,
      startVoiceCapture, stopVoiceCapture,
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
    appendSharedConversationReplyOnce: vi.fn(async () => ({ inserted: true, message: {} })),
    listConversations: vi.fn(async () => []),
    usage,
  };
});

const mcpClientMocks = vi.hoisted(() => {
  const listPythonAgentMcpCatalog = vi.fn(async (): Promise<any[]> => []);
  const readPythonAgentMcpCatalog = vi.fn(async (): Promise<{
    state: 'available' | 'unavailable';
    tools: any[];
    unavailableFamilies: string[];
    reason?: 'catalog_unavailable';
  }> => {
    try {
      return {
        state: 'available',
        tools: await listPythonAgentMcpCatalog(),
        unavailableFamilies: [],
      };
    } catch {
      return {
        state: 'unavailable',
        tools: [],
        unavailableFamilies: [],
        reason: 'catalog_unavailable',
      };
    }
  });
  return {
  callPythonAgentMcpTool: vi.fn(async () => ({ ok: true })),
  listPythonAgentMcpCatalog,
  readPythonAgentMcpCatalog,
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
  requestPythonRailsJson: vi.fn(async (
    endpoint: string,
    init?: RequestInit,
    _options?: { timeoutMs?: number },
  ): Promise<any> => {
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
    if (endpoint === '/thinkgraph/completed-pair/prepare') {
      return {
        ok: true,
        pairMemoryId: 'mem_pair_one',
        intakeOperation: 'noop',
        structuredExtractionRequired: false,
        revision: 3,
        revisionChanged: false,
        preparation: { status: 'duplicate_noop' },
      };
    }
    if (endpoint === '/thinkgraph/completed-pair/settle') {
      return {
        ok: true,
        revision: 5,
        revisionChanged: true,
        changedNodeIds: ['think-rich-a'],
        changedEdgeIds: ['think-rich-edge'],
        affectedNodeIds: ['think-rich-a', 'think-fast-a'],
        turnHeat: { 'think-rich-a': 1.7 },
        topActiveNodes: [{ nativeId: 'think-rich-a', turnHeat: 1.7 }],
      };
    }
    if (endpoint === '/domain/runs/request-fulfillment') {
      return {
        ok: true,
        runId: body.runId,
        assessment: {
          schemaVersion: 'request-fulfillment-assessment.v1',
          metric: 'request_fulfillment',
          rubricVersion: 'request-fulfillment.v1',
          status: 'unavailable',
          runId: body.runId,
          executionEvidenceComplete: body.executionEvidenceComplete === true,
          executionEvidenceError: body.executionEvidenceError || null,
          actualProvider: body.actualProvider || null,
          actualModel: body.actualModel || null,
          failureReason: 'test_jev_provider_unavailable',
          requestCount: 0,
          questionCount: 0,
        },
      };
    }
    if (endpoint === '/domain/runs/preparation/fail') {
      return {
        ok: true,
        runId: body.runId,
        correlationId: body.correlationId,
        projectId: body.projectId,
        deckId: body.deckId,
        cardId: body.cardId,
        state: 'failed',
        acceptedAt: body.acceptedAt,
        preparationEndedAt: new Date().toISOString(),
        preparationElapsedMs: 1,
        errorCode: body.errorCode,
        errorSummary: body.errorSummary,
        nativeRunId: null,
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
      const thinkGraph = cardId === 'card_thinkgraph';
      const graphConfigured = graphAgent;
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
           runtimeMode: mainChat ? 'main' : 'delegate',
           runtimeProfile: mainChat ? 'default' : agentBuilder ? 'builder'
             : thinkGraph ? 'thinkgraph'
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
        jevAutoTools: delegateCard ? {
          enabled: true,
          status: 'selected',
          selectedTools: ['cbm.search_graph'],
        } : undefined,
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
                : { kind: 'hermes', mode: 'delegate',
                    profile: thinkGraph ? 'thinkgraph' : 'liquidaity-hermes-steward' },
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
            kanbanMission: '',
            runtime: cardId === 'card_main_chat'
              ? { kind: 'hermes', mode: 'main', profile: 'default' }
              : delegateCard
                ? { kind: 'hermes', mode: 'delegate', profile: 'delegate' }
                : { kind: 'hermes', mode: 'delegate',
                    profile: agentBuilder ? 'builder'
                      : thinkGraph ? 'thinkgraph' : 'liquidaity-hermes-steward' },
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
            title: cardId === 'card_main_chat' ? 'Main' : agentBuilder ? 'Builder'
              : thinkGraph ? 'ThinkGraph' : delegateCard ? 'Delegate'
              : graphAgent ? 'Graph Agent' : 'Card',
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
      rows: ['project-1', 'project-one', 'terminal-project-shared'].includes(projectId) && ownerMatches
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
  appendSharedConversationReplyOnce: chatSessionMocks.appendSharedConversationReplyOnce,
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
  HERMES_KANBAN_TASK_STATUSES: [
    'triage', 'todo', 'scheduled', 'ready', 'running',
    'blocked', 'review', 'done', 'archived',
  ],
}));

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  callPythonAgentMcpTool: mcpClientMocks.callPythonAgentMcpTool,
  listPythonAgentMcpCatalog: mcpClientMocks.listPythonAgentMcpCatalog,
  readPythonAgentMcpCatalog: mcpClientMocks.readPythonAgentMcpCatalog,
  resolvePythonAgentMcpServerSpec: mcpClientMocks.resolvePythonAgentMcpServerSpec,
}));

vi.mock('node-pty', () => ({ spawn: ptyMocks.spawn }));

vi.mock('../services/pythonRailsClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/pythonRailsClient')>(),
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
  // Main ends its SSE response before scheduling the saved ThinkGraph Card lifecycle.
  // Let it enqueue, then drain that already-authorized background turn so its
  // native session and mocks cannot bleed into the next test.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await waitForCompletedPairThinkGraphLifecycles();
  await waitForRequestFulfillmentAssessments();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function openSseReader(
  url: string,
  signal: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch(url, { signal });
  expect(response.status).toBe(200);
  if (!response.body) throw new Error('sse_response_body_missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let connected = '';
  while (!connected.includes('\n\n')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('sse_stream_closed_before_connect');
    connected += decoder.decode(chunk.value, { stream: true });
  }
  expect(connected).toContain('ThinkGraph revisions connected');
  return reader;
}

async function readSseJsonEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventName: string,
): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`sse_stream_closed_before_${eventName}`);
    buffer += decoder.decode(chunk.value, { stream: true });
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end < 0) break;
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!frame.startsWith(`event: ${eventName}\n`)) continue;
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      if (!data) throw new Error(`sse_${eventName}_data_missing`);
      return JSON.parse(data.slice('data: '.length));
    }
  }
}


describe('Jev attention telemetry', () => {
  it('maps canonical requested/resolved model and timing fields without inventing aliases', () => {
    const telemetry = jevAttentionTelemetry({
      schemaVersion: 'jev-attention.v1',
      status: 'success',
      decisionId: 'attention-decision-one',
      candidates: [{
        choiceId: 'think-one', authority: 'ThinkGraph', nativeId: 'think-native-one',
        title: 'Think candidate', probability: 1.0, selected: true, hydrated: true,
      }],
      distribution: { 'think-one': 1.0 },
      winner: 'think-one',
      confidence: 0.82,
      selectedReferences: [{ authority: 'ThinkGraph', nativeId: 'think-native-one' }],
      provider: 'TypeSafe',
      requestedModel: 'openrouter/jev',
      resolvedModel: 'openrouter/jev-resolved',
      timingMs: { jev: 12.5, total: 18.75 },
      policy: { minimumSelected: 1, maximumSelected: 3 },
      retrieval: {},
    });

    expect(telemetry).toMatchObject({
      requestedModel: 'openrouter/jev',
      resolvedModel: 'openrouter/jev-resolved',
      confidence: 0.82,
      winner: 'think-one',
      timingMs: { jev: 12.5, total: 18.75 },
    });
    expect(telemetry).not.toHaveProperty('model');
    expect(telemetry).not.toHaveProperty('timing');
  });
});

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

  it('refuses an authenticated non-owner before resolving either Main or Card runtime sessions', async () => {
    agentTerminalMocks.manager.findCard.mockClear();
    agentTerminalMocks.manager.history.mockClear();
    agentTerminalMocks.manager.open.mockClear();
    agentTerminalMocks.manager.submit.mockClear();
    const { server, baseUrl } = await createApiServer('different-user');
    try {
      const history = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(history.status).toBe(403);
      await expect(history.json()).resolves.toEqual({
        ok: false, error: 'main_project_access_denied',
      });

      const run = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder',
          correlationId: 'cross-user-refusal', conversationId: 'main',
          input: 'Must not reach Hermes.', action: 'execute',
        }),
      });
      expect(run.status).toBe(502);
      await expect(run.json()).resolves.toMatchObject({
        ok: false, error: 'agent_terminal_project_access_denied',
      });
      expect(agentTerminalMocks.manager.findCard).not.toHaveBeenCalled();
      expect(agentTerminalMocks.manager.history).not.toHaveBeenCalled();
      expect(agentTerminalMocks.manager.open).not.toHaveBeenCalled();
      expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
    } finally { await closeServer(server); }
  });

  it('does not substitute native Main session history for an empty Project conversation', async () => {
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
        messages: [],
        terminalEvents: [],
      });
      expect(payload.addressableAgents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          cardId: 'builder', profile: 'builder', title: 'Builder',
          address: 'Builder', aliases: ['builder'],
        }),
      ]));
      expect(agentTerminalMocks.manager.history).not.toHaveBeenCalled();
    } finally { await closeServer(server); }
  });

  it('resolves Main history A to B to A through one Project/Card native session', async () => {
    agentTerminalMocks.manager.findCard.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const runtimeIds: string[] = [];
      for (const conversationId of ['conversation-a', 'conversation-b', 'conversation-a']) {
        const response = await fetch(
          `${baseUrl}/main/session/history?projectId=project-1&conversationId=${conversationId}`,
        );
        expect(response.status).toBe(200);
        const payload = await response.json();
        runtimeIds.push(payload.runtimeSessionId);
      }
      expect(runtimeIds).toEqual([
        'terminal:card_main_chat',
        'terminal:card_main_chat',
        'terminal:card_main_chat',
      ]);
      expect(agentTerminalMocks.manager.findCard.mock.calls
        .filter((call: unknown[]) => call[2] === 'card_main_chat')
        .every((call: unknown[]) => call.length === 3)).toBe(true);
    } finally { await closeServer(server); }
  });

  it('authorizes one contextual node read and carries the active referent context to Python rails', async () => {
    chatSessionMocks.getConversationMessages.mockResolvedValueOnce([
      {
        role: 'user', status: 'complete', content: 'Explain the Alpha program.',
        visibleActivities: [{ kind: 'shared_chat_speaker', status: 'user', label: 'You' }],
      },
      {
        role: 'assistant', status: 'complete', content: 'Alpha has a staged delivery plan.',
        visibleActivities: [{ kind: 'shared_chat_speaker', status: 'card', label: 'Main',
          cardId: 'card_main_chat', profile: 'default' }],
      },
      {
        role: 'user', status: 'complete', content: 'What about its timeline?',
        visibleActivities: [{ kind: 'shared_chat_speaker', status: 'user', label: 'You' }],
      },
    ] as any);
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.requestPythonRailsJson.mockResolvedValueOnce({
      schemaVersion: 'contextual-node-read.v1',
      status: 'success',
      sourceRevision: 'graph-revision-one',
      clientContextRevision: 'chat-revision-one',
      requestCount: 1,
      questionCount: 2,
      sides: {
        think: { status: 'selected', nativeId: 'mem-one' },
        know: { status: 'selected', nativeId: 'fact-one' },
      },
      dataAnchors: [], selectedReferences: [], modelContext: '',
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/main/session/contextual-node-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
          sourceRevision: 'graph-revision-one', clientContextRevision: 'chat-revision-one',
          nativeMembers: [
            { authority: 'ThinkGraph', nativeId: 'think-entity-one' },
            { authority: 'KnowGraph', nativeId: 'know-entity-one' },
          ],
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        schemaVersion: 'contextual-node-read.v1', status: 'success',
      });
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledTimes(1);
      const [endpoint, init, options] = orchestratorMocks.requestPythonRailsJson.mock.calls[0];
      expect(endpoint).toBe('/graph/contextual-node-read');
      expect(options).toEqual({ timeoutMs: 60_000 });
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body).toMatchObject({
        projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat',
        conversationId: 'main', sourceRevision: 'graph-revision-one',
        clientContextRevision: 'chat-revision-one',
        readerContext: {
          status: 'ready', activeRequest: 'What about its timeline?',
        },
        nativeMembers: [
          { authority: 'ThinkGraph', nativeId: 'think-entity-one' },
          { authority: 'KnowGraph', nativeId: 'know-entity-one' },
        ],
      });
      expect(body.readerContext.messages.map((message: any) => message.content)).toEqual([
        'Explain the Alpha program.',
        'Alpha has a staged delivery plan.',
        'What about its timeline?',
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it('reads Project history without opening a Main runtime during canonical startup', async () => {
    agentTerminalMocks.manager.findCard.mockReturnValueOnce(null);
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        runtimeSessionId: '',
        mainCardId: 'card_main_chat',
      });
      expect(agentTerminalMocks.manager.open).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('reloads the persisted direct Builder exchange with the original speaker identities', async () => {
    chatSessionMocks.getConversationMessages.mockResolvedValueOnce([
      {
        role: 'user', status: 'complete', content: '@builder Reply exactly BUILDER_DIRECT_OK',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
          { kind: 'shared_chat_target', status: 'card', label: 'Builder', cardId: 'builder',
            profile: 'builder', address: 'Builder' },
        ],
      },
      {
        role: 'assistant', status: 'complete', content: 'BUILDER_DIRECT_OK',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'card', label: 'Builder', cardId: 'builder',
            profile: 'builder', address: 'Builder' },
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
            kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder', address: 'Builder',
          },
        },
        {
          role: 'assistant', text: 'BUILDER_DIRECT_OK',
          speaker: {
            kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder', address: 'Builder',
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
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat', conversationId: 'main' },
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
      const response = await fetch(
        `${origin}/api/main/session/driver?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true });
    } finally {
      await closeServer(server);
    }
  });

  it('starts voice on the exact selected saved Card session and stops that same owner', async () => {
    agentTerminalMocks.manager.startVoiceCapture.mockClear();
    agentTerminalMocks.manager.stopVoiceCapture.mockClear();
    const { server, baseUrl } = await createApiServer();
    const controller = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/main/session/voice/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          conversationId: 'main',
          targetCardId: 'card_test_delegate',
          tts: true,
        }),
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let wire = '';
      while (!wire.includes('event: ready')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        wire += decoder.decode(chunk.value, { stream: true });
      }
      expect(wire).toContain('"cardId":"card_test_delegate"');
      expect(agentTerminalMocks.manager.startVoiceCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1', deckId: 'deck_builder',
          cardId: 'card_test_delegate',
        }),
        'terminal:card_test_delegate',
        { tts: true },
      );

      const stopped = await fetch(`${baseUrl}/main/session/voice/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
          targetCardId: 'card_test_delegate', cancel: false,
        }),
      });
      expect(stopped.status).toBe(200);
      expect(await stopped.json()).toMatchObject({
        ok: true, cardId: 'card_test_delegate',
        runtimeSessionId: 'terminal:card_test_delegate',
      });
      expect(agentTerminalMocks.manager.stopVoiceCapture).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'card_test_delegate', conversationId: 'main' }),
        'terminal:card_test_delegate',
        { cancel: false },
      );
      await reader.cancel();
    } finally {
      controller.abort();
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
    chatSessionMocks.getConversationMessages.mockResolvedValueOnce([]);
    agentTerminalMocks.manager.history.mockClear();
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
      expect(agentTerminalMocks.manager.history).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('returns persisted Project history without consulting Hermes session history', async () => {
    chatSessionMocks.getConversationMessages.mockResolvedValueOnce([{
      role: 'user', status: 'complete', content: 'Persisted Project question',
      visibleActivities: [
        { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
        { kind: 'shared_chat_target', status: 'card', label: 'Main', cardId: 'card_main_chat' },
      ],
    }, {
      role: 'assistant', status: 'complete', content: 'Persisted Project answer',
      visibleActivities: [
        { kind: 'shared_chat_speaker', status: 'card', label: 'Main', cardId: 'card_main_chat' },
      ],
    }] as any);
    agentTerminalMocks.manager.history.mockClear();
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(
        `${baseUrl}/main/session/history?projectId=project-1&conversationId=main`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        messages: [
          { role: 'user', text: 'Persisted Project question', target: { cardId: 'card_main_chat' } },
          { role: 'assistant', text: 'Persisted Project answer', speaker: { cardId: 'card_main_chat' } },
        ],
      });
      expect(agentTerminalMocks.manager.history).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('returns a typed failure when the Project conversation read is unavailable', async () => {
    chatSessionMocks.getConversationMessages.mockRejectedValueOnce(new Error('database_unavailable'));
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

  it.each([
    {
      cardId: 'builder',
      savedTools: ['cbm.search_graph', 'card.create', 'cbm.search_graph'],
      savedConnections: ['cbm', 'cbm'],
      expectedGrants: ['card.create', 'cbm.search_graph'],
      expectedConnections: ['cbm'],
    },
    {
      cardId: 'card_knowgraph',
      savedTools: ['graphiti.search_nodes'],
      savedConnections: ['graphiti'],
      expectedGrants: ['graphiti.search_nodes'],
      expectedConnections: ['graphiti'],
    },
    {
      cardId: 'card_main_chat',
      savedTools: ['canvas.inspect'],
      savedConnections: [],
      expectedGrants: ['canvas.inspect'],
      expectedConnections: [],
    },
    {
      cardId: 'card_thinkgraph',
      savedTools: ['engraphis_recall_context'],
      savedConnections: [],
      expectedGrants: ['engraphis_recall_context'],
      expectedConnections: [],
    },
  ])('derives the pre-Run catalog principal from $cardId saved grants', async ({
    cardId, savedTools, savedConnections, expectedGrants, expectedConnections,
  }) => {
    expect(materializerReadPrincipalForSavedCard({
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId,
      conversationId: 'main',
    }, { runtimeOptions: {
      tools: savedTools,
      mcpConnectionIds: savedConnections,
    } })).toEqual({
      kind: 'materializer-read',
      projectId: 'project-1',
      deckId: 'deck_builder',
      callerCardId: cardId,
      conversationId: 'main',
      grantedTools: expectedGrants,
      grantedConnections: expectedConnections,
    });
  });

  it('reports the native-versus-observed tool receipt deficit as an observation gap', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.runRecords.set('tool-gap', {
      runId: 'tool-gap', correlationId: 'tool-gap', projectId: 'p', deckId: 'd',
      cardId: 'builder', runtimeKind: 'hermes', runtimeMode: 'delegate',
      runtimeProfile: 'builder', state: 'completed', finalResult: 'Done.',
      startedAt: '2026-10-01T20:00:00Z', finishedAt: '2026-10-01T20:00:01Z',
      toolCallCount: 2,
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint) => {
      expect(endpoint).toBe('/domain/runs/read');
      return { ok: true, run: orchestratorMocks.runRecords.get('tool-gap') };
    }).mockImplementationOnce(async (endpoint) => {
      expect(endpoint).toBe('/domain/agentgraph/inspect');
      return { ok: true, runs: [{
        runId: 'tool-gap', cardId: 'builder',
        attemptEvents: [{
          eventId: 'tool-call-one', attemptId: 'tool-call-one', kind: 'tool',
          phase: 'completed', toolName: 'engraphis_get_memory', status: 'ok',
        }],
        attentionEvents: [{
          eventId: 'graph-attention-one', operation: 'read',
          toolName: 'engraphis_get_memory',
        }],
      }] };
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', inspectOnly: true,
          projectId: 'p', deckId: 'd', runId: 'tool-gap' }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runId: 'tool-gap', toolCallCount: 2, observationGap: 1,
          toolEvents: [{ toolName: 'engraphis_get_memory', status: 'ok' }],
        },
      });
    } finally { await closeServer(server); }
  });

  it.each([
    ['cbm', 'builder'],
    ['graphiti', 'card_knowgraph'],
  ] as const)('retains a connection-only %s catalog grant for %s', (connectionId, cardId) => {
    expect(materializerReadPrincipalForSavedCard({
      projectId: 'project-1',
      deckId: 'deck_builder',
      cardId,
    }, { runtimeOptions: {
      tools: ['card.create'],
      mcpConnectionIds: [connectionId],
    } })).toMatchObject({
      grantedTools: ['card.create'],
      grantedConnections: [connectionId],
    });
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
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat', conversationId: 'main' },
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

  it('fails closed when Python materializes a different Card revision than the saved snapshot', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    agentTerminalMocks.execution.stage.mockClear();
    agentTerminalMocks.manager.submit.mockClear();
    orchestratorMocks.requestPythonRailsJson.mockResolvedValueOnce({
      runId: 'corr-revision-race',
      correlationId: 'corr-revision-race',
      cardRevisionId: 'revision:concurrent-save',
      runtimeOwner: 'hermes',
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'builder',
          correlationId: 'corr-revision-race',
          conversationId: 'main',
          input: 'Do not run a stale Builder snapshot.',
          action: 'execute',
        }),
      });

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: 'card_revision_changed',
      });
      expect(agentTerminalMocks.execution.stage).not.toHaveBeenCalled();
      expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith(
        '/domain/runs/finish',
        expect.objectContaining({
          body: JSON.stringify({
            runId: 'corr-revision-race',
            state: 'failed',
            errorCode: 'card_revision_changed',
            errorSummary: 'card_revision_changed',
          }),
        }),
      );
    } finally {
      await closeServer(server);
    }
  });

  it('fails and settles a prepared Run that omits the saved Card revision hash', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    agentTerminalMocks.execution.stage.mockClear();
    agentTerminalMocks.manager.submit.mockClear();
    deckMocks.getDeckDocument.mockResolvedValueOnce({
      deck: {
        workspaceRoot: process.cwd(),
        nodes: [{
          id: 'builder',
          _cardRevisionId: 'revision:builder',
          _cardRevisionSha256: 'a'.repeat(64),
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
          runtimeOptions: { tools: [], mcpConnectionIds: [] },
        }],
        edges: [],
      } as any,
    });
    orchestratorMocks.requestPythonRailsJson.mockResolvedValueOnce({
      runId: 'corr-revision-hash-missing',
      correlationId: 'corr-revision-hash-missing',
      cardRevisionId: 'revision:builder',
      runtimeOwner: 'hermes',
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'builder',
          correlationId: 'corr-revision-hash-missing',
          conversationId: 'main',
          input: 'Do not run without the pinned revision hash.',
          action: 'execute',
        }),
      });

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: 'card_revision_changed',
      });
      expect(agentTerminalMocks.execution.stage).not.toHaveBeenCalled();
      expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
      expect(orchestratorMocks.requestPythonRailsJson).toHaveBeenCalledWith(
        '/domain/runs/finish',
        expect.objectContaining({
          body: JSON.stringify({
            runId: 'corr-revision-hash-missing',
            state: 'failed',
            errorCode: 'card_revision_changed',
            errorSummary: 'card_revision_changed',
          }),
        }),
      );
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
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder', conversationId: 'main' },
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
      providerInputTokens: raw,
      providerOutputTokens: raw,
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
        result: {
          runId,
          toolCallCount: expected,
          costUsd: expected,
          inputTokens: expected,
          outputTokens: expected,
        },
      });
    } finally { await closeServer(server); }
  });

  it('projects only the selected Card newest failed Run aggregates', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.requestPythonRailsJson
      .mockImplementationOnce(async (endpoint, init) => {
        expect(endpoint).toBe('/domain/runs/history');
        expect(JSON.parse(String(init?.body))).toEqual({
          projectId: 'p', deckId: 'd', cardId: 'builder', limit: 1,
        });
        return { ok: true, runs: [
          { runId: 'failed-new', state: 'failed' },
          { runId: 'completed-old', state: 'completed' },
        ] };
      })
      .mockImplementationOnce(async (endpoint) => {
        expect(endpoint).toBe('/domain/runs/read');
        return { ok: true, run: {
          runId: 'failed-new', correlationId: 'failed-new', projectId: 'p', deckId: 'd',
          cardId: 'builder', runtimeKind: 'hermes', runtimeMode: 'delegate', runtimeProfile: 'builder',
          provider: 'openai', model: 'saved-model', accessMode: 'chatgpt-account',
          state: 'failed', startedAt: '2026-10-01T20:00:04Z', finishedAt: '2026-10-01T20:00:17.490Z',
          inputTokens: 12_000, outputTokens: 340, toolCallCount: 7, costUsd: 0.08,
        } };
      })
      .mockImplementationOnce(async (endpoint) => {
        expect(endpoint).toBe('/domain/agentgraph/inspect');
        return { ok: true, runs: [{
          runId: 'failed-new', cardId: 'builder', acceptedAt: '2026-10-01T20:00:00Z',
          attemptEvents: [{ eventId: 'latest-model', kind: 'llm',
            provider: 'actual-provider', model: 'gpt-5.6-sol' }],
          attentionEvents: [],
        }] };
      });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'history', projectId: 'p', deckId: 'd',
          cardId: 'builder', limit: 1 }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        result: {
          cardId: 'builder',
          latest: {
            state: 'failed', acceptedAt: '2026-10-01T20:00:00Z',
            model: 'gpt-5.6-sol', elapsedMs: 17_490, totalTokens: 12_340,
            costUsd: 0.08, costStatus: 'estimated', toolCallCount: 7,
          },
        },
      });
    } finally { await closeServer(server); }
  });

  it('keeps newest cancelled Run unknown aggregates unavailable without older fallback', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.requestPythonRailsJson
      .mockImplementationOnce(async () => ({ ok: true, runs: [
        { runId: 'cancelled-new', state: 'cancelled' },
        { runId: 'completed-old', state: 'completed', inputTokens: 50, outputTokens: 25 },
      ] }))
      .mockImplementationOnce(async () => ({ ok: true, run: {
        runId: 'cancelled-new', correlationId: 'cancelled-new', projectId: 'p', deckId: 'd',
        cardId: 'builder', runtimeKind: 'hermes', runtimeMode: 'delegate', runtimeProfile: 'builder',
        state: 'cancelled', acceptedAt: null, startedAt: null, finishedAt: null,
        model: null, inputTokens: null, outputTokens: null, toolCallCount: null, costUsd: null,
      } }))
      .mockImplementationOnce(async () => ({ ok: true, runs: [{
        runId: 'cancelled-new', cardId: 'builder', attemptEvents: [], attentionEvents: [],
      }] }));
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'history', projectId: 'p', deckId: 'd',
          cardId: 'builder', limit: 1 }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        result: {
          cardId: 'builder',
          latest: {
            state: 'cancelled', acceptedAt: null, model: null, elapsedMs: null,
            totalTokens: null, costUsd: null, costStatus: 'unavailable', toolCallCount: null,
          },
        },
      });
    } finally { await closeServer(server); }
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
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_test_delegate', conversationId: 'main' },
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
            jevAutoTools: {
              enabled: true,
              status: 'selected',
              selectedTools: ['cbm.search_graph'],
            },
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

  it('reuses one Project/Card session and queues one metadata-only compaction after each delegate Run', async () => {
    agentTerminalMocks.manager.submit.mockClear();
    agentTerminalMocks.manager.queueNativeContextCompaction.mockClear();
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const { server, baseUrl } = await createApiServer();
    const invoke = (conversationId: string, correlationId: string) => fetch(`${baseUrl}/cards/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_test_delegate',
        senderCardId: 'card_main_chat', correlationId, conversationId,
        input: `Inspect ${conversationId}.`, action: 'execute',
        cardRevisionId: 'revision:card_test_delegate',
      }),
    });
    try {
      await expect(invoke('delegate-a', 'delegate-project-run-a')).resolves.toMatchObject({ status: 200 });
      await expect(invoke('delegate-b', 'delegate-project-run-b')).resolves.toMatchObject({ status: 200 });

      expect(agentTerminalMocks.manager.submit.mock.calls.map(([, sessionId]) => sessionId))
        .toEqual(['terminal:card_test_delegate', 'terminal:card_test_delegate']);
      expect(agentTerminalMocks.manager.queueNativeContextCompaction).toHaveBeenCalledTimes(2);
      const identities = agentTerminalMocks.manager.queueNativeContextCompaction.mock.calls
        .map(([, identity]) => identity);
      expect(identities).toEqual([
        expect.objectContaining({
          sessionId: 'terminal:card_test_delegate', nativeSessionId: 'native:delegate',
          storedSessionId: 'native:delegate', profile: 'delegate',
        }),
        expect.objectContaining({
          sessionId: 'terminal:card_test_delegate', nativeSessionId: 'native:delegate',
          storedSessionId: 'native:delegate', profile: 'delegate',
        }),
      ]);
      expect(identities[1].completedTurnGeneration)
        .toBe(identities[0].completedTurnGeneration + 1);
      await vi.waitFor(() => expect(
        orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
          ([endpoint]) => endpoint === '/domain/runs/attempt',
        ),
      ).toHaveLength(2));
      const attempts = orchestratorMocks.requestPythonRailsJson.mock.calls
        .filter(([endpoint]) => endpoint === '/domain/runs/attempt')
        .map(([, init]) => JSON.parse(String(init?.body)));
      expect(attempts.map((value) => value.runId)).toEqual([
        'delegate-project-run-a', 'delegate-project-run-b',
      ]);
      for (const value of attempts) {
        expect(value.attempt).toMatchObject({
          kind: 'tool', toolName: 'session.compress', status: 'compressed',
          redaction: 'metadata_only_no_summary', retryable: false,
        });
        expect(value.attempt).not.toHaveProperty('summary');
        expect(value.attempt).not.toHaveProperty('messages');
        expect(value.attempt).not.toHaveProperty('prompt');
        expect(value.attempt).not.toHaveProperty('result');
      }
      expect(agentTerminalMocks.manager.submit.mock.calls.map(([, , message]) => message)
        .join('\n')).not.toContain('session.compress');
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
        return { text: 'Native graph proposal', status: 'completed',
          completedTurnGeneration: 1, completedNativeRunId: null, event: {
          type: 'message.complete', session_id: sessionId,
          payload: {
            status: 'completed', text: 'Native graph proposal', usage: {},
            effectiveProvider: 'openai-codex', providerApiMode: null,
            actualProvider: 'openai-codex', actualModel: 'gpt-5.6-luna',
            exposedTools: [], executionEvidence: [],
            executionEvidenceComplete: true, executionEvidenceError: null,
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
        completedTurnGeneration: 1, completedNativeRunId: null,
        event: { type: 'message.complete', session_id: sessionId,
          payload: {
            status: 'completed', text: 'late delegate completion', usage: {},
            effectiveProvider: 'openai-codex', providerApiMode: null,
            actualProvider: 'openai-codex', actualModel: 'gpt-5.6-luna',
            exposedTools: [], executionEvidence: [],
            executionEvidenceComplete: true, executionEvidenceError: null,
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
        { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_test_delegate', conversationId: 'main' },
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
        { userId: 'owner-user', projectId: 'terminal-project-shared', deckId: 'deck_builder', cardId: 'builder', conversationId: 'main' },
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
        { userId: 'owner-user', projectId: 'terminal-project-shared', deckId: 'deck_builder', cardId: 'card_test_delegate', conversationId: 'main' },
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

  it('submits Mag One to native Hermes execution without a backend poll loop', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockClear();
    agentTerminalMocks.manager.open.mockClear();
    const magenticExecution = {
      runId: 'corr-mag-1',
      correlationId: 'corr-mag-1',
      projectId: 'project-1',
      deckId: 'deck_builder',
      inputFile: {
        workspace: 'C:\\runtime-inputs\\mag-root',
        idfPath: 'C:\\runtime-inputs\\mag-root\\in.idf',
        idfSha256: 'c'.repeat(64),
        idfBytes: 500,
      },
      mission: 'Coordinate the mission.',
      orchestrator: {
        cardId: 'card_magentic',
        cardRevisionId: 'revision:card_magentic',
        nativeIdentity: 'card_magentic',
        instructions: 'Saved Mag One prompt',
        provider: {
          provider: 'openai', accessMode: 'chatgpt-account',
          modelKey: 'gpt-5.6-sol', providerModelId: 'gpt-5.6-sol',
        },
        runtimeOptions: {},
      },
      workers: [
        {
          cardId: 'card_test_delegate', cardRevisionId: 'revision:card_test_delegate',
          profile: 'delegate', title: 'Delegate', description: 'Saved worker',
        },
        {
          cardId: 'builder', cardRevisionId: 'revision:builder',
          profile: 'builder', title: 'Builder', description: 'Saved worker',
        },
      ],
    };
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/begin');
      return {
        runId: 'corr-mag-1',
        correlationId: 'corr-mag-1',
        runtimeOwner: 'mag_one',
        cardRevisionId: 'revision:card_magentic',
        magenticExecution,
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/magentic-mission-readiness');
      return { ok: true, runId: 'corr-mag-1' };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string, init?: RequestInit) => {
      expect(endpoint).toBe('/magentic/execution/submit');
      expect(JSON.parse(String(init?.body))).toEqual({
        ...magenticExecution,
        workerAuthorities: [
          {
            cardId: 'card_test_delegate',
            cardRevisionId: 'revision:card_test_delegate',
            profile: 'delegate',
            configurationFingerprint: 'a'.repeat(64),
          },
          {
            cardId: 'builder',
            cardRevisionId: 'revision:builder',
            profile: 'builder',
            configurationFingerprint: 'a'.repeat(64),
          },
        ],
        notifySession: {
          sessionKey: 'native:default',
          profile: 'default',
        },
      });
      return {
        ok: true, state: 'running', nativeStatus: 'ready', nativeRootId: 't_mag_root',
        outerRunBound: true,
        nativeIdentity: 'card_magentic', effectiveProvider: 'openai-codex',
        providerApiMode: 'codex_app_server', model: 'gpt-5.6-sol',
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string, init?: RequestInit) => {
      expect(endpoint).toBe('/domain/runs/progress');
      expect(JSON.parse(String(init?.body))).toEqual({
        runId: 'corr-mag-1', nativeRootId: 't_mag_root', nativeStatus: 'ready',
      });
      return { ok: true, runId: 'corr-mag-1', updated: true };
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
          senderCardId: 'card_main_chat',
          correlationId: 'corr-mag-1',
          conversationId: 'main',
          input: 'Coordinate the mission.',
          action: 'execute',
          cardRevisionId: 'revision:card_magentic',
        }),
      });
      expect(response.status).toBe(202);
      expect(orchestratorMocks.dispatchConfiguredRuntime).not.toHaveBeenCalled();
      expect(agentTerminalMocks.manager.open).toHaveBeenCalledTimes(3);
      expect(agentTerminalMocks.manager.open).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ cardId: 'card_magentic' }),
        expect.objectContaining({ id: 'card_magentic' }),
        expect.any(Object),
        120,
        36,
        { attachTui: false, materializeTaskProfile: true },
      );
      expect(agentTerminalMocks.manager.open).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cardId: 'card_test_delegate' }),
        expect.objectContaining({ id: 'card_test_delegate' }),
        expect.any(Object),
        120,
        36,
        { attachTui: false, materializeTaskProfile: true },
      );
      expect(agentTerminalMocks.manager.open).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ cardId: 'builder' }),
        expect.objectContaining({ id: 'builder' }),
        expect.any(Object),
        120,
        36,
        { attachTui: false, materializeTaskProfile: true },
      );
      const body = await response.json() as any;
      expect(body).toMatchObject({
        ok: true,
        result: {
          status: 'running',
          state: 'running',
          runtimeOwner: 'mag_one',
          transport: {
            threadId: 't_mag_root', turnId: null, hermesSessionId: null,
            runtimeSource: 'repository_hermes_magentic',
          },
          receipt: null,
        },
      });
      const executeEndpoints = orchestratorMocks.requestPythonRailsJson.mock.calls
        .map(([endpoint]) => endpoint);
      expect(executeEndpoints).toEqual([
        '/domain/runs/begin',
        '/domain/runs/magentic-mission-readiness',
        '/magentic/execution/submit',
        '/domain/runs/progress',
      ]);

      const startedAt = new Date().toISOString();
      orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
        expect(endpoint).toBe('/domain/runs/read');
        return { ok: true, run: {
          runId: 'corr-mag-1', correlationId: 'corr-mag-1', cardId: 'card_magentic',
          state: 'running', runtimeKind: 'hermes', runtimeMode: 'magentic_one',
          runtimeProfile: 'card_magentic', nativeRootId: 't_mag_root',
          nativeStatus: 'running', startedAt, result: null,
        } };
      });
      orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
        expect(endpoint).toBe('/magentic/execution/status');
        return {
          ok: true, state: 'completed', nativeStatus: 'done', nativeRootId: 't_mag_root',
          nativeRunId: 2, nativeIdentity: 'card_magentic', effectiveProvider: 'openai-codex',
          providerApiMode: 'codex_app_server', model: 'gpt-5.6-sol',
          finalResult: 'Native Hermes Mag One response.',
        };
      });
      orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string, init?: RequestInit) => {
        expect(endpoint).toBe('/domain/runs/finish');
        const finish = JSON.parse(String(init?.body));
        expect(finish).toMatchObject({
          runId: 'corr-mag-1', state: 'completed', hermesSessionRef: null,
          providerThreadRef: 't_mag_root', providerTurnRef: 2,
          effectiveProvider: 'openai-codex', providerApiMode: 'codex_app_server',
          nativeStatus: 'done', finalResult: 'Native Hermes Mag One response.',
        });
        expect(finish).not.toHaveProperty('tasksCompleted');
        expect(finish).not.toHaveProperty('tasksTotal');
        expect(finish).not.toHaveProperty('activeWorkers');
        return { receipt: { runId: 'corr-mag-1', state: 'completed' } };
      });
      orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
        expect(endpoint).toBe('/domain/runs/read');
        return { ok: true, run: {
          runId: 'corr-mag-1', correlationId: 'corr-mag-1', cardId: 'card_magentic',
          state: 'completed', runtimeKind: 'hermes', runtimeMode: 'magentic_one',
          runtimeProfile: 'card_magentic', nativeRootId: 't_mag_root', nativeRunId: 2,
          nativeStatus: 'done', effectiveProvider: 'openai-codex',
          providerApiMode: 'codex_app_server', startedAt, finishedAt: new Date().toISOString(),
          result: 'Native Hermes Mag One response.',
        } };
      });
      orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
        expect(endpoint).toBe('/domain/agentgraph/inspect');
        return { runs: [], attentionEvents: [] };
      });
      const statusResponse = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', deckId: 'deck_builder', runId: 'corr-mag-1', action: 'status',
        }),
      });
      expect(statusResponse.status).toBe(200);
      await expect(statusResponse.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runId: 'corr-mag-1', state: 'completed', status: 'done',
          nativeRootId: 't_mag_root', nativeRunId: 2,
          output: 'Native Hermes Mag One response.',
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  it('materializes Team but skips the Magnetic model for a Team-only blue roster', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    agentTerminalMocks.manager.open.mockClear();
    deckMocks.getDeckDocument.mockResolvedValueOnce({
      deck: {
        workspaceRoot: process.cwd(),
        nodes: [
          {
            id: 'card_magentic', _cardRevisionId: 'revision:card_magentic',
            title: 'Magnetic', prompt: 'Saved Magnetic prompt', kind: 'agent',
            templateId: 'template_magentic',
            runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
            runtimeOptions: {
              provider: 'openai', accessMode: 'chatgpt-account',
              modelKey: 'gpt-5.6-sol', providerModelId: 'gpt-5.6-sol',
            },
          },
          {
            id: 'card_team', _cardRevisionId: 'revision:card_team',
            title: 'Team', prompt: 'Saved Team prompt', kind: 'agent',
            templateId: 'template_team',
            runtime: { kind: 'hermes', mode: 'delegate', profile: 'team' },
            runtimeOptions: {
              provider: 'openai', accessMode: 'chatgpt-account',
              modelKey: 'gpt-5.6-terra', providerModelId: 'gpt-5.6-terra',
              subagentModel: {
                provider: 'openai', accessMode: 'chatgpt-account',
                modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
              },
            },
          },
        ],
        edges: [{
          id: 'edge_team_magnetic', source: 'card_team', target: 'card_magentic',
          edgeType: 'magentic_option',
        }],
      } as any,
    });
    const magenticExecution = {
      runId: 'corr-team-only', correlationId: 'corr-team-only',
      projectId: 'project-1', deckId: 'deck_builder',
      inputFile: {
        workspace: 'C:\\runtime-inputs\\team-only',
        idfPath: 'C:\\runtime-inputs\\team-only\\in.idf',
        idfSha256: 'e'.repeat(64), idfBytes: 500,
      },
      mission: 'Use the automatic Team.',
      orchestrator: {
        cardId: 'card_magentic', cardRevisionId: 'revision:card_magentic',
        nativeIdentity: 'card_magentic', instructions: 'Saved Magnetic prompt',
        provider: {
          provider: 'openai', accessMode: 'chatgpt-account',
          modelKey: 'gpt-5.6-sol', providerModelId: 'gpt-5.6-sol',
        },
        runtimeOptions: {},
      },
      workers: [{
        cardId: 'card_team', cardRevisionId: 'revision:card_team', profile: 'team',
        title: 'Team', description: 'Automatic Team', teamTaskMode: true,
        provider: {
          provider: 'openai', accessMode: 'chatgpt-account',
          modelKey: 'gpt-5.6-terra', providerModelId: 'gpt-5.6-terra',
        },
        runtimeOptions: {
          modelKey: 'gpt-5.6-terra', providerModelId: 'gpt-5.6-terra',
        },
      }],
    };
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/begin');
      return {
        runId: 'corr-team-only', correlationId: 'corr-team-only',
        runtimeOwner: 'mag_one', cardRevisionId: 'revision:card_magentic',
        magenticExecution,
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/magentic-mission-readiness');
      return { ok: true, runId: 'corr-team-only' };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/magentic/execution/submit');
      return {
        ok: true, state: 'running', nativeStatus: 'triage', nativeRootId: 't_team_root',
        outerRunBound: true,
        nativeIdentity: 'team', effectiveProvider: 'openai-codex',
        providerApiMode: 'codex_app_server', model: 'gpt-5.6-terra',
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/progress');
      return { ok: true, runId: 'corr-team-only', updated: true };
    });

    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_magentic',
          senderCardId: 'card_main_chat', correlationId: 'corr-team-only',
          conversationId: 'main', input: 'Use the automatic Team.', action: 'execute',
          cardRevisionId: 'revision:card_magentic',
        }),
      });

      expect(response.status).toBe(202);
      expect(agentTerminalMocks.manager.open).toHaveBeenCalledOnce();
      expect(agentTerminalMocks.manager.open).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'card_team' }),
        expect.objectContaining({ id: 'card_team' }),
        expect.any(Object),
        120,
        36,
        { attachTui: false, materializeTaskProfile: true },
      );
      expect(agentTerminalMocks.manager.open).not.toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ id: 'card_magentic' }),
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      );
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          status: 'running', state: 'running', runtimeOwner: 'mag_one',
          transport: {
            threadId: 't_team_root', runtimeSource: 'repository_hermes_magentic',
          },
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  it('keeps Magnetic task and handoff state without mutating the outer Run', async () => {
    orchestratorMocks.runRecords.clear();
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
    orchestratorMocks.runRecords.set('magnetic-inspection', {
      runId: 'magnetic-inspection', correlationId: 'magnetic-inspection',
      projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_magentic',
      state: 'running', runtimeKind: 'hermes', runtimeMode: 'magentic_one',
      runtimeProfile: 'card_magentic', nativeRootId: 't_magnetic_inspection',
      nativeStatus: 'ready', startedAt: new Date().toISOString(), result: null,
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint, init) => {
      if (endpoint === '/magentic/execution/status') {
        return {
          ok: true, state: 'running', nativeStatus: 'ready',
          nativeRootId: 't_magnetic_inspection', nativeRunId: null,
          nativeTasks: [{
            taskId: 't_magnetic_inspection', title: 'Magnetic mission',
            assignee: 'card_magentic', status: 'ready', dependencyIds: [],
            latestAttempt: null, resultAvailable: false,
            handoffSummary: 'Worker returned one bounded saved Card result.',
          }],
        };
      }
      return railsImplementation(endpoint, init);
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status', inspectOnly: true, projectId: 'project-1',
          deckId: 'deck_builder', cardId: 'card_magentic',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runId: 'magnetic-inspection', state: 'running', nativeStatus: 'ready',
          nativeTasks: [{
            taskId: 't_magnetic_inspection', status: 'ready',
            handoffSummary: 'Worker returned one bounded saved Card result.',
          }],
        },
      });
      const endpoints = orchestratorMocks.requestPythonRailsJson.mock.calls
        .map(([endpoint]) => endpoint);
      expect(endpoints.filter((endpoint) => endpoint === '/magentic/execution/status')).toHaveLength(1);
      expect(endpoints).not.toEqual(expect.arrayContaining([
        '/domain/runs/progress', '/domain/runs/finish',
      ]));
    } finally {
      orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
      await closeServer(server);
    }
  });

  it('does not project detached Magnetic transcript detail through the backend boundary', async () => {
    orchestratorMocks.runRecords.clear();
    const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
    orchestratorMocks.runRecords.set('magnetic-invalid-detail', {
      runId: 'magnetic-invalid-detail', correlationId: 'magnetic-invalid-detail',
      projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_magentic',
      state: 'running', runtimeKind: 'hermes', runtimeMode: 'magentic_one',
      runtimeProfile: 'card_magentic', nativeRootId: 't_magnetic_invalid_detail',
      nativeStatus: 'ready', startedAt: new Date().toISOString(), result: null,
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint, init) => {
      if (endpoint === '/magentic/execution/status') {
        return {
          ok: true, state: 'running', nativeStatus: 'ready',
          nativeRootId: 't_magnetic_invalid_detail', nativeRunId: null,
          nativeTasks: [{
            taskId: 't_magnetic_invalid_detail', title: 'Magnetic mission',
            assignee: 'card_magentic', status: 'ready', dependencyIds: [],
            latestAttempt: null, resultAvailable: false,
            workerSessionId: 'worker-session-one', handoffSummary: 'Bounded handoff.',
            toolReceiptsComplete: true,
            toolReceipts: [{ executionReceipt: { state: 'completed' } }],
          }],
        };
      }
      return railsImplementation(endpoint, init);
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status', inspectOnly: true, projectId: 'project-1',
          deckId: 'deck_builder', cardId: 'card_magentic',
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: true,
        result: {
          nativeTasks: [{
            taskId: 't_magnetic_invalid_detail',
            handoffSummary: 'Bounded handoff.',
          }],
        },
      });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('workerSessionId');
      expect(serialized).not.toContain('toolReceipts');
      expect(serialized).not.toContain('executionReceipt');
    } finally {
      orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
      await closeServer(server);
    }
  });

  it('stops an accepted Magnetic root when outer-Run progress binding fails', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const magenticExecution = {
      runId: 'corr-mag-unbound',
      correlationId: 'corr-mag-unbound',
      projectId: 'project-1',
      deckId: 'deck_builder',
      inputFile: {
        workspace: 'C:\\runtime-inputs\\mag-unbound',
        idfPath: 'C:\\runtime-inputs\\mag-unbound\\in.idf',
        idfSha256: 'd'.repeat(64),
        idfBytes: 500,
      },
      mission: 'Coordinate the bounded mission.',
      orchestrator: {
        cardId: 'card_magentic',
        cardRevisionId: 'revision:card_magentic',
        nativeIdentity: 'card_magentic',
        instructions: 'Saved Mag One prompt',
        provider: {
          provider: 'openai', accessMode: 'chatgpt-account',
          modelKey: 'gpt-5.6-sol', providerModelId: 'gpt-5.6-sol',
        },
        runtimeOptions: {},
      },
      workers: [{
        cardId: 'builder', cardRevisionId: 'revision:builder',
        profile: 'builder', title: 'Builder', description: 'Saved worker',
      }],
    };
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/begin');
      return {
        runId: 'corr-mag-unbound',
        correlationId: 'corr-mag-unbound',
        runtimeOwner: 'mag_one',
        cardRevisionId: 'revision:card_magentic',
        magenticExecution,
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/magentic-mission-readiness');
      return { ok: true, runId: 'corr-mag-unbound' };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/magentic/execution/submit');
      return {
        ok: true, state: 'running', nativeStatus: 'ready', nativeRootId: 't_mag_unbound',
        outerRunBound: true,
        nativeIdentity: 'card_magentic', effectiveProvider: 'openai-codex',
        providerApiMode: 'codex_app_server', model: 'gpt-5.6-sol',
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/progress');
      throw new Error('outer_run_progress_unavailable');
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string, init?: RequestInit) => {
      expect(endpoint).toBe('/magentic/execution/stop');
      expect(JSON.parse(String(init?.body))).toEqual({ nativeRootId: 't_mag_unbound' });
      return {
        ok: true, state: 'cancelled', nativeStatus: 'archived', nativeRootId: 't_mag_unbound',
        nativeIdentity: 'card_magentic', effectiveProvider: 'openai-codex',
        providerApiMode: 'codex_app_server', error: 'cancelled_by_outer_run_bind_failure',
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string, init?: RequestInit) => {
      expect(endpoint).toBe('/domain/runs/finish');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        runId: 'corr-mag-unbound', state: 'cancelled',
        providerThreadRef: 't_mag_unbound', nativeStatus: 'archived',
        errorCode: 'magentic_execution_cancelled',
        errorSummary: 'cancelled_by_outer_run_bind_failure',
      });
      return { receipt: { runId: 'corr-mag-unbound', state: 'cancelled' } };
    });

    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_magentic',
          senderCardId: 'card_main_chat', correlationId: 'corr-mag-unbound',
          conversationId: 'main', input: 'Coordinate the bounded mission.', action: 'execute',
          cardRevisionId: 'revision:card_magentic',
        }),
      });
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        ok: false, error: 'outer_run_progress_unavailable',
      });
      expect(orchestratorMocks.requestPythonRailsJson.mock.calls.map(([endpoint]) => endpoint)).toEqual([
        '/domain/runs/begin',
        '/domain/runs/magentic-mission-readiness',
        '/magentic/execution/submit',
        '/domain/runs/progress',
        '/magentic/execution/stop',
        '/domain/runs/finish',
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it('reconciles a native Mag One blocked root without claiming completion', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    orchestratorMocks.dispatchConfiguredRuntime.mockClear();
    const startedAt = new Date().toISOString();
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/read');
      return { ok: true, run: {
        runId: 'failed-native-root', correlationId: 'failed-native-root', cardId: 'card_magentic',
        state: 'running', runtimeKind: 'hermes', runtimeMode: 'magentic_one',
        runtimeProfile: 'card_magentic', nativeRootId: 't_failed_root',
        nativeStatus: 'running', startedAt, result: null,
      } };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/magentic/execution/status');
      return {
        ok: true, state: 'blocked', nativeStatus: 'blocked', nativeRootId: 't_failed_root',
        nativeRunId: 1,
        nativeIdentity: 'card_magentic', effectiveProvider: 'openai-codex',
        providerApiMode: 'codex_app_server', model: 'gpt-5.6-sol',
        error: 'magentic_task_blocked:t_worker',
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string, init?: RequestInit) => {
      expect(endpoint).toBe('/domain/runs/finish');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        runId: 'failed-native-root', state: 'blocked', nativeStatus: 'blocked',
        providerThreadRef: 't_failed_root', providerTurnRef: 1,
        errorCode: 'magentic_execution_blocked',
        errorSummary: 'magentic_task_blocked:t_worker',
        finalResult: null,
      });
      return { receipt: { runId: 'failed-native-root', state: 'blocked' } };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/read');
      return { ok: true, run: {
        runId: 'failed-native-root', correlationId: 'failed-native-root', cardId: 'card_magentic',
        state: 'blocked', runtimeKind: 'hermes', runtimeMode: 'magentic_one',
        runtimeProfile: 'card_magentic', nativeRootId: 't_failed_root', nativeRunId: 1,
        nativeStatus: 'blocked', effectiveProvider: 'openai-codex',
        providerApiMode: 'codex_app_server', errorCode: 'magentic_execution_blocked',
        errorSummary: 'magentic_task_blocked:t_worker', startedAt,
        finishedAt: new Date().toISOString(), result: null,
      } };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/agentgraph/inspect');
      return { runs: [], attentionEvents: [] };
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', deckId: 'deck_builder', runId: 'failed-native-root', action: 'status',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runId: 'failed-native-root', state: 'blocked', status: 'blocked',
          nativeRootId: 't_failed_root', nativeRunId: 1,
          output: null, errorCode: 'magentic_execution_blocked',
          errorSummary: 'magentic_task_blocked:t_worker',
        },
      });
      expect(orchestratorMocks.dispatchConfiguredRuntime).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('terminalizes a completed Magnetic root with no final result as failed', async () => {
    orchestratorMocks.requestPythonRailsJson.mockClear();
    const startedAt = new Date().toISOString();
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/read');
      return { ok: true, run: {
        runId: 'missing-final-root', correlationId: 'missing-final-root', cardId: 'card_magentic',
        state: 'running', runtimeKind: 'hermes', runtimeMode: 'magentic_one',
        runtimeProfile: 'card_magentic', nativeRootId: 't_missing_final',
        nativeStatus: 'running', startedAt, result: null,
      } };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/magentic/execution/status');
      return {
        ok: true, state: 'completed', nativeStatus: 'done', nativeRootId: 't_missing_final',
        nativeRunId: 4, nativeIdentity: 'card_magentic', effectiveProvider: 'openai-codex',
        providerApiMode: 'codex_app_server', model: 'gpt-5.6-sol', finalResult: '   ',
      };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string, init?: RequestInit) => {
      expect(endpoint).toBe('/domain/runs/finish');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        runId: 'missing-final-root', state: 'failed', nativeStatus: 'done',
        providerThreadRef: 't_missing_final', providerTurnRef: 4,
        errorCode: 'magentic_final_result_missing',
        errorSummary: 'magentic_final_result_missing', finalResult: null,
      });
      return { receipt: { runId: 'missing-final-root', state: 'failed' } };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/runs/read');
      return { ok: true, run: {
        runId: 'missing-final-root', correlationId: 'missing-final-root', cardId: 'card_magentic',
        state: 'failed', runtimeKind: 'hermes', runtimeMode: 'magentic_one',
        runtimeProfile: 'card_magentic', nativeRootId: 't_missing_final', nativeRunId: 4,
        nativeStatus: 'done', effectiveProvider: 'openai-codex',
        providerApiMode: 'codex_app_server', errorCode: 'magentic_final_result_missing',
        errorSummary: 'magentic_final_result_missing', startedAt,
        finishedAt: new Date().toISOString(), result: null,
      } };
    });
    orchestratorMocks.requestPythonRailsJson.mockImplementationOnce(async (endpoint: string) => {
      expect(endpoint).toBe('/domain/agentgraph/inspect');
      return { runs: [], attentionEvents: [] };
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/cards/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1', deckId: 'deck_builder', runId: 'missing-final-root', action: 'status',
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        result: {
          runId: 'missing-final-root', state: 'failed', status: 'done',
          nativeRootId: 't_missing_final', nativeRunId: 4, output: null,
          errorCode: 'magentic_final_result_missing',
          errorSummary: 'magentic_final_result_missing',
        },
      });
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
          'X-LiquidAIty-Internal-MCP-Secret': String(
            process.env.LIQUIDAITY_INTERNAL_MCP_SECRET || '',
          ),
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
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat', conversationId: 'attention' },
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

    it('delivers Main text before grading and rejects a malformed Score receipt at the backend boundary', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint, init, options) => {
        if (endpoint === '/domain/runs/request-fulfillment') {
          return {
            ok: true,
            assessment: {
              schemaVersion: 'request-fulfillment-assessment.v1',
              metric: 'request_fulfillment',
              rubricVersion: 'request-fulfillment.v1',
              status: 'scored',
              runId: 'wrong-run',
            },
          };
        }
        return railsImplementation(endpoint, init, options);
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'malformed-score', message: 'inspect',
          }),
        });
        const body = await response.text();
        const frames = body.split('\n\n');
        const doneIndex = frames.findIndex((frame) => frame.startsWith('event: done'));
        const scoreIndex = frames.findIndex((frame) => frame.startsWith('event: request_fulfillment'));
        expect(response.status).toBe(200);
        expect(doneIndex).toBeGreaterThanOrEqual(0);
        expect(scoreIndex).toBeGreaterThan(doneIndex);
        const scoreFrame = JSON.parse(frames[scoreIndex].split('\ndata: ')[1]);
        expect(scoreFrame.assessment).toMatchObject({
          schemaVersion: 'request-fulfillment-assessment.v1',
          status: 'unavailable',
          failureReason: 'request_fulfillment_receipt_invalid',
          requestCount: 0,
          questionCount: 0,
        });
      } finally {
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        await closeServer(server);
      }
    });

    it('streams one complete Jev attention decision after Run identity and before runtime inference', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      const jevAttention = {
        schemaVersion: 'jev-attention.v1',
        status: 'success',
        decisionId: 'attention-decision-one',
        resultIdentity: 'attention-result-one',
        candidates: [{
          choiceId: 'think-one', authority: 'ThinkGraph', nativeId: 'think-native-one',
          title: 'Think candidate', probability: 0.6, selected: true, hydrated: true,
        }, {
          choiceId: 'know-one', authority: 'KnowGraph', nativeId: 'know-native-one',
          title: 'Know candidate', probability: 0.4, selected: false, hydrated: false,
        }],
        distribution: {
          'think-one': 0.6,
          'know-one': 0.4,
          ATTENTION_NEW_SUBJECT: 0,
        },
        winner: 'think-one',
        confidence: 0.86,
        selectedReferences: [{ authority: 'ThinkGraph', nativeId: 'think-native-one' }],
        policy: { name: 'main-fast-graph-attention' },
        provider: 'TypeSafe',
        requestedModel: 'openrouter/jev',
        resolvedModel: 'openrouter/jev-resolved',
        timingMs: { jev: 9, total: 12 },
        error: null,
      };
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint, init) => {
        const value = await railsImplementation(endpoint, init);
        return endpoint === '/domain/main/runs/begin' || endpoint === '/domain/runs/begin'
          ? { ...value as Record<string, unknown>, jevAttention }
          : value;
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'jev-attention-order',
            message: 'inspect exact prepared graph attention',
          }),
        });
        const body = await response.text();
        const frames = body.split('\n\n');
        const eventNames = frames.flatMap((frame) => {
          const match = /^event: (.+)$/m.exec(frame);
          return match ? [match[1]] : [];
        });
        expect(eventNames.filter((name) => name === 'jev_attention')).toEqual(['jev_attention']);
        expect(eventNames.indexOf('run')).toBeLessThan(eventNames.indexOf('jev_attention'));
        expect(eventNames.indexOf('jev_attention')).toBeLessThan(eventNames.indexOf('session'));
        const attentionFrame = frames.find((frame) => frame.startsWith('event: jev_attention'))!;
        expect(JSON.parse(attentionFrame.split('\ndata: ')[1])).toEqual({
          kind: 'jev_attention',
          ...jevAttention,
          projectId: 'project-1', deckId: 'deck_builder', conversationId: 'jev-attention-order',
          cardId: 'card_main_chat', runId: expect.stringMatching(/^req_/),
          participant: expect.objectContaining({ kind: 'card', cardId: 'card_main_chat' }),
          directAddressed: false,
        });

        const addressed = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'jev-attention-addressed',
            message: '@builder answer directly',
          }),
        });
        const addressedBody = await addressed.text();
        expect(addressed.status).toBe(200);
        expect(addressedBody).not.toContain('event: jev_attention');
      } finally {
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        await closeServer(server);
      }
    });

    it('uses targetCardId as the direct Project Card route and preserves the full multiline reply', async () => {
      agentTerminalMocks.manager.submit.mockClear();
      agentTerminalMocks.resolveHermesBotRosterProjections.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      agentTerminalMocks.manager.queueNativeContextCompaction.mockClear();
      const projectDeck = await deckMocks.getDeckDocument();
      projectDeck.deck.edges = projectDeck.deck.edges.filter((edge: any) => (
        edge.source !== 'builder' && edge.target !== 'builder'
      ));
      deckMocks.getDeckDocument
        .mockResolvedValueOnce(projectDeck)
        .mockResolvedValueOnce(projectDeck);
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
        const exactMessage = 'Reply exactly BUILDER_DIRECT_OK';
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'direct-builder',
            targetCardId: 'builder', message: exactMessage,
          }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('BUILDER_DIRECT_OK');
        const runFrame = body.split('\n\n').find((frame) => frame.startsWith('event: run'))!;
        const runEvent = JSON.parse(runFrame.split('\ndata: ')[1]);
        expect(runEvent).toMatchObject({
          cardId: 'builder', directAddressed: true, turnOwner: 'addressed_card',
          participant: {
            cardId: 'builder', profile: 'builder', label: 'Builder', address: 'Builder',
          },
        });
        const doneFrame = body.split('\n\n').find((frame) => frame.startsWith('event: done'))!;
        expect(JSON.parse(doneFrame.split('\ndata: ')[1]).fullText).toBe(fullReply);
        const railsCalls = orchestratorMocks.requestPythonRailsJson.mock.calls;
        expect(railsCalls.filter(([endpoint]) => endpoint === '/domain/main/runs/begin')).toHaveLength(0);
        const beginCalls = railsCalls.filter(([endpoint]) => endpoint === '/domain/runs/begin');
        expect(beginCalls).toHaveLength(1);
        expect(JSON.parse(String(beginCalls[0][1]?.body))).toMatchObject({
          cardId: 'builder', assignment: exactMessage, conversationId: 'direct-builder',
          sharedConversation: [], sharedConversationTargetLabel: 'Builder',
        });
        expect(JSON.parse(String(beginCalls[0][1]?.body))).not.toHaveProperty('senderCardId');
        expect(agentTerminalMocks.resolveHermesBotRosterProjections).not.toHaveBeenCalled();
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledTimes(1);
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledWith(
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder', conversationId: 'direct-builder' },
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
          state: 'completed', finalResult: fullReply,
          hermesSessionId: 'native:builder',
        });
        expect(agentTerminalMocks.manager.queueNativeContextCompaction).toHaveBeenCalledOnce();
        expect(agentTerminalMocks.manager.queueNativeContextCompaction).toHaveBeenCalledWith(
          expect.objectContaining({ cardId: 'builder', conversationId: 'direct-builder' }),
          expect.objectContaining({
            sessionId: 'terminal:builder', nativeSessionId: 'native:builder', profile: 'builder',
          }),
          expect.any(Function),
        );
      } finally {
        await closeServer(server);
      }
    });

    it('uses only persisted Project history for a direct Card turn', async () => {
      chatSessionMocks.getConversationMessages.mockResolvedValueOnce([{
        role: 'user', status: 'complete', content: 'Earlier shared question',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
          { kind: 'shared_chat_target', status: 'card', label: 'Main', cardId: 'card_main_chat' },
        ],
      }, {
        role: 'assistant', status: 'complete', content: 'Earlier Main answer',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'card', label: 'Main', cardId: 'card_main_chat' },
        ],
      }] as any);
      agentTerminalMocks.manager.history.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'first-direct-after-native-main',
            targetCardId: 'builder', message: 'Continue from the shared conversation.',
          }),
        });
        expect(response.status).toBe(200);
        await response.text();

        const begin = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([endpoint]) => endpoint === '/domain/runs/begin',
        );
        expect(begin).toBeDefined();
        expect(JSON.parse(String(begin?.[1]?.body))).toMatchObject({
          cardId: 'builder',
          sharedConversationTargetLabel: 'Builder',
          sharedConversation: [{
            role: 'user', speakerLabel: 'You', targetCardId: 'card_main_chat',
            targetLabel: 'Main', content: 'Earlier shared question',
          }, {
            role: 'assistant', speakerCardId: 'card_main_chat', speakerLabel: 'Main',
            content: 'Earlier Main answer',
          }],
        });
        expect(chatSessionMocks.appendSharedConversationTurn).toHaveBeenCalledWith(
          expect.not.objectContaining({ seedMessages: expect.anything() }),
        );
        expect(agentTerminalMocks.manager.history).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('starts the exact Magnetic outer Run from its public address without using the Gateway', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      agentTerminalMocks.manager.submit.mockClear();
      agentTerminalMocks.manager.open.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      let preparedRunId = '';
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint: string, init?: RequestInit) => {
        const request = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        if (endpoint === '/domain/runs/begin' && request.cardId === 'card_magentic') {
          preparedRunId = request.runId;
          expect(request).toMatchObject({
            projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_magentic',
            cardRevisionId: 'revision:card_magentic',
            assignment: '@Magnetic Coordinate the bounded mission.',
            conversationId: 'direct-magnetic', correlationId: request.runId,
          });
          expect(request).not.toHaveProperty('senderCardId');
          return {
            runId: request.runId,
            correlationId: request.correlationId,
            runtimeOwner: 'mag_one',
            cardRevisionId: 'revision:card_magentic',
            magenticExecution: {
              runId: request.runId,
              correlationId: request.correlationId,
              projectId: request.projectId,
              deckId: request.deckId,
              mission: request.assignment,
              inputFile: {
                workspace: 'C:\\runtime-inputs\\magnetic-shared-chat',
                idfPath: 'C:\\runtime-inputs\\magnetic-shared-chat\\in.idf',
                idfSha256: 'c'.repeat(64), idfBytes: 500,
              },
              orchestrator: {
                cardId: 'card_magentic', cardRevisionId: 'revision:card_magentic',
                nativeIdentity: 'card_magentic', instructions: 'Saved Mag One prompt',
                provider: { provider: 'openai', accessMode: 'chatgpt-account',
                  modelKey: 'gpt-5.6-sol', providerModelId: 'gpt-5.6-sol' },
                runtimeOptions: {},
              },
              workers: [
                { cardId: 'card_test_delegate', cardRevisionId: 'revision:card_test_delegate',
                  profile: 'delegate', title: 'Delegate', description: 'Saved worker' },
                { cardId: 'builder', cardRevisionId: 'revision:builder',
                  profile: 'builder', title: 'Builder', description: 'Saved worker' },
              ],
            },
          };
        }
        if (endpoint === '/domain/runs/magentic-mission-readiness') {
          expect(request).toMatchObject({ runId: preparedRunId });
          return { ok: true, runId: preparedRunId };
        }
        if (endpoint === '/magentic/execution/submit') {
          expect(request).toMatchObject({
            runId: preparedRunId,
            orchestrator: { cardId: 'card_magentic', nativeIdentity: 'card_magentic' },
          });
          expect(request).not.toHaveProperty('notifySession');
          return {
            ok: true, state: 'running', nativeStatus: 'ready', nativeRootId: 't_shared_magnetic',
            outerRunBound: true,
            nativeIdentity: 'card_magentic', effectiveProvider: 'openai-codex',
            providerApiMode: 'codex_app_server', model: 'gpt-5.6-sol',
          };
        }
        return railsImplementation(endpoint, init);
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'direct-magnetic',
            message: '@Magnetic Coordinate the bounded mission.',
          }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        const frames = body.split('\n\n');
        expect(frames.some((frame) => frame.startsWith('event: session'))).toBe(false);
        const runningFrame = frames.filter((frame) => frame.startsWith('event: run'))
          .map((frame) => JSON.parse(frame.split('\ndata: ')[1]))
          .find((event) => event.state === 'running');
        expect(runningFrame).toMatchObject({
          cardId: 'card_magentic', directAddressed: true, runtimeOwner: 'mag_one',
          participant: { cardId: 'card_magentic', profile: 'card_magentic',
            label: 'Magnetic', address: 'Magnetic' },
        });
        const doneFrame = frames.find((frame) => frame.startsWith('event: done'))!;
        const done = JSON.parse(doneFrame.split('\ndata: ')[1]);
        expect(done).toMatchObject({
          fullText: `Magnetic accepted this mission. Run ${preparedRunId} is active.`,
          usage: { usageAvailable: false, usageSource: 'native_magnetic_submission' },
        });
        expect(done.fullText).not.toMatch(/complete|finished|final/i);
        expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
        expect(agentTerminalMocks.manager.open).toHaveBeenCalledTimes(3);
        expect(chatSessionMocks.appendSharedConversationTurn).toHaveBeenCalledWith(expect.objectContaining({
          projectId: 'project-1', conversationId: 'direct-magnetic',
          messages: [
            expect.objectContaining({ role: 'user', target: expect.objectContaining({
              cardId: 'card_magentic', label: 'Magnetic', address: 'Magnetic',
            }) }),
            expect.objectContaining({
              role: 'assistant', content: done.fullText,
              speaker: expect.objectContaining({ cardId: 'card_magentic', label: 'Magnetic' }),
              providerContinuationRef: 't_shared_magnetic', providerMessageId: preparedRunId,
            }),
          ],
        }));
      } finally {
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        await closeServer(server);
      }
    });

    it('attributes a failed direct Builder turn without invoking Main or recording fake delivery', async () => {
      agentTerminalMocks.manager.submit.mockClear();
      agentTerminalMocks.manager.queueNativeContextCompaction.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      agentTerminalMocks.manager.history.mockResolvedValueOnce({ count: 2, messages: [
        { role: 'user', text: 'Existing native question' },
        { role: 'assistant', text: 'Existing native answer' },
      ] });
      agentTerminalMocks.manager.submit.mockRejectedValueOnce(new Error('native_builder_unavailable'));
      agentTerminalMocks.manager.queueNativeContextCompaction.mockRejectedValueOnce(
        new Error('native_compaction_unavailable'),
      );
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
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder', conversationId: 'direct-builder-failure' },
          'terminal:builder',
          exactMessage,
          expect.any(Object),
        );
        expect(agentTerminalMocks.manager.queueNativeContextCompaction).toHaveBeenCalledWith(
          expect.objectContaining({ cardId: 'builder', conversationId: 'direct-builder-failure' }),
          expect.objectContaining({
            sessionId: 'terminal:builder', nativeSessionId: 'native:builder',
            storedSessionId: 'native:builder', profile: 'builder',
          }),
          expect.any(Function),
        );
        expect(body).not.toContain('native_compaction_unavailable');
        expect(body).not.toContain('session.compress');
        expect(chatSessionMocks.appendSharedConversationTurn).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('allows a successful empty Project conversation without consulting Hermes history', async () => {
      chatSessionMocks.getConversationMessages.mockResolvedValueOnce([]);
      agentTerminalMocks.manager.findCard.mockReturnValueOnce(null);
      agentTerminalMocks.manager.history.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'first-direct-without-main-runtime',
            targetCardId: 'builder', message: 'Start this shared conversation.',
          }),
        });
        expect(response.status).toBe(200);
        await response.text();
        const begin = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([endpoint]) => endpoint === '/domain/runs/begin',
        );
        expect(JSON.parse(String(begin?.[1]?.body))).toMatchObject({
          cardId: 'builder', sharedConversation: [],
        });
        expect(agentTerminalMocks.manager.history).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('refuses a direct Card turn when the Project conversation cannot be read', async () => {
      chatSessionMocks.getConversationMessages.mockRejectedValueOnce(new Error('database_unavailable'));
      agentTerminalMocks.manager.history.mockClear();
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'first-direct-history-failure',
            targetCardId: 'builder', message: 'Do not run without the visible history.',
          }),
        });
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
          ok: false, error: 'shared_conversation_unavailable',
        });
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
          ([endpoint]) => endpoint === '/domain/main/runs/begin' || endpoint === '/domain/runs/begin',
        )).toHaveLength(0);
        expect(agentTerminalMocks.manager.history).not.toHaveBeenCalled();
        expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
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

    it('rejects conflicting typed and targetCardId routes before any Run starts', async () => {
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.getConversationMessages.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'target-mismatch',
            targetCardId: 'builder', message: '@Delegate do this instead',
          }),
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
          ok: false,
          error: 'shared_chat_target_mismatch',
          address: 'delegate',
          targetCardId: 'builder',
        });
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
          ([endpoint]) => endpoint === '/domain/main/runs/begin' || endpoint === '/domain/runs/begin',
        )).toHaveLength(0);
        expect(chatSessionMocks.getConversationMessages).not.toHaveBeenCalled();
        expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
        expect(chatSessionMocks.appendSharedConversationTurn).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('refuses targetCardId when the Project Card has no current saved revision', async () => {
      deckMocks.getDeckDocument.mockResolvedValueOnce({ deck: {
        nodes: [{
          id: 'card_main_chat', _cardRevisionId: 'revision:card_main_chat', title: 'Main',
          runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
        }, {
          id: 'builder', title: 'Builder',
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
        }],
        edges: [],
      } } as any);
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'stale-target',
            targetCardId: 'builder', message: 'Do not start.',
          }),
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
          ok: false, error: 'target_card_unavailable', targetCardId: 'builder',
        });
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
          ([endpoint]) => endpoint === '/domain/main/runs/begin' || endpoint === '/domain/runs/begin',
        )).toHaveLength(0);
        expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('passes only intervening Project turns to a reselected Card', async () => {
      chatSessionMocks.getConversationMessages.mockResolvedValueOnce([{
        role: 'user', status: 'complete', content: 'First Builder question',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
          { kind: 'shared_chat_target', status: 'card', label: 'Builder', cardId: 'builder',
            profile: 'builder', address: 'Builder' },
        ],
      }, {
        role: 'assistant', status: 'complete', content: 'Prior Builder answer',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'card', label: 'Builder', cardId: 'builder',
            profile: 'builder', address: 'Builder' },
        ],
      }, {
        role: 'user', status: 'complete', content: '@Delegate inspect this',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
          { kind: 'shared_chat_target', status: 'card', label: 'Delegate', cardId: 'card_test_delegate',
            profile: 'delegate', address: 'Delegate' },
        ],
      }, {
        role: 'assistant', status: 'complete', content: 'Delegate result',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'card', label: 'Delegate',
            cardId: 'card_test_delegate', profile: 'delegate', address: 'Delegate' },
        ],
      }] as any);
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'builder-return',
            targetCardId: 'builder', message: 'Continue with that result.',
          }),
        });
        expect(response.status).toBe(200);
        await response.text();
        const begin = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([endpoint]) => endpoint === '/domain/runs/begin',
        );
        expect(begin).toBeDefined();
        expect(JSON.parse(String(begin?.[1]?.body))).toMatchObject({
          cardId: 'builder',
          assignment: 'Continue with that result.',
          sharedConversationTargetLabel: 'Builder',
          sharedConversation: [{
            role: 'user', speakerLabel: 'You', targetCardId: 'card_test_delegate',
            targetLabel: 'Delegate', content: '@Delegate inspect this',
          }, {
            role: 'assistant', speakerCardId: 'card_test_delegate',
            speakerLabel: 'Delegate', content: 'Delegate result',
          }],
        });
        const serialized = String(begin?.[1]?.body);
        expect(serialized).not.toContain('First Builder question');
        expect(serialized).not.toContain('Prior Builder answer');
      } finally {
        await closeServer(server);
      }
    });

    it.each(['internal-profile', 'card_internal_123'])(
      'does not expose the saved Card %s as a public address alias', async (internalAddress) => {
        deckMocks.getDeckDocument.mockResolvedValueOnce({ deck: {
          nodes: [{
            id: 'card_main_chat', _cardRevisionId: 'revision:card_main_chat', title: 'Main',
            runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
          }, {
            id: 'card_internal_123', _cardRevisionId: 'revision:card_internal_123', title: 'KnowGraph',
            runtime: { kind: 'hermes', mode: 'delegate', profile: 'internal-profile' },
          }],
          edges: [],
        } } as any);
        agentTerminalMocks.manager.submit.mockClear();
        orchestratorMocks.requestPythonRailsJson.mockClear();
        chatSessionMocks.appendSharedConversationTurn.mockClear();
        const { server, baseUrl } = await createApiServer();
        try {
          const response = await fetch(`${baseUrl}/main/session/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: 'project-1', conversationId: 'internal-alias',
              message: `@${internalAddress} do work`,
            }),
          });
          expect(response.status).toBe(409);
          await expect(response.json()).resolves.toEqual({
            ok: false, error: 'addressed_card_unavailable', address: internalAddress,
          });
          expect(orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
            ([endpoint]) => endpoint === '/domain/main/runs/begin' || endpoint === '/domain/runs/begin',
          )).toHaveLength(0);
          expect(agentTerminalMocks.manager.submit).not.toHaveBeenCalled();
          expect(chatSessionMocks.appendSharedConversationTurn).not.toHaveBeenCalled();
        } finally {
          await closeServer(server);
        }
      },
    );

    it('does not let a malformed visible Card title block Main or become a partial address', async () => {
      deckMocks.getDeckDocument.mockResolvedValueOnce({ deck: {
        nodes: [{
          id: 'card_main_chat', _cardRevisionId: 'revision:card_main_chat', title: 'Main',
          runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
        }, {
          id: 'card_internal_123', _cardRevisionId: 'revision:card_internal_123', title: 'Graph Agent',
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'internal-profile' },
        }],
        edges: [],
      } } as any);
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      chatSessionMocks.appendSharedConversationTurn.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'invalid-visible-title',
            message: '@Graph do work',
          }),
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
          ok: false, error: 'addressed_card_unavailable', address: 'graph',
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
          role: 'user', status: 'complete', content: 'Earlier Main question',
          visibleActivities: [
            { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
            { kind: 'shared_chat_target', status: 'card', label: 'Main',
              cardId: 'card_main_chat', profile: 'default', address: 'Main' },
          ],
        },
        {
          role: 'assistant', status: 'complete', content: 'Earlier Main answer',
          visibleActivities: [
            { kind: 'shared_chat_speaker', status: 'card', label: 'Main',
              cardId: 'card_main_chat', profile: 'default', address: 'Main' },
          ],
        },
        {
          role: 'user', status: 'complete', content: '@builder Reply exactly BUILDER_DIRECT_OK',
          visibleActivities: [
            { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
            { kind: 'shared_chat_target', status: 'card', label: 'Builder', cardId: 'builder',
              profile: 'builder', address: 'Builder' },
          ],
        },
        {
          role: 'assistant', status: 'complete', content: 'BUILDER_DIRECT_OK',
          visibleActivities: [
            { kind: 'shared_chat_speaker', status: 'card', label: 'Builder', cardId: 'builder',
              profile: 'builder', address: 'Builder' },
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

    it('does not duplicate the preceding completed Main exchange into its resumed native session', async () => {
      chatSessionMocks.getConversationMessages.mockResolvedValueOnce([
        {
          role: 'user', status: 'complete', content: 'State one falsifiable claim.',
          visibleActivities: [
            { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
            { kind: 'shared_chat_target', status: 'card', label: 'Main',
              cardId: 'card_main_chat', profile: 'default', address: 'Main' },
          ],
        },
        {
          role: 'assistant', status: 'complete', content: 'The prior falsifiable claim.',
          visibleActivities: [
            { kind: 'shared_chat_speaker', status: 'card', label: 'Main',
              cardId: 'card_main_chat', profile: 'default', address: 'Main' },
          ],
        },
      ] as any);
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'main-continuity',
            message: 'What would disprove that claim?',
          }),
        });
        expect(response.status).toBe(200);
        await response.text();
        const begin = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([endpoint]) => endpoint === '/domain/main/runs/begin',
        );
        expect(begin).toBeDefined();
        expect(JSON.parse(String(begin?.[1]?.body))).toMatchObject({
          message: 'What would disprove that claim?',
          sharedConversation: [],
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
          unavailableToolCatalogFamilies: [],
        });
      } finally {
        await closeServer(server);
      }
    });

    it('keeps Main available when only the optional CBM catalog family is unavailable', async () => {
      mcpClientMocks.readPythonAgentMcpCatalog.mockResolvedValueOnce({
        state: 'available',
        tools: [],
        unavailableFamilies: ['cbm'],
      });
      agentTerminalMocks.manager.submit.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'cbm-down', message: 'Can you still answer?',
          }),
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('event: done');
        expect(agentTerminalMocks.manager.submit).toHaveBeenCalledTimes(1);
        const beginCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([endpoint]) => endpoint === '/domain/main/runs/begin',
        );
        const beginBody = JSON.parse(String(beginCall?.[1]?.body || '{}'));
        expect(beginBody).toMatchObject({
          discoveredTools: [],
          discoveredToolCatalogState: 'available',
          unavailableToolCatalogFamilies: ['cbm'],
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

    it('returns Main normally and starts one exact completed-pair ThinkGraph intake', async () => {
      const sourceCardSentinels = [
        'SOURCE_SOUL_SENTINEL',
        'SOURCE_ROLE_SENTINEL',
        'SOURCE_GOAL_SENTINEL',
        'SOURCE_SYSTEM_PROMPT_SENTINEL',
        'SOURCE_TOOL_METADATA_SENTINEL',
        'SOURCE_TOOL_GRANT_SENTINEL',
        'SOURCE_MCP_CONFIG_SENTINEL',
        'SOURCE_PROVIDER_SETTING_SENTINEL',
        'SOURCE_MODEL_SETTING_SENTINEL',
        'SOURCE_RUNTIME_OBSERVATION_SENTINEL',
        'SOURCE_COST_TOKEN_SENTINEL',
        'SOURCE_TEAMMATE_BLOCK_SENTINEL',
        'SOURCE_CARD_UI_CONFIG_SENTINEL',
        'UNRELATED_TRANSCRIPT_SENTINEL',
        'SOURCE_ASSESSMENT_PROVIDER_SENTINEL',
        'SOURCE_ASSESSMENT_MODEL_SENTINEL',
        'SOURCE_ASSESSMENT_USAGE_SENTINEL',
      ];
      const requestFulfillmentAssessment = {
        schemaVersion: 'request-fulfillment-assessment.v1',
        metric: 'request_fulfillment',
        rubricVersion: 'request-fulfillment.v1',
        status: 'unavailable',
        runId: expect.stringMatching(/^req_/),
        executionEvidenceComplete: true,
        executionEvidenceError: null,
        actualProvider: 'SOURCE_ASSESSMENT_PROVIDER_SENTINEL',
        actualModel: 'SOURCE_ASSESSMENT_MODEL_SENTINEL',
        failureReason: 'test_jev_provider_unavailable',
        usage: { source: 'SOURCE_ASSESSMENT_USAGE_SENTINEL' },
        requestCount: 0,
        questionCount: 0,
      };
      const exactRequestFulfillmentAssessment = {
        ...requestFulfillmentAssessment,
        runId: 'runtime-source-run-placeholder',
      };
      const defaultDeckImplementation = deckMocks.getDeckDocument.getMockImplementation()!;
      deckMocks.getDeckDocument.mockImplementation(async () => {
        const loaded = await defaultDeckImplementation();
        return {
          deck: {
            ...loaded.deck,
            nodes: loaded.deck.nodes.map((node: any) => node.id === 'card_main_chat' ? {
              ...node,
              prompt: [
                '[SOUL] SOURCE_SOUL_SENTINEL',
                '[ROLE] SOURCE_ROLE_SENTINEL',
                '[GOAL] SOURCE_GOAL_SENTINEL',
                '[SYSTEM] SOURCE_SYSTEM_PROMPT_SENTINEL',
                '[ALL CONNECTED AGENTS] SOURCE_TEAMMATE_BLOCK_SENTINEL',
              ].join('\n'),
              runtimeOptions: {
                ...node.runtimeOptions,
                tools: ['SOURCE_TOOL_GRANT_SENTINEL'],
                toolDefinitions: [{ description: 'SOURCE_TOOL_METADATA_SENTINEL' }],
                mcpConnectionIds: ['SOURCE_MCP_CONFIG_SENTINEL'],
                provider: 'SOURCE_PROVIDER_SETTING_SENTINEL',
                modelKey: 'SOURCE_MODEL_SETTING_SENTINEL',
                runtimeObservation: 'SOURCE_RUNTIME_OBSERVATION_SENTINEL',
                usage: 'SOURCE_COST_TOKEN_SENTINEL',
              },
              uiConfiguration: 'SOURCE_CARD_UI_CONFIG_SENTINEL',
            } : node),
          },
        } as any;
      });
      chatSessionMocks.getConversationMessages.mockResolvedValueOnce([{
        role: 'user', status: 'complete', content: 'UNRELATED_TRANSCRIPT_SENTINEL',
        visibleActivities: [
          { kind: 'shared_chat_speaker', status: 'user', label: 'You' },
          { kind: 'shared_chat_target', status: 'card', label: 'Main',
            cardId: 'card_main_chat', profile: 'default', address: 'Main' },
        ],
      }] as any);
      const defaultRailsImplementation = orchestratorMocks.requestPythonRailsJson
        .getMockImplementation()!;
      const defaultSubmitImplementation = agentTerminalMocks.manager.submit
        .getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson.mockReset();
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint, init) => {
        if (endpoint === '/domain/runs/request-fulfillment') {
          const request = JSON.parse(String(init?.body || '{}'));
          return { ...exactRequestFulfillmentAssessment, runId: request.runId };
        }
        if (endpoint === '/thinkgraph/completed-pair/prepare') return {
          ok: true,
          pairMemoryId: 'pair_reference_one',
          pairReference: 'pair_reference_one',
          intakeOperation: 'pending',
          structuredExtractionRequired: true,
          revision: 4,
          revisionChanged: false,
          preparation: { status: 'pending_structured_extraction' },
          enrichmentInput: {
            exact_user_message: 'complete with hybrid ThinkGraph intake',
            exact_main_response: 'Real assistant reply.',
            canonical_subject_directory: {
              complete: true, counts: { ThinkGraph: 0, KnowGraph: 0, total: 0 },
              subjects: [], sha256: 'a'.repeat(64), bytes: 256,
            },
            current_project_relationship_vocabulary: [
              'IS_A', 'PART_OF', 'HAS_PART', 'CAUSES', 'AFFECTS',
              'DEPENDS_ON', 'ENABLES', 'CONSTRAINS', 'REQUIRES', 'SUPPORTS',
              'CONTRADICTS', 'QUALIFIES', 'EXPLAINS', 'ASSOCIATED_WITH',
              'ALTERNATIVE_TO', 'COMPETES_WITH', 'PROVIDES', 'USES',
              'PRECEDES', 'FOLLOWS',
            ],
          },
          enrichmentSchema: {
            type: 'object',
            properties: { facts: { type: 'array' } },
            required: ['facts'],
          },
          enrichmentPrompt: [
            'Native Engraphis llm_structured prompt.',
            'exact_user_message: complete with hybrid ThinkGraph intake',
            'exact_main_response: Real assistant reply.',
            'canonical_subject_directory: complete compact subject headers',
            'current_project_relationship_vocabulary:',
            '["IS_A","PART_OF","HAS_PART","CAUSES","AFFECTS","DEPENDS_ON","ENABLES","CONSTRAINS","REQUIRES","SUPPORTS","CONTRADICTS","QUALIFIES","EXPLAINS","ASSOCIATED_WITH","ALTERNATIVE_TO","COMPETES_WITH","PROVIDES","USES","PRECEDES","FOLLOWS"]',
          ].join('\n'),
        };
        return defaultRailsImplementation(endpoint, init);
      });
      agentTerminalMocks.manager.submit.mockReset();
      agentTerminalMocks.manager.submit.mockImplementation(defaultSubmitImplementation);
      agentTerminalMocks.execution.stage.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const exactMessage = 'complete with hybrid ThinkGraph intake';
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'chat', message: exactMessage }),
        });
        expect(await response.text()).toContain('event: done');
        await vi.waitFor(() => {
          const diagnostic = JSON.stringify({
            rails: orchestratorMocks.requestPythonRailsJson.mock.calls.map(([route]) => route),
            submissions: agentTerminalMocks.manager.submit.mock.calls.map(
              ([owner, sessionId, message]) => ({ cardId: owner.cardId, sessionId, message }),
            ),
            staged: agentTerminalMocks.execution.stage.mock.calls.map(
              ([owner, sessionId, profile]) => ({ cardId: owner.cardId, sessionId, profile }),
            ),
          });
          expect(orchestratorMocks.requestPythonRailsJson.mock.calls.some(
            ([route]) => route === '/thinkgraph/completed-pair/settle',
          ), diagnostic).toBe(true);
        });
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.map(([route]) => route)).toEqual([
          '/domain/main/runs/begin',
          '/domain/runs/request-fulfillment',
          '/thinkgraph/completed-pair/prepare',
          '/domain/runs/begin',
          '/domain/runs/attempt',
          '/thinkgraph/completed-pair/settle',
        ]);
        const prepareCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([route]) => route === '/thinkgraph/completed-pair/prepare',
        );
        expect(prepareCall?.[1]).toMatchObject({ method: 'POST' });
        const completedPair = {
          projectId: 'project-1',
          deckId: 'deck_builder',
          conversationId: 'chat',
          runId: expect.stringMatching(/^req_/),
          cardId: 'card_main_chat',
          nativeSessionRef: 'native:default',
          completedAt: expect.any(String),
          userMessage: exactMessage,
          mainResponse: 'Real assistant reply.',
        };
        expect(JSON.parse(String(prepareCall?.[1]?.body))).toEqual(completedPair);

        const cardBegin = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([route]) => route === '/domain/runs/begin',
        );
        const cardBeginBody = JSON.parse(String(cardBegin?.[1]?.body));
        expect(cardBeginBody).toMatchObject({
          projectId: 'project-1',
          deckId: 'deck_builder',
          cardId: 'card_thinkgraph',
          cardRevisionId: 'revision:card_thinkgraph',
          senderCardId: 'card_main_chat',
          originatingRunId: completedPair.runId,
          conversationId: 'chat',
          runId: expect.stringMatching(/^req_/),
          correlationId: expect.stringMatching(/^req_/),
        });
        expect(cardBeginBody.assignment).toContain('current_project_relationship_vocabulary');
        expect(cardBeginBody.assignment).toContain('Prefer one exact existing');
        expect(cardBeginBody.assignment).toContain('never exceed three words');
        expect(cardBeginBody.assignment).toContain(
          'Jev alone classifies any durable graph edge',
        );
        expect(cardBeginBody.assignment).toContain(
          'Every relations[] item must contain exactly the three nonempty string fields',
        );
        expect(cardBeginBody.assignment).toContain(
          '{"source":"Launch cadence","relation":"SUPPORTS","target":"Execution quality"}',
        );
        expect(cardBeginBody.assignment).toContain(
          'Do not emit a thought category',
        );
        expect(cardBeginBody.assignment).toContain(
          'Create the current temporal ThinkGraph Think from this completed User/Main exchange',
        );
        expect(cardBeginBody.assignment).toContain(
          'Main does not author or initiate this automatic Think',
        );
        expect(cardBeginBody.assignment).toContain('canonical_subject_directory');
        expect(cardBeginBody.assignment).toContain('nearest concrete reusable subject');
        expect(cardBeginBody.assignment).toContain('generic wrapper entity');
        expect(cardBeginBody.assignment).toContain('belongs in the Think body');
        expect(cardBeginBody.assignment).toContain(
          'with the complete compact cross-graph subject',
        );
        expect(cardBeginBody.assignment).toContain(
          'Do not read historical Think bodies',
        );
        expect(cardBeginBody.assignment).toContain(
          'Never derive Think content or agreement from the directory',
        );
        expect(cardBeginBody.assignment).toContain(
          'Do not compare, merge, rewrite, or suppress the current Think against earlier Thinks',
        );
        expect(cardBeginBody.assignment).not.toContain('RegexGraphExtractor');
        expect(cardBeginBody.assignment).toContain(exactMessage);
        expect(cardBeginBody.assignment).toContain('Real assistant reply.');
        const extractorSubmit = agentTerminalMocks.manager.submit.mock.calls.find(
          ([owner]) => owner.cardId === 'card_thinkgraph',
        );
        expect(extractorSubmit).toBeDefined();
        expect(String(extractorSubmit?.[2])).toBe(cardBeginBody.assignment);
        expect(String(extractorSubmit?.[2])).toContain('canonical_subject_directory');
        for (const sentinel of sourceCardSentinels) {
          expect(cardBeginBody.assignment).not.toContain(sentinel);
          expect(String(extractorSubmit?.[2])).not.toContain(sentinel);
        }

        const settleCall = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([route]) => route === '/thinkgraph/completed-pair/settle',
        );
        expect(JSON.parse(String(settleCall?.[1]?.body))).toEqual({
          ...completedPair,
          pairMemoryId: 'pair_reference_one',
          structuredOutput: 'Real assistant reply.',
          cardRun: {
            runId: cardBeginBody.runId,
            cardId: 'card_thinkgraph',
            revisionId: 'revision:card_thinkgraph',
            profile: 'thinkgraph',
            nativeSessionRef: 'native:thinkgraph',
            resolvedModel: 'gpt-5.6-luna',
          },
        });
      } finally {
        await closeServer(server);
        deckMocks.getDeckDocument.mockImplementation(defaultDeckImplementation);
        orchestratorMocks.requestPythonRailsJson.mockReset();
        orchestratorMocks.requestPythonRailsJson.mockImplementation(defaultRailsImplementation);
        agentTerminalMocks.manager.submit.mockReset();
        agentTerminalMocks.manager.submit.mockImplementation(defaultSubmitImplementation);
      }
    });

    it('publishes a committed ThinkGraph revision to another conversation in the same Project', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint, init, options) => {
        if (endpoint === '/thinkgraph/completed-pair/prepare') return {
          ok: true,
          pairMemoryId: 'pair_cross_conversation',
          intakeOperation: 'pending',
          structuredExtractionRequired: true,
          revision: 4,
          revisionChanged: false,
          preparation: { status: 'pending_structured_extraction' },
          enrichmentSchema: { type: 'object' },
          enrichmentPrompt: 'Extract the exact completed pair.',
        };
        return railsImplementation(endpoint, init, options);
      });
      const streamController = new AbortController();
      const { server, baseUrl } = await createApiServer();
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        reader = await openSseReader(
          `${baseUrl}/main/session/thinkgraph-revisions?projectId=project-1&deckId=deck_builder&conversationId=main`,
          streamController.signal,
        );
        const revisionEvent = readSseJsonEvent(reader, 'thinkgraph_revision');
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1',
            conversationId: 'graph-join-proof',
            message: 'Create one real Project Think.',
          }),
        });
        expect(await response.text()).toContain('event: done');
        await expect(revisionEvent).resolves.toMatchObject({
          projectId: 'project-1',
          deckId: 'deck_builder',
          conversationId: 'graph-join-proof',
          stage: 'settled',
          revision: '5',
          changedNodeIds: ['think-rich-a'],
          changedEdgeIds: ['think-rich-edge'],
        });
      } finally {
        streamController.abort();
        await reader?.cancel().catch(() => undefined);
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        await closeServer(server);
      }
    });


    it('stops after a native Engraphis noop without running the saved ThinkGraph Card', async () => {
      orchestratorMocks.requestPythonRailsJson.mockClear();
      agentTerminalMocks.manager.submit.mockClear();
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'repeat-pair',
            message: 'This completed pair is already known to Engraphis.',
          }),
        });
        expect(await response.text()).toContain('event: done');
        await new Promise<void>((resolve) => setImmediate(resolve));
        await waitForCompletedPairThinkGraphLifecycles();
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.map(([route]) => route)).toEqual([
          '/domain/main/runs/begin',
          '/domain/runs/request-fulfillment',
          '/thinkgraph/completed-pair/prepare',
        ]);
        expect(agentTerminalMocks.manager.submit.mock.calls.map(
          ([owner]) => owner.cardId,
        )).toEqual(['card_main_chat']);
      } finally { await closeServer(server); }
    });


    it('drives the same Main Chat bridge from the authenticated external-plugin doorway', async () => {
      const priorSecret = process.env.LIQUIDAITY_INTERNAL_MCP_SECRET;
      process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = 'test-external-main-secret-0123456789abcdef';
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      let releaseScore: () => void = () => {};
      const scoreGate = new Promise<void>((resolve) => { releaseScore = resolve; });
      let scoreStarted = false;
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint, init, options) => {
        if (endpoint !== '/domain/runs/request-fulfillment') {
          return railsImplementation(endpoint, init, options);
        }
        scoreStarted = true;
        const scoreRequest = JSON.parse(String(init?.body || '{}'));
        await scoreGate;
        return {
          ok: true,
          runId: scoreRequest.runId,
          assessment: {
            schemaVersion: 'request-fulfillment-assessment.v1',
            metric: 'request_fulfillment',
            rubricVersion: 'request-fulfillment.v1',
            status: 'unavailable',
            runId: scoreRequest.runId,
            executionEvidenceComplete: scoreRequest.executionEvidenceComplete === true,
            executionEvidenceError: scoreRequest.executionEvidenceError || null,
            actualProvider: scoreRequest.actualProvider || null,
            actualModel: scoreRequest.actualModel || null,
            failureReason: 'test_delayed_grader_unavailable',
            requestCount: 0,
            questionCount: 0,
            timingMs: 0,
          },
        };
      });
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

        const responsePromise = fetch(`${baseUrl}/main/chat`, {
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
        let responseTimeout: ReturnType<typeof setTimeout> | undefined;
        const response = await Promise.race([
          responsePromise,
          new Promise<Response>((_resolve, reject) => {
            responseTimeout = setTimeout(
              () => reject(new Error('external_main_answer_blocked_by_grading')),
              1_000,
            );
          }),
        ]);
        if (responseTimeout) clearTimeout(responseTimeout);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          ok: true,
          cardId: 'card_main_chat',
          driverSource: 'external_plugin',
          contextAuthorityMode: 'plugin_context_only',
          finalText: 'Real assistant reply.',
          nativeSessionId: 'native:default',
          requestFulfillmentDeferred: true,
        });
        expect(scoreStarted).toBe(true);
        releaseScore();
        await waitForCompletedPairThinkGraphLifecycles();
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
          expect.objectContaining({
            cardId: 'card_main_chat', conversationId: 'external-mcp:grant-1',
          }),
          'terminal:card_main_chat',
          'hello from the connector',
          expect.any(Object),
        );
      } finally {
        releaseScore();
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
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

    it('uses one Main materialization and keeps telemetry out of the Main model input', async () => {
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
          { userId: 'owner-user', projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat', conversationId: 'main' },
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
        const mainBeginCalls = orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
          ([endpoint]) => endpoint === '/domain/main/runs/begin',
        );
        expect(mainBeginCalls).toHaveLength(1);
        expect(mainBeginCalls[0]?.[1]?.body).toContain('"message":"materialize exactly once"');
        expect(JSON.parse(String(mainBeginCalls[0]?.[1]?.body))).toMatchObject({
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
          completedTurnGeneration: 1, completedNativeRunId: null,
          event: { type: 'message.complete', session_id: sessionId,
            payload: {
              status: 'completed', text: 'Completed after disconnect.', usage: {},
              effectiveProvider: 'openai-codex', providerApiMode: null,
              actualProvider: 'openai-codex', actualModel: 'gpt-5.6-luna',
              exposedTools: [], executionEvidence: [],
              executionEvidenceComplete: true, executionEvidenceError: null,
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
          body: JSON.stringify({
            projectId: 'project-1', conversationId: 'stop-main', expectedRunId: activeRunId,
          }),
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

    it('stops the exact active Magnetic outer Run through native Magnetic control', async () => {
      const railsImplementation = orchestratorMocks.requestPythonRailsJson.getMockImplementation()!;
      const runId = 'req_magnetic_stop';
      orchestratorMocks.runRecords.set(runId, {
        runId,
        correlationId: runId,
        cardId: 'card_magentic',
        state: 'running',
        runtimeKind: 'hermes',
        runtimeMode: 'magentic_one',
        runtimeProfile: 'card_magentic',
        nativeRootId: 't_shared_magnetic_stop',
        nativeStatus: 'running',
        startedAt: new Date().toISOString(),
      });
      orchestratorMocks.requestPythonRailsJson.mockClear();
      agentTerminalMocks.manager.interrupt.mockClear();
      agentTerminalMocks.execution.requestCancellation.mockClear();
      orchestratorMocks.requestPythonRailsJson.mockImplementation(async (endpoint: string, init?: RequestInit) => {
        const request = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        if (endpoint === '/magentic/execution/status') {
          expect(request).toEqual({ nativeRootId: 't_shared_magnetic_stop' });
          return {
            ok: true, state: 'running', nativeStatus: 'running',
            nativeRootId: 't_shared_magnetic_stop', nativeIdentity: 'card_magentic',
          };
        }
        if (endpoint === '/magentic/execution/stop') {
          expect(request).toEqual({ nativeRootId: 't_shared_magnetic_stop' });
          return {
            ok: true, state: 'cancelled', nativeStatus: 'archived',
            nativeRootId: 't_shared_magnetic_stop', nativeIdentity: 'card_magentic',
            error: 'cancelled_by_user',
          };
        }
        return railsImplementation(endpoint, init);
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/main/session/stop`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1', deckId: 'deck_builder',
            conversationId: 'magnetic-stop',
            expectedRunId: runId, expectedCardId: 'card_magentic',
          }),
        });
        const payload = await response.json();

        expect(response.status, JSON.stringify(payload)).toBe(202);
        expect(payload).toEqual({ ok: true, runId, state: 'cancelled' });
        expect(orchestratorMocks.requestPythonRailsJson.mock.calls.filter(
          ([endpoint]) => endpoint === '/magentic/execution/stop',
        )).toHaveLength(1);
        const finished = orchestratorMocks.requestPythonRailsJson.mock.calls.find(
          ([endpoint]) => endpoint === '/domain/runs/finish',
        );
        expect(JSON.parse(String(finished?.[1]?.body))).toMatchObject({
          runId, state: 'cancelled', providerThreadRef: 't_shared_magnetic_stop',
          errorCode: 'magentic_execution_cancelled', errorSummary: 'cancelled_by_user',
        });
        expect(agentTerminalMocks.manager.interrupt).not.toHaveBeenCalled();
        expect(agentTerminalMocks.execution.requestCancellation).not.toHaveBeenCalled();
      } finally {
        orchestratorMocks.requestPythonRailsJson.mockImplementation(railsImplementation);
        orchestratorMocks.runRecords.delete(runId);
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
