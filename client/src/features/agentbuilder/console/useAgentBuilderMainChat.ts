import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
import {
  EMPTY_HERMES_TERMINAL_STATE,
  reduceHermesTerminalEvent,
} from '../../../components/hermes/HermesConsole';
import type { HermesTerminalState } from '../../../components/hermes/HermesConsole';
import {
  graphObjectRefKey,
  type GraphObjectRef,
} from '../../../components/knowledge/GraphObjectContext';
import type { UnifiedProjectionIdentity } from '../../../components/knowledge/UnifiedGraphSurface';
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
  activeProjection: UnifiedProjectionIdentity | null;
  canvasProjectId: string;
  conversationId: string;
  initialMessages: AgentBuilderChatMessage[];
  pendingGraphObjectRef: GraphObjectRef | null;
  setPendingGraphObjectRef: Dispatch<SetStateAction<GraphObjectRef | null>>;
  workspaceView: string;
};

export default function useAgentBuilderMainChat({
  activeProjection,
  canvasProjectId,
  conversationId,
  initialMessages,
  pendingGraphObjectRef,
  setPendingGraphObjectRef,
  workspaceView,
}: UseAgentBuilderMainChatArgs) {
  const [nativeSessionBusy, setNativeSessionBusy] = useState(false);
  const [hermesTerminal, setHermesTerminal] = useState<HermesTerminalState>(
    EMPTY_HERMES_TERMINAL_STATE,
  );
  const [messages, setMessages] =
    useState<AgentBuilderChatMessage[]>(initialMessages);

  useEffect(() => {
    const projectId = canvasProjectId;
    if (!projectId) {
      setMessages([]);
      setHermesTerminal(EMPTY_HERMES_TERMINAL_STATE);
      return;
    }

    setHermesTerminal(EMPTY_HERMES_TERMINAL_STATE);
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

      const sentGraphObjectRef = pendingGraphObjectRef;
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
          ...(activeProjection?.role === 'main_chat'
            ? {
                projectionId: activeProjection.projectionId,
                ...(activeProjection.activeGraphViewId
                  ? { activeGraphViewId: activeProjection.activeGraphViewId }
                  : {}),
                ...(activeProjection.knowgraphScope
                  ? { knowgraphScope: activeProjection.knowgraphScope }
                  : {}),
              }
            : {}),
          ...(sentGraphObjectRef
            ? { selectedGraphObjectRefs: [sentGraphObjectRef] }
            : {}),
          onEvent: (event) => {
            setHermesTerminal((current) =>
              reduceHermesTerminalEvent(current, event),
            );
            if (event.kind === 'text') {
              appendAssistantText(
                String((event as { text?: unknown }).text || ''),
              );
            }
          },
        });
        if (sentGraphObjectRef) {
          setPendingGraphObjectRef((current) =>
            current &&
            graphObjectRefKey(current) ===
              graphObjectRefKey(sentGraphObjectRef)
              ? null
              : current,
          );
        }
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
        setHermesTerminal((current) =>
          reduceHermesTerminalEvent(current, {
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Hermes stream cancelled.',
          }),
        );
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
      activeProjection,
      canvasProjectId,
      conversationId,
      nativeSessionBusy,
      pendingGraphObjectRef,
      setPendingGraphObjectRef,
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
    hermesTerminal,
    messages,
    nativeSessionBusy,
    requestMainText,
    setMessages,
  };
}
