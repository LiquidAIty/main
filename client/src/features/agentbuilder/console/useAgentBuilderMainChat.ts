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
  onMagOneInstructionsProposed?: (proposal: MagOneInstructionsProposal) => void;
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

export type MagOneInstructionsProposal = {
  targetCardId: string;
  instructions: string;
  deckRevision?: string | null;
  proposalHash?: string;
  existingWorkerCardIds?: string[];
  approvalRequired?: boolean;
  proposal?: {
    goal?: string;
    completionCriteria?: string[];
    graphReferences?: Array<{
      authority: string;
      nativeId: string;
      reason: string;
      provenance?: Record<string, unknown>;
    }>;
    requestedOutputFormat?: string;
    boundaries?: string[];
    workers?: Array<Record<string, unknown>>;
    cardsToCreate?: Array<Record<string, unknown>>;
    cardsToUpdate?: Array<Record<string, unknown>>;
    wiresToAdd?: Array<Record<string, unknown>>;
    wiresToRemove?: Array<Record<string, unknown>>;
    estimatedModelCalls?: number;
    costRisk?: string;
    graphResultsTruncated?: boolean;
  };
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
    console.warn('[NATIVE_GRAPH_ATTENTION_OBSERVER]', error);
  }
}

export function parseMagOneInstructionsProposal(
  output: unknown,
  depth = 0,
): MagOneInstructionsProposal | null {
  if (depth > 8 || output == null) return null;
  if (typeof output === 'string') {
    try {
      return parseMagOneInstructionsProposal(JSON.parse(output), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      const proposal = parseMagOneInstructionsProposal(item, depth + 1);
      if (proposal) return proposal;
    }
    return null;
  }
  if (typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  if (
    record.ok === true
    && record.persisted === false
    && record.started === false
    && typeof record.targetCardId === 'string'
    && record.targetCardId.length > 0
    && typeof record.instructions === 'string'
    && record.instructions.trim().length > 0
  ) {
    return {
      targetCardId: record.targetCardId,
      instructions: record.instructions,
      ...(typeof record.deckRevision === 'string' ? { deckRevision: record.deckRevision } : {}),
      ...(typeof record.proposalHash === 'string' ? { proposalHash: record.proposalHash } : {}),
      ...(Array.isArray(record.existingWorkerCardIds) ? {
        existingWorkerCardIds: record.existingWorkerCardIds.filter(
          (value): value is string => typeof value === 'string',
        ),
      } : {}),
      ...(record.approvalRequired === true ? { approvalRequired: true } : {}),
      ...(record.proposal && typeof record.proposal === 'object' && !Array.isArray(record.proposal)
        ? { proposal: record.proposal as MagOneInstructionsProposal['proposal'] }
        : {}),
    };
  }
  for (const key of ['content', 'result', 'structuredContent', 'text', 'output']) {
    const proposal = parseMagOneInstructionsProposal(record[key], depth + 1);
    if (proposal) return proposal;
  }
  return null;
}

export default function useAgentBuilderMainChat({
  canvasProjectId,
  deckId,
  conversationId,
  initialMessages,
  onUserTurnStarted,
  onNativeTurnEvent,
  onMagOneInstructionsProposed,
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
            if (
              event.kind === 'tool_result'
              && event.toolName === 'write_mag_one_instructions'
              && event.isError !== true
            ) {
              const proposal = parseMagOneInstructionsProposal(event.output);
              if (proposal) notifyObserver(onMagOneInstructionsProposed, proposal);
            }
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
      onMagOneInstructionsProposed,
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
