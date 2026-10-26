/**
 * Entity: Main Chat
 * Entity: Card Invocation
 * Relationship: This file submits exact user text, bounded images, and selected Data Anchors with unique message identities and rejects incomplete or conflicting completion frames.
 * Relationship: This file transports the saved conversation identity for Stop and preserves request failure and completion responses.
 * Entity: Voice
 * Relationship: Sends browser recordings and reply text through authenticated, Project-scoped Hermes transcription and speech routes.
 * Entity: Data Anchors
 * Relationship: This file defines and transports only bounded provider reference identities, reasons, priorities, expansion limits, and required flags for the current Main Run.
 */

export type AddressableAgent = {
  cardId: string;
  title: string;
  address: string;
};

export type DirectChatTarget = AddressableAgent;

export type MainConversationMessage = {
  role: string;
  text: string;
  [key: string]: unknown;
};

export type MainSessionHistory = {
  sessionId: string;
  addressableAgents: AddressableAgent[];
  messages: MainConversationMessage[];
};

export type MainSessionEvent = {
  kind: string;
  projectId?: string;
  deckId?: string;
  cardId?: string;
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
  voiceTurn?: boolean;
  dataAnchors?: DataAnchor[];
  onEvent: (event: MainSessionEvent) => void;
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
        dataAnchors: args.dataAnchors || [],
        ...(args.images?.length ? { images: args.images } : {}),
        ...(args.voiceTurn ? { voiceTurn: true } : {}),
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
  const receive = (kind: string, data: Record<string, unknown>) => {
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
  }
  buffer += decoder.decode();
  parseSseFrames(buffer, receive);
  if (streamFailure) throw streamFailure;
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
  sessionId: string;
}): Promise<void> {
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
}

function parseSessionHistory(payload: Record<string, unknown>): MainSessionHistory | null {
  if (!Array.isArray(payload.messages)) return null;
  const messages = payload.messages.flatMap((value): MainConversationMessage[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const message = value as Record<string, unknown>;
    if (typeof message.role !== 'string') return [];
    return [{
      ...message,
      role: message.role,
      text: typeof message.text === 'string' ? message.text : String(message.context || ''),
    }];
  });
  const addressableAgents = Array.isArray(payload.addressableAgents)
    ? payload.addressableAgents.flatMap((value): AddressableAgent[] => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        if (
          typeof item.cardId !== 'string' || !item.cardId
          || typeof item.title !== 'string' || !item.title
          || typeof item.address !== 'string' || !item.address
        ) return [];
        return [{
          cardId: item.cardId,
          title: item.title,
          address: item.address,
        }];
      }) : [];
  return {
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : '',
    addressableAgents,
    messages,
  };
}

export async function loadSessionHistory(args: {
  projectId: string;
  deckId?: string;
  signal?: AbortSignal;
}): Promise<MainSessionHistory> {
  const params = new URLSearchParams({ projectId: args.projectId });
  if (args.deckId) params.set('deckId', args.deckId);
  const response = await fetch(`${BASE}/history?${params.toString()}`, {
    credentials: 'include',
    signal: args.signal,
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const history = payload ? parseSessionHistory(payload) : null;
  if (!response.ok || !history) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string'
        ? payload.error : 'conversation_history_read_failed',
      message: `Main history read failed with status ${response.status}.`,
      route: `${BASE}/history`,
      status: response.status,
    });
  }
  return history;
}

export async function requestVoiceAudio(operation: 'transcribe' | 'speak', args: {
  projectId: string;
  deckId: string;
  message?: string;
  cardId?: string;
  dataUrl?: string;
  mimeType?: string;
  text?: string;
}, signal: AbortSignal): Promise<{ transcript?: string; data_url?: string }> {
  const route = `${BASE}/voice/${operation}`;
  const response = await fetch(route, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal,
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok !== true) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : `voice_${operation}_failed`,
      message: typeof payload?.error === 'string' ? payload.error : `Voice request failed with status ${response.status}.`,
      route,
      status: response.status,
    });
  }
  return payload;
}
