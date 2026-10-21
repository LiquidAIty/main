/**
 * Entity: Main Chat
 * Relationship: This file validates Main history and SSE identities, admits exactly one final turn result, closes at the explicit end frame, and carries Hermes voice events without inventing assistant output.
 * Entity: Hermes Card Sessions
 * Relationship: This file transports Main chat, history, stop, and voice requests to the one Project-scoped Hermes session route.
 * Entity: Bot Mode Delegation
 * Relationship: This file validates the current server-supplied addressable Card roster and preserves requested and responding participant identities in streamed events.
 * Entity: Card Invocation
 * Relationship: This file submits exact user text, bounded images, and selected Data Anchors with unique message identities and rejects incomplete or conflicting completion frames.
 * Entity: Run Ledger
 * Relationship: This file preserves the exact Run ID and typed terminal failure or completion evidence used by Main's stop and stream consumers.
 * Entity: Data Anchors
 * Relationship: This file defines and transports only bounded provider reference identities, reasons, priorities, expansion limits, and required flags for the current Main Run.
 */

export type MainConversationParticipant = {
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
};

export type DirectChatTarget = AddressableAgent;

export type MainConversationMessage = {
  role: 'assistant' | 'user';
  text: string;
  speaker: MainConversationParticipant;
  target?: MainConversationParticipant;
  linkedEvidenceIds?: string[];
};

export type HermesSessionEvent = {
  kind: string;
  projectId?: string;
  deckId?: string;
  cardId?: string;
  runId?: string;
  participant?: unknown;
  configuration?: unknown;
  text?: unknown;
  event?: unknown;
  fullText?: unknown;
  code?: unknown;
  message?: unknown;
  correlationId?: unknown;
  route?: unknown;
  status?: unknown;
  [key: string]: unknown;
};

export type MainRunImage = Record<string, unknown>;

export type GraphRecordIdentity =
  | { engraphisMemoryId: string }
  | { engraphisEntityId: string }
  | { engraphisRelationshipId: string }
  | { graphitiEpisodeId: string }
  | { graphitiEntityId: string }
  | { graphitiRelationshipId: string }
  | { cbmQualifiedName: string };

export type DataAnchor = GraphRecordIdentity & {
  reason: string;
  priority: number;
  boundedExpansion: number;
  resultLimit: number;
  required: boolean;
};

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

const BASE = '/api/main/session';

function clientMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('main_message_identity_unavailable');
  }
  return `msg_${globalThis.crypto.randomUUID()}`;
}

function parseSseFrames(
  buffer: string,
  receive: (kind: string, data: Record<string, unknown>) => void,
): string {
  let boundary = buffer.indexOf('\n\n');
  while (boundary >= 0) {
    const frame = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const kind = /^event: (.*)$/m.exec(frame)?.[1];
    const raw = /^data: ([\s\S]*)$/m.exec(frame)?.[1];
    if (kind) {
      let data: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(raw || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
      } catch {
        data = {};
      }
      receive(kind, data);
    }
    boundary = buffer.indexOf('\n\n');
  }
  return buffer;
}

export async function streamSession(args: {
  projectId: string;
  deckId?: string;
  message: string;
  images?: MainRunImage[];
  dataAnchors?: DataAnchor[];
  onEvent: (event: HermesSessionEvent) => void;
  signal?: AbortSignal;
}): Promise<{ finalText: string }> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: args.projectId,
        deckId: args.deckId,
        message: args.message,
        clientMessageId: clientMessageId(),
        clientReplyMessageId: clientMessageId(),
        dataAnchors: args.dataAnchors || [],
        ...(args.images?.length ? { images: args.images } : {}),
      }),
      signal: args.signal,
    });
  } catch (error) {
    if (args.signal?.aborted) throw error;
    throw new SessionStreamError({
      code: 'session_stream_transport_failed',
      message: error instanceof Error ? error.message : 'The Main stream transport failed.',
      route: `${BASE}/chat`,
    });
  }
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'session_chat_failed',
      message: `Main request failed with status ${response.status}.`,
      correlationId: typeof payload?.correlationId === 'string'
        ? payload.correlationId : undefined,
      route: `${BASE}/chat`,
      status: response.status,
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let streamFailure: SessionStreamError | null = null;
  let sawDone = false;
  let sawEnd = false;
  const receive = (kind: string, data: Record<string, unknown>) => {
    if (sawEnd) return;
    if (kind === 'done') {
      const completedText = String(data.fullText ?? finalText);
      if (sawDone && completedText !== finalText) {
        streamFailure = new SessionStreamError({
          code: 'session_stream_completion_conflict',
          message: 'The Main stream returned conflicting completion frames.',
          route: `${BASE}/chat`,
        });
        return;
      }
      if (sawDone) return;
      sawDone = true;
      finalText = completedText;
    }
    if (kind === 'end') sawEnd = true;
    if (kind === 'error') {
      streamFailure = new SessionStreamError({
        code: typeof data.code === 'string' && data.code ? data.code : 'session_stream_failed',
        message: typeof data.message === 'string' && data.message
          ? data.message : 'The Main stream reported a failure.',
        correlationId: typeof data.correlationId === 'string' ? data.correlationId : undefined,
        route: typeof data.route === 'string' ? data.route : undefined,
        status: typeof data.status === 'number' ? data.status : undefined,
      });
    }
    args.onEvent({ ...data, kind });
  };
  while (true) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch (error) {
      if (args.signal?.aborted) throw error;
      throw new SessionStreamError({
        code: 'session_stream_transport_failed',
        message: error instanceof Error ? error.message : 'The Main stream transport failed.',
        route: `${BASE}/chat`,
      });
    }
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    buffer = parseSseFrames(buffer, receive);
    if (sawEnd) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  buffer += decoder.decode();
  parseSseFrames(buffer, receive);
  if (streamFailure) throw streamFailure;
  if (!sawEnd) {
    throw new SessionStreamError({
      code: 'session_stream_incomplete',
      message: 'The Main stream ended before its end event.',
      route: `${BASE}/chat`,
    });
  }
  if (!sawDone) {
    throw new SessionStreamError({
      code: 'session_stream_completion_missing',
      message: 'The Main stream ended without a completion event.',
      route: `${BASE}/chat`,
    });
  }
  return { finalText };
}

export async function stopSession(args: {
  projectId: string;
  deckId?: string;
  expectedRunId: string;
}): Promise<{ runId: string; state: string }> {
  const response = await fetch(`${BASE}/stop`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok !== true) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'main_run_stop_failed',
      message: `Main run stop failed with status ${response.status}.`,
      route: `${BASE}/stop`,
      status: response.status,
    });
  }
  return { runId: String(payload.runId || ''), state: String(payload.state || 'stopping') };
}

function participant(value: unknown): MainConversationParticipant | null {
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
}

export async function loadSessionHistory(args: {
  projectId: string;
  deckId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  mainCardId: string;
  addressableAgents: AddressableAgent[];
  messages: MainConversationMessage[];
}> {
  const params = new URLSearchParams({ projectId: args.projectId });
  if (args.deckId) params.set('deckId', args.deckId);
  const controller = new AbortController();
  let timedOut = false;
  const callerAbort = () => controller.abort();
  if (args.signal?.aborted) callerAbort();
  else args.signal?.addEventListener('abort', callerAbort, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, args.timeoutMs ?? 15_000);
  let response: Response;
  try {
    response = await fetch(`${BASE}/history?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new SessionStreamError({
        code: 'conversation_history_timeout',
        message: 'Main history read timed out.',
        route: `${BASE}/history`,
      });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    args.signal?.removeEventListener('abort', callerAbort);
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload || !Array.isArray(payload.messages)) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string'
        ? payload.error : 'conversation_history_read_failed',
      message: `Main history read failed with status ${response.status}.`,
      route: `${BASE}/history`,
      status: response.status,
    });
  }
  const messages = payload.messages.flatMap((value): MainConversationMessage[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const message = value as Record<string, unknown>;
    if (!['assistant', 'user'].includes(String(message.role)) || typeof message.text !== 'string') {
      return [];
    }
    const speaker = participant(message.speaker);
    const target = participant(message.target);
    const linkedEvidenceIds = Array.isArray(message.linkedEvidenceIds)
      ? message.linkedEvidenceIds.map(String).map(value => value.trim()).filter(Boolean)
      : [];
    if (!speaker || !message.text) return [];
    return [{
      role: message.role as 'assistant' | 'user',
      text: message.text,
      speaker,
      ...(target ? { target } : {}),
      ...(linkedEvidenceIds.length ? { linkedEvidenceIds } : {}),
    }];
  });
  const addressableAgents = Array.isArray(payload.addressableAgents)
    ? payload.addressableAgents.flatMap((value): AddressableAgent[] => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        if (
          typeof item.cardId !== 'string' || !item.cardId
          || typeof item.cardRevisionId !== 'string' || !item.cardRevisionId
          || typeof item.profile !== 'string' || !item.profile
          || typeof item.title !== 'string' || !item.title
          || typeof item.address !== 'string' || !item.address
        ) return [];
        return [{
          cardId: item.cardId,
          cardRevisionId: item.cardRevisionId,
          profile: item.profile,
          title: item.title,
          address: item.address,
        }];
      }) : [];
  return {
    mainCardId: typeof payload.mainCardId === 'string' ? payload.mainCardId : '',
    addressableAgents,
    messages,
  };
}

export type HermesVoiceStreamEvent = {
  kind: 'ready' | 'status' | 'transcript' | 'error';
  projectId?: string;
  deckId?: string;
  cardId?: string;
  state?: Record<string, unknown>;
  event?: { payload?: Record<string, unknown> };
  error?: string;
};

export async function streamVoiceCapture(args: {
  projectId: string;
  deckId: string;
  tts?: boolean;
  signal?: AbortSignal;
  onEvent: (event: HermesVoiceStreamEvent) => void;
}): Promise<void> {
  const route = `${BASE}/voice/start`;
  const response = await fetch(route, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      tts: args.tts !== false,
    }),
    signal: args.signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'main_voice_start_failed',
      message: `Voice start failed with status ${response.status}.`,
      route,
      status: response.status,
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let failure: SessionStreamError | null = null;
  const receive = (kind: string, data: Record<string, unknown>) => {
    if (!['ready', 'status', 'transcript', 'error'].includes(kind)) return;
    const event = { ...data, kind } as HermesVoiceStreamEvent;
    if (
      (event.projectId && event.projectId !== args.projectId)
      || (event.deckId && event.deckId !== args.deckId)
    ) {
      throw new SessionStreamError({
        code: 'main_voice_event_identity_mismatch',
        message: 'Voice transport returned an event for another Project.',
        route,
      });
    }
    args.onEvent(event);
    if (kind === 'error') {
      failure = new SessionStreamError({
        code: event.error || 'main_voice_stream_failed',
        message: event.error || 'Voice transport reported a failure.',
        route,
      });
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = parseSseFrames(buffer, receive);
  }
  buffer += decoder.decode();
  parseSseFrames(buffer, receive);
  if (failure) throw failure;
}

export async function stopVoiceCapture(args: {
  projectId: string;
  deckId: string;
  cancel?: boolean;
}): Promise<void> {
  const route = `${BASE}/voice/stop`;
  const response = await fetch(route, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      cancel: args.cancel === true,
    }),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok !== true) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'main_voice_stop_failed',
      message: `Voice stop failed with status ${response.status}.`,
      route,
      status: response.status,
    });
  }
}
