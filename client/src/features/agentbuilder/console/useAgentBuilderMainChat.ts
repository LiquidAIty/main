import { useCallback, useEffect, useRef, useState } from 'react';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
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
  dataAnchors?: LoadedCardGraphReference['reference'][];
  onUserTurnStarted?: (turn: MainChatTurnStarted) => void;
  onNativeTurnEvent?: (turn: MainChatTurnEvent) => void;
  onCardReviewStaged?: (review: StagedCardReviewLoaded) => void;
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

export type StagedCardReviewLoaded = {
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
  reviewContext: {
    resolvedNativeReads?: Array<Record<string, unknown>>;
    resolvedGraphProjection: GraphProjectionV1;
  };
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
  status: 'completed' | 'failed' | 'cancelled' | 'disconnected';
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

export function parseStagedCardReviewLoaded(
  output: unknown,
  depth = 0,
): StagedCardReviewLoaded | null {
  // Main can observe a configured child Card result wrapped by MCP content,
  // the backend result object, and the child's preserved native tool event.
  if (depth > 12 || output == null) return null;
  if (typeof output === 'string') {
    try {
      return parseStagedCardReviewLoaded(JSON.parse(output), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      const loaded = parseStagedCardReviewLoaded(item, depth + 1);
      if (loaded) return loaded;
    }
    return null;
  }
  if (typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  const reviewContext = record.reviewContext as Record<string, unknown> | undefined;
  const projection = reviewContext?.resolvedGraphProjection as Record<string, unknown> | undefined;
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
    && reviewContext != null
    && projection != null
    && Array.isArray(projection.nodes)
    && Array.isArray(projection.edges)
  ) {
    return {
      targetCardId: record.targetCardId,
      targetCardTitle: record.targetCardTitle,
      sourceCardId: record.sourceCardId,
      mission: record.mission,
      dataAnchors: anchors as StagedCardReviewLoaded['dataAnchors'],
      reviewContext: reviewContext as StagedCardReviewLoaded['reviewContext'],
    };
  }
  for (const key of ['content', 'result', 'structuredContent', 'text', 'output', 'nativeEvents']) {
    const loaded = parseStagedCardReviewLoaded(record[key], depth + 1);
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
  dataAnchors = [],
  onUserTurnStarted,
  onNativeTurnEvent,
  onCardReviewStaged,
  onCardGraphReferenceLoaded,
  onTurnFinished,
}: UseAgentBuilderMainChatArgs) {
  const conversationKey = `${canvasProjectId}\u0000${conversationId}`;
  const [transcript, setTranscript] = useState<{
    key: string;
    messages: AgentBuilderChatMessage[];
  }>({ key: conversationKey, messages: [] });
  const [historyState, setHistoryState] = useState<{
    key: string;
    loading: boolean;
  }>({ key: conversationKey, loading: Boolean(canvasProjectId) });
  const [turnState, setTurnState] = useState<{
    key: string;
    phase: 'idle' | 'connecting' | 'active';
  }>({ key: conversationKey, phase: 'idle' });
  const activeStreamRef = useRef<{
    key: string;
    controller: AbortController;
  } | null>(null);

  const messages = transcript.key === conversationKey ? transcript.messages : [];
  const nativeSessionActive = turnState.key === conversationKey && turnState.phase === 'active';
  const nativeSessionConnecting = turnState.key === conversationKey
    && turnState.phase === 'connecting';
  const nativeSessionPending = nativeSessionActive || nativeSessionConnecting;
  const sessionHistoryLoading = historyState.key === conversationKey && historyState.loading;

  useEffect(() => {
    const projectId = canvasProjectId;
    const priorStream = activeStreamRef.current;
    if (priorStream && priorStream.key !== conversationKey) {
      priorStream.controller.abort();
      activeStreamRef.current = null;
    }
    setTranscript({ key: conversationKey, messages: [] });
    setTurnState({ key: conversationKey, phase: 'idle' });
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
            message: 'LiquidAIty backend did not become ready in time.',
            route: '/api/health',
          });
        }
        return loadSessionHistory({
          projectId,
          conversationId,
          signal: controller.signal,
        });
      })
      .then((history) => {
        if (cancelled || !history) return;
        setTranscript({ key: conversationKey, messages: history });
        setHistoryState({ key: conversationKey, loading: false });
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
        setHistoryState({ key: conversationKey, loading: false });
      })

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canvasProjectId, conversationId, conversationKey]);

  const requestMainText = useCallback(
    async (text: string): Promise<string> => {
      if (!text.trim()) throw new Error('main_prompt_empty');
      if (!canvasProjectId) {
        setTurnState({ key: conversationKey, phase: 'idle' });
        throw new Error('main_project_required');
      }
      if (nativeSessionPending) throw new Error('main_session_busy');

      setTranscript((current) => ({
        key: conversationKey,
        messages: [
          ...(current.key === conversationKey ? current.messages : []),
          { role: 'user', text },
        ],
      }));
      const runId = createRunId();
      notifyObserver(onUserTurnStarted, {
        projectId: canvasProjectId,
        conversationId,
        runId,
        text,
        observedAt: new Date().toISOString(),
      });
      const streamController = new AbortController();
      activeStreamRef.current = { key: conversationKey, controller: streamController };
      setTurnState({ key: conversationKey, phase: 'connecting' });

      let assistantStarted = false;
      const appendModelText = (chunk: string) => {
        if (!chunk) return;
        assistantStarted = true;
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          const copy = [...current.messages];
          const last = copy[copy.length - 1];
          if (last?.role === 'assistant') {
            copy[copy.length - 1] = {
              role: 'assistant',
              text: last.text + chunk,
            };
          } else {
            copy.push({ role: 'assistant', text: chunk });
          }
          return { key: conversationKey, messages: copy };
        });
      };
      const finalizeModelText = (nativeFinalText: string) => {
        assistantStarted = true;
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          const copy = [...current.messages];
          const last = copy[copy.length - 1];
          if (last?.role === 'assistant') {
            copy[copy.length - 1] = { role: 'assistant', text: nativeFinalText };
          } else {
            copy.push({ role: 'assistant', text: nativeFinalText });
          }
          return { key: conversationKey, messages: copy };
        });
      };

      try {
        const { finalText } = await streamSession({
          projectId: canvasProjectId,
          deckId,
          conversationId,
          message: text,
          dataAnchors: dataAnchors.map((anchor) => ({
            authority: anchor.authority,
            nativeId: anchor.nativeId,
            reason: anchor.reason,
            priority: anchor.order === 0 ? 0 : -anchor.order,
            boundedExpansion: anchor.boundedExpansion,
            resultLimit: anchor.resultLimit,
            required: anchor.required,
          })),
          signal: streamController.signal,
          onEvent: (event) => {
            if (event.kind === 'session' || event.kind === 'text') {
              setTurnState((current) => current.key === conversationKey
                ? { ...current, phase: 'active' }
                : current);
            }
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
              const loaded = parseStagedCardReviewLoaded(event.output);
              if (loaded) notifyObserver(onCardReviewStaged, loaded);
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
              appendModelText(
                String((event as { text?: unknown }).text || ''),
              );
            }
          },
        });
        const completedText = finalText;
        if (!completedText.trim()) {
          setTurnState({ key: conversationKey, phase: 'idle' });
          throw new Error('main_empty_response');
        }
        // The native completion text is the exact persisted Hermes assistant
        // message. Replace the in-progress streamed bubble with those bytes so
        // the completed UI and a later history read are identical.
        finalizeModelText(completedText);
        notifyObserver(onTurnFinished, {
          projectId: canvasProjectId,
          conversationId,
          runId,
          status: 'completed',
          observedAt: new Date().toISOString(),
        });
        return completedText;
      } catch (error: unknown) {
        const disconnected = streamController.signal.aborted;
        const cancelled = error instanceof SessionStreamError && error.code === 'harness_turn_cancelled';
        notifyObserver(onTurnFinished, {
          projectId: canvasProjectId,
          conversationId,
          runId,
          status: disconnected ? 'disconnected' : cancelled ? 'cancelled' : 'failed',
          observedAt: new Date().toISOString(),
        });
        if (assistantStarted) {
          setTranscript((current) => {
            if (current.key !== conversationKey) return current;
            const copy = [...current.messages];
            if (copy[copy.length - 1]?.role === 'assistant') copy.pop();
            return { key: conversationKey, messages: copy };
          });
        }
        throw error;
      } finally {
        if (activeStreamRef.current?.controller === streamController) {
          activeStreamRef.current = null;
          setTurnState((current) => current.key === conversationKey
            ? { ...current, phase: 'idle' }
            : current);
        }
      }
    },
    [
      canvasProjectId,
      conversationId,
      conversationKey,
      dataAnchors,
      deckId,
      nativeSessionPending,
      onNativeTurnEvent,
      onCardReviewStaged,
      onCardGraphReferenceLoaded,
      onTurnFinished,
      onUserTurnStarted,
    ],
  );

  const handleNativeSend = useCallback(
    (text: string) => {
      void requestMainText(text).catch(() => {
        // Native failure remains transport telemetry and never transcript text.
      });
    },
    [requestMainText],
  );

  const stopMainTurn = useCallback(async () => {
    if (!nativeSessionPending || !canvasProjectId) return;
    try {
      await stopSession({ projectId: canvasProjectId, deckId, conversationId });
    } catch (error) {
      if (error instanceof SessionStreamError && error.code === 'no_active_turn') {
        activeStreamRef.current?.controller.abort();
        activeStreamRef.current = null;
        setTurnState({ key: conversationKey, phase: 'idle' });
        return;
      }
      setTurnState({ key: conversationKey, phase: 'idle' });
      throw error;
    }
  }, [canvasProjectId, conversationId, conversationKey, deckId, nativeSessionPending]);

  return {
    handleNativeSend,
    messages,
    nativeSessionActive,
    nativeSessionConnecting,
    sessionHistoryLoading,
    requestMainText,
    stopMainTurn,
  };
}
