import { useCallback, useEffect, useRef, useState } from 'react';

import { waitForBackendReady } from '../api/backendReadiness';
import {
  loadSessionHistory,
  type MainHermesSessionEvent,
  SessionStreamError,
  subscribeSessionEvents,
} from './sharedChatClient';
import {
  reconcileHistory,
  type SharedCardChatMessage,
} from './sharedChatTranscript';

export type SharedChatTranscriptState = {
  key: string;
  messages: SharedCardChatMessage[];
};

export type SharedChatTechnicalState = {
  key: string;
  error: string | null;
};

export function useSharedCardChatHistory({
  canvasProjectId,
  deckId,
  conversationId,
  conversationKey,
}: {
  canvasProjectId: string;
  deckId: string;
  conversationId: string;
  conversationKey: string;
}) {
  const [technical, setTechnical] = useState<SharedChatTechnicalState>({
    key: conversationKey,
    error: null,
  });
  const [transcript, setTranscript] = useState<SharedChatTranscriptState>({
    key: conversationKey,
    messages: [],
  });
  const [historyState, setHistoryState] = useState<{
    key: string;
    loading: boolean;
  }>({ key: conversationKey, loading: Boolean(canvasProjectId) });
  const [sharedAuthority, setSharedAuthority] = useState<{
    key: string;
    mainCardId: string;
  }>({ key: conversationKey, mainCardId: '' });
  const sessionEventsRef = useRef<{
    key: string;
    liveSessionId: string;
    close: () => void;
  } | null>(null);

  const subscribeToHermesSession = useCallback((liveSessionId: string) => {
    if (!canvasProjectId || !liveSessionId) return;
    const existing = sessionEventsRef.current;
    if (
      existing?.key === conversationKey
      && existing.liveSessionId === liveSessionId
    ) return;
    existing?.close();
    const close = subscribeSessionEvents({
      projectId: canvasProjectId,
      deckId,
      conversationId,
      liveSessionId,
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
        }
        if (event.type === 'error') {
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
    sessionEventsRef.current = { key: conversationKey, liveSessionId, close };
  }, [canvasProjectId, conversationId, conversationKey, deckId]);

  useEffect(() => {
    const projectId = canvasProjectId;
    const priorSessionEvents = sessionEventsRef.current;
    if (priorSessionEvents && priorSessionEvents.key !== conversationKey) {
      priorSessionEvents.close();
      sessionEventsRef.current = null;
    }
    setTranscript({ key: conversationKey, messages: [] });
    setSharedAuthority({ key: conversationKey, mainCardId: '' });
    setTechnical({ key: conversationKey, error: null });

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
        });
        setTechnical({
          key: conversationKey,
          error: null,
        });
        setHistoryState({ key: conversationKey, loading: false });
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
        setHistoryState({ key: conversationKey, loading: false });
        setTechnical((current) => current.key === conversationKey
          ? { ...current, error: current.error || 'Conversation unavailable. Reload to retry.' }
          : current);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (sessionEventsRef.current?.key === conversationKey) {
        sessionEventsRef.current.close();
        sessionEventsRef.current = null;
      }
    };
  }, [canvasProjectId, conversationId, conversationKey, deckId, subscribeToHermesSession]);

  return {
    messages: transcript.key === conversationKey ? transcript.messages : [],
    mainCardId: sharedAuthority.key === conversationKey ? sharedAuthority.mainCardId : '',
    sessionHistoryLoading: historyState.key === conversationKey && historyState.loading,
    technicalError: technical.key === conversationKey ? technical.error : null,
    setTechnical,
    setTranscript,
    subscribeToHermesSession,
  };
}
