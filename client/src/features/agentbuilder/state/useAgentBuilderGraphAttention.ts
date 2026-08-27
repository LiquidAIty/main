import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  GraphProjectionEdge,
  GraphProjectionNode,
  GraphProjectionV1,
} from '../../../components/knowledge/NativeAuthorityGraphSurface';
import { callCbmTool } from '../../../components/codegraph/resolveCodeGraphProjectIdentity';
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
  runState?: string;
  scopeGroupIds?: string[];
};

export type NativeAttentionSession = {
  projectId: string; deckId: string; cardId: string; runId: string | null;
  state: string | null; nativeChildId?: string | null;
  materializedNativeReferences?: Array<{ authority: string; nativeId: string }>;
};

type ExpandRequest = {
  authority: GraphAttentionAuthority;
  node: GraphProjectionNode;
  projectId: string;
  codeGraphProject: string | null;
};

export type GraphAttentionState = {
  projections: Record<GraphAttentionAuthority, GraphProjectionV1>;
  errors: Partial<Record<GraphAttentionAuthority, string>>;
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
const MAX_OPERATION_NODES = 200;
const MAX_OPERATION_EDGES = 300;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function attentionProperties(
  native: Record<string, unknown>,
  context: AttentionContext,
): Record<string, unknown> {
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

function nodeFromRecord(
  record: Record<string, any>,
  authority: GraphAttentionAuthority,
  context: AttentionContext,
  idKeys: string[],
): GraphProjectionNode | null {
  const id = idKeys.map((key) => String(record[key] ?? '').trim()).find(Boolean);
  if (!id) return null;
  const label = String(
    record.title
      || record.name
      || record.qualified_name
      || record.qualifiedName
      || record.label
      || id,
  );
  const type = String(
    record.mtype
      || record.kind
      || record.type
      || (Array.isArray(record.labels) ? record.labels[0] : '')
      || (authority === 'codegraph' ? record.label : '')
      || 'NativeRecord',
  );
  return {
    id,
    canonicalId: id,
    label,
    type,
    labels: Array.isArray(record.labels) ? record.labels.map(String) : undefined,
    authority,
    mentionCount: 1,
    createdAt: typeof record.created_at === 'string' ? record.created_at : undefined,
    validFrom: typeof record.valid_at === 'string' ? record.valid_at : undefined,
    validTo: typeof record.invalid_at === 'string' ? record.invalid_at : null,
    properties: attentionProperties(record, context),
    provenance: isRecord(record.provenance)
      ? record.provenance
      : {
          groupId: record.group_id,
          source: record.source,
          sourceDescription: record.source_description,
        },
    codeGraphRef: authority === 'codegraph' ? id : undefined,
    knowGraphRef: authority === 'knowgraph' ? id : undefined,
  };
}

function edgeFromRecord(
  record: Record<string, any>,
  authority: GraphAttentionAuthority,
  context: AttentionContext,
): GraphProjectionEdge | null {
  const source = String(record.source_node_uuid ?? record.source ?? record.from ?? '').trim();
  const target = String(record.target_node_uuid ?? record.target ?? record.to ?? '').trim();
  if (!source || !target) return null;
  const predicate = String(record.name || record.type || record.predicate || record.relation || 'RELATED_TO');
  const id = String(record.uuid ?? record.id ?? `${source}:${predicate}:${target}`).trim();
  return {
    id,
    source,
    target,
    predicate,
    mentionCount: 1,
    properties: attentionProperties(record, context),
    provenance: isRecord(record.provenance)
      ? record.provenance
      : { groupId: record.group_id, episodes: record.episodes },
    validFrom: typeof record.valid_at === 'string' ? record.valid_at : undefined,
    validTo: typeof record.invalid_at === 'string' ? record.invalid_at : null,
  };
}

function recordsAt(payload: Record<string, any>, keys: string[]): Record<string, any>[] {
  const records: Record<string, any>[] = [];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) records.push(...value.filter(isRecord));
  }
  return records;
}

function codeRecordId(record: Record<string, any>): string {
  return String(
    record.qualified_name
      || record.qualifiedName
      || record.canonicalId
      || record.nativeId
      || record.id
      || '',
  ).trim();
}

function projectCodeGraphResult(
  payload: Record<string, any>,
  projectId: string,
  context: AttentionContext,
  anchorNode?: GraphProjectionNode,
): GraphProjectionV1 {
  const records = recordsAt(payload, [
    'results', 'nodes', 'callers', 'callees', 'path', 'symbols', 'rows',
  ]);
  if (codeRecordId(payload)) records.unshift(payload);
  const nodes = records
    .map((record) => nodeFromRecord(record, 'codegraph', context, [
      'qualified_name', 'qualifiedName', 'canonicalId', 'nativeId', 'id',
    ]))
    .filter((node): node is GraphProjectionNode => Boolean(node));
  const returnedFunction = String(payload.function || '').trim();
  if (!anchorNode && returnedFunction && !nodes.some((node) => node.id === returnedFunction)) {
    nodes.unshift(nodeFromRecord({
      qualified_name: returnedFunction,
      name: returnedFunction,
      label: 'Function',
    }, 'codegraph', context, ['qualified_name'])!);
  }
  if (anchorNode && !nodes.some((node) => node.id === anchorNode.id)) {
    nodes.unshift({
      ...anchorNode,
      properties: attentionProperties(anchorNode.properties || {}, context),
    });
  }
  const rootId = anchorNode?.id || returnedFunction;
  const edges: GraphProjectionEdge[] = [];
  if (rootId) {
    for (const caller of recordsAt(payload, ['callers'])) {
      const callerId = codeRecordId(caller);
      if (callerId) {
        edges.push(edgeFromRecord({
          id: `${callerId}:CALLS:${rootId}`,
          source: callerId,
          target: rootId,
          type: 'CALLS',
        }, 'codegraph', context)!);
      }
    }
    for (const callee of recordsAt(payload, ['callees'])) {
      const calleeId = codeRecordId(callee);
      if (calleeId) {
        edges.push(edgeFromRecord({
          id: `${rootId}:CALLS:${calleeId}`,
          source: rootId,
          target: calleeId,
          type: 'CALLS',
        }, 'codegraph', context)!);
      }
    }
  }
  for (const record of recordsAt(payload, ['edges', 'relationships'])) {
    const edge = edgeFromRecord(record, 'codegraph', context);
    if (edge) edges.push(edge);
  }
  return projection(
    'codegraph',
    projectId,
    nodes.slice(0, MAX_OPERATION_NODES),
    edges.slice(0, MAX_OPERATION_EDGES),
  );
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

function decorateNativeProjection(
  authority: GraphAttentionAuthority,
  payload: Record<string, any>,
  projectId: string,
  context: AttentionContext,
): GraphProjectionV1 {
  const nodes = (Array.isArray(payload.nodes) ? payload.nodes : [])
    .filter(isRecord)
    .map((node) => ({
      ...node,
      id: String(node.id || node.uuid || ''),
      canonicalId: String(node.canonicalId || node.uuid || node.id || ''),
      label: String(node.label || node.name || node.title || node.id || node.uuid || ''),
      authority,
      mentionCount: Number(node.mentionCount || 1),
      properties: attentionProperties({ ...node, ...(node.properties || {}) }, context),
    }))
    .filter((node) => node.id)
    .slice(0, MAX_OPERATION_NODES) as GraphProjectionNode[];
  const edges = (Array.isArray(payload.edges) ? payload.edges : Array.isArray(payload.relationships) ? payload.relationships : [])
    .filter(isRecord)
    .map((edge) => edgeFromRecord(edge, authority, context))
    .filter((edge): edge is GraphProjectionEdge => Boolean(edge))
    .slice(0, MAX_OPERATION_EDGES);
  return projection(authority, projectId, nodes, edges);
}

export function projectNativeAttentionEvent(args: {
  event: NativeAttentionEvent;
  projectId: string;
  deckId?: string;
  conversationId?: string;
  runId?: string;
}): { authority: GraphAttentionAuthority; projection: GraphProjectionV1 } | null {
  const { event } = args;
  if (!['thinkgraph', 'knowgraph', 'codegraph'].includes(event.authority)) return null;
  if (event.persisted === false || (event.phase && event.phase !== 'completed')) return null;
  if (event.change === 'delete' || event.change === 'clear') return null;
  if (!event.eventId || !event.toolName || !event.resultHash || !Number.isFinite(Date.parse(event.timestamp))) return null;
  if (event.projectId !== args.projectId) return null;
  if (args.deckId && event.deckId !== args.deckId) return null;
  if (args.conversationId && event.conversationId !== args.conversationId) return null;
  if (args.runId && event.runId !== args.runId) return null;
  const authority = event.authority as GraphAttentionAuthority;
  const nodeIds = [...new Set(
    (Array.isArray(event.nativeNodeIds) ? event.nativeNodeIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )].slice(0, MAX_OPERATION_NODES);
  if (nodeIds.length === 0) return null;
  const context = {
    actorCardId: event.cardId,
    actorColor: event.cardId
      ? event.operation === 'write' ? WRITE_ATTENTION_COLOR : CARD_ACTIVE_COLOR
      : UNKNOWN_ACTOR_COLOR,
    toolName: event.toolName,
    operation: event.operation,
    eventId: event.eventId,
    timestamp: event.timestamp,
    runId: event.runId,
    resultHash: event.resultHash,
  };
  const provenance = {
    authority,
    operation: event.operation,
    nativeTool: event.toolName,
    eventId: event.eventId,
    timestamp: event.timestamp,
    runId: event.runId,
    cardId: event.cardId,
    resultHash: event.resultHash,
  };
  const nodes = nodeIds.map((nativeId): GraphProjectionNode => ({
    id: nativeId,
    canonicalId: nativeId,
    label: nativeId,
    type: 'NativeReference',
    authority,
    mentionCount: 1,
    properties: attentionProperties({
      nativeId,
      attentionEventId: event.eventId,
      attentionOperation: event.operation,
      attentionResultHash: event.resultHash,
      attentionTruncated: event.truncated,
      attentionNativeEdgeIds: event.nativeEdgeIds,
    }, context),
    provenance: { ...provenance, nativeId },
    codeGraphRef: authority === 'codegraph' ? nativeId : undefined,
    knowGraphRef: authority === 'knowgraph' ? nativeId : undefined,
  }));
  const visibleNodeIds = new Set(nodeIds);
  const nativeEdgeIds = new Set(
    (Array.isArray(event.nativeEdgeIds) ? event.nativeEdgeIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const edges = (Array.isArray(event.nativeEdges) ? event.nativeEdges : [])
    .filter((edge) => edge && typeof edge === 'object')
    .map((edge) => ({
      id: String(edge.id || '').trim(),
      source: String(edge.source || '').trim(),
      target: String(edge.target || '').trim(),
      predicate: String(edge.predicate || '').trim(),
      provenance: isRecord(edge.provenance)
        ? { ...edge.provenance, ...provenance, nativeId: String(edge.id || '').trim() }
        : { ...provenance, nativeId: String(edge.id || '').trim() },
    }))
    .filter((edge) => (
      edge.id
      && nativeEdgeIds.has(edge.id)
      && visibleNodeIds.has(edge.source)
      && visibleNodeIds.has(edge.target)
    ))
    .slice(0, MAX_OPERATION_EDGES)
    .map((edge): GraphProjectionEdge => ({
      ...edge,
      mentionCount: 1,
      properties: attentionProperties({ nativeId: edge.id }, context),
    }));
  if (nodes.length === 0 && edges.length === 0) return null;
  for (const item of [...nodes, ...edges]) {
    if (event.runState && !['running', 'observing'].includes(event.runState)) {
      item.properties = { ...item.properties, attentionActive: false };
    }
  }
  return { authority, projection: projection(authority, args.projectId, nodes, edges) };
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
  const activeScopeRef = useRef<{ clientRunId: string; serverRunId: string | null } | null>(null);
  const seenEventIdsRef = useRef(new Set<string>());
  const selectedRunRef = useRef<string | null>(null);
  const mainActorRef = useRef<string | null>(null);

  useEffect(() => {
    activeScopeRef.current = null;
    seenEventIdsRef.current.clear();
    selectedRunRef.current = null;
    setErrors({});
    setProjections(emptyAttention(projectId));
  }, [deckId, projectId, selectedCardId]);

  useEffect(() => { activeScopeRef.current = null; }, [conversationId]);

  const merge = useCallback((authority: GraphAttentionAuthority, incoming: GraphProjectionV1) => {
    setProjections((current) => ({
      ...current,
      [authority]: mergeAttentionProjection(current[authority], incoming),
    }));
    setErrors((current) => ({ ...current, [authority]: undefined }));
  }, []);

  const observeAttentionEvent = useCallback((event: NativeAttentionEvent) => {
    if (event.projectId !== projectId || event.deckId !== deckId || !event.runId
      || !['thinkgraph', 'knowgraph', 'codegraph'].includes(event.authority) || event.persisted === false
      || !event.eventId || !event.toolName || !event.resultHash || !Number.isFinite(Date.parse(event.timestamp))
      || (event.phase && event.phase !== 'completed')) return;
    if (selectedCardId && (event.cardId !== selectedCardId || event.nativeChildId
      || event.runId !== selectedRunRef.current
      || (event.runState && !['running', 'observing'].includes(event.runState)))) return;
    const key = `${event.eventId}:${event.phase || 'completed'}:${event.resultHash}`;
    if (seenEventIdsRef.current.has(key)) return;
    if (event.change === 'delete' || event.change === 'clear') {
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
      const result = projectNativeAttentionEvent({ event, projectId, deckId });
      if (!result) return;
      merge(result.authority, result.projection);
    }
    seenEventIdsRef.current.add(key);
    if (seenEventIdsRef.current.size > 2048) {
      seenEventIdsRef.current.delete(seenEventIdsRef.current.values().next().value!);
    }
  }, [deckId, merge, projectId, selectedCardId]);

  const observeAttentionSession = useCallback((session: NativeAttentionSession) => {
    if (session.projectId !== projectId || session.deckId !== deckId) return;
    if (selectedCardId && (session.cardId !== selectedCardId || session.nativeChildId)) return;
    const active = ['running', 'observing'].includes(session.state || '');
    if (selectedCardId) {
      const nextRun = active ? session.runId : null;
      if (selectedRunRef.current !== nextRun || !nextRun) {
        selectedRunRef.current = nextRun;
        seenEventIdsRef.current.clear();
        setProjections(emptyAttention(projectId));
      }
    } else if (!active) {
      setProjections((current) => Object.fromEntries(Object.entries(current).map(([authority, value]) => [authority, {
        ...value, nodes: value.nodes.map((node) => node.properties?.attentionRunId === session.runId
          ? { ...node, properties: { ...node.properties, attentionActive: false } } : node),
        edges: value.edges.map((edge) => edge.properties?.attentionRunId === session.runId
          ? { ...edge, properties: { ...edge.properties, attentionActive: false } } : edge),
      }])) as typeof current);
    }
    if (!active || !session.runId) return;
    // READ edges already record the IDs Python actually materialized. They
    // are not tool calls and do not imply any descendant traversal.
    for (const authority of ['thinkgraph', 'knowgraph', 'codegraph'] as const) {
      const nodes = (session.materializedNativeReferences || [])
        .filter((ref) => ref.authority.toLowerCase() === authority && ref.nativeId)
        .map((ref): GraphProjectionNode => ({ id: ref.nativeId, canonicalId: ref.nativeId,
          label: ref.nativeId, type: 'NativeReference', authority, mentionCount: 1,
          properties: attentionProperties({ nativeId: ref.nativeId, attentionSource: 'materialized-read' }, {
            actorCardId: session.cardId, actorColor: CARD_ACTIVE_COLOR,
            toolName: '', operation: 'read', runId: session.runId,
          }),
          provenance: { authority, nativeId: ref.nativeId, runId: session.runId,
            cardId: session.cardId, source: 'AGE READ' },
        }));
      if (nodes.length) merge(authority, projection(authority, projectId, nodes.slice(0, MAX_OPERATION_NODES)));
    }
  }, [deckId, merge, projectId, selectedCardId]);

  const startAttentionScope = useCallback((turn: MainChatTurnStarted) => {
    if (turn.projectId !== projectId || turn.conversationId !== conversationId) return;
    activeScopeRef.current = { clientRunId: turn.runId, serverRunId: null };
    setErrors({});
    // A new Main turn must not erase another independently running Card.
    const actor = mainActorRef.current;
    if (actor && (!selectedCardId || actor === selectedCardId)) {
      setProjections((current) => Object.fromEntries(Object.entries(current).map(([authority, value]) => {
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
    if (activeScopeRef.current?.clientRunId === turn.runId) activeScopeRef.current = null;
  }, []);

  const expandNode = useCallback(async ({
    authority,
    node,
    projectId,
    codeGraphProject,
  }: ExpandRequest) => {
    const actorCardId = typeof node.properties?.attentionActorCardId === 'string'
      ? node.properties.attentionActorCardId
      : null;
    const actorColor = String(node.properties?.attentionActorColor || UNKNOWN_ACTOR_COLOR);
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
        incoming = decorateNativeProjection(authority, payload, projectId, {
          actorCardId, actorColor, toolName: 'engraphis.neighborhood',
        });
      } else if (authority === 'knowgraph') {
        const query = new URLSearchParams({ projectId, nodeId: node.id, limit: '50', depth: '1' });
        const response = await fetch(`/api/knowgraph/expand?${query.toString()}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !isRecord(payload)) throw new Error(String(payload?.error?.message || payload?.error || `HTTP ${response.status}`));
        incoming = decorateNativeProjection(authority, payload, projectId, {
          actorCardId, actorColor, toolName: 'graphiti.expand',
        });
      } else {
        if (!codeGraphProject) throw new Error('CodeGraph project is not ready');
        const output = await callCbmTool<Record<string, unknown>>('trace_path', {
          project: codeGraphProject,
          function_name: String(node.properties?.qualified_name || node.properties?.qualifiedName || node.id),
          direction: 'both',
          depth: 1,
          mode: 'calls',
          include_tests: false,
        });
        incoming = projectCodeGraphResult(output, projectId, {
          actorCardId, actorColor, toolName: 'cbm.trace_path',
        }, node);
      }
      merge(authority, incoming);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [authority]: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, [merge, selectedCardId]);

  return {
    projections,
    errors,
    startAttentionScope,
    observeNativeTurnEvent,
    finishAttentionScope,
    observeAttentionEvent,
    observeAttentionSession,
    expandNode,
  };
}
