import { useCallback, useEffect, useRef, useState } from 'react';
import { reconcileTerminalEvents, type CardTerminalEvent } from './CardRunResults';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
import {
  loadSessionHistory,
  type AddressableAgent,
  type MainRunImage,
  SessionStreamError,
  type SharedChatMessage,
  type SharedChatParticipant,
  stopSession,
  streamSession,
} from './mainSessionClient';
import useMainBotVoice from './useMainBotVoice';

export type AgentBuilderChatMessage = SharedChatMessage & { status?: 'pending' | 'complete' | 'error' };

type UseAgentBuilderMainChatArgs = {
  canvasProjectId: string;
  deckId: string;
  conversationId: string;
  dataAnchors?: Array<{
    authority: 'ThinkGraph' | 'KnowGraph' | 'CodeGraph';
    nativeId: string;
    reason: string;
    order: number;
    boundedExpansion: number;
    resultLimit: number;
    required: boolean;
  }>;
};

const SHARED_CHAT_USER: SharedChatParticipant = { kind: 'user', label: 'You' };

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

function requestedParticipant(
  text: string,
  mainCardId: string,
  agents: AddressableAgent[],
): SharedChatParticipant {
  const match = /^\s*@([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/i.exec(text);
  if (!match) return { kind: 'card', label: 'Main', ...(mainCardId ? { cardId: mainCardId } : {}) };
  const address = match[1].toLowerCase();
  const target = agents.find((agent) => agent.aliases.includes(address));
  return target ? {
    kind: 'card',
    label: target.title,
    cardId: target.cardId,
    profile: target.profile,
    address: target.address,
  } : { kind: 'card', label: `@${address}`, address };
}

function lastUserMessageIndex(messages: AgentBuilderChatMessage[], text: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && messages[index].text === text) return index;
  }
  return -1;
}

export default function useAgentBuilderMainChat({
  canvasProjectId,
  deckId,
  conversationId,
  dataAnchors = [],
}: UseAgentBuilderMainChatArgs) {
  const conversationKey = `${canvasProjectId}\u0000${conversationId}`;
  const [technical, setTechnical] = useState<{ key: string; events: CardTerminalEvent[]; error: string | null }>({
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
  const observedProjectionIdsRef = useRef<{ key: string; ids: Set<string> }>({
    key: conversationKey,
    ids: new Set(),
  });

  const messages = transcript.key === conversationKey ? transcript.messages : [];
  const nativeSessionActive = turnState.key === conversationKey && turnState.phase === 'active';
  const nativeSessionConnecting = turnState.key === conversationKey
    && turnState.phase === 'connecting';
  const nativeSessionPending = nativeSessionActive || nativeSessionConnecting;
  const sessionHistoryLoading = historyState.key === conversationKey && historyState.loading;
  const [sharedAuthority, setSharedAuthority] = useState<{
    key: string;
    mainCardId: string;
    agents: AddressableAgent[];
  }>({ key: conversationKey, mainCardId: '', agents: [] });
  const addressableAgents = sharedAuthority.key === conversationKey ? sharedAuthority.agents : [];
  const mainCardId = sharedAuthority.key === conversationKey ? sharedAuthority.mainCardId : '';

  useEffect(() => {
    const projectId = canvasProjectId;
    const priorStream = activeStreamRef.current;
    if (priorStream && priorStream.key !== conversationKey) {
      priorStream.controller.abort();
      activeStreamRef.current = null;
    }
    setTranscript({ key: conversationKey, messages: [] });
    setSharedAuthority({ key: conversationKey, mainCardId: '', agents: [] });
    setTechnical({ key: conversationKey, events: [], error: null });
    observedProjectionIdsRef.current = { key: conversationKey, ids: new Set() };
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
        setTranscript({ key: conversationKey, messages: history.messages });
        setSharedAuthority({
          key: conversationKey,
          mainCardId: history.mainCardId,
          agents: history.addressableAgents,
        });
        setTechnical({
          key: conversationKey,
          events: reconcileTerminalEvents(history.terminalEvents),
          error: null,
        });
        observedProjectionIdsRef.current = {
          key: conversationKey,
          ids: new Set(history.terminalEvents.map((event) => event.id)),
        };
        setHistoryState({ key: conversationKey, loading: false });
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
        setHistoryState({ key: conversationKey, loading: false });
        setTechnical((current) => current.key === conversationKey
          ? { ...current, error: current.error || 'conversation_history_read_failed' } : current);
      })

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canvasProjectId, conversationId, conversationKey, deckId]);

  const requestMainText = useCallback(
    async (text: string, images: MainRunImage[] = []): Promise<string> => {
      if (!text.trim()) throw new Error('main_prompt_empty');
      if (!canvasProjectId) {
        setTurnState({ key: conversationKey, phase: 'idle' });
        throw new Error('main_project_required');
      }
      if (nativeSessionPending) throw new Error('main_session_busy');

      let turnParticipant = requestedParticipant(text, mainCardId, addressableAgents);
      setTranscript((current) => ({
        key: conversationKey,
        messages: [
          ...(current.key === conversationKey ? current.messages : []),
          {
            role: 'user',
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
        cardId: turnParticipant.cardId || null,
      };
      setTurnState({ key: conversationKey, phase: 'connecting' });

      const appendModelText = (chunk: string) => {
        if (!chunk) return;
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          const copy = [...current.messages];
          const last = copy[copy.length - 1];
          if (last?.role === 'assistant') {
            copy[copy.length - 1] = {
              role: 'assistant',
              text: last.text + chunk,
              speaker: turnParticipant,
              status: 'pending',
            };
          } else {
            copy.push({
              role: 'assistant', text: chunk, speaker: turnParticipant, status: 'pending',
            });
          }
          return { key: conversationKey, messages: copy };
        });
      };
      const finalizeModelText = (nativeFinalText: string) => {
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          const copy = [...current.messages];
          const last = copy[copy.length - 1];
          if (!nativeFinalText.trim()) {
            if (last?.role === 'assistant') copy.pop();
          } else if (last?.role === 'assistant') {
            copy[copy.length - 1] = {
              role: 'assistant', text: nativeFinalText, speaker: turnParticipant, status: 'complete',
            };
          } else {
            copy.push({
              role: 'assistant', text: nativeFinalText, speaker: turnParticipant, status: 'complete',
            });
          }
          return { key: conversationKey, messages: copy };
        });
      };

      try {
        const { finalText } = await streamSession({
          projectId: canvasProjectId,
          deckId,
          conversationId,
          message: text,
          images,
          dataAnchors: dataAnchors.map((anchor) => ({
            authority: anchor.authority,
            nativeId: anchor.nativeId,
            reason: anchor.reason,
            priority: anchor.order === 0 ? 0 : -anchor.order,
            boundedExpansion: anchor.boundedExpansion,
            resultLimit: anchor.resultLimit,
            required: anchor.required,
          })),
          signal: streamController.signal,
          onEvent: (event) => {
            const projection = event.projection;
            const publicEvent = event.terminalEvent as CardTerminalEvent | undefined;
            const observedRunId = typeof event.runId === 'string' ? event.runId : publicEvent?.runId;
            if ((event.projectId && event.projectId !== canvasProjectId)
              || (event.deckId && event.deckId !== deckId)
              || (event.conversationId && event.conversationId !== conversationId)
              || (publicEvent && (publicEvent.projectId !== canvasProjectId || publicEvent.deckId !== deckId))
              || (observedRunId && runId && observedRunId !== runId)
              || (publicEvent && observedRunId && publicEvent.runId !== observedRunId)) {
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
                const userIndex = lastUserMessageIndex(copy, text);
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
            if (publicEvent?.projectId === canvasProjectId && publicEvent.deckId === deckId
              && publicEvent.cardId && publicEvent.runId && publicEvent.id
              && publicEvent.category?.startsWith('execution.')) {
              setTechnical((current) => current.key === conversationKey
                ? { ...current, events: reconcileTerminalEvents([...current.events, publicEvent]) } : current);
            }
            if (event.kind === 'session' || event.kind === 'text'
              || projection?.category === 'conversation.answer') {
              setTurnState((current) => current.key === conversationKey
                ? { ...current, phase: 'active' }
                : current);
            }
            if (event.kind === 'session') {
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
        // The native completion text is the exact persisted Hermes assistant
        // message. Replace the in-progress streamed bubble with those bytes so
        // the completed UI and a later history read are identical.
        finalizeModelText(completedText);
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          return {
            key: conversationKey,
            messages: current.messages.map((item) => (
              item.role === 'user' && item.text === text && item.status === 'pending'
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
          if (messages[messages.length - 1]?.role === 'assistant') messages.pop();
          const userIndex = lastUserMessageIndex(messages, text);
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
      addressableAgents,
      conversationId,
      conversationKey,
      dataAnchors,
      deckId,
      mainCardId,
      nativeSessionPending,
    ],
  );

  const submitVoiceTranscript = useCallback(
    (text: string) => requestMainText(text),
    [requestMainText],
  );
  const {
    startVoice,
    stopVoice,
    voiceError,
    voicePhase,
  } = useMainBotVoice({
    canvasProjectId,
    deckId,
    conversationId,
    conversationKey,
    mainCardId,
    sessionHistoryLoading,
    sessionPending: nativeSessionPending,
    submitTranscript: submitVoiceTranscript,
  });

  const handleNativeSend = useCallback(
    (text: string, images: MainRunImage[] = []) => {
      void requestMainText(text, images).catch(() => {
        // Native failure remains transport telemetry and never transcript text.
      });
    },
    [requestMainText],
  );

  const stopMainTurn = useCallback(async () => {
    if (!nativeSessionPending || !canvasProjectId) return;
    const active = activeStreamRef.current;
    const expectedRunId = active?.key === conversationKey ? active.runId : null;
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
  }, [canvasProjectId, conversationId, conversationKey, deckId, nativeSessionPending]);

  return {
    technicalEvents: technical.key === conversationKey ? technical.events : [],
    technicalError: technical.key === conversationKey ? technical.error : null,
    handleNativeSend,
    messages,
    addressableAgents,
    nativeSessionActive,
    nativeSessionConnecting,
    sessionHistoryLoading,
    requestMainText,
    startVoice,
    stopMainTurn,
    stopVoice,
    voiceError,
    voicePhase,
  };
}
