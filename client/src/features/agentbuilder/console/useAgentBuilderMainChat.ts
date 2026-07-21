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

  const handleNativeSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!canvasProjectId) {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            text: 'Select or create a project before chatting.',
          },
        ]);
        return;
      }
      if (nativeSessionBusy) return;

      const sentGraphObjectRef = pendingGraphObjectRef;
      setMessages((current) => [
        ...current,
        { role: 'user', text: trimmed },
      ]);
      setNativeSessionBusy(true);

      let assistantStarted = false;
      const appendAssistantText = (chunk: string) => {
        if (!chunk) return;
        assistantStarted = true;
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

      void streamSession({
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
      })
        .then(({ finalText }) => {
          setNativeSessionBusy(false);
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
            appendAssistantText(
              'The chat completed without an assistant response. Please try again.',
            );
          }
        })
        .catch((error: unknown) => {
          setNativeSessionBusy(false);
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
            return;
          }
          appendAssistantText(
            'Chat request failed before the stream opened. Route: /api/coder/openclaude/session/chat.',
          );
        });
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

  return {
    handleNativeSend,
    hermesTerminal,
    messages,
    nativeSessionBusy,
    setMessages,
  };
}
