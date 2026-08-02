import { useCallback, useEffect, useState } from 'react';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
import {
  loadSessionHistory,
  SessionStreamError,
  streamSession,
} from './openClaudeSessionClient';

export type AgentBuilderChatMessage = {
  role: 'assistant' | 'user';
  text: string;
};

type UseAgentBuilderMainChatArgs = {
  canvasProjectId: string;
  conversationId: string;
  initialMessages: AgentBuilderChatMessage[];
  workspaceView: string;
};

export default function useAgentBuilderMainChat({
  canvasProjectId,
  conversationId,
  initialMessages,
  workspaceView,
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
      .catch(() => {
        // A fresh project or history read failure leaves Main Chat usable.
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
          conversationId,
          message: trimmed,
          mode: workspaceView === 'canvas' ? 'canvas' : 'chat',
          onEvent: (event) => {
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
        return completedText || assistantText.trim();
      } catch (error: unknown) {
        if (error instanceof SessionStreamError) {
          const correlation = error.correlationId
            ? ` Correlation: ${error.correlationId}.`
            : '';
          appendAssistantText(
            `Chat failed (${error.code}).${correlation}`,
          );
        } else if (!(error instanceof Error && error.message === 'main_empty_response')) {
          appendAssistantText(
            'Chat request failed before the stream opened. Route: /api/coder/openclaude/session/chat.',
          );
        }
        throw error;
      } finally {
        setNativeSessionBusy(false);
      }
    },
    [
      canvasProjectId,
      conversationId,
      nativeSessionBusy,
      workspaceView,
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
