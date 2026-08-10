// @graph entity: GrpcChatClient
// @graph role: persistent-session-bridge
//
// The smallest backend bridge from BuilderChat HTTP to the persistent OpenClaude
// gRPC QueryEngine (AgentService.Chat on :50051). The browser never speaks gRPC.
//
// One stable session id per (projectId, conversationId): the vendored gRPC server
// persists messages by session_id across streams, so each turn opens a fresh Chat
// stream with the same id and the QueryEngine keeps real cross-turn context.
//
// @grpc/grpc-js + the proto are loaded LAZILY (dynamic import) so the route
// module-load never pulls gRPC into the Nx serve startup graph — a load failure
// degrades to an honest error, never a backend crash. No fake model output.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { BUILDER_DECK_ID, getDeckDocument } from '../../../decks/store';
import { resolveRuntimeBinding } from '../../../contracts/runtimeBinding';
import { resolveCardModelStrict, resolveDirectSubagents } from '../../../cards/runtime';
import { listPythonAgentMcpTools } from '../../../services/mcp/pythonAgentMcpClient';
import { logHarnessTrace } from '../../../services/harnessTrace';

export type GrpcSessionEvent =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string; source: 'provider_exposed' }
  | {
      kind: 'tool_start';
      toolName: string;
      argsJson: string;
      toolUseId: string;
      /** Raw engine-supplied invoker agent_type ('' = parent session). */
      agentType: string;
      /** Durable caller identity resolved from real session config: the
       * doorway child's card id, the parent main_chat card id, or an explicit
       * 'unknown:<agentType>' — never inferred from timing or stream order. */
      invokingCardId: string;
    }
  | { kind: 'tool_result'; toolName: string; toolUseId: string; output: string; isError: boolean }
  | { kind: 'progress'; toolUseId: string; parentToolUseId: string; data: unknown }
  | { kind: 'permission'; promptId: string; question: string; promptType: string }
  | { kind: 'done'; fullText: string; usage: GrpcTurnUsage }
  | { kind: 'error'; message: string; code?: string };

/** Provider-reported usage + engine-truth context accounting for one turn.
 * Honest semantics: provider token fields are null when the provider did not
 * report usage (usageAvailable=false) — missing usage is NEVER a fake zero.
 * Estimates live separately in contextBreakdownJson. */
export type GrpcTurnUsage = {
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  totalCostUsd: number | null;
  usageAvailable: boolean;
  /** 'result_usage' | 'model_usage' | 'unavailable' — where the numbers came from. */
  usageSource: string;
  /** Compact JSON from the engine's analyzeContextUsage (per-component context
   * breakdown: system prompt sections, tool schemas, MCP tools, agents,
   * messages). ESTIMATES, kept separate from provider-reported usage. Empty
   * string when the engine could not produce it. */
  contextBreakdownJson: string;
};

/** Decode the generic gRPC progress envelope without interpreting child
 * content. The parent tool-use link and opaque data_json are preserved exactly
 * for the browser's structurally scoped Hermes reducer. */
export function decodeGrpcProgressEvent(progress: any): Extract<GrpcSessionEvent, { kind: 'progress' }> {
  let data: unknown = null;
  try {
    data = JSON.parse(String(progress?.data_json || 'null'));
  } catch {
    data = { type: 'invalid_progress_json', raw: String(progress?.data_json || '') };
  }
  return {
    kind: 'progress',
    toolUseId: String(progress?.tool_use_id || ''),
    parentToolUseId: String(progress?.parent_tool_use_id || ''),
    data,
  };
}

/** Accept only the native LocalCoder provider-exposed reasoning contract.
 * It remains a separate event and is never appended to assistant text. */
export function decodeGrpcReasoningEvent(
  reasoning: any,
): Extract<GrpcSessionEvent, { kind: 'reasoning' }> | null {
  if (
    reasoning?.source !== 'provider_exposed'
    || typeof reasoning?.text !== 'string'
    || reasoning.text.length === 0
  ) {
    return null;
  }
  return {
    kind: 'reasoning',
    text: reasoning.text,
    source: 'provider_exposed',
  };
}

export type GrpcTurnArgs = {
  sessionId: string;
  message: string;
  workingDirectory: string;
  model?: string;
  /** Which Harness surface this turn runs in. Chat mode exposes only the
   * structurally selected always-on card doorways; canvas mode exposes every
   * eligible saved card as a direct saved-card doorway. Explicit surface
   * state from the client — never inferred from message content. */
  mode?: HarnessMode;
  traceId?: string;
};

export type HarnessMode = 'chat' | 'canvas';

export type GrpcTurnHandle = {
  /** Answer an action_required permission prompt mid-turn. */
  answer(promptId: string, reply: string): void;
  cancel(): void;
  /** Resolves with the final text and real usage on `done`; rejects on `error`. */
  done: Promise<{ finalText: string; usage: GrpcTurnUsage }>;
  /** The saved main_chat card identity this turn actually ran with — real
   * event metadata for the frontdoor telemetry, never a re-resolution. */
  resolved: { cardId: string; provider: string; modelKey: string; providerModelId: string };
};

export function deriveSessionId(projectId: string, conversationId: string): string {
  return `mag1:${projectId}:${conversationId}`;
}

/**
 * Durable caller identity for a tool_start event. Pure so it is directly
 * unit-testable:
 *  - '' agent_type            → the parent session's saved main_chat card
 *  - a known doorway card id  → that child card (doorway defs bind
 *                               agent_type === card_id by construction)
 *  - anything else            → explicit 'unknown:<agentType>' — never
 *                               silently attributed to a card.
 */
function resolveInvokingCardId(
  agentType: string,
  doorwayCardIds: readonly string[],
  parentCardId: string,
): string {
  const normalized = String(agentType || '').trim();
  if (!normalized) return parentCardId;
  if (doorwayCardIds.includes(normalized)) return normalized;
  return `unknown:${normalized}`;
}

/** Inverse of deriveSessionId, owned by this same module. Used only to recover
 * the projectId needed for structural saved-card resolution below — never
 * exposed outside this file, never used for anything else. */
function parseSessionId(sessionId: string): { projectId: string; conversationId: string } | null {
  const parts = sessionId.split(':');
  if (parts.length < 3 || parts[0] !== 'mag1') return null;
  const projectId = parts[1];
  if (!projectId) return null;
  return { projectId, conversationId: parts.slice(2).join(':') };
}

const MAIN_MCP_SERVER_NAME = 'main';

/** Render one canonical dotted ID only at the OpenClaude protocol boundary. */
function renderMcpToolName(canonicalName: string): string {
  return `mcp__${MAIN_MCP_SERVER_NAME}__${canonicalName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

const CARD_RUN_CONTROL_TOOL = renderMcpToolName('card.run_assistant_agent');

/** The saved card's Tools selection, filtered to harness MCP tool names — the
 * REAL per-card MCP grant (enforced as the child's allowed_tools / the
 * parent's pool filter). No card selection → no MCP tools; never a hidden
 * default grant. */
function cardMcpToolGrants(card: any, availableToolNames: readonly string[]): string[] {
  const raw = Array.isArray(card?.runtimeOptions?.tools) ? card.runtimeOptions.tools : [];
  const known = new Set(availableToolNames);
  return raw
    .map((tool: unknown) => String(tool || '').trim())
    .filter(Boolean)
    .map((canonical: string) => {
      if (canonical.startsWith('mcp__')) {
        throw new Error(`harness_mcp_tool_must_be_canonical:${canonical}`);
      }
      const exact = known.has(canonical) ? canonical : null;
      if (!exact) {
        throw new Error(`harness_mcp_tool_unknown:${canonical}`);
      }
      return renderMcpToolName(exact);
    });
}

/** The truthful parent-facing capability line for a card doorway, keyed on the
 * saved binding (the same architectural signal runtime.ts uses for write
 * authority). This is what the main-chat model reads to decide when to delegate —
 * it must state the sub-agent's REAL capability so the model routes the work here
 * instead of substituting a conceptual answer. Not a prompt copy; one honest line. */
function doorwayWhenToUse(title: string): string {
  return `Delegate a bounded task to the saved "${title}" agent when its visible card role matches the work.`;
}

/** A thin native doorway definition bound to ONE saved card. Pure transport:
 * it carries no card prompt, no card tool grants, no model configuration and
 * no assignment context — Python resolves the saved card and pass-specific references when
 * runConfiguredCard executes it. The doorway only relays the task and returns
 * the structured result. */
export function buildHarnessAgentDefinition(
  card: any,
  opts?: {
    /** ORANGE-edge card-run authority for this child: the saved card ids it may
     * run through the card-run control tool (backend-resolved from persisted
     * direct edges — never model-chosen). */
    allowedCardRunIds?: string[];
    /** Live names fetched from the official Python MCP host. */
    availableMcpTools?: readonly string[];
  },
): Record<string, unknown> | null {
  const cardId = String(card?.id || '').trim();
  if (!cardId) return null;
  const title = String(card?.title || cardId).trim();
  const binding = resolveRuntimeBinding(card?.runtimeBinding);
  if (binding === 'hermes_steward' || binding === 'research_agent') {
    const systemPrompt = typeof card?.prompt === 'string' ? card.prompt : '';
    if (!systemPrompt.trim()) return null;
    const model = resolveCardModelStrict(card);
    const allowedCardRunIds = (opts?.allowedCardRunIds || []).map(String).filter(Boolean);
    if (!opts?.availableMcpTools) {
      throw new Error('harness_mcp_catalog_unavailable');
    }
    return {
      agent_type: cardId,
      card_id: cardId,
      runtime_binding: binding,
      when_to_use: doorwayWhenToUse(title),
      // Hermes and Search are native inherited-context agents. Their saved prompt
      // bytes and exact MCP grants execute directly in the Harness.
      system_prompt: systemPrompt,
      // The card's Tools selection IS the grant — no hidden defaults.
      allowed_tools: cardMcpToolGrants(card, opts.availableMcpTools),
      context_mode_inherit_parent: true,
      ...(allowedCardRunIds.length > 0 ? { allowed_card_run_ids: allowedCardRunIds } : {}),
      model: model.providerModelId,
      // Native inherited-context agent: it already IS its card. It may run
      // authorized child cards, never itself through the AutoGen runtime.
      self_card_run: false,
    };
  }
  return {
    agent_type: cardId,
    card_id: cardId,
    runtime_binding: binding || '',
    // The PARENT-facing capability description the main-chat model reads to decide
    // when to delegate to this sub-agent. Backend owns this (it already keys write
    // authority on the binding); the vendored server only relays it. Truthful, so
    // the model routes a real graph write here instead of inventing a conceptual
    // text-only graph or claiming "no write tool".
    when_to_use: doorwayWhenToUse(title),
    system_prompt: [
      `You are the Harness doorway for the saved agent card "${title}" (cardId ${cardId}).`,
      `Call the tool ${CARD_RUN_CONTROL_TOOL} exactly once with { "cardId": "${cardId}", "input": <the task you were given, as one bounded instruction> }.`,
      'The server supplies projectId, conversationId, and correlationId for the call — never invent or override them.',
      "Return the tool's JSON result verbatim as your final answer. Do not summarize it away, do not add fields, and do not claim work the result does not show.",
    ].join('\n'),
    allowed_tools: [CARD_RUN_CONTROL_TOOL],
    context_mode_inherit_parent: true,
    // Template doorway: its entire job IS running its bound card through the
    // AutoGen card runtime.
    self_card_run: true,
  };
}

/** The parent's native subagents for a Harness surface.
 * Direct invocation follows directed flow edges from Main, including Hermes.
 * This filter runs before agent definitions cross gRPC, so prompt text cannot
 * create authority that the saved deck lacks. Canvas mode keeps its direct
 * configure/test cards. */
export function selectDoorwayCards(nodes: any[], edges: any[], mode: HarnessMode): any[] {
  const allNodes = nodes || [];
  const allEdges = edges || [];
  const mainChat = allNodes.find(
    (node) =>
      resolveRuntimeBinding(node?.runtimeBinding) ===
      'main_chat',
  );
  const mainChatId = String(mainChat?.id || '').trim();

  if (mode === 'canvas') {
    return allNodes.filter((node) => {
      if (String(node?.kind || 'agent') !== 'agent') return false;
      if (String(node?.parentGraphId || '').trim()) return false;
      if (node?.enabled === false || node?.runtimeOptions?.enabled === false) return false;
      const runtimeType = String(node?.runtimeType ?? '').trim();
      if (runtimeType !== 'assistant_agent') return false;
      const binding = resolveRuntimeBinding(node?.runtimeBinding);
      return binding !== 'main_chat';
    });
  }
  if (!mainChat) return [];
  return resolveDirectSubagents(mainChatId, allNodes, allEdges);
}

export type MainChatRuntimeConfig = {
  cardId: string;
  runtimeBinding: 'main_chat';
  title: string;
  prompt: string | null;
  provider: string;
  modelKey: string;
  providerModelId: string;
  deckRevision: string | null;
  doorwayDefinitions: Record<string, unknown>[];
  /** The main_chat card's Tools selection — the parent session's real MCP
   * grant, enforced by the gRPC server's parent pool filter. */
  parentAllowedMcpTools: string[];
  /** The main_chat card's assigned NATIVE tools — filtered by the engine
   * BEFORE provider schema serialization. Transport-verbatim strings from the
   * saved card; empty = the card grants no native tools. */
  parentAllowedNativeTools: string[];
  /** Canonical public IDs used only to de-render protocol tool names before UI transport. */
  canonicalMcpTools: string[];
};

/** The saved card's assigned native tools (runtimeOptions.nativeTools).
 * Pure transport: verbatim strings, no name validation here — the engine owns
 * its native registry and reports grant names missing from the pool. */
function cardNativeToolGrants(card: any): string[] {
  const raw = Array.isArray(card?.runtimeOptions?.nativeTools) ? card.runtimeOptions.nativeTools : [];
  return raw.map((tool: unknown) => String(tool || '').trim()).filter(Boolean);
}

/**
 * Structural resolution from persisted deck nodes: exactly ONE card whose
 * runtimeBinding classifies as 'main_chat', by persisted binding — never
 * display-name matching.
 */
function resolveMainChatCardFromDeck(nodes: any[]): { ok: true; card: any } | { ok: false } {
  const matches = (nodes || []).filter(
    (n) => resolveRuntimeBinding(n?.runtimeBinding) === 'main_chat',
  );
  if (matches.length !== 1) return { ok: false };
  return { ok: true, card: matches[0] };
}

export async function resolveMainChatRuntimeConfig(
  sessionId: string,
  mode: HarnessMode,
  parentRunId?: string,
): Promise<MainChatRuntimeConfig | null> {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return null;
  const doc = await getDeckDocument(parsed.projectId, BUILDER_DECK_ID);
  const availableMcpTools = await listPythonAgentMcpTools();
  const nodes: any[] = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
  const resolution = resolveMainChatCardFromDeck(nodes);
  if (!resolution.ok) return null;
  const card = resolution.card;
  const modelKey = String(card?.runtimeOptions?.modelKey || '').trim();
  const resolved = resolveCardModelStrict(card);
  const edges: any[] = Array.isArray((doc?.deck as any)?.edges) ? (doc!.deck as any).edges : [];
  return {
    cardId: String(card?.id || ''),
    runtimeBinding: 'main_chat',
    title: String(card?.title || card?.id || ''),
    prompt: String(card?.prompt || '').trim() || null,
    provider: resolved.provider,
    modelKey,
    providerModelId: resolved.providerModelId,
    deckRevision: doc?.meta?.deckRevision || null,
    doorwayDefinitions: selectDoorwayCards(nodes, edges, mode)
      .map((node) => {
        return buildHarnessAgentDefinition(
          node,
          {
            allowedCardRunIds: resolveDirectSubagents(String(node.id), nodes, edges).map((child: any) =>
              String(child.id),
            ),
            availableMcpTools,
          },
        );
      })
      .filter((def): def is Record<string, unknown> => Boolean(def)),
    parentAllowedMcpTools: cardMcpToolGrants(card, availableMcpTools),
    parentAllowedNativeTools: cardNativeToolGrants(card),
    canonicalMcpTools: availableMcpTools,
  };
}

export function canonicalToolNameFromRuntime(
  runtimeName: string,
  canonicalNames: readonly string[],
): string {
  if (!runtimeName.startsWith(`mcp__${MAIN_MCP_SERVER_NAME}__`)) return runtimeName;
  return canonicalNames.find((name) => renderMcpToolName(name) === runtimeName) ?? runtimeName;
}

function resolveProtoPath(): string {
  const fromEnv = process.env.LIQUIDAITY_GRPC_PROTO;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    path.resolve(process.cwd(), 'localcoder/src/proto/openclaude.proto'),
    path.resolve(process.cwd(), '../../localcoder/src/proto/openclaude.proto'),
    path.resolve(__dirname, '../../../../../../localcoder/src/proto/openclaude.proto'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('grpc_proto_not_found: set LIQUIDAITY_GRPC_PROTO');
}

let clientPromise: Promise<any> | null = null;
async function getAgentServiceClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const grpc = await import('@grpc/grpc-js');
      const protoLoader = await import('@grpc/proto-loader');
      const def = protoLoader.loadSync(resolveProtoPath(), {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      const proto = (grpc.loadPackageDefinition(def) as any).openclaude.v1;
      const addr = process.env.LIQUIDAITY_GRPC_ADDR || 'localhost:50051';
      return new proto.AgentService(addr, grpc.credentials.createInsecure());
    })();
  }
  return clientPromise;
}

/**
 * Start one chat turn against the persistent gRPC QueryEngine session. Forwards
 * every native event (text / tool_start / tool_result / permission) to `onEvent`
 * verbatim — no transformation. Returns a handle to answer permission prompts and
 * a promise that resolves on `done`.
 */
export async function startGrpcTurn(
  args: GrpcTurnArgs,
  onEvent: (event: GrpcSessionEvent) => void,
): Promise<GrpcTurnHandle> {
  const client = await getAgentServiceClient();
  const call = client.Chat();
  let accumulated = '';
  let terminal = false;

  // Caller-identity resolution config. Assigned from the REAL resolved session
  // below, before call.write — no event can arrive earlier. The pre-assignment
  // fallback is explicit-unknown, never a silent card attribution.
  let callerDoorwayCardIds: string[] = [];
  let callerParentCardId = '';
  let canonicalMcpTools: string[] = [];
  const resolveCaller = (agentType: string): string =>
    callerParentCardId
      ? resolveInvokingCardId(agentType, callerDoorwayCardIds, callerParentCardId)
      : agentType
        ? `unknown:${agentType}`
        : 'unknown';

  const safeOnEvent = (event: GrpcSessionEvent): void => {
    try {
      onEvent(event);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logHarnessTrace(`[harness] event forward skipped reason=${reason}`);
    }
  };

  const done = new Promise<{ finalText: string; usage: GrpcTurnUsage }>((resolve, reject) => {
    call.on('data', (msg: any) => {
      if (terminal) return;
      if (msg.text_chunk) {
        accumulated += msg.text_chunk.text || '';
        safeOnEvent({ kind: 'text', text: msg.text_chunk.text || '' });
      } else if (msg.reasoning) {
        const reasoning = decodeGrpcReasoningEvent(msg.reasoning);
        if (reasoning) safeOnEvent(reasoning);
      } else if (msg.tool_start) {
        const agentType = String(msg.tool_start.agent_type || '');
        safeOnEvent({
          kind: 'tool_start',
          toolName: canonicalToolNameFromRuntime(msg.tool_start.tool_name, canonicalMcpTools),
          argsJson: msg.tool_start.arguments_json,
          toolUseId: msg.tool_start.tool_use_id,
          agentType,
          invokingCardId: resolveCaller(agentType),
        });
      } else if (msg.tool_result) {
        safeOnEvent({
          kind: 'tool_result',
          toolName: canonicalToolNameFromRuntime(msg.tool_result.tool_name, canonicalMcpTools),
          toolUseId: msg.tool_result.tool_use_id,
          output: msg.tool_result.output,
          isError: Boolean(msg.tool_result.is_error),
        });
      } else if (msg.progress) {
        safeOnEvent(decodeGrpcProgressEvent(msg.progress));
      } else if (msg.action_required) {
        safeOnEvent({
          kind: 'permission',
          promptId: msg.action_required.prompt_id,
          question: msg.action_required.question,
          promptType: String(msg.action_required.type),
        });
      } else if (msg.done) {
        terminal = true;
        const finalText = msg.done.full_text || accumulated;
        const usageAvailable = Boolean(msg.done.usage_available);
        const usage: GrpcTurnUsage = {
          providerInputTokens: usageAvailable ? Number(msg.done.prompt_tokens) || 0 : null,
          providerOutputTokens: usageAvailable ? Number(msg.done.completion_tokens) || 0 : null,
          totalCostUsd: Number(msg.done.total_cost_usd) > 0 ? Number(msg.done.total_cost_usd) : null,
          usageAvailable,
          usageSource: String(msg.done.usage_source || 'unavailable'),
          contextBreakdownJson: String(msg.done.context_breakdown_json || ''),
        };
        safeOnEvent({ kind: 'done', fullText: finalText, usage });
        resolve({ finalText, usage });
        try { call.end(); } catch { /* already closed */ }
      } else if (msg.error) {
        terminal = true;
        safeOnEvent({ kind: 'error', message: msg.error.message, code: msg.error.code });
        reject(new Error(msg.error.message || 'grpc_chat_error'));
        try { call.end(); } catch { /* already closed */ }
      }
    });
    call.on('error', (err: Error) => {
      if (terminal) {
        logHarnessTrace(`[harness] late grpc error ignored reason=${err.message}`);
        return;
      }
      terminal = true;
      safeOnEvent({ kind: 'error', message: err.message });
      reject(err);
    });
  });

  const mode = args.mode === 'canvas' ? 'canvas' : 'chat';
  const mainChatConfig = await resolveMainChatRuntimeConfig(
    args.sessionId,
    mode,
    args.traceId,
  );
  if (!mainChatConfig) {
    throw new Error('main_chat_runtime_config_unavailable: exactly one configured main_chat card with a valid saved model is required');
  }
  const doorwayDefinitions = mainChatConfig.doorwayDefinitions;
  callerDoorwayCardIds = doorwayDefinitions.map((def: any) => String(def?.card_id || '')).filter(Boolean);
  callerParentCardId = mainChatConfig.cardId;
  canonicalMcpTools = mainChatConfig.canonicalMcpTools;
  const appendSystemPrompt = mainChatConfig.prompt;
  const resolvedModel = mainChatConfig.providerModelId;
  if (args.traceId) {
    logHarnessTrace(
      [
        `[harness] main_chat resolved corr=${args.traceId}`,
        `cardId=${mainChatConfig?.cardId || 'none'}`,
        `provider=${mainChatConfig?.provider || 'none'}`,
        `model=${mainChatConfig?.modelKey || 'none'}`,
        `prompt=${mainChatConfig?.prompt ? 'present' : 'missing'}`,
        `doorways=${doorwayDefinitions.map((def: any) => def.card_id).join(',') || 'none'}`,
        `deckRevision=${mainChatConfig?.deckRevision || 'none'}`,
      ].join(' '),
    );
  }

  call.write({
    request: {
      message: args.message,
      working_directory: args.workingDirectory,
      session_id: args.sessionId,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(doorwayDefinitions.length > 0 ? { agent_definitions: doorwayDefinitions } : {}),
      // Appended AFTER the locked vendored base prompt (QueryEngine's
      // appendSystemPrompt), never replacing it — the saved card is the only
      // LiquidAIty-specific layer, added on top of the base, not instead of it.
      ...(appendSystemPrompt ? { append_system_prompt: appendSystemPrompt } : {}),
      // The parent card's Tools selection = the parent session's real MCP
      // grant (server-enforced pool filter; children keep their own grants).
      parent_allowed_mcp_tools: mainChatConfig.parentAllowedMcpTools,
      // The card's assigned native tools — the engine filters the parent's
      // native pool BEFORE schema serialization (children unaffected).
      parent_allowed_native_tools: mainChatConfig.parentAllowedNativeTools,
      ...(args.traceId ? { originating_run_id: args.traceId } : {}),
      parent_card_id: mainChatConfig.cardId,
      parent_runtime_binding: mainChatConfig.runtimeBinding,
      parent_deck_id: BUILDER_DECK_ID,
    },
  });

  return {
    answer: (promptId: string, reply: string) => {
      try { call.write({ input: { prompt_id: promptId, reply } }); } catch { /* closed */ }
    },
    cancel: () => {
      terminal = true;
      try { call.write({ cancel: { reason: 'client_cancel' } }); } catch { /* closed */ }
      try { call.end(); } catch { /* closed */ }
    },
    done,
    resolved: {
      cardId: mainChatConfig.cardId,
      provider: mainChatConfig.provider,
      modelKey: mainChatConfig.modelKey,
      providerModelId: mainChatConfig.providerModelId,
    },
  };
}
