import { useCallback, useEffect, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/NativeAuthorityGraphSurface';
import {
  loadSessionHistory,
  type AddressableAgent,
  type GraphRecordIdentity,
  type HermesSessionEvent,
  type MainConversationMessage,
  type MainConversationParticipant,
  type MainRunImage,
  SessionStreamError,
  stopSession,
  stopVoiceCapture,
  streamSession,
  streamVoiceCapture,
} from './mainSessionClient';

export type AgentBuilderChatMessage = MainConversationMessage & {
  status?: 'pending' | 'complete' | 'error';
  requestKey?: string;
};

export type MainChatVoicePhase = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
export type MainChatRunInput = { images?: MainRunImage[] };
export const MAX_MAIN_CHAT_IMAGES = 12;

type UseAgentBuilderMainChatArgs = {
  canvasProjectId: string;
  deckId: string;
  deckRevision?: string | null;
  dataAnchors?: LoadedCardGraphReference['reference'][];
  prepareRunImages?: (addressedCardId: string | null) => Promise<MainRunImage[]>;
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

const USER_PARTICIPANT: MainConversationParticipant = { kind: 'user', label: 'You' };

function participantFromEvent(value: unknown): MainConversationParticipant | null {
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

function cardParticipant(agent: AddressableAgent): MainConversationParticipant {
  return {
    kind: 'card',
    label: agent.title,
    cardId: agent.cardId,
    profile: agent.profile,
    address: agent.address,
  };
}

function requestedParticipant(
  text: string,
  mainCardId: string,
  agents: AddressableAgent[],
): MainConversationParticipant {
  const match = /^\s*@([a-z0-9][a-z0-9_-]{0,63})(?=\s|$)/i.exec(text);
  if (!match) {
    return { kind: 'card', label: 'Main', ...(mainCardId ? { cardId: mainCardId } : {}) };
  }
  const address = match[1].toLowerCase();
  const target = agents.find((agent) => agent.address.toLowerCase() === address);
  return target
    ? cardParticipant(target)
    : { kind: 'card', label: 'Main', ...(mainCardId ? { cardId: mainCardId } : {}) };
}

function requestUserMessageIndex(messages: AgentBuilderChatMessage[], requestKey: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && messages[index].requestKey === requestKey) return index;
  }
  return -1;
}

export default function useAgentBuilderMainChat({
  canvasProjectId,
  deckId,
  deckRevision,
  dataAnchors = [],
  prepareRunImages,
}: UseAgentBuilderMainChatArgs) {
  const projectKey = canvasProjectId;
  const [technical, setTechnical] = useState<{ key: string; error: string | null }>({
    key: projectKey,
    error: null,
  });
  const [transcript, setTranscript] = useState<{
    key: string;
    messages: AgentBuilderChatMessage[];
  }>({ key: projectKey, messages: [] });
  const [historyState, setHistoryState] = useState<{ key: string; loading: boolean }>({
    key: projectKey,
    loading: Boolean(canvasProjectId),
  });
  const [turnState, setTurnState] = useState<{
    key: string;
    phase: 'idle' | 'connecting' | 'active';
  }>({ key: projectKey, phase: 'idle' });
  const [authority, setAuthority] = useState<{
    key: string;
    mainCardId: string;
    agents: AddressableAgent[];
  }>({ key: projectKey, mainCardId: '', agents: [] });
  const [voiceState, setVoiceState] = useState<{
    key: string;
    phase: MainChatVoicePhase;
    error: string | null;
  }>({ key: projectKey, phase: 'idle', error: null });
  const activeStreamsRef = useRef(new Map<AbortController, {
    key: string;
    runId: string | null;
    requestKey: string;
  }>());
  const voiceControllerRef = useRef<AbortController | null>(null);

  const messages = transcript.key === projectKey ? transcript.messages : [];
  const addressableAgents = authority.key === projectKey ? authority.agents : [];
  const mainCardId = authority.key === projectKey ? authority.mainCardId : '';
  const sessionActive = turnState.key === projectKey && turnState.phase === 'active';
  const sessionConnecting = turnState.key === projectKey && turnState.phase === 'connecting';
  const sessionPending = sessionActive || sessionConnecting;
  const sessionHistoryLoading = historyState.key === projectKey && historyState.loading;

  useEffect(() => {
    for (const [controller, active] of activeStreamsRef.current) {
      if (active.key !== projectKey) controller.abort();
    }
    activeStreamsRef.current.clear();
    voiceControllerRef.current?.abort();
    voiceControllerRef.current = null;
    setTranscript({ key: projectKey, messages: [] });
    setAuthority({ key: projectKey, mainCardId: '', agents: [] });
    setTechnical({ key: projectKey, error: null });
    setTurnState({ key: projectKey, phase: 'idle' });
    setVoiceState({ key: projectKey, phase: 'idle', error: null });
    if (!canvasProjectId) {
      setHistoryState({ key: projectKey, loading: false });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setHistoryState({ key: projectKey, loading: true });
    void loadSessionHistory({
      projectId: canvasProjectId,
      deckId,
      signal: controller.signal,
    })
      .then((history) => {
        if (cancelled) return;
        setTranscript({ key: projectKey, messages: history.messages });
        setAuthority({
          key: projectKey,
          mainCardId: history.mainCardId,
          agents: history.addressableAgents,
        });
        setTechnical({ key: projectKey, error: null });
        setHistoryState({ key: projectKey, loading: false });
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
        setHistoryState({ key: projectKey, loading: false });
        setTechnical({ key: projectKey, error: 'conversation_history_read_failed' });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canvasProjectId, deckId, projectKey]);

  useEffect(() => {
    if (!canvasProjectId || !deckRevision) return;
    const controller = new AbortController();
    void loadSessionHistory({
      projectId: canvasProjectId,
      deckId,
      signal: controller.signal,
    }).then((history) => {
      if (controller.signal.aborted) return;
      setAuthority({
        key: projectKey,
        mainCardId: history.mainCardId,
        agents: history.addressableAgents,
      });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setTechnical({ key: projectKey, error: 'conversation_authority_refresh_failed' });
      }
    });
    return () => controller.abort();
  }, [canvasProjectId, deckId, deckRevision, projectKey]);

  const requestMainText = useCallback(async (
    text: string,
    runInput: MainChatRunInput = {},
  ): Promise<string> => {
    if (!text.trim()) throw new Error('main_prompt_empty');
    if (!canvasProjectId) throw new Error('main_project_required');
    let requestTarget = requestedParticipant(text, mainCardId, addressableAgents);
    let responseParticipant: MainConversationParticipant = {
      kind: 'card',
      label: 'Main',
      ...(mainCardId ? { cardId: mainCardId } : {}),
    };
    const requestKey = globalThis.crypto.randomUUID();
    setTranscript((current) => ({
      key: projectKey,
      messages: [
        ...(current.key === projectKey ? current.messages : []),
        {
          role: 'user',
          text,
          speaker: USER_PARTICIPANT,
          target: requestTarget,
          status: 'pending',
          requestKey,
        },
      ],
    }));
    setTechnical({ key: projectKey, error: null });
    const alreadyActive = activeStreamsRef.current.size > 0;
    setTurnState({ key: projectKey, phase: alreadyActive ? 'active' : 'connecting' });
    const controller = new AbortController();
    activeStreamsRef.current.set(controller, { key: projectKey, runId: null, requestKey });

    const addressedCardId = requestTarget.cardId && requestTarget.cardId !== mainCardId
      ? requestTarget.cardId : null;
    const images = [...(runInput.images || [])];
    if (prepareRunImages && images.length < MAX_MAIN_CHAT_IMAGES) {
      const prepared = await prepareRunImages(addressedCardId);
      images.push(...prepared.slice(0, MAX_MAIN_CHAT_IMAGES - images.length));
    }
    let runId: string | null = null;
    const appendText = (chunk: string) => {
      if (!chunk) return;
      setTranscript((current) => {
        if (current.key !== projectKey) return current;
        const copy = [...current.messages];
        const assistantIndex = copy.findIndex((message) => (
          message.role === 'assistant' && message.requestKey === requestKey
        ));
        if (assistantIndex >= 0) {
          const currentAssistant = copy[assistantIndex];
          copy[assistantIndex] = {
            ...currentAssistant,
            text: currentAssistant.text + chunk,
            speaker: responseParticipant,
          };
        } else {
          copy.push({
            role: 'assistant', text: chunk, speaker: responseParticipant,
            status: 'pending', requestKey,
          });
        }
        return { key: projectKey, messages: copy };
      });
    };
    const finishText = (textValue: string) => {
      setTranscript((current) => {
        if (current.key !== projectKey) return current;
        const copy = [...current.messages];
        const assistantIndex = copy.findIndex((message) => (
          message.role === 'assistant' && message.requestKey === requestKey
        ));
        if (!textValue.trim()) {
          if (assistantIndex >= 0) copy.splice(assistantIndex, 1);
        } else if (assistantIndex >= 0) {
          copy[assistantIndex] = {
            role: 'assistant', text: textValue, speaker: responseParticipant,
            status: 'complete', requestKey,
          };
        } else {
          copy.push({
            role: 'assistant', text: textValue, speaker: responseParticipant,
            status: 'complete', requestKey,
          });
        }
        return { key: projectKey, messages: copy };
      });
    };

    try {
      const { finalText } = await streamSession({
        projectId: canvasProjectId,
        deckId,
        message: text,
        images,
        dataAnchors: dataAnchors.map(({ order, ...anchor }) => ({
          ...anchor,
          priority: order === 0 ? 0 : -order,
        })),
        signal: controller.signal,
        onEvent: (event: HermesSessionEvent) => {
          if (
            (event.projectId && event.projectId !== canvasProjectId)
            || (event.deckId && event.deckId !== deckId)
            || (event.runId && runId && event.runId !== runId)
          ) throw new Error('main_run_identity_mismatch');
          const verifiedTarget = participantFromEvent(event.requestedParticipant);
          if (verifiedTarget) {
            requestTarget = verifiedTarget;
            setTranscript((current) => {
              if (current.key !== projectKey) return current;
              const copy = [...current.messages];
              const userIndex = requestUserMessageIndex(copy, requestKey);
              if (userIndex >= 0) copy[userIndex] = { ...copy[userIndex], target: verifiedTarget };
              return { key: projectKey, messages: copy };
            });
          }
          const observed = participantFromEvent(event.participant);
          if (observed && (event.kind === 'text' || event.kind === 'done')) {
            responseParticipant = observed;
          }
          if (event.runId && !runId) {
            runId = event.runId;
            const active = activeStreamsRef.current.get(controller);
            if (active) active.runId = runId;
          }
          if (event.kind === 'session' || event.kind === 'text') {
            setTurnState({ key: projectKey, phase: 'active' });
          }
          if (event.kind === 'session') {
            const configuration = event.configuration && typeof event.configuration === 'object'
              ? event.configuration as Record<string, unknown> : {};
            const unavailable = Array.isArray(configuration.unavailableTools)
              ? configuration.unavailableTools.map(String).filter(Boolean) : [];
            if (unavailable.length) {
              setTechnical({
                key: projectKey,
                error: `card_tools_unavailable:${unavailable.join(',')}`,
              });
            }
          }
          if (event.kind === 'text') appendText(String(event.text || ''));
        },
      });
      finishText(finalText);
      setTranscript((current) => current.key !== projectKey ? current : ({
        key: projectKey,
        messages: current.messages.map((message) => (
          message.role === 'user' && message.requestKey === requestKey
            && message.status === 'pending'
            ? { ...message, status: 'complete' as const }
            : message
        )),
      }));
      return finalText;
    } catch (error) {
      setTranscript((current) => {
        if (current.key !== projectKey) return current;
        const copy = [...current.messages];
        const assistantIndex = copy.findIndex((message) => (
          message.role === 'assistant' && message.requestKey === requestKey
        ));
        if (assistantIndex >= 0) copy.splice(assistantIndex, 1);
        const userIndex = requestUserMessageIndex(copy, requestKey);
        if (userIndex >= 0) copy[userIndex] = { ...copy[userIndex], status: 'error' };
        return { key: projectKey, messages: copy };
      });
      setTechnical({
        key: projectKey,
        error: error instanceof SessionStreamError ? error.code : 'main_turn_failed',
      });
      throw error;
    } finally {
      activeStreamsRef.current.delete(controller);
      setTurnState({
        key: projectKey,
        phase: activeStreamsRef.current.size ? 'active' : 'idle',
      });
    }
  }, [
    addressableAgents,
    canvasProjectId,
    dataAnchors,
    deckId,
    mainCardId,
    prepareRunImages,
    projectKey,
  ]);

  const handleSend = useCallback((text: string, runInput?: MainChatRunInput) => {
    void requestMainText(text, runInput).catch(() => undefined);
  }, [requestMainText]);

  const startVoiceSession = useCallback(() => {
    if (!canvasProjectId || sessionPending || voiceControllerRef.current) return;
    const controller = new AbortController();
    voiceControllerRef.current = controller;
    setVoiceState({ key: projectKey, phase: 'listening', error: null });
    void streamVoiceCapture({
      projectId: canvasProjectId,
      deckId,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.kind === 'error') {
          setVoiceState({ key: projectKey, phase: 'error', error: event.error || 'voice_failed' });
          return;
        }
        if (event.kind === 'status') {
          const status = String(event.event?.payload?.status || event.state?.status || '');
          if (status === 'speaking') setVoiceState({ key: projectKey, phase: 'speaking', error: null });
          else if (status === 'recording') setVoiceState({ key: projectKey, phase: 'listening', error: null });
          return;
        }
        if (event.kind !== 'transcript') return;
        const payload = event.event?.payload || {};
        const text = String(payload.text || payload.transcript || '').trim();
        const final = payload.final === true || payload.is_final === true;
        if (!text || !final) return;
        setVoiceState({ key: projectKey, phase: 'processing', error: null });
        void requestMainText(text).then(() => {
          setVoiceState({ key: projectKey, phase: 'idle', error: null });
        }).catch((error) => {
          setVoiceState({
            key: projectKey,
            phase: 'error',
            error: error instanceof Error ? error.message : 'voice_transcript_failed',
          });
        });
      },
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setVoiceState({
        key: projectKey,
        phase: 'error',
        error: error instanceof Error ? error.message : 'voice_failed',
      });
    }).finally(() => {
      if (voiceControllerRef.current === controller) voiceControllerRef.current = null;
    });
  }, [canvasProjectId, deckId, projectKey, requestMainText, sessionPending]);

  const stopVoiceSession = useCallback(async () => {
    if (!canvasProjectId) return;
    await stopVoiceCapture({ projectId: canvasProjectId, deckId });
    voiceControllerRef.current?.abort();
    voiceControllerRef.current = null;
    setVoiceState({ key: projectKey, phase: 'idle', error: null });
  }, [canvasProjectId, deckId, projectKey]);

  const stopMainTurn = useCallback(async () => {
    if (!sessionPending || !canvasProjectId) return;
    const activeEntry = [...activeStreamsRef.current.entries()].reverse().find(([, active]) => (
      active.key === projectKey && Boolean(active.runId)
    ));
    const expectedRunId = activeEntry?.[1].runId || null;
    if (!activeEntry || !expectedRunId) throw new Error('expected_run_id_required');
    try {
      await stopSession({ projectId: canvasProjectId, deckId, expectedRunId });
    } catch (error) {
      if (!(error instanceof SessionStreamError) || error.code !== 'no_active_turn') throw error;
    } finally {
      activeEntry[0].abort();
      activeStreamsRef.current.delete(activeEntry[0]);
      setTurnState({
        key: projectKey,
        phase: activeStreamsRef.current.size ? 'active' : 'idle',
      });
    }
  }, [canvasProjectId, deckId, projectKey, sessionPending]);

  return {
    technicalError: technical.key === projectKey ? technical.error : null,
    handleSend,
    messages,
    addressableAgents,
    sessionActive,
    sessionConnecting,
    sessionHistoryLoading,
    requestMainText,
    startVoiceSession,
    stopMainTurn,
    stopVoiceSession,
    voiceError: voiceState.key === projectKey ? voiceState.error : null,
    voicePhase: voiceState.key === projectKey ? voiceState.phase : 'idle',
  };
}
