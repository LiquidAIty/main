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
  actorCardId: string;
  actorColor: string;
  toolName: string;
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
  expandNode: (request: ExpandRequest) => Promise<void>;
};

const CARD_ACTIVE_COLOR = '#37ADAA';
const MAX_OPERATION_NODES = 200;
const MAX_OPERATION_EDGES = 300;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Unwrap the existing ACP/MCP result without consulting execution receipts. */
export function unwrapNativeToolOutput(value: unknown): Record<string, any> | null {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) {
    const rows = parsed.filter(isRecord);
    const contentBlocks = rows.some((item) => typeof item.text === 'string' && typeof item.type === 'string');
    if (!contentBlocks && rows.length > 0) return { rows };
    for (const item of parsed) {
      const unwrapped = unwrapNativeToolOutput(item);
      if (unwrapped) return unwrapped;
    }
    return null;
  }
  if (!isRecord(parsed) || Object.prototype.hasOwnProperty.call(parsed, 'executionReceipt')) {
    return null;
  }
  if (Array.isArray(parsed.content)) {
    for (const block of parsed.content) {
      const unwrapped = unwrapNativeToolOutput(isRecord(block) ? block.text : block);
      if (unwrapped) return unwrapped;
    }
  }
  if (isRecord(parsed.structuredContent?.result)) return parsed.structuredContent.result;
  const nestedOutput = unwrapNativeToolOutput(parsed.rawOutput ?? parsed.output);
  if (nestedOutput) return nestedOutput;
  if (isRecord(parsed.result) && Object.keys(parsed).every((key) => ['result', 'isError'].includes(key))) {
    return parsed.result;
  }
  return parsed;
}

function toolAuthority(toolName: string): GraphAttentionAuthority | null {
  const name = toolName.toLowerCase();
  if (/(^|[._])engraphis[._]/.test(name)) return 'thinkgraph';
  if (/(^|[._])graphiti[._]/.test(name)) return 'knowgraph';
  if (/(^|[._])cbm[._]/.test(name)) return 'codegraph';
  return null;
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

function projectThinkGraphResult(
  payload: Record<string, any>,
  projectId: string,
  context: AttentionContext,
): GraphProjectionV1 {
  const candidates = recordsAt(payload, [
    'memories', 'sources', 'history', 'answer', 'supersedes', 'records',
  ]);
  if (payload.id || payload.memory_id) candidates.unshift(payload);
  const nodes = candidates
    .map((record) => nodeFromRecord(record, 'thinkgraph', context, ['id', 'memory_id']))
    .filter((node): node is GraphProjectionNode => Boolean(node))
    .slice(0, MAX_OPERATION_NODES);
  const edges: GraphProjectionEdge[] = [];
  const direct = edgeFromRecord({
    id: payload.edge_id,
    source: payload.a,
    target: payload.b,
    relation: payload.relation,
  }, 'thinkgraph', context);
  if (direct) edges.push(direct);
  return projection('thinkgraph', projectId, nodes, edges);
}

function projectKnowGraphResult(
  payload: Record<string, any>,
  projectId: string,
  context: AttentionContext,
): GraphProjectionV1 {
  const candidates = recordsAt(payload, ['nodes', 'episodes', 'communities']);
  if (payload.uuid && !payload.source_node_uuid && !payload.target_node_uuid) {
    candidates.unshift(payload);
  }
  const nodes = candidates
    .map((record) => nodeFromRecord(record, 'knowgraph', context, ['uuid', 'id']))
    .filter((node): node is GraphProjectionNode => Boolean(node))
    .slice(0, MAX_OPERATION_NODES);
  const edgeCandidates = recordsAt(payload, ['edges', 'facts', 'relationships']);
  if (payload.source_node_uuid && payload.target_node_uuid) edgeCandidates.unshift(payload);
  const edges = edgeCandidates
    .map((record) => edgeFromRecord(record, 'knowgraph', context))
    .filter((edge): edge is GraphProjectionEdge => Boolean(edge))
    .slice(0, MAX_OPERATION_EDGES);
  return projection('knowgraph', projectId, nodes, edges);
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

export function projectNativeToolResult(args: {
  toolName: string;
  output: unknown;
  projectId: string;
  actorCardId: string;
  actorColor?: string;
  anchorNode?: GraphProjectionNode;
}): { authority: GraphAttentionAuthority; projection: GraphProjectionV1 } | null {
  const authority = toolAuthority(args.toolName);
  const payload = unwrapNativeToolOutput(args.output);
  if (!authority || !payload) return null;
  const context = {
    actorCardId: args.actorCardId,
    actorColor: args.actorColor || CARD_ACTIVE_COLOR,
    toolName: args.toolName,
  };
  const next = authority === 'thinkgraph'
    ? projectThinkGraphResult(payload, args.projectId, context)
    : authority === 'knowgraph'
      ? projectKnowGraphResult(payload, args.projectId, context)
      : projectCodeGraphResult(payload, args.projectId, context, args.anchorNode);
  if (next.nodes.length === 0 && next.edges.length === 0) return null;
  return { authority, projection: next };
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
  const pendingToolsRef = useRef(new Map<string, { toolName: string; actorCardId: string }>());

  useEffect(() => {
    activeRunRef.current = null;
    pendingToolsRef.current.clear();
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
    pendingToolsRef.current.clear();
    setErrors({});
    setProjections(emptyAttention(turn.projectId));
  }, []);

  const observeNativeTurnEvent = useCallback((turn: MainChatTurnEvent) => {
    if (activeRunRef.current !== turn.runId) return;
    const event = turn.event as Record<string, unknown>;
    const toolUseId = String(event.toolUseId || '');
    if (event.kind === 'tool_start') {
      pendingToolsRef.current.set(toolUseId, {
        toolName: String(event.toolName || ''),
        actorCardId: String(event.invokingCardId || ''),
      });
      return;
    }
    if (event.kind !== 'tool_result' || event.isError === true) return;
    const pending = pendingToolsRef.current.get(toolUseId);
    pendingToolsRef.current.delete(toolUseId);
    const result = projectNativeToolResult({
      toolName: String(event.toolName || pending?.toolName || ''),
      output: event.output,
      projectId: turn.projectId,
      actorCardId: String(event.invokingCardId || pending?.actorCardId || 'unknown-card'),
    });
    if (result) merge(result.authority, result.projection);
  }, [merge]);

  const finishAttentionScope = useCallback((turn: MainChatTurnFinished) => {
    if (activeRunRef.current === turn.runId) pendingToolsRef.current.clear();
  }, []);

  const expandNode = useCallback(async ({
    authority,
    node,
    projectId,
    codeGraphProject,
  }: ExpandRequest) => {
    const actorCardId = String(node.properties?.attentionActorCardId || 'unknown-card');
    const actorColor = String(node.properties?.attentionActorColor || CARD_ACTIVE_COLOR);
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
    expandNode,
  };
}
