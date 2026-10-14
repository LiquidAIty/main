import { useCallback, useEffect, useRef, useState } from 'react';

import {
  stopMainVoiceCapture,
  streamMainVoiceCapture,
} from './mainVoiceClient';

export type MainVoicePhase = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export default function useMainBotVoice({
  canvasProjectId,
  deckId,
  conversationId,
  conversationKey,
  mainCardId,
  sessionHistoryLoading,
  sessionPending,
  submitTranscript,
}: {
  canvasProjectId: string;
  deckId: string;
  conversationId: string;
  conversationKey: string;
  mainCardId: string;
  sessionHistoryLoading: boolean;
  sessionPending: boolean;
  submitTranscript: (text: string) => Promise<string>;
}) {
  const activeRef = useRef<{
    key: string;
    controller: AbortController;
    hasTranscript: boolean;
    turnFinished: boolean;
    sawSpeaking: boolean;
    speechIdle: boolean;
    tts: boolean;
    audioAvailable: boolean | null;
  } | null>(null);
  const [voiceState, setVoiceState] = useState<{
    key: string;
    phase: MainVoicePhase;
    error: string | null;
  }>({ key: conversationKey, phase: 'idle', error: null });

  const endVoice = useCallback(async (
    phase: MainVoicePhase = 'idle',
    error: string | null = null,
  ) => {
    const active = activeRef.current;
    activeRef.current = null;
    active?.controller.abort();
    setVoiceState({ key: conversationKey, phase, error });
    if (!canvasProjectId) return;
    await stopMainVoiceCapture({
      projectId: canvasProjectId,
      deckId,
      conversationId,
      cancel: true,
    }).catch(() => undefined);
  }, [canvasProjectId, conversationId, conversationKey, deckId]);

  const startVoice = useCallback(() => {
    if (!canvasProjectId || !mainCardId || sessionHistoryLoading) {
      setVoiceState({
        key: conversationKey,
        phase: 'error',
        error: 'Voice is unavailable until Main is ready.',
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
    if (activeRef.current?.key === conversationKey) return;

    const controller = new AbortController();
    const active = {
      key: conversationKey,
      controller,
      hasTranscript: false,
      turnFinished: false,
      sawSpeaking: false,
      speechIdle: false,
      tts: true,
      audioAvailable: null as boolean | null,
    };
    activeRef.current = active;
    setVoiceState({ key: conversationKey, phase: 'processing', error: null });

    void streamMainVoiceCapture({
      projectId: canvasProjectId,
      deckId,
      conversationId,
      signal: controller.signal,
      onEvent: (event) => {
        const current = activeRef.current;
        if (!current || current.controller !== controller || current.key !== conversationKey) return;
        if (event.cardId !== mainCardId) {
          void endVoice('error', 'Voice connected to the wrong Card.');
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
          void endVoice('error', event.error || 'Voice transport failed.');
          return;
        }
        if (event.kind === 'status') {
          const phase = String(event.event?.payload?.state || '').toLowerCase();
          if (phase === 'listening' || phase === 'recording') {
            setVoiceState({ key: conversationKey, phase: 'listening', error: null });
          } else if (phase === 'transcribing' || phase === 'processing' || phase === 'interrupted') {
            setVoiceState({ key: conversationKey, phase: 'processing', error: null });
          } else if (phase === 'speaking') {
            current.sawSpeaking = true;
            setVoiceState({ key: conversationKey, phase: 'speaking', error: null });
          } else if (phase === 'idle') {
            if (current.sawSpeaking) current.speechIdle = true;
            if (current.hasTranscript && current.turnFinished && current.speechIdle) {
              void endVoice();
            } else if (!current.sawSpeaking) {
              setVoiceState({ key: conversationKey, phase: 'processing', error: null });
            }
          }
          return;
        }
        const payload = event.event?.payload || {};
        if (payload.stop_phrase === true) {
          void endVoice();
          return;
        }
        if (payload.no_speech_limit === true) {
          void endVoice('error', 'No speech was detected.');
          return;
        }
        const transcript = String(payload.text || '').trim();
        if (!transcript || current.hasTranscript) return;
        current.hasTranscript = true;
        setVoiceState({ key: conversationKey, phase: 'processing', error: null });
        void submitTranscript(transcript).then(() => {
          const latest = activeRef.current;
          if (!latest || latest.controller !== controller) return;
          latest.turnFinished = true;
          if (!latest.tts || latest.audioAvailable === false || latest.speechIdle) {
            void endVoice();
          }
        }).catch((error: unknown) => {
          if (controller.signal.aborted) return;
          void endVoice(
            'error',
            error instanceof Error ? error.message : 'Voice turn failed.',
          );
        });
      },
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      void endVoice(
        'error',
        error instanceof Error ? error.message : 'Voice transport failed.',
      );
    });
  }, [
    canvasProjectId,
    conversationId,
    conversationKey,
    deckId,
    endVoice,
    mainCardId,
    sessionHistoryLoading,
    sessionPending,
    submitTranscript,
  ]);

  const stopVoice = useCallback(async () => {
    const active = activeRef.current;
    if (!active || active.key !== conversationKey || !canvasProjectId) return;
    const phase = voiceState.key === conversationKey ? voiceState.phase : 'idle';
    if (phase === 'listening') {
      setVoiceState({ key: conversationKey, phase: 'processing', error: null });
      try {
        await stopMainVoiceCapture({
          projectId: canvasProjectId,
          deckId,
          conversationId,
          cancel: false,
        });
      } catch (error) {
        await endVoice(
          'error',
          error instanceof Error ? error.message : 'Voice stop failed.',
        );
      }
      return;
    }
    await endVoice();
  }, [
    canvasProjectId,
    conversationId,
    conversationKey,
    deckId,
    endVoice,
    voiceState.key,
    voiceState.phase,
  ]);

  useEffect(() => () => {
    const active = activeRef.current;
    if (!active || active.key !== conversationKey) return;
    activeRef.current = null;
    active.controller.abort();
    if (canvasProjectId) {
      void stopMainVoiceCapture({
        projectId: canvasProjectId,
        deckId,
        conversationId,
        cancel: true,
      }).catch(() => undefined);
    }
  }, [canvasProjectId, conversationId, conversationKey, deckId]);

  return {
    startVoice,
    stopVoice,
    voiceError: voiceState.key === conversationKey ? voiceState.error : null,
    voicePhase: voiceState.key === conversationKey ? voiceState.phase : 'idle',
  };
}
