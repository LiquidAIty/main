/**
 * Frontend client for Main's headless Hermes Bot Mode conversation. The
 * browser consumes backend SSE while the saved Main Card and Hermes Gateway
 * remain the session, model-turn, tool, and completion owners.
 *
 * `streamSession` forwards backend-projected native events to `onEvent` and
 * resolves with the native completion text. Stable event IDs are delivered
 * once per connection; semantic classification remains server-owned.
 */
import type {
  MainProjectionEvent,
  RuntimeEvent,
} from '../../../../../apps/backend/src/contracts/runtimeEvents';

export type NativeSessionEvent = {
  terminalEvent?: RuntimeEvent;
  projection?: MainProjectionEvent;
  kind: 'session' | 'text' | 'reasoning' | 'tool_start' | 'tool_result' | 'permission' | 'done' | 'error' | 'end' | string;
  [key: string]: unknown;
};

export type MainGatewayEvent = {
  type: string;
  session_id?: string;
  seq?: number;
  payload?: Record<string, unknown>;
};

export type SharedChatParticipant = {
  kind: 'user' | 'card';
  label: string;
  cardId?: string;
  profile?: string;
  address?: string;
};

export type AddressableAgent = {
  cardId: string;
  cardRevisionId: string;
  profile: string;
  title: string;
  address: string;
  aliases: string[];
};

export type SharedChatMessage = {
  role: 'assistant' | 'user';
  text: string;
  speaker: SharedChatParticipant;
  target?: SharedChatParticipant;
};

export type MainRunImage = {
  name: string;
  mediaType: string;
  dataUrl: string;
  kind: 'user-upload';
};

const BASE = '/api/main/session';

export function selectedConversationId(search: string): string {
  const selected = new URLSearchParams(search).get('conversationId')?.trim();
  return selected || 'main';
}

type SessionStreamFailure = {
  code: string;
  message: string;
  correlationId?: string;
  route?: string;
  status?: number;
};

export class SessionStreamError extends Error {
  readonly code: string;
  readonly correlationId?: string;
  readonly route?: string;
  readonly status?: number;

  constructor(failure: SessionStreamFailure) {
    super(failure.message);
    this.name = 'SessionStreamError';
    this.code = failure.code;
    this.correlationId = failure.correlationId;
    this.route = failure.route;
    this.status = failure.status;
  }
}

export async function streamSession(args: {
  projectId: string;
  deckId?: string;
  conversationId: string;
  message: string;
  images?: MainRunImage[];
  dataAnchors?: Array<{
    authority: 'ThinkGraph' | 'KnowGraph' | 'CodeGraph';
    nativeId: string;
    reason: string;
    priority: number;
    boundedExpansion: number;
    resultLimit: number;
    required: boolean;
  }>;
  onEvent: (event: NativeSessionEvent) => void;
  signal?: AbortSignal;
}): Promise<{ finalText: string }> {
  const clientMessageId = `msg_${globalThis.crypto.randomUUID()}`;
  const clientReplyMessageId = `msg_${globalThis.crypto.randomUUID()}`;
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      message: args.message,
      clientMessageId,
      clientReplyMessageId,
      dataAnchors: args.dataAnchors || [],
      images: args.images || [],
    }),
    signal: args.signal,
  });
  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null) as {
      error?: unknown;
      correlationId?: unknown;
    } | null;
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'session_chat_failed',
      message: `Main Bot Mode request failed with status ${res.status}.`,
      correlationId: typeof payload?.correlationId === 'string'
        ? payload.correlationId
        : undefined,
      route: `${BASE}/chat`,
      status: res.status,
    });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let streamFailure: SessionStreamError | null = null;
  let sawEnd = false;
  const deliveredEvents = new Set<string>();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const evMatch = /^event: (.*)$/m.exec(frame);
      const dataMatch = /^data: ([\s\S]*)$/m.exec(frame);
      const kind = evMatch?.[1];
      if (!kind) continue;
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(dataMatch?.[1] || '{}');
      } catch {
        /* keep empty */
      }
      if (kind === 'done') finalText = String((data as { fullText?: string }).fullText ?? finalText);
      if (kind === 'error') {
        streamFailure = new SessionStreamError({
          code: typeof data.code === 'string' && data.code ? data.code : 'session_stream_failed',
          message: typeof data.message === 'string' && data.message
            ? data.message
            : 'The chat stream reported a failure.',
          correlationId: typeof data.correlationId === 'string' ? data.correlationId : undefined,
          route: typeof data.route === 'string' ? data.route : undefined,
          status: typeof data.status === 'number' ? data.status : undefined,
        });
      }
      if (kind === 'end') sawEnd = true;
      const eventId = (data.projection as MainProjectionEvent | undefined)?.id
        || (data.terminalEvent as RuntimeEvent | undefined)?.id;
      if (eventId) {
        const identity = `${String(data.projectId || '')}:${String(data.deckId || '')}:${String(data.runId || '')}:${eventId}`;
        if (deliveredEvents.has(identity)) continue;
        deliveredEvents.add(identity);
      }
      args.onEvent({ ...data, kind });
    }
  }
  if (streamFailure) throw streamFailure;
  if (!sawEnd) {
    throw new SessionStreamError({
      code: 'session_stream_incomplete',
      message: 'The chat stream ended before reporting completion.',
      route: `${BASE}/chat`,
    });
  }
  return { finalText };
}

export async function stopSession(args: {
  projectId: string;
  deckId?: string;
  conversationId: string;
  expectedRunId: string;
}): Promise<{ runId: string; state: string }> {
  const res = await fetch(`${BASE}/stop`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const payload = await res.json().catch(() => null) as {
    ok?: boolean;
    runId?: unknown;
    state?: unknown;
    error?: unknown;
  } | null;
  if (!res.ok || payload?.ok !== true) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'main_run_stop_failed',
      message: `Main run stop failed with status ${res.status}.`,
      route: `${BASE}/stop`,
      status: res.status,
    });
  }
  return { runId: String(payload.runId || ''), state: String(payload.state || 'stopping') };
}

/**
 * Reload the saved Main Card's native Hermes session history. A fresh native
 * conversation resolves to an empty array; transport and malformed-response
 * failures remain visible to the caller.
 */
export async function loadSessionHistory(args: {
  projectId: string;
  deckId?: string;
  conversationId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  mainCardId: string;
  addressableAgents: AddressableAgent[];
  messages: SharedChatMessage[];
  terminalEvents: RuntimeEvent[];
}> {
  const params = new URLSearchParams({
    projectId: args.projectId,
    conversationId: args.conversationId,
  });
  if (args.deckId) params.set('deckId', args.deckId);
  const requestController = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => requestController.abort();
  if (args.signal?.aborted) abortFromCaller();
  else args.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, args.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(`${BASE}/history?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
      signal: requestController.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new SessionStreamError({
        code: 'conversation_history_timeout',
        message: 'Conversation history read timed out.',
        route: `${BASE}/history`,
      });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    args.signal?.removeEventListener('abort', abortFromCaller);
  }
  const payload = (await res.json().catch(() => null)) as {
    error?: unknown;
    mainCardId?: unknown;
    addressableAgents?: unknown[];
    messages?: {
      role?: unknown;
      text?: unknown;
      speaker?: unknown;
      target?: unknown;
    }[];
    terminalEvents?: RuntimeEvent[];
  } | null;
  if (!res.ok) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'conversation_history_read_failed',
      message: `Conversation history read failed with status ${res.status}.`,
      route: `${BASE}/history`,
      status: res.status,
    });
  }
  if (!payload || !Array.isArray(payload.messages)) {
    throw new SessionStreamError({
      code: 'conversation_history_response_invalid',
      message: 'Conversation history response did not contain a messages array.',
      route: `${BASE}/history`,
      status: res.status,
    });
  }
  const participant = (value: unknown): SharedChatParticipant | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (!['user', 'card'].includes(String(item.kind)) || typeof item.label !== 'string' || !item.label) {
      return null;
    }
    return {
      kind: item.kind as 'user' | 'card',
      label: item.label,
      ...(typeof item.cardId === 'string' && item.cardId ? { cardId: item.cardId } : {}),
      ...(typeof item.profile === 'string' && item.profile ? { profile: item.profile } : {}),
      ...(typeof item.address === 'string' && item.address ? { address: item.address } : {}),
    };
  };
  const messages = payload.messages
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .map((m): SharedChatMessage | null => {
      const speaker = participant(m.speaker);
      if (!speaker) return null;
      const target = participant(m.target);
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        text: typeof m.text === 'string' ? m.text : '',
        speaker,
        ...(target ? { target } : {}),
      };
    })
    .filter((message): message is SharedChatMessage => message !== null && message.text.length > 0);
  const terminalEvents = Array.isArray(payload.terminalEvents)
    ? payload.terminalEvents.filter((event) => (
        event && typeof event.id === 'string'
        && typeof event.category === 'string'
        && event.category.startsWith('execution.')
      ))
    : [];
  const mainCardId = typeof payload.mainCardId === 'string' ? payload.mainCardId.trim() : '';
  const addressableAgents = Array.isArray(payload.addressableAgents)
    ? payload.addressableAgents.flatMap((value): AddressableAgent[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const agent = value as Record<string, unknown>;
      const aliases = Array.isArray(agent.aliases)
        ? agent.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.length > 0)
        : [];
      if (
        typeof agent.cardId !== 'string' || !agent.cardId
        || typeof agent.profile !== 'string' || !agent.profile
        || typeof agent.title !== 'string' || !agent.title
        || typeof agent.address !== 'string' || !agent.address
        || aliases.length === 0
      ) return [];
      return [{
        cardId: agent.cardId,
        cardRevisionId: typeof agent.cardRevisionId === 'string' ? agent.cardRevisionId : '',
        profile: agent.profile,
        title: agent.title,
        address: agent.address,
        aliases,
      }];
    })
    : [];
  // Reading persisted chat must not create or require a live Hermes session.
  // Main's saved Card identity is always required.
  if (!mainCardId) {
    throw new SessionStreamError({
      code: 'conversation_history_main_identity_missing',
      message: 'Conversation history did not include the saved Main Card identity.',
      route: `${BASE}/history`,
      status: res.status,
    });
  }
  return { mainCardId, addressableAgents, messages, terminalEvents };
}
