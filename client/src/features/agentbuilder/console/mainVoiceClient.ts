import {
  SessionStreamError,
  type MainGatewayEvent,
} from './mainSessionClient';

const BASE = '/api/main/session';

export type MainVoiceStreamEvent = {
  kind: 'ready' | 'status' | 'transcript' | 'error';
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  sessionId: string;
  state?: {
    enabled?: boolean;
    tts?: boolean;
    available?: boolean;
    audioAvailable?: boolean;
    sttAvailable?: boolean;
    details?: string;
    recordStatus?: string;
  };
  event?: MainGatewayEvent;
  error?: string;
};

export async function streamMainVoiceCapture(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  signal?: AbortSignal;
  onEvent: (event: MainVoiceStreamEvent) => void;
}): Promise<void> {
  const route = `${BASE}/voice/start`;
  const response = await fetch(route, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      tts: true,
    }),
    signal: args.signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'main_voice_start_failed',
      message: `Main voice start failed with status ${response.status}.`,
      route,
      status: response.status,
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let failure: SessionStreamError | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const kind = /^event: (.*)$/m.exec(frame)?.[1] as MainVoiceStreamEvent['kind'] | undefined;
      const raw = /^data: ([\s\S]*)$/m.exec(frame)?.[1];
      if (kind && ['ready', 'status', 'transcript', 'error'].includes(kind)) {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { /* validated below */ }
        const event = { ...data, kind } as MainVoiceStreamEvent;
        if (
          event.projectId !== args.projectId
          || event.deckId !== args.deckId
          || event.conversationId !== args.conversationId
          || typeof event.cardId !== 'string'
          || !event.cardId
        ) {
          throw new SessionStreamError({
            code: 'main_voice_event_identity_mismatch',
            message: 'Voice transport returned an event for another Card or conversation.',
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
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (failure) throw failure;
}

export async function stopMainVoiceCapture(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
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
      conversationId: args.conversationId,
      cancel: args.cancel === true,
    }),
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    error?: unknown;
  } | null;
  if (!response.ok || payload?.ok !== true) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'main_voice_stop_failed',
      message: `Main voice stop failed with status ${response.status}.`,
      route,
      status: response.status,
    });
  }
}
