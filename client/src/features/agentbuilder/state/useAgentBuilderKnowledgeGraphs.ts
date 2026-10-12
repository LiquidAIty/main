import { useCallback, useEffect, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/joinedKnowledgeGraphProjection';
import type { CanonicalEntityHeader } from '../../../components/knowledge/canonicalEntityDirectory';
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

export type KnowledgeGraphState = {
  projections: Record<KnowledgeGraphKind, GraphProjectionV1>;
  errors: Partial<Record<KnowledgeGraphKind, string>>;
  statuses: Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>;
  refreshThinkGraph: () => Promise<void>;
  refreshKnowGraph: () => Promise<boolean>;
  readProviderNeighborhood: (
    graph: KnowledgeGraphKind,
    providerId: string,
    signal?: AbortSignal,
  ) => Promise<GraphProjectionV1>;
  readEntityContext: (
    entity: CanonicalEntityHeader,
    query: string,
    limit?: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, any>>;
  removeThinkGraphEvidence: (memoryId: string) => Promise<void>;
  removeThinkGraphRelationship: (edgeId: string) => Promise<void>;
  removeKnowGraphEvidence: (episodeId: string) => Promise<void>;
  removeKnowGraphRelationship: (graphitiRelationshipId: string) => Promise<void>;
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
  const entities = payload.nodes.filter((node: any) => node.type === 'Entity');
  const episodes = payload.nodes.filter((node: any) => node.type === 'Episodic');
  const entityIds = new Set(entities.map((node: any) => node.id));
  const nodes = entities.map((node: any) => ({
    ...node,
    canonicalName: node.label,
    projectId,
  }));
  return applyKnowGraphJevPhysics({
    ...emptyProjection('knowgraph', projectId),
    nodes,
    edges: payload.relationships
      .filter((edge: any) => entityIds.has(edge.from) && entityIds.has(edge.to))
      .map((edge: any) => ({
        ...edge,
        source: edge.from,
        target: edge.to,
        predicate: edge.type,
      })),
    counts: {
      nodes: nodes.length,
      edges: payload.relationships.filter((edge: any) => (
        entityIds.has(edge.from) && entityIds.has(edge.to)
      )).length,
    },
    provenanceNodes: episodes,
  });
}

export default function useAgentBuilderKnowledgeGraphs({
  projectId,
  deckId,
  conversationId,
}: {
  projectId: string;
  deckId: string;
  conversationId: string;
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

  useEffect(() => {
    if (!projectId) return undefined;
    const query = new URLSearchParams({ projectId, deckId, conversationId });
    const stream = new EventSource(
      `/api/thinkgraph/revisions?${query.toString()}`,
      { withCredentials: true },
    );
    stream.addEventListener('thinkgraph_revision', (event) => {
      observeThinkGraphRevision(JSON.parse((event as MessageEvent).data));
    });
    stream.addEventListener('thinkgraph_error', (event) => {
      observeThinkGraphFailure(JSON.parse((event as MessageEvent).data));
    });
    stream.onerror = (error) => {
      console.warn('[THINKGRAPH_REVISION_STREAM]', error);
    };
    return () => stream.close();
  }, [
    conversationId,
    deckId,
    observeThinkGraphFailure,
    observeThinkGraphRevision,
    projectId,
  ]);

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

  const readEntityContext = useCallback(async (
    entity: CanonicalEntityHeader,
    query: string,
    limit = 1,
    signal?: AbortSignal,
  ): Promise<Record<string, any>> => {
    const currentQuery = query.trim();
    if (!currentQuery) throw new Error('current_request_required');
    const response = await fetch('/api/project-graph/entity-context', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, query: currentQuery, limit, entities: [entity] }),
      ...(signal ? { signal } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !isRecord(payload)
      || payload.schemaVersion !== 'project-entity-context.v1'
      || payload.projectId !== projectId
      || !Array.isArray(payload.entities)
      || payload.entities.length !== 1
      || !isRecord(payload.entities[0])) {
      throw new Error('project_entity_context_unavailable');
    }
    return payload.entities[0];
  }, [projectId]);

  const removeThinkGraphEvidence = useCallback(async (memoryId: string) => {
    const response = await fetch('/api/thinkgraph/retire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, memoryId }),
    });
    if (!response.ok) throw new Error('Could not remove this item.');
    await refreshThinkGraph();
  }, [projectId, refreshThinkGraph]);

  const removeThinkGraphRelationship = useCallback(async (edgeId: string) => {
    const response = await fetch('/api/thinkgraph/retire-relationship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, edgeId }),
    });
    if (!response.ok) throw new Error('Could not remove this item.');
    await refreshThinkGraph();
  }, [projectId, refreshThinkGraph]);

  const removeKnowGraphRelationship = useCallback(async (graphitiRelationshipId: string) => {
    const response = await fetch('/api/knowgraph/delete-fact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        graphiti_fact_uuid: graphitiRelationshipId,
        kind: 'fact',
      }),
    });
    if (!response.ok) throw new Error('Could not delete this Relationship.');
    await refreshKnowGraph();
  }, [projectId, refreshKnowGraph]);

  const removeKnowGraphEvidence = useCallback(async (episodeId: string) => {
    const response = await fetch('/api/knowgraph/delete-episode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        graphiti_episode_uuid: episodeId,
      }),
    });
    if (!response.ok) throw new Error('Could not remove this item.');
    await refreshKnowGraph();
  }, [projectId, refreshKnowGraph]);

  return {
    projections,
    errors,
    statuses,
    refreshThinkGraph,
    refreshKnowGraph,
    readProviderNeighborhood,
    readEntityContext,
    removeThinkGraphEvidence,
    removeThinkGraphRelationship,
    removeKnowGraphEvidence,
    removeKnowGraphRelationship,
  };
}
