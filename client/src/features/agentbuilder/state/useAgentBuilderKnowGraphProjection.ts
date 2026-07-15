import { useEffect, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/KnowledgeGraphFramework';

export type KnowGraphProjectionState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  projection: GraphProjectionV1 | null;
  error: string | null;
};

// ── KnowGraph browse projection for the KnowGraph graph tab ─────────────────
// Reads the existing project-scoped Neo4j view (GET /api/knowgraph/graph —
// backend queryKnowGraphProject) and STRUCTURALLY renames its DTO fields into
// the one GraphProjectionV1 shape the shared Cytoscape surface renders
// (from/to → source/target, type → predicate). No classification, no scoring,
// no fallback data — an error or an empty graph is shown honestly. Mirrors
// useAgentBuilderThinkGraphProjection.
type KnowGraphNodeDto = { id: string; label: string; type: string; properties?: Record<string, unknown> };
type KnowGraphRelationshipDto = { id: string; from: string; to: string; type: string; properties?: Record<string, unknown> };

function toProjection(
  projectId: string,
  payload: { nodes?: KnowGraphNodeDto[]; relationships?: KnowGraphRelationshipDto[] },
): GraphProjectionV1 {
  const allNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const allRels = Array.isArray(payload.relationships) ? payload.relationships : [];
  // Layered trusted default view: hide raw Chunk nodes and untrusted anchor pipe-test
  // records so the graph shows genuine Concepts/Claims + precise relationships instead of a
  // chunk hairball. Nothing is deleted — evidence/chunks stay in Neo4j, expandable later.
  const isTrusted = (p?: Record<string, unknown>): boolean => {
    if (!p) return true;
    if (p.trusted === false || p.trusted === 'false') return false;
    if (p.extraction_mode === 'anchor_pipe_test') return false;
    return true;
  };
  const nodes = allNodes.filter((n) => n.type !== 'Chunk' && isTrusted(n.properties));
  const keptIds = new Set(nodes.map((n) => n.id));
  const relationships = allRels.filter((r) => keptIds.has(r.from) && keptIds.has(r.to));
  // Mechanical degree count drives bubble size — a real returned integer,
  // same contract mentionCount carries for ThinkGraph.
  const degree = new Map<string, number>();
  for (const rel of relationships) {
    degree.set(rel.from, (degree.get(rel.from) || 0) + 1);
    degree.set(rel.to, (degree.get(rel.to) || 0) + 1);
  }
  return {
    schemaVersion: 'knowgraph.projection.v1',
    projectId,
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.label || node.id,
      title: node.label || node.id,
      type: node.type,
      labels: node.type ? [node.type] : undefined,
      mentionCount: degree.get(node.id) || 1,
      properties: node.properties,
    })),
    edges: relationships.map((rel) => ({
      id: rel.id,
      source: rel.from,
      target: rel.to,
      predicate: rel.type,
      mentionCount: 1,
      properties: rel.properties,
    })),
  };
}

export default function useAgentBuilderKnowGraphProjection({
  activeProject,
  knowledgeGraphKind,
  workspaceView,
}: {
  activeProject: string;
  knowledgeGraphKind: string;
  workspaceView: string;
}): KnowGraphProjectionState {
  const [state, setState] = useState<KnowGraphProjectionState>({
    status: 'idle',
    projection: null,
    error: null,
  });
  // Refetch when a chat turn completes (same knowledge:refresh signal the
  // ThinkGraph projection uses): once immediately, then two bounded delayed
  // checks — never an open-ended poll.
  const [refreshNonce, setRefreshNonce] = useState(0);
  useEffect(() => {
    let timers: number[] = [];
    const onKnowledgeRefresh = () => {
      setRefreshNonce((n) => n + 1);
      timers.forEach((t) => window.clearTimeout(t));
      timers = [8_000, 20_000].map((delayMs) =>
        window.setTimeout(() => setRefreshNonce((n) => n + 1), delayMs),
      );
    };
    window.addEventListener('knowledge:refresh', onKnowledgeRefresh);
    return () => {
      window.removeEventListener('knowledge:refresh', onKnowledgeRefresh);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  const lastJsonRef = useRef<string | null>(null);
  useEffect(() => {
    if (workspaceView !== 'knowledge' || !['knowgraph', 'unified'].includes(knowledgeGraphKind)) return;
    // Optional explicit KnowGraph scope override (?kgScope=…) lets the view open ANY real
    // KnowGraph scope directly (e.g. an imported book under its own canonical scope) without
    // moving data. Defaults to the selected LiquidAIty project.
    const scopeOverride = new URLSearchParams(window.location.search).get('kgScope');
    const projectId = (scopeOverride && scopeOverride.trim()) || activeProject;
    if (!projectId) {
      lastJsonRef.current = null;
      setState({ status: 'idle', projection: null, error: null });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({
      ...prev,
      status: prev.projection ? prev.status : 'loading',
      error: null,
    }));
    void (async () => {
      try {
        const res = await fetch(
          `/api/knowgraph/graph?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        );
        const data = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !data || typeof data !== 'object') {
          lastJsonRef.current = null;
          setState({
            status: 'error',
            projection: null,
            error: String((data as any)?.error?.message || (data as any)?.error || `HTTP ${res.status}`),
          });
          return;
        }
        const json = JSON.stringify(data);
        if (json === lastJsonRef.current) return; // unchanged — no re-render
        lastJsonRef.current = json;
        setState({
          status: 'ready',
          projection: toProjection(projectId, data as any),
          error: null,
        });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        lastJsonRef.current = null;
        setState({
          status: 'error',
          projection: null,
          error: String(err?.message || err),
        });
      }
    })();
    return () => controller.abort();
  }, [activeProject, knowledgeGraphKind, workspaceView, refreshNonce]);

  return state;
}
