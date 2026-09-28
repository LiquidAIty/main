// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadMainDriverStatus: vi.fn(),
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

vi.mock('./mainSessionClient', async () => {
  const actual = await vi.importActual<typeof import('./mainSessionClient')>('./mainSessionClient');
  return {
    ...actual,
    loadMainDriverStatus: mocks.loadMainDriverStatus,
    loadSessionHistory: mocks.loadSessionHistory,
    stopSession: mocks.stopSession,
    stopVoiceCapture: mocks.stopVoiceCapture,
    streamVoiceCapture: mocks.streamVoiceCapture,
    subscribeSessionEvents: mocks.subscribeSessionEvents,
    streamSession: mocks.streamSession,
  };
});

import useAgentBuilderMainChat from './useAgentBuilderMainChat';
import { SessionStreamError } from './mainSessionClient';

function messageText(messages: Array<{ role: string; text: string }>) {
  return messages.map(({ role, text }) => ({ role, text }));
}

const directChatTargets = [
  {
    cardId: 'card_main_chat', cardRevisionId: 'revision-main', profile: 'liquidaity-main',
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
  mocks.loadMainDriverStatus.mockReset().mockResolvedValue({ ready: true, activeDriver: null });
  mocks.loadSessionHistory.mockReset();
  mocks.stopSession.mockReset();
  mocks.stopVoiceCapture.mockReset().mockResolvedValue(undefined);
  mocks.streamVoiceCapture.mockReset();
  mocks.subscribeSessionEvents.mockReset().mockReturnValue(vi.fn());
  mocks.streamSession.mockReset();
  mocks.waitForBackendReady.mockReset().mockResolvedValue(false);
});

describe('Main chat live observation callbacks', () => {
  it('surfaces the server-owned active Main input driver', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      runtimeSessionId: '', nativeSessionId: '', mainCardId: 'card_main_chat',
      addressableAgents: [], messages: [], terminalEvents: [],
    });
    mocks.loadMainDriverStatus.mockResolvedValue({
      ready: true,
      activeDriver: 'external_plugin',
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await waitFor(() => expect(result.current.mainDriverSource).toBe('external_plugin'));
    expect(mocks.loadMainDriverStatus).toHaveBeenCalledWith(
      'project-1', 'deck_builder', 'main', expect.any(AbortSignal),
    );
  });

  it('loads Project history before the Main runtime readiness snapshot settles', async () => {
    let resolveMainReady!: (status: { ready: boolean; activeDriver: null }) => void;
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadMainDriverStatus.mockReturnValue(new Promise((resolve) => {
      resolveMainReady = resolve;
    }));
    mocks.loadSessionHistory.mockResolvedValue({
      runtimeSessionId: 'runtime-main',
      nativeSessionId: 'native-main',
      mainCardId: 'card_main_chat',
      addressableAgents: [],
      messages: [],
      terminalEvents: [],
    });
    renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.loadMainDriverStatus).toHaveBeenCalledOnce());
    await act(async () => {
      resolveMainReady({ ready: true, activeDriver: null });
      await Promise.resolve();
    });
    expect(mocks.loadSessionHistory.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.loadMainDriverStatus.mock.invocationCallOrder[0]);
  });

  it('keeps duplicate technical events under the server-issued Run and out of chat', async () => {
    const onUserTurnStarted = vi.fn();
    const onNativeTurnEvent = vi.fn();
    const onTurnFinished = vi.fn();
    const event = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'main-card', cardName: 'Main',
      runId: 'server-run', parentRunId: null, nativeChildId: null, id: 'server-run:tool:1',
      category: 'execution.tool', kind: 'tool_error', toolName: 'lookup', status: 'failed', sequence: 1,
      timestamp: null, detail: 'not found' };
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'tool_result', terminalEvent: event });
      onEvent({ kind: 'tool_result', terminalEvent: event });
      onEvent({ kind: 'text', text: 'Actual reply' });
      return { finalText: 'Actual reply' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({ canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      onUserTurnStarted, onNativeTurnEvent, onTurnFinished }));
    await act(async () => { await result.current.requestMainText('Question'); });
    expect(result.current.technicalEvents).toEqual([event]);
    expect(onUserTurnStarted).toHaveBeenCalledOnce();
    expect(onUserTurnStarted).toHaveBeenCalledWith(expect.objectContaining({ runId: 'server-run' }));
    expect(onNativeTurnEvent.mock.calls.every(([turn]) => turn.runId === 'server-run')).toBe(true);
    expect(onTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ runId: 'server-run' }));
    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Question' }, { role: 'assistant', text: 'Actual reply' },
    ]);
  });

  it('binds the initial Run identity before forwarding its Jev attention event', async () => {
    const order: string[] = [];
    const onUserTurnStarted = vi.fn(() => order.push('started'));
    const onNativeTurnEvent = vi.fn((turn) => order.push(String(turn.event.kind)));
    const attention = {
      kind: 'jev_attention', schemaVersion: 'jev-attention.v1', status: 'success',
      decisionId: 'decision-one', resultIdentity: 'result-one',
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      cardId: 'card_main_chat', runId: 'server-run', directAddressed: false,
      candidates: [], distribution: {}, selectedReferences: [],
    };
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({
        kind: 'run', projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
        cardId: 'card_main_chat', runId: 'server-run', directAddressed: false,
      });
      onEvent(attention);
      return { finalText: 'Answer.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      onUserTurnStarted, onNativeTurnEvent,
    }));

    await act(async () => { await result.current.requestMainText('Question'); });

    expect(order).toEqual(['started', 'run', 'jev_attention']);
    expect(onUserTurnStarted).toHaveBeenCalledWith(expect.objectContaining({ runId: 'server-run' }));
    expect(onNativeTurnEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: 'server-run', event: attention,
    }));
  });

  it('projects input and final answer into Chat exactly once while execution stays terminal-only', async () => {
    const base = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat',
      cardName: 'Main Chat', runId: 'server-run', parentRunId: null, nativeChildId: null,
      schemaVersion: 'liquidaity.main.projection.v1' as const, nativeTurnId: 'turn-1',
      timestamp: '2026-08-31T12:00:00.000Z' };
    const input = { ...base, id: 'input-1', category: 'conversation.input' as const,
      kind: 'mission' as const, sequence: 1, text: 'Question' };
    const tool = { ...base, id: 'tool-1', category: 'execution.tool' as const,
      kind: 'tool_call' as const, sequence: 2, toolName: 'main.context', status: 'started', detail: 'context read' };
    const answer = { ...base, id: 'answer-1', category: 'conversation.answer' as const,
      kind: 'model' as const, sequence: 3, status: 'completed', text: 'Short answer.' };
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'projection', runId: 'server-run', projection: input });
      onEvent({ kind: 'projection', runId: 'server-run', projection: input });
      onEvent({ kind: 'projection', runId: 'server-run', projection: tool, terminalEvent: tool });
      onEvent({ kind: 'projection', runId: 'server-run', projection: tool, terminalEvent: tool });
      onEvent({ kind: 'projection', runId: 'server-run', projection: answer });
      onEvent({ kind: 'projection', runId: 'server-run', projection: answer });
      return { finalText: 'Short answer.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({ canvasProjectId: 'project-1',
      deckId: 'deck_builder', conversationId: 'main' }));
    await act(async () => { await result.current.requestMainText('Question'); });

    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Question' },
      { role: 'assistant', text: 'Short answer.' },
    ]);
    expect(result.current.technicalEvents).toEqual([tool]);
    expect(JSON.stringify(result.current.technicalEvents)).not.toContain('Short answer.');
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
        directAddressed: true, runtimeSessionId: 'runtime-builder', sessionId: 'native-builder',
      });
      onEvent({
        kind: 'text', runId: 'builder-run', cardId: 'builder', participant: builder,
        directAddressed: true, text: 'BUILDER_DIRECT_OK',
      });
      return { finalText: 'BUILDER_DIRECT_OK' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));

    await act(async () => {
      await result.current.requestMainText('@builder Reply exactly BUILDER_DIRECT_OK');
    });

    expect(result.current.messages).toEqual([
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
      runtimeSessionId: 'runtime-main', nativeSessionId: 'native-main',
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [], terminalEvents: [],
    });
    mocks.streamSession.mockResolvedValue({ finalText: 'Done.' });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

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

  it('submits one WorldView voice transcript through the normal Card turn with current scene input', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      runtimeSessionId: 'runtime-main', nativeSessionId: 'native-main',
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [], terminalEvents: [],
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
          type: 'voice.transcript', session_id: 'native-worldview',
          payload: { text: 'What city is this?' },
        },
      });
      await new Promise<void>((resolve) => {
        if (args.signal?.aborted) resolve();
        else args.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets, prepareRunImages,
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

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
      runtimeSessionId: 'runtime-main', nativeSessionId: 'native-main',
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [], terminalEvents: [],
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
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

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
      runtimeSessionId: 'runtime-main', nativeSessionId: 'native-main',
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [], terminalEvents: [],
    });
    mocks.streamSession.mockResolvedValue({ finalText: 'WorldSignals reply.' });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

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

  it('snapshots the selected target Card when a submission enters the queue', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      runtimeSessionId: 'runtime-main', nativeSessionId: 'native-main',
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [], terminalEvents: [],
    });
    let finishFirst!: (value: { finalText: string }) => void;
    mocks.streamSession
      .mockImplementationOnce(({ onEvent }) => {
        onEvent({ kind: 'session', runId: 'run-first', cardId: 'card_worldsignals_agent' });
        return new Promise((resolve) => { finishFirst = resolve; });
      })
      .mockResolvedValueOnce({ finalText: 'Builder queued reply.' });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

    act(() => {
      result.current.setCurrentResponderCardId('card_worldsignals_agent');
      result.current.handleNativeSend('First turn.');
    });
    await waitFor(() => expect(mocks.streamSession).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.setCurrentResponderCardId('builder');
      result.current.handleNativeSend('Queued for Builder.');
      result.current.setCurrentResponderCardId(null);
    });
    expect(result.current.queuedInputCount).toBe(1);

    await act(async () => {
      finishFirst({ finalText: 'WorldSignals first reply.' });
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.streamSession).toHaveBeenCalledTimes(2));
    expect(mocks.streamSession.mock.calls[1][0]).toMatchObject({
      message: 'Queued for Builder.',
      targetCardId: 'builder',
    });
  });

  it('keeps Main graph context and attention observers out of a direct Card turn', async () => {
    const onUserTurnStarted = vi.fn();
    const onNativeTurnEvent = vi.fn();
    const onTurnFinished = vi.fn();
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      runtimeSessionId: 'runtime-main', nativeSessionId: 'native-main',
      mainCardId: 'card_main_chat', addressableAgents: [], messages: [], terminalEvents: [],
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
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      directChatTargets,
      dataAnchors: [{
        authority: 'CodeGraph', nativeId: 'main-only-anchor', reason: 'next Main invocation',
        order: 0, boundedExpansion: 1, resultLimit: 12, required: true,
      }],
      onUserTurnStarted, onNativeTurnEvent, onTurnFinished,
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

    act(() => {
      expect(result.current.setCurrentResponderCardId('builder')).toBe(true);
    });
    await act(async () => {
      await result.current.requestMainText('Work directly.');
    });

    expect(onUserTurnStarted).not.toHaveBeenCalled();
    expect(onNativeTurnEvent).not.toHaveBeenCalled();
    expect(onTurnFinished).not.toHaveBeenCalled();
  });

  it('keeps a failed addressed turn attributed to the attempted target without fake assistant speech', async () => {
    mocks.streamSession.mockRejectedValue(new SessionStreamError({
      code: 'addressed_card_turn_failed',
      message: 'The native Builder turn failed.',
    }));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
    }));

    await act(async () => {
      await expect(result.current.requestMainText('@builder unavailable test'))
        .rejects.toMatchObject({ code: 'addressed_card_turn_failed' });
    });

    expect(result.current.messages).toEqual([{
      role: 'user',
      text: '@builder unavailable test',
      status: 'error',
      speaker: { kind: 'user', label: 'You' },
      target: { kind: 'card', label: '@builder', address: 'builder' },
    }]);
    expect(result.current.technicalError).toBe('addressed_card_turn_failed');
  });
  it('keeps rejoin visible until native history replaces the empty transcript', async () => {
    let resolveHistory!: (history: {
      runtimeSessionId: string;
      nativeSessionId: string;
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
      terminalEvents: Array<Record<string, unknown>>;
    }) => void;
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockReturnValue(new Promise((resolve) => {
      resolveHistory = resolve;
    }));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    expect(result.current.sessionHistoryLoading).toBe(true);
    await act(async () => {
      resolveHistory({
        runtimeSessionId: 'runtime-main',
        nativeSessionId: 'native-main',
        mainCardId: 'card_main_chat',
        addressableAgents: [],
        messages: [
          { role: 'user', text: 'Run Delegate.', speaker: { kind: 'user', label: 'You' },
            target: { kind: 'card', label: 'Main', cardId: 'card_main_chat' } },
          { role: 'assistant', text: 'Delegate completed.',
            speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' } },
        ],
        terminalEvents: [{
          projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat', cardName: 'Main',
          runId: 'run-history', parentRunId: null, nativeChildId: null, id: 'run-history:tool:1',
          category: 'execution.tool', kind: 'tool_result', toolName: 'lookup', status: 'completed',
          sequence: 1, timestamp: null,
        }],
      });
      await Promise.resolve();
    });

    expect(result.current.sessionHistoryLoading).toBe(false);
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Run Delegate.', speaker: { kind: 'user', label: 'You' },
        target: { kind: 'card', label: 'Main', cardId: 'card_main_chat' } },
      { role: 'assistant', text: 'Delegate completed.',
        speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' } },
    ]);
    expect(result.current.technicalEvents).toEqual([
      expect.objectContaining({ id: 'run-history:tool:1', category: 'execution.tool' }),
    ]);
  });

  it('keeps a history failure out of the transcript and clears the loading state', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockRejectedValue(new Error('native history unavailable'));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.sessionHistoryLoading).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(result.current.technicalError).toBe('Conversation unavailable. Reload to retry.');
  });

  it('keeps autonomous native Main completions out of the shared transcript', async () => {
    const closeNativeEvents = vi.fn();
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockResolvedValue({
      runtimeSessionId: 'runtime-main',
      nativeSessionId: 'native-main',
      mainCardId: 'card_main_chat',
      addressableAgents: [],
      messages: [],
      terminalEvents: [],
    });
    mocks.subscribeSessionEvents.mockReturnValue(closeNativeEvents);
    const { result, unmount } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await waitFor(() => expect(mocks.subscribeSessionEvents).toHaveBeenCalledOnce());
    const subscription = mocks.subscribeSessionEvents.mock.calls[0][0];
    expect(subscription).toMatchObject({
      projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      runtimeSessionId: 'runtime-main', nativeSessionId: 'native-main',
    });
    await act(async () => {
      subscription.onEvent({
        projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
        cardId: 'card_main_chat', runtimeSessionId: 'runtime-main', nativeSessionId: 'native-main',
        event: {
          type: 'message.complete', session_id: 'native-main', seq: 12,
          payload: { status: 'complete', text: 'Builder finished natively.' },
        },
      });
    });
    expect(result.current.messages).toEqual([]);
    expect(mocks.streamSession).not.toHaveBeenCalled();

    unmount();
    expect(closeNativeEvents).toHaveBeenCalledOnce();
  });

  it('uses the native Run identity, forwards native reasoning separately, and settles after completion', async () => {
    const order: string[] = [];
    const onUserTurnStarted = vi.fn(() => order.push('user'));
    const onNativeTurnEvent = vi.fn((turn) => order.push(String(turn.event.kind)));
    const onTurnFinished = vi.fn((turn) => order.push(turn.status));
    mocks.streamSession.mockImplementation(async (args) => {
      order.push('stream');
      expect(args.dataAnchors).toEqual([{
        authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
        reason: 'Current production definition', priority: 0,
        boundedExpansion: 1, resultLimit: 12, required: true,
      }]);
      args.onEvent({ kind: 'reasoning', runId: 'native-run', text: 'private provider reasoning' });
      args.onEvent({ kind: 'tool_result', toolName: 'main.context', output: 'tool status text' });
      args.onEvent({ kind: 'native_attention', label: 'graph status text' });
      args.onEvent({ kind: 'text', text: 'Visible answer.' });
      return { finalText: 'Visible answer.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
      dataAnchors: [{
        authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
        reason: 'Current production definition', order: 0,
        boundedExpansion: 1, resultLimit: 12, required: true,
      }],
      onUserTurnStarted,
      onNativeTurnEvent,
      onTurnFinished,
    }));

    await act(async () => {
      await result.current.requestMainText('Fix the build.');
    });

    expect(order).toEqual([
      'stream', 'user', 'reasoning', 'tool_result', 'native_attention', 'text', 'completed',
    ]);
    expect(onUserTurnStarted).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      conversationId: 'main',
      text: 'Fix the build.',
      runId: 'native-run',
    }));
    expect(onNativeTurnEvent).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'native-run', event: { kind: 'reasoning', runId: 'native-run', text: 'private provider reasoning' },
    }));
    expect(onTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Fix the build.' },
      { role: 'assistant', text: 'Visible answer.' },
    ]);
    expect(JSON.stringify(result.current.messages)).not.toContain('private provider reasoning');
    expect(JSON.stringify(result.current.messages)).not.toContain('tool status text');
    expect(JSON.stringify(result.current.messages)).not.toContain('graph status text');
  });

  it('keeps exact user bytes and replaces stream framing with the persisted native completion', async () => {
    mocks.streamSession.mockImplementation(async (args) => {
      expect(args.message).toBe('  Normal human message.  ');
      args.onEvent({ kind: 'session', sessionId: 'native-session' });
      args.onEvent({ kind: 'text', text: '\n\nNative answer.' });
      return { finalText: 'Native answer.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-exact',
    }));

    await act(async () => {
      await expect(result.current.requestMainText('  Normal human message.  '))
        .resolves.toBe('Native answer.');
    });

    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: '  Normal human message.  ' },
      { role: 'assistant', text: 'Native answer.' },
    ]);
  });

  it('keys transcript state by conversation and never shows A while B loads', async () => {
    type LoadedHistory = {
      runtimeSessionId: string;
      nativeSessionId: string;
      messages: Array<{ role: 'assistant' | 'user'; text: string }>;
      terminalEvents: Array<Record<string, unknown>>;
    };
    let resolveA!: (history: LoadedHistory) => void;
    let resolveB!: (history: LoadedHistory) => void;
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockImplementation(({ conversationId }) => new Promise((resolve) => {
      if (conversationId === 'conversation-a') resolveA = resolve;
      if (conversationId === 'conversation-b') resolveB = resolve;
    }));
    const { result, rerender } = renderHook(
      ({ conversationId }) => useAgentBuilderMainChat({
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
      resolveA({ runtimeSessionId: 'runtime-a', nativeSessionId: 'native-a', messages: [
        { role: 'user', text: 'A user' },
        { role: 'assistant', text: 'A model' },
      ], terminalEvents: [] });
      await Promise.resolve();
    });
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'A user' },
      { role: 'assistant', text: 'A model' },
    ]);

    rerender({ conversationId: 'conversation-b' });
    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionHistoryLoading).toBe(true);

    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-b' }),
    ));
    await act(async () => {
      resolveB({
        runtimeSessionId: 'runtime-b', nativeSessionId: 'native-b',
        messages: [{ role: 'user', text: 'B user' }], terminalEvents: [],
      });
      await Promise.resolve();
    });
    expect(result.current.messages).toEqual([{ role: 'user', text: 'B user' }]);
  });

  it('keeps native failures outside the transcript', async () => {
    const onUserTurnStarted = vi.fn();
    const onTurnFinished = vi.fn();
    mocks.streamSession.mockRejectedValue(new SessionStreamError({
      code: 'harness_turn_failed',
      message: 'provider failed',
      correlationId: 'req_failure',
    }));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-failure',
      onUserTurnStarted, onTurnFinished,
    }));

    await act(async () => {
      await expect(result.current.requestMainText('Normal user message.')).rejects.toThrow();
    });

    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Normal user message.' },
    ]);
    expect(result.current.messages[0]).toMatchObject({ status: 'error', target: { label: 'Main' } });
    expect(result.current.nativeSessionActive).toBe(false);
    expect(onUserTurnStarted).not.toHaveBeenCalled();
    expect(onTurnFinished).not.toHaveBeenCalled();
  });

  it('rejects a different Run in the same stream instead of merging its activity', async () => {
    const onNativeTurnEvent = vi.fn();
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', runId: 'native-run' });
      onEvent({ kind: 'tool_result', runId: 'another-run', output: 'another Run output' });
      return { finalText: 'must not complete' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({ canvasProjectId: 'project-1',
      deckId: 'deck_builder', conversationId: 'main', onNativeTurnEvent }));
    await act(async () => { await expect(result.current.requestMainText('Question')).rejects.toThrow('Run identity changed'); });
    expect(onNativeTurnEvent).toHaveBeenCalledTimes(1);
    expect(result.current.technicalError).toBe('main_run_identity_mismatch');
    expect(messageText(result.current.messages)).toEqual([{ role: 'user', text: 'Question' }]);
    expect(result.current.messages[0]).toMatchObject({ status: 'error' });
  });

  it('removes an unfinished assistant stream when the native turn fails', async () => {
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', sessionId: 'native-session' });
      onEvent({ kind: 'text', text: 'Unfinished native text' });
      throw new SessionStreamError({
        code: 'harness_turn_failed',
        message: 'provider failed',
        correlationId: 'req_partial_failure',
      });
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
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

  it('clears the native active state when the backend reports no active turn', async () => {
    mocks.streamSession.mockImplementation(({ signal, onEvent }) => new Promise((_resolve, reject) => {
      onEvent({ kind: 'session', sessionId: 'native-session', runId: 'native-run' });
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      });
    }));
    mocks.stopSession.mockRejectedValue(new SessionStreamError({
      code: 'no_active_turn',
      message: 'no active turn',
    }));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-stale-working',
    }));

    let request!: Promise<string>;
    await act(async () => {
      request = result.current.requestMainText('Normal user message.');
      await Promise.resolve();
    });
    expect(result.current.nativeSessionActive).toBe(true);

    await act(async () => {
      await result.current.stopMainTurn();
      await request.catch(() => undefined);
    });
    expect(result.current.nativeSessionActive).toBe(false);
    expect(messageText(result.current.messages)).toEqual([
      { role: 'user', text: 'Normal user message.' },
    ]);
  });
});
