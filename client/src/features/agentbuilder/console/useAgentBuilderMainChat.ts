import { useCallback, useEffect, useState } from 'react';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
import type { StandaloneCardTestResult } from '../../../components/AgentManager';
import type { GraphProjectionV1 } from '../../../components/knowledge/NativeAuthorityGraphSurface';
import {
  loadSessionHistory,
  type NativeSessionEvent,
  SessionStreamError,
  stopSession,
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
  dataAnchors?: LoadedCardGraphReference['reference'][];
  onUserTurnStarted?: (turn: MainChatTurnStarted) => void;
  onNativeTurnEvent?: (turn: MainChatTurnEvent) => void;
  onCardInvocationStaged?: (invocation: StagedCardInvocationLoaded) => void;
  onCardGraphReferenceLoaded?: (context: LoadedCardGraphReference) => void;
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

export type StagedCardInvocationLoaded = {
  targetCardId: string;
  targetCardTitle: string;
  sourceCardId: string;
  mission: string;
  dataAnchors: Array<{
    authority: 'ThinkGraph' | 'KnowGraph' | 'CodeGraph';
    nativeId: string;
    reason: string;
    priority: number;
    boundedExpansion: number;
    resultLimit: number;
    required: true;
  }>;
  invocation: NonNullable<StandaloneCardTestResult['invocation']>;
};

export type LoadedCardGraphReference = {
  targetCardId: string;
  sourceCardId?: string;
  sourceRunId?: string;
  reference: {
    authority: 'ThinkGraph' | 'KnowGraph' | 'CodeGraph';
    nativeId: string;
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
  attentionObserved?: boolean;
  observedAt?: string;
  error?: string;
};

export type MainChatTurnFinished = {
  projectId: string;
  conversationId: string;
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
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

export function parseStagedCardInvocationLoaded(
  output: unknown,
  depth = 0,
): StagedCardInvocationLoaded | null {
  // Main can observe a configured child Card result wrapped by MCP content,
  // the backend result object, and the child's preserved native tool event.
  if (depth > 12 || output == null) return null;
  if (typeof output === 'string') {
    try {
      return parseStagedCardInvocationLoaded(JSON.parse(output), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      const loaded = parseStagedCardInvocationLoaded(item, depth + 1);
      if (loaded) return loaded;
    }
    return null;
  }
  if (typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  const invocation = record.invocation as Record<string, unknown> | undefined;
  const projection = invocation?.resolvedGraphProjection as Record<string, unknown> | undefined;
  const anchors = Array.isArray(record.dataAnchors) ? record.dataAnchors : [];
  if (
    record.ok === true
    && record.ready === true
    && record.persisted === false
    && record.started === false
    && typeof record.targetCardId === 'string'
    && record.targetCardId.length > 0
    && typeof record.targetCardTitle === 'string'
    && typeof record.sourceCardId === 'string'
    && record.sourceCardId.length > 0
    && typeof record.mission === 'string'
    && record.mission.trim().length > 0
    && anchors.length > 0
    && anchors.every((anchor) => {
      if (!anchor || typeof anchor !== 'object') return false;
      const value = anchor as Record<string, unknown>;
      return ['ThinkGraph', 'KnowGraph', 'CodeGraph'].includes(String(value.authority))
        && typeof value.nativeId === 'string' && value.nativeId.length > 0
        && typeof value.reason === 'string' && value.reason.length > 0
        && Number.isInteger(value.priority)
        && Number.isInteger(value.boundedExpansion)
        && Number.isInteger(value.resultLimit)
        && value.required === true;
    })
    && invocation != null
    && invocation.idf != null
    && projection != null
    && Array.isArray(projection.nodes)
    && Array.isArray(projection.edges)
    && (projection.nodes.length > 0 || projection.edges.length > 0)
  ) {
    return {
      targetCardId: record.targetCardId,
      targetCardTitle: record.targetCardTitle,
      sourceCardId: record.sourceCardId,
      mission: record.mission,
      dataAnchors: anchors as StagedCardInvocationLoaded['dataAnchors'],
      invocation: invocation as StagedCardInvocationLoaded['invocation'],
    };
  }
  for (const key of ['content', 'result', 'structuredContent', 'text', 'output', 'nativeEvents']) {
    const loaded = parseStagedCardInvocationLoaded(record[key], depth + 1);
    if (loaded) return loaded;
  }
  return null;
}

export function parseLoadedCardGraphReference(
  output: unknown,
  depth = 0,
): LoadedCardGraphReference | null {
  if (depth > 12 || output == null) return null;
  if (typeof output === 'string') {
    try {
      return parseLoadedCardGraphReference(JSON.parse(output), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      const loaded = parseLoadedCardGraphReference(item, depth + 1);
      if (loaded) return loaded;
    }
    return null;
  }
  if (typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  const reference = record.reference;
  const referenceRecord = reference && typeof reference === 'object' && !Array.isArray(reference)
    ? reference as Record<string, unknown>
    : null;
  const graphProjection = record.graphProjection;
  const graphProjectionRecord = graphProjection
    && typeof graphProjection === 'object'
    && !Array.isArray(graphProjection)
    ? graphProjection as Record<string, unknown>
    : null;
  if (
    typeof record.targetCardId === 'string'
    && record.targetCardId.length > 0
    && referenceRecord
    && ['ThinkGraph', 'KnowGraph', 'CodeGraph'].includes(String(referenceRecord.authority))
    && typeof referenceRecord.nativeId === 'string'
    && typeof referenceRecord.reason === 'string'
    && Number.isInteger(referenceRecord.order)
    && Number.isInteger(referenceRecord.boundedExpansion)
    && Number.isInteger(referenceRecord.resultLimit)
    && typeof referenceRecord.required === 'boolean'
    && typeof record.ready === 'boolean'
    && graphProjectionRecord
    && Array.isArray(graphProjectionRecord.nodes)
    && Array.isArray(graphProjectionRecord.edges)
    && typeof graphProjectionRecord.projectId === 'string'
    && record.persisted === false
    && record.started === false
  ) {
    return {
      targetCardId: record.targetCardId,
      ...(typeof record.sourceCardId === 'string' ? { sourceCardId: record.sourceCardId } : {}),
      ...(typeof record.sourceRunId === 'string' ? { sourceRunId: record.sourceRunId } : {}),
      reference: referenceRecord as LoadedCardGraphReference['reference'],
      resolvedReferences: Array.isArray(record.resolvedReferences)
        ? record.resolvedReferences.filter(
            (value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
          )
        : [],
      resolvedContextMarkdown: typeof record.resolvedContextMarkdown === 'string'
        ? record.resolvedContextMarkdown
        : '',
      graphProjection: graphProjectionRecord as GraphProjectionV1,
      resolved: record.resolved === true,
      ready: record.ready,
      ...(typeof record.attentionObserved === 'boolean'
        ? { attentionObserved: record.attentionObserved }
        : {}),
      ...(typeof record.observedAt === 'string' ? { observedAt: record.observedAt } : {}),
      ...(typeof record.error === 'string' ? { error: record.error } : {}),
    };
  }
  for (const key of ['content', 'result', 'structuredContent', 'text', 'output', 'nativeEvents']) {
    const loaded = parseLoadedCardGraphReference(record[key], depth + 1);
    if (loaded) return loaded;
  }
  return null;
}

export default function useAgentBuilderMainChat({
  canvasProjectId,
  deckId,
  conversationId,
  initialMessages,
  dataAnchors = [],
  onUserTurnStarted,
  onNativeTurnEvent,
  onCardInvocationStaged,
  onCardGraphReferenceLoaded,
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
          dataAnchors: dataAnchors.map((anchor) => ({
            authority: anchor.authority,
            nativeId: anchor.nativeId,
            reason: anchor.reason,
            priority: anchor.order === 0 ? 0 : -anchor.order,
            boundedExpansion: anchor.boundedExpansion,
            resultLimit: anchor.resultLimit,
            required: anchor.required,
          })),
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
              && event.isError !== true
              && typeof event.toolName === 'string'
              && ['write_mag_one_instructions', 'card.run_assistant_agent'].includes(event.toolName)
            ) {
              const loaded = parseStagedCardInvocationLoaded(event.output);
              if (loaded) notifyObserver(onCardInvocationStaged, loaded);
            }
            if (
              event.kind === 'tool_result'
              && event.isError !== true
              && typeof event.toolName === 'string'
              && ['card.load_graph_references', 'card.run_assistant_agent'].includes(event.toolName)
            ) {
              const loaded = parseLoadedCardGraphReference(event.output);
              if (loaded) notifyObserver(onCardGraphReferenceLoaded, loaded);
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
        const cancelled = error instanceof SessionStreamError && error.code === 'harness_turn_cancelled';
        notifyObserver(onTurnFinished, {
          projectId: canvasProjectId,
          conversationId,
          runId,
          status: cancelled ? 'cancelled' : 'failed',
          observedAt: new Date().toISOString(),
        });
        if (error instanceof SessionStreamError) {
          if (cancelled) {
            appendAssistantText('Chat run stopped.');
            throw error;
          }
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
      dataAnchors,
      deckId,
      nativeSessionBusy,
      onNativeTurnEvent,
      onCardInvocationStaged,
      onCardGraphReferenceLoaded,
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

  const stopMainTurn = useCallback(async () => {
    if (!nativeSessionBusy || !canvasProjectId) return;
    await stopSession({ projectId: canvasProjectId, deckId, conversationId });
  }, [canvasProjectId, conversationId, deckId, nativeSessionBusy]);

  return {
    handleNativeSend,
    messages,
    nativeSessionBusy,
    requestMainText,
    setMessages,
    stopMainTurn,
  };
}
