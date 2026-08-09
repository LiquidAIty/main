import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/NativeAuthorityGraphSurface';
import type {
  MainChatTurnEvent,
  MainChatTurnFinished,
  MainChatTurnStarted,
} from '../console/useAgentBuilderMainChat';

type ProjectionStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ThinkGraphProjectionState = {
  status: ProjectionStatus;
  projection: GraphProjectionV1 | null;
  error: string | null;
  startLiveTurn: (turn: MainChatTurnStarted) => void;
  observeLiveTurnEvent: (turn: MainChatTurnEvent) => void;
  finishLiveTurn: (turn: MainChatTurnFinished) => void;
};

type StoredProjectionState = {
  status: ProjectionStatus;
  projection: GraphProjectionV1 | null;
  error: string | null;
};

type LiveSource = 'user' | 'assistant' | 'reasoning' | 'tool';

type LiveTurn = {
  projectId: string;
  conversationId: string;
  runId: string;
  observedAt: string;
  streams: Map<LiveSource, { sourceId: string; text: string }>;
};

const STREAM_COALESCE_MS = 150;
const MAX_SOURCE_TEXT = 6_000;

function withPresentationState(
  projection: GraphProjectionV1,
  state: 'active' | 'settled',
): GraphProjectionV1 {
  return {
    ...projection,
    nodes: projection.nodes.map((node) => ({
      ...node,
      currentState: state,
      properties: { ...node.properties, state },
    })),
    edges: projection.edges.map((edge) => ({
      ...edge,
      properties: { ...edge.properties, state },
    })),
  };
}

/** Pure presentation merge. Neither authoritative input projection is mutated. */
export function mergeThinkGraphProjections(
  durable: GraphProjectionV1 | null,
  transient: GraphProjectionV1 | null,
): GraphProjectionV1 | null {
  if (!transient) return durable;
  if (!durable) return transient;
  const durableIds = new Set(durable.nodes.map((node) => node.id));
  const transientNodes = transient.nodes.filter((node) => !durableIds.has(node.id));
  const transientIds = new Set(transientNodes.map((node) => node.id));
  const transientEdges = transient.edges.filter((edge) => (
    transientIds.has(edge.source) && transientIds.has(edge.target)
  ));
  const nodes = [
    ...durable.nodes.map((node) => ({
      ...node,
      properties: {
        ...node.properties,
        presentationLayer: 'durable-background',
      },
    })),
    ...transientNodes,
  ];
  const edges = [
    ...durable.edges.map((edge) => ({ ...edge })),
    ...transientEdges,
  ];
  return {
    ...durable,
    schemaVersion: 'thinkgraph.merged.presentation.v1',
    counts: { nodes: nodes.length, edges: edges.length },
    nodes,
    edges,
  };
}

function appendBounded(current: string, chunk: string): string {
  if (!chunk) return current;
  return `${current}${chunk}`.slice(-MAX_SOURCE_TEXT);
}

export default function useAgentBuilderThinkGraphProjection({
  activeProject,
  knowledgeGraphKind,
  workspaceView,
}: {
  activeProject: string;
  knowledgeGraphKind: string;
  workspaceView: string;
}): ThinkGraphProjectionState {
  const [durable, setDurable] = useState<StoredProjectionState>({
    status: 'idle',
    projection: null,
    error: null,
  });
  const [transient, setTransient] = useState<GraphProjectionV1 | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveTurnRef = useRef<LiveTurn | null>(null);
  const coalesceTimerRef = useRef<number | null>(null);
  const controllersRef = useRef(new Set<AbortController>());
  const requestSequenceRef = useRef(0);
  const latestIssuedSequenceRef = useRef(0);

  const cancelLiveRequests = useCallback(() => {
    if (coalesceTimerRef.current != null) {
      window.clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = null;
    }
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    latestIssuedSequenceRef.current = ++requestSequenceRef.current;
  }, []);

  const requestLiveProjection = useCallback((state: 'active' | 'settled') => {
    const turn = liveTurnRef.current;
    if (!turn) return;
    const sequence = ++requestSequenceRef.current;
    latestIssuedSequenceRef.current = sequence;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const streams = [...turn.streams.entries()]
      .filter(([, stream]) => stream.text.trim().length > 0)
      .map(([source, stream]) => ({ source, ...stream }));
    void (async () => {
      try {
        const response = await fetch('/api/thinkgraph/live-projection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            projectId: turn.projectId,
            conversationId: turn.conversationId,
            runId: turn.runId,
            observedAt: turn.observedAt,
            state,
            streams,
            maxNodes: 24,
            maxEdges: 40,
          }),
        });
        const data = await response.json().catch(() => null);
        if (controller.signal.aborted || sequence !== latestIssuedSequenceRef.current) return;
        if (!response.ok || !data || typeof data !== 'object') {
          throw new Error(String((data as any)?.error || `HTTP ${response.status}`));
        }
        setTransient(data as GraphProjectionV1);
        setLiveError(null);
      } catch (error: any) {
        if (controller.signal.aborted || sequence !== latestIssuedSequenceRef.current) return;
        setLiveError(String(error?.message || error));
      } finally {
        controllersRef.current.delete(controller);
      }
    })();
  }, []);

  const scheduleLiveProjection = useCallback(() => {
    if (coalesceTimerRef.current != null) return;
    coalesceTimerRef.current = window.setTimeout(() => {
      coalesceTimerRef.current = null;
      requestLiveProjection('active');
    }, STREAM_COALESCE_MS);
  }, [requestLiveProjection]);

  const startLiveTurn = useCallback((turn: MainChatTurnStarted) => {
    cancelLiveRequests();
    setTransient(null);
    setLiveError(null);
    liveTurnRef.current = {
      projectId: turn.projectId,
      conversationId: turn.conversationId,
      runId: turn.runId,
      observedAt: turn.observedAt,
      streams: new Map([
        ['user', { sourceId: `${turn.runId}:user`, text: turn.text.slice(-MAX_SOURCE_TEXT) }],
      ]),
    };
    requestLiveProjection('active');
  }, [cancelLiveRequests, requestLiveProjection]);

  const observeLiveTurnEvent = useCallback((turn: MainChatTurnEvent) => {
    const current = liveTurnRef.current;
    if (!current || current.runId !== turn.runId) return;
    const source: LiveSource | null = turn.event.kind === 'reasoning'
      ? 'reasoning'
      : turn.event.kind === 'text'
        ? 'assistant'
        : null;
    if (!source) return;
    const chunk = typeof turn.event.text === 'string' ? turn.event.text : '';
    if (!chunk) return;
    const existing = current.streams.get(source) || {
      sourceId: `${turn.runId}:${source}`,
      text: '',
    };
    current.streams.set(source, {
      ...existing,
      text: appendBounded(existing.text, chunk),
    });
    current.observedAt = turn.observedAt;
    scheduleLiveProjection();
  }, [scheduleLiveProjection]);

  const finishLiveTurn = useCallback((turn: MainChatTurnFinished) => {
    const current = liveTurnRef.current;
    if (!current || current.runId !== turn.runId) return;
    if (coalesceTimerRef.current != null) {
      window.clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = null;
    }
    current.observedAt = turn.observedAt;
    setTransient((projection) => (
      projection ? withPresentationState(projection, 'settled') : projection
    ));
    requestLiveProjection('settled');
  }, [requestLiveProjection]);

  useEffect(() => () => cancelLiveRequests(), [cancelLiveRequests]);

  useEffect(() => {
    const current = liveTurnRef.current;
    if (!current || current.projectId === activeProject) return;
    cancelLiveRequests();
    liveTurnRef.current = null;
    setTransient(null);
    setLiveError(null);
  }, [activeProject, cancelLiveRequests]);

  // Explicit durable projection refresh only. Ordinary Main completion does not
  // imply an Engraphis write and therefore emits no refresh event.
  const [thinkGraphRefreshNonce, setThinkGraphRefreshNonce] = useState(0);
  useEffect(() => {
    const refresh = () => setThinkGraphRefreshNonce((nonce) => nonce + 1);
    window.addEventListener('thinkgraph:refresh', refresh);
    return () => window.removeEventListener('thinkgraph:refresh', refresh);
  }, []);
  const durableProjectionJsonRef = useRef<string | null>(null);
  useEffect(() => {
    if (workspaceView !== 'knowledge' || knowledgeGraphKind !== 'thinkgraph') return;
    const projectId = activeProject;
    if (!projectId) {
      durableProjectionJsonRef.current = null;
      setDurable({ status: 'idle', projection: null, error: null });
      return;
    }
    const controller = new AbortController();
    setDurable((previous) => ({
      ...previous,
      status: previous.projection ? previous.status : 'loading',
      error: null,
    }));
    void (async () => {
      try {
        const response = await fetch(
          `/api/thinkgraph/projection?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        );
        const data = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !data || typeof data !== 'object') {
          durableProjectionJsonRef.current = null;
          setDurable({
            status: 'error',
            projection: null,
            error: String((data as any)?.error || `HTTP ${response.status}`),
          });
          return;
        }
        const json = JSON.stringify(data);
        if (json === durableProjectionJsonRef.current) return;
        durableProjectionJsonRef.current = json;
        setDurable({
          status: 'ready',
          projection: data as GraphProjectionV1,
          error: null,
        });
      } catch (error: any) {
        if (controller.signal.aborted) return;
        durableProjectionJsonRef.current = null;
        setDurable({
          status: 'error',
          projection: null,
          error: String(error?.message || error),
        });
      }
    })();
    return () => controller.abort();
  }, [activeProject, knowledgeGraphKind, workspaceView, thinkGraphRefreshNonce]);

  const projection = useMemo(
    () => mergeThinkGraphProjections(durable.projection, transient),
    [durable.projection, transient],
  );
  const status: ProjectionStatus = liveError
    ? 'error'
    : projection
      ? 'ready'
      : durable.status;

  return {
    status,
    projection,
    error: liveError || durable.error,
    startLiveTurn,
    observeLiveTurnEvent,
    finishLiveTurn,
  };
}
