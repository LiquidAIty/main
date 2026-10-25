/**
 * Entity: Main Chat
 * Relationship: This file owns the Project-scoped Main conversation view, history, streamed partial replies, error state, and one final submission per voice capture.
 * Entity: Projects
 * Relationship: This file resets conversation, authority, voice, and active-stream state whenever the active Project changes.
 * Entity: Card Invocation
 * Relationship: This file assembles one Main Run request from exact user text, bounded images, and selected references and retains partial text on failure or cancellation.
 * Entity: Run Ledger
 * Relationship: This file tracks the real active Run identity for stop requests and refuses to interrupt without an observed Run ID.
 * Entity: Data Anchors
 * Relationship: This file converts selected reference order into bounded Run priorities without changing provider identity or resolved data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/knowledgeGraphProjection';
import {
  loadSessionHistory,
  type AddressableAgent,
  type GraphRecordIdentity,
  type MainSessionEvent,
  type MainConversationMessage,
  type MainConversationParticipant,
  type MainRunImage,
  SessionStreamError,
  stopSession,
  stopVoiceCapture,
  streamSession,
  streamVoiceCapture,
} from './mainSessionClient';

export type MainProjectChatMessage = MainConversationMessage & {
  status?: 'pending' | 'complete' | 'error';
  requestKey?: string;
};

export type MainChatVoicePhase = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
export type MainChatRunInput = { images?: MainRunImage[] };
export const MAX_MAIN_CHAT_IMAGES = 4;

type UseAgentBuilderMainChatArgs = {
  canvasProjectId: string;
  deckId: string;
  deckRevision?: string | null;
  dataAnchors?: LoadedCardGraphReference['reference'][];
  onMainRunCompleted?: (
    runId: string,
    waitForThinkCapture?: boolean,
  ) => void | Promise<void>;
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

function requestUserMessageIndex(messages: MainProjectChatMessage[], requestKey: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && messages[index].requestKey === requestKey) return index;
  }
  return -1;
}

export default function useAgentBuilderMainChat({
  canvasProjectId,
  deckId,
  dataAnchors = [],
  onMainRunCompleted,
}: UseAgentBuilderMainChatArgs) {
  const projectKey = canvasProjectId;
  const [technical, setTechnical] = useState<{ key: string; error: string | null }>({
    key: projectKey,
    error: null,
  });
  const [transcript, setTranscript] = useState<{
    key: string;
    messages: MainProjectChatMessage[];
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
  const activeRunIdRef = useRef<{ key: string; runId: string } | null>(null);
  const voiceControllerRef = useRef<AbortController | null>(null);
  const voiceTranscriptRef = useRef<string | null>(null);
  const voiceTurnActiveRef = useRef(false);

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
    activeRunIdRef.current = null;
    voiceControllerRef.current?.abort();
    voiceControllerRef.current = null;
    voiceTranscriptRef.current = null;
    voiceTurnActiveRef.current = false;
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

  const requestMainText = useCallback(async (
    text: string,
    runInput: MainChatRunInput = {},
  ): Promise<string> => {
    if (!text.trim()) throw new Error('main_prompt_empty');
    if (!canvasProjectId) throw new Error('main_project_required');
    let responseParticipant: MainConversationParticipant = {
      kind: 'card',
      label: 'Main',
      ...(mainCardId ? { cardId: mainCardId } : {}),
    };
    const requestKey = globalThis.crypto.randomUUID();
    const alreadyActive = activeStreamsRef.current.size > 0;
    setTranscript((current) => {
      const messages = current.key === projectKey ? [...current.messages] : [];
      const userMessage: MainProjectChatMessage = {
        role: 'user',
        text,
        speaker: USER_PARTICIPANT,
        status: 'pending',
        requestKey,
      };
      if (alreadyActive) {
        const activeRequestKeys = new Set(
          [...activeStreamsRef.current.values()].map((active) => active.requestKey),
        );
        const pendingAnswerIndex = messages.findIndex((item) => (
          item.role === 'assistant'
          && item.status === 'pending'
          && Boolean(item.requestKey)
          && activeRequestKeys.has(item.requestKey!)
        ));
        if (pendingAnswerIndex >= 0) messages.splice(pendingAnswerIndex, 0, userMessage);
        else messages.push(userMessage);
      } else messages.push(userMessage);
      return { key: projectKey, messages };
    });
    setTechnical({ key: projectKey, error: null });
    setTurnState({ key: projectKey, phase: alreadyActive ? 'active' : 'connecting' });
    const controller = new AbortController();
    activeStreamsRef.current.set(controller, { key: projectKey, runId: null, requestKey });

    const images = [...(runInput.images || [])];
    let runId: string | null = null;
    let streamedText = '';
    let responseEvidenceIds: string[] = [];
    const appendText = (chunk: string) => {
      if (!chunk) return;
      streamedText += chunk;
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
    const finishText = (
      textValue: string,
      status: 'complete' | 'error' = 'complete',
      linkedEvidenceIds: string[] = responseEvidenceIds,
    ) => {
      setTranscript((current) => {
        if (current.key !== projectKey) return current;
        const copy = [...current.messages];
        const assistantIndex = copy.findIndex((message) => (
          message.role === 'assistant' && message.requestKey === requestKey
        ));
        const retainedText = textValue.trim()
          ? textValue
          : assistantIndex >= 0 ? copy[assistantIndex].text : '';
        if (!retainedText.trim()) {
          if (assistantIndex >= 0) copy.splice(assistantIndex, 1);
        } else if (assistantIndex >= 0) {
          copy[assistantIndex] = {
            role: 'assistant', text: retainedText, speaker: responseParticipant,
            status, requestKey,
            ...(linkedEvidenceIds.length ? { linkedEvidenceIds } : {}),
          };
        } else {
          copy.push({
            role: 'assistant', text: retainedText, speaker: responseParticipant,
            status, requestKey,
            ...(linkedEvidenceIds.length ? { linkedEvidenceIds } : {}),
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
        onEvent: (event: MainSessionEvent) => {
          if (
            (event.projectId && event.projectId !== canvasProjectId)
            || (event.deckId && event.deckId !== deckId)
            || (event.runId && runId && event.runId !== runId)
          ) throw new Error('main_run_identity_mismatch');
          const observed = participantFromEvent(event.participant);
          if (observed && (event.kind === 'text' || event.kind === 'done')) {
            responseParticipant = observed;
          }
          if (event.runId && !runId) {
            runId = event.runId;
            activeRunIdRef.current = { key: projectKey, runId };
            const active = activeStreamsRef.current.get(controller);
            if (active) active.runId = runId;
          }
          if (event.kind === 'run' || event.kind === 'session' || event.kind === 'text') {
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
          if (event.kind === 'done') {
            responseEvidenceIds = Array.isArray(event.linkedEvidenceIds)
              ? [...new Set(event.linkedEvidenceIds.map(String).map(value => value.trim()).filter(Boolean))]
              : [];
          }
        },
      });
      finishText(finalText || streamedText);
      setTranscript((current) => current.key !== projectKey ? current : ({
        key: projectKey,
        messages: current.messages.map((message) => (
          message.role === 'user' && message.requestKey === requestKey
            && message.status === 'pending'
            ? { ...message, status: 'complete' as const }
            : message
        )),
      }));
      const completedRunId = runId;
      if (
        completedRunId
        && String(finalText || streamedText).trim()
      ) {
        void Promise.resolve()
          .then(() => onMainRunCompleted?.(completedRunId))
          .catch(() => undefined);
      }
      return finalText;
    } catch (error) {
      if (controller.signal.aborted) {
        finishText(streamedText);
        setTranscript((current) => current.key !== projectKey ? current : ({
          key: projectKey,
          messages: current.messages.map((message) => (
            message.role === 'user' && message.requestKey === requestKey
              ? { ...message, status: 'complete' as const }
              : message
          )),
        }));
        return '';
      }
      setTranscript((current) => {
        if (current.key !== projectKey) return current;
        const copy = [...current.messages];
        const assistantIndex = copy.findIndex((message) => (
          message.role === 'assistant' && message.requestKey === requestKey
        ));
        if (assistantIndex >= 0) {
          copy[assistantIndex] = { ...copy[assistantIndex], status: 'error' };
        }
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
      const projectStillActive = [...activeStreamsRef.current.values()].some(
        (active) => active.key === projectKey,
      );
      if (!projectStillActive && activeRunIdRef.current?.key === projectKey) {
        activeRunIdRef.current = null;
      }
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
    onMainRunCompleted,
    projectKey,
  ]);

  const handleSend = useCallback((text: string, runInput?: MainChatRunInput) => {
    if (!text.trim() || !canvasProjectId) {
      setTechnical({ key: projectKey, error: 'main_project_required' });
      return false;
    }
    void requestMainText(text, runInput).catch(() => undefined);
    return true;
  }, [addressableAgents, canvasProjectId, mainCardId, projectKey, requestMainText]);

  const startVoiceSession = useCallback(() => {
    if (!canvasProjectId || sessionPending || voiceControllerRef.current) return;
    const controller = new AbortController();
    voiceControllerRef.current = controller;
    voiceTranscriptRef.current = null;
    voiceTurnActiveRef.current = false;
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
          const status = String(
            event.event?.payload?.state
            || event.event?.payload?.status
            || event.state?.status
            || '',
          );
          if (status === 'speaking') setVoiceState({ key: projectKey, phase: 'speaking', error: null });
          else if (status === 'recording' || status === 'listening') {
            voiceTranscriptRef.current = null;
            setVoiceState({ key: projectKey, phase: 'listening', error: null });
          }
          return;
        }
        if (event.kind !== 'transcript') return;
        const payload = event.event?.payload || {};
        if (payload.stop_phrase === true || payload.no_speech_limit === true) {
          voiceTranscriptRef.current = null;
          voiceTurnActiveRef.current = false;
          setVoiceState({ key: projectKey, phase: 'idle', error: null });
          return;
        }
        const text = String(payload.text || payload.transcript || '').trim();
        if (!text || voiceTranscriptRef.current === text || voiceTurnActiveRef.current) return;
        voiceTranscriptRef.current = text;
        voiceTurnActiveRef.current = true;
        setVoiceState({ key: projectKey, phase: 'processing', error: null });
        void requestMainText(text).then(() => {
          setVoiceState({ key: projectKey, phase: 'idle', error: null });
        }).catch((error) => {
          setVoiceState({
            key: projectKey,
            phase: 'error',
            error: error instanceof Error ? error.message : 'voice_transcript_failed',
          });
        }).finally(() => {
          voiceTurnActiveRef.current = false;
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
    voiceTranscriptRef.current = null;
    voiceTurnActiveRef.current = false;
    setVoiceState({ key: projectKey, phase: 'idle', error: null });
  }, [canvasProjectId, deckId, projectKey]);

  const stopMainTurn = useCallback(async () => {
    if (!sessionPending || !canvasProjectId) return;
    const expectedRunId = activeRunIdRef.current?.key === projectKey
      ? activeRunIdRef.current.runId
      : null;
    if (!expectedRunId) throw new Error('expected_run_id_required');
    await stopSession({ projectId: canvasProjectId, deckId, expectedRunId });
    for (const [controller, active] of activeStreamsRef.current) {
      if (active.key !== projectKey) continue;
      controller.abort();
      activeStreamsRef.current.delete(controller);
    }
    activeRunIdRef.current = null;
    setTurnState({
      key: projectKey,
      phase: activeStreamsRef.current.size ? 'active' : 'idle',
    });
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
