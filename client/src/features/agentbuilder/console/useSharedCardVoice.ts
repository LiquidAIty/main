import { useCallback, useEffect, useRef, useState } from 'react';

import {
  stopVoiceCapture,
  streamVoiceCapture,
} from './sharedChatVoiceClient';
import type { SharedChatParticipant } from './sharedChatClient';

export type SharedCardVoicePhase =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

type SharedCardVoiceTarget = {
  targetCardId: string | null;
  participant: SharedChatParticipant;
};

type UseSharedCardVoiceArgs = {
  canvasProjectId: string;
  deckId: string;
  conversationId: string;
  conversationKey: string;
  mainCardId: string;
  selectedTargetCardId: string | null;
  sessionHistoryLoading: boolean;
  sessionPending: boolean;
  resolveTarget: () => SharedCardVoiceTarget;
  submitTranscript: (
    text: string,
    targetCardId: string | null,
    participant: SharedChatParticipant,
  ) => Promise<string>;
};

export default function useSharedCardVoice({
  canvasProjectId,
  deckId,
  conversationId,
  conversationKey,
  mainCardId,
  selectedTargetCardId,
  sessionHistoryLoading,
  sessionPending,
  resolveTarget,
  submitTranscript,
}: UseSharedCardVoiceArgs) {
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
    phase: SharedCardVoicePhase;
    error: string | null;
  }>({ key: conversationKey, phase: 'idle', error: null });

  const endVoiceSession = useCallback(async (
    nextPhase: SharedCardVoicePhase = 'idle',
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

    const { targetCardId, participant } = resolveTarget();
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
        void submitTranscript(transcriptText, targetCardId, participant)
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
    endVoiceSession,
    mainCardId,
    resolveTarget,
    sessionHistoryLoading,
    sessionPending,
    submitTranscript,
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

  useEffect(() => {
    const active = activeVoiceRef.current;
    if (!active || active.key !== conversationKey) return;
    if (active.targetCardId !== selectedTargetCardId) void endVoiceSession();
  }, [conversationKey, endVoiceSession, selectedTargetCardId]);

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

  return {
    startVoiceSession,
    stopVoiceSession,
    voiceError: voiceState.key === conversationKey ? voiceState.error : null,
    voicePhase: voiceState.key === conversationKey ? voiceState.phase : 'idle',
  };
}
