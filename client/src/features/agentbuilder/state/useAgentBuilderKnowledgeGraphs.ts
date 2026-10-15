import { useCallback, useEffect, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/KnowledgeAuthorityGraphSurface';
import { applyJevGraphPhysics } from '../../../components/knowledge/jevGraphPhysics';
import type { KnowledgeGraphKind } from '../../../types/agentgraph';

type KnowledgeGraphState = {
  projections: Record<KnowledgeGraphKind, GraphProjectionV1>;
  errors: Partial<Record<KnowledgeGraphKind, string>>;
  statuses: Record<KnowledgeGraphKind, 'idle' | 'loading' | 'ready' | 'error'>;
  readProviderNeighborhood: (
    graph: KnowledgeGraphKind,
    providerId: string,
    signal?: AbortSignal,
  ) => Promise<GraphProjectionV1>;
  removeThinkGraphEvidence: (memoryId: string) => Promise<void>;
  removeKnowGraphEvidence: (episodeId: string) => Promise<void>;
};

const KNOWGRAPH_STARTUP_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

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

function knowGraphProjection(
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
  if (payload.nodes.some((node: any) => node.type !== 'Entity')) {
    throw new Error('invalid_knowgraph_projection');
  }
  const entityIds = new Set(payload.nodes.map((node: any) => node.id));
  if (payload.relationships.some((edge: any) => (
    !entityIds.has(edge.from) || !entityIds.has(edge.to)
  ))) throw new Error('invalid_knowgraph_projection');
  const nodes = payload.nodes.map((node: any) => ({
    ...node,
    canonicalName: node.label,
    entityKind: node.type,
    projectId,
  }));
  return applyJevGraphPhysics({
    ...emptyProjection('knowgraph', projectId),
    nodes,
    edges: payload.relationships
      .map((edge: any) => ({
        ...edge,
        source: edge.from,
        target: edge.to,
        predicate: edge.type,
      })),
    counts: {
      nodes: nodes.length,
      edges: payload.relationships.length,
    },
  }, 'balanced');
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
  const thinkAbortRef = useRef<AbortController | null>(null);
  const knowAbortRef = useRef<AbortController | null>(null);

  const refreshThinkGraph = useCallback(async () => {
    const requestId = ++thinkRequestRef.current;
    thinkAbortRef.current?.abort();
    const controller = new AbortController();
    thinkAbortRef.current = controller;
    if (!projectId.trim()) {
      setStatuses((current) => ({ ...current, thinkgraph: 'ready' }));
      return;
    }
    setStatuses((current) => ({ ...current, thinkgraph: 'loading' }));
    try {
      const query = new URLSearchParams({ projectId });
      const response = await fetch(`/api/thinkgraph/projection?${query}`, {
        signal: controller.signal,
      });
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
        thinkgraph: payload as GraphProjectionV1,
      }));
      setErrors((current) => ({ ...current, thinkgraph: undefined }));
      setStatuses((current) => ({ ...current, thinkgraph: 'ready' }));
    } catch (error) {
      if (controller.signal.aborted || requestId !== thinkRequestRef.current) return;
      setErrors((current) => ({
        ...current,
        thinkgraph: error instanceof Error ? error.message : String(error),
      }));
      setStatuses((current) => ({ ...current, thinkgraph: 'error' }));
    }
  }, [projectId]);

  const refreshKnowGraph = useCallback(async (): Promise<boolean> => {
    const requestId = ++knowRequestRef.current;
    knowAbortRef.current?.abort();
    const controller = new AbortController();
    knowAbortRef.current = controller;
    if (!projectId.trim()) {
      setStatuses((current) => ({ ...current, knowgraph: 'ready' }));
      return true;
    }
    setStatuses((current) => ({ ...current, knowgraph: 'loading' }));
    let lastFailure: unknown = null;
    for (let attempt = 0; attempt <= KNOWGRAPH_STARTUP_RETRY_DELAYS_MS.length; attempt += 1) {
      if (requestId !== knowRequestRef.current) return false;
      try {
        const query = new URLSearchParams({ projectId, limit: '200' });
        const response = await fetch(`/api/knowgraph/graph?${query}`, {
          signal: controller.signal,
        });
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
        if (controller.signal.aborted || requestId !== knowRequestRef.current) return false;
        if (attempt >= KNOWGRAPH_STARTUP_RETRY_DELAYS_MS.length) break;
        await waitForRetry(KNOWGRAPH_STARTUP_RETRY_DELAYS_MS[attempt], controller.signal);
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
    setErrors({});
    setProjections(emptyGraphs(projectId));
    setStatuses({ thinkgraph: 'loading', knowgraph: 'loading' });
    void refreshThinkGraph();
    void refreshKnowGraph();
    return () => {
      thinkRequestRef.current += 1;
      knowRequestRef.current += 1;
      thinkAbortRef.current?.abort();
      knowAbortRef.current?.abort();
    };
  }, [conversationId, deckId, projectId, refreshKnowGraph, refreshThinkGraph]);

  const readProviderNeighborhood = useCallback(async (
    graph: KnowledgeGraphKind,
    providerId: string,
    signal?: AbortSignal,
  ): Promise<GraphProjectionV1> => {
    const query = graph === 'thinkgraph'
      ? new URLSearchParams({ projectId, canonicalId: providerId })
      : new URLSearchParams({ projectId, nodeId: providerId, limit: '50' });
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

  const removeThinkGraphEvidence = useCallback(async (memoryId: string) => {
    const response = await fetch('/api/thinkgraph/retire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, memoryId }),
    });
    if (!response.ok) throw new Error('Could not remove this item.');
    await refreshThinkGraph();
  }, [projectId, refreshThinkGraph]);

  const removeKnowGraphEvidence = useCallback(async (episodeId: string) => {
    const response = await fetch('/api/knowgraph/delete-episode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        graphiti_episode_uuid: episodeId,
      }),
    });
    if (!response.ok) throw new Error('Could not delete this Know.');
    await refreshKnowGraph();
  }, [projectId, refreshKnowGraph]);

  return {
    projections,
    errors,
    statuses,
    readProviderNeighborhood,
    removeThinkGraphEvidence,
    removeKnowGraphEvidence,
  };
}
