import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  type DirectChatTarget,
  type GraphRecordIdentity,
  SessionStreamError,
  type SharedChatParticipant,
  stopSession,
  streamSession,
} from './sharedChatClient';
import useSharedCardVoice from './useSharedCardVoice';
import {
  MAX_SHARED_CARD_CHAT_IMAGES,
  messageIndex,
  participantForTarget,
  participantFromEvent,
  prepareChatSubmission,
  SHARED_CHAT_USER,
  uniqueCardTarget,
  type PreparedChatSubmission,
  type SharedCardRunInput,
} from './sharedChatTranscript';
import type {
  SharedChatTechnicalState,
  SharedChatTranscriptState,
} from './useSharedCardChatHistory';

export type DataAnchorSelection = GraphRecordIdentity & {
  reason: string;
  order: number;
  boundedExpansion: number;
  resultLimit: number;
  required: boolean;
};

export function useSharedCardChatSubmission({
  canvasProjectId,
  deckId,
  conversationId,
  conversationKey,
  directChatTargets,
  dataAnchors,
  prepareRunImages,
  mainCardId,
  sessionHistoryLoading,
  setTechnical,
  setTranscript,
  subscribeToHermesSession,
}: {
  canvasProjectId: string;
  deckId: string;
  conversationId: string;
  conversationKey: string;
  directChatTargets: DirectChatTarget[];
  dataAnchors: DataAnchorSelection[];
  prepareRunImages?: (targetCardId: string | null) => Promise<Array<Record<string, unknown>>>;
  mainCardId: string;
  sessionHistoryLoading: boolean;
  setTechnical: Dispatch<SetStateAction<SharedChatTechnicalState>>;
  setTranscript: Dispatch<SetStateAction<SharedChatTranscriptState>>;
  subscribeToHermesSession: (liveSessionId: string) => void;
}) {
  const [turnState, setTurnState] = useState<{
    key: string;
    phase: 'idle' | 'connecting' | 'active';
  }>({ key: conversationKey, phase: 'idle' });
  const activeStreamRef = useRef<{
    key: string;
    controller: AbortController;
    runId: string | null;
    cardId: string | null;
  } | null>(null);
  const [responderState, setResponderState] = useState<{
    key: string;
    cardId: string | null;
  }>({ key: conversationKey, cardId: null });
  const responderRef = useRef<{ key: string; cardId: string | null }>({
    key: conversationKey,
    cardId: null,
  });
  const sessionActive = turnState.key === conversationKey && turnState.phase === 'active';
  const sessionConnecting = turnState.key === conversationKey
    && turnState.phase === 'connecting';
  const sessionPending = sessionActive || sessionConnecting;
  const selectedResponderTarget = uniqueCardTarget(
    directChatTargets,
    responderState.key === conversationKey ? responderState.cardId : null,
  );

  const setCurrentResponderCardId = useCallback((requestedCardId: string | null): boolean => {
    const requestedMain = !requestedCardId || requestedCardId === mainCardId;
    const matches = requestedMain
      ? []
      : directChatTargets.filter((target) => target.cardId === requestedCardId);
    if (!requestedMain && matches.length !== 1) return false;
    const nextCardId = requestedMain ? null : requestedCardId;
    responderRef.current = { key: conversationKey, cardId: nextCardId };
    setResponderState({ key: conversationKey, cardId: nextCardId });
    return true;
  }, [conversationKey, directChatTargets, mainCardId]);

  useEffect(() => {
    const priorStream = activeStreamRef.current;
    if (priorStream && priorStream.key !== conversationKey) {
      priorStream.controller.abort();
      activeStreamRef.current = null;
    }
    responderRef.current = { key: conversationKey, cardId: null };
    setResponderState({ key: conversationKey, cardId: null });
    setTurnState({ key: conversationKey, phase: 'idle' });
  }, [conversationKey, deckId]);

  const prepareSubmission = useCallback((
    text: string,
    runInput?: SharedCardRunInput,
  ): PreparedChatSubmission => {
    const prepared = prepareChatSubmission({
      conversationKey,
      text,
      mainCardId,
      selectedResponderCardId: responderRef.current.key === conversationKey
        ? responderRef.current.cardId
        : null,
      targets: directChatTargets,
    });
    if (prepared.nextResponderCardId !== undefined) {
      setCurrentResponderCardId(prepared.nextResponderCardId);
    }
    return {
      key: prepared.key,
      text: prepared.text,
      userMessageId: prepared.userMessageId,
      assistantMessageId: prepared.assistantMessageId,
      targetCardId: prepared.targetCardId,
      participant: prepared.participant,
      ...(runInput?.images?.length
        ? { runInput: { images: structuredClone(runInput.images) } }
        : {}),
    };
  }, [conversationKey, directChatTargets, mainCardId, setCurrentResponderCardId]);

  const requestPreparedText = useCallback(
    async (submission: PreparedChatSubmission): Promise<string> => {
      const { text, targetCardId, userMessageId, assistantMessageId } = submission;
      if (!text.trim()) throw new Error('shared_chat_message_empty');
      if (submission.key !== conversationKey) throw new Error('shared_chat_conversation_changed');
      if (!canvasProjectId) {
        setTurnState({ key: conversationKey, phase: 'idle' });
        throw new Error('shared_chat_project_required');
      }
      if (activeStreamRef.current?.key === conversationKey) {
        throw new SessionStreamError({
          code: 'shared_chat_turn_already_active',
          message: 'Wait for the current Card turn to finish before sending another message.',
          route: '/api/shared-chat/turn',
        });
      }

      let turnParticipant = submission.participant;
      setTranscript((current) => ({
        key: conversationKey,
        messages: [
          ...(current.key === conversationKey ? current.messages : []),
          {
            role: 'user',
            messageId: userMessageId,
            text,
            speaker: SHARED_CHAT_USER,
            target: turnParticipant,
            status: 'pending',
          },
        ],
      }));
      let runId: string | null = null;
      setTechnical({ key: conversationKey, error: null });
      const streamController = new AbortController();
      activeStreamRef.current = {
        key: conversationKey,
        controller: streamController,
        runId: null,
        cardId: targetCardId || mainCardId || null,
      };
      setTurnState({ key: conversationKey, phase: 'connecting' });

      const appendModelText = (chunk: string) => {
        if (!chunk) return;
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          const copy = [...current.messages];
          const existingIndex = messageIndex(copy, assistantMessageId);
          const existing = existingIndex >= 0 ? copy[existingIndex] : null;
          if (existing?.role === 'assistant') {
            copy[existingIndex] = {
              ...existing,
              role: 'assistant',
              text: existing.text + chunk,
              speaker: turnParticipant,
              status: 'pending',
            };
          } else {
            copy.push({
              messageId: assistantMessageId,
              role: 'assistant', text: chunk, speaker: turnParticipant, status: 'pending',
            });
          }
          return { key: conversationKey, messages: copy };
        });
      };
      const finalizeModelText = (finalText: string) => {
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          const copy = [...current.messages];
          const existingIndex = messageIndex(copy, assistantMessageId);
          const existing = existingIndex >= 0 ? copy[existingIndex] : null;
          if (existing?.role === 'assistant') {
            copy[existingIndex] = {
              ...existing,
              role: 'assistant', text: finalText, speaker: turnParticipant, status: 'complete',
            };
          } else {
            copy.push({
              messageId: assistantMessageId,
              role: 'assistant', text: finalText, speaker: turnParticipant, status: 'complete',
            });
          }
          return { key: conversationKey, messages: copy };
        });
      };

      try {
        const images: Array<Record<string, unknown>> = [...(submission.runInput?.images || [])];
        if (prepareRunImages) {
          try {
            const preparedImages = await prepareRunImages(targetCardId);
            images.push(...preparedImages.slice(
              0,
              Math.max(0, MAX_SHARED_CARD_CHAT_IMAGES - images.length),
            ));
          } catch {
            // Surface perception is additive. A stale/unmounted viewport must
            // never turn an otherwise valid shared-chat message into a failed turn.
          }
        }
        const { finalText, state } = await streamSession({
          projectId: canvasProjectId,
          deckId,
          conversationId,
          message: text,
          clientMessageId: userMessageId,
          clientReplyMessageId: assistantMessageId,
          ...(targetCardId ? { targetCardId } : {}),
          images,
          dataAnchors: (targetCardId ? [] : dataAnchors).map(({ order, ...anchor }) => ({
            ...anchor,
            priority: order === 0 ? 0 : -order,
          })),
          signal: streamController.signal,
          onEvent: (event) => {
            const observedRunId = typeof event.runId === 'string' ? event.runId : undefined;
            if ((event.projectId && event.projectId !== canvasProjectId)
              || (event.deckId && event.deckId !== deckId)
              || (event.conversationId && event.conversationId !== conversationId)
              || (observedRunId && runId && observedRunId !== runId)) {
              throw new SessionStreamError({
                code: 'shared_chat_run_identity_mismatch',
                message: 'Shared-chat stream Run identity changed.',
              });
            }
            const observedParticipant = participantFromEvent(event.participant);
            if (observedParticipant) {
              turnParticipant = observedParticipant;
              if (activeStreamRef.current?.controller === streamController) {
                activeStreamRef.current.cardId = observedParticipant.cardId || null;
              }
              setTranscript((current) => {
                if (current.key !== conversationKey) return current;
                const copy = [...current.messages];
                const userIndex = messageIndex(copy, userMessageId);
                if (userIndex >= 0) {
                  copy[userIndex] = { ...copy[userIndex], target: observedParticipant };
                }
                return { key: conversationKey, messages: copy };
              });
            }
            if (observedRunId && !runId) {
              runId = observedRunId;
              if (activeStreamRef.current?.controller === streamController) {
                activeStreamRef.current.runId = runId;
              }
            }
            if (
              event.kind === 'run'
              && event.state === 'running'
              && observedRunId
              && observedRunId === runId
            ) {
              setTurnState((current) => current.key === conversationKey
                ? { ...current, phase: 'active' }
                : current);
            }
            if (event.kind === 'session') {
              if (event.directAddressed !== true) {
                subscribeToHermesSession(String(event.liveSessionId || ''));
              }
              const configuration = event.configuration && typeof event.configuration === 'object'
                ? event.configuration as Record<string, unknown>
                : {};
              const unavailable = Array.isArray(configuration.unavailableTools)
                ? configuration.unavailableTools.filter((name): name is string => (
                    typeof name === 'string' && name.length > 0
                  ))
                : [];
              if (unavailable.length > 0) {
                setTechnical((current) => current.key === conversationKey
                  ? { ...current, error: `card_tools_unavailable:${unavailable.join(',')}` }
                  : current);
              }
            }
            if (event.kind === 'text') {
              appendModelText(String((event as { text?: unknown }).text || ''));
            }
          },
        });
        if (state === 'stopped') {
          setTranscript((current) => {
            if (current.key !== conversationKey) return current;
            const messages = current.messages.filter((item) => (
              item.messageId !== assistantMessageId
            ));
            return {
              key: conversationKey,
              messages: messages.map((item) => (
                item.messageId === userMessageId && item.role === 'user'
                  ? { ...item, status: 'complete' as const }
                  : item
              )),
            };
          });
          return '';
        }
        const completedText = finalText;
        if (!completedText.trim()) {
          setTurnState({ key: conversationKey, phase: 'idle' });
          throw new Error('shared_chat_empty_response');
        }
        finalizeModelText(completedText);
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          return {
            key: conversationKey,
            messages: current.messages.map((item) => (
              item.messageId === userMessageId && item.role === 'user' && item.status === 'pending'
                ? { ...item, status: 'complete' as const }
                : item
            )),
          };
        });
        return completedText;
      } catch (error: unknown) {
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          const messages = [...current.messages];
          const assistantIndex = messageIndex(messages, assistantMessageId);
          if (assistantIndex >= 0) messages.splice(assistantIndex, 1);
          const userIndex = messageIndex(messages, userMessageId);
          if (userIndex >= 0) messages[userIndex] = { ...messages[userIndex], status: 'error' };
          return { key: conversationKey, messages };
        });
        setTechnical((current) => current.key === conversationKey ? { ...current,
          error: error instanceof SessionStreamError ? error.code : 'shared_chat_turn_failed',
        } : current);
        throw error;
      } finally {
        if (activeStreamRef.current?.controller === streamController) {
          activeStreamRef.current = null;
          setTurnState((current) => current.key === conversationKey
            ? { ...current, phase: 'idle' }
            : current);
        }
      }
    },
    [
      canvasProjectId,
      conversationId,
      conversationKey,
      dataAnchors,
      deckId,
      mainCardId,
      prepareRunImages,
      setTechnical,
      setTranscript,
      subscribeToHermesSession,
    ],
  );

  const handleSend = useCallback((text: string, runInput?: SharedCardRunInput) => {
    if (!text.trim()) return;
    const submission = prepareSubmission(text, runInput);
    const request = requestPreparedText(submission);
    void request.catch(() => {
      // Transport failure remains visible telemetry and never assistant speech.
    });
    return request;
  }, [prepareSubmission, requestPreparedText]);

  const resolveVoiceTarget = useCallback(() => {
    const targetCardId = responderRef.current.key === conversationKey
      ? responderRef.current.cardId
      : null;
    const target = uniqueCardTarget(directChatTargets, targetCardId);
    const mainTarget = uniqueCardTarget(directChatTargets, mainCardId);
    return {
      targetCardId,
      participant: target
        ? participantForTarget(target)
        : mainTarget
          ? participantForTarget(mainTarget)
          : { kind: 'card' as const, label: 'Main', cardId: mainCardId },
    };
  }, [conversationKey, directChatTargets, mainCardId]);

  const submitVoiceTranscript = useCallback((
    text: string,
    targetCardId: string | null,
    participant: SharedChatParticipant,
  ): Promise<string> => requestPreparedText({
    key: conversationKey,
    text,
    userMessageId: 'msg_' + globalThis.crypto.randomUUID(),
    assistantMessageId: 'msg_' + globalThis.crypto.randomUUID(),
    targetCardId,
    participant,
  }), [conversationKey, requestPreparedText]);

  const {
    startVoiceSession,
    stopVoiceSession,
    voiceError,
    voicePhase,
  } = useSharedCardVoice({
    canvasProjectId,
    deckId,
    conversationId,
    conversationKey,
    mainCardId,
    selectedTargetCardId: selectedResponderTarget?.cardId || null,
    sessionHistoryLoading,
    sessionPending,
    resolveTarget: resolveVoiceTarget,
    submitTranscript: submitVoiceTranscript,
  });

  const stopCurrentCardTurn = useCallback(async () => {
    if (!sessionPending || !canvasProjectId) return;
    const active = activeStreamRef.current;
    const expectedRunId = active?.key === conversationKey ? active.runId : null;
    const expectedCardId = active?.key === conversationKey ? active.cardId : null;
    if (!expectedRunId) {
      throw new SessionStreamError({
        code: 'expected_run_id_required',
        message: 'The accepted Main Run identity is not available yet.',
        route: '/api/shared-chat/stop',
      });
    }
    try {
      await stopSession({
        projectId: canvasProjectId,
        deckId,
        conversationId,
        expectedRunId,
        ...(expectedCardId ? { expectedCardId } : {}),
      });
    } catch (error) {
      if (error instanceof SessionStreamError && error.code === 'no_active_turn') {
        activeStreamRef.current?.controller.abort();
        activeStreamRef.current = null;
        setTurnState({ key: conversationKey, phase: 'idle' });
        return;
      }
      throw error;
    }
  }, [canvasProjectId, conversationId, conversationKey, deckId, sessionPending]);

  return {
    handleSend,
    setCurrentResponderCardId,
    sessionActive,
    sessionConnecting,
    startVoiceSession,
    stopCurrentCardTurn,
    stopVoiceSession,
    voiceError,
    voicePhase,
  };
}
