/**
 * Entity: Main Chat
 * Relationship: These tests prove exact @Card admission, partial-answer retention on failure, and one Main submission for each final Hermes voice transcript.
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

  it('submits a Hermes voice transcript without requiring a non-existent final flag', async () => {
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
