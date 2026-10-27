/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Main Chat
 * Relationship: Owns the Project conversation view and partial replies, refreshing persisted history from observed Hermes activity without overwriting an active foreground response.
 * Entity: Projects
 * Relationship: This file resets conversation, authority, voice, and active-stream state whenever the active Project changes.
 * Entity: Card Invocation
 * Relationship: Submits unchanged user text and image records through the existing chat client and retains partial text on failure or cancellation; it does not create saved Runs or IDFs.
 * Entity: Card Sessions
 * Relationship: Retains the responding Hermes conversation identity for Stop and aborts only this view's active request streams after interruption.
 * Entity: Voice
 * Relationship: Captures this browser's microphone, submits its Hermes transcript once, and plays the replying Card's Hermes speech without changing saved prompts.
 * Entity: Data Anchors
 * Relationship: Maps selected reference order to transport priority without resolving provider data; nonempty selections remain unsupported by the current Bot Mode route.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/knowledgeGraphProjection';
import {
  loadSessionHistory,
  type AddressableAgent,
  type GraphRecordIdentity,
  type MainSessionEvent,
  type MainSessionHistory,
  type MainConversationMessage,
  type MainRunImage,
  SessionStreamError,
  stopSession,
  requestVoiceAudio,
  streamSession,
} from './mainSessionClient';

export type MainProjectChatMessage = MainConversationMessage & {
  status?: 'pending' | 'complete' | 'error';
  requestKey?: string;
};

export type MainChatVoicePhase = 'idle' | 'requesting' | 'listening' | 'processing' | 'speaking' | 'error';
export type MainChatRunInput = { images?: MainRunImage[]; voiceTurn?: boolean };
export const MAX_MAIN_CHAT_IMAGES = 4;

type UseAgentBuilderMainChatArgs = {
  canvasProjectId: string;
  deckId: string;
  deckRevision?: string | null;
  mainCanonicalSession?: {
    id: string;
    resolvedId: string;
    lastActive: number;
    messageCount: number | null;
  } | null;
  dataAnchors?: LoadedCardGraphReference['reference'][];
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
  mainCanonicalSession = null,
}: UseAgentBuilderMainChatArgs) {
  const projectKey = `${canvasProjectId}:${deckId}`;
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
    agents: AddressableAgent[];
  }>({ key: projectKey, agents: [] });
  const [voiceState, setVoiceState] = useState<{
    key: string;
    phase: MainChatVoicePhase;
    error: string | null;
  }>({ key: projectKey, phase: 'idle', error: null });
  const activeStreamsRef = useRef(new Map<AbortController, {
    key: string;
    requestKey: string;
  }>());
  const sessionIdRef = useRef('');
  const voiceControllerRef = useRef<AbortController | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const historyWatermarkRef = useRef<{
    key: string; lastActive: number; messageCount?: number | null;
  }>({ key: '', lastActive: 0 });
  const historyRequestRef = useRef(0);
  const activityHistoryControllerRef = useRef<AbortController | null>(null);
  const latestCanonicalSessionRef = useRef(mainCanonicalSession);
  latestCanonicalSessionRef.current = mainCanonicalSession;
  const canonicalSessionId = mainCanonicalSession?.id;
  const canonicalResolvedId = mainCanonicalSession?.resolvedId;
  const canonicalLastActive = mainCanonicalSession?.lastActive;
  const canonicalMessageCount = mainCanonicalSession?.messageCount;

  const acceptHistory = useCallback((history: MainSessionHistory) => {
    sessionIdRef.current = history.sessionId;
    setTranscript({ key: projectKey, messages: history.messages });
    setAuthority({
      key: projectKey,
      agents: history.addressableAgents,
    });
    setTechnical((current) => (
      current.key === projectKey && current.error === 'conversation_history_read_failed'
        ? { key: projectKey, error: null }
        : current
    ));
  }, [projectKey]);

  const refreshHistory = useCallback(async (signal?: AbortSignal) => {
    const request = ++historyRequestRef.current;
    const requestedCanonical = latestCanonicalSessionRef.current;
    const history = await loadSessionHistory({
      projectId: canvasProjectId,
      deckId,
      signal,
    });
    const currentCanonical = latestCanonicalSessionRef.current;
    if (
      signal?.aborted
      || request !== historyRequestRef.current
      || activeStreamsRef.current.size > 0
      || (requestedCanonical && (
        requestedCanonical.id !== currentCanonical?.id
        || requestedCanonical.resolvedId !== currentCanonical?.resolvedId
      ))
    ) return;
    acceptHistory(history);
    if (requestedCanonical) {
      historyWatermarkRef.current = {
        key: `${projectKey}:${requestedCanonical.id}:${requestedCanonical.resolvedId}`,
        lastActive: requestedCanonical.lastActive,
        messageCount: requestedCanonical.messageCount,
      };
    }
  }, [acceptHistory, canvasProjectId, deckId, projectKey]);

  const messages = transcript.key === projectKey ? transcript.messages : [];
  const addressableAgents = authority.key === projectKey ? authority.agents : [];
  const sessionActive = turnState.key === projectKey && turnState.phase === 'active';
  const sessionConnecting = turnState.key === projectKey && turnState.phase === 'connecting';
  const sessionPending = sessionActive || sessionConnecting;
  const sessionHistoryLoading = historyState.key === projectKey && historyState.loading;

  useEffect(() => {
    for (const [controller, active] of activeStreamsRef.current) {
      if (active.key !== projectKey) controller.abort();
    }
    activeStreamsRef.current.clear();
    sessionIdRef.current = '';
    voiceControllerRef.current?.abort();
    voiceControllerRef.current = null;
    voiceAudioRef.current?.pause();
    voiceAudioRef.current = null;
    historyRequestRef.current += 1;
    activityHistoryControllerRef.current?.abort();
    activityHistoryControllerRef.current = null;
    historyWatermarkRef.current = { key: '', lastActive: 0 };
    setTranscript({ key: projectKey, messages: [] });
    setAuthority({ key: projectKey, agents: [] });
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
    void refreshHistory(controller.signal)
      .then(() => {
        if (cancelled) return;
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
      voiceControllerRef.current?.abort();
      voiceAudioRef.current?.pause();
      historyRequestRef.current += 1;
      activityHistoryControllerRef.current?.abort();
      activityHistoryControllerRef.current = null;
    };
  }, [canvasProjectId, projectKey, refreshHistory]);

  useEffect(() => {
    if (
      !canvasProjectId || !canonicalSessionId || !canonicalResolvedId
      || canonicalLastActive === undefined || sessionHistoryLoading
    ) return;
    const key = `${projectKey}:${canonicalSessionId}:${canonicalResolvedId}`;
    const observed = historyWatermarkRef.current;
    if (
      (observed.key === key && canonicalLastActive <= observed.lastActive
        && canonicalMessageCount === observed.messageCount)
      || activeStreamsRef.current.size > 0
    ) return;
    const controller = new AbortController();
    activityHistoryControllerRef.current?.abort();
    activityHistoryControllerRef.current = controller;
    void refreshHistory(controller.signal).catch(() => {
      if (!controller.signal.aborted) {
        setTechnical({ key: projectKey, error: 'conversation_history_read_failed' });
      }
    }).finally(() => {
      if (activityHistoryControllerRef.current === controller) {
        activityHistoryControllerRef.current = null;
      }
    });
  }, [
    canvasProjectId, canonicalSessionId, canonicalResolvedId, canonicalLastActive, canonicalMessageCount,
    projectKey, refreshHistory, sessionHistoryLoading, sessionPending,
  ]);

  const requestMainText = useCallback(async (
    text: string,
    runInput: MainChatRunInput = {},
  ): Promise<{ text: string; cardId: string; speechText: string }> => {
    if (!text.trim()) throw new Error('main_prompt_empty');
    if (!canvasProjectId) throw new Error('main_project_required');
    const requestKey = globalThis.crypto.randomUUID();
    const alreadyActive = activeStreamsRef.current.size > 0;
    setTranscript((current) => {
      const messages = current.key === projectKey ? [...current.messages] : [];
      const userMessage: MainProjectChatMessage = {
        role: 'user',
        text,
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
    activeStreamsRef.current.set(controller, { key: projectKey, requestKey });

    const images = [...(runInput.images || [])];
    let finalText = '';
    let cardId = '';
    let speechText = '';
    let streamedText = '';
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
          };
        } else {
          copy.push({
            role: 'assistant', text: chunk,
            status: 'pending', requestKey,
          });
        }
        return { key: projectKey, messages: copy };
      });
    };
    const finishText = (
      textValue: string,
      status: 'complete' | 'error' = 'complete',
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
            role: 'assistant', text: retainedText,
            status, requestKey,
          };
        } else {
          copy.push({
            role: 'assistant', text: retainedText,
            status, requestKey,
          });
        }
        return { key: projectKey, messages: copy };
      });
    };

    try {
      ({ finalText } = await streamSession({
        projectId: canvasProjectId,
        deckId,
        message: text,
        images,
        voiceTurn: runInput.voiceTurn,
        dataAnchors: dataAnchors.map(({ order, ...anchor }) => ({
          ...anchor,
          priority: order === 0 ? 0 : -order,
        })),
        signal: controller.signal,
        onEvent: (event: MainSessionEvent) => {
          if (
            (event.projectId && event.projectId !== canvasProjectId)
            || (event.deckId && event.deckId !== deckId)
          ) throw new Error('main_run_identity_mismatch');
          if (event.kind === 'session' && typeof event.sessionId === 'string') {
            sessionIdRef.current = event.sessionId;
            cardId = event.cardId || '';
          }
          if (event.kind === 'done' && typeof event.speechText === 'string') speechText = event.speechText;
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
      }));
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
        return { text: '', cardId, speechText: '' };
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
      setTurnState({
        key: projectKey,
        phase: activeStreamsRef.current.size ? 'active' : 'idle',
      });
    }
    if (!controller.signal.aborted && activeStreamsRef.current.size === 0) {
      await refreshHistory().catch(() => {
        setTechnical({ key: projectKey, error: 'conversation_history_read_failed' });
      });
    }
    return { text: finalText, cardId, speechText };
  }, [
    addressableAgents,
    canvasProjectId,
    dataAnchors,
    deckId,
    projectKey,
    refreshHistory,
  ]);

  const handleSend = useCallback((text: string, runInput?: MainChatRunInput) => {
    if (!text.trim() || !canvasProjectId) {
      setTechnical({ key: projectKey, error: 'main_project_required' });
      return false;
    }
    void requestMainText(text, runInput).catch(() => undefined);
    return true;
  }, [addressableAgents, canvasProjectId, projectKey, requestMainText]);

  const startVoiceSession = useCallback(async (draft = '', runInput: MainChatRunInput = {}): Promise<boolean> => {
    if (!canvasProjectId || voiceControllerRef.current) return false;
    const controller = new AbortController();
    const { signal } = controller;
    voiceControllerRef.current = controller;
    let stream: MediaStream | undefined;
    let submitted = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('microphone_unavailable');
      setVoiceState({ key: projectKey, phase: 'requesting', error: null });
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      signal.throwIfAborted();
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/wav']
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceRecorderRef.current = recorder;
      const recorded = await new Promise<Blob>((resolve, reject) => {
        const chunks: Blob[] = [];
        const cancel = () => { if (recorder.state !== 'inactive') recorder.stop(); reject(signal.reason); };
        signal.addEventListener('abort', cancel, { once: true });
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => {
          signal.removeEventListener('abort', cancel);
          reject(new Error('microphone_recording_failed'));
        };
        recorder.onstop = () => {
          signal.removeEventListener('abort', cancel);
          stream?.getTracks().forEach(track => track.stop());
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        };
        recorder.start();
        setVoiceState({ key: projectKey, phase: 'listening', error: null });
      });
      if (voiceRecorderRef.current === recorder) voiceRecorderRef.current = null;
      signal.throwIfAborted();
      setVoiceState({ key: projectKey, phase: 'processing', error: null });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(recorded);
      });
      const result = await requestVoiceAudio('transcribe', { projectId: canvasProjectId, deckId,
        message: draft, dataUrl, mimeType: recorded.type }, signal);
      signal.throwIfAborted();
      if (typeof result.transcript !== 'string') throw new Error('voice_transcript_missing');
      if (!result.transcript.trim()) { setVoiceState({ key: projectKey, phase: 'idle', error: null }); return false; }
      const message = draft ? `${draft}${/\s$/u.test(draft) ? '' : ' '}${result.transcript}` : result.transcript;
      const reply = await requestMainText(message, { ...runInput, voiceTurn: true });
      submitted = true;
      signal.throwIfAborted();
      if (reply.speechText) {
        const spoken = await requestVoiceAudio('speak', { projectId: canvasProjectId, deckId,
          cardId: reply.cardId, text: reply.speechText }, signal);
        signal.throwIfAborted();
        if (!spoken.data_url?.startsWith('data:audio/')) throw new Error('voice_audio_missing');
        const audio = new Audio(spoken.data_url);
        voiceAudioRef.current = audio;
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { audio.pause(); reject(signal.reason); };
          signal.addEventListener('abort', cancel, { once: true });
          const finished = () => signal.removeEventListener('abort', cancel);
          audio.onended = () => { finished(); resolve(); };
          audio.onerror = () => { finished(); reject(new Error('voice_playback_failed')); };
          void audio.play().then(() => {
            signal.throwIfAborted();
            setVoiceState({ key: projectKey, phase: 'speaking', error: null });
          })
            .catch(error => { finished(); reject(error); });
        });
      }
      setVoiceState({ key: projectKey, phase: 'idle', error: null });
      return true;
    } catch (error) {
      if (!signal.aborted) setVoiceState({ key: projectKey, phase: 'error',
        error: error instanceof Error ? error.message : 'voice_failed' });
      return submitted;
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      if (voiceControllerRef.current === controller) {
        voiceControllerRef.current = null;
        voiceRecorderRef.current = null;
        voiceAudioRef.current?.pause();
        voiceAudioRef.current = null;
      }
    }
  }, [canvasProjectId, deckId, projectKey, requestMainText]);

  const stopVoiceSession = useCallback(() => {
    if (voiceRecorderRef.current?.state === 'recording') {
      voiceRecorderRef.current.stop();
      setVoiceState({ key: projectKey, phase: 'processing', error: null });
      return;
    }
    voiceControllerRef.current?.abort();
    voiceControllerRef.current = null;
    voiceAudioRef.current?.pause();
    setVoiceState({ key: projectKey, phase: 'idle', error: null });
  }, [projectKey]);

  const stopMainTurn = useCallback(async () => {
    if (!sessionPending || !canvasProjectId) return;
    if (!sessionIdRef.current) throw new Error('main_session_required');
    await stopSession({ projectId: canvasProjectId, deckId, sessionId: sessionIdRef.current });
    for (const [controller, active] of activeStreamsRef.current) {
      if (active.key !== projectKey) continue;
      controller.abort();
      activeStreamsRef.current.delete(controller);
    }
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
