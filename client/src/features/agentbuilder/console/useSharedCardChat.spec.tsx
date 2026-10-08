// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSessionHistory: vi.fn(),
  stopSession: vi.fn(),
  stopVoiceCapture: vi.fn(),
  streamVoiceCapture: vi.fn(),
  subscribeSessionEvents: vi.fn(),
  streamSession: vi.fn(),
  waitForBackendReady: vi.fn(),
}));

vi.mock('../../../components/builder/backendReadiness', () => ({
  waitForBackendReady: mocks.waitForBackendReady,
}));

vi.mock('./sharedChatClient', async () => {
  const actual = await vi.importActual<typeof import('./sharedChatClient')>('./sharedChatClient');
  return {
    ...actual,
    loadSessionHistory: mocks.loadSessionHistory,
    stopSession: mocks.stopSession,
    stopVoiceCapture: mocks.stopVoiceCapture,
    streamVoiceCapture: mocks.streamVoiceCapture,
    subscribeSessionEvents: mocks.subscribeSessionEvents,
    streamSession: mocks.streamSession,
  };
});

import useSharedCardChat from './useSharedCardChat';
import { SessionStreamError } from './sharedChatClient';

function messageText(messages: Array<{ role: string; text: string }>) {
  return messages.map(({ role, text }) => ({ role, text }));
}

const directChatTargets = [
  {
    cardId: 'card_main_chat', cardRevisionId: 'revision-main', profile: 'main',
    title: 'Main', address: 'Main', aliases: ['main'],
  },
  {
    cardId: 'builder', cardRevisionId: 'revision-builder', profile: 'builder',
    title: 'Builder', address: 'Builder', aliases: ['builder'],
  },
  {
    cardId: 'card_worldsignals_agent', cardRevisionId: 'revision-worldsignals',
    profile: 'worldsignals', title: 'WorldSignals', address: 'WorldSignals',
    aliases: ['worldsignals'],
  },
  {
    cardId: 'card_worldview', cardRevisionId: 'revision-worldview',
    profile: 'worldview', title: 'WorldView', address: 'WorldView',
    aliases: ['worldview'],
  },
];

beforeEach(() => {
  mocks.loadSessionHistory.mockReset();
  mocks.stopSession.mockReset();
  mocks.stopVoiceCapture.mockReset().mockResolvedValue(undefined);
  mocks.streamVoiceCapture.mockReset();
  mocks.subscribeSessionEvents.mockReset().mockReturnValue(vi.fn());
  mocks.streamSession.mockReset();
  mocks.waitForBackendReady.mockReset().mockResolvedValue(false);
});

describe('Shared Card chat live observation callbacks', () => {
  it('loads Project history without a separate runtime-readiness poll', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat',
      addressableAgents: [],
      messages: [],
    });
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', runId: 'run-main', liveSessionId: 'hermes-main' });
      return { finalText: 'Main answer.' };
    });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());
    expect(mocks.loadSessionHistory).toHaveBeenCalledOnce();
  });

  it('keeps tool frames out of Chat and replaces streamed text with the exact completion', async () => {
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', runId: 'server-run' });
      onEvent({ kind: 'tool_start', runId: 'server-run', event: { type: 'tool.start' } });
      onEvent({ kind: 'text', runId: 'server-run', text: 'Short ' });
      onEvent({ kind: 'text', runId: 'server-run', text: 'answer.' });
      return { finalText: 'Short answer.' };
    });
    const { result } = renderHook(() => useSharedCardChat({ canvasProjectId: 'project-1',
      deckId: 'deck_builder', conversationId: 'main' }));
    await act(async () => { await result.current.requestMainText('Question'); });

    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Question' },
      { role: 'assistant', text: 'Short answer.' },
    ]);
  });

  it('attributes a direct addressed turn to Builder and never subscribes it as Main', async () => {
    const builder = {
      kind: 'card' as const,
      label: 'Builder',
      cardId: 'builder',
      profile: 'builder',
      address: 'builder',
    };
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({
        kind: 'run', runId: 'builder-run', cardId: 'builder', participant: builder,
        directAddressed: true,
      });
      onEvent({
        kind: 'session', runId: 'builder-run', cardId: 'builder', participant: builder,
        directAddressed: true,
      });
      onEvent({
        kind: 'text', runId: 'builder-run', cardId: 'builder', participant: builder,
        directAddressed: true, text: 'BUILDER_DIRECT_OK',
      });
      return { finalText: 'BUILDER_DIRECT_OK' };
    });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));

    await act(async () => {
      await result.current.requestMainText('@builder Reply exactly BUILDER_DIRECT_OK');
    });

    expect(result.current.messages).toMatchObject([
      {
        role: 'user', text: '@builder Reply exactly BUILDER_DIRECT_OK', status: 'complete',
        speaker: { kind: 'user', label: 'You' }, target: builder,
      },
      { role: 'assistant', text: 'BUILDER_DIRECT_OK', status: 'complete', speaker: builder },
    ]);
    expect(mocks.subscribeSessionEvents).not.toHaveBeenCalled();
  });

  it('uses one visible responder state and lets a typed address replace an icon target', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    mocks.streamSession.mockResolvedValue({ finalText: 'Done.' });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    act(() => {
      expect(result.current.setCurrentResponderCardId('card_worldsignals_agent')).toBe(true);
    });
    expect(result.current.currentResponder).toMatchObject({
      cardId: 'card_worldsignals_agent', label: 'WorldSignals', address: 'WorldSignals',
    });

    await act(async () => {
      await result.current.requestMainText('@Builder Keep these exact user bytes.');
    });
    expect(mocks.streamSession).toHaveBeenCalledWith(expect.objectContaining({
      message: '@Builder Keep these exact user bytes.',
      targetCardId: 'builder',
    }));
    expect(result.current.currentResponder).toMatchObject({
      cardId: 'builder', label: 'Builder', address: 'Builder',
    });

    await act(async () => {
      await result.current.requestMainText('@Main Return to the default responder.');
    });
    expect(mocks.streamSession).toHaveBeenLastCalledWith(expect.not.objectContaining({
      targetCardId: expect.anything(),
    }));
    expect(result.current.currentResponder).toMatchObject({
      cardId: 'card_main_chat', label: 'Main', address: 'Main',
    });
  });

  it('passes user-uploaded images through a Main request without changing their content', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    mocks.streamSession.mockResolvedValue({ finalText: 'Image received.' });
    const images = [{
      name: 'chart.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=',
      kind: 'user-upload',
    }];
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.requestMainText('Read this chart.', { images });
    });

    expect(mocks.streamSession).toHaveBeenCalledOnce();
    expect(mocks.streamSession.mock.calls[0][0]).toMatchObject({
      message: 'Read this chart.', images,
    });
    expect(mocks.streamSession.mock.calls[0][0]).not.toHaveProperty('targetCardId');
    expect(images).toEqual([{
      name: 'chart.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=',
      kind: 'user-upload',
    }]);
  });

  it('combines user uploads with the viewport captured for the addressed Card', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    const uploadedImage = {
      name: 'reference.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,cmVmZXJlbmNl',
      kind: 'user-upload',
    };
    const viewportRecord = {
      schemaVersion: 'worldview.turn-context.v1', kind: 'worldview-viewport',
      name: 'worldview-viewport.jpg',
    };
    const images = [uploadedImage];
    const prepareRunImages = vi.fn().mockResolvedValue([viewportRecord]);
    mocks.streamSession.mockResolvedValue({ finalText: 'Both images received.' });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets, prepareRunImages,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.requestMainText('@WorldView Compare these views.', { images });
    });

    expect(prepareRunImages).toHaveBeenCalledOnce();
    expect(prepareRunImages).toHaveBeenCalledWith('card_worldview');
    expect(mocks.streamSession).toHaveBeenCalledWith(expect.objectContaining({
      message: '@WorldView Compare these views.', targetCardId: 'card_worldview',
      images: [uploadedImage, viewportRecord],
    }));
    expect(images).toEqual([uploadedImage]);
  });

  it('keeps user uploads when the addressed Card viewport cannot be captured', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    const images = [{
      name: 'reference.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,cmVmZXJlbmNl',
      kind: 'user-upload',
    }];
    const prepareRunImages = vi.fn().mockRejectedValue(new Error('viewport unmounted'));
    mocks.streamSession.mockResolvedValue({ finalText: 'Uploaded image received.' });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets, prepareRunImages,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    await act(async () => {
      await expect(result.current.requestMainText('@WorldView Read this image.', { images }))
        .resolves.toBe('Uploaded image received.');
    });

    expect(prepareRunImages).toHaveBeenCalledWith('card_worldview');
    expect(mocks.streamSession).toHaveBeenCalledOnce();
    expect(mocks.streamSession).toHaveBeenCalledWith(expect.objectContaining({
      message: '@WorldView Read this image.', targetCardId: 'card_worldview', images,
    }));
    expect(result.current.technicalError).toBeNull();
  });

  it.each([11, 12])('uses only remaining viewport slots after %i user uploads', async (uploadCount) => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    const images = Array.from({ length: uploadCount }, (_, index) => ({
      name: `upload-${index}.png`, mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,b3JpZ2luYWw=', kind: 'user-upload',
    }));
    const viewportRecords = [
      { kind: 'worldview-viewport', name: 'first-viewport.jpg' },
      { kind: 'worldview-viewport', name: 'second-viewport.jpg' },
    ];
    const prepareRunImages = vi.fn().mockResolvedValue(viewportRecords);
    mocks.streamSession.mockResolvedValue({ finalText: 'Images received.' });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets, prepareRunImages,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.requestMainText('@WorldView Compare the images.', { images });
    });

    const submittedImages = mocks.streamSession.mock.calls[0][0].images;
    expect(submittedImages).toHaveLength(12);
    expect(submittedImages.slice(0, uploadCount)).toEqual(images);
    expect(submittedImages.slice(uploadCount)).toEqual(uploadCount === 11 ? [viewportRecords[0]] : []);
    expect(images).toHaveLength(uploadCount);
    expect(viewportRecords).toHaveLength(2);
  });

  it('submits one WorldView voice transcript through the normal Card turn with current scene input', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    const viewportRecord = {
      schemaVersion: 'worldview.turn-context.v1',
      kind: 'worldview-viewport',
      name: 'worldview-viewport.jpg',
    };
    const prepareRunImages = vi.fn().mockResolvedValue([viewportRecord]);
    mocks.streamSession.mockResolvedValue({ finalText: 'You are looking at New York City.' });
    mocks.streamVoiceCapture.mockImplementation(async (args: any) => {
      args.onEvent({
        kind: 'ready', projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
        cardId: 'card_worldview', state: { tts: false, audioAvailable: false },
      });
      args.onEvent({
        kind: 'transcript', projectId: 'project-1', deckId: 'deck_builder',
        conversationId: 'main', cardId: 'card_worldview',
        event: {
          type: 'voice.transcript', session_id: 'hermes-worldview',
          payload: { text: 'What city is this?' },
        },
      });
      await new Promise<void>((resolve) => {
        if (args.signal?.aborted) resolve();
        else args.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets, prepareRunImages,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    act(() => {
      expect(result.current.setCurrentResponderCardId('card_worldview')).toBe(true);
      result.current.startVoiceSession();
    });

    await waitFor(() => expect(mocks.streamSession).toHaveBeenCalledOnce());
    expect(mocks.streamVoiceCapture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      targetCardId: 'card_worldview', tts: true,
    }));
    expect(prepareRunImages).toHaveBeenCalledWith('card_worldview');
    expect(mocks.streamSession).toHaveBeenCalledWith(expect.objectContaining({
      message: 'What city is this?',
      targetCardId: 'card_worldview',
      images: [viewportRecord],
    }));
    await waitFor(() => expect(result.current.voicePhase).toBe('idle'));
    expect(mocks.stopVoiceCapture).toHaveBeenCalledWith(expect.objectContaining({
      targetCardId: 'card_worldview', cancel: true,
    }));
    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'What city is this?' },
      { role: 'assistant', text: 'You are looking at New York City.' },
    ]);
  });

  it('ends the old Card microphone instead of transferring it when the responder changes', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    mocks.streamVoiceCapture.mockImplementation(async (args: any) => {
      args.onEvent({
        kind: 'ready', projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
        cardId: 'card_main_chat', state: { tts: true, audioAvailable: true },
      });
      await new Promise<void>((resolve) => {
        if (args.signal?.aborted) resolve();
        else args.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    act(() => result.current.startVoiceSession());
    await waitFor(() => expect(result.current.voicePhase).toBe('listening'));
    act(() => {
      expect(result.current.setCurrentResponderCardId('card_worldview')).toBe(true);
    });

    await waitFor(() => expect(result.current.voicePhase).toBe('idle'));
    expect(mocks.stopVoiceCapture).toHaveBeenCalledWith({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main', cancel: true,
    });
    expect(mocks.streamVoiceCapture).toHaveBeenCalledTimes(1);
  });

  it('preserves the current Card when an unavailable companion target is rejected', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    mocks.streamSession.mockResolvedValue({ finalText: 'WorldSignals reply.' });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    act(() => {
      expect(result.current.setCurrentResponderCardId('card_worldsignals_agent')).toBe(true);
      expect(result.current.setCurrentResponderCardId('missing-companion-card')).toBe(false);
    });
    expect(result.current.currentResponder).toMatchObject({
      cardId: 'card_worldsignals_agent', label: 'WorldSignals',
    });

    await act(async () => {
      await result.current.requestMainText('Keep the existing responder.');
    });
    expect(mocks.streamSession).toHaveBeenCalledWith(expect.objectContaining({
      targetCardId: 'card_worldsignals_agent',
      message: 'Keep the existing responder.',
    }));
  });

  it('rejects a second submission until the correlated turn has finished', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    let finishFirst!: (value: { finalText: string }) => void;
    mocks.streamSession
      .mockImplementationOnce(({ onEvent }) => {
        onEvent({ kind: 'session', runId: 'run-first', cardId: 'card_worldsignals_agent' });
        return new Promise((resolve) => { finishFirst = resolve; });
      })
      .mockResolvedValueOnce({ finalText: 'Builder second reply.' });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    act(() => {
      result.current.setCurrentResponderCardId('card_worldsignals_agent');
      result.current.handleSend('First turn.');
    });
    await waitFor(() => expect(mocks.streamSession).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.setCurrentResponderCardId('builder');
      result.current.handleSend('Second turn for Builder.');
    });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.streamSession).toHaveBeenCalledTimes(1);
    expect(result.current.messages.filter((message) => message.role === 'user').map((message) => message.text))
      .toEqual(['First turn.']);

    await act(async () => {
      finishFirst({ finalText: 'WorldSignals first reply.' });
      await Promise.resolve();
    });
    act(() => result.current.handleSend('Second turn for Builder.'));
    await waitFor(() => expect(mocks.streamSession).toHaveBeenCalledTimes(2));
    expect(mocks.streamSession.mock.calls[1][0]).toMatchObject({
      message: 'Second turn for Builder.',
      targetCardId: 'builder',
    });
    expect(mocks.streamSession).toHaveBeenCalledTimes(2);
  });

  it('snapshots submitted images and the responder before the caller changes either', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    let finishFirst!: (value: { finalText: string }) => void;
    mocks.streamSession
      .mockImplementationOnce(({ onEvent }) => {
        onEvent({ kind: 'session', runId: 'run-first', cardId: 'card_worldsignals_agent' });
        return new Promise((resolve) => { finishFirst = resolve; });
      })
      .mockResolvedValueOnce({ finalText: 'Builder image reply.' });
    const uploadedImage = {
      name: 'original.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=',
      kind: 'user-upload', metadata: { caption: 'Original caption' },
    };
    const images = [uploadedImage];
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    act(() => {
      result.current.setCurrentResponderCardId('card_worldsignals_agent');
      result.current.handleSend('First turn.');
    });
    await waitFor(() => expect(mocks.streamSession).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.setCurrentResponderCardId('builder');
    });
    await act(async () => {
      finishFirst({ finalText: 'WorldSignals first reply.' });
      await Promise.resolve();
    });
    act(() => {
      result.current.handleSend('Image for Builder.', { images });
      uploadedImage.name = 'changed.png';
      uploadedImage.dataUrl = 'data:image/png;base64,Y2hhbmdlZA==';
      uploadedImage.metadata.caption = 'Changed caption';
      images.splice(0, 1);
      result.current.setCurrentResponderCardId('card_worldview');
    });
    await waitFor(() => expect(mocks.streamSession).toHaveBeenCalledTimes(2));
    expect(result.current.currentResponderCardId).toBe('card_worldview');
    expect(mocks.streamSession.mock.calls[1][0]).toMatchObject({
      message: 'Image for Builder.', targetCardId: 'builder',
      images: [{
        name: 'original.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,b3JpZ2luYWw=',
        kind: 'user-upload', metadata: { caption: 'Original caption' },
      }],
    });
    expect(result.current.currentResponderCardId).toBe('card_worldview');
  });

  it('keeps Main graph context out of a direct Card turn', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [],
    });
    mocks.streamSession.mockImplementation(async (args) => {
      expect(args.targetCardId).toBe('builder');
      expect(args.dataAnchors).toEqual([]);
      args.onEvent({
        kind: 'run', runId: 'builder-run', cardId: 'builder', directAddressed: true,
      });
      args.onEvent({
        kind: 'text', runId: 'builder-run', cardId: 'builder', directAddressed: true,
        text: 'Builder reply.',
      });
      return { finalText: 'Builder reply.' };
    });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
      dataAnchors: [{
        cbmQualifiedName: 'main-only-anchor', reason: 'next Main invocation',
        order: 0, boundedExpansion: 1, resultLimit: 12, required: true,
      }],
    }));
    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());

    act(() => {
      expect(result.current.setCurrentResponderCardId('builder')).toBe(true);
    });
    await act(async () => {
      await result.current.requestMainText('Work directly.');
    });

  });

  it('keeps a failed addressed turn attributed to the attempted target without fake assistant speech', async () => {
    mocks.streamSession.mockRejectedValue(new SessionStreamError({
      code: 'addressed_card_turn_failed',
      message: 'The Hermes Builder turn failed.',
    }));
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));

    await act(async () => {
      await expect(result.current.requestMainText('@builder unavailable test'))
        .rejects.toMatchObject({ code: 'addressed_card_turn_failed' });
    });

    expect(result.current.messages).toMatchObject([{
      role: 'user',
      text: '@builder unavailable test',
      status: 'error',
      speaker: { kind: 'user', label: 'You' },
      target: { kind: 'card', label: '@builder', address: 'builder' },
    }]);
    expect(result.current.technicalError).toBe('addressed_card_turn_failed');
  });
  it('keeps rejoin visible until Hermes history replaces the empty transcript', async () => {
    let resolveHistory!: (history: {
      mainCardId: string;
      addressableAgents: Array<{
        cardId: string; cardRevisionId: string; profile: string; title: string;
        address: string; aliases: string[];
      }>;
      messages: Array<{
        role: 'assistant' | 'user'; text: string;
        speaker: { kind: 'user' | 'card'; label: string; cardId?: string };
        target?: { kind: 'user' | 'card'; label: string; cardId?: string };
      }>;
    }) => void;
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockReturnValue(new Promise((resolve) => {
      resolveHistory = resolve;
    }));
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());
    expect(result.current.messages).toEqual([]);
    await act(async () => {
      resolveHistory({
        mainCardId: 'card_main_chat',
        addressableAgents: [],
        messages: [
          { role: 'user', text: 'Run Delegate.', speaker: { kind: 'user', label: 'You' },
            target: { kind: 'card', label: 'Main', cardId: 'card_main_chat' } },
          { role: 'assistant', text: 'Delegate completed.',
            speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' } },
        ],
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.messages).toEqual([
      { role: 'user', text: 'Run Delegate.', speaker: { kind: 'user', label: 'You' },
        target: { kind: 'card', label: 'Main', cardId: 'card_main_chat' } },
      { role: 'assistant', text: 'Delegate completed.',
        speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' } },
    ]));
  });

  it('keeps a history failure out of the transcript and clears the loading state', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockRejectedValue(new Error('history unavailable'));
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.technicalError)
      .toBe('Conversation unavailable. Reload to retry.'));
    expect(result.current.messages).toEqual([]);
  });

  it('keeps autonomous Hermes Main completions out of the shared transcript', async () => {
    const closeSessionEvents = vi.fn();
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      mainCardId: 'card_main_chat',
      addressableAgents: [],
      messages: [],
    });
    mocks.subscribeSessionEvents.mockReturnValue(closeSessionEvents);
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', runId: 'run-main', liveSessionId: 'hermes-main' });
      return { finalText: 'Main answer.' };
    });
    const { result, unmount } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await act(async () => {
      await result.current.requestMainText('Question.');
    });
    await waitFor(() => expect(mocks.subscribeSessionEvents).toHaveBeenCalledOnce());
    const subscription = mocks.subscribeSessionEvents.mock.calls[0][0];
    expect(subscription).toMatchObject({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      liveSessionId: 'hermes-main',
    });
    await act(async () => {
      subscription.onEvent({
        projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
        cardId: 'card_main_chat', liveSessionId: 'hermes-main',
        event: {
          type: 'message.complete', session_id: 'hermes-main', seq: 12,
          payload: { status: 'complete', text: 'Builder finished through Hermes.' },
        },
      });
    });
    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Question.' },
      { role: 'assistant', text: 'Main answer.' },
    ]);
    expect(mocks.streamSession).toHaveBeenCalledOnce();

    unmount();
    expect(closeSessionEvents).toHaveBeenCalledOnce();
  });

  it('keeps exact user bytes and replaces stream framing with the persisted Hermes completion', async () => {
    mocks.streamSession.mockImplementation(async (args) => {
      expect(args.message).toBe('  Normal human message.  ');
      args.onEvent({ kind: 'session', liveSessionId: 'hermes-session' });
      args.onEvent({ kind: 'text', text: '\n\nHermes answer.' });
      return { finalText: 'Hermes answer.' };
    });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-exact',
    }));

    await act(async () => {
      await expect(result.current.requestMainText('  Normal human message.  '))
        .resolves.toBe('Hermes answer.');
    });

    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: '  Normal human message.  ' },
      { role: 'assistant', text: 'Hermes answer.' },
    ]);
  });

  it('keys transcript state by conversation and never shows A while B loads', async () => {
    type LoadedHistory = {
      messages: Array<{ role: 'assistant' | 'user'; text: string }>;
    };
    let resolveA!: (history: LoadedHistory) => void;
    let resolveB!: (history: LoadedHistory) => void;
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockImplementation(({ conversationId }) => new Promise((resolve) => {
      if (conversationId === 'conversation-a') resolveA = resolve;
      if (conversationId === 'conversation-b') resolveB = resolve;
    }));
    const { result, rerender } = renderHook(
      ({ conversationId }) => useSharedCardChat({
        canvasProjectId: 'project-1',
        deckId: 'deck_builder',
        conversationId,
      }),
      { initialProps: { conversationId: 'conversation-a' } },
    );

    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-a' }),
    ));
    await act(async () => {
      resolveA({ messages: [
        { role: 'user', text: 'A user' },
        { role: 'assistant', text: 'A model' },
      ] });
      await Promise.resolve();
    });
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'A user' },
      { role: 'assistant', text: 'A model' },
    ]);

    rerender({ conversationId: 'conversation-b' });
    expect(result.current.messages).toEqual([]);

    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-b' }),
    ));
    await act(async () => {
      resolveB({
        messages: [{ role: 'user', text: 'B user' }],
      });
      await Promise.resolve();
    });
    expect(result.current.messages).toEqual([{ role: 'user', text: 'B user' }]);
  });

  it('keeps runtime failures outside the transcript', async () => {
    mocks.streamSession.mockRejectedValue(new SessionStreamError({
      code: 'harness_turn_failed',
      message: 'provider failed',
      correlationId: 'req_failure',
    }));
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-failure',
    }));

    await act(async () => {
      await expect(result.current.requestMainText('Normal user message.')).rejects.toThrow();
    });

    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Normal user message.' },
    ]);
    expect(result.current.messages[0]).toMatchObject({ status: 'error', target: { label: 'Main' } });
    expect(result.current.sessionActive).toBe(false);
  });

  it('rejects a different Run in the same stream instead of merging its activity', async () => {
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', runId: 'hermes-run' });
      onEvent({ kind: 'tool_result', runId: 'another-run', output: 'another Run output' });
      return { finalText: 'must not complete' };
    });
    const { result } = renderHook(() => useSharedCardChat({ canvasProjectId: 'project-1',
      deckId: 'deck_builder', conversationId: 'main' }));
    await act(async () => { await expect(result.current.requestMainText('Question')).rejects.toThrow('Run identity changed'); });
    expect(result.current.technicalError).toBe('main_run_identity_mismatch');
    expect(messageText(result.current.messages)).toEqual([{ role: 'user', text: 'Question' }]);
    expect(result.current.messages[0]).toMatchObject({ status: 'error' });
  });

  it('removes an unfinished assistant stream when the Hermes turn fails', async () => {
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', liveSessionId: 'hermes-session' });
      onEvent({ kind: 'text', text: 'Unfinished Hermes text' });
      throw new SessionStreamError({
        code: 'harness_turn_failed',
        message: 'provider failed',
        correlationId: 'req_partial_failure',
      });
    });
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-partial-failure',
    }));

    await act(async () => {
      await expect(result.current.requestMainText('Normal user message.')).rejects.toThrow();
    });

    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Normal user message.' },
    ]);
    expect(result.current.messages[0]).toMatchObject({ status: 'error' });
  });

  it('clears the session active state when the backend reports no active turn', async () => {
    mocks.streamSession.mockImplementation(({ signal, onEvent }) => new Promise((_resolve, reject) => {
      onEvent({ kind: 'session', liveSessionId: 'hermes-session', runId: 'hermes-run' });
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      });
    }));
    mocks.stopSession.mockRejectedValue(new SessionStreamError({
      code: 'no_active_turn',
      message: 'no active turn',
    }));
    const { result } = renderHook(() => useSharedCardChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-stale-working',
    }));

    let request!: Promise<string>;
    await act(async () => {
      request = result.current.requestMainText('Normal user message.');
      await Promise.resolve();
    });
    expect(result.current.sessionActive).toBe(true);

    await act(async () => {
      await result.current.stopMainTurn();
      await request.catch(() => undefined);
    });
    expect(result.current.sessionActive).toBe(false);
    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Normal user message.' },
    ]);
  });
});
