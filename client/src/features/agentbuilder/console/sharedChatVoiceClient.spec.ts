import { describe, expect, it, vi } from 'vitest';

import { stopVoiceCapture, streamVoiceCapture } from './sharedChatVoiceClient';

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

describe('Hermes voice transport', () => {
  it('streams exact Card-scoped voice state and transcript events', async () => {
    const ready = {
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      cardId: 'card_worldview', runtimeSessionId: 'runtime-worldview',
      hermesSessionId: 'hermes-worldview', state: { enabled: true, tts: true },
    };
    const transcript = {
      ...ready,
      event: {
        type: 'voice.transcript', session_id: 'hermes-worldview', seq: 9,
        payload: { text: 'What city is this?' },
      },
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
        targetCardId: 'card_worldview', tts: true,
      });
      return sseResponse([
        `event: ready\ndata: ${JSON.stringify(ready)}\n\n`,
        `event: transcript\ndata: ${JSON.stringify(transcript)}\n\n`,
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onEvent = vi.fn();

    await streamVoiceCapture({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      targetCardId: 'card_worldview', onEvent,
    });

    expect(onEvent.mock.calls.map(([event]) => event.kind)).toEqual(['ready', 'transcript']);
    expect(onEvent.mock.calls[1][0].event.payload.text).toBe('What city is this?');
  });

  it('stops the exact Card voice session without retargeting it', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
        targetCardId: 'card_worldview', cancel: true,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await stopVoiceCapture({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      targetCardId: 'card_worldview', cancel: true,
    });
  });
});
