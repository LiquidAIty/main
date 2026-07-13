import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionStreamError, streamSession } from './openClaudeSessionClient';

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

describe('streamSession', () => {
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
      expect(JSON.parse(String(init?.body))).toMatchObject({ message: text });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: text,
      onEvent,
    })).resolves.toEqual({ finalText: text });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', text }));
  });

  it('rejects an SSE error frame with the route and correlation evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: error\ndata: {"code":"harness_turn_failed","message":"The chat run failed.","correlationId":"req_123","route":"/api/coder/openclaude/session/chat","status":502}\n\n',
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
      route: '/api/coder/openclaude/session/chat',
      status: 502,
    } satisfies Partial<SessionStreamError>);
  });

  it('carries optional ThinkGraph focus hints without minting identity client-side', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        projectId: 'project-1',
        conversationId: 'main',
        investigationContext: {
          focusNodeIds: ['run:42'],
          requestedOutcome: 'Inspect the selected run.',
        },
      });
      return sseResponse(['event: done\ndata: {"fullText":"done"}\n\nevent: end\ndata: {}\n\n']);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: 'Inspect it.',
      investigationContext: { focusNodeIds: ['run:42'], requestedOutcome: 'Inspect the selected run.' },
      onEvent: vi.fn(),
    })).resolves.toEqual({ finalText: 'done' });
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
});
