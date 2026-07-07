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
import { getDeckDocument } from '../../../decks/store';
import { resolveRuntimeBinding } from '../../../contracts/runtimeBinding';
import { resolveModel } from '../../../llm/models.config';
import { logHarnessTrace } from '../../../services/harnessTrace';

// The app's one canonical Agent Canvas deck (mirrors coder.routes.ts's own
// BUILDER_DECK_ID — no cross-file re-export exists for this constant yet).
const BUILDER_DECK_ID = 'deck_builder';

export type GrpcSessionEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_start'; toolName: string; argsJson: string; toolUseId: string }
  | { kind: 'tool_result'; toolName: string; toolUseId: string; output: string; isError: boolean }
  | { kind: 'permission'; promptId: string; question: string; promptType: string }
  | { kind: 'done'; fullText: string }
  | { kind: 'error'; message: string; code?: string };

export type GrpcTurnArgs = {
  sessionId: string;
  message: string;
  workingDirectory: string;
  model?: string;
  /** Which Harness surface this turn runs in. Chat mode exposes only the
   * structurally selected always-on card doorways; canvas mode exposes every
   * eligible saved card as a direct Single Assist doorway. Explicit surface
   * state from the client — never inferred from message content. */
  mode?: HarnessMode;
  traceId?: string;
};

export type HarnessMode = 'chat' | 'canvas';

export type GrpcTurnHandle = {
  /** Answer an action_required permission prompt mid-turn. */
  answer(promptId: string, reply: string): void;
  cancel(): void;
  /** Resolves with the final text on `done`; rejects on `error`. */
  done: Promise<{ finalText: string }>;
};

export function deriveSessionId(projectId: string, conversationId: string): string {
  return `mag1:${projectId}:${conversationId}`;
}

/** Inverse of deriveSessionId, owned by this same module. Used only to recover
 * the projectId needed for structural ThinkGraph card resolution below — never
 * exposed outside this file, never used for anything else. */
function parseSessionId(sessionId: string): { projectId: string; conversationId: string } | null {
  const parts = sessionId.split(':');
  if (parts.length < 3 || parts[0] !== 'mag1') return null;
  const projectId = parts[1];
  if (!projectId) return null;
  return { projectId, conversationId: parts.slice(2).join(':') };
}

/** The one MCP control tool a card doorway child may call. Qualified per the
 * runtime's own MCP naming for the 'liquidaity' Python host (dots→underscores).
 * A fixed identity constant, not a mapping. */
const CARD_RUN_CONTROL_TOOL = 'mcp__liquidaity__card_run_assistant_agent';

/** The truthful parent-facing capability line for a card doorway, keyed on the
 * saved binding (the same architectural signal runtime.ts uses for write
 * authority). This is what the main-chat model reads to decide when to delegate —
 * it must state the sub-agent's REAL capability so the model routes the work here
 * instead of substituting a conceptual answer. Not a prompt copy; one honest line. */
export function doorwayWhenToUse(binding: string, title: string): string {
  if (binding === 'thinkgraph_agent') {
    return (
      'Delegate here to READ and WRITE the project\'s real ThinkGraph. This agent has ' +
      'the scoped graph-read plus a server-authorized graph-write internally (it creates/' +
      'updates actual ThinkGraph nodes and relationships) — you do not need a write tool ' +
      'yourself. Route EVERY request to build, update, record, or map anything into the ' +
      'ThinkGraph to this sub-agent; never answer such a request with a conceptual or ' +
      'text-only graph, and never claim no write tool exists.'
    );
  }
  if (binding === 'local_coder') {
    return (
      'Delegate here to run real coding work in the Coder workspace (create/edit files, ' +
      'run commands, produce real artifacts). Route implementation tasks to this sub-agent.'
    );
  }
  return `The saved agent card "${title}". Delegate the matching task to it and relay its result.`;
}

/** A thin native doorway definition bound to ONE saved card. Pure transport:
 * it carries no card prompt, no card tool grants, no model configuration and
 * no data bindings — Python resolves ALL of those from the saved card when
 * runConfiguredCard executes it. The doorway only relays the task and returns
 * the structured result. */
export function buildCardDoorwayDefinition(card: any): Record<string, unknown> | null {
  const cardId = String(card?.id || '').trim();
  if (!cardId) return null;
  const title = String(card?.title || cardId).trim();
  const binding = resolveRuntimeBinding(
    card?.runtimeOptions?.binding ?? card?.runtimeBinding ?? card?.binding,
    card?.id,
  );
  return {
    agent_type: cardId,
    card_id: cardId,
    runtime_binding: binding || '',
    // The PARENT-facing capability description the main-chat model reads to decide
    // when to delegate to this sub-agent. Backend owns this (it already keys write
    // authority on the binding); the vendored server only relays it. Truthful, so
    // the model routes a real graph write here instead of inventing a conceptual
    // text-only graph or claiming "no write tool".
    when_to_use: doorwayWhenToUse(binding || '', title),
    system_prompt: [
      `You are the Harness doorway for the saved agent card "${title}" (cardId ${cardId}).`,
      `Call the tool ${CARD_RUN_CONTROL_TOOL} exactly once with { "cardId": "${cardId}", "input": <the task you were given, as one bounded instruction> }.`,
      'The server supplies projectId, conversationId, and correlationId for the call — never invent or override them.',
      "Return the tool's JSON result verbatim as your final answer. Do not summarize it away, do not add fields, and do not claim work the result does not show.",
    ].join('\n'),
    allowed_tools: [CARD_RUN_CONTROL_TOOL],
    context_mode_inherit_parent: true,
  };
}

/** Doorway-eligible saved cards for a Harness surface. Structural filters only:
 * top-level enabled assistant/local-coder cards; the main_chat card is the
 * parent itself, never a runnable doorway. Chat mode exposes at most one
 * ThinkGraph card and at most one Local Coder card (ambiguity → omit that
 * doorway, honest degrade); canvas mode exposes every eligible card for direct
 * Single Assist configure/test work. */
export function selectDoorwayCards(nodes: any[], mode: HarnessMode): any[] {
  const eligible = (nodes || []).filter((node) => {
    if (String(node?.kind || 'agent') !== 'agent') return false;
    if (String(node?.parentGraphId || '').trim()) return false;
    if (node?.enabled === false || node?.runtimeOptions?.enabled === false) return false;
    const runtimeType = String(node?.runtimeType ?? 'assistant_agent');
    if (runtimeType !== 'assistant_agent' && runtimeType !== 'local_coder') return false;
    const binding = resolveRuntimeBinding(
      node?.runtimeOptions?.binding ?? node?.runtimeBinding ?? node?.binding,
      node?.id,
    );
    return binding !== 'main_chat';
  });
  if (mode === 'canvas') return eligible;
  const byBinding = (binding: string) =>
    eligible.filter(
      (node) =>
      resolveRuntimeBinding(node?.runtimeOptions?.binding ?? node?.runtimeBinding ?? node?.binding, node?.id) ===
      binding,
    );
  const thinkgraph = byBinding('thinkgraph_agent');
  const localCoder = byBinding('local_coder');
  return [
    ...(thinkgraph.length === 1 ? thinkgraph : []),
    ...(localCoder.length === 1 ? localCoder : []),
  ];
}

/** Resolve this turn's native doorway definitions from the persisted deck.
 * Best-effort: any resolution failure yields no definitions — it must never
 * block or alter the normal chat turn itself. */
export async function resolveCardDoorwayDefinitions(
  sessionId: string,
  mode: HarnessMode,
): Promise<Record<string, unknown>[]> {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return [];
  try {
    const doc = await getDeckDocument(parsed.projectId, BUILDER_DECK_ID);
    const nodes: any[] = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
    return selectDoorwayCards(nodes, mode)
      .map(buildCardDoorwayDefinition)
      .filter((def): def is Record<string, unknown> => Boolean(def));
  } catch {
    return [];
  }
}

export type MainChatRuntimeConfig = {
  cardId: string;
  title: string;
  prompt: string | null;
  provider: string;
  modelKey: string;
  providerModelId: string;
  deckRevision: string | null;
  doorwayDefinitions: Record<string, unknown>[];
};

/**
 * Structural resolution from persisted deck nodes: exactly ONE card whose
 * runtimeBinding classifies as 'main_chat', by persisted binding — never
 * display-name matching.
 */
function resolveMainChatCardFromDeck(nodes: any[]): { ok: true; card: any } | { ok: false } {
  const matches = (nodes || []).filter(
    (n) => resolveRuntimeBinding(n?.runtimeOptions?.binding ?? n?.runtimeBinding ?? n?.binding, n?.id) === 'main_chat',
  );
  if (matches.length !== 1) return { ok: false };
  return { ok: true, card: matches[0] };
}

/** The saved OpenClaude Chat parent card's visible prompt content, verbatim —
 * never graph data, conversation text, or backend-invented instructions. Sent
 * as append_system_prompt so it layers on top of the locked vendored base
 * prompt, never replacing it. Zero or multiple main_chat cards yields no
 * prompt to append (honest degrade to the vendored default alone) rather
 * than guessing which card is the parent. */
export async function resolveMainChatSystemPrompt(sessionId: string): Promise<string | null> {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return null;
  try {
    const doc = await getDeckDocument(parsed.projectId, BUILDER_DECK_ID);
    const nodes: any[] = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
    const resolution = resolveMainChatCardFromDeck(nodes);
    if (!resolution.ok) return null;
    const prompt = String(resolution.card?.prompt || '').trim();
    return prompt || null;
  } catch {
    return null;
  }
}

export async function resolveMainChatRuntimeConfig(
  sessionId: string,
  mode: HarnessMode,
): Promise<MainChatRuntimeConfig | null> {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return null;
  try {
    const doc = await getDeckDocument(parsed.projectId, BUILDER_DECK_ID);
    const nodes: any[] = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
    const resolution = resolveMainChatCardFromDeck(nodes);
    if (!resolution.ok) return null;
    const card = resolution.card;
    const modelKey = String(card?.runtimeOptions?.modelKey || '').trim();
    if (!modelKey) return null;
    const resolved = resolveModel(modelKey);
    const uiProvider = String(card?.runtimeOptions?.provider || '').trim().toLowerCase();
    if (uiProvider && uiProvider !== resolved.provider) return null;
    return {
      cardId: String(card?.id || ''),
      title: String(card?.title || card?.id || ''),
      prompt: String(card?.prompt || '').trim() || null,
      provider: resolved.provider,
      modelKey,
      providerModelId: resolved.id,
      deckRevision: doc?.meta?.deckRevision || null,
      doorwayDefinitions: selectDoorwayCards(nodes, mode)
        .map(buildCardDoorwayDefinition)
        .filter((def): def is Record<string, unknown> => Boolean(def)),
    };
  } catch {
    return null;
  }
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

  const done = new Promise<{ finalText: string }>((resolve, reject) => {
    call.on('data', (msg: any) => {
      if (msg.text_chunk) {
        accumulated += msg.text_chunk.text || '';
        onEvent({ kind: 'text', text: msg.text_chunk.text || '' });
      } else if (msg.tool_start) {
        onEvent({
          kind: 'tool_start',
          toolName: msg.tool_start.tool_name,
          argsJson: msg.tool_start.arguments_json,
          toolUseId: msg.tool_start.tool_use_id,
        });
      } else if (msg.tool_result) {
        onEvent({
          kind: 'tool_result',
          toolName: msg.tool_result.tool_name,
          toolUseId: msg.tool_result.tool_use_id,
          output: msg.tool_result.output,
          isError: Boolean(msg.tool_result.is_error),
        });
      } else if (msg.action_required) {
        onEvent({
          kind: 'permission',
          promptId: msg.action_required.prompt_id,
          question: msg.action_required.question,
          promptType: String(msg.action_required.type),
        });
      } else if (msg.done) {
        const finalText = msg.done.full_text || accumulated;
        onEvent({ kind: 'done', fullText: finalText });
        resolve({ finalText });
        try { call.end(); } catch { /* already closed */ }
      } else if (msg.error) {
        onEvent({ kind: 'error', message: msg.error.message, code: msg.error.code });
        reject(new Error(msg.error.message || 'grpc_chat_error'));
        try { call.end(); } catch { /* already closed */ }
      }
    });
    call.on('error', (err: Error) => {
      onEvent({ kind: 'error', message: err.message });
      reject(err);
    });
  });

  const mode = args.mode === 'canvas' ? 'canvas' : 'chat';
  const mainChatConfig = await resolveMainChatRuntimeConfig(args.sessionId, mode);
  const doorwayDefinitions = mainChatConfig?.doorwayDefinitions ?? [];
  const appendSystemPrompt = mainChatConfig?.prompt ?? null;
  const resolvedModel = mainChatConfig?.providerModelId || args.model || '';
  if (args.traceId) {
    logHarnessTrace(
      [
        `[harness] main_chat resolved corr=${args.traceId}`,
        `cardId=${mainChatConfig?.cardId || 'none'}`,
        `provider=${mainChatConfig?.provider || 'none'}`,
        `model=${mainChatConfig?.modelKey || 'none'}`,
        `prompt=${appendSystemPrompt ? 'present' : 'missing'}`,
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
    },
  });

  return {
    answer: (promptId: string, reply: string) => {
      try { call.write({ input: { prompt_id: promptId, reply } }); } catch { /* closed */ }
    },
    cancel: () => {
      try { call.write({ cancel: { reason: 'client_cancel' } }); } catch { /* closed */ }
      try { call.end(); } catch { /* closed */ }
    },
    done,
  };
}
