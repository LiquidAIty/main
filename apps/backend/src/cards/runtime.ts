import {
  CardRunResult,
  AgentAssignmentRunResult,
  PythonAutoGenPayloadShape,
} from '../contracts/runtimeContracts';
import {
  beginAgentAssignmentOnPython,
  finishAgentAssignmentOnPython,
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
  resolveDirectHermesSubagents,
  resolveHermesCardRuntimeConfig,
  startHermesTurn,
} from '../hermes/mainAdapter';
import {
  runHermesKanbanCardTask,
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
  id?: unknown;
  agentCompatibility?: unknown;
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
      .map((item: RuntimeToolManifestItem) => [String(item?.id || '').trim(), item] as const)
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
        const compatibility = Array.isArray(descriptor.agentCompatibility)
          ? descriptor.agentCompatibility.map((value) => String(value))
          : [];
        if (compatibility.length > 0 && !compatibility.includes('assistant_agent') && !compatibility.includes('magentic_one')) {
          throw new Error(`card_tool_runtime_incompatible: ${toolId}`);
        }
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
  const binding = resolveCardBinding(card);
  if (binding === 'main_chat') {
    return 'single_card_main_chat_not_runnable';
  }
  if (String(card?.parentGraphId || '').trim()) {
    return 'single_card_workspace_card_not_runnable';
  }
  return null;
}

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

export function buildPythonAutoGenCardRuntimePayload(
  card: any,
  runtimeInput: string,
  context: any,
  modelConfig: any,
  callableHeads: any[],
  startedAt: string,
): PythonAutoGenPayloadShape {
  const sessionId = `${context.deckId || 'deck'}:${card.id}:${Date.now()}`;
  const turnId = `${card.id}:${Date.now()}`;
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
    userText: runtimeInput,
    conversationId: String(context.conversationId || ''),
    // Stable assignment identities only; Python owns claim and hydration.
    agentAssignment: context.agentAssignment ?? undefined,
    cardRuntime: {
      cardId: String(card.id || ''),
      title: String(card.title || 'Magentic Agent'),
      runtimeType: 'magentic_one',
      prompt: systemPrompt,
      runtimeOptions: safeRuntimeOptions,
      participants,
    }
  };

  return payload;
}

// ── Single-card runtime (run one configured canvas card, outside a Mag One team run) ──────
// Server-trusted: the ONLY inputs are ids + bounded text. Card identity, prompt, model,
// runtime, and tools are resolved from the same canonical deck source and the same strict
// resolvers the Mag One path uses (resolveCardModelStrict /
// resolveAutoGenParticipantTools /
// serializeCardParticipant). No fallback model, no substitute card, no plain completion.

const SINGLE_CARD_RUN_ARG_KEYS = ['projectId', 'deckId', 'cardId', 'correlationId', 'input', 'conversationId', 'instructionId', 'senderCardId', 'parentRunId'] as const;

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
  /** Optional existing AgentGraph instruction identity for inter-agent work. */
  instructionId?: string;
  senderCardId?: string;
  parentRunId?: string;
};

export type ConfiguredCardRunResult = {
  status: 'submitted' | 'completed' | 'failed' | 'disabled' | 'not_found' | 'not_runnable';
  correlationId: string;
  cardId: string;
  runtimeType: string | null;
  tools: string[];
  output: string;
  error: string | null;
  startedAt: string;
  endedAt: string;
  /** Canonical AgentGraph assignment and result identities. */
  assignmentResult: AgentAssignmentRunResult | null;
  /** Exact native Hermes task/run envelope for an auto-Kanban submission. */
  hermesKanban: HermesKanbanCardTaskResult | null;
};

export async function runConfiguredCard(args: ConfiguredCardRunArgs): Promise<ConfiguredCardRunResult> {
  const startedAt = new Date().toISOString();
  // Real backend-terminal trace of the ACTUAL card/sub-agent run. Every terminal
  // outcome is logged, so watching the terminal answers "was this agent invoked,
  // and did it run or fail" — never inferred from model prose.
  logHarnessTrace(
    `[agent] card-run requested cardId=${String(args?.cardId || '?')} corr=${String(args?.correlationId || '?')} conversationId=${String(args?.conversationId || '').trim() ? 'present' : 'absent'}`,
  );
  // Captured for the dev telemetry event once resolution reaches them; a run
  // that fails before resolution honestly reports them as null.
  const done = (partial: Partial<ConfiguredCardRunResult> & Pick<ConfiguredCardRunResult, 'status'>): ConfiguredCardRunResult => {
    const result: ConfiguredCardRunResult = {
      correlationId: String(args?.correlationId || ''),
      cardId: String(args?.cardId || ''),
      runtimeType: null,
      tools: [],
      output: '',
      error: null,
      startedAt,
      endedAt: new Date().toISOString(),
      assignmentResult: null,
      hermesKanban: null,
      ...partial,
    };
    logHarnessTrace(
      `[agent] card ${result.cardId || '?'} ${result.status} corr=${result.correlationId}` +
        (result.tools.length ? ` tools=[${result.tools.join(',')}]` : '') +
        (result.error ? ` error=${redactTrace(result.error)}` : ''),
    );
    return result;
  };

  // Reject caller-supplied runtime overrides structurally: any extra key (model,
  // provider, prompt, tools, card definition, scope…) is an honest failure, never
  // silently ignored and never applied.
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
  const conversationId = String(args?.conversationId || '').trim();
  const instructionId = String(args?.instructionId || '').trim();
  const senderCardId = String(args?.senderCardId || '').trim();
  const parentRunId = String(args?.parentRunId || '').trim();
  if (!projectId || !deckId || !cardId || !correlationId || !input) {
    return done({ status: 'failed', error: 'card_run_args_incomplete' });
  }

  const doc = await getDeckDocument(projectId, deckId);
  const nodes: any[] = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
  const edges: any[] = Array.isArray((doc?.deck as any)?.edges) ? (doc!.deck as any).edges : [];
  const card = nodes.find((node) => String(node?.id || '') === cardId);
  if (!card) {
    return done({ status: 'not_found', error: `card_not_found: ${cardId}` });
  }
  if (card.enabled === false || card.runtimeOptions?.enabled === false) {
    return done({ status: 'disabled', error: `card_disabled: ${cardId}` });
  }
  const runtimeType = resolveCardRuntimeType(card);
  const ineligibility = genericAssistantCardIneligibility(card);
  if (ineligibility) {
    return done({
      status: 'not_runnable',
      runtimeType,
      error: `${ineligibility}: cardId=${cardId}`,
    });
  }
  if (String(card.kind || 'agent') !== 'agent' || !isPythonAutoGenCallableRuntimeType(runtimeType)) {
    return done({
      status: 'not_runnable',
      runtimeType,
      error: `single_card_runtime_not_supported: kind=${card.kind || 'agent'} runtimeType=${runtimeType}`,
    });
  }

  // Ordinary LiquidAIty cards execute through their card-id-owned Hermes
  // runtime. Local Coder is the one specialized exception: its AutoGen
  // AssistantAgent remains the controller for the real OpenClaude runtime.
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
    if (config.executionMode === 'auto-kanban') {
      try {
        const hermesKanban = await runHermesKanbanCardTask({
          projectId,
          deckId,
          correlationId,
          cardId,
          title: config.title,
          prompt: config.prompt,
          profile: config.profile,
          provider: providerForHermes(config.provider),
          providerModelId: config.providerModelId,
          skills: config.skills,
          input,
        });
        const nativeCompleted = hermesKanban.snapshot.task.status === 'done';
        return done({
          status: nativeCompleted ? 'completed' : 'submitted',
          runtimeType,
          tools: config.tools,
          output: String(hermesKanban.snapshot.task.result || ''),
          hermesKanban,
        });
      } catch (error: any) {
        return done({
          status: 'failed',
          runtimeType,
          tools: config.tools,
          error: String(error?.message || 'hermes_kanban_card_transport_failed'),
        });
      }
    }
    let begunAssignment: Awaited<ReturnType<typeof beginAgentAssignmentOnPython>>;
    try {
      begunAssignment = await beginAgentAssignmentOnPython({
        projectId,
        deckId,
        conversationId: conversationId || 'main',
        correlationId,
        senderCardId: senderCardId || cardId,
        receiverCardId: cardId,
        instruction: input,
        ...(instructionId ? { instructionId } : {}),
        ...(parentRunId ? { parentRunId } : {}),
        runtime: 'hermes',
        provider: config.provider,
        modelKey: config.modelKey,
        providerModelId: config.providerModelId,
      });
    } catch (error: any) {
      return done({
        status: 'failed',
        runtimeType,
        tools: config.tools,
        error: String(error?.message || 'agentgraph_assignment_begin_failed'),
      });
    }
    try {
      const sessionScope = conversationId || deckId;
      const handle = await startHermesTurn(
        {
          ...config,
          sessionKey: deriveHermesSessionKey(projectId, sessionScope, cardId),
          projectId,
          conversationId: sessionScope,
          parentRunId,
          message: input,
        },
        () => undefined,
      );
      const response = await handle.done;
      let finished: any;
      try {
        finished = await finishAgentAssignmentOnPython(begunAssignment.assignmentId, {
          projectId,
          claimToken: begunAssignment.claimToken,
          status: 'completed',
          output: response.finalText,
        });
      } catch {
        return done({
          status: 'failed',
          runtimeType,
          tools: config.tools,
          error: 'agentgraph_assignment_finish_failed',
          assignmentResult: {
            assignmentId: begunAssignment.assignmentId,
            instructionId: begunAssignment.instructionId,
          },
        });
      }
      return done({
        status: 'completed',
        runtimeType,
        tools: config.tools,
        output: response.finalText,
        assignmentResult: {
          assignmentId: begunAssignment.assignmentId,
          instructionId: begunAssignment.instructionId,
          ...(String(finished?.resultId || '').trim()
            ? { resultId: String(finished.resultId).trim() }
            : {}),
        },
      });
    } catch (error: any) {
      try {
        await finishAgentAssignmentOnPython(begunAssignment.assignmentId, {
          projectId,
          claimToken: begunAssignment.claimToken,
          status: 'failed',
          errorCode: 'hermes_card_transport_failed',
          errorDetail: 'Hermes card execution failed.',
        });
      } catch {
        // The returned failure remains honest without copying persistence or
        // provider detail into logs. The running assignment is inspectable.
      }
      return done({
        status: 'failed',
        runtimeType,
        tools: config.tools,
        error: String(error?.message || 'hermes_card_transport_failed'),
      });
    }
  }
  const effectiveCard = normalizeLocalCoderControllerCard(card);
  let participant: Record<string, unknown>;
  let model: { provider: string; providerModelId: string };
  try {
    // TypeScript resolves only saved card/model structure. Python's canonical
    // registry validates the transported tool ids before model execution.
    model = resolveCardModelStrict(effectiveCard);
    participant = serializeCardParticipant(effectiveCard);
  } catch (error: any) {
    return done({ status: 'failed', runtimeType, error: String(error?.message || 'card_resolution_failed') });
  }

  const resolvedBinding = resolveRuntimeBinding(effectiveCard?.runtimeBinding);
  const payload = {
    session: {
      sessionId: `${deckId}:${cardId}:${correlationId}`,
      projectId,
      turnId: correlationId,
      ...(parentRunId ? { runId: parentRunId } : {}),
      route: 'single_card',
      orchestrator: 'assistant_agent' as const,
      modelProvider: model.provider,
      modelKey: String(effectiveCard.runtimeOptions?.modelKey || ''),
      providerModelId: model.providerModelId,
      startedAt,
    },
    userText: input,
    conversationId,
    ...(instructionId
      ? {
          agentAssignment: {
            instructionId,
            senderCardId: senderCardId || cardId,
            receiverCardId: cardId,
          },
        }
      : {}),
    cardRuntime: {
      cardId,
      title: String(effectiveCard.title || 'Agent'),
      runtimeType: 'assistant_agent' as const,
      prompt: '',
      // deckId is a persisted structural reference only — the Python runtime uses it
      // to resolve the saved card and its assignment-specific context.
      runtimeOptions: { deckId },
      participants: [participant],
    },
  };

  // The decisive diagnostic line: the card IS being run in Python now — with which
  // resolved binding and exactly which tools it carries.
  logHarnessTrace(
    `[agent] card ${cardId} invoking-python binding=${resolvedBinding || 'none'} ` +
      `tools=[${(Array.isArray((participant as any).tools) ? (participant as any).tools : []).join(',') || 'none'}]`,
  );
  try {
    const response = await runSingleCardWithAutoGen(payload as any);
    const tools = Array.isArray((participant as any).tools) ? ((participant as any).tools as string[]) : [];
    if (!response.ok) {
      return done({
        status: 'failed',
        runtimeType,
        tools,
        error: String(response.error || 'single_card_run_failed'),
      });
    }
    const assignmentId = String((response as any).assignmentId || '').trim();
    return done({
      status: 'completed',
      runtimeType,
      tools,
      output: String(response.finalResponseText || ''),
      assignmentResult:
        assignmentId
          ? {
              assignmentId,
              ...(String((response as any).instructionId || '').trim()
                ? { instructionId: String((response as any).instructionId).trim() }
                : {}),
              ...(String((response as any).resultId || '').trim()
                ? { resultId: String((response as any).resultId).trim() }
                : {}),
            }
          : null,
    });
  } catch (error: any) {
    // Transport/rails failure is honest — no retry into a fallback path.
    return done({ status: 'failed', runtimeType, error: String(error?.message || 'single_card_transport_failed') });
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

    const payload = buildPythonAutoGenCardRuntimePayload(
      card,
      input,
      context,
      modelConfig,
      callableHeads,
      startedAt,
    );

    // Call the Python AutoGen rails. Mock success is not allowed on this route.
    let finalText = '';
    let agentAssignmentResult: AgentAssignmentRunResult | null = null;
    try {
        console.log('[runCardWithContract] executing Python AutoGen rails route.');
        const railsResponse = await orchestrateWithAutoGen(payload as any);

        // Transport only. Python rails owns the native AutoGen run. The backend
        // does not inspect or reconstruct Mag One's Task or Progress Ledgers.
        finalText = String(railsResponse.finalResponseText || '').trim();
        const assignmentId = String((railsResponse as any).assignmentId || '').trim();
        if (assignmentId) {
          agentAssignmentResult = {
            assignmentId,
            ...(String((railsResponse as any).instructionId || '').trim()
              ? { instructionId: String((railsResponse as any).instructionId).trim() }
              : {}),
            ...(String((railsResponse as any).resultId || '').trim()
              ? { resultId: String((railsResponse as any).resultId).trim() }
              : {}),
          };
        }
    } catch (e: any) {
        console.error('[runCardWithContract] Exact caught error message:', e?.message || e);
        throw e;
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
      agentAssignmentResult,
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
