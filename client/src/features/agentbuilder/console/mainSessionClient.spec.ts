/**
 * Entity: Main Chat
 * Relationship: These tests prove the Main transport admits one consistent completion, requires the explicit completion/end pair, and stops consuming frames after the server closes the turn.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionStreamError, streamSession } from './mainSessionClient';

function sse(kind: string, data: Record<string, unknown>): string {
  return `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(frames: string, onCancel?: () => void): Response {
  const bytes = new TextEncoder().encode(frames);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
    },
    cancel() {
      onCancel?.();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Main session SSE completion', () => {
  it('deduplicates an identical final frame and closes at the first end event', async () => {
    let cancelled = false;
    const events: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(
      sse('done', { fullText: 'Finished' })
        + sse('done', { fullText: 'Finished' })
        + sse('end', {})
        + sse('done', { fullText: 'Must not be read' }),
      () => { cancelled = true; },
    )));

    const result = await streamSession({
      projectId: 'project-a',
      deckId: 'deck_builder',
      message: 'hello',
      onEvent: (event) => events.push(event.kind),
    });

    expect(result.finalText).toBe('Finished');
    expect(events).toEqual(['done', 'end']);
    expect(cancelled).toBe(true);
  });

  it('rejects conflicting completion frames', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(
      sse('done', { fullText: 'First' })
        + sse('done', { fullText: 'Second' })
        + sse('end', {}),
    )));

    await expect(streamSession({
      projectId: 'project-a',
      message: 'hello',
      onEvent: () => undefined,
    })).rejects.toMatchObject<Partial<SessionStreamError>>({
      code: 'session_stream_completion_conflict',
    });
  });

  it('rejects an end event without a completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(sse('end', {}))));

    await expect(streamSession({
      projectId: 'project-a',
      message: 'hello',
      onEvent: () => undefined,
    })).rejects.toMatchObject<Partial<SessionStreamError>>({
      code: 'session_stream_completion_missing',
    });
  });
});
