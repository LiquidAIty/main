import { createHash } from 'node:crypto';
import type { HermesRuntimeClient } from './hermesProcess';

const SESSION_TITLE_PREFIX = 'Bot Chat:';
const PRIOR_SESSION_LIMIT = 8;
const PRIOR_SESSION_TTL_SECONDS = 10 * 60;

export type HermesSessionScope = {
  userId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId?: string;
};

export type HermesSessionBinding = {
  sessionId: string;
  storedSessionId: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rows(value: unknown): Array<Record<string, unknown>> {
  const sessions = object(value).sessions;
  if (!Array.isArray(sessions)) throw new Error('hermes_session_enumeration_invalid');
  return sessions.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('hermes_session_enumeration_invalid');
    }
    return entry as Record<string, unknown>;
  });
}

function storedId(row: Record<string, unknown>): string {
  return String(row.resolved_id || row.id || '').trim();
}

function binding(value: unknown, fallbackStoredId = ''): HermesSessionBinding {
  const result = object(value);
  const sessionId = String(result.session_id || '').trim();
  const storedSessionId = String(result.stored_session_id || fallbackStoredId).trim();
  if (!sessionId || !storedSessionId) throw new Error('hermes_session_result_invalid');
  return { sessionId, storedSessionId };
}

export function hermesSessionTitle(scope: HermesSessionScope): string {
  const values = [
    scope.userId,
    scope.projectId,
    scope.deckId,
    scope.cardId,
    scope.conversationId || 'card',
  ]
    .map((value) => String(value || '').trim());
  if (values.some((value) => !value)) throw new Error('hermes_session_scope_incomplete');
  const digest = createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex');
  return `${SESSION_TITLE_PREFIX}${digest}`;
}

export async function resolveHermesSession(
  client: HermesRuntimeClient,
  scope: HermesSessionScope,
  configuration: {
    profile: string;
    cwd: string;
    cols: number;
    model: string;
    provider: string;
    reasoningEffort?: string;
  },
): Promise<HermesSessionBinding> {
  const title = hermesSessionTitle(scope);
  const listParams = {
    profile: configuration.profile,
    title,
    include_hidden: true,
    limit: 200,
  };
  const exact = rows(await client.request('session.list', listParams));
  if (exact.length > 1) throw new Error('hermes_session_binding_ambiguous');
  let session: HermesSessionBinding;
  if (exact.length === 1) {
    const stored = storedId(exact[0]);
    if (!stored) throw new Error('hermes_session_enumeration_invalid');
    session = binding(await client.request('session.resume', {
      session_id: stored,
      profile: configuration.profile,
    }), stored);
  } else {
    session = binding(await client.request('session.create', {
      profile: configuration.profile,
      title,
      cwd: configuration.cwd,
      cols: configuration.cols,
      model: configuration.model,
      provider: configuration.provider,
      follow_profile_config: true,
      close_on_disconnect: false,
      hidden: true,
      ...(configuration.reasoningEffort
        ? { reasoning_effort: configuration.reasoningEffort }
        : {}),
    }));
    const titled = object(await client.request('session.title', {
      session_id: session.sessionId,
      profile: configuration.profile,
      title,
    }));
    if (titled.title !== title) throw new Error('hermes_session_binding_title_failed');
  }
  const readback = rows(await client.request('session.list', listParams));
  if (readback.length !== 1 || storedId(readback[0]) !== session.storedSessionId) {
    throw new Error('hermes_session_binding_readback_invalid');
  }
  return session;
}

export function recordHermesStoredSession(
  state: { storedSessionId: string },
  prior: Map<string, number>,
  storedSessionId: string,
  now = Math.floor(Date.now() / 1000),
): void {
  const stored = storedSessionId.trim();
  if (!stored || stored === state.storedSessionId) return;
  for (const [id, expiry] of prior) if (expiry < now) prior.delete(id);
  prior.delete(stored);
  prior.set(state.storedSessionId, now + PRIOR_SESSION_TTL_SECONDS);
  while (prior.size > PRIOR_SESSION_LIMIT) {
    const oldest = prior.keys().next().value as string | undefined;
    if (!oldest) break;
    prior.delete(oldest);
  }
  state.storedSessionId = stored;
}

export async function readHermesSessionHistory(
  client: HermesRuntimeClient,
  bindingValue: { hermesSessionId: string; profile: string },
): Promise<{ count: number; messages: Array<Record<string, unknown>> }> {
  const history = await client.request<{ count?: unknown; messages?: unknown }>(
    'session.history',
    { session_id: bindingValue.hermesSessionId, profile: bindingValue.profile },
  );
  if (!Number.isSafeInteger(history?.count) || !Array.isArray(history?.messages)) {
    throw new Error('hermes_session_history_invalid');
  }
  return {
    count: Number(history.count),
    messages: history.messages as Array<Record<string, unknown>>,
  };
}
