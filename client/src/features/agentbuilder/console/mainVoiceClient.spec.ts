import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  stopMainVoiceCapture,
  streamMainVoiceCapture,
} from './mainVoiceClient';

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe('Main native voice client', () => {
  it('streams only identity-bound Hermes voice events', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: ready\ndata: {"projectId":"p","deckId":"d","conversationId":"main","cardId":"card_main_chat","sessionId":"live","state":{"tts":true}}\n\n',
      'event: transcript\ndata: {"projectId":"p","deckId":"d","conversationId":"main","cardId":"card_main_chat","sessionId":"live","event":{"type":"voice.transcript","session_id":"live","payload":{"text":"spoken request"}}}\n\n',
    ])));
    const onEvent = vi.fn();

    await streamMainVoiceCapture({
      projectId: 'p', deckId: 'd', conversationId: 'main', onEvent,
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[1][0]).toMatchObject({
      kind: 'transcript',
      event: { payload: { text: 'spoken request' } },
    });
  });

  it('stops the exact Main voice scope without another route', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await stopMainVoiceCapture({
      projectId: 'p', deckId: 'd', conversationId: 'main', cancel: true,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/main/session/voice/stop', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        projectId: 'p', deckId: 'd', conversationId: 'main', cancel: true,
      }),
    }));
  });
});
