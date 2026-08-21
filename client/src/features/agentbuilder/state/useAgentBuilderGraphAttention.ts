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
  resultHash: string;
  truncated: boolean;
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
  restoreAttentionEvents: (events: NativeAttentionEvent[]) => void;
  expandNode: (request: ExpandRequest) => Promise<void>;
};

const CARD_ACTIVE_COLOR = '#37ADAA';
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
}): { authority: GraphAttentionAuthority; projection: GraphProjectionV1 } | null {
  const { event } = args;
  if (!['thinkgraph', 'knowgraph', 'codegraph'].includes(event.authority)) return null;
  const authority = event.authority as GraphAttentionAuthority;
  const nodeIds = [...new Set(
    (Array.isArray(event.nativeNodeIds) ? event.nativeNodeIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )].slice(0, MAX_OPERATION_NODES);
  if (nodeIds.length === 0) return null;
  const context = {
    actorCardId: event.cardId,
    actorColor: event.cardId ? CARD_ACTIVE_COLOR : UNKNOWN_ACTOR_COLOR,
    toolName: event.toolName,
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
    codeGraphRef: authority === 'codegraph' ? nativeId : undefined,
    knowGraphRef: authority === 'knowgraph' ? nativeId : undefined,
  }));
  return { authority, projection: projection(authority, args.projectId, nodes, []) };
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

export default function useAgentBuilderGraphAttention({ projectId }: { projectId: string }): GraphAttentionState {
  const [projections, setProjections] = useState(() => emptyAttention(projectId));
  const [errors, setErrors] = useState<Partial<Record<GraphAttentionAuthority, string>>>({});
  const activeRunRef = useRef<string | null>(null);

  useEffect(() => {
    activeRunRef.current = null;
    setErrors({});
    setProjections(emptyAttention(projectId));
  }, [projectId]);

  const merge = useCallback((authority: GraphAttentionAuthority, incoming: GraphProjectionV1) => {
    setProjections((current) => ({
      ...current,
      [authority]: mergeAttentionProjection(current[authority], incoming),
    }));
    setErrors((current) => ({ ...current, [authority]: undefined }));
  }, []);

  const startAttentionScope = useCallback((turn: MainChatTurnStarted) => {
    activeRunRef.current = turn.runId;
    setErrors({});
    setProjections(emptyAttention(turn.projectId));
  }, []);

  const observeNativeTurnEvent = useCallback((turn: MainChatTurnEvent) => {
    if (activeRunRef.current !== turn.runId) return;
    const event = turn.event as NativeAttentionEvent;
    if (event.kind !== 'native_attention') return;
    const result = projectNativeAttentionEvent({
      event,
      projectId: turn.projectId,
    });
    if (result) merge(result.authority, result.projection);
  }, [merge]);

  const finishAttentionScope = useCallback((turn: MainChatTurnFinished) => {
    if (activeRunRef.current === turn.runId) activeRunRef.current = null;
  }, []);

  const restoreAttentionEvents = useCallback((events: NativeAttentionEvent[]) => {
    for (const event of events) {
      const result = projectNativeAttentionEvent({ event, projectId });
      if (result) merge(result.authority, result.projection);
    }
  }, [merge, projectId]);

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
  }, [merge]);

  return {
    projections,
    errors,
    startAttentionScope,
    observeNativeTurnEvent,
    finishAttentionScope,
    restoreAttentionEvents,
    expandNode,
  };
}
