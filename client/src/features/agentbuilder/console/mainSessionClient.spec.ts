/**
 * Entity: Main Chat
 * Relationship: This file verifies the Main transport admits one consistent completion, requires the explicit completion/end pair, and stops consuming frames after the server closes the turn.
 * Entity: Card Invocation
 * Relationship: This file verifies transport and body-reader failures remain typed invocation errors instead of assistant output.
 * Entity: Run Ledger
 * Relationship: This file verifies a Main stream cannot report completion without one nonconflicting done frame followed by the explicit end frame.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadSessionHistory, SessionStreamError, streamSession } from './mainSessionClient';

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

  it('reports an initial fetch failure as a typed transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('connection reset');
    }));

    await expect(streamSession({
      projectId: 'project-a',
      message: 'hello',
      onEvent: () => undefined,
    })).rejects.toMatchObject<Partial<SessionStreamError>>({
      code: 'session_stream_transport_failed',
      message: 'connection reset',
    });
  });

  it('reports a body-reader failure as a typed transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('stream socket closed'));
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })));

    await expect(streamSession({
      projectId: 'project-a',
      message: 'hello',
      onEvent: () => undefined,
    })).rejects.toMatchObject<Partial<SessionStreamError>>({
      code: 'session_stream_transport_failed',
      message: 'stream socket closed',
    });
  });
});

describe('Main conversation evidence readback', () => {
  it('preserves exact linked Know identities from persisted history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      mainCardId: 'card_main_chat',
      addressableAgents: [],
      messages: [{
        role: 'assistant',
        text: 'Sourced result',
        speaker: { kind: 'card', label: 'KnowGraph', cardId: 'card_knowgraph' },
        linkedEvidenceIds: ['know-one'],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(loadSessionHistory({ projectId: 'project-a' })).resolves.toMatchObject({
      messages: [{ linkedEvidenceIds: ['know-one'] }],
    });
  });
});
