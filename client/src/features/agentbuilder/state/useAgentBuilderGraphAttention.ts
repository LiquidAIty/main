import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ContextualNodeReadView,
  GraphProjectionEdge,
  GraphProjectionNode,
  GraphProjectionV1,
  ReadContextualNode,
} from '../../../components/knowledge/NativeAuthorityGraphSurface';
import { applyJevGraphPhysics } from '../../../components/knowledge/jevGraphPhysics';
import { callCbmTool, CANONICAL_CBM_PROJECT_NAME } from '../../../components/codegraph/resolveCodeGraphProjectIdentity';
import {
  isJevAttentionEvent,
  type JevAttentionCandidate,
  type JevAttentionEvent,
} from '../console/mainSessionClient';
import type {
  MainChatTurnEvent,
  MainChatTurnFinished,
  MainChatTurnStarted,
} from '../console/useAgentBuilderMainChat';

export type GraphAttentionAuthority = 'thinkgraph' | 'knowgraph' | 'codegraph';
export type NativeNeighborhoodAuthority = Extract<GraphAttentionAuthority, 'thinkgraph' | 'knowgraph'>;

export type JevAttentionVisualPhase = 'attention_space' | 'local_relational';
export type JevAttentionVisualResolution = 'resolving' | 'resolved' | 'unavailable';

export type JevAttentionVisualSubject = {
  choiceId: string;
  authority: JevAttentionCandidate['authority'];
  nativeId: string;
  title: string;
  probability: number;
  selected: true;
  hydrated: boolean;
  resolution: JevAttentionVisualResolution;
};

export type JevAttentionVisualDescriptor = {
  decisionId: string;
  resultIdentity: string;
  clientRunId: string;
  runId: string;
  cardId: string;
  phase: JevAttentionVisualPhase;
  active: boolean;
  terminalStatus: MainChatTurnFinished['status'] | null;
  distribution: Record<string, number>;
  candidates: JevAttentionCandidate[];
  selectedSubjects: JevAttentionVisualSubject[];
};

type AttentionContext = {
  actorCardId: string | null;
  actorColor: string;
  toolName: string;
  operation?: 'read' | 'write';
  eventId?: string;
  timestamp?: string;
  runId?: string | null;
  resultHash?: string;
};

export type NativeAttentionEdge = {
  id: string;
  source: string;
  target: string;
  predicate: string | null;
  provenance?: Record<string, unknown>;
};

export type NativeAttentionEvent = {
  kind: 'native_attention';
  eventId: string;
  timestamp: string;
  projectId: string | null;
  deckId: string | null;
  conversationId: string | null;
  runId: string | null;
  cardId: string | null;
  authority: GraphAttentionAuthority | 'agentgraph';
  operation: 'read' | 'write';
  toolName: string;
  nativeNodeIds: string[];
  nativeEdgeIds: string[];
  nativeEdges: NativeAttentionEdge[];
  resultHash: string;
  truncated: boolean;
  persisted?: boolean;
  phase?: 'pending' | 'completed' | 'failed';
  change?: 'read' | 'write' | 'create' | 'delete' | 'clear';
  nativeChildId?: string | null;
  nativeRunId?: string | null;
  rootRunId?: string | null;
  runState?: string;
  scopeGroupIds?: string[];
};

export type NativeAttentionSession = {
  projectId: string; deckId: string; cardId: string; runId: string | null;
  state: string | null; nativeChildId?: string | null; rootRunId?: string | null;
  materializedNativeReferences?: Array<{ authority: string; nativeId: string }>;
};

export type ThinkGraphRevisionEvent = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: 'settled';
  revision: string;
  changedNodeIds: string[];
  changedEdgeIds: string[];
  affectedNodeIds: string[];
  turnHeat: Record<string, number>;
  topActiveNodes: Array<{ nativeId: string; turnHeat: number }>;
};

export type ThinkGraphLifecycleError = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: 'prepare' | 'thinkgraph_card' | 'settle';
  error: string;
};

type ExpandRequest = {
  authority: GraphAttentionAuthority;
  node: GraphProjectionNode;
  projectId: string;
  codeGraphProject: string | null;
  readerCardId?: string | null;
};

export type GraphAttentionState = {
  refreshThinkGraph: (revision?: ThinkGraphRevisionEvent) => Promise<void>;
  removeThinkGraphEvidence: (memoryId: string) => Promise<void>;
  projections: Record<GraphAttentionAuthority, GraphProjectionV1>;
  errors: Partial<Record<GraphAttentionAuthority, string>>;
  statuses: Record<GraphAttentionAuthority, 'idle' | 'loading' | 'ready' | 'error'>;
  jevAttentionVisual: JevAttentionVisualDescriptor | null;
  startAttentionScope: (turn: MainChatTurnStarted) => void;
  observeNativeTurnEvent: (turn: MainChatTurnEvent) => void;
  finishAttentionScope: (turn: MainChatTurnFinished) => void;
  observeAttentionEvent: (event: NativeAttentionEvent) => void;
  observeAttentionSession: (session: NativeAttentionSession) => void;
  observeThinkGraphRevision: (event: ThinkGraphRevisionEvent) => void;
  observeThinkGraphFailure: (event: ThinkGraphLifecycleError) => void;
  readNativeNeighborhood: (
    authority: NativeNeighborhoodAuthority,
    nativeId: string,
    signal?: AbortSignal,
  ) => Promise<GraphProjectionV1>;
  readContextualNode: ReadContextualNode;
  expandNode: (request: ExpandRequest) => Promise<void>;
};

const CARD_ACTIVE_COLOR = '#37ADAA';
const WRITE_ATTENTION_COLOR = '#EE8C66';
const UNKNOWN_ACTOR_COLOR = '#8B95A7';

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function attentionProperties(
  native: Record<string, unknown>,
  context?: AttentionContext,
): Record<string, unknown> {
  if (!context) return native;
  return {
    ...native,
    attentionActorCardId: context.actorCardId,
    attentionActorColor: context.actorColor,
    attentionToolName: context.toolName,
    ...(context.operation ? { attentionOperation: context.operation } : {}),
    ...(context.eventId ? { attentionEventId: context.eventId } : {}),
    ...(context.timestamp ? { attentionTimestamp: context.timestamp } : {}),
    ...(context.runId ? { attentionRunId: context.runId } : {}),
    ...(context.resultHash ? { attentionResultHash: context.resultHash } : {}),
    attentionActive: true,
  };
}

function projection(
  authority: GraphAttentionAuthority,
  projectId: string,
  nodes: GraphProjectionNode[] = [],
  edges: GraphProjectionEdge[] = [],
): GraphProjectionV1 {
  return {
    schemaVersion: `${authority}.attention.projection.v1`,
    authority,
    projectId,
    counts: { nodes: nodes.length, edges: edges.length },
    nodes,
    edges,
  };
}

/**
 * Translate persisted Jev probabilities into the renderer's existing numeric
 * contract. This is local display physics: it never calls Jev or changes graph
 * meaning. Node mass is the sum of current/live incident edge weights.
 */
export function applyKnowGraphJevPhysics(value: GraphProjectionV1): GraphProjectionV1 {
  return applyJevGraphPhysics(value, 'balanced');
}

export function knowGraphProjection(payload: Record<string, any>, projectId: string): GraphProjectionV1 {
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.relationships)
    || payload.nodes.some((node: any) => !isRecord(node) || typeof node.id !== 'string' || !node.id || typeof node.label !== 'string')
    || payload.relationships.some((edge: any) => !isRecord(edge) || typeof edge.id !== 'string' || !edge.id
      || typeof edge.from !== 'string' || !edge.from || typeof edge.to !== 'string' || !edge.to
      || typeof edge.type !== 'string' || !edge.type)) {
    throw new Error('invalid_knowgraph_projection');
  }
  return applyKnowGraphJevPhysics(projection(
    'knowgraph',
    projectId,
    payload.nodes,
    payload.relationships.map((edge: any) => ({
      ...edge, source: edge.from, target: edge.to, predicate: edge.type,
    })),
  ));
}

function exactThinkGraphProjection(
  payload: Record<string, any>,
  projectId: string,
  nativeId: string,
): GraphProjectionV1 | null {
  if (payload.schemaVersion !== 'thinkgraph.engraphis.v1'
    || payload.authority !== 'engraphis'
    || payload.projectId !== projectId
    || !Array.isArray(payload.nodes)
    || !Array.isArray(payload.edges)
    || payload.nodes.some((node: unknown) => !isRecord(node)
      || typeof node.id !== 'string' || !node.id
      || typeof node.label !== 'string' || !node.label)
    || payload.edges.some((edge: unknown) => !isRecord(edge)
      || typeof edge.id !== 'string' || !edge.id
      || typeof edge.source !== 'string' || !edge.source
      || typeof edge.target !== 'string' || !edge.target
      || typeof edge.predicate !== 'string' || !edge.predicate)) return null;
  const projection = payload as GraphProjectionV1;
  return projection.nodes.some((node) => node.id === nativeId) ? projection : null;
}

export function mergeAttentionProjection(
  current: GraphProjectionV1,
  incoming: GraphProjectionV1,
): GraphProjectionV1 {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  for (const node of incoming.nodes) nodes.set(node.id, { ...nodes.get(node.id), ...node });
  const visibleNodeIds = new Set(nodes.keys());
  const edges = new Map(current.edges.map((edge) => [edge.id, edge]));
  for (const edge of incoming.edges) {
    if (visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) {
      edges.set(edge.id, { ...edges.get(edge.id), ...edge });
    }
  }
  const merged = {
    ...current,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    counts: { nodes: nodes.size, edges: edges.size },
  };
  return merged.authority === 'knowgraph'
    ? applyKnowGraphJevPhysics(merged)
    : merged;
}

function mergeMissingAttentionProjection(
  current: GraphProjectionV1,
  incoming: GraphProjectionV1,
): GraphProjectionV1 {
  const nodeIds = new Set(current.nodes.map((node) => node.id));
  const nodes = [
    ...current.nodes,
    ...incoming.nodes.filter((node) => !nodeIds.has(node.id)),
  ];
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(current.edges.map((edge) => edge.id));
  const edges = [
    ...current.edges,
    ...incoming.edges.filter((edge) => !edgeIds.has(edge.id)
      && visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
  ];
  const merged = {
    ...current,
    nodes,
    edges,
    counts: { nodes: nodes.length, edges: edges.length },
  };
  return merged.authority === 'knowgraph'
    ? applyKnowGraphJevPhysics(merged)
    : merged;
}

type GraphHighlight = {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  context: AttentionContext;
  active?: boolean;
};

type JevAttentionGraphAuthority = 'thinkgraph' | 'knowgraph';

type ExactJevAttentionOverlay = {
  scopeGeneration: number;
  clientRunId: string;
  serverRunId: string;
  refreshGeneration: number;
  projection: GraphProjectionV1;
  highlight: GraphHighlight;
};

export function overlayAuthoritativeGraphAttention(
  authoritative: GraphProjectionV1,
  attention: GraphHighlight | GraphProjectionV1,
): GraphProjectionV1 {
  if ('nodes' in attention) {
    const retain = <T extends GraphProjectionNode | GraphProjectionEdge>(records: T[], previous: T[]): T[] => {
      const byId = new Map(previous.map(record => [record.id, record]));
      return records.map(record => {
        const properties = byId.get(record.id)?.properties;
        if (!properties) return record;
        const highlights = Object.fromEntries(Object.entries(properties).filter(([key]) => key.startsWith('attention')));
        return { ...record, properties: { ...record.properties, ...highlights } };
      });
    };
    return { ...authoritative,
      nodes: retain(authoritative.nodes, attention.nodes),
      edges: retain(authoritative.edges, attention.edges),
    };
  }
  const nodeIds = new Set(attention.nodeIds);
  const edgeIds = new Set(attention.edgeIds);
  const decorate = <T extends GraphProjectionNode | GraphProjectionEdge>(record: T): T => ({
    ...record,
    properties: { ...attentionProperties(record.properties || {}, attention.context), attentionActive: attention.active !== false },
  });
  return {
    ...authoritative,
    nodes: authoritative.nodes.map(node => nodeIds.has(node.id) ? decorate(node) : node),
    edges: authoritative.edges.map(edge => edgeIds.has(edge.id) ? decorate(edge) : edge),
  };
}

export function overlayThinkGraphTurnActivity(
  authoritative: GraphProjectionV1,
  event: ThinkGraphRevisionEvent,
): GraphProjectionV1 {
  const affected = new Set(event.affectedNodeIds);
  const active = new Set(event.topActiveNodes.slice(0, 5).map((item) => item.nativeId));
  const decorate = (node: GraphProjectionNode): GraphProjectionNode => {
    const memberIds = Array.isArray((node as any).member_ids)
      ? (node as any).member_ids.map(String)
      : [node.id];
    const heat = memberIds.reduce(
      (total: number, nativeId: string) => total + Number(event.turnHeat[nativeId] || 0),
      0,
    );
    const localResettle = memberIds.some((nativeId: string) => affected.has(nativeId));
    const turnHeatActive = memberIds.some((nativeId: string) => active.has(nativeId));
    return {
      ...node,
      turn_heat: heat,
      turn_heat_active: turnHeatActive,
      local_resettle: localResettle,
      properties: {
        ...node.properties,
        turnHeat: heat,
        turnHeatActive,
        localResettle,
      },
    } as GraphProjectionNode;
  };
  return {
    ...authoritative,
    nodes: authoritative.nodes.map(decorate),
    ...(authoritative.scene ? {
      scene: {
        ...authoritative.scene,
        nodes: authoritative.scene.nodes.map(decorate),
      },
    } : {}),
  };
}

function emptyAttention(projectId: string): Record<GraphAttentionAuthority, GraphProjectionV1> {
  return {
    thinkgraph: projection('thinkgraph', projectId),
    knowgraph: projection('knowgraph', projectId),
    codegraph: projection('codegraph', projectId),
  };
}

export default function useAgentBuilderGraphAttention({
  projectId,
  deckId,
  conversationId,
  selectedCardId = null,
}: {
  projectId: string;
  deckId: string;
  conversationId: string;
  selectedCardId?: string | null;
}): GraphAttentionState {
  const [projections, setProjections] = useState(() => emptyAttention(projectId));
  const [errors, setErrors] = useState<Partial<Record<GraphAttentionAuthority, string>>>({});
  const [statuses, setStatuses] = useState<Record<GraphAttentionAuthority, 'idle' | 'loading' | 'ready' | 'error'>>({
    thinkgraph: 'loading', knowgraph: 'loading', codegraph: 'ready',
  });
  const [jevAttentionVisual, setJevAttentionVisual] = useState<JevAttentionVisualDescriptor | null>(null);
  const jevAttentionVisualRef = useRef<JevAttentionVisualDescriptor | null>(null);
  const activeScopeRef = useRef<{ clientRunId: string; serverRunId: string | null } | null>(null);
  const seenEventIdsRef = useRef(new Set<string>());
  const selectedRunRef = useRef<string | null>(null);
  const mainActorRef = useRef<string | null>(null);
  const authoritativeThinkGraphRef = useRef<GraphProjectionV1>(projection('thinkgraph', projectId));
  const thinkGraphRequestRef = useRef(0);
  const seenThinkGraphRevisionsRef = useRef(new Set<string>());
  const authoritativeKnowGraphRef = useRef<GraphProjectionV1>(projection('knowgraph', projectId));
  const knowGraphRequestRef = useRef(0);
  const codeGraphScopeRef = useRef(0);
  const graphScopeGenerationRef = useRef(0);
  const pendingJevAttentionLoadsRef = useRef(new Set<string>());
  const exactJevAttentionOverlaysRef = useRef<Record<
    JevAttentionGraphAuthority,
    Map<string, ExactJevAttentionOverlay>
  >>({ thinkgraph: new Map(), knowgraph: new Map() });

  const replaceJevAttentionVisual = useCallback((next: JevAttentionVisualDescriptor | null) => {
    jevAttentionVisualRef.current = next;
    setJevAttentionVisual(next);
  }, []);

  const updateJevAttentionVisual = useCallback((
    update: (current: JevAttentionVisualDescriptor | null) => JevAttentionVisualDescriptor | null,
  ) => {
    const current = jevAttentionVisualRef.current;
    const next = update(current);
    if (next === current) return;
    jevAttentionVisualRef.current = next;
    setJevAttentionVisual(next);
  }, []);

  const updateJevAttentionResolution = useCallback(({
    clientRunId,
    serverRunId,
    decisionId,
    authority,
    nativeId,
    resolution,
    scopeGeneration,
  }: {
    clientRunId: string;
    serverRunId: string;
    decisionId: string;
    authority: JevAttentionCandidate['authority'];
    nativeId: string;
    resolution: JevAttentionVisualResolution;
    scopeGeneration: number;
  }) => {
    if (scopeGeneration !== graphScopeGenerationRef.current) return;
    updateJevAttentionVisual((current) => {
      if (!current
        || current.clientRunId !== clientRunId
        || current.runId !== serverRunId
        || current.decisionId !== decisionId) return current;
      let changed = false;
      const selectedSubjects = current.selectedSubjects.map((subject) => {
        if (subject.authority !== authority
          || subject.nativeId !== nativeId
          || subject.resolution === resolution) return subject;
        changed = true;
        return { ...subject, resolution };
      });
      return changed ? { ...current, selectedSubjects } : current;
    });
  }, [updateJevAttentionVisual]);

  const transitionJevAttentionToLocal = useCallback((
    clientRunId: string,
    serverRunId: string | null,
  ) => {
    if (!serverRunId) return;
    updateJevAttentionVisual((current) => current
      && current.active
      && current.clientRunId === clientRunId
      && current.runId === serverRunId
      && current.phase === 'attention_space'
      ? { ...current, phase: 'local_relational' }
      : current);
  }, [updateJevAttentionVisual]);

  useEffect(() => {
    const generation = graphScopeGenerationRef.current + 1;
    graphScopeGenerationRef.current = generation;
    pendingJevAttentionLoadsRef.current.clear();
    exactJevAttentionOverlaysRef.current.thinkgraph.clear();
    exactJevAttentionOverlaysRef.current.knowgraph.clear();
    return () => {
      if (graphScopeGenerationRef.current === generation) {
        graphScopeGenerationRef.current = generation + 1;
      }
      pendingJevAttentionLoadsRef.current.clear();
      exactJevAttentionOverlaysRef.current.thinkgraph.clear();
      exactJevAttentionOverlaysRef.current.knowgraph.clear();
    };
  }, [projectId, deckId, conversationId]);

  useEffect(() => {
    replaceJevAttentionVisual(null);
  }, [conversationId, deckId, projectId, replaceJevAttentionVisual, selectedCardId]);

  useEffect(() => {
    codeGraphScopeRef.current += 1;
    return () => { codeGraphScopeRef.current += 1; };
  }, [projectId, deckId, selectedCardId]);

  useEffect(() => {
    activeScopeRef.current = null;
    seenEventIdsRef.current.clear();
    seenThinkGraphRevisionsRef.current.clear();
    selectedRunRef.current = null;
    setErrors({});
    setProjections(emptyAttention(projectId));
    authoritativeThinkGraphRef.current = projection('thinkgraph', projectId);
    authoritativeKnowGraphRef.current = projection('knowgraph', projectId);
    setStatuses({ thinkgraph: 'loading', knowgraph: 'loading', codegraph: 'ready' });
  }, [deckId, projectId]);

  useEffect(() => {
    activeScopeRef.current = null;
    seenEventIdsRef.current.clear();
    selectedRunRef.current = null;
    setProjections({
      ...emptyAttention(projectId),
      thinkgraph: authoritativeThinkGraphRef.current,
      knowgraph: authoritativeKnowGraphRef.current,
    });
  }, [selectedCardId, deckId, projectId]);

  useEffect(() => { activeScopeRef.current = null; }, [conversationId]);

  const merge = useCallback((authority: GraphAttentionAuthority, incoming: GraphProjectionV1) => {
    if (authority === 'knowgraph') {
      authoritativeKnowGraphRef.current = mergeAttentionProjection(authoritativeKnowGraphRef.current, incoming);
    }
    if (authority === 'thinkgraph') {
      authoritativeThinkGraphRef.current = mergeAttentionProjection(
        authoritativeThinkGraphRef.current,
        incoming,
      );
    }
    setProjections((current) => ({
      ...current,
      [authority]: mergeAttentionProjection(current[authority], incoming),
    }));
    setErrors((current) => ({ ...current, [authority]: undefined }));
  }, []);

  const applyExactJevAttentionOverlays = useCallback((
    authority: JevAttentionGraphAuthority,
    authoritative: GraphProjectionV1,
    refreshGeneration?: number,
  ): GraphProjectionV1 => {
    const activeScope = activeScopeRef.current;
    if (!activeScope) return authoritative;
    let display = authoritative;
    for (const overlay of exactJevAttentionOverlaysRef.current[authority].values()) {
      if (overlay.scopeGeneration !== graphScopeGenerationRef.current
        || overlay.clientRunId !== activeScope.clientRunId
        || overlay.serverRunId !== activeScope.serverRunId
        || (refreshGeneration !== undefined
          && overlay.refreshGeneration > refreshGeneration)) continue;
      display = overlayAuthoritativeGraphAttention(
        mergeMissingAttentionProjection(display, overlay.projection),
        overlay.highlight,
      );
    }
    return display;
  }, []);

  const refreshThinkGraph = useCallback(async (
    revision?: ThinkGraphRevisionEvent,
    attention?: GraphHighlight,
  ) => {
    const requestId = thinkGraphRequestRef.current + 1;
    thinkGraphRequestRef.current = requestId;
    setStatuses((current) => ({ ...current, thinkgraph: 'loading' }));
    try {
      const query = new URLSearchParams({ projectId });
      const response = await fetch(`/api/thinkgraph/projection?${query.toString()}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !isRecord(payload)) {
        throw new Error(String(payload?.error || `HTTP ${response.status}`));
      }
      if (
        payload.schemaVersion !== 'thinkgraph.engraphis.v1'
        || payload.authority !== 'engraphis'
        || payload.projectId !== projectId
        || !Array.isArray(payload.nodes)
        || !Array.isArray(payload.edges)
      ) {
        throw new Error('invalid_thinkgraph_projection');
      }
      if (requestId !== thinkGraphRequestRef.current) return;
      const authoritative = revision
        ? overlayThinkGraphTurnActivity(payload as GraphProjectionV1, revision)
        : payload as GraphProjectionV1;
      authoritativeThinkGraphRef.current = authoritative;
      setProjections((current) => {
        const retained = attention
          ? overlayAuthoritativeGraphAttention(
              overlayAuthoritativeGraphAttention(authoritative, current.thinkgraph),
              attention,
            )
          : overlayAuthoritativeGraphAttention(authoritative, current.thinkgraph);
        return {
          ...current,
          thinkgraph: applyExactJevAttentionOverlays('thinkgraph', retained, requestId),
        };
      });
      setErrors((current) => ({ ...current, thinkgraph: undefined }));
      setStatuses((current) => ({ ...current, thinkgraph: 'ready' }));
    } catch (caught) {
      if (requestId !== thinkGraphRequestRef.current) return;
      setErrors((current) => ({
        ...current,
        thinkgraph: caught instanceof Error ? caught.message : String(caught),
      }));
      setStatuses((current) => ({ ...current, thinkgraph: 'error' }));
    }
  }, [applyExactJevAttentionOverlays, projectId]);

  useEffect(() => {
    void refreshThinkGraph();
    return () => { thinkGraphRequestRef.current += 1; };
  }, [refreshThinkGraph, deckId]);

  const refreshKnowGraph = useCallback(async (attention?: GraphHighlight) => {
    const requestId = ++knowGraphRequestRef.current;
    setStatuses((current) => ({ ...current, knowgraph: 'loading' }));
    try {
      const query = new URLSearchParams({ projectId, limit: '200' });
      const response = await fetch(`/api/knowgraph/graph?${query}`);
      const payload = await response.json();
      if (!response.ok || !isRecord(payload) || !Array.isArray(payload.nodes) || !Array.isArray(payload.relationships)) {
        throw new Error('Knowledge could not be loaded.');
      }
      if (requestId !== knowGraphRequestRef.current) return;
      // Native records supply topology and labels. Activity decorates matching
      // IDs only; receipts and stale references never create knowledge nodes.
      const native = knowGraphProjection(payload, projectId);
      authoritativeKnowGraphRef.current = native;
      setProjections((current) => {
        const retained = attention
          ? overlayAuthoritativeGraphAttention(overlayAuthoritativeGraphAttention(native, current.knowgraph), attention)
          : overlayAuthoritativeGraphAttention(native, current.knowgraph);
        return { ...current,
          knowgraph: applyExactJevAttentionOverlays('knowgraph', retained, requestId),
        };
      });
      setErrors((current) => ({ ...current, knowgraph: undefined }));
      setStatuses((current) => ({ ...current, knowgraph: 'ready' }));
    } catch (caught) {
      if (requestId !== knowGraphRequestRef.current) return;
      setErrors((current) => ({ ...current, knowgraph: caught instanceof Error ? caught.message : String(caught) }));
      setStatuses((current) => ({ ...current, knowgraph: 'error' }));
    }
  }, [applyExactJevAttentionOverlays, projectId]);

  const loadExactJevAttentionNode = useCallback(async ({
    authority,
    nativeId,
    context,
    clientRunId,
    serverRunId,
    decisionId,
    scopeGeneration,
    refreshGeneration,
  }: {
    authority: JevAttentionGraphAuthority;
    nativeId: string;
    context: AttentionContext;
    clientRunId: string;
    serverRunId: string;
    decisionId: string;
    scopeGeneration: number;
    refreshGeneration: number;
  }) => {
    const loadKey = `${scopeGeneration}\u0000${clientRunId}\u0000${serverRunId}\u0000${decisionId}\u0000${authority}\u0000${nativeId}`;
    if (pendingJevAttentionLoadsRef.current.has(loadKey)) return;
    pendingJevAttentionLoadsRef.current.add(loadKey);
    let resolution: JevAttentionVisualResolution = 'unavailable';
    try {
      let incoming: GraphProjectionV1 | null = null;
      if (authority === 'thinkgraph') {
        const query = new URLSearchParams({ projectId, canonicalId: nativeId });
        const response = await fetch(`/api/thinkgraph/neighborhood?${query.toString()}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !isRecord(payload)) return;
        incoming = exactThinkGraphProjection(payload, projectId, nativeId);
      } else {
        const query = new URLSearchParams({ projectId, nodeId: nativeId, limit: '50', depth: '1' });
        const response = await fetch(`/api/knowgraph/expand?${query.toString()}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !isRecord(payload)) return;
        try {
          const projected = knowGraphProjection(payload, projectId);
          incoming = projected.nodes.some((node) => node.id === nativeId) ? projected : null;
        } catch {
          return;
        }
      }
      if (!incoming) return;
      const activeScope = activeScopeRef.current;
      if (scopeGeneration !== graphScopeGenerationRef.current
        || !activeScope
        || activeScope.clientRunId !== clientRunId
        || activeScope.serverRunId !== serverRunId) return;
      const highlight: GraphHighlight = {
        nodeIds: [nativeId],
        edgeIds: [],
        context,
        active: true,
      };
      exactJevAttentionOverlaysRef.current[authority].set(nativeId, {
        scopeGeneration,
        clientRunId,
        serverRunId,
        refreshGeneration,
        projection: incoming,
        highlight,
      });
      if (authority === 'thinkgraph') {
        authoritativeThinkGraphRef.current = mergeAttentionProjection(
          authoritativeThinkGraphRef.current,
          incoming,
        );
      } else {
        authoritativeKnowGraphRef.current = mergeAttentionProjection(
          authoritativeKnowGraphRef.current,
          incoming,
        );
      }
      setProjections((current) => ({
        ...current,
        [authority]: overlayAuthoritativeGraphAttention(
          mergeAttentionProjection(current[authority], incoming),
          highlight,
        ),
      }));
      resolution = 'resolved';
    } catch {
      // Attention availability is optional. Main continues without a synthetic
      // node or a false highlight when the exact native read is unavailable.
    } finally {
      pendingJevAttentionLoadsRef.current.delete(loadKey);
      updateJevAttentionResolution({
        clientRunId,
        serverRunId,
        decisionId,
        authority: authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph',
        nativeId,
        resolution,
        scopeGeneration,
      });
    }
  }, [projectId, updateJevAttentionResolution]);

  useEffect(() => {
    void refreshKnowGraph();
    return () => { knowGraphRequestRef.current += 1; };
  }, [refreshKnowGraph, deckId]);

  const readCodeGraph = useCallback(async (nodeIds: readonly string[],
    cardId: string, expand = false): Promise<GraphProjectionV1> => {
    const result = await callCbmTool<GraphProjectionV1>('graph', {
      project: CANONICAL_CBM_PROJECT_NAME, node_ids: nodeIds, expand,
    }, { projectId, deckId, cardId });
    if (result.authority !== 'codegraph' || result.projectId !== projectId
      || !Array.isArray(result.nodes) || !Array.isArray(result.edges)
      || result.nodes.some(node => !node.id || typeof node.label !== 'string')
      || result.edges.some(edge => !edge.id || !edge.source || !edge.target || !edge.predicate)) {
      throw new Error('invalid_codegraph_projection');
    }
    return result;
  }, [projectId, deckId]);

  const loadCodeGraphAttention = useCallback(async (highlight: GraphHighlight) => {
    if (!highlight.context.actorCardId || !highlight.nodeIds.length) return;
    const scope = codeGraphScopeRef.current;
    try {
      const records = await readCodeGraph(highlight.nodeIds, highlight.context.actorCardId);
      if (scope !== codeGraphScopeRef.current) return;
      setProjections(current => ({ ...current, codegraph: overlayAuthoritativeGraphAttention(
        mergeAttentionProjection(current.codegraph, records), highlight,
      ) }));
      setErrors(current => ({ ...current, codegraph: undefined }));
    } catch (error) {
      if (scope === codeGraphScopeRef.current) setErrors(current => ({ ...current,
        codegraph: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [readCodeGraph]);

  const observeAttentionEvent = useCallback((event: NativeAttentionEvent) => {
    if (event.projectId !== projectId || event.deckId !== deckId || !event.runId
      || !['thinkgraph', 'knowgraph', 'codegraph'].includes(event.authority) || event.persisted === false
      || !event.eventId || !event.toolName || !event.resultHash || !Number.isFinite(Date.parse(event.timestamp))
      || (event.phase && event.phase !== 'completed')) return;
    if (selectedCardId && (event.cardId !== selectedCardId
      || (event.rootRunId || event.runId) !== selectedRunRef.current)) return;
    const key = `${event.eventId}:${event.phase || 'completed'}:${event.resultHash}`;
    if (seenEventIdsRef.current.has(key)) return;
    if (event.change === 'delete' || event.change === 'clear') {
      if (event.authority === 'knowgraph') {
        void refreshKnowGraph();
        seenEventIdsRef.current.add(key);
        return;
      }
      if (event.authority === 'thinkgraph') {
        void refreshThinkGraph();
        seenEventIdsRef.current.add(key);
        return;
      }
      codeGraphScopeRef.current += 1;
      setProjections((current) => {
        const authority = event.authority as GraphAttentionAuthority;
        const value = current[authority];
        const removedNodes = new Set(event.nativeNodeIds);
        const removedEdges = new Set(event.nativeEdgeIds);
        const nodes = event.change === 'clear' ? [] : value.nodes.filter((node) => !removedNodes.has(node.id));
        const ids = new Set(nodes.map((node) => node.id));
        const edges = value.edges.filter((edge) => !removedEdges.has(edge.id) && ids.has(edge.source) && ids.has(edge.target));
        return { ...current, [authority]: projection(authority, projectId, nodes, edges) };
      });
    } else {
      const authority = event.authority as GraphAttentionAuthority;
      const highlight: GraphHighlight = {
        nodeIds: event.nativeNodeIds, edgeIds: event.nativeEdgeIds,
        context: { actorCardId: event.cardId,
          actorColor: event.cardId ? event.operation === 'write' ? WRITE_ATTENTION_COLOR : CARD_ACTIVE_COLOR : UNKNOWN_ACTOR_COLOR,
          toolName: event.toolName, operation: event.operation, eventId: event.eventId,
          timestamp: event.timestamp, runId: event.runId, resultHash: event.resultHash },
        active: !event.runState || ['running', 'observing'].includes(event.runState),
      };
      setProjections(current => ({ ...current,
        [authority]: overlayAuthoritativeGraphAttention(current[authority], highlight),
      }));
      if (authority === 'thinkgraph') {
        const ids = new Set(authoritativeThinkGraphRef.current.nodes.map(node => node.id));
        if (event.operation === 'write' || event.nativeNodeIds.some(id => !ids.has(id))) {
          void refreshThinkGraph(undefined, highlight);
        }
      } else if (authority === 'knowgraph' && event.operation === 'write') void refreshKnowGraph(highlight);
      else if (authority === 'codegraph') void loadCodeGraphAttention(highlight);
    }
    seenEventIdsRef.current.add(key);
    if (seenEventIdsRef.current.size > 2048) {
      seenEventIdsRef.current.delete(seenEventIdsRef.current.values().next().value!);
    }
  }, [deckId, projectId, refreshThinkGraph, refreshKnowGraph, selectedCardId, loadCodeGraphAttention]);

  const observeAttentionSession = useCallback((session: NativeAttentionSession) => {
    if (session.projectId !== projectId || session.deckId !== deckId) return;
    if (selectedCardId && session.cardId !== selectedCardId) return;
    const active = ['running', 'observing'].includes(session.state || '');
    const internal = Boolean(session.nativeChildId);
    if (selectedCardId && internal && (!session.rootRunId
      || session.rootRunId !== selectedRunRef.current)) return;
    if (selectedCardId && !internal) {
      const nextRun = active ? session.runId : null;
      if (selectedRunRef.current !== nextRun || !nextRun) {
        codeGraphScopeRef.current += 1;
        selectedRunRef.current = nextRun;
        seenEventIdsRef.current.clear();
        setProjections({
          ...emptyAttention(projectId),
          thinkgraph: authoritativeThinkGraphRef.current,
          knowgraph: authoritativeKnowGraphRef.current,
        });
      }
    } else if (!selectedCardId && !active) {
      setProjections((current) => Object.fromEntries(Object.entries(current).map(([authority, value]) => [authority, {
        ...value, nodes: value.nodes.map((node) => node.properties?.attentionRunId === session.runId
          ? { ...node, properties: { ...node.properties, attentionActive: false } } : node),
        edges: value.edges.map((edge) => edge.properties?.attentionRunId === session.runId
          ? { ...edge, properties: { ...edge.properties, attentionActive: false } } : edge),
      }])) as typeof current);
    }
    if ((!active && !(selectedCardId && internal)) || !session.runId) return;
    for (const authority of ['thinkgraph', 'knowgraph', 'codegraph'] as const) {
      const nodeIds = (session.materializedNativeReferences || [])
        .filter(ref => ref.authority.toLowerCase() === authority).map(ref => ref.nativeId);
      if (!nodeIds.length) continue;
      const highlight: GraphHighlight = { nodeIds, edgeIds: [], active,
        context: { actorCardId: session.cardId, actorColor: CARD_ACTIVE_COLOR,
          toolName: '', operation: 'read', runId: session.runId } };
      setProjections(current => ({ ...current,
        [authority]: overlayAuthoritativeGraphAttention(current[authority], highlight),
      }));
      if (authority === 'codegraph') void loadCodeGraphAttention(highlight);
    }
  }, [deckId, projectId, selectedCardId, loadCodeGraphAttention]);

  const observeThinkGraphRevision = useCallback((event: ThinkGraphRevisionEvent) => {
    if (event.projectId !== projectId || event.deckId !== deckId
      || event.conversationId !== conversationId
      || !['fast', 'settled'].includes(event.stage)
      || !event.originatingRunId || !event.revision
      || !Array.isArray(event.changedNodeIds)
      || !Array.isArray(event.changedEdgeIds)
      || !Array.isArray(event.affectedNodeIds)
      || !isRecord(event.turnHeat)
      || !Array.isArray(event.topActiveNodes)) return;
    const key = `${event.originatingRunId}:${event.stage}:${event.revision}`;
    if (seenThinkGraphRevisionsRef.current.has(key)) return;
    seenThinkGraphRevisionsRef.current.add(key);
    if (seenThinkGraphRevisionsRef.current.size > 256) {
      seenThinkGraphRevisionsRef.current.delete(
        seenThinkGraphRevisionsRef.current.values().next().value!,
      );
    }
    void refreshThinkGraph(event);
  }, [conversationId, deckId, projectId, refreshThinkGraph]);

  const observeThinkGraphFailure = useCallback((event: ThinkGraphLifecycleError) => {
    if (event.projectId !== projectId || event.deckId !== deckId
      || event.conversationId !== conversationId) return;
    console.warn('[THINKGRAPH_LIFECYCLE_FAILED]', event);
  }, [conversationId, deckId, projectId]);

  const startAttentionScope = useCallback((turn: MainChatTurnStarted) => {
    if (turn.projectId !== projectId || turn.conversationId !== conversationId) return;
    replaceJevAttentionVisual(null);
    activeScopeRef.current = { clientRunId: turn.runId, serverRunId: null };
    exactJevAttentionOverlaysRef.current.thinkgraph.clear();
    exactJevAttentionOverlaysRef.current.knowgraph.clear();
    // A new Main turn must not erase another independently running Card.
    const actor = mainActorRef.current;
    if (actor && (!selectedCardId || actor === selectedCardId)) {
      setProjections((current) => Object.fromEntries(Object.entries(current).map(([authority, value]) => {
        if (authority === 'thinkgraph') return [authority, authoritativeThinkGraphRef.current];
        if (authority === 'knowgraph') return [authority, authoritativeKnowGraphRef.current];
        const nodes = value.nodes.filter((node) => node.properties?.attentionActorCardId !== actor);
        const ids = new Set(nodes.map((node) => node.id));
        return [authority, projection(authority as GraphAttentionAuthority, projectId, nodes,
          value.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)))];
      })) as typeof current);
    }
  }, [conversationId, projectId, replaceJevAttentionVisual, selectedCardId]);

  const observeNativeTurnEvent = useCallback((turn: MainChatTurnEvent) => {
    const scope = activeScopeRef.current;
    if (
      !scope
      || scope.clientRunId !== turn.runId
      || turn.projectId !== projectId
      || turn.conversationId !== conversationId
    ) return;
    const session = turn.event as Record<string, unknown>;
    if (session.kind === 'run' || session.kind === 'session') {
      const serverRunId = String(session.runId || '').trim();
      if (
        serverRunId
        && session.projectId === projectId
        && session.deckId === deckId
        && session.conversationId === conversationId
      ) {
        if (session.kind === 'run' || !scope.serverRunId) scope.serverRunId = serverRunId;
      }
      if (session.kind === 'session') {
        transitionJevAttentionToLocal(scope.clientRunId, scope.serverRunId);
      }
      return;
    }
    if (session.kind === 'jev_attention') {
      if (!scope.serverRunId || !isJevAttentionEvent(session)) return;
      const event = session as JevAttentionEvent;
      if (event.projectId !== projectId || event.deckId !== deckId
        || event.conversationId !== conversationId || event.runId !== scope.serverRunId) return;
      const resultIdentity = typeof event.resultIdentity === 'string' && event.resultIdentity.trim()
        ? event.resultIdentity.trim()
        : typeof event.resultHash === 'string' && event.resultHash.trim()
          ? event.resultHash.trim()
          : event.status;
      const key = `jev:${event.decisionId}:${resultIdentity}`;
      if (seenEventIdsRef.current.has(key)) return;
      seenEventIdsRef.current.add(key);
      mainActorRef.current = event.cardId;
      if (event.status !== 'success') return;
      const candidates = event.candidates.map((candidate) => ({ ...candidate }));
      const availableNodeIds = {
        thinkgraph: new Set(authoritativeThinkGraphRef.current.nodes.map((node) => node.id)),
        knowgraph: new Set(authoritativeKnowGraphRef.current.nodes.map((node) => node.id)),
      };
      const selectedSubjects = candidates
        .filter((candidate) => candidate.selected)
        .map((candidate): JevAttentionVisualSubject => {
          const authority = candidate.authority === 'ThinkGraph' ? 'thinkgraph' : 'knowgraph';
          return {
            choiceId: candidate.choiceId,
            authority: candidate.authority,
            nativeId: candidate.nativeId,
            title: candidate.title,
            probability: Number(candidate.probability),
            selected: true,
            hydrated: candidate.hydrated,
            resolution: !candidate.hydrated
              ? 'unavailable'
              : availableNodeIds[authority].has(candidate.nativeId)
                ? 'resolved'
                : 'resolving',
          };
        })
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 3);
      if (!selectedSubjects.length) return;
      replaceJevAttentionVisual({
        decisionId: event.decisionId,
        resultIdentity,
        clientRunId: scope.clientRunId,
        runId: event.runId,
        cardId: event.cardId,
        phase: 'attention_space',
        active: true,
        terminalStatus: null,
        distribution: { ...event.distribution },
        candidates,
        selectedSubjects,
      });
      const nodeIds = {
        thinkgraph: new Set<string>(),
        knowgraph: new Set<string>(),
      };
      for (const candidate of event.candidates) {
        if (!candidate.selected || !candidate.hydrated) continue;
        nodeIds[candidate.authority === 'ThinkGraph' ? 'thinkgraph' : 'knowgraph']
          .add(candidate.nativeId);
      }
      if (!nodeIds.thinkgraph.size && !nodeIds.knowgraph.size) return;
      const context: AttentionContext = {
        actorCardId: event.cardId,
        actorColor: CARD_ACTIVE_COLOR,
        toolName: 'jev_attention',
        operation: 'read',
        eventId: event.decisionId,
        runId: event.runId,
        ...(typeof event.resultHash === 'string' && event.resultHash
          ? { resultHash: event.resultHash }
          : {}),
      };
      setProjections((current) => ({
        ...current,
        thinkgraph: overlayAuthoritativeGraphAttention(current.thinkgraph, {
          nodeIds: [...nodeIds.thinkgraph], edgeIds: [], context, active: true,
        }),
        knowgraph: overlayAuthoritativeGraphAttention(current.knowgraph, {
          nodeIds: [...nodeIds.knowgraph], edgeIds: [], context, active: true,
        }),
      }));
      for (const authority of ['thinkgraph', 'knowgraph'] as const) {
        for (const nativeId of nodeIds[authority]) {
          if (availableNodeIds[authority].has(nativeId)) continue;
          void loadExactJevAttentionNode({
            authority,
            nativeId,
            context,
            clientRunId: scope.clientRunId,
            serverRunId: event.runId,
            decisionId: event.decisionId,
            scopeGeneration: graphScopeGenerationRef.current,
            refreshGeneration: authority === 'thinkgraph'
              ? thinkGraphRequestRef.current
              : knowGraphRequestRef.current,
          });
        }
      }
      return;
    }
    if (['text', 'reasoning', 'tool_start', 'tool_result', 'permission', 'done', 'end']
      .includes(String(session.kind || ''))) {
      transitionJevAttentionToLocal(scope.clientRunId, scope.serverRunId);
    }
    const event = turn.event as NativeAttentionEvent;
    if (event.kind !== 'native_attention') return;
    if (!scope.serverRunId) return;
    if (event.projectId !== projectId || event.deckId !== deckId
      || event.conversationId !== conversationId || event.runId !== scope.serverRunId) return;
    mainActorRef.current = event.cardId;
    observeAttentionEvent(event);
  }, [
    conversationId,
    deckId,
    loadExactJevAttentionNode,
    observeAttentionEvent,
    projectId,
    replaceJevAttentionVisual,
    transitionJevAttentionToLocal,
  ]);

  const finishAttentionScope = useCallback((turn: MainChatTurnFinished) => {
    if (turn.projectId !== projectId || turn.conversationId !== conversationId) return;
    if (activeScopeRef.current?.clientRunId !== turn.runId) return;
    updateJevAttentionVisual((current) => current?.clientRunId === turn.runId
      ? {
          ...current,
          phase: 'local_relational',
          active: false,
          terminalStatus: turn.status,
          selectedSubjects: current.selectedSubjects.map((subject) => subject.resolution === 'resolving'
            ? { ...subject, resolution: 'unavailable' }
            : subject),
        }
      : current);
    activeScopeRef.current = null;
  }, [projectId, conversationId, updateJevAttentionVisual]);

  const readContextualNode = useCallback<ReadContextualNode>(async (
    request,
    signal,
  ): Promise<ContextualNodeReadView> => {
    const response = await fetch('/api/main/session/contextual-node-read', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        deckId,
        conversationId,
        sourceRevision: request.sourceRevision,
        clientContextRevision: request.clientContextRevision,
        nativeMembers: request.nativeMembers,
      }),
      ...(signal ? { signal } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !isRecord(payload)) {
      throw new Error(String(payload?.error || `HTTP ${response.status}`));
    }
    if (
      payload.schemaVersion !== 'contextual-node-read.v1'
      || payload.sourceRevision !== request.sourceRevision
      || payload.clientContextRevision !== request.clientContextRevision
      || !isRecord(payload.sides)
      || !isRecord(payload.sides.think)
      || !isRecord(payload.sides.know)
      || !Array.isArray(payload.dataAnchors)
    ) {
      throw new Error('contextual_node_read_response_invalid');
    }
    return payload as ContextualNodeReadView;
  }, [conversationId, deckId, projectId]);

  const readNativeNeighborhood = useCallback(async (
    authority: NativeNeighborhoodAuthority,
    nativeId: string,
    signal?: AbortSignal,
  ): Promise<GraphProjectionV1> => {
    const query = authority === 'thinkgraph'
      ? new URLSearchParams({ projectId, canonicalId: nativeId })
      : new URLSearchParams({ projectId, nodeId: nativeId, limit: '50', depth: '1' });
    const url = authority === 'thinkgraph'
      ? `/api/thinkgraph/neighborhood?${query.toString()}`
      : `/api/knowgraph/expand?${query.toString()}`;
    const response = signal
      ? await fetch(url, { signal })
      : await fetch(url);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !isRecord(payload)) {
      const detail = authority === 'knowgraph'
        ? payload?.error?.message || payload?.error
        : payload?.error;
      throw new Error(String(detail || `HTTP ${response.status}`));
    }
    if (authority === 'thinkgraph') {
      if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
        throw new Error('invalid_thinkgraph_projection');
      }
      return payload as GraphProjectionV1;
    }
    return knowGraphProjection(payload, projectId);
  }, [projectId]);

  const expandNode = useCallback(async ({
    authority,
    node,
    codeGraphProject,
    readerCardId,
  }: ExpandRequest) => {
    const codeGraphScope = codeGraphScopeRef.current;
    try {
      if (selectedCardId) throw new Error('Deselect the Card to expand the overall graph.');
      let incoming: GraphProjectionV1 | null = null;
      if (authority === 'thinkgraph') {
        incoming = await readNativeNeighborhood(
          authority,
          String(node.canonicalId || node.id),
        );
      } else if (authority === 'knowgraph') {
        incoming = await readNativeNeighborhood(authority, node.id);
      } else {
        if (codeGraphProject !== CANONICAL_CBM_PROJECT_NAME || !readerCardId) {
          throw new Error('CodeGraph requires the current saved workspace');
        }
        incoming = await readCodeGraph([node.id], readerCardId, true);
        if (codeGraphScope !== codeGraphScopeRef.current) return;
      }
      merge(authority, incoming);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [authority]: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, [merge, selectedCardId, readCodeGraph, readNativeNeighborhood]);

  const removeThinkGraphEvidence = useCallback(async (memoryId: string) => {
    const response = await fetch('/api/thinkgraph/retire', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, memoryId }),
    });
    if (!response.ok) throw new Error('Could not remove this item.');
    await refreshThinkGraph();
  }, [projectId, refreshThinkGraph]);

  return {
    refreshThinkGraph,
    projections,
    jevAttentionVisual,
    removeThinkGraphEvidence,
    errors,
    statuses,
    startAttentionScope,
    observeNativeTurnEvent,
    finishAttentionScope,
    observeAttentionEvent,
    observeAttentionSession,
    observeThinkGraphRevision,
    observeThinkGraphFailure,
    readContextualNode,
    readNativeNeighborhood,
    expandNode,
  };
}
