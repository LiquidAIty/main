/**
 * Frontend client for the persistent OpenClaude QueryEngine session bridge
 * (`/api/coder/openclaude/session/*`). The browser never speaks gRPC — it talks
 * to the backend SSE endpoint, which bridges to the gRPC QueryEngine.
 *
 * `streamSession` forwards the RAW native event stream (verbatim) to `onEvent`
 * and resolves with `done.full_text`. No transformation, no curation.
 */

export type NativeSessionEvent = {
  kind: 'session' | 'text' | 'tool_start' | 'tool_result' | 'permission' | 'done' | 'error' | 'end' | string;
  [key: string]: unknown;
};

const BASE = '/api/coder/openclaude/session';

export type SessionStreamFailure = {
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

/** Which Harness surface the turn runs in. Chat mode exposes only the
 * ThinkGraph doorway; canvas (Agent Builder / Edit) mode exposes every eligible
 * saved card as a direct Single Assist doorway. Explicit — never inferred. */
export type HarnessMode = 'chat' | 'canvas';

/** Optional, UI-neutral ThinkGraph focus hints. The backend always mints the
 * project/conversation context for Hermes; no graph selection is required. */
export type InvestigationContextInput = {
  focusNodeIds?: string[];
  requestedOutcome?: string;
};

export async function streamSession(args: {
  projectId: string;
  conversationId: string;
  message: string;
  mode?: HarnessMode;
  investigationContext?: InvestigationContextInput;
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
      ...(args.investigationContext ? { investigationContext: args.investigationContext } : {}),
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
  // Transport-level turn-complete signal (same event UploadAttachment already
  // uses): durable knowledge may have changed server-side after this turn —
  // listeners (e.g. the ThinkGraph projection view) refetch their real reads.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('knowledge:refresh'));
  }
  return { finalText };
}

/**
 * Load the durable project-scoped transcript for a conversation (persisted by
 * the backend `conversations/store.ts`). Returns turns in append order. A
 * fresh project or any read failure resolves to an empty array — never throws —
 * so chat always opens, with or without history.
 */
export async function loadSessionHistory(args: {
  projectId: string;
  conversationId: string;
  signal?: AbortSignal;
}): Promise<{ role: 'assistant' | 'user'; text: string }[]> {
  try {
    const params = new URLSearchParams({
      projectId: args.projectId,
      conversationId: args.conversationId,
    });
    const res = await fetch(`${BASE}/history?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
      signal: args.signal,
    });
    if (!res.ok) return [];
    const payload = (await res.json().catch(() => ({}))) as {
      messages?: { role?: unknown; text?: unknown }[];
    };
    if (!Array.isArray(payload.messages)) return [];
    return payload.messages
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        text: typeof m.text === 'string' ? m.text : '',
      }))
      .filter((m) => m.text.length > 0);
  } catch {
    return [];
  }
}

export async function answerSession(args: {
  projectId: string;
  conversationId: string;
  promptId: string;
  reply: string;
}): Promise<boolean> {
  const res = await fetch(`${BASE}/answer`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean((payload as { ok?: boolean }).ok);
}
