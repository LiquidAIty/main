/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file owns the Project graph workspace's independent provider load, error, refresh, neighborhood, removal, and opt-in Code state.
 * Entity: ThinkGraph
 * Relationship: This file reads Engraphis projections and neighborhoods and subscribes to Project graph commits independently of Main chat.
 * Entity: KnowGraph
 * Relationship: This file validates Entity-only Graphiti projections, bounds startup retries, reads exact neighborhoods, and refreshes only after confirmed Know removal.
 * Entity: CodeGraph
 * Relationship: This file opens CodeGraph only on demand, validates its read envelopes, replaces the active File structure, and loads Symbol source only by explicit action.
 * Entity: Jev Decisions
 * Relationship: This file applies validated Jev relationship physics locally to the KnowGraph presentation without modifying provider data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/knowledgeGraphProjection';
import {
  emptyCodeGraphProjection,
  mergeCodeGraphProjections,
  validateCodeGraphReadEnvelope,
  type CodeGraphSelectedSymbol,
} from '../../../components/knowledge/codeGraphProjection';
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
  refreshThinkGraph: () => Promise<void>;
  codeGraph: {
    projection: GraphProjectionV1;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
    warning: string | null;
    freshness: string;
  };
  loadCodeGraph: () => Promise<GraphProjectionV1 | null>;
  readCodeGraphFile: (filePath: string) => Promise<GraphProjectionV1 | null>;
  readCodeGraphSource: (qualifiedName: string) => Promise<CodeGraphSelectedSymbol | null>;
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

function codeGraphMessage(value: {
  status: string;
  errors: Array<{ code: string }>;
}, fallback: string): string {
  return value.errors.map(error => error.code).filter(Boolean).join(' · ')
    || (value.status === 'not_found' ? 'codegraph_record_not_found' : fallback);
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
  const [codeGraph, setCodeGraph] = useState<KnowledgeGraphState['codeGraph']>(() => ({
    projection: emptyCodeGraphProjection(projectId),
    status: 'idle',
    error: null,
    warning: null,
    freshness: 'unverified',
  }));
  const codeProjectionRequestRef = useRef(0);
  const codeFileRequestRef = useRef(0);
  const codeSourceRequestRef = useRef(0);
  const codeBaseProjectionRef = useRef(emptyCodeGraphProjection(projectId));
  const codeProjectionAbortRef = useRef<AbortController | null>(null);
  const codeFileAbortRef = useRef<AbortController | null>(null);
  const codeSourceAbortRef = useRef<AbortController | null>(null);

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
      if (!response.ok) {
        throw new Error(String(
          isRecord(payload) && payload.error
            ? payload.error
            : `thinkgraph_http_${response.status}`,
        ));
      }
      if (!isRecord(payload) || payload.schemaVersion !== 'thinkgraph.engraphis.v1'
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
    setCodeGraph({
      projection: emptyCodeGraphProjection(projectId),
      status: 'idle',
      error: null,
      warning: null,
      freshness: 'unverified',
    });
    codeBaseProjectionRef.current = emptyCodeGraphProjection(projectId);
    codeProjectionRequestRef.current += 1;
    codeFileRequestRef.current += 1;
    codeSourceRequestRef.current += 1;
    codeProjectionAbortRef.current?.abort();
    codeFileAbortRef.current?.abort();
    codeSourceAbortRef.current?.abort();
    void refreshThinkGraph();
    void refreshKnowGraph();
    return () => {
      thinkRequestRef.current += 1;
      knowRequestRef.current += 1;
      thinkAbortRef.current?.abort();
      knowAbortRef.current?.abort();
      codeProjectionRequestRef.current += 1;
      codeFileRequestRef.current += 1;
      codeSourceRequestRef.current += 1;
      codeProjectionAbortRef.current?.abort();
      codeFileAbortRef.current?.abort();
      codeSourceAbortRef.current?.abort();
    };
  }, [conversationId, deckId, projectId, refreshKnowGraph, refreshThinkGraph]);

  useEffect(() => {
    if (!projectId.trim()) return undefined;
    const query = new URLSearchParams({ projectId });
    const stream = new EventSource(`/api/thinkgraph/events?${query}`, { withCredentials: true });
    const refresh = () => { void refreshThinkGraph(); };
    const disconnected = () => {
      setErrors(current => ({ ...current, thinkgraph: 'ThinkGraph live updates disconnected. Reconnecting.' }));
    };
    stream.addEventListener('ready', refresh);
    stream.addEventListener('changed', refresh);
    stream.addEventListener('error', disconnected);
    return () => {
      stream.removeEventListener('ready', refresh);
      stream.removeEventListener('changed', refresh);
      stream.removeEventListener('error', disconnected);
      stream.close();
    };
  }, [projectId, refreshThinkGraph]);

  const loadCodeGraph = useCallback(async (): Promise<GraphProjectionV1 | null> => {
    const requestId = ++codeProjectionRequestRef.current;
    codeProjectionAbortRef.current?.abort();
    const controller = new AbortController();
    codeProjectionAbortRef.current = controller;
    if (!projectId.trim()) {
      setCodeGraph(current => ({ ...current, status: 'ready' }));
      return emptyCodeGraphProjection(projectId);
    }
    setCodeGraph(current => ({
      ...current, status: 'loading', error: null, warning: null,
    }));
    try {
      const response = await fetch('/api/codegraph/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, mode: 'projection' }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(payload?.error || `codegraph_http_${response.status}`));
      }
      const envelope = validateCodeGraphReadEnvelope(payload, {
        projectId, mode: 'projection',
      });
      if (requestId !== codeProjectionRequestRef.current) return null;
      if (!envelope.projection || ['unavailable', 'not_found'].includes(envelope.status)) {
        throw new Error(codeGraphMessage(envelope, 'codegraph_projection_unavailable'));
      }
      const warning = envelope.status === 'partial'
        ? codeGraphMessage(envelope, 'codegraph_projection_partial')
        : null;
      codeBaseProjectionRef.current = envelope.projection;
      setCodeGraph({
        projection: envelope.projection,
        status: 'ready',
        error: null,
        warning,
        freshness: envelope.freshness.status,
      });
      return envelope.projection;
    } catch (error) {
      if (controller.signal.aborted || requestId !== codeProjectionRequestRef.current) return null;
      const message = error instanceof Error ? error.message : String(error);
      setCodeGraph(current => ({
        ...current, status: 'error', error: message, warning: null,
      }));
      return null;
    }
  }, [projectId]);

  const readCodeGraphFile = useCallback(async (
    filePath: string,
  ): Promise<GraphProjectionV1 | null> => {
    const requestId = ++codeFileRequestRef.current;
    codeFileAbortRef.current?.abort();
    const controller = new AbortController();
    codeFileAbortRef.current = controller;
    try {
      const response = await fetch('/api/codegraph/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, mode: 'file', filePath }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error || `codegraph_http_${response.status}`));
      const envelope = validateCodeGraphReadEnvelope(payload, { projectId, mode: 'file' });
      if (requestId !== codeFileRequestRef.current) return null;
      if (!envelope.projection || ['unavailable', 'not_found'].includes(envelope.status)) {
        throw new Error(codeGraphMessage(envelope, 'codegraph_file_unavailable'));
      }
      setCodeGraph(current => ({
        ...current,
        projection: mergeCodeGraphProjections(
          codeBaseProjectionRef.current, envelope.projection!,
        ),
        status: 'ready',
        error: null,
        warning: envelope.status === 'partial'
          ? codeGraphMessage(envelope, 'codegraph_file_partial')
          : current.warning,
        freshness: envelope.freshness.status,
      }));
      return envelope.projection;
    } catch (error) {
      if (controller.signal.aborted || requestId !== codeFileRequestRef.current) return null;
      throw error;
    }
  }, [projectId]);

  const readCodeGraphSource = useCallback(async (
    qualifiedName: string,
  ): Promise<CodeGraphSelectedSymbol | null> => {
    const requestId = ++codeSourceRequestRef.current;
    codeSourceAbortRef.current?.abort();
    const controller = new AbortController();
    codeSourceAbortRef.current = controller;
    try {
      const response = await fetch('/api/codegraph/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, mode: 'source', qualifiedName }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error || `codegraph_http_${response.status}`));
      const envelope = validateCodeGraphReadEnvelope(payload, { projectId, mode: 'source' });
      if (requestId !== codeSourceRequestRef.current) return null;
      if (!envelope.selectedSymbol || ['unavailable', 'not_found'].includes(envelope.status)) {
        throw new Error(codeGraphMessage(envelope, 'codegraph_source_unavailable'));
      }
      return envelope.selectedSymbol;
    } catch (error) {
      if (controller.signal.aborted || requestId !== codeSourceRequestRef.current) return null;
      throw error;
    }
  }, [projectId]);

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
    refreshThinkGraph,
    codeGraph,
    loadCodeGraph,
    readCodeGraphFile,
    readCodeGraphSource,
  };
}
