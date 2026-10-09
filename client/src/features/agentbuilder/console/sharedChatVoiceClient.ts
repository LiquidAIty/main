import {
  SessionStreamError,
  type HermesSessionEvent,
} from './sharedChatClient';

const SHARED_CHAT_API_BASE = '/api/shared-chat';

export type HermesVoiceStreamEvent = {
  kind: 'ready' | 'status' | 'transcript' | 'error';
  projectId: string;
  deckId: string;
  conversationId: string;
  cardId: string;
  runtimeSessionId: string;
  hermesSessionId: string;
  state?: {
    enabled?: boolean;
    tts?: boolean;
    available?: boolean | null;
    audioAvailable?: boolean | null;
    sttAvailable?: boolean | null;
    details?: string;
    recordStatus?: string;
  };
  event?: HermesSessionEvent;
  error?: string;
};

export async function streamVoiceCapture(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  targetCardId?: string;
  tts?: boolean;
  signal?: AbortSignal;
  onEvent: (event: HermesVoiceStreamEvent) => void;
}): Promise<void> {
  const route = `${SHARED_CHAT_API_BASE}/voice/start`;
  const res = await fetch(route, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      ...(args.targetCardId ? { targetCardId: args.targetCardId } : {}),
      tts: args.tts !== false,
    }),
    signal: args.signal,
  });
  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null) as { error?: unknown } | null;
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'card_voice_start_failed',
      message: `Voice start failed with status ${res.status}.`,
      route,
      status: res.status,
    });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let failure: SessionStreamError | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const kind = /^event: (.*)$/m.exec(frame)?.[1] as HermesVoiceStreamEvent['kind'] | undefined;
      const raw = /^data: ([\s\S]*)$/m.exec(frame)?.[1];
      if (kind && ['ready', 'status', 'transcript', 'error'].includes(kind)) {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { /* validated below */ }
        const event = { ...data, kind } as HermesVoiceStreamEvent;
        if (
          event.projectId !== args.projectId
          || event.deckId !== args.deckId
          || event.conversationId !== args.conversationId
          || typeof event.cardId !== 'string'
          || !event.cardId
        ) {
          throw new SessionStreamError({
            code: 'card_voice_event_identity_mismatch',
            message: 'Voice transport returned an event for another Card or conversation.',
            route,
          });
        }
        args.onEvent(event);
        if (kind === 'error') {
          failure = new SessionStreamError({
            code: event.error || 'card_voice_stream_failed',
            message: event.error || 'Voice transport reported a failure.',
            route,
          });
        }
      }
      index = buffer.indexOf('\n\n');
    }
  }
  if (failure) throw failure;
}

export async function stopVoiceCapture(args: {
  projectId: string;
  deckId: string;
  conversationId: string;
  targetCardId?: string;
  cancel?: boolean;
}): Promise<void> {
  const route = `${SHARED_CHAT_API_BASE}/voice/stop`;
  const res = await fetch(route, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      ...(args.targetCardId ? { targetCardId: args.targetCardId } : {}),
      cancel: args.cancel === true,
    }),
  });
  const payload = await res.json().catch(() => null) as { ok?: boolean; error?: unknown } | null;
  if (!res.ok || payload?.ok !== true) {
    throw new SessionStreamError({
      code: typeof payload?.error === 'string' ? payload.error : 'card_voice_stop_failed',
      message: `Voice stop failed with status ${res.status}.`,
      route,
      status: res.status,
    });
  }
}
