import {
  CardRunResult,
  NativeRunResult,
  PythonAutoGenPayloadShape,
} from '../contracts/runtimeContracts';
import {
  createInputDataFileOnPython,
  orchestrateWithAutoGen,
  requestPythonRailsJson,
  runSingleCardWithAutoGen,
} from '../services/autogen/autogenOrchestratorClient';
import { getDeckDocument } from '../decks/store';
import { resolveModel } from '../llm/models.config';
import { resolveRuntimeBinding } from '../contracts/runtimeBinding';
import { logHarnessTrace, redactTrace } from '../services/harnessTrace';
import {
  isLocalCoderControllerCard,
  normalizeLocalCoderControllerCard,
} from './localCoderController';
import {
  deriveHermesSessionKey,
  providerForHermes,
  resolveCardAccessMode,
  resolveDirectHermesSubagents,
  resolveHermesCardRuntimeConfig,
  startHermesTurn,
  type HermesTurnUsage,
} from '../hermes/mainAdapter';
import {
  runHermesKanbanCardTask,
  waitForHermesKanbanCardTask,
  type HermesKanbanCardTaskResult,
} from '../routes/hermesKanban.routes';

function normalizeProvider(value: unknown): 'openai' | 'openrouter' | null {
  const provider = String(value ?? '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'openrouter') return provider;
  return null;
}

function readOptionalNumber(
  value: unknown,
  field: string,
  options: { positive?: boolean } = {},
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || (options.positive === true && num <= 0)) {
    throw new Error(`card_${field}_invalid: ${String(value)}`);
  }
  return num;
}

function resolveOrchestratorCardModel(card: any): {
  provider: string;
  modelKey: string;
  providerModelId: string;
  temperature: number | null;
  maxTokens: number | null;
} {
  const modelKey = card.runtimeOptions?.modelKey;
  const resolved = resolveCardModelStrict(card);
  return {
    provider: resolved.provider,
    modelKey,
    providerModelId: resolved.providerModelId,
    temperature: readOptionalNumber(card.runtimeOptions?.temperature, 'temperature'),
    maxTokens: readOptionalNumber(card.runtimeOptions?.maxTokens, 'max_tokens', { positive: true }),
  };
}

// The two independent canvas networks (persisted explicit type + handle — never
// inferred from color):
//   'flow'             ORANGE  direct relationship: source parent may invoke the
//                              target card as its own native subagent. Never
//                              affects the Mag One roster.
//   'magentic_option'  BLUE    side worker slot: Mag One may select the card as
//                              a worker. Never grants direct invocation.
//   'magentic_control' BLUE    top control input: the source may submit the
//                              finalized prompt to Mag One. Never a worker.
const MAG_ONE_CONTROL_HANDLE = 'task-bus-top';

//   'invalid'          an unrecognised/malformed type. Grants nothing. It is a
//                      classification, not a default: only an explicit 'flow'
//                      may authorise invocation.
function normalizeEdgeType(value: unknown): string {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'magentic_option') return 'magentic_option';
  if (type === 'magentic_control') return 'magentic_control';
  if (type === 'flow') return 'flow';
  return 'invalid';
}

/** The bus-side handle of an edge touching the Mag One card, whichever end it is. */
function busSideHandle(edge: any, magenticCardId: string): string {
  return String(
    (edge?.source === magenticCardId ? edge?.sourceHandle : edge?.targetHandle) || '',
  ).trim();
}

/** True when this edge is a CONTROL connection to the Mag One bus: the explicit
 * control type, or any bus edge landing on the dedicated top control handle
 * (defense for un-migrated data). Control never grants worker membership. */
function isMagenticControlEdge(edge: any, magenticCardId: string): boolean {
  const type = normalizeEdgeType(edge?.edgeType);
  if (type === 'magentic_control') return true;
  return type === 'magentic_option' && busSideHandle(edge, magenticCardId) === MAG_ONE_CONTROL_HANDLE;
}

/** Resolve the enabled top-level cards structurally authorized to submit to
 * this Mag One card. Control edges never make these cards workers. */
export function resolvedMagenticControllers(
  magenticCardId: string,
  visibleNodes: any[],
  visibleEdges: any[],
): any[] {
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  return visibleEdges
    .filter(
      (edge) =>
        (edge.source === magenticCardId || edge.target === magenticCardId) &&
        isMagenticControlEdge(edge, magenticCardId) &&
        edge.source !== edge.target,
    )
    .map((edge) => nodeMap.get(edge.source === magenticCardId ? edge.target : edge.source))
    .filter((node): node is any => Boolean(node && node.kind === 'agent'))
    .filter((node) => node?.enabled !== false && node?.runtimeOptions?.enabled !== false)
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

function resolveCardRuntimeType(card: any): string {
  if (card.kind !== 'agent') return '';
  return String(normalizeLocalCoderControllerCard(card).runtimeType || '').trim();
}

function resolveCardBinding(card: any): string | null {
  const binding = resolveRuntimeBinding(card?.runtimeBinding);
  return binding || null;
}

function isAssistLikeRuntimeType(runtimeType: string): boolean {
  return runtimeType === 'assistant_agent';
}

// Removed: resolveMagOneAgentRole (title/template substring classifier),
// routingAgent, buildMagOneRoutingDiagnostics, roleCapabilities,
// buildMagOneRoutingManifest. TypeScript does not infer agent identity, rank
// workers, or invent capabilities/gates. Bus connectivity (resolvedMagenticOptions
// = magentic_option edges) is the ONLY activation signal.

export function resolvedMagenticOptions(
  magenticCardId: string,
  visibleNodes: any[],
  visibleEdges: any[]
): any[] {
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  return visibleEdges
    .filter(
      (edge) =>
        (edge.source === magenticCardId || edge.target === magenticCardId) &&
        normalizeEdgeType(edge.edgeType) === 'magentic_option' &&
        !isMagenticControlEdge(edge, magenticCardId) &&
        edge.source !== edge.target,
    )
    .map((edge) => nodeMap.get(edge.source === magenticCardId ? edge.target : edge.source))
    .filter((node): node is any => Boolean(node && node.kind === 'agent'))
    .filter((node) => node?.enabled !== false && node?.runtimeOptions?.enabled !== false)
    .filter((node) => {
      // Principal roles are structurally never workers, even against stale edges.
      const binding = resolveCardBinding(node);
      if (binding === 'main_chat' || binding === 'hermes_steward') return false;
      const runtimeType = resolveCardRuntimeType(node);
      return isAssistLikeRuntimeType(runtimeType);
    })
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

export type MagenticWorkerReadiness = {
  card: any;
  connected: true;
  executionReady: boolean;
  readinessState: 'ready' | 'staged_runtime_missing' | 'configuration_invalid' | 'dependency_unavailable';
  readinessReason: string | null;
};

type RuntimeToolManifestItem = {
  name?: unknown;
};

/** Resolve execution readiness from saved card structure plus the one live Python
 * AutoGen tool registry. Blue-edge discovery remains topology-only; this check
 * decides which discovered cards may enter a model run. */
export async function resolveMagenticWorkerReadiness(
  connectedCards: any[],
): Promise<MagenticWorkerReadiness[]> {
  let manifestById: Map<string, RuntimeToolManifestItem>;
  try {
    const response = await requestPythonRailsJson('/tools/manifest', { method: 'GET' }) as any;
    const manifest = Array.isArray(response?.tools) ? response.tools : null;
    if (!manifest) throw new Error('autogen_tool_manifest_invalid');
    const entries: Array<readonly [string, RuntimeToolManifestItem]> = manifest
      .map((item: RuntimeToolManifestItem) => [String(item?.name || '').trim(), item] as const)
      .filter((entry: readonly [string, RuntimeToolManifestItem]) => Boolean(entry[0]));
    manifestById = new Map(entries);
  } catch (error: any) {
    const reason = String(error?.message || 'autogen_tool_manifest_unavailable');
    return connectedCards.map((card) => ({
      card,
      connected: true,
      executionReady: false,
      readinessState: 'dependency_unavailable',
      readinessReason: reason,
    }));
  }

  return connectedCards.map((card) => {
    const runtimeType = resolveCardRuntimeType(card);
    if (!isPythonAutoGenCallableRuntimeType(runtimeType)) {
      return {
        card,
        connected: true,
        executionReady: false,
        readinessState: 'staged_runtime_missing',
        readinessReason: `magentic_runtime_not_supported: ${runtimeType}`,
      };
    }

    try {
      resolveCardModelStrict(card);
      const selectedTools = resolveAutoGenParticipantTools(card);
      for (const toolId of selectedTools) {
        const descriptor = manifestById.get(toolId);
        if (!descriptor) throw new Error(`card_tool_unknown: ${toolId}`);
      }
      return {
        card,
        connected: true,
        executionReady: true,
        readinessState: 'ready',
        readinessReason: null,
      };
    } catch (error: any) {
      return {
        card,
        connected: true,
        executionReady: false,
        readinessState: 'configuration_invalid',
        readinessReason: String(error?.message || 'magentic_worker_configuration_invalid'),
      };
    }
  });
}

/** ORANGE network resolution: the enabled cards this parent may invoke as its
 * own native subagents — exactly the persisted directional 'flow' edges from
 * the parent. Parent-specific by construction; never consults the bus. */
export function resolveDirectSubagents(
  parentCardId: string,
  visibleNodes: any[],
  visibleEdges: any[],
): any[] {
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  return visibleEdges
    .filter(
      (edge) =>
        edge.source === parentCardId &&
        edge.target !== parentCardId &&
        normalizeEdgeType(edge.edgeType) === 'flow',
    )
    .map((edge) => nodeMap.get(edge.target))
    .filter((node): node is any => Boolean(node && node.kind === 'agent'))
    .filter((node) => !String(node.parentGraphId || '').trim())
    .filter((node) => node?.enabled !== false && node?.runtimeOptions?.enabled !== false)
    .filter((node) => isAssistLikeRuntimeType(resolveCardRuntimeType(node)))
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

function isPythonAutoGenCallableRuntimeType(runtimeType: string): boolean {
  return runtimeType === 'assistant_agent';
}

function genericAssistantCardIneligibility(card: any): string | null {
  if (String(card?.parentGraphId || '').trim()) {
    return 'single_card_workspace_card_not_runnable';
  }
  return null;
}

const UNAVAILABLE_RUN_USAGE: HermesTurnUsage = {
  providerInputTokens: null,
  providerOutputTokens: null,
  totalCostUsd: null,
  usageAvailable: false,
  usageSource: 'unavailable',
  contextBreakdownJson: '',
};

/** Resolve the saved card model exactly once for every card-owned execution path. */
export function resolveCardModelStrict(card: any): {
  provider: string;
  providerModelId: string;
} {
  const modelKey = card.runtimeOptions?.modelKey;
  if (!modelKey) {
    throw new Error(
      `card_model_config_missing: cardId=${card.id} runtimeType=${card.runtimeType}`,
    );
  }
  const resolved = resolveModel(modelKey);
  const uiProvider = normalizeProvider(card.runtimeOptions?.provider);
  if (uiProvider && uiProvider !== resolved.provider) {
    throw new Error(
      `card_model_config_mismatch: cardId=${card.id} uiProvider=${uiProvider} registryProvider=${resolved.provider}`,
    );
  }
  return { provider: resolved.provider, providerModelId: resolved.id };
}

/** Transport the saved card's selected Python tool ids without maintaining a
 * second TypeScript registry. Python resolves and validates every id before
 * model execution. */
export function resolveCardTools(card: any): string[] {
  const fromOptions = card.runtimeOptions?.tools;
  if (fromOptions !== undefined && !Array.isArray(fromOptions)) {
    throw new Error(`card_tools_config_invalid: cardId=${card.id}`);
  }
  const raw = Array.isArray(fromOptions) ? fromOptions : Array.isArray(card.tools) ? card.tools : [];
  const selected = new Set<string>();
  return raw.map((tool: unknown, index: number) => {
    if (typeof tool !== 'string') {
      throw new Error(`card_tool_name_invalid: cardId=${card.id} index=${index}`);
    }
    const name = tool.trim();
    if (!name) {
      throw new Error(`card_tool_name_empty: cardId=${card.id}`);
    }
    if (selected.has(name)) {
      throw new Error(`card_tool_name_duplicate: cardId=${card.id} tool=${name}`);
    }
    selected.add(name);
    return name;
  });
}

/**
 * The saved Coder card describes capabilities available inside OpenClaude.
 * Its outer AutoGen AssistantAgent is only the controller and therefore gets
 * the one execution doorway that starts the canonical Local Coder engine.
 */
export function resolveAutoGenParticipantTools(card: any): string[] {
  const selectedTools = resolveCardTools(card);
  if (!isLocalCoderControllerCard(card)) return selectedTools;
  if (!selectedTools.includes('run_local_coder')) {
    throw new Error(`local_coder_controller_tool_missing: cardId=${card.id}`);
  }
  return ['run_local_coder'];
}

/**
 * THE one card→participant serialization, shared by the Mag One team payload and the
 * single-card runtime. Saved prompt/model resolution is unchanged; the historical
 * Local Coder controller boundary exposes only run_local_coder to AutoGen. This is
 * the one source of truth for how a canvas card becomes a Python participant.
 */
export function serializeCardParticipant(head: any): Record<string, unknown> {
  head = normalizeLocalCoderControllerCard(head);
  const model = resolveCardModelStrict(head);
  const accessMode = resolveCardAccessMode(head, model.provider);
  const runtimeBinding = resolveCardBinding(head);
  const runtimeType = resolveCardRuntimeType(head);
  const selectedTools = resolveAutoGenParticipantTools(head);
  const innerMcpTools = isLocalCoderControllerCard(head)
    ? resolveCardTools(head).filter((tool) => tool !== 'run_local_coder')
    : [];
  return {
    cardId: String(head.id || ''),
    title: String(head.title || 'Agent'),
    runtimeType,
    runtimeBinding,
    executionMode:
      head.runtimeOptions?.executionMode === 'auto-kanban' ? 'auto-kanban' : 'single',
    prompt: String(head.prompt || ''),
    tools: selectedTools,
    provider: model.provider,
    accessMode,
    providerModelId: model.providerModelId,
    reasoningEffort: cleanReasoningEffort(head.runtimeOptions?.reasoningEffort),
    ...(innerMcpTools.length > 0 ? { innerMcpTools } : {}),
    temperature: readOptionalNumber(head.runtimeOptions?.temperature, 'temperature'),
    maxTokens: readOptionalNumber(head.runtimeOptions?.maxTokens, 'max_tokens', { positive: true }),
  };
}

function cleanReasoningEffort(value: unknown): 'low' | 'medium' | 'high' | 'xhigh' | null {
  if (value == null || value === '') return null;
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value;
  }
  throw new Error(`card_reasoning_effort_invalid: ${String(value)}`);
}

export function buildPythonAutoGenCardRuntimeContext(
  card: any,
  context: any,
  modelConfig: any,
  callableHeads: any[],
): PythonAutoGenPayloadShape['cardRuntime'] & Record<string, unknown> {
  // Native team selection from the deck/card config: every eligible bus-connected
  // agent that the Python rails can run. No project-specific participant filtering —
  // Mag One sees the team exactly as configured on the Magentic bus.
  const supportedHeads = callableHeads
    .filter((head) => isPythonAutoGenCallableRuntimeType(resolveCardRuntimeType(head)));
  // System prompt = the card's own explicit prompt only. No backend-authored global
  // persona and no runtime graph-grounding prose is injected into native reasoning.
  const systemPrompt = String(card.prompt || '').trim();

  const participants = supportedHeads.map((head) =>
    serializeCardParticipant(head),
  );

  const safeRuntimeOptions: Record<string, unknown> = {
    deckId: String(context.deckId || ''),
  };
  const reasoningEffort = cleanReasoningEffort(card.runtimeOptions?.reasoningEffort);
  if (reasoningEffort) safeRuntimeOptions.reasoningEffort = reasoningEffort;
  for (const key of ['temperature', 'maxTokens', 'maxTurns'] as const) {
    const value = readOptionalNumber(card.runtimeOptions?.[key], key, {
      positive: key !== 'temperature',
    });
    if (value !== null) safeRuntimeOptions[key] = value;
  }

  return {
    cardId: String(card.id || ''),
    title: String(card.title || 'Magentic Agent'),
    runtimeType: 'magentic_one',
    prompt: systemPrompt,
    provider: modelConfig.provider,
    modelKey: modelConfig.modelKey,
    providerModelId: modelConfig.providerModelId,
    runtimeOptions: safeRuntimeOptions,
    participants,
  };
}

export function buildPythonAutoGenCardRuntimePayload(
  card: any,
  context: any,
  modelConfig: any,
  callableHeads: any[],
  startedAt: string,
  persistedCardRuntime?: PythonAutoGenPayloadShape['cardRuntime'],
): PythonAutoGenPayloadShape {
  const sessionId = `${context.deckId || 'deck'}:${card.id}:${Date.now()}`;
  const turnId = `${card.id}:${Date.now()}`;
  const cardRuntime = persistedCardRuntime ?? buildPythonAutoGenCardRuntimeContext(
    card,
    context,
    modelConfig,
    callableHeads,
  );

  // The mission input passes through normally. Native Mag One owns interpretation.
  const payload: PythonAutoGenPayloadShape = {
    session: {
      sessionId,
      projectId: String(context.projectId || ''),
      turnId,
      // Preserve the backend run identity when the caller supplies one.
      ...(context.runId ? { runId: String(context.runId) } : {}),
      route: 'deck_runtime',
      orchestrator: 'magentic_one',
      modelProvider: modelConfig.provider,
      modelKey: modelConfig.modelKey,
      providerModelId: modelConfig.providerModelId,
      startedAt,
    },
    idf: context.idf,
    cardRuntime,
  };

  return payload;
}

// ── Single-card runtime (run one configured canvas card, outside a Mag One team run) ──────
// Server-trusted: the ONLY inputs are ids + bounded text. Card identity, prompt, model,
// runtime, and tools are resolved from the same canonical deck source and the same strict
// resolvers the Mag One path uses (resolveCardModelStrict /
// resolveAutoGenParticipantTools /
// serializeCardParticipant). No fallback model, no substitute card, no plain completion.

const SINGLE_CARD_RUN_ARG_KEYS = ['projectId', 'deckId', 'cardId', 'correlationId', 'input', 'conversationId', 'parentRunId'] as const;

export type ConfiguredCardRunArgs = {
  projectId: string;
  deckId: string;
  cardId: string;
  correlationId: string;
  input: string;
  /** The real conversation this run belongs to, when one exists (a live chat
   * doorway invocation has one). Used ONLY for card-specific authority
   * minting below — never fabricated. */
  conversationId?: string;
  parentRunId?: string;
};

export type ConfiguredCardRunResult = {
  status: 'submitted' | 'completed' | 'failed' | 'disabled' | 'not_found' | 'not_runnable';
  correlationId: string;
  cardId: string;
  runtimeType: string | null;
  runtime: 'hermes' | 'hermes_kanban' | 'local_coder' | null;
  provider: string | null;
  modelKey: string | null;
  providerModelId: string | null;
  accessMode: string | null;
  idfVersion: number | null;
  idfContentSha256: string | null;
  transport: {
    threadId: string | null;
    turnId: string | null;
    authMode: string | null;
    planType: string | null;
  } | null;
  tools: string[];
  output: string;
  error: string | null;
  startedAt: string;
  endedAt: string;
  /** Canonical IDF and real native/backend run identity. */
  nativeRunResult: NativeRunResult | null;
  /** Exact native Hermes task/run envelope for an auto-Kanban submission. */
  hermesKanban: HermesKanbanCardTaskResult | null;
  usage: HermesTurnUsage;
};

export async function runConfiguredCard(args: ConfiguredCardRunArgs): Promise<ConfiguredCardRunResult> {
  const startedAt = new Date().toISOString();
  logHarnessTrace(
    `[agent] card-run requested cardId=${String(args?.cardId || '?')} corr=${String(args?.correlationId || '?')} conversationId=${String(args?.conversationId || '').trim() ? 'present' : 'absent'}`,
  );
  const done = (
    partial: Partial<ConfiguredCardRunResult> & Pick<ConfiguredCardRunResult, 'status'>,
  ): ConfiguredCardRunResult => {
    const result: ConfiguredCardRunResult = {
      correlationId: String(args?.correlationId || ''),
      cardId: String(args?.cardId || ''),
      runtimeType: null,
      runtime: null,
      provider: null,
      modelKey: null,
      providerModelId: null,
      accessMode: null,
      idfVersion: null,
      idfContentSha256: null,
      transport: null,
      tools: [],
      output: '',
      error: null,
      startedAt,
      endedAt: new Date().toISOString(),
      nativeRunResult: null,
      hermesKanban: null,
      usage: UNAVAILABLE_RUN_USAGE,
      ...partial,
    };
    logHarnessTrace(
      `[agent] card ${result.cardId || '?'} ${result.status} corr=${result.correlationId}` +
        (result.tools.length ? ` tools=[${result.tools.join(',')}]` : '') +
        (result.error ? ` error=${redactTrace(result.error)}` : ''),
    );
    return result;
  };

  const extraKeys = Object.keys(args || {}).filter(
    (key) => !(SINGLE_CARD_RUN_ARG_KEYS as readonly string[]).includes(key),
  );
  if (extraKeys.length > 0) {
    return done({ status: 'failed', error: `card_run_overrides_rejected: ${extraKeys.join(',')}` });
  }

  const projectId = String(args?.projectId || '').trim();
  const deckId = String(args?.deckId || '').trim();
  const cardId = String(args?.cardId || '').trim();
  const correlationId = String(args?.correlationId || '').trim();
  const input = String(args?.input || '').trim();
  const conversationId = String(args?.conversationId || '').trim() || 'main';
  const parentRunId = String(args?.parentRunId || '').trim();
  if (!projectId || !deckId || !cardId || !correlationId || !input) {
    return done({ status: 'failed', error: 'card_run_args_incomplete' });
  }

  const doc = await getDeckDocument(projectId, deckId);
  const nodes: any[] = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
  const edges: any[] = Array.isArray((doc?.deck as any)?.edges) ? (doc!.deck as any).edges : [];
  const card = nodes.find((node) => String(node?.id || '') === cardId);
  if (!card) return done({ status: 'not_found', error: `card_not_found: ${cardId}` });
  if (card.enabled === false || card.runtimeOptions?.enabled === false) {
    return done({ status: 'disabled', error: `card_disabled: ${cardId}` });
  }

  const runtimeType = resolveCardRuntimeType(card);
  const ineligibility = genericAssistantCardIneligibility(card);
  if (ineligibility) {
    return done({ status: 'not_runnable', runtimeType, error: `${ineligibility}: cardId=${cardId}` });
  }
  if (String(card.kind || 'agent') !== 'agent' || !isPythonAutoGenCallableRuntimeType(runtimeType)) {
    return done({
      status: 'not_runnable',
      runtimeType,
      error: `single_card_runtime_not_supported: kind=${card.kind || 'agent'} runtimeType=${runtimeType}`,
    });
  }

  if (!isLocalCoderControllerCard(card)) {
    let config;
    try {
      config = resolveHermesCardRuntimeConfig(
        card,
        resolveDirectHermesSubagents(cardId, nodes, edges),
      );
    } catch (error: any) {
      return done({
        status: 'failed',
        runtimeType,
        error: String(error?.message || 'hermes_card_resolution_failed'),
      });
    }

    let idf;
    try {
      idf = (await createInputDataFileOnPython({
        projectId,
        deckId,
        conversationId,
        runId: correlationId,
        originatingCardId: cardId,
        systemText: config.prompt,
        userText: input,
        cardContext: {
          ...config,
          runtimeType,
        },
      })).idf;
    } catch {
      return done({
        status: 'failed',
        runtimeType,
        tools: config.tools,
        error: 'idf_persistence_failed',
      });
    }

    const idfConfig = idf.cardContext as typeof config;
    const runtimeIdentity = {
      provider: idfConfig.provider,
      modelKey: idfConfig.modelKey,
      providerModelId: idfConfig.providerModelId,
      accessMode: idfConfig.accessMode,
      idfVersion: idf.version,
      idfContentSha256: idf.contentSha256,
    };
    if (idfConfig.executionMode === 'auto-kanban') {
      try {
        let hermesKanban = await runHermesKanbanCardTask({
          projectId,
          deckId,
          correlationId,
          cardId,
          title: idfConfig.title,
          prompt: idf.systemText,
          profile: idfConfig.profile,
          provider: providerForHermes(idfConfig.provider, idfConfig.accessMode),
          providerModelId: idfConfig.providerModelId,
          skills: idfConfig.skills,
          input: idf.modelInputMarkdown,
        });
        if (parentRunId && hermesKanban.snapshot.task.status !== 'done') {
          hermesKanban = await waitForHermesKanbanCardTask(idfConfig.profile, hermesKanban.taskId);
        }
        const nativeCompleted = hermesKanban.snapshot.task.status === 'done';
        return done({
          status: nativeCompleted ? 'completed' : 'submitted',
          runtimeType,
          runtime: 'hermes_kanban',
          ...runtimeIdentity,
          tools: idfConfig.tools,
          output: String(hermesKanban.snapshot.task.result || ''),
          hermesKanban,
          nativeRunResult: { runId: hermesKanban.taskId, idfId: idf.idfId },
        });
      } catch {
        return done({
          status: 'failed',
          runtimeType,
          runtime: 'hermes_kanban',
          ...runtimeIdentity,
          tools: idfConfig.tools,
          error: 'hermes_kanban_card_transport_failed',
          nativeRunResult: { runId: correlationId, idfId: idf.idfId },
        });
      }
    }

    try {
      const sessionScope = conversationId || deckId;
      const handle = await startHermesTurn(
        {
          ...idfConfig,
          prompt: idf.systemText,
          sessionKey: deriveHermesSessionKey(projectId, sessionScope, cardId),
          projectId,
          conversationId: sessionScope,
          parentRunId,
          message: idf.modelInputMarkdown,
        },
        () => undefined,
      );
      const response = await handle.done;
      return done({
        status: 'completed',
        runtimeType,
        runtime: 'hermes',
        ...runtimeIdentity,
        tools: idfConfig.tools,
        output: response.finalText,
        nativeRunResult: { runId: correlationId, idfId: idf.idfId },
        usage: response.usage || UNAVAILABLE_RUN_USAGE,
        transport: response.transport,
      });
    } catch (error: any) {
      return done({
        status: 'failed',
        runtimeType,
        runtime: 'hermes',
        ...runtimeIdentity,
        tools: idfConfig.tools,
        error: String(error?.message || 'hermes_card_transport_failed'),
        nativeRunResult: { runId: correlationId, idfId: idf.idfId },
      });
    }
  }

  const effectiveCard = normalizeLocalCoderControllerCard(card);
  let participant: Record<string, unknown>;
  let model: { provider: string; providerModelId: string };
  try {
    model = resolveCardModelStrict(effectiveCard);
    participant = serializeCardParticipant(effectiveCard);
  } catch (error: any) {
    return done({
      status: 'failed',
      runtimeType,
      error: String(error?.message || 'card_resolution_failed'),
    });
  }

  const resolvedBinding = resolveRuntimeBinding(effectiveCard?.runtimeBinding);
  const cardRuntime = {
    cardId,
    title: String(effectiveCard.title || 'Agent'),
    runtimeType: 'assistant_agent' as const,
    runtimeBinding: resolvedBinding,
    prompt: String((participant as any).prompt || ''),
    provider: model.provider,
    accessMode: resolveCardAccessMode(effectiveCard, model.provider),
    modelKey: String(effectiveCard.runtimeOptions?.modelKey || ''),
    providerModelId: model.providerModelId,
    runtimeOptions: { deckId },
    participants: [participant],
  };
  let idf;
  try {
    idf = (await createInputDataFileOnPython({
      projectId,
      deckId,
      conversationId,
      runId: correlationId,
      originatingCardId: cardId,
      systemText: cardRuntime.prompt,
      userText: input,
      cardContext: cardRuntime,
    })).idf;
  } catch {
    return done({ status: 'failed', runtimeType, error: 'idf_persistence_failed' });
  }

  const payload = {
    session: {
      sessionId: `${deckId}:${cardId}:${correlationId}`,
      projectId,
      turnId: correlationId,
      runId: correlationId,
      ...(parentRunId ? { parentRunId } : {}),
      route: 'single_card',
      orchestrator: 'assistant_agent' as const,
      modelProvider: model.provider,
      modelKey: String(effectiveCard.runtimeOptions?.modelKey || ''),
      providerModelId: model.providerModelId,
      startedAt,
    },
    idf,
    cardRuntime: idf.cardContext,
  };

  logHarnessTrace(
    `[agent] card ${cardId} invoking-python binding=${resolvedBinding || 'none'} ` +
      `tools=[${(Array.isArray((participant as any).tools) ? (participant as any).tools : []).join(',') || 'none'}]`,
  );
  try {
    const response = await runSingleCardWithAutoGen(payload as any);
    const tools = Array.isArray((participant as any).tools)
      ? ((participant as any).tools as string[])
      : [];
    if (!response.ok) {
      return done({
        status: 'failed',
        runtimeType,
        runtime: 'local_coder',
        provider: model.provider,
        modelKey: String(effectiveCard.runtimeOptions?.modelKey || ''),
        providerModelId: model.providerModelId,
        accessMode: cardRuntime.accessMode,
        idfVersion: idf.version,
        idfContentSha256: idf.contentSha256,
        tools,
        error: String(response.error || 'single_card_run_failed'),
        nativeRunResult: { runId: response.runId || correlationId, idfId: idf.idfId },
      });
    }
    if (response.idfId !== idf.idfId) {
      return done({
        status: 'failed',
        runtimeType,
        runtime: 'local_coder',
        provider: model.provider,
        modelKey: String(effectiveCard.runtimeOptions?.modelKey || ''),
        providerModelId: model.providerModelId,
        tools,
        error: 'runtime_idf_identity_mismatch',
        nativeRunResult: { runId: response.runId || correlationId, idfId: idf.idfId },
      });
    }
    return done({
      status: 'completed',
      runtimeType,
      runtime: 'local_coder',
      provider: model.provider,
      modelKey: String(effectiveCard.runtimeOptions?.modelKey || ''),
      providerModelId: model.providerModelId,
      accessMode: cardRuntime.accessMode,
      idfVersion: idf.version,
      idfContentSha256: idf.contentSha256,
      tools,
      output: String(response.finalResponseText || ''),
      nativeRunResult: {
        runId: response.runId || correlationId,
        idfId: response.idfId,
        ...(String(response.resultId || '').trim() ? { resultId: String(response.resultId).trim() } : {}),
      },
    });
  } catch (error: any) {
    return done({
      status: 'failed',
      runtimeType,
      runtime: 'local_coder',
      provider: model.provider,
      modelKey: String(effectiveCard.runtimeOptions?.modelKey || ''),
      providerModelId: model.providerModelId,
      error: String(error?.message || 'single_card_transport_failed'),
      nativeRunResult: { runId: correlationId, idfId: idf.idfId },
    });
  }
}

export async function runCardWithContract(
  card: any,
  input: string,
  context: any
): Promise<CardRunResult> {
  const startedAt = new Date().toISOString();
  
  if (resolveCardRuntimeType(card) === 'magentic_one') {
    const connectedHeads = resolvedMagenticOptions(card.id, context.allCards || [], context.allEdges || []);
    const readiness = await resolveMagenticWorkerReadiness(connectedHeads);
    const unavailable = readiness.filter((item) => !item.executionReady);
    if (unavailable.length > 0) {
      throw new Error(
        `magentic_connected_worker_unavailable: ${unavailable
          .map((item) => `${String(item.card?.id || 'unknown')}=${item.readinessReason || item.readinessState}`)
          .join(',')}`,
      );
    }
    const callableHeads = readiness.map((item) => item.card);

    // Bus eligibility is the only requirement: native Mag One needs at least one
    // connected worker on the magentic_option bus. No approval gate, no
    // participant-gate — that poison was removed.
    if (callableHeads.length === 0) {
      throw new Error('magentic_runtime_no_current_bus_connected_participants');
    }
    
    const modelConfig = resolveOrchestratorCardModel(card);
    const resolvedCardRuntime = buildPythonAutoGenCardRuntimeContext(
      card,
      context,
      modelConfig,
      callableHeads,
    );

    const idf = context.idf ?? (await createInputDataFileOnPython({
      projectId: String(context.projectId || ''),
      deckId: String(context.deckId || ''),
      conversationId: String(context.conversationId || '').trim() || 'main',
      runId: String(context.runId || '').trim(),
      originatingCardId: String(card.id || ''),
      systemText: String(card.prompt || ''),
      userText: input,
      cardContext: resolvedCardRuntime,
    })).idf;
    if (!idf.cardContext || idf.cardContext.cardId !== String(card.id || '')) {
      throw new Error('runtime_idf_card_context_mismatch');
    }
    const payload = buildPythonAutoGenCardRuntimePayload(
      card,
      { ...context, idf },
      modelConfig,
      callableHeads,
      startedAt,
      idf.cardContext as PythonAutoGenPayloadShape['cardRuntime'],
    );

    // Call the Python AutoGen rails. Mock success is not allowed on this route.
    let finalText = '';
    let nativeRunResult: NativeRunResult | null = null;
    try {
        console.log('[runCardWithContract] executing Python AutoGen rails route.');
        const railsResponse = await orchestrateWithAutoGen(payload as any);

        // Transport only. Python rails owns the native AutoGen run. The backend
        // does not inspect or reconstruct Mag One's Task or Progress Ledgers.
        finalText = String(railsResponse.finalResponseText || '').trim();
        const nativeRunId = String((railsResponse as any).runId || '').trim();
        const consumedIdfId = String((railsResponse as any).idfId || '').trim();
        if (nativeRunId && consumedIdfId) {
          if (consumedIdfId !== idf.idfId) throw new Error('runtime_idf_identity_mismatch');
          nativeRunResult = {
            runId: nativeRunId,
            idfId: consumedIdfId,
            ...(String((railsResponse as any).resultId || '').trim()
              ? { resultId: String((railsResponse as any).resultId).trim() }
              : {}),
          };
        }
    } catch (e: any) {
        const safeMessage = redactTrace(String(e?.message || e || 'autogen_orchestrator_failed'));
        console.error('[runCardWithContract] Python rails execution failed:', safeMessage);
        throw new Error(safeMessage || 'autogen_orchestrator_failed');
    }

    if (!finalText) {
      throw new Error('autogen_orchestrator_missing_final_response');
    }

    return {
      output: finalText,
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      runtimeType: 'magentic_one',
      nativeRunResult,
    };
  }
  
  return {
    output: "unsupported",
    status: 'error',
    startedAt,
    endedAt: new Date().toISOString(),
    error: "team_runtime_not_supported"
  };
}
