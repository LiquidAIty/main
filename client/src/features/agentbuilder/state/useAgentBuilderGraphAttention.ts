import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  GraphProjectionEdge,
  GraphProjectionNode,
  GraphProjectionV1,
} from '../../../components/knowledge/NativeAuthorityGraphSurface';
import { callCbmTool, CANONICAL_CBM_PROJECT_NAME } from '../../../components/codegraph/resolveCodeGraphProjectIdentity';
import type {
  MainChatTurnEvent,
  MainChatTurnFinished,
  MainChatTurnStarted,
} from '../console/useAgentBuilderMainChat';

export type GraphAttentionAuthority = 'thinkgraph' | 'knowgraph' | 'codegraph';

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

type ExpandRequest = {
  authority: GraphAttentionAuthority;
  node: GraphProjectionNode;
  projectId: string;
  codeGraphProject: string | null;
  readerCardId?: string | null;
};

export type GraphAttentionState = {
  refreshThinkGraph: () => Promise<void>;
  removeThinkGraphEvidence: (memoryId: string) => Promise<void>;
  projections: Record<GraphAttentionAuthority, GraphProjectionV1>;
  errors: Partial<Record<GraphAttentionAuthority, string>>;
  statuses: Record<GraphAttentionAuthority, 'idle' | 'loading' | 'ready' | 'error'>;
  startAttentionScope: (turn: MainChatTurnStarted) => void;
  observeNativeTurnEvent: (turn: MainChatTurnEvent) => void;
  finishAttentionScope: (turn: MainChatTurnFinished) => void;
  observeAttentionEvent: (event: NativeAttentionEvent) => void;
  observeAttentionSession: (session: NativeAttentionSession) => void;
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

function knowGraphProjection(payload: Record<string, any>, projectId: string): GraphProjectionV1 {
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.relationships)
    || payload.nodes.some((node: any) => !isRecord(node) || typeof node.id !== 'string' || !node.id || typeof node.label !== 'string')
    || payload.relationships.some((edge: any) => !isRecord(edge) || typeof edge.id !== 'string' || !edge.id
      || typeof edge.from !== 'string' || !edge.from || typeof edge.to !== 'string' || !edge.to
      || typeof edge.type !== 'string' || !edge.type)) {
    throw new Error('invalid_knowgraph_projection');
  }
  return projection('knowgraph', projectId, payload.nodes, payload.relationships.map((edge: any) => ({
    ...edge, source: edge.from, target: edge.to, predicate: edge.type,
  })));
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
  return {
    ...current,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    counts: { nodes: nodes.size, edges: edges.size },
  };
}

type GraphHighlight = {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  context: AttentionContext;
  active?: boolean;
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
  const activeScopeRef = useRef<{ clientRunId: string; serverRunId: string | null } | null>(null);
  const seenEventIdsRef = useRef(new Set<string>());
  const selectedRunRef = useRef<string | null>(null);
  const mainActorRef = useRef<string | null>(null);
  const authoritativeThinkGraphRef = useRef<GraphProjectionV1>(projection('thinkgraph', projectId));
  const thinkGraphRequestRef = useRef(0);
  const authoritativeKnowGraphRef = useRef<GraphProjectionV1>(projection('knowgraph', projectId));
  const knowGraphRequestRef = useRef(0);
  const codeGraphScopeRef = useRef(0);

  useEffect(() => {
    codeGraphScopeRef.current += 1;
    return () => { codeGraphScopeRef.current += 1; };
  }, [projectId, deckId, selectedCardId]);

  useEffect(() => {
    activeScopeRef.current = null;
    seenEventIdsRef.current.clear();
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

  const refreshThinkGraph = useCallback(async (attention?: GraphHighlight) => {
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
      const authoritative = payload as GraphProjectionV1;
      authoritativeThinkGraphRef.current = authoritative;
      setProjections((current) => ({
        ...current,
        thinkgraph: attention
          ? overlayAuthoritativeGraphAttention(overlayAuthoritativeGraphAttention(authoritative, current.thinkgraph), attention)
          : overlayAuthoritativeGraphAttention(authoritative, current.thinkgraph),
      }));
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
  }, [projectId]);

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
      setProjections((current) => ({ ...current,
        knowgraph: attention
          ? overlayAuthoritativeGraphAttention(overlayAuthoritativeGraphAttention(native, current.knowgraph), attention)
          : overlayAuthoritativeGraphAttention(native, current.knowgraph),
      }));
      setErrors((current) => ({ ...current, knowgraph: undefined }));
      setStatuses((current) => ({ ...current, knowgraph: 'ready' }));
    } catch (caught) {
      if (requestId !== knowGraphRequestRef.current) return;
      setErrors((current) => ({ ...current, knowgraph: caught instanceof Error ? caught.message : String(caught) }));
      setStatuses((current) => ({ ...current, knowgraph: 'error' }));
    }
  }, [projectId]);

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
        if (event.operation === 'write' || event.nativeNodeIds.some(id => !ids.has(id))) void refreshThinkGraph(highlight);
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

  const startAttentionScope = useCallback((turn: MainChatTurnStarted) => {
    if (turn.projectId !== projectId || turn.conversationId !== conversationId) return;
    activeScopeRef.current = { clientRunId: turn.runId, serverRunId: null };
    setErrors({});
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
  }, [conversationId, projectId, selectedCardId]);

  const observeNativeTurnEvent = useCallback((turn: MainChatTurnEvent) => {
    const scope = activeScopeRef.current;
    if (
      !scope
      || scope.clientRunId !== turn.runId
      || turn.projectId !== projectId
      || turn.conversationId !== conversationId
    ) return;
    const session = turn.event as Record<string, unknown>;
    if (session.kind === 'session') {
      const serverRunId = String(session.runId || '').trim();
      if (
        serverRunId
        && session.projectId === projectId
        && session.deckId === deckId
        && session.conversationId === conversationId
      ) {
        scope.serverRunId = serverRunId;
      }
      return;
    }
    const event = turn.event as NativeAttentionEvent;
    if (event.kind !== 'native_attention') return;
    if (!scope.serverRunId) return;
    if (event.projectId !== projectId || event.deckId !== deckId
      || event.conversationId !== conversationId || event.runId !== scope.serverRunId) return;
    mainActorRef.current = event.cardId;
    observeAttentionEvent(event);
  }, [conversationId, deckId, observeAttentionEvent, projectId]);

  const finishAttentionScope = useCallback((turn: MainChatTurnFinished) => {
    if (turn.projectId !== projectId || turn.conversationId !== conversationId) return;
    if (activeScopeRef.current?.clientRunId === turn.runId) activeScopeRef.current = null;
    if (turn.status === 'completed') void refreshThinkGraph();
  }, [projectId, conversationId, refreshThinkGraph]);

  const expandNode = useCallback(async ({
    authority,
    node,
    projectId,
    codeGraphProject,
    readerCardId,
  }: ExpandRequest) => {
    const codeGraphScope = codeGraphScopeRef.current;
    try {
      if (selectedCardId) throw new Error('Deselect the Card to expand the overall graph.');
      let incoming: GraphProjectionV1 | null = null;
      if (authority === 'thinkgraph') {
        const query = new URLSearchParams({
          projectId,
          canonicalId: String(node.canonicalId || node.id),
        });
        const response = await fetch(`/api/thinkgraph/neighborhood?${query.toString()}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !isRecord(payload)) throw new Error(String(payload?.error || `HTTP ${response.status}`));
        if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error('invalid_thinkgraph_projection');
        incoming = payload as GraphProjectionV1;
      } else if (authority === 'knowgraph') {
        const query = new URLSearchParams({ projectId, nodeId: node.id, limit: '50', depth: '1' });
        const response = await fetch(`/api/knowgraph/expand?${query.toString()}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !isRecord(payload)) throw new Error(String(payload?.error?.message || payload?.error || `HTTP ${response.status}`));
        incoming = knowGraphProjection(payload, projectId);
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
  }, [merge, selectedCardId, readCodeGraph]);

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
    removeThinkGraphEvidence,
    errors,
    statuses,
    startAttentionScope,
    observeNativeTurnEvent,
    finishAttentionScope,
    observeAttentionEvent,
    observeAttentionSession,
    expandNode,
  };
}
