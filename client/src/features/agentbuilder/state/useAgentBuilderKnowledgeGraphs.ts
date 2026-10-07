import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  GraphProjectionEdge,
  GraphProjectionNode,
  GraphProjectionV1,
} from '../../../components/knowledge/KnowledgeAuthorityGraphSurface';
import { applyJevGraphPhysics } from '../../../components/knowledge/jevGraphPhysics';

export type KnowledgeGraphKind = 'thinkgraph' | 'knowgraph';

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
  graph: KnowledgeGraphKind;
  node: GraphProjectionNode;
};

export type KnowledgeGraphState = {
  projections: Record<KnowledgeGraphKind, GraphProjectionV1>;
  errors: Partial<Record<KnowledgeGraphKind, string>>;
  statuses: Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>;
  refreshThinkGraph: () => Promise<void>;
  refreshKnowGraph: () => Promise<boolean>;
  observeThinkGraphRevision: (event: ThinkGraphRevisionEvent) => void;
  observeThinkGraphFailure: (event: ThinkGraphLifecycleError) => void;
  readProviderNeighborhood: (
    graph: KnowledgeGraphKind,
    providerId: string,
    signal?: AbortSignal,
  ) => Promise<GraphProjectionV1>;
  expandNode: (request: ExpandRequest) => Promise<void>;
  removeThinkGraphEvidence: (memoryId: string) => Promise<void>;
  removeKnowGraphEvidence: (episodeId: string) => Promise<void>;
};

const KNOWGRAPH_STARTUP_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptyProjection(
  graph: KnowledgeGraphKind,
  projectId: string,
): GraphProjectionV1 {
  return {
    schemaVersion: `${graph}.projection.v1`,
    authority: graph,
    projectId,
    counts: { nodes: 0, edges: 0 },
    nodes: [],
    edges: [],
  };
}

function emptyGraphs(projectId: string): Record<KnowledgeGraphKind, GraphProjectionV1> {
  return {
    thinkgraph: emptyProjection('thinkgraph', projectId),
    knowgraph: emptyProjection('knowgraph', projectId),
  };
}

export function applyKnowGraphJevPhysics(value: GraphProjectionV1): GraphProjectionV1 {
  return applyJevGraphPhysics(value, 'balanced');
}

export function withSettlementHeat(
  projection: GraphProjectionV1,
  changedNodeIds: readonly string[],
): GraphProjectionV1 {
  const changed = new Set(changedNodeIds.filter(Boolean));
  return {
    ...projection,
    nodes: projection.nodes.map((node) => {
      const active = changed.has(node.id) || changed.has(String(node.canonicalId || ''));
      const { turn_heat_active: _previousActive, turn_heat: _previousHeat, ...rest } = node;
      return active ? { ...rest, turn_heat_active: true, turn_heat: 1 } : rest;
    }),
  };
}

export function knowGraphProjection(
  payload: Record<string, any>,
  projectId: string,
): GraphProjectionV1 {
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.relationships)
    || payload.nodes.some((node: any) => !isRecord(node)
      || typeof node.id !== 'string' || !node.id || typeof node.label !== 'string')
    || payload.relationships.some((edge: any) => !isRecord(edge)
      || typeof edge.id !== 'string' || !edge.id
      || typeof edge.from !== 'string' || !edge.from
      || typeof edge.to !== 'string' || !edge.to
      || typeof edge.type !== 'string' || !edge.type)) {
    throw new Error('invalid_knowgraph_projection');
  }
  const subjects = payload.nodes.filter((node: any) => node.type !== 'Episodic');
  const episodes = payload.nodes.filter((node: any) => node.type === 'Episodic');
  const subjectIds = new Set(subjects.map((node: any) => node.id));
  const episodeIds = new Set(episodes.map((node: any) => node.id));
  const episodeIdsBySubject = new Map<string, Set<string>>();
  for (const relationship of payload.relationships) {
    if (relationship.type !== 'MENTIONS') continue;
    const episodeId = episodeIds.has(relationship.from)
      ? relationship.from
      : episodeIds.has(relationship.to) ? relationship.to : null;
    const subjectId = subjectIds.has(relationship.from)
      ? relationship.from
      : subjectIds.has(relationship.to) ? relationship.to : null;
    if (!episodeId || !subjectId) continue;
    const values = episodeIdsBySubject.get(subjectId) || new Set<string>();
    values.add(episodeId);
    episodeIdsBySubject.set(subjectId, values);
  }
  const nodes = subjects.map((node: any) => ({
    ...node,
    canonicalName: node.label,
    entityKind: node.type,
    projectId,
    ...(episodeIdsBySubject.has(node.id)
      ? { provenanceEpisodeIds: [...episodeIdsBySubject.get(node.id)!] }
      : {}),
  }));
  return applyKnowGraphJevPhysics({
    ...emptyProjection('knowgraph', projectId),
    nodes,
    edges: payload.relationships
      .filter((edge: any) => subjectIds.has(edge.from) && subjectIds.has(edge.to))
      .map((edge: any) => ({
        ...edge,
        source: edge.from,
        target: edge.to,
        predicate: edge.type,
      })),
    counts: {
      nodes: nodes.length,
      edges: payload.relationships.filter((edge: any) => (
        subjectIds.has(edge.from) && subjectIds.has(edge.to)
      )).length,
    },
    provenanceNodes: episodes,
  });
}

export function mergeGraphProjection(
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

export default function useAgentBuilderKnowledgeGraphs({
  projectId,
  deckId,
  conversationId,
  selectedCardId = null,
}: {
  projectId: string;
  deckId: string;
  conversationId: string;
  selectedCardId?: string | null;
}): KnowledgeGraphState {
  const [projections, setProjections] = useState(() => emptyGraphs(projectId));
  const [errors, setErrors] = useState<Partial<Record<KnowledgeGraphKind, string>>>({});
  const [statuses, setStatuses] = useState<KnowledgeGraphState['statuses']>({
    thinkgraph: 'loading',
    knowgraph: 'loading',
  });
  const thinkRequestRef = useRef(0);
  const knowRequestRef = useRef(0);
  const seenThinkRevisionsRef = useRef(new Set<string>());

  const refreshThinkGraph = useCallback(async (changedNodeIds: readonly string[] = []) => {
    const requestId = ++thinkRequestRef.current;
    if (!projectId.trim()) {
      setStatuses((current) => ({ ...current, thinkgraph: 'ready' }));
      return;
    }
    setStatuses((current) => ({ ...current, thinkgraph: 'loading' }));
    try {
      const query = new URLSearchParams({ projectId });
      const response = await fetch(`/api/thinkgraph/projection?${query}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !isRecord(payload)
        || payload.schemaVersion !== 'thinkgraph.engraphis.v1'
        || payload.authority !== 'engraphis'
        || payload.projectId !== projectId
        || !Array.isArray(payload.nodes)
        || !Array.isArray(payload.edges)) {
        throw new Error('invalid_thinkgraph_projection');
      }
      if (requestId !== thinkRequestRef.current) return;
      setProjections((current) => ({
        ...current,
        thinkgraph: withSettlementHeat(payload as GraphProjectionV1, changedNodeIds),
      }));
      setErrors((current) => ({ ...current, thinkgraph: undefined }));
      setStatuses((current) => ({ ...current, thinkgraph: 'ready' }));
    } catch (error) {
      if (requestId !== thinkRequestRef.current) return;
      setErrors((current) => ({
        ...current,
        thinkgraph: error instanceof Error ? error.message : String(error),
      }));
      setStatuses((current) => ({ ...current, thinkgraph: 'error' }));
    }
  }, [projectId]);

  const refreshKnowGraph = useCallback(async (): Promise<boolean> => {
    const requestId = ++knowRequestRef.current;
    if (!projectId.trim()) {
      setStatuses((current) => ({ ...current, knowgraph: 'ready' }));
      return true;
    }
    setStatuses((current) => ({ ...current, knowgraph: 'loading' }));
    let lastFailure: unknown = null;
    for (let attempt = 0; attempt <= KNOWGRAPH_STARTUP_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const query = new URLSearchParams({ projectId, limit: '200' });
        const response = await fetch(`/api/knowgraph/graph?${query}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !isRecord(payload)) throw new Error('Knowledge could not be loaded.');
        if (requestId !== knowRequestRef.current) return false;
        setProjections((current) => ({
          ...current,
          knowgraph: knowGraphProjection(payload, projectId),
        }));
        setErrors((current) => ({ ...current, knowgraph: undefined }));
        setStatuses((current) => ({ ...current, knowgraph: 'ready' }));
        return true;
      } catch (error) {
        lastFailure = error;
        if (requestId !== knowRequestRef.current) return false;
        if (attempt >= KNOWGRAPH_STARTUP_RETRY_DELAYS_MS.length) break;
        await new Promise<void>((resolve) => window.setTimeout(
          resolve,
          KNOWGRAPH_STARTUP_RETRY_DELAYS_MS[attempt],
        ));
      }
    }
    setErrors((current) => ({
      ...current,
      knowgraph: lastFailure instanceof Error ? lastFailure.message : String(lastFailure),
    }));
    setStatuses((current) => ({ ...current, knowgraph: 'error' }));
    return false;
  }, [projectId]);

  useEffect(() => {
    seenThinkRevisionsRef.current.clear();
    setErrors({});
    setProjections(emptyGraphs(projectId));
    setStatuses({ thinkgraph: 'loading', knowgraph: 'loading' });
    void refreshThinkGraph();
    void refreshKnowGraph();
    return () => {
      thinkRequestRef.current += 1;
      knowRequestRef.current += 1;
    };
  }, [conversationId, deckId, projectId, refreshKnowGraph, refreshThinkGraph]);

  const observeThinkGraphRevision = useCallback((event: ThinkGraphRevisionEvent) => {
    if (event.projectId !== projectId || event.deckId !== deckId
      || event.conversationId !== conversationId || event.stage !== 'settled'
      || !event.revision || seenThinkRevisionsRef.current.has(event.revision)) return;
    seenThinkRevisionsRef.current.add(event.revision);
    void refreshThinkGraph(event.changedNodeIds);
  }, [conversationId, deckId, projectId, refreshThinkGraph]);

  const observeThinkGraphFailure = useCallback((event: ThinkGraphLifecycleError) => {
    if (event.projectId !== projectId || event.deckId !== deckId
      || event.conversationId !== conversationId) return;
    setErrors((current) => ({ ...current, thinkgraph: event.error }));
  }, [conversationId, deckId, projectId]);

  const readProviderNeighborhood = useCallback(async (
    graph: KnowledgeGraphKind,
    providerId: string,
    signal?: AbortSignal,
  ): Promise<GraphProjectionV1> => {
    const query = graph === 'thinkgraph'
      ? new URLSearchParams({ projectId, canonicalId: providerId })
      : new URLSearchParams({ projectId, nodeId: providerId, limit: '50', depth: '1' });
    const response = await fetch(
      graph === 'thinkgraph'
        ? `/api/thinkgraph/neighborhood?${query}`
        : `/api/knowgraph/expand?${query}`,
      signal ? { signal } : undefined,
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !isRecord(payload)) {
      throw new Error(String(payload?.error?.message || payload?.error || `HTTP ${response.status}`));
    }
    if (graph === 'thinkgraph') {
      if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
        throw new Error('invalid_thinkgraph_projection');
      }
      return payload as GraphProjectionV1;
    }
    return knowGraphProjection(payload, projectId);
  }, [projectId]);

  const expandNode = useCallback(async ({ graph, node }: ExpandRequest) => {
    if (selectedCardId) throw new Error('Deselect the Card to expand the overall graph.');
    try {
      const incoming = await readProviderNeighborhood(
        graph,
        graph === 'thinkgraph' ? String(node.canonicalId || node.id) : node.id,
      );
      setProjections((current) => ({
        ...current,
        [graph]: mergeGraphProjection(current[graph], incoming),
      }));
      setErrors((current) => ({ ...current, [graph]: undefined }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [graph]: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }, [readProviderNeighborhood, selectedCardId]);

  const removeThinkGraphEvidence = useCallback(async (memoryId: string) => {
    const response = await fetch('/api/thinkgraph/retire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, memoryId }),
    });
    if (!response.ok) throw new Error('Could not remove this item.');
    await refreshThinkGraph();
  }, [projectId, refreshThinkGraph]);

  const removeKnowGraphEvidence = useCallback(async (graphitiFactUuid: string) => {
    const response = await fetch('/api/knowgraph/delete-fact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        graphiti_fact_uuid: graphitiFactUuid,
        kind: 'fact',
      }),
    });
    if (!response.ok) throw new Error('Could not delete this Know.');
    await refreshKnowGraph();
  }, [projectId, refreshKnowGraph]);

  return {
    projections,
    errors,
    statuses,
    refreshThinkGraph,
    refreshKnowGraph,
    observeThinkGraphRevision,
    observeThinkGraphFailure,
    readProviderNeighborhood,
    expandNode,
    removeThinkGraphEvidence,
    removeKnowGraphEvidence,
  };
}
