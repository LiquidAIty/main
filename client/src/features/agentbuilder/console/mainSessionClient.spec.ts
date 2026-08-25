import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadSessionHistory,
  selectedConversationId,
  SessionStreamError,
  streamSession,
} from './mainSessionClient';

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

describe('streamSession', () => {
  it('surfaces a rejected native start as typed status instead of model text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'main_domain_preparation_failed', correlationId: 'req_start' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(streamSession({
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
          authority: 'CodeGraph',
          nativeId: 'pkg.materialize_idf',
          reason: 'Current production definition',
        }],
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: text,
      dataAnchors: [{
        authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
        reason: 'Current production definition', priority: 0,
        boundedExpansion: 1, resultLimit: 12, required: true,
      }],
      onEvent,
    })).resolves.toEqual({ finalText: text });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', text }));
  });

  it('rejects an SSE error frame with the route and correlation evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: error\ndata: {"code":"harness_turn_failed","message":"The chat run failed.","correlationId":"req_123","route":"/api/coder/main/session/chat","status":502}\n\n',
      'event: end\ndata: {}\n\n',
    ])));

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: 'hello',
      onEvent: vi.fn(),
    })).rejects.toMatchObject({
      name: 'SessionStreamError',
      code: 'harness_turn_failed',
      correlationId: 'req_123',
      route: '/api/coder/main/session/chat',
      status: 502,
    } satisfies Partial<SessionStreamError>);
  });

  it('rejects a transport stream that ends without the required end event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: text\ndata: {"text":"partial"}\n\n',
    ])));

    await expect(streamSession({
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

describe('loadSessionHistory', () => {
  it('ignores persisted non-chat events instead of turning them into bubbles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        ok: true,
        messages: [
          { role: 'user', text: 'Exact user text' },
          { role: 'tool', text: 'tool event text' },
          { role: 'status', text: 'Working' },
          { role: 'assistant', text: 'Exact model text' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(loadSessionHistory({
      projectId: 'project-1',
      conversationId: 'conversation-history-roles',
    })).resolves.toEqual([
      { role: 'user', text: 'Exact user text' },
      { role: 'assistant', text: 'Exact model text' },
    ]);
  });

  it('keeps a valid fresh conversation as an empty transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: true, messages: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(loadSessionHistory({
      projectId: 'project-1',
      conversationId: 'main',
    })).resolves.toEqual([]);
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
      route: '/api/coder/main/session/history',
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
      route: '/api/coder/main/session/history',
    });
  });
});
