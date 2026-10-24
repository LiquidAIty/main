/**
 * Entity: Main Chat
 * Relationship: This file verifies partial-answer retention on failure and one Main submission for each distinct voice transcript.
 * Entity: Agent Messaging
 * Relationship: This file verifies exact @Card admission against the current Project roster and synchronous refusal of an unknown address.
 * Entity: Card Invocation
 * Relationship: This file verifies streamed partial text remains visible when the same invocation later fails.
 */

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientMocks = vi.hoisted(() => ({
  loadSessionHistory: vi.fn(),
  stopSession: vi.fn(),
  stopVoiceCapture: vi.fn(),
  streamSession: vi.fn(),
  streamVoiceCapture: vi.fn(),
}));

vi.mock('./mainSessionClient', async () => {
  const actual = await vi.importActual<typeof import('./mainSessionClient')>('./mainSessionClient');
  return { ...actual, ...clientMocks };
});

import { SessionStreamError, type AddressableAgent } from './mainSessionClient';
import useAgentBuilderMainChat, { requestedParticipant } from './useAgentBuilderMainChat';

const BUILDER: AddressableAgent = {
  cardId: 'card_builder',
  cardRevisionId: 'revision-builder',
  profile: 'builder',
  title: 'Builder',
  address: 'Builder',
};

function history() {
  return {
    mainCardId: 'card_main',
    addressableAgents: [BUILDER],
    messages: [],
  };
}

beforeEach(() => {
  let identity = 0;
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => {
      identity += 1;
      return `00000000-0000-4000-8000-${String(identity).padStart(12, '0')}`;
    }),
  });
  clientMocks.loadSessionHistory.mockReset().mockResolvedValue(history());
  clientMocks.stopSession.mockReset().mockResolvedValue({ runId: 'run-1', state: 'stopping' });
  clientMocks.stopVoiceCapture.mockReset().mockResolvedValue(undefined);
  clientMocks.streamSession.mockReset().mockResolvedValue({ finalText: 'Done' });
  clientMocks.streamVoiceCapture.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Main saved-Card addressing', () => {
  it('admits only an exact address from the current Project roster', () => {
    expect(requestedParticipant('@Builder do this', 'card_main', [BUILDER]))
      .toMatchObject({ cardId: 'card_builder', profile: 'builder' });
    expect(requestedParticipant('answer directly', 'card_main', [BUILDER]))
      .toMatchObject({ cardId: 'card_main', label: 'Main' });
    expect(() => requestedParticipant('@Trader compare these', 'card_main', [BUILDER]))
      .toThrow('main_address_not_authorized:trader');
  });

  it('rejects an unknown @Card synchronously without consuming the draft', async () => {
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-a',
      deckId: 'deck_builder',
      deckRevision: 'revision-1',
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

    let accepted = true;
    act(() => { accepted = result.current.handleSend('@Trader compare these'); });

    expect(accepted).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(result.current.technicalError).toBe('main_address_not_authorized:trader');
    expect(clientMocks.streamSession).not.toHaveBeenCalled();
  });
});

describe('Main stream retention and voice finality', () => {
  it('stops the exact observed Run and aborts the local stream only after server acknowledgement', async () => {
    let releaseStop!: () => void;
    const stopAcknowledged = new Promise<void>((resolve) => { releaseStop = resolve; });
    clientMocks.stopSession.mockImplementationOnce(async () => {
      await stopAcknowledged;
      return { runId: 'run-stop', state: 'stopping' };
    });
    const observed = { signal: null as AbortSignal | null };
    clientMocks.streamSession.mockImplementationOnce(async ({ signal, onEvent }) => {
      observed.signal = signal;
      onEvent({ kind: 'run', runId: 'run-stop' });
      onEvent({ kind: 'session', runId: 'run-stop' });
      return new Promise<{ finalText: string }>((resolve) => {
        signal.addEventListener('abort', () => resolve({ finalText: '' }), { once: true });
      });
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-a', deckId: 'deck_builder',
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));
    act(() => { result.current.handleSend('Stop this exact Run.'); });
    await waitFor(() => expect(result.current.sessionActive).toBe(true));

    let stopping!: Promise<void>;
    act(() => { stopping = result.current.stopMainTurn(); });
    await waitFor(() => expect(clientMocks.stopSession).toHaveBeenCalledWith({
      projectId: 'project-a', deckId: 'deck_builder', expectedRunId: 'run-stop',
    }));
    expect(observed.signal?.aborted).toBe(false);

    await act(async () => {
      releaseStop();
      await stopping;
    });
    expect(observed.signal?.aborted).toBe(true);
    expect(result.current.sessionActive).toBe(false);
  });

  it('keeps a steering message visible before the one combined active-Run answer', async () => {
    const onMainRunCompleted = vi.fn();
    let finishFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { finishFirst = resolve; });
    clientMocks.streamSession
      .mockImplementationOnce(async ({ onEvent }) => {
        onEvent({ kind: 'run', runId: 'run-one' });
        onEvent({ kind: 'session', runId: 'run-one' });
        onEvent({ kind: 'text', runId: 'run-one', text: 'Working comparison' });
        await firstMayFinish;
        return { finalText: 'Combined comparison' };
      })
      .mockImplementationOnce(async ({ onEvent }) => {
        onEvent({ kind: 'run', runId: 'run-one' });
        return { finalText: '' };
      });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-a',
      deckId: 'deck_builder',
      onMainRunCompleted,
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

    act(() => { result.current.handleSend('Compare buy and hold.'); });
    await waitFor(() => expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', text: 'Working comparison' }),
    ])));
    act(() => { result.current.handleSend('Also separate options timing.'); });
    await waitFor(() => expect(clientMocks.streamSession).toHaveBeenCalledTimes(2));
    expect(result.current.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'Compare buy and hold.'],
      ['user', 'Also separate options timing.'],
      ['assistant', 'Working comparison'],
    ]);

    await act(async () => { finishFirst(); await firstMayFinish; });
    await waitFor(() => expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant', text: 'Combined comparison', status: 'complete',
    }));
    await waitFor(() => expect(onMainRunCompleted).toHaveBeenCalledWith('run-one'));
    expect(onMainRunCompleted).toHaveBeenCalledTimes(1);
    expect(result.current.technicalError).toBeNull();
  });

  it('keeps streamed assistant text when the turn later fails', async () => {
    clientMocks.streamSession.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({ kind: 'run', runId: 'run-1' });
      onEvent({ kind: 'session', runId: 'run-1' });
      onEvent({ kind: 'text', runId: 'run-1', text: 'Useful partial answer' });
      throw new SessionStreamError({
        code: 'provider_failed',
        message: 'provider_failed',
      });
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-a',
      deckId: 'deck_builder',
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

    let failure: unknown = null;
    await act(async () => {
      try {
        await result.current.requestMainText('question');
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeInstanceOf(SessionStreamError);
    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        text: 'Useful partial answer',
        status: 'error',
      }),
    ]));
    expect(result.current.technicalError).toBe('provider_failed');
  });

  it('requests graph refresh after an exact addressed Card completion without waiting for Main capture', async () => {
    const onMainRunCompleted = vi.fn();
    clientMocks.streamSession.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({ kind: 'run', runId: 'run-builder' });
      onEvent({
        kind: 'done',
        runId: 'run-builder',
        participant: {
          kind: 'card', label: 'Builder', cardId: 'card_builder', profile: 'builder',
        },
        fullText: 'Builder result',
        linkedEvidenceIds: ['know-one'],
      });
      return { finalText: 'Builder result' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-a',
      deckId: 'deck_builder',
      onMainRunCompleted,
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

    await act(async () => {
      await result.current.requestMainText('@Builder research this.');
    });

    await waitFor(() => expect(onMainRunCompleted).toHaveBeenCalledWith('run-builder', false));
    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        text: 'Builder result',
        linkedEvidenceIds: ['know-one'],
      }),
    ]));
  });

  it('submits a voice transcript without requiring a non-existent final flag', async () => {
    clientMocks.streamVoiceCapture.mockImplementationOnce(async ({ onEvent }) => {
      const transcript = {
        kind: 'transcript' as const,
        event: { payload: { text: 'voice question' } },
      };
      onEvent(transcript);
      onEvent(transcript);
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-a',
      deckId: 'deck_builder',
    }));
    await waitFor(() => expect(result.current.sessionHistoryLoading).toBe(false));

    act(() => { result.current.startVoiceSession(); });
    await waitFor(() => expect(clientMocks.streamSession).toHaveBeenCalledTimes(1));
    expect(clientMocks.streamSession.mock.calls[0]?.[0]?.message).toBe('voice question');
  });
});
