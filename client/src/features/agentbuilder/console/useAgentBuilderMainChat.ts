import { useCallback, useEffect, useState } from 'react';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
import {
  loadSessionHistory,
  type NativeSessionEvent,
  SessionStreamError,
  streamSession,
} from './mainSessionClient';

export type AgentBuilderChatMessage = {
  role: 'assistant' | 'user';
  text: string;
};

type UseAgentBuilderMainChatArgs = {
  canvasProjectId: string;
  deckId: string;
  conversationId: string;
  initialMessages: AgentBuilderChatMessage[];
  workspaceView: string;
  onUserTurnStarted?: (turn: MainChatTurnStarted) => void;
  onNativeTurnEvent?: (turn: MainChatTurnEvent) => void;
  onTurnFinished?: (turn: MainChatTurnFinished) => void;
};

export type MainChatTurnStarted = {
  projectId: string;
  conversationId: string;
  runId: string;
  text: string;
  observedAt: string;
};

export type MainChatTurnEvent = {
  projectId: string;
  conversationId: string;
  runId: string;
  event: NativeSessionEvent;
  observedAt: string;
};

export type MainChatTurnFinished = {
  projectId: string;
  conversationId: string;
  runId: string;
  status: 'completed' | 'failed';
  observedAt: string;
};

function createRunId(): string {
  return globalThis.crypto?.randomUUID?.() || `main-turn-${Date.now()}`;
}

function notifyObserver<T>(observer: ((value: T) => void) | undefined, value: T): void {
  try {
    observer?.(value);
  } catch (error) {
    console.warn('[THINKGRAPH_LIVE_OBSERVER]', error);
  }
}

export default function useAgentBuilderMainChat({
  canvasProjectId,
  deckId,
  conversationId,
  initialMessages,
  onUserTurnStarted,
  onNativeTurnEvent,
  onTurnFinished,
}: UseAgentBuilderMainChatArgs) {
  const [nativeSessionBusy, setNativeSessionBusy] = useState(false);
  const [messages, setMessages] =
    useState<AgentBuilderChatMessage[]>(initialMessages);

  useEffect(() => {
    const projectId = canvasProjectId;
    if (!projectId) {
      setMessages([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    waitForBackendReady({ signal: controller.signal })
      .then((ready) => {
        if (cancelled || !ready) return;
        return loadSessionHistory({
          projectId,
          conversationId,
          signal: controller.signal,
        });
      })
      .then((history) => {
        if (cancelled || !history) return;
        setMessages(history);
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        const detail = error instanceof Error ? error.message : String(error);
        setMessages([
          {
            role: 'assistant',
            text: `Conversation history failed to load: ${detail}`,
          },
        ]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canvasProjectId, conversationId]);

  const requestMainText = useCallback(
    async (text: string): Promise<string> => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('main_prompt_empty');
      if (!canvasProjectId) {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            text: 'Select or create a project before chatting.',
          },
        ]);
        throw new Error('main_project_required');
      }
      if (nativeSessionBusy) throw new Error('main_session_busy');

      setMessages((current) => [
        ...current,
        { role: 'user', text: trimmed },
      ]);
      const runId = createRunId();
      notifyObserver(onUserTurnStarted, {
        projectId: canvasProjectId,
        conversationId,
        runId,
        text: trimmed,
        observedAt: new Date().toISOString(),
      });
      setNativeSessionBusy(true);

      let assistantStarted = false;
      let assistantText = '';
      const appendAssistantText = (chunk: string) => {
        if (!chunk) return;
        assistantStarted = true;
        assistantText += chunk;
        setMessages((current) => {
          const copy = [...current];
          const last = copy[copy.length - 1];
          if (last?.role === 'assistant') {
            copy[copy.length - 1] = {
              role: 'assistant',
              text: last.text + chunk,
            };
          } else {
            copy.push({ role: 'assistant', text: chunk });
          }
          return copy;
        });
      };

      try {
        const { finalText } = await streamSession({
          projectId: canvasProjectId,
          deckId,
          conversationId,
          message: trimmed,
          onEvent: (event) => {
            notifyObserver(onNativeTurnEvent, {
              projectId: canvasProjectId,
              conversationId,
              runId,
              event,
              observedAt: new Date().toISOString(),
            });
            if (event.kind === 'text') {
              appendAssistantText(
                String((event as { text?: unknown }).text || ''),
              );
            }
          },
        });
        const completedText = finalText.trim();
        if (!assistantStarted && completedText) {
          appendAssistantText(completedText);
        } else if (!assistantStarted) {
          const emptyMessage =
            'The chat completed without an assistant response. Please try again.';
          appendAssistantText(emptyMessage);
          throw new Error('main_empty_response');
        }
        notifyObserver(onTurnFinished, {
          projectId: canvasProjectId,
          conversationId,
          runId,
          status: 'completed',
          observedAt: new Date().toISOString(),
        });
        return completedText || assistantText.trim();
      } catch (error: unknown) {
        notifyObserver(onTurnFinished, {
          projectId: canvasProjectId,
          conversationId,
          runId,
          status: 'failed',
          observedAt: new Date().toISOString(),
        });
        if (error instanceof SessionStreamError) {
          const correlation = error.correlationId
            ? ` Correlation: ${error.correlationId}.`
            : '';
          appendAssistantText(
            `Chat failed (${error.code}).${correlation}`,
          );
        } else if (!(error instanceof Error && error.message === 'main_empty_response')) {
          const detail = error instanceof Error ? error.message : String(error);
          appendAssistantText(`Chat request failed before the stream opened: ${detail}`);
        }
        throw error;
      } finally {
        setNativeSessionBusy(false);
      }
    },
    [
      canvasProjectId,
      conversationId,
      deckId,
      nativeSessionBusy,
      onNativeTurnEvent,
      onTurnFinished,
      onUserTurnStarted,
    ],
  );

  const handleNativeSend = useCallback(
    (text: string) => {
      void requestMainText(text).catch(() => {
        // requestMainText already renders the canonical chat error.
      });
    },
    [requestMainText],
  );

  return {
    handleNativeSend,
    messages,
    nativeSessionBusy,
    requestMainText,
    setMessages,
  };
}
