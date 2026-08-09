/**
 * Frontend client for the persistent OpenClaude QueryEngine session bridge
 * (`/api/coder/openclaude/session/*`). The browser never speaks gRPC — it talks
 * to the backend SSE endpoint, which bridges to the gRPC QueryEngine.
 *
 * `streamSession` forwards the RAW native event stream (verbatim) to `onEvent`
 * and resolves with `done.full_text`. No transformation, no curation.
 */
type NativeSessionEvent = {
  kind: 'session' | 'text' | 'reasoning' | 'tool_start' | 'tool_result' | 'permission' | 'done' | 'error' | 'end' | string;
  [key: string]: unknown;
};

const BASE = '/api/coder/openclaude/session';

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

/** Which Harness surface the turn runs in. Chat mode exposes only Main's saved
 * direct-subagent doorway; canvas (Agent Builder / Edit) mode exposes every eligible
 * saved card as a direct saved-card doorway. Explicit — never inferred. */
type HarnessMode = 'chat' | 'canvas';

export async function streamSession(args: {
  projectId: string;
  conversationId: string;
  message: string;
  mode?: HarnessMode;
  onEvent: (event: NativeSessionEvent) => void;
  signal?: AbortSignal;
}): Promise<{ finalText: string }> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      conversationId: args.conversationId,
      message: args.message,
      // Default 'chat' when omitted (backend also defaults to chat).
      mode: args.mode === 'canvas' ? 'canvas' : 'chat',
    }),
    signal: args.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`session_chat_failed_${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let streamFailure: SessionStreamError | null = null;
  let sawEnd = false;
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

/**
 * Load the durable project-scoped transcript for a conversation (persisted by
 * the backend `conversations/store.ts`). Returns turns in append order. A
 * A valid fresh conversation resolves to an empty array. Transport, persistence,
 * and malformed-response failures remain visible to the caller.
 */
export async function loadSessionHistory(args: {
  projectId: string;
  conversationId: string;
  signal?: AbortSignal;
}): Promise<{ role: 'assistant' | 'user'; text: string }[]> {
  const params = new URLSearchParams({
    projectId: args.projectId,
    conversationId: args.conversationId,
  });
  const res = await fetch(`${BASE}/history?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    signal: args.signal,
  });
  const payload = (await res.json().catch(() => null)) as {
    error?: unknown;
    messages?: { role?: unknown; text?: unknown }[];
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
  return payload.messages
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      text: typeof m.text === 'string' ? m.text : '',
    }))
    .filter((m) => m.text.length > 0);
}
