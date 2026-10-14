// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('./mainVoiceClient', () => ({
  streamMainVoiceCapture: mocks.stream,
  stopMainVoiceCapture: mocks.stop,
}));

import useMainBotVoice from './useMainBotVoice';
import type { MainVoiceStreamEvent } from './mainVoiceClient';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stop.mockResolvedValue(undefined);
});

describe('useMainBotVoice', () => {
  it('submits one native transcript and ends after Hermes finishes speaking', async () => {
    let onEvent: ((event: MainVoiceStreamEvent) => void) | null = null;
    mocks.stream.mockImplementation(({ onEvent: candidate, signal }) => {
      onEvent = candidate;
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const submitTranscript = vi.fn(async () => 'answer');
    const { result } = renderHook(() => useMainBotVoice({
      canvasProjectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'main',
      conversationKey: 'project-one:main',
      mainCardId: 'card_main_chat',
      sessionHistoryLoading: false,
      sessionPending: false,
      submitTranscript,
    }));

    act(() => result.current.startVoice());
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce());
    act(() => onEvent?.({
      kind: 'ready', projectId: 'project-one', deckId: 'deck_builder',
      conversationId: 'main', cardId: 'card_main_chat', sessionId: 'live',
      state: { tts: true, audioAvailable: true },
    }));
    expect(result.current.voicePhase).toBe('listening');
    act(() => onEvent?.({
      kind: 'transcript', projectId: 'project-one', deckId: 'deck_builder',
      conversationId: 'main', cardId: 'card_main_chat', sessionId: 'live',
      event: { type: 'voice.transcript', session_id: 'live', payload: { text: 'spoken task' } },
    }));
    await waitFor(() => expect(submitTranscript).toHaveBeenCalledWith('spoken task'));
    act(() => onEvent?.({
      kind: 'status', projectId: 'project-one', deckId: 'deck_builder',
      conversationId: 'main', cardId: 'card_main_chat', sessionId: 'live',
      event: { type: 'voice.status', session_id: 'live', payload: { state: 'speaking' } },
    }));
    expect(result.current.voicePhase).toBe('speaking');
    act(() => onEvent?.({
      kind: 'status', projectId: 'project-one', deckId: 'deck_builder',
      conversationId: 'main', cardId: 'card_main_chat', sessionId: 'live',
      event: { type: 'voice.status', session_id: 'live', payload: { state: 'idle' } },
    }));
    await waitFor(() => expect(result.current.voicePhase).toBe('idle'));
    expect(mocks.stop).toHaveBeenCalledWith(expect.objectContaining({ cancel: true }));
  });
});
