import { useCallback, useEffect, useRef, useState } from 'react';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
import type { GraphProjectionV1 } from '../../../components/knowledge/KnowledgeAuthorityGraphSurface';
import {
  loadSessionHistory,
  type AddressableAgent,
  type DirectChatTarget,
  type GraphRecordIdentity,
  type HermesSessionEvent,
  type MainHermesSessionEvent,
  SessionStreamError,
  type SharedChatMessage,
  type SharedChatParticipant,
  stopVoiceCapture,
  streamVoiceCapture,
  subscribeSessionEvents,
  stopSession,
  streamSession,
} from './mainSessionClient';

export type AgentBuilderChatMessage = SharedChatMessage & { status?: 'pending' | 'complete' | 'error' };

export type MainChatVoicePhase = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export type MainChatRunInput = { images?: Array<Record<string, unknown>> };
// Matches the Hermes turn-image attachment count limit.
export const MAX_MAIN_CHAT_IMAGES = 12;

type MainChatRuntimeEvent = NonNullable<HermesSessionEvent['runtimeEvent']>;

type UseAgentBuilderMainChatArgs = {
  canvasProjectId: string;
  deckId: string;
  conversationId: string;
  directChatTargets?: DirectChatTarget[];
  dataAnchors?: LoadedCardGraphReference['reference'][];
  prepareRunImages?: (targetCardId: string | null) => Promise<Array<Record<string, unknown>>>;
};

export type LoadedCardGraphReference = {
  targetCardId: string;
  sourceCardId?: string;
  sourceRunId?: string;
  reference: GraphRecordIdentity & {
    reason: string;
    order: number;
    boundedExpansion: number;
    resultLimit: number;
    required: boolean;
  };
  resolvedReferences: Array<Record<string, unknown>>;
  resolvedContextMarkdown: string;
  graphProjection: GraphProjectionV1;
  resolved: boolean;
  ready: boolean;
  observedAt?: string;
  error?: string;
};

const SHARED_CHAT_USER: SharedChatParticipant = { kind: 'user', label: 'You' };
const NO_DIRECT_CHAT_TARGETS: DirectChatTarget[] = [];

function participantFromEvent(value: unknown): SharedChatParticipant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const participant = value as Record<string, unknown>;
  if (
    !['user', 'card'].includes(String(participant.kind))
    || typeof participant.label !== 'string'
    || !participant.label
  ) return null;
  return {
    kind: participant.kind as 'user' | 'card',
    label: participant.label,
    ...(typeof participant.cardId === 'string' && participant.cardId
      ? { cardId: participant.cardId } : {}),
    ...(typeof participant.profile === 'string' && participant.profile
      ? { profile: participant.profile } : {}),
    ...(typeof participant.address === 'string' && participant.address
      ? { address: participant.address } : {}),
  };
}

type PreparedChatSubmission = {
  key: string;
  text: string;
  userMessageId: string;
  assistantMessageId: string;
  targetCardId: string | null;
  participant: SharedChatParticipant;
  runInput?: MainChatRunInput;
};

function participantForTarget(target: DirectChatTarget): SharedChatParticipant {
  return {
    kind: 'card',
    label: target.title,
    cardId: target.cardId,
    profile: target.profile,
    ...(target.address ? { address: target.address } : {}),
  };
}

function uniqueCardTarget(
  targets: DirectChatTarget[],
  cardId: string | null,
): DirectChatTarget | null {
  if (!cardId) return null;
  const matches = targets.filter((target) => target.cardId === cardId);
  return matches.length === 1 ? matches[0] : null;
}

function prepareChatSubmission({
  conversationKey,
  text,
  mainCardId,
  currentResponderCardId,
  targets,
}: {
  conversationKey: string;
  text: string;
  mainCardId: string;
  currentResponderCardId: string | null;
  targets: DirectChatTarget[];
}): PreparedChatSubmission & { nextResponderCardId?: string | null } {
  const userMessageId = `msg_${globalThis.crypto.randomUUID()}`;
  const assistantMessageId = `msg_${globalThis.crypto.randomUUID()}`;
  const mainTarget = uniqueCardTarget(targets, mainCardId);
  const mainParticipant = mainTarget
    ? participantForTarget(mainTarget)
    : { kind: 'card' as const, label: 'Main', ...(mainCardId ? { cardId: mainCardId } : {}) };
  const selectedTarget = uniqueCardTarget(targets, currentResponderCardId);
  const fallbackTargetCardId = selectedTarget && selectedTarget.cardId !== mainCardId
    ? selectedTarget.cardId
    : null;
  const addressMatch = /^\s*@([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/i.exec(text);
  if (!addressMatch) {
    return {
      key: conversationKey,
      text,
      userMessageId,
      assistantMessageId,
      targetCardId: fallbackTargetCardId,
      participant: selectedTarget ? participantForTarget(selectedTarget) : mainParticipant,
    };
  }
  const address = addressMatch[1].toLowerCase();
  const matches = targets.filter((target) => (
    target.aliases.some((alias) => alias.toLowerCase() === address)
  ));
  if (matches.length !== 1) {
    return {
      key: conversationKey,
      text,
      userMessageId,
      assistantMessageId,
      targetCardId: fallbackTargetCardId,
      participant: { kind: 'card', label: `@${address}`, address },
    };
  }
  const target = matches[0];
  const targetsMain = target.cardId === mainCardId;
  return {
    key: conversationKey,
    text,
    userMessageId,
    assistantMessageId,
    targetCardId: targetsMain ? null : target.cardId,
    participant: participantForTarget(target),
    nextResponderCardId: targetsMain ? null : target.cardId,
  };
}

function messageIndex(messages: AgentBuilderChatMessage[], messageId: string): number {
  return messages.findIndex((message) => message.messageId === messageId);
}

function reconcileHistory(
  persisted: AgentBuilderChatMessage[],
  visible: AgentBuilderChatMessage[],
): AgentBuilderChatMessage[] {
  const persistedIds = new Set(persisted.flatMap((message) => message.messageId ? [message.messageId] : []));
  return [
    ...persisted,
    ...visible.filter((message) => !message.messageId || !persistedIds.has(message.messageId)),
  ];
}

export default function useAgentBuilderMainChat({
  canvasProjectId,
  deckId,
  conversationId,
  directChatTargets = NO_DIRECT_CHAT_TARGETS,
  dataAnchors = [],
  prepareRunImages,
}: UseAgentBuilderMainChatArgs) {
  const conversationKey = `${canvasProjectId}\u0000${conversationId}`;
  const [technical, setTechnical] = useState<{
    key: string;
    events: MainChatRuntimeEvent[];
    error: string | null;
  }>({
    key: conversationKey, events: [], error: null,
  });
  const [transcript, setTranscript] = useState<{
    key: string;
    messages: AgentBuilderChatMessage[];
  }>({ key: conversationKey, messages: [] });
  const [historyState, setHistoryState] = useState<{
    key: string;
    loading: boolean;
  }>({ key: conversationKey, loading: Boolean(canvasProjectId) });
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
  const sessionEventsRef = useRef<{
    key: string;
    runtimeSessionId: string;
    hermesSessionId: string;
    close: () => void;
  } | null>(null);
  const observedProjectionIdsRef = useRef<{ key: string; ids: Set<string> }>({
    key: conversationKey,
    ids: new Set(),
  });
  const [responderState, setResponderState] = useState<{
    key: string;
    cardId: string | null;
  }>({ key: conversationKey, cardId: null });
  const responderRef = useRef<{ key: string; cardId: string | null }>({
    key: conversationKey,
    cardId: null,
  });
  const activeVoiceRef = useRef<{
    key: string;
    controller: AbortController;
    targetCardId: string | null;
    participant: SharedChatParticipant;
    hasTranscript: boolean;
    turnFinished: boolean;
    sawSpeaking: boolean;
    speechIdle: boolean;
    tts: boolean;
    audioAvailable: boolean | null;
  } | null>(null);
  const [voiceState, setVoiceState] = useState<{
    key: string;
    phase: MainChatVoicePhase;
    error: string | null;
  }>({ key: conversationKey, phase: 'idle', error: null });

  const messages = transcript.key === conversationKey ? transcript.messages : [];
  const sessionActive = turnState.key === conversationKey && turnState.phase === 'active';
  const sessionConnecting = turnState.key === conversationKey
    && turnState.phase === 'connecting';
  const sessionPending = sessionActive || sessionConnecting;
  const sessionHistoryLoading = historyState.key === conversationKey && historyState.loading;
  const [sharedAuthority, setSharedAuthority] = useState<{
    key: string;
    mainCardId: string;
    agents: AddressableAgent[];
  }>({ key: conversationKey, mainCardId: '', agents: [] });
  const addressableAgents = sharedAuthority.key === conversationKey ? sharedAuthority.agents : [];
  const mainCardId = sharedAuthority.key === conversationKey ? sharedAuthority.mainCardId : '';
  const selectedResponderTarget = uniqueCardTarget(
    directChatTargets,
    responderState.key === conversationKey ? responderState.cardId : null,
  );
  const mainResponderTarget = uniqueCardTarget(directChatTargets, mainCardId);
  const currentResponder: SharedChatParticipant = selectedResponderTarget
    ? participantForTarget(selectedResponderTarget)
    : mainResponderTarget
      ? participantForTarget(mainResponderTarget)
      : { kind: 'card', label: 'Main', ...(mainCardId ? { cardId: mainCardId } : {}) };

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

  const prepareSubmission = useCallback((text: string, runInput?: MainChatRunInput): PreparedChatSubmission => {
    const prepared = prepareChatSubmission({
      conversationKey,
      text,
      mainCardId,
      currentResponderCardId: responderRef.current.key === conversationKey
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
      ...(runInput?.images?.length ? { runInput: { images: structuredClone(runInput.images) } } : {}),
    };
  }, [conversationKey, directChatTargets, mainCardId, setCurrentResponderCardId]);

  const subscribeToHermesSession = useCallback((runtimeSessionId: string, hermesSessionId: string) => {
    if (!canvasProjectId || !runtimeSessionId || !hermesSessionId) return;
    const existing = sessionEventsRef.current;
    if (
      existing?.key === conversationKey
      && existing.runtimeSessionId === runtimeSessionId
      && existing.hermesSessionId === hermesSessionId
    ) return;
    existing?.close();
    const close = subscribeSessionEvents({
      projectId: canvasProjectId,
      deckId,
      conversationId,
      runtimeSessionId,
      hermesSessionId,
      onEvent: ({ event }: MainHermesSessionEvent) => {
        if (event.type === 'message.complete') {
          const status = String(event.payload?.status || 'complete');
          const text = String(event.payload?.text || '');
          if (status === 'error' || status === 'failed') {
            setTechnical((current) => current.key === conversationKey
              ? { ...current, error: String(event.payload?.error || text || 'main_hermes_turn_failed') }
              : current);
          }
          // A completion arriving outside the request-owned SSE is Main
          // session traffic (for example a Bot notification), not a shared-chat
          // speaker turn. Never make Main appear to speak for another Card.
          return;
        } else if (event.type === 'error') {
          setTechnical((current) => current.key === conversationKey
            ? { ...current, error: String(event.payload?.message || 'main_hermes_turn_failed') }
            : current);
        }
      },
      onError: (error) => {
        setTechnical((current) => current.key === conversationKey
          ? { ...current, error }
          : current);
      },
    });
    sessionEventsRef.current = { key: conversationKey, runtimeSessionId, hermesSessionId, close };
  }, [canvasProjectId, conversationId, conversationKey, deckId]);

  useEffect(() => {
    const projectId = canvasProjectId;
    const priorStream = activeStreamRef.current;
    if (priorStream && priorStream.key !== conversationKey) {
      priorStream.controller.abort();
      activeStreamRef.current = null;
    }
    const priorSessionEvents = sessionEventsRef.current;
    if (priorSessionEvents && priorSessionEvents.key !== conversationKey) {
      priorSessionEvents.close();
      sessionEventsRef.current = null;
    }
    setTranscript({ key: conversationKey, messages: [] });
    setSharedAuthority({ key: conversationKey, mainCardId: '', agents: [] });
    setTechnical({ key: conversationKey, events: [], error: null });
    observedProjectionIdsRef.current = { key: conversationKey, ids: new Set() };
    responderRef.current = { key: conversationKey, cardId: null };
    setResponderState({ key: conversationKey, cardId: null });
    setTurnState({ key: conversationKey, phase: 'idle' });

    if (!projectId) {
      setHistoryState({ key: conversationKey, loading: false });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setHistoryState({ key: conversationKey, loading: true });
    waitForBackendReady({ signal: controller.signal })
      .then((ready) => {
        if (cancelled) return;
        if (!ready) {
          throw new SessionStreamError({
            code: 'backend_not_ready',
            message: 'The backend did not become ready in time.',
            route: '/api/health',
          });
        }
        return loadSessionHistory({
          projectId,
          deckId,
          conversationId,
          signal: controller.signal,
        });
      })
      .then((history) => {
        if (cancelled || !history) return;
        setTranscript((current) => ({
          key: conversationKey,
          messages: reconcileHistory(
            history.messages,
            current.key === conversationKey ? current.messages : [],
          ),
        }));
        setSharedAuthority({
          key: conversationKey,
          mainCardId: history.mainCardId,
          agents: history.addressableAgents,
        });
        subscribeToHermesSession(history.runtimeSessionId, history.hermesSessionId);
        setTechnical({
          key: conversationKey,
          events: history.runtimeEvents,
          error: null,
        });
        observedProjectionIdsRef.current = {
          key: conversationKey,
          ids: new Set(history.runtimeEvents.map((event) => event.id)),
        };
        setHistoryState({ key: conversationKey, loading: false });
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
        setHistoryState({ key: conversationKey, loading: false });
        setTechnical((current) => current.key === conversationKey
          ? { ...current, error: current.error || 'Conversation unavailable. Reload to retry.' } : current);
      })

    return () => {
      cancelled = true;
      controller.abort();
      if (sessionEventsRef.current?.key === conversationKey) {
        sessionEventsRef.current.close();
        sessionEventsRef.current = null;
      }
    };
  }, [canvasProjectId, conversationId, conversationKey, deckId, subscribeToHermesSession]);

  const requestPreparedText = useCallback(
    async (submission: PreparedChatSubmission): Promise<string> => {
      const { text, targetCardId, userMessageId, assistantMessageId } = submission;
      if (!text.trim()) throw new Error('main_prompt_empty');
      if (submission.key !== conversationKey) throw new Error('main_conversation_changed');
      if (!canvasProjectId) {
        setTurnState({ key: conversationKey, phase: 'idle' });
        throw new Error('main_project_required');
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
      setTechnical({ key: conversationKey, events: [], error: null });
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
            images.push(...preparedImages.slice(0, Math.max(0, MAX_MAIN_CHAT_IMAGES - images.length)));
          } catch {
            // Surface perception is additive. A stale/unmounted viewport must
            // never turn an otherwise valid shared-chat message into a failed turn.
          }
        }
        const { finalText } = await streamSession({
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
            const projection = event.projection;
            const runtimeEvent = event.runtimeEvent;
            const observedRunId = typeof event.runId === 'string' ? event.runId : runtimeEvent?.runId;
            if ((event.projectId && event.projectId !== canvasProjectId)
              || (event.deckId && event.deckId !== deckId)
              || (event.conversationId && event.conversationId !== conversationId)
              || (runtimeEvent && (runtimeEvent.projectId !== canvasProjectId || runtimeEvent.deckId !== deckId))
              || (observedRunId && runId && observedRunId !== runId)
              || (runtimeEvent && observedRunId && runtimeEvent.runId !== observedRunId)) {
              throw new SessionStreamError({ code: 'main_run_identity_mismatch', message: 'Main stream Run identity changed.' });
            }
            if (projection?.id) {
              const observed = observedProjectionIdsRef.current;
              if (observed.key !== conversationKey) {
                observedProjectionIdsRef.current = { key: conversationKey, ids: new Set() };
              } else if (observed.ids.has(projection.id)) {
                return;
              }
              observedProjectionIdsRef.current.ids.add(projection.id);
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
                if (userIndex >= 0) copy[userIndex] = { ...copy[userIndex], target: observedParticipant };
                return { key: conversationKey, messages: copy };
              });
            }
            // UI pending state is local; graph/Run identity is issued only by
            // the canonical backend Run, never a second browser-generated ID.
            if (observedRunId && !runId) {
              runId = observedRunId;
              if (activeStreamRef.current?.controller === streamController) {
                activeStreamRef.current.runId = runId;
              }
            }
            if (runtimeEvent?.projectId === canvasProjectId && runtimeEvent.deckId === deckId
              && runtimeEvent.cardId && runtimeEvent.runId && runtimeEvent.id
              && runtimeEvent.category?.startsWith('execution.')) {
              setTechnical((current) => {
                if (current.key !== conversationKey
                  || current.events.some((item) => item.id === runtimeEvent.id)) return current;
                return { ...current, events: [...current.events, runtimeEvent] };
              });
            }
            if (event.kind === 'session' || event.kind === 'text'
              || projection?.category === 'conversation.answer') {
              setTurnState((current) => current.key === conversationKey
                ? { ...current, phase: 'active' }
                : current);
            }
            if (event.kind === 'session') {
              if (event.directAddressed !== true) {
                subscribeToHermesSession(
                  String(event.runtimeSessionId || ''),
                  String(event.hermesSessionId || ''),
                );
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
            if (projection?.category === 'conversation.answer' && projection.status === 'completed') {
              finalizeModelText(projection.text || '');
            } else if (projection?.category === 'conversation.answer') {
              appendModelText(projection.text || '');
            } else if (event.kind === 'text') {
              appendModelText(
                String((event as { text?: unknown }).text || ''),
              );
            }
          },
        });
        const completedText = finalText;
        if (!completedText.trim()) {
          setTurnState({ key: conversationKey, phase: 'idle' });
          throw new Error('main_empty_response');
        }
        // The completion text is the exact persisted Hermes assistant
        // message. Replace the in-progress streamed bubble with those bytes so
        // the completed UI and a later history read are identical.
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
          error: error instanceof SessionStreamError ? error.code : 'main_turn_failed',
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
      subscribeToHermesSession,
    ],
  );

  const requestMainText = useCallback(
    (text: string, runInput?: MainChatRunInput): Promise<string> => requestPreparedText(prepareSubmission(text, runInput)),
    [prepareSubmission, requestPreparedText],
  );

  const handleSend = useCallback(
    (text: string, runInput?: MainChatRunInput) => {
      if (!text.trim()) return;
      const submission = prepareSubmission(text, runInput);
      void requestPreparedText(submission).catch(() => {
        // Transport failure remains visible telemetry and never assistant speech.
      });
    },
    [prepareSubmission, requestPreparedText],
  );

  const endVoiceSession = useCallback(async (
    nextPhase: MainChatVoicePhase = 'idle',
    error: string | null = null,
  ) => {
    const active = activeVoiceRef.current;
    if (!active || active.key !== conversationKey) {
      setVoiceState({ key: conversationKey, phase: nextPhase, error });
      return;
    }
    activeVoiceRef.current = null;
    active.controller.abort();
    setVoiceState({ key: conversationKey, phase: nextPhase, error });
    if (!canvasProjectId) return;
    await stopVoiceCapture({
      projectId: canvasProjectId,
      deckId,
      conversationId,
      ...(active.targetCardId ? { targetCardId: active.targetCardId } : {}),
      cancel: true,
    }).catch(() => undefined);
  }, [canvasProjectId, conversationId, conversationKey, deckId]);

  const startVoiceSession = useCallback(() => {
    if (!canvasProjectId || !mainCardId || sessionHistoryLoading) {
      setVoiceState({
        key: conversationKey,
        phase: 'error',
        error: 'Voice is unavailable until the Project conversation is ready.',
      });
      return;
    }
    if (sessionPending) {
      setVoiceState({
        key: conversationKey,
        phase: 'error',
        error: 'Wait for the current response before starting voice.',
      });
      return;
    }
    if (activeVoiceRef.current?.key === conversationKey) return;

    const targetCardId = responderRef.current.key === conversationKey
      ? responderRef.current.cardId
      : null;
    const target = uniqueCardTarget(directChatTargets, targetCardId);
    const mainTarget = uniqueCardTarget(directChatTargets, mainCardId);
    const participant = target
      ? participantForTarget(target)
      : mainTarget
        ? participantForTarget(mainTarget)
        : { kind: 'card' as const, label: 'Main', cardId: mainCardId };
    const controller = new AbortController();
    const active = {
      key: conversationKey,
      controller,
      targetCardId,
      participant,
      hasTranscript: false,
      turnFinished: false,
      sawSpeaking: false,
      speechIdle: false,
      tts: true,
      audioAvailable: null as boolean | null,
    };
    activeVoiceRef.current = active;
    setVoiceState({ key: conversationKey, phase: 'processing', error: null });

    void streamVoiceCapture({
      projectId: canvasProjectId,
      deckId,
      conversationId,
      ...(targetCardId ? { targetCardId } : {}),
      tts: true,
      signal: controller.signal,
      onEvent: (event) => {
        const current = activeVoiceRef.current;
        if (!current || current.controller !== controller || current.key !== conversationKey) return;
        const expectedCardId = targetCardId || mainCardId;
        if (event.cardId !== expectedCardId) {
          void endVoiceSession('error', 'Voice connected to the wrong Card.');
          return;
        }
        if (event.kind === 'ready') {
          current.tts = event.state?.tts === true;
          current.audioAvailable = typeof event.state?.audioAvailable === 'boolean'
            ? event.state.audioAvailable
            : null;
          setVoiceState({ key: conversationKey, phase: 'listening', error: null });
          return;
        }
        if (event.kind === 'error') {
          void endVoiceSession('error', event.error || 'Voice transport failed.');
          return;
        }
        if (event.kind === 'status') {
          const statusPayload = (event.event?.payload || {}) as Record<string, unknown>;
          const phase = String(statusPayload.state || '').toLowerCase();
          if (phase === 'listening' || phase === 'recording') {
            setVoiceState({ key: conversationKey, phase: 'listening', error: null });
          } else if (phase === 'transcribing' || phase === 'processing') {
            setVoiceState({ key: conversationKey, phase: 'processing', error: null });
          } else if (phase === 'speaking') {
            current.sawSpeaking = true;
            setVoiceState({ key: conversationKey, phase: 'speaking', error: null });
          } else if (phase === 'idle') {
            if (current.sawSpeaking) current.speechIdle = true;
            if (current.hasTranscript && current.turnFinished && current.speechIdle) {
              void endVoiceSession();
            } else if (!current.sawSpeaking) {
              setVoiceState({ key: conversationKey, phase: 'processing', error: null });
            }
          }
          return;
        }
        const payload = (event.event?.payload || {}) as Record<string, unknown>;
        if (payload.stop_phrase === true) {
          void endVoiceSession();
          return;
        }
        if (payload.no_speech_limit === true) {
          void endVoiceSession('error', 'No speech was detected.');
          return;
        }
        const transcriptText = String(payload.text || '').trim();
        if (!transcriptText || current.hasTranscript) return;
        current.hasTranscript = true;
        setVoiceState({ key: conversationKey, phase: 'processing', error: null });
        const submission: PreparedChatSubmission = {
          key: conversationKey,
          text: transcriptText,
          userMessageId: `msg_${globalThis.crypto.randomUUID()}`,
          assistantMessageId: `msg_${globalThis.crypto.randomUUID()}`,
          targetCardId,
          participant,
        };
        void requestPreparedText(submission)
          .then(() => {
            const latest = activeVoiceRef.current;
            if (!latest || latest.controller !== controller) return;
            latest.turnFinished = true;
            if (!latest.tts || latest.audioAvailable === false || latest.speechIdle) {
              void endVoiceSession();
            }
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            void endVoiceSession(
              'error',
              error instanceof Error ? error.message : 'Voice turn failed.',
            );
          });
      },
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      void endVoiceSession(
        'error',
        error instanceof Error ? error.message : 'Voice transport failed.',
      );
    });
  }, [
    canvasProjectId,
    conversationId,
    conversationKey,
    deckId,
    directChatTargets,
    endVoiceSession,
    mainCardId,
    sessionPending,
    requestPreparedText,
    sessionHistoryLoading,
  ]);

  const stopVoiceSession = useCallback(async () => {
    const active = activeVoiceRef.current;
    if (!active || active.key !== conversationKey || !canvasProjectId) return;
    const phase = voiceState.key === conversationKey ? voiceState.phase : 'idle';
    if (phase === 'listening') {
      setVoiceState({ key: conversationKey, phase: 'processing', error: null });
      try {
        await stopVoiceCapture({
          projectId: canvasProjectId,
          deckId,
          conversationId,
          ...(active.targetCardId ? { targetCardId: active.targetCardId } : {}),
          cancel: false,
        });
      } catch (error) {
        await endVoiceSession(
          'error',
          error instanceof Error ? error.message : 'Voice stop failed.',
        );
      }
      return;
    }
    await endVoiceSession();
  }, [
    canvasProjectId,
    conversationId,
    conversationKey,
    deckId,
    endVoiceSession,
    voiceState.key,
    voiceState.phase,
  ]);

  const selectedVoiceTargetCardId = selectedResponderTarget?.cardId || null;
  useEffect(() => {
    const active = activeVoiceRef.current;
    if (!active || active.key !== conversationKey) return;
    if (active.targetCardId !== selectedVoiceTargetCardId) void endVoiceSession();
  }, [conversationKey, endVoiceSession, selectedVoiceTargetCardId]);

  useEffect(() => () => {
    const active = activeVoiceRef.current;
    if (!active || active.key !== conversationKey) return;
    activeVoiceRef.current = null;
    active.controller.abort();
    if (canvasProjectId) {
      void stopVoiceCapture({
        projectId: canvasProjectId,
        deckId,
        conversationId,
        ...(active.targetCardId ? { targetCardId: active.targetCardId } : {}),
        cancel: true,
      }).catch(() => undefined);
    }
  }, [canvasProjectId, conversationId, conversationKey, deckId]);

  const stopMainTurn = useCallback(async () => {
    if (!sessionPending || !canvasProjectId) return;
    const active = activeStreamRef.current;
    const expectedRunId = active?.key === conversationKey ? active.runId : null;
    const expectedCardId = active?.key === conversationKey ? active.cardId : null;
    if (!expectedRunId) {
      throw new SessionStreamError({
        code: 'expected_run_id_required',
        message: 'The accepted Main Run identity is not available yet.',
        route: '/api/main/session/stop',
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
      setTurnState({ key: conversationKey, phase: 'idle' });
      throw error;
    }
  }, [canvasProjectId, conversationId, conversationKey, deckId, sessionPending]);

  return {
    runtimeEvents: technical.key === conversationKey ? technical.events : [],
    technicalError: technical.key === conversationKey ? technical.error : null,
    handleSend,
    messages,
    addressableAgents,
    currentResponder,
    currentResponderCardId: selectedResponderTarget?.cardId || null,
    setCurrentResponderCardId,
    sessionActive,
    sessionConnecting,
    sessionHistoryLoading,
    requestMainText,
    startVoiceSession,
    stopMainTurn,
    stopVoiceSession,
    voiceError: voiceState.key === conversationKey ? voiceState.error : null,
    voicePhase: voiceState.key === conversationKey ? voiceState.phase : 'idle',
  };
}
