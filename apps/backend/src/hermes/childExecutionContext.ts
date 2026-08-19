import { randomUUID } from 'node:crypto';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';

const EXECUTION_CONTEXT_TTL_MS = 30 * 60 * 1000;
const EXECUTION_META_KEY = 'liquidaity/execution';

export type HermesExecutionContext = {
  contextId: string;
  sessionId: string;
  runId: string;
  rootRunId: string;
  parentRunId: string | null;
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  runtimeMode: 'main' | 'delegate' | 'kanban';
  nativeChildId: string | null;
  grantedTools: string[];
  expiresAt: number;
  state: 'active' | 'closing' | 'closed';
};

const contexts = new Map<string, HermesExecutionContext>();

function uniqueStrings(values: string[]): string[] {
  return values
    .map((value) => String(value || '').trim())
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
}

function activeContext(contextId: string, now = Date.now()): HermesExecutionContext {
  const context = contexts.get(String(contextId || '').trim());
  if (!context) throw new Error('hermes_execution_context_unknown');
  if (context.state !== 'active') throw new Error('hermes_execution_context_closed');
  if (context.expiresAt <= now) {
    context.state = 'closed';
    throw new Error('hermes_execution_context_expired');
  }
  return context;
}

export function executionToolCallMeta(contextId: string): Record<string, string> {
  return { [EXECUTION_META_KEY]: contextId };
}

export function registerHermesRootExecutionContext(args: {
  sessionId: string;
  runId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  runtimeMode: 'main' | 'delegate';
  grantedTools: string[];
  now?: number;
}): HermesExecutionContext {
  const required = [
    args.sessionId, args.runId, args.projectId, args.deckId,
    args.conversationId, args.cardId,
  ].map((value) => String(value || '').trim());
  if (required.some((value) => !value)) throw new Error('hermes_root_execution_context_incomplete');
  const context: HermesExecutionContext = {
    contextId: randomUUID(),
    sessionId: required[0],
    runId: required[1],
    rootRunId: required[1],
    parentRunId: null,
    projectId: required[2],
    deckId: required[3],
    conversationId: required[4],
    cardId: required[5],
    runtimeMode: args.runtimeMode,
    nativeChildId: null,
    grantedTools: uniqueStrings(args.grantedTools),
    expiresAt: (args.now ?? Date.now()) + EXECUTION_CONTEXT_TTL_MS,
    state: 'active',
  };
  contexts.set(context.contextId, context);
  return { ...context, grantedTools: [...context.grantedTools] };
}

export function bindHermesRootExecutionSession(contextId: string, sessionId: string): void {
  const context = activeContext(contextId);
  if (context.parentRunId !== null) throw new Error('hermes_execution_context_not_root');
  const resolved = String(sessionId || '').trim();
  if (!resolved) throw new Error('hermes_execution_session_required');
  context.sessionId = resolved;
}

export async function createHermesChildExecutionContext(args: {
  sessionId: string;
  parentExecutionContextId: string;
  nativeChildId: string;
  request?: typeof requestPythonRailsJson;
}): Promise<HermesExecutionContext> {
  const parent = activeContext(args.parentExecutionContextId);
  const sessionId = String(args.sessionId || '').trim();
  const nativeChildId = String(args.nativeChildId || '').trim();
  if (!sessionId || sessionId !== parent.sessionId) throw new Error('hermes_child_session_mismatch');
  if (!nativeChildId) throw new Error('hermes_native_child_id_required');
  const runId = `hermes_child_${randomUUID()}`;
  const correlationId = `hermes_child_corr_${randomUUID()}`;
  const context: HermesExecutionContext = {
    ...parent,
    contextId: randomUUID(),
    runId,
    rootRunId: parent.rootRunId,
    parentRunId: parent.runId,
    cardId: parent.cardId,
    runtimeMode: parent.runtimeMode,
    nativeChildId,
    expiresAt: Date.now() + EXECUTION_CONTEXT_TTL_MS,
    state: 'active',
    grantedTools: [...parent.grantedTools],
  };
  const request = args.request ?? requestPythonRailsJson;
  await request('/domain/runs/begin-native-hermes-child', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      correlationId,
      rootRunId: context.rootRunId,
      parentRunId: context.parentRunId,
      projectId: context.projectId,
      deckId: context.deckId,
      conversationId: context.conversationId,
      cardId: context.cardId,
      nativeChildId,
    }),
  });
  contexts.set(context.contextId, context);
  return { ...context, grantedTools: [...context.grantedTools] };
}

export function resolveHermesExecutionContext(args: {
  contextId: string;
  principal: Record<string, unknown>;
  now?: number;
}): HermesExecutionContext {
  const context = activeContext(args.contextId, args.now);
  const principal = args.principal || {};
  const principalTools = uniqueStrings(Array.isArray(principal.grantedTools)
    ? principal.grantedTools.map(String)
    : []);
  const matches = (
    principal.kind === 'card-runtime'
    && principal.requiresExecutionContext === true
    && String(principal.projectId || '') === context.projectId
    && String(principal.deckId || '') === context.deckId
    && String(principal.conversationId || '') === context.conversationId
    && String(principal.parentRunId || '') === context.rootRunId
    && String(principal.callerCardId || '') === context.cardId
    && String(principal.callerRuntimeKind || '') === 'hermes'
    && String(principal.callerRuntimeMode || '') === context.runtimeMode
    && JSON.stringify(principalTools) === JSON.stringify(context.grantedTools)
  );
  if (!matches) throw new Error('hermes_execution_context_principal_mismatch');
  return { ...context, grantedTools: [...context.grantedTools] };
}

export async function finishHermesExecutionContext(args: {
  contextId: string;
  state: 'completed' | 'failed' | 'cancelled';
  errorSummary?: string;
  usage?: {
    durationMs?: number;
    providerInputTokens?: number;
    providerOutputTokens?: number;
    totalCostUsd?: number;
  };
  request?: typeof requestPythonRailsJson;
}): Promise<boolean> {
  const context = contexts.get(String(args.contextId || '').trim());
  if (!context || context.state !== 'active') return false;
  context.state = 'closing';
  try {
    if (context.parentRunId) {
      const request = args.request ?? requestPythonRailsJson;
      await request('/domain/runs/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: context.runId,
          state: args.state,
          errorCode: args.state === 'failed' ? 'hermes_native_child_failed' : undefined,
          errorSummary: args.errorSummary,
          durationMs: args.usage?.durationMs,
          providerInputTokens: args.usage?.providerInputTokens,
          providerOutputTokens: args.usage?.providerOutputTokens,
          totalCostUsd: args.usage?.totalCostUsd,
        }),
      });
    }
    return true;
  } finally {
    context.state = 'closed';
  }
}

export function clearHermesExecutionContextsForTest(): void {
  contexts.clear();
}
