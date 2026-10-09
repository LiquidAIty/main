import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadSessionHistory,
  projectCardChatTargets,
  selectedConversationId,
  SessionStreamError,
  subscribeSessionEvents,
  streamSession,
} from './sharedChatClient';

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const submissionIds = {
  clientMessageId: 'client-message-1',
  clientReplyMessageId: 'client-reply-1',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('selectedConversationId', () => {
  it('preserves an exact supplied conversation identity', () => {
    expect(selectedConversationId('?projectId=project-1&conversationId=conversation-b'))
      .toBe('conversation-b');
  });

  it('uses main only when no selected conversation exists', () => {
    expect(selectedConversationId('?projectId=project-1')).toBe('main');
  });
});

describe('projectCardChatTargets', () => {
  it('derives exact direct targets from Project Cards without consulting Main topology', () => {
    expect(projectCardChatTargets([
      {
        id: 'card_main_chat', _cardRevisionId: 'revision-main', title: 'Main',
        runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      },
      {
        id: 'card_worldsignals_agent', _cardRevisionId: 'revision-worldsignals', title: 'WorldSignals',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'worldsignals' },
      },
      {
        id: 'card-spaced-title', _cardRevisionId: 'revision-spaced', title: 'Two Words',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'two-words' },
      },
      {
        id: 'card-unsaved', title: 'Unsaved',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'unsaved' },
      },
      {
        ...({ enabled: false } as { enabled: boolean }),
        id: 'card-disabled', _cardRevisionId: 'revision-disabled', title: 'Disabled',
        runtime: { kind: 'hermes', mode: 'delegate', profile: 'disabled' },
      },
    ])).toEqual([
      {
        cardId: 'card_main_chat', cardRevisionId: 'revision-main',
        profile: 'main', title: 'Main',
        address: 'Main', aliases: ['main'],
      },
      {
        cardId: 'card_worldsignals_agent', cardRevisionId: 'revision-worldsignals',
        profile: 'worldsignals', title: 'WorldSignals',
        address: 'WorldSignals', aliases: ['worldsignals'],
      },
      {
        cardId: 'card-spaced-title', cardRevisionId: 'revision-spaced',
        profile: 'two-words', title: 'Two Words', aliases: [],
      },
    ]);
  });
});

describe('streamSession', () => {
  it('sends an exact optional target Card ID without rewriting the user text', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        projectId: 'project-1',
        deckId: 'deck_builder',
        conversationId: 'main',
        message: 'Show me the current picture.',
        ...submissionIds,
        targetCardId: 'card_worldsignals_agent',
        dataAnchors: [],
      });
      return sseResponse([
        'event: done\ndata: {"fullText":"WorldSignals reply"}\n\n',
        'event: end\ndata: {}\n\n',
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamSession({
      ...submissionIds,
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      message: 'Show me the current picture.', targetCardId: 'card_worldsignals_agent',
      onEvent: vi.fn(),
    })).resolves.toEqual({ finalText: 'WorldSignals reply' });
  });

  it('omits targetCardId for Main', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('targetCardId');
      return sseResponse([
        'event: done\ndata: {"fullText":"Main reply"}\n\n',
        'event: end\ndata: {}\n\n',
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    await streamSession({
      ...submissionIds,
      projectId: 'project-1', conversationId: 'main', message: 'Hello Main', onEvent: vi.fn(),
    });
  });

  it('preserves every tool progress frame emitted by the request stream', async () => {
    const frame = (output: string) => `event: tool_progress\ndata: ${JSON.stringify({ output,
      projectId: 'p', deckId: 'd', runId: 'r' })}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([frame('first'), frame('first'), frame('second'),
      'event: done\ndata: {"fullText":"done"}\n\nevent: end\ndata: {}\n\n'])));
    const onEvent = vi.fn();
    await streamSession({ ...submissionIds, projectId: 'p', conversationId: 'main', message: 'input', onEvent });
    expect(onEvent.mock.calls.filter(([event]) => event.kind === 'tool_progress').map(([event]) => event.output))
      .toEqual(['first', 'first', 'second']);
  });
  it('preserves equal text chunks because the request stream owns ordering', async () => {
    const event = () => `event: text\ndata: ${JSON.stringify({ text: 'ha', projectId: 'p', deckId: 'd', runId: 'r' })}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      event(), event(), event(),
      'event: done\ndata: {"fullText":"haha"}\n\nevent: end\ndata: {}\n\n',
    ])));
    const onEvent = vi.fn();
    await expect(streamSession({ ...submissionIds, projectId: 'p', conversationId: 'main', message: 'input', onEvent })).resolves.toEqual({ finalText: 'haha' });
    expect(onEvent.mock.calls.filter(([event]) => event.kind === 'text')).toHaveLength(3);
  });
  it('surfaces a rejected hermes start as typed status instead of model text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'main_domain_preparation_failed', correlationId: 'req_start' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(streamSession({
      ...submissionIds,
      projectId: 'project-1',
      conversationId: 'conversation-start-failure',
      message: 'Normal user message.',
      onEvent: vi.fn(),
    })).rejects.toMatchObject({
      code: 'main_domain_preparation_failed',
      correlationId: 'req_start',
      status: 503,
    });
  });

  it('preserves UTF-8 prompt and response bytes when an em dash is split across stream chunks', async () => {
    const text = 'Harness — Hermes — café 漢字';
    const encoded = new TextEncoder().encode(
      `event: text\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: ${JSON.stringify({ fullText: text })}\n\nevent: end\ndata: {}\n\n`,
    );
    const dashStart = encoded.findIndex((byte, index) => byte === 0xe2 && encoded[index + 1] === 0x80);
    const chunks = [encoded.slice(0, dashStart + 1), encoded.slice(dashStart + 1, dashStart + 2), encoded.slice(dashStart + 2)];
    const onEvent = vi.fn();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        message: text,
        dataAnchors: [{
          cbmQualifiedName: 'pkg.materialize_idf',
          reason: 'Current production definition',
        }],
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamSession({
      ...submissionIds,
      projectId: 'project-1',
      conversationId: 'main',
      message: text,
      dataAnchors: [{
        cbmQualifiedName: 'pkg.materialize_idf',
        reason: 'Current production definition', priority: 0,
        boundedExpansion: 1, resultLimit: 12, required: true,
      }],
      onEvent,
    })).resolves.toEqual({ finalText: text });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', text }));
  });

  it('rejects an SSE error frame with the route and correlation evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: error\ndata: {"code":"harness_turn_failed","message":"The chat run failed.","correlationId":"req_123","route":"/api/shared-chat/turn","status":502}\n\n',
      'event: end\ndata: {}\n\n',
    ])));

    await expect(streamSession({
      ...submissionIds,
      projectId: 'project-1',
      conversationId: 'main',
      message: 'hello',
      onEvent: vi.fn(),
    })).rejects.toMatchObject({
      name: 'SessionStreamError',
      code: 'harness_turn_failed',
      correlationId: 'req_123',
      route: '/api/shared-chat/turn',
      status: 502,
    } satisfies Partial<SessionStreamError>);
  });

  it('rejects a transport stream that ends without the required end event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: text\ndata: {"text":"partial"}\n\n',
    ])));

    await expect(streamSession({
      ...submissionIds,
      projectId: 'project-1',
      conversationId: 'main',
      message: 'hello',
      onEvent: vi.fn(),
    })).rejects.toMatchObject({ code: 'session_stream_incomplete' });
  });

  it('accepts a completed stream even when it has no final text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: done\ndata: {"fullText":""}\n\n',
      'event: end\ndata: {}\n\n',
    ])));

    await expect(streamSession({
      ...submissionIds,
      projectId: 'project-1',
      conversationId: 'main',
      message: 'hello',
      onEvent: vi.fn(),
    })).resolves.toEqual({ finalText: '' });
  });

  it('forwards provider reasoning separately from the visible final answer', async () => {
    const onEvent = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: reasoning\ndata: {"text":"early signal","source":"provider_exposed"}\n\n',
      'event: text\ndata: {"text":"visible answer"}\n\n',
      'event: done\ndata: {"fullText":"visible answer"}\n\n',
      'event: end\ndata: {}\n\n',
    ])));

    await expect(streamSession({
      ...submissionIds,
      projectId: 'project-1',
      conversationId: 'main',
      message: 'hello',
      onEvent,
    })).resolves.toEqual({ finalText: 'visible answer' });
    expect(onEvent).toHaveBeenCalledWith({
      kind: 'reasoning',
      text: 'early signal',
      source: 'provider_exposed',
    });
  });
});

describe('subscribeSessionEvents', () => {
  it('delivers only an exact hermes Gateway event and closes the one EventSource', () => {
    const listeners = new Map<string, (event: Event) => void>();
    const close = vi.fn();
    const eventSource = {
      addEventListener: vi.fn((name: string, listener: (event: Event) => void) => {
        listeners.set(name, listener);
      }),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
      close,
      onerror: null as null | (() => void),
    };
    const EventSourceMock = vi.fn(() => eventSource);
    vi.stubGlobal('EventSource', EventSourceMock);
    const onEvent = vi.fn();
    const onError = vi.fn();
    const detach = subscribeSessionEvents({
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
      liveSessionId: 'hermes-main',
      onEvent,
      onError,
    });

    expect(EventSourceMock).toHaveBeenCalledWith(
      '/api/shared-chat/events?projectId=project-1&deckId=deck_builder'
        + '&conversationId=main&liveSessionId=hermes-main',
      { withCredentials: true },
    );
    listeners.get('gateway')?.({
      data: JSON.stringify({
        projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
        cardId: 'card_main_chat', liveSessionId: 'hermes-main',
        event: {
          type: 'message.complete', session_id: 'hermes-main', seq: 11,
          payload: { text: 'Builder finished.' },
        },
      }),
    } as MessageEvent<string>);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    listeners.get('gateway')?.({ data: JSON.stringify({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'other',
      cardId: 'card_main_chat', liveSessionId: 'hermes-main',
      event: { type: 'message.complete', session_id: 'hermes-main', payload: { text: 'wrong' } },
    }) } as MessageEvent<string>);
    expect(onError).toHaveBeenCalledWith('main_hermes_event_identity_mismatch');
    expect(onEvent).toHaveBeenCalledOnce();

    listeners.get('gateway')?.({ data: JSON.stringify({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      cardId: 'card_main_chat', liveSessionId: 'hermes-main',
      event: { type: 'message.complete', session_id: 'hermes-main', payload: { text: 'unsequenced' } },
    }) } as MessageEvent<string>);
    expect(onError).toHaveBeenLastCalledWith('main_hermes_event_identity_mismatch');
    expect(onEvent).toHaveBeenCalledOnce();

    detach();
    expect(close).toHaveBeenCalledOnce();
    expect(eventSource.removeEventListener).toHaveBeenCalledWith('gateway', expect.any(Function));
  });
});

describe('loadSessionHistory', () => {
  it('ignores persisted non-chat events instead of turning them into bubbles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        ok: true,
        mainCardId: 'card_main_chat',
        addressableAgents: [{
          cardId: 'builder', cardRevisionId: 'revision:builder', profile: 'builder',
          title: 'Builder', address: 'Builder', aliases: ['builder'],
        }],
        messages: [
          { role: 'user', text: 'Exact user text', speaker: { kind: 'user', label: 'You' },
            target: { kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder', address: 'Builder' } },
          { role: 'tool', text: 'tool event text' },
          { role: 'status', text: 'Working' },
          { role: 'assistant', text: 'Exact model text',
            speaker: { kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder', address: 'Builder' } },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(loadSessionHistory({
      projectId: 'project-1',
      conversationId: 'conversation-history-roles',
    })).resolves.toEqual({
      mainCardId: 'card_main_chat',
      addressableAgents: [{
        cardId: 'builder', cardRevisionId: 'revision:builder', profile: 'builder',
        title: 'Builder', address: 'Builder', aliases: ['builder'],
      }],
      messages: [
        { role: 'user', text: 'Exact user text', speaker: { kind: 'user', label: 'You' },
          target: { kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder', address: 'Builder' } },
        { role: 'assistant', text: 'Exact model text',
          speaker: { kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder', address: 'Builder' } },
      ],
    });
  });

  it('keeps a valid fresh conversation as an empty transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        ok: true,
        mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(loadSessionHistory({
      projectId: 'project-1',
      conversationId: 'main',
    })).resolves.toEqual({
      mainCardId: 'card_main_chat',
      addressableAgents: [], messages: [],
    });
  });

  it('loads Project history before a Hermes runtime has been opened', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        ok: true,
        mainCardId: 'card_main_chat',
        addressableAgents: [],
        messages: [{
          role: 'assistant',
          text: 'Persisted answer',
          speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' },
        }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(loadSessionHistory({
      projectId: 'project-1',
      conversationId: 'main',
    })).resolves.toEqual({
      mainCardId: 'card_main_chat',
      addressableAgents: [],
      messages: [{
        role: 'assistant',
        text: 'Persisted answer',
        speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' },
      }],
    });
  });

  it('surfaces a persistence failure instead of substituting an empty transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: 'conversation_history_read_failed', messages: [] }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(loadSessionHistory({
      projectId: 'project-1',
      conversationId: 'main',
    })).rejects.toMatchObject({
      code: 'conversation_history_read_failed',
      status: 500,
      route: '/api/shared-chat/history',
    });
  });

  it('bounds a stuck history request with a typed timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    })));

    await expect(loadSessionHistory({
      projectId: 'project-1',
      conversationId: 'main',
      timeoutMs: 5,
    })).rejects.toMatchObject({
      code: 'conversation_history_timeout',
      route: '/api/shared-chat/history',
    });
  });
});
