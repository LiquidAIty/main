import { useCallback, useEffect, useRef, useState } from 'react';
import { reconcileTerminalEvents, type CardTerminalEvent } from './AdaptiveCardTerminal';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
import type { GraphProjectionV1 } from '../../../components/knowledge/NativeAuthorityGraphSurface';
import {
  loadSessionHistory,
  loadMainDriverStatus,
  type MainDriverSource,
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
  const [technical, setTechnical] = useState<{ key: string; events: CardTerminalEvent[]; error: string | null }>({
    key: conversationKey, events: [], error: null,
  });
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
    runId: string | null;
  } | null>(null);
  const observedProjectionIdsRef = useRef<{ key: string; ids: Set<string> }>({
    key: conversationKey,
    ids: new Set(),
  });

  const messages = transcript.key === conversationKey ? transcript.messages : [];
  const nativeSessionActive = turnState.key === conversationKey && turnState.phase === 'active';
  const nativeSessionConnecting = turnState.key === conversationKey
    && turnState.phase === 'connecting';
  const nativeSessionPending = nativeSessionActive || nativeSessionConnecting;
  const sessionHistoryLoading = historyState.key === conversationKey && historyState.loading;
  const [mainDriverSource, setMainDriverSource] = useState<MainDriverSource | null>(null);

  useEffect(() => {
    if (!canvasProjectId) {
      setMainDriverSource(null);
      return;
    }
    const controller = new AbortController();
    const refresh = () => {
      void loadMainDriverStatus(controller.signal)
        .then((status) => setMainDriverSource(status.activeDriver))
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [canvasProjectId]);

  useEffect(() => {
    const projectId = canvasProjectId;
    const priorStream = activeStreamRef.current;
    if (priorStream && priorStream.key !== conversationKey) {
      priorStream.controller.abort();
      activeStreamRef.current = null;
    }
    setTranscript({ key: conversationKey, messages: [] });
    setTechnical({ key: conversationKey, events: [], error: null });
    observedProjectionIdsRef.current = { key: conversationKey, ids: new Set() };
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
        setTranscript({ key: conversationKey, messages: history.messages });
        setTechnical({
          key: conversationKey,
          events: reconcileTerminalEvents(history.terminalEvents),
          error: null,
        });
        observedProjectionIdsRef.current = {
          key: conversationKey,
          ids: new Set(history.terminalEvents.map((event) => event.id)),
        };
        setHistoryState({ key: conversationKey, loading: false });
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
        setHistoryState({ key: conversationKey, loading: false });
        setTechnical((current) => current.key === conversationKey
          ? { ...current, error: current.error || 'conversation_history_read_failed' } : current);
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
      let runId: string | null = null;
      setTechnical({ key: conversationKey, events: [], error: null });
      const streamController = new AbortController();
      activeStreamRef.current = { key: conversationKey, controller: streamController, runId: null };
      setTurnState({ key: conversationKey, phase: 'connecting' });

      const appendModelText = (chunk: string) => {
        if (!chunk) return;
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
            const projection = event.projection;
            const publicEvent = event.terminalEvent as CardTerminalEvent | undefined;
            const observedRunId = typeof event.runId === 'string' ? event.runId : publicEvent?.runId;
            if ((event.projectId && event.projectId !== canvasProjectId)
              || (event.deckId && event.deckId !== deckId)
              || (event.conversationId && event.conversationId !== conversationId)
              || (publicEvent && (publicEvent.projectId !== canvasProjectId || publicEvent.deckId !== deckId))
              || (observedRunId && runId && observedRunId !== runId)
              || (publicEvent && observedRunId && publicEvent.runId !== observedRunId)) {
              throw new SessionStreamError({ code: 'main_run_identity_mismatch', message: 'Main stream Run identity changed.' });
            }
            if (projection?.id) {
              const observed = observedProjectionIdsRef.current;
              if (observed.key !== conversationKey) {
                observedProjectionIdsRef.current = { key: conversationKey, ids: new Set() };
              } else if (observed.ids.has(projection.id)) {
                return;
              }
              observedProjectionIdsRef.current.ids.add(projection.id);
            }
            // UI pending state is local; graph/Run identity is issued only by
            // the canonical backend Run, never a second browser-generated ID.
            if (observedRunId && !runId) {
              runId = observedRunId;
              if (activeStreamRef.current?.controller === streamController) {
                activeStreamRef.current.runId = runId;
              }
              notifyObserver(onUserTurnStarted, { projectId: canvasProjectId, conversationId,
                runId, text, observedAt: new Date().toISOString() });
            }
            if (publicEvent?.projectId === canvasProjectId && publicEvent.deckId === deckId
              && publicEvent.cardId && publicEvent.runId && publicEvent.id
              && publicEvent.category?.startsWith('execution.')) {
              setTechnical((current) => current.key === conversationKey
                ? { ...current, events: reconcileTerminalEvents([...current.events, publicEvent]) } : current);
            }
            if (event.kind === 'session' || event.kind === 'text'
              || projection?.category === 'conversation.answer') {
              setTurnState((current) => current.key === conversationKey
                ? { ...current, phase: 'active' }
                : current);
            }
            if (runId) notifyObserver(onNativeTurnEvent, {
              projectId: canvasProjectId,
              conversationId,
              runId,
              event,
              observedAt: new Date().toISOString(),
            });
            if (
              ((event.kind === 'tool_result' && event.isError !== true)
                || (projection
                  && ['execution.tool', 'execution.command'].includes(projection.category)
                  && projection.status === 'completed'))
              && typeof (projection?.toolName || event.toolName) === 'string'
              && ['write_mag_one_instructions', 'card.run_assistant_agent'].includes(
                String(projection?.toolName || event.toolName),
              )
            ) {
              const loaded = parseStagedCardReviewLoaded(projection?.detail || event.output);
              if (loaded) notifyObserver(onCardReviewStaged, loaded);
            }
            if (
              ((event.kind === 'tool_result' && event.isError !== true)
                || (projection
                  && ['execution.tool', 'execution.command'].includes(projection.category)
                  && projection.status === 'completed'))
              && typeof (projection?.toolName || event.toolName) === 'string'
              && ['card.load_graph_references', 'card.run_assistant_agent'].includes(
                String(projection?.toolName || event.toolName),
              )
            ) {
              const loaded = parseLoadedCardGraphReference(projection?.detail || event.output);
              if (loaded) notifyObserver(onCardGraphReferenceLoaded, loaded);
            }
            if (projection?.category === 'conversation.answer' && projection.status === 'completed') {
              finalizeModelText(projection.text || '');
            } else if (projection?.category === 'conversation.answer') {
              appendModelText(projection.text || '');
            } else if (event.kind === 'text') {
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
        if (runId) notifyObserver(onTurnFinished, {
          projectId: canvasProjectId,
          conversationId,
          runId,
          status: 'completed',
          observedAt: new Date().toISOString(),
        });
        return completedText;
      } catch (error: unknown) {
        setTranscript((current) => {
          if (current.key !== conversationKey) return current;
          const messages = [...current.messages];
          if (messages[messages.length - 1]?.role === 'assistant') messages.pop();
          return { key: conversationKey, messages };
        });
        setTechnical((current) => current.key === conversationKey ? { ...current,
          error: error instanceof SessionStreamError ? error.code : 'main_turn_failed',
        } : current);
        const disconnected = streamController.signal.aborted;
        const cancelled = error instanceof SessionStreamError
          && ['harness_turn_cancelled', 'main_cli_turn_cancelled'].includes(error.code);
        if (runId) notifyObserver(onTurnFinished, {
          projectId: canvasProjectId,
          conversationId,
          runId,
          status: disconnected ? 'disconnected' : cancelled ? 'cancelled' : 'failed',
          observedAt: new Date().toISOString(),
        });
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
    const active = activeStreamRef.current;
    const expectedRunId = active?.key === conversationKey ? active.runId : null;
    if (!expectedRunId) {
      throw new SessionStreamError({
        code: 'expected_run_id_required',
        message: 'The accepted Main Run identity is not available yet.',
        route: '/api/coder/main/session/stop',
      });
    }
    try {
      await stopSession({
        projectId: canvasProjectId,
        deckId,
        conversationId,
        expectedRunId,
      });
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
    technicalEvents: technical.key === conversationKey ? technical.events : [],
    technicalError: technical.key === conversationKey ? technical.error : null,
    handleNativeSend,
    messages,
    mainDriverSource,
    nativeSessionActive,
    nativeSessionConnecting,
    sessionHistoryLoading,
    requestMainText,
    stopMainTurn,
  };
}
