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
