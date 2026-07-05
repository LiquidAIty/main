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
import {
  resolveThinkGraphCardFromDeck,
  validateThinkGraphCardTools,
} from '../../../services/thinkgraph/processThinkGraphPair';
import { resolveRuntimeBinding } from '../../../contracts/runtimeBinding';

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
};

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

/** Structural saved-card configuration only (id, prompt, tool grants) — never
 * graph data, conversation text, or backend-invented semantics. Resolved the
 * same way processThinkGraphPair already resolves it: exactly one persisted
 * card with runtimeBinding=thinkgraph_agent and exactly the two scoped graph
 * tools. Best-effort: any resolution failure yields no agent definition for
 * this turn — it must never block or alter the normal chat turn itself. */
export async function resolveThinkGraphAgentDefinition(
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const parsed = parseSessionId(sessionId);
  if (!parsed) return null;
  try {
    const doc = await getDeckDocument(parsed.projectId, BUILDER_DECK_ID);
    const nodes: any[] = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
    const resolution = resolveThinkGraphCardFromDeck(nodes);
    if (!resolution.ok) return null;
    const card = resolution.card;
    if (validateThinkGraphCardTools(card)) return null;
    const allowedTools = Array.isArray(card?.runtimeOptions?.tools) ? card.runtimeOptions.tools.map(String) : [];
    const prompt = String(card?.prompt || '').trim();
    if (!prompt) return null;
    return {
      agent_type: String(card.id || ''),
      card_id: String(card.id || ''),
      runtime_binding: 'thinkgraph_agent',
      system_prompt: prompt,
      allowed_tools: allowedTools,
      context_mode_inherit_parent: true,
    };
  } catch {
    return null;
  }
}

/**
 * Structural resolution from persisted deck nodes: exactly ONE card whose
 * runtimeBinding classifies as 'main_chat' — the same structural pattern
 * resolveThinkGraphCardFromDeck already uses, never display-name matching.
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

  const [thinkGraphAgentDefinition, appendSystemPrompt] = await Promise.all([
    resolveThinkGraphAgentDefinition(args.sessionId),
    resolveMainChatSystemPrompt(args.sessionId),
  ]);

  call.write({
    request: {
      message: args.message,
      working_directory: args.workingDirectory,
      session_id: args.sessionId,
      ...(args.model ? { model: args.model } : {}),
      ...(thinkGraphAgentDefinition ? { agent_definitions: [thinkGraphAgentDefinition] } : {}),
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
