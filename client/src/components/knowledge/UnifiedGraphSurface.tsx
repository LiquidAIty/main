import { useEffect, useMemo, useState } from 'react';

import { CodeGraphScene } from '../codegraph/CodeGraphScene';
import { fetchLayout } from '../codegraph/CodeGraphSurface';
import type { CodeGraphData, CodeGraphEdge, CodeGraphNode } from '../codegraph/types';
import GlassInspectorSection from '../graph/GlassInspectorSection';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
  graphGlassPillStyle,
} from '../graph/graphVisualTokens';
import type { GraphProjectionV1 } from './KnowledgeGraphFramework';
import type { GraphView } from './graphView';

type Layer = 'thinkgraph' | 'knowgraph' | 'codegraph';
type InspectorTab = 'view' | 'invocation' | 'node';

const LAYER = {
  thinkgraph: { label: 'ThinkGraph', color: '#4AE2DF', z: 110 },
  knowgraph: { label: 'KnowGraph', color: '#B8C8D2', z: 0 },
  codegraph: { label: 'CodeGraph', color: '#5EA8FF', z: -120 },
} as const;

function projectionPosition(index: number, count: number, z: number) {
  const angle = index * 2.399963229728653;
  const radius = count <= 1 ? 0 : 18 + Math.sqrt(index + 1) * Math.max(14, Math.min(22, 240 / Math.sqrt(count)));
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: z + ((index % 7) - 3) * 2.5,
  };
}

function codeSlicePosition(index: number) {
  const angle = index * 2.399963229728653;
  const radius = 28 + Math.sqrt(index + 1) * 23;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: ((index % 5) - 2) * 2,
  };
}

function connectedCodeSlice(data: CodeGraphData | null, budget: number): CodeGraphNode[] {
  if (!data?.nodes.length) return [];
  if (data.nodes.length <= budget) return data.nodes;
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const neighbors = new Map<number, Set<number>>();
  for (const edge of data.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set());
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set());
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  const ranked = [...data.nodes].sort((a, b) => (neighbors.get(b.id)?.size || 0) - (neighbors.get(a.id)?.size || 0));
  const chosen = new Set<number>();
  for (const seed of ranked) {
    if (chosen.size >= budget) break;
    if (chosen.has(seed.id)) continue;
    const queue = [seed.id];
    while (queue.length && chosen.size < budget) {
      const id = queue.shift()!;
      if (chosen.has(id)) continue;
      chosen.add(id);
      const next = [...(neighbors.get(id) || [])]
        .filter((neighbor) => !chosen.has(neighbor))
        .sort((a, b) => (neighbors.get(b)?.size || 0) - (neighbors.get(a)?.size || 0));
      queue.push(...next);
    }
  }
  return [...chosen].map((id) => nodeById.get(id)!).filter(Boolean);
}

function readableValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const values = value.map((item) => readableValue(item)).filter((item): item is string => Boolean(item));
    return values.length ? values.slice(0, 12).join(' · ') : null;
  }
  return null;
}

function referenceValues(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[\s,|]+/).map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(referenceValues);
  return [];
}

function propertyValue(node: CodeGraphNode, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readableValue(node.properties?.[key]);
    if (value) return value;
  }
  return undefined;
}

function leadFor(node: CodeGraphNode): string {
  const properties = node.properties || {};
  for (const key of ['text', 'summary', 'description', 'goal', 'question', 'decision', 'content']) {
    const value = readableValue(properties[key]);
    if (value) return value;
  }
  if (node.file_path) return `${node.name} is a ${node.label} in ${node.file_path}.`;
  return `${node.name} is a ${node.label} record from ${LAYER[node.authority || 'codegraph'].label}.`;
}

export default function UnifiedGraphSurface({
  projectId,
  codeGraphProject,
  thinkProjection,
  knowProjection,
  focusedThinkIds,
  conversationId,
  authorityFocus = 'unified',
  runtimeHandbacks = [],
  onCandidateHandbacksChange,
}: {
  projectId: string;
  codeGraphProject: string;
  thinkProjection?: GraphProjectionV1;
  knowProjection?: GraphProjectionV1;
  focusedThinkIds?: string[];
  conversationId: string;
  authorityFocus?: Layer | 'unified';
  runtimeHandbacks?: GraphView[];
  onCandidateHandbacksChange?: (handbacks: GraphView[]) => void;
}) {
  const [codeData, setCodeData] = useState<CodeGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabled = useMemo<Record<Layer, boolean>>(() => ({
    thinkgraph: authorityFocus === 'unified' || authorityFocus === 'thinkgraph',
    knowgraph: authorityFocus === 'unified' || authorityFocus === 'knowgraph',
    codegraph: authorityFocus === 'unified' || authorityFocus === 'codegraph',
  }), [authorityFocus]);
  const codeBudget = 90;
  const reasoningBudget = 300;
  const [pinnedContextRefs, setPinnedContextRefs] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<CodeGraphNode | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('view');
  const [hopDepth, setHopDepth] = useState(1);
  const [nodeTypeFilter, setNodeTypeFilter] = useState('all');
  const [trustFilter, setTrustFilter] = useState('all');
  const [viewNote, setViewNote] = useState('');
  const [receivingRole, setReceivingRole] = useState<'main_chat' | 'coder' | 'hermes'>('main_chat');
  const [cameraCommand, setCameraCommand] = useState<{ action: 'zoom_in' | 'zoom_out' | 'fit_view'; token: number }>({ action: 'fit_view', token: 0 });
  const [autoRotate, setAutoRotate] = useState(false);
  const [panMode, setPanMode] = useState(false);

  useEffect(() => {
    setSelectedNode(null);
    setInspectorTab('view');
    setNodeTypeFilter('all');
    setTrustFilter('all');
  }, [authorityFocus]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    const load = async (): Promise<CodeGraphData> => {
      if (codeGraphProject) return fetchLayout(codeGraphProject, 3000);
      const response = await fetch(`/api/codegraph/graph-view?projectId=${encodeURIComponent(projectId)}`, {
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.blocker || payload?.reason || `HTTP ${response.status}`));
      }
      const sourceNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
      const idByCanonical = new Map<string, number>();
      const nodes = sourceNodes.map((node: any, index: number) => {
        const id = index + 1;
        idByCanonical.set(String(node.id), id);
        return {
          id,
          name: String(node.label || node.id),
          label: String(node.type || 'Symbol'),
          source_id: String(node.id),
          size: 6,
          color: LAYER.codegraph.color,
          ...codeSlicePosition(index),
          properties: { canonical_id: String(node.id), source: payload.source },
        } satisfies CodeGraphNode;
      });
      const edges = (Array.isArray(payload.edges) ? payload.edges : []).flatMap((edge: any) => {
        const source = idByCanonical.get(String(edge.source));
        const target = idByCanonical.get(String(edge.target));
        return source && target ? [{
          id: String(edge.id),
          source,
          target,
          type: String(edge.type || edge.label || 'RELATED_TO'),
        } satisfies CodeGraphEdge] : [];
      });
      return { nodes, edges, total_nodes: Number(payload.counts?.nodes || nodes.length) };
    };
    void load()
      .then((data) => {
        if (!controller.signal.aborted) setCodeData(data);
      })
      .catch((nextError) => {
        if (!controller.signal.aborted) setError(String(nextError?.message || nextError));
      });
    return () => controller.abort();
  }, [codeGraphProject, projectId]);

  const candidateRefs = useMemo(
    () => new Set([...(focusedThinkIds || []), ...pinnedContextRefs]),
    [focusedThinkIds, pinnedContextRefs],
  );
  const combined = useMemo(() => {
    let nextId = 1;
    const nodes: CodeGraphNode[] = [];
    const edges: CodeGraphEdge[] = [];
    const idByRef = new Map<string, number>();
    const idByAuthorityRef = new Map<string, number>();
    const pendingCrossRefs: Array<{ source: number; targetAuthority: Layer; ref: string }> = [];

    const addNode = (node: Omit<CodeGraphNode, 'id'>, refs: string[]) => {
      const id = nextId++;
      nodes.push({ ...node, id });
      for (const ref of refs.filter(Boolean)) {
        idByRef.set(ref, id);
        idByAuthorityRef.set(`${node.authority || 'codegraph'}:${ref}`, id);
      }
      return id;
    };

    if (enabled.codegraph) {
      const selected = connectedCodeSlice(codeData, codeBudget);
      const degree = new Map<number, number>();
      for (const edge of codeData?.edges || []) {
        degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
        degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
      }
      for (const [index, node] of selected.entries()) {
        const position = codeSlicePosition(index);
        addNode(
          {
            ...node,
            x: position.x,
            y: position.y,
            z: position.z + LAYER.codegraph.z,
            color: LAYER.codegraph.color,
            size: Math.max(node.size, 5 + Math.log2((degree.get(node.id) || 0) + 1) * 2.2),
            authority: 'codegraph',
            source_id: String(node.id),
          },
          [String(node.id), node.source_id || '', node.name, node.file_path || ''],
        );
      }
      const sourceId = (original: number) => idByRef.get(String(original));
      for (const edge of codeData?.edges || []) {
        const source = sourceId(edge.source);
        const target = sourceId(edge.target);
        if (source && target) edges.push({ ...edge, source, target, cross_authority: false });
      }
    }

    const addProjection = (projection: GraphProjectionV1 | undefined, authority: 'thinkgraph' | 'knowgraph') => {
      if (!projection || !enabled[authority]) return;
      const selected = projection.nodes.slice(0, reasoningBudget);
      const localIds = new Map<string, number>();
      selected.forEach((node, index) => {
        const position = projectionPosition(index, selected.length, LAYER[authority].z);
        const numericId = addNode(
          {
            ...position,
            label: node.type || node.labels?.[0] || 'Record',
            name: node.title || node.label,
            size: Math.max(5, Math.min(15, 5 + Math.log2((node.mentionCount || 1) + 1) * 2)),
            color: LAYER[authority].color,
            authority,
            source_id: node.id,
            properties: node.properties,
            provenance: node.provenance,
            project_id: node.projectId,
            conversation_id: node.conversationId,
            goal_id: node.goalId,
            episode_id: node.episodeId,
            job_id: node.jobId,
            run_id: node.runId,
            status: node.currentState,
            trust: node.trustState,
            quality: node.qualityState,
            retrieval_reason: node.retrievalReason,
          },
          [node.id, node.canonicalId || ''],
        );
        localIds.set(node.id, numericId);
        const properties = node.properties || {};
        const codeRefs = [node.codeGraphRef, ...referenceValues(properties.codegraph_ref), ...referenceValues(properties.codegraph_refs), ...referenceValues(properties.code_ref)].filter((ref): ref is string => Boolean(ref));
        const knowRefs = [node.knowGraphRef, ...referenceValues(properties.knowgraph_ref), ...referenceValues(properties.knowgraph_refs), ...referenceValues(properties.kg_ref)].filter((ref): ref is string => Boolean(ref));
        codeRefs.forEach((ref) => pendingCrossRefs.push({ source: numericId, targetAuthority: 'codegraph', ref }));
        if (authority !== 'knowgraph') knowRefs.forEach((ref) => pendingCrossRefs.push({ source: numericId, targetAuthority: 'knowgraph', ref }));
      });
      for (const edge of projection.edges) {
        const source = localIds.get(edge.source);
        const target = localIds.get(edge.target);
        if (source && target) edges.push({ id: edge.id, source, target, type: edge.predicate, cross_authority: false });
      }
    };

    addProjection(knowProjection, 'knowgraph');
    addProjection(thinkProjection, 'thinkgraph');
    const seenCrossEdges = new Set<string>();
    for (const pending of pendingCrossRefs) {
      const target = idByAuthorityRef.get(`${pending.targetAuthority}:${pending.ref}`) || idByRef.get(pending.ref);
      if (!target || target === pending.source) continue;
      const key = `${pending.source}:${target}:GROUNDED_IN`;
      if (seenCrossEdges.has(key)) continue;
      seenCrossEdges.add(key);
      edges.push({ id: `cross:${key}`, source: pending.source, target, type: 'GROUNDED_IN', cross_authority: true });
    }

    const totalAvailable = Number(codeData?.total_nodes || codeData?.nodes?.length || 0)
      + Number(thinkProjection?.counts?.nodes || thinkProjection?.nodes?.length || 0)
      + Number(knowProjection?.counts?.nodes || knowProjection?.nodes?.length || 0);
    return { nodes, edges, total_nodes: totalAvailable } satisfies CodeGraphData;
  }, [codeBudget, codeData, enabled, knowProjection, reasoningBudget, thinkProjection]);

  const nodeTypes = useMemo(
    () => [...new Set(combined.nodes.map((node) => node.label).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [combined.nodes],
  );
  const trustStates = useMemo(
    () => [...new Set(combined.nodes.map((node) => node.trust).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    [combined.nodes],
  );
  const visibleData = useMemo<CodeGraphData>(() => {
    let visibleIds = new Set(combined.nodes.map((node) => node.id));
    if (selectedNode) {
      const root = combined.nodes.find((node) =>
        node.authority === selectedNode.authority
        && (node.source_id || String(node.id)) === (selectedNode.source_id || String(selectedNode.id)),
      );
      visibleIds = root ? new Set([root.id]) : new Set();
      let frontier = new Set(visibleIds);
      for (let hop = 0; hop < hopDepth; hop += 1) {
        const next = new Set<number>();
        for (const edge of combined.edges) {
          if (edge.cross_authority) continue;
          if (frontier.has(edge.source) && !visibleIds.has(edge.target)) next.add(edge.target);
          if (frontier.has(edge.target) && !visibleIds.has(edge.source)) next.add(edge.source);
        }
        next.forEach((id) => visibleIds.add(id));
        frontier = next;
      }
      // Canonical cross-authority references are visible endpoints, but they do not
      // expand into another authority's neighborhood.
      for (const edge of combined.edges) {
        if (!edge.cross_authority) continue;
        if (visibleIds.has(edge.source)) visibleIds.add(edge.target);
        else if (visibleIds.has(edge.target)) visibleIds.add(edge.source);
      }
    }
    const nodes = combined.nodes.filter((node) =>
      visibleIds.has(node.id)
      && (nodeTypeFilter === 'all' || node.label === nodeTypeFilter)
      && (trustFilter === 'all' || node.trust === trustFilter),
    );
    const finalIds = new Set(nodes.map((node) => node.id));
    const edges = combined.edges.filter((edge) => finalIds.has(edge.source) && finalIds.has(edge.target));
    return { nodes, edges, total_nodes: combined.total_nodes };
  }, [combined, hopDepth, nodeTypeFilter, selectedNode, trustFilter]);

  const visibleByAuthority = useMemo(() => (Object.keys(LAYER) as Layer[]).reduce((counts, layer) => {
    counts[layer] = {
      loaded: combined.nodes.filter((node) => node.authority === layer).length,
      visible: visibleData.nodes.filter((node) => node.authority === layer).length,
      relationships: visibleData.edges.filter((edge) => {
        const source = visibleData.nodes.find((node) => node.id === edge.source);
        return source?.authority === layer;
      }).length,
    };
    return counts;
  }, {} as Record<Layer, { loaded: number; visible: number; relationships: number }>), [combined.nodes, visibleData]);

  const candidateHandbacks = useMemo<GraphView[]>(() => {
    const rootNodes = combined.nodes.filter((node) => candidateRefs.has(node.source_id || ''));
    return (Object.keys(LAYER) as Layer[]).flatMap((authority) => {
      const authorityRoots = rootNodes.filter((node) => node.authority === authority && node.source_id);
      if (!authorityRoots.length) return [];
      const authorityNodes = selectedNode?.authority === authority
        ? visibleData.nodes.filter((node) => node.authority === authority && node.source_id)
        : authorityRoots;
      if (!authorityNodes.length) return [];
      const selectedIds = new Set(authorityNodes.map((node) => node.id));
      const canonicalById = new Map(authorityNodes.map((node) => [node.id, node.source_id!]));
      const includedRelationships = combined.edges.flatMap((edge) => {
        const source = canonicalById.get(edge.source);
        const target = canonicalById.get(edge.target);
        return source && target ? [{ id: String(edge.id || `${source}:${edge.type}:${target}`), source, target, type: edge.type }] : [];
      });
      const neighborIds = new Set<number>();
      for (const edge of combined.edges) {
        if (selectedIds.has(edge.source) && !selectedIds.has(edge.target)) neighborIds.add(edge.target);
        if (selectedIds.has(edge.target) && !selectedIds.has(edge.source)) neighborIds.add(edge.source);
      }
      const now = new Date().toISOString();
      const roots = authorityRoots.map((node) => node.source_id!);
      const included = authorityNodes.map((node) => node.source_id!);
      return [{
        schemaVersion: 'graph-view.v1',
        viewId: `${authority}:candidate:${roots.join('|')}:${hopDepth}:${nodeTypeFilter}:${trustFilter}`,
        authority,
        status: 'candidate',
        projectId,
        conversationId,
        goalId: authorityNodes.find((node) => node.goal_id)?.goal_id,
        episodeId: authorityNodes.find((node) => node.episode_id)?.episode_id,
        jobId: (() => {
          const jobNode = authorityNodes.find((node) => node.job_id || node.run_id);
          return jobNode?.job_id || jobNode?.run_id;
        })(),
        producingRole: 'user',
        receivingRole,
        rootCanonicalNodeIds: roots,
        includedCanonicalNodeIds: included,
        records: authorityNodes.map((node) => {
          const summary = `${node.name}: ${leadFor(node)}`;
          const relevance = Number(node.properties?.context_score ?? node.properties?.score);
          const rank = Number(node.properties?.context_rank ?? node.properties?.rank);
          return {
            canonicalId: node.source_id!,
            summary,
            selectionReason: pinnedContextRefs.has(node.source_id!) ? 'User included this record' : 'User-selected ThinkGraph focus',
            ...(Number.isFinite(relevance) ? { relevance } : {}),
            ...(Number.isFinite(rank) ? { rank } : {}),
            provenanceRefs: [node.file_path, ...Object.values(node.provenance || {}).filter((value): value is string => typeof value === 'string')].filter((value): value is string => Boolean(value)).slice(0, 12),
            estimatedCharacters: summary.length,
            estimatedTokens: Math.max(1, Math.ceil(summary.length / 4)),
          };
        }),
        includedRelationships,
        query: selectedNode ? `Neighborhood around ${selectedNode.name}` : 'Selected graph records',
        filter: {
          nodeTypes: nodeTypeFilter === 'all' ? [] : [nodeTypeFilter],
          trustStates: trustFilter === 'all' ? [] : [trustFilter],
        },
        hopDepth: selectedNode ? hopDepth : 0,
        provenanceRefs: [...new Set(authorityNodes.flatMap((node) => [node.file_path, ...Object.values(node.provenance || {})].filter((value): value is string => typeof value === 'string' && Boolean(value))))].slice(0, 40),
        ...(viewNote.trim() ? { note: viewNote.trim() } : {}),
        omittedNeighborCount: neighborIds.size,
        createdAt: now,
        updatedAt: now,
      } satisfies GraphView];
    });
  }, [candidateRefs, combined.edges, combined.nodes, conversationId, hopDepth, nodeTypeFilter, pinnedContextRefs, projectId, receivingRole, selectedNode, trustFilter, viewNote, visibleData.nodes]);

  useEffect(() => {
    onCandidateHandbacksChange?.(candidateHandbacks);
  }, [candidateHandbacks, onCandidateHandbacksChange]);

  const sceneData = useMemo<CodeGraphData>(() => {
    const priority: Record<GraphView['status'], number> = { failed: 0, superseded: 1, consumed: 2, candidate: 3, attached: 4, returned: 5, active: 6 };
    const membership = new Map<string, GraphView>();
    for (const view of [...candidateHandbacks, ...runtimeHandbacks]) {
      for (const canonicalId of view.includedCanonicalNodeIds) {
        const current = membership.get(canonicalId);
        if (!current || priority[view.status] >= priority[current.status]) membership.set(canonicalId, view);
      }
    }
    return {
      ...visibleData,
      nodes: visibleData.nodes.map((node) => {
        const view = membership.get(node.source_id || '');
        if (!view) return node;
        const sizeBoost = view.status === 'active' ? 6 : view.status === 'returned' ? 4 : 2;
        return {
          ...node,
          size: node.size + sizeBoost,
          color: view.status === 'active' ? '#7FF6EE' : view.status === 'returned' ? '#E7F7FF' : node.color,
          graph_view_id: view.viewId,
          graph_view_status: view.status,
        };
      }),
    };
  }, [candidateHandbacks, runtimeHandbacks, visibleData]);

  useEffect(() => {
    if (inspectorTab === 'node' && !selectedNode) setInspectorTab('view');
  }, [inspectorTab, selectedNode]);

  const selectedRelationships = useMemo(
    () => selectedNode
      ? visibleData.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
      : [],
    [selectedNode, visibleData.edges],
  );

  const selectedContext = useMemo(() => {
    if (!selectedNode) return null;
    const ref = selectedNode.source_id || '';
    let reason = selectedNode.retrieval_reason || 'Visible graph record; not selected as candidate context';
    if (pinnedContextRefs.has(ref)) reason = 'User included this record as candidate context';
    else if ((focusedThinkIds || []).includes(ref)) reason = 'User-selected ThinkGraph focus';
    const score = readableValue(selectedNode.properties?.context_score ?? selectedNode.properties?.score);
    const rank = readableValue(selectedNode.properties?.context_rank ?? selectedNode.properties?.rank);
    const characters = selectedNode.name.length + leadFor(selectedNode).length;
    return {
      candidate: candidateRefs.has(ref),
      reason,
      score,
      rank,
      characters,
      estimatedTokens: Math.max(1, Math.ceil(characters / 4)),
    };
  }, [candidateRefs, focusedThinkIds, pinnedContextRefs, selectedNode]);

  const selectNode = (node: CodeGraphNode) => {
    setSelectedNode(node);
    setInspectorOpen(true);
    setInspectorTab('node');
  };

  return (
    <div data-testid="unified-graph-surface" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <CodeGraphScene
        data={sceneData}
        showLabels
        maxLabels={26}
        panMode={panMode}
        highlightedIds={null}
        cameraAction={cameraCommand.action}
        cameraActionToken={cameraCommand.token}
        cameraPosition={[320, 180, 520]}
        autoRotate={autoRotate}
        focusNode={selectedNode}
        onNodeClick={selectNode}
        onBackgroundClick={() => {
          setSelectedNode(null);
          setInspectorTab('view');
        }}
      />

      <div style={{ position: 'absolute', left: 12, bottom: 46, zIndex: 5, display: 'flex', gap: 5 }}>
        {([
          ['zoom_in', '+', 'Zoom in'],
          ['zoom_out', '−', 'Zoom out'],
          ['fit_view', '⊙', 'Fit view'],
        ] as const).map(([action, glyph, label]) => (
          <button
            key={action}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => setCameraCommand({ action, token: Date.now() })}
            style={graphDrawerButtonStyle({ width: 32, height: 32, minHeight: 32, padding: 0, borderRadius: 10, fontSize: 17 })}
          >
            {glyph}
          </button>
        ))}
        <button
          type="button"
          aria-label={panMode ? 'Rotate by dragging' : 'Pan by dragging'}
          title={panMode ? 'Rotate by dragging' : 'Pan by dragging'}
          aria-pressed={panMode}
          onClick={() => setPanMode((current) => !current)}
          style={graphDrawerButtonStyle({ width: 32, height: 32, minHeight: 32, padding: 0, borderRadius: 10, fontSize: 15, color: panMode ? GRAPH_THEME.accent.primary : GRAPH_THEME.surface.text })}
        >
          ✥
        </button>
        <button
          type="button"
          aria-label={autoRotate ? 'Pause rotation' : 'Rotate view'}
          title={autoRotate ? 'Pause rotation' : 'Rotate view'}
          aria-pressed={autoRotate}
          onClick={() => setAutoRotate((current) => !current)}
          style={graphDrawerButtonStyle({ width: 32, height: 32, minHeight: 32, padding: 0, borderRadius: 10, fontSize: 15, color: autoRotate ? GRAPH_THEME.accent.primary : GRAPH_THEME.surface.text })}
        >
          ↻
        </button>
      </div>

      <div style={graphGlassPillStyle({ position: 'absolute', left: 12, bottom: 12, zIndex: 4, padding: '6px 9px' })}>
        {visibleData.nodes.length.toLocaleString()} visible · {combined.nodes.length.toLocaleString()} loaded · {visibleData.edges.length.toLocaleString()} relationships
      </div>
      {error ? <div style={graphGlassPillStyle({ position: 'absolute', left: 12, bottom: 44, zIndex: 4, color: '#ffb4b4' })}>CodeGraph unavailable: {error}</div> : null}

      <RightGlassDrawer
        isOpen={inspectorOpen}
        title=""
        onClose={() => setInspectorOpen(false)}
        onOpen={() => setInspectorOpen(true)}
        collapsedLabel={null}
        openAriaLabel="Open details"
        movable
        defaultWidth={344}
        minWidth={300}
        maxWidth={520}
        storageKey="liquidaity.drawer.unified-graph.v2.width"
        dataTestId="unified-graph-inspector"
        top={48}
        right={12}
        bottom={12}
        zIndex={7}
      >
        <div role="tablist" aria-label="Details" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: 3, marginBottom: 10, border: '1px solid rgba(255,255,255,.1)', borderRadius: 11, background: 'rgba(0,0,0,.12)' }}>
          {(['view', 'invocation', 'node'] as InspectorTab[]).map((tab) => {
            const active = inspectorTab === tab;
            const disabled = tab === 'node' && !selectedNode;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => setInspectorTab(tab)}
                style={graphDrawerButtonStyle({
                  minHeight: 30,
                  padding: '5px 8px',
                  border: active ? '1px solid rgba(126,232,226,.3)' : '1px solid transparent',
                  background: active ? 'linear-gradient(135deg, rgba(55,173,170,.18), rgba(255,255,255,.035))' : 'transparent',
                  color: active ? GRAPH_THEME.surface.text : GRAPH_THEME.surface.mutedText,
                  opacity: disabled ? .42 : 1,
                })}
              >
                {tab === 'view' ? 'View' : tab === 'invocation' ? 'Invocation' : 'Node'}
              </button>
            );
          })}
        </div>
        {inspectorTab === 'view' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <GlassInspectorSection title="Selection" signal={selectedNode ? `${hopDepth} hop${hopDepth === 1 ? '' : 's'}` : 'Full'}>
              <InspectorRow label="Root" value={selectedNode?.name || 'All loaded records'} />
              <label style={{ display: 'grid', gap: 6, color: GRAPH_THEME.surface.mutedText, fontSize: 11.5 }}>
                Depth · {hopDepth} hop{hopDepth === 1 ? '' : 's'}
                <input
                  aria-label="Selection depth"
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={hopDepth}
                  disabled={!selectedNode}
                  onChange={(event) => setHopDepth(Number(event.target.value))}
                />
              </label>
              <label style={{ display: 'grid', gap: 6, color: GRAPH_THEME.surface.mutedText, fontSize: 11.5 }}>
                Node type
                <select aria-label="Node type" value={nodeTypeFilter} onChange={(event) => setNodeTypeFilter(event.target.value)} style={graphDrawerInputStyle()}>
                  <option value="all">All loaded types</option>
                  {nodeTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 6, color: GRAPH_THEME.surface.mutedText, fontSize: 11.5 }}>
                Trust
                <select aria-label="Trust" value={trustFilter} disabled={!trustStates.length} onChange={(event) => setTrustFilter(event.target.value)} style={graphDrawerInputStyle()}>
                  <option value="all">{trustStates.length ? 'All supplied states' : 'Not supplied'}</option>
                  {trustStates.map((trust) => <option key={trust} value={trust}>{trust}</option>)}
                </select>
              </label>
              {selectedNode ? (
                <button type="button" onClick={() => setSelectedNode(null)} style={graphDrawerButtonStyle({ width: '100%' })}>
                  Show full authority view
                </button>
              ) : null}
            </GlassInspectorSection>
            <GlassInspectorSection title="Layers" signal={`${visibleData.nodes.length} visible`}>
              {(Object.keys(LAYER) as Layer[]).filter((layer) => enabled[layer]).map((layer) => (
                <div key={layer} style={{ display: 'grid', gridTemplateColumns: '10px minmax(0,1fr) auto', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: LAYER[layer].color, boxShadow: `0 0 8px ${LAYER[layer].color}` }} />
                  <span style={{ color: GRAPH_THEME.surface.text }}>{LAYER[layer].label}</span>
                  <span style={{ color: GRAPH_THEME.surface.mutedText }}>{visibleByAuthority[layer].visible} visible · {visibleByAuthority[layer].loaded} loaded</span>
                </div>
              ))}
              <InspectorRow label="Relationships" value={visibleData.edges.length.toLocaleString()} />
              <InspectorRow label="Cross-layer" value={visibleData.edges.filter((edge) => edge.cross_authority).length.toLocaleString()} />
            </GlassInspectorSection>
            <GlassInspectorSection title="Pass to" signal={receivingRole === 'main_chat' ? 'Main' : receivingRole === 'coder' ? 'Coder' : 'Hermes'}>
              <select aria-label="Receiving role" value={receivingRole} onChange={(event) => setReceivingRole(event.target.value as 'main_chat' | 'coder' | 'hermes')} style={graphDrawerInputStyle({ marginBottom: 8 })}>
                <option value="main_chat">Main</option>
                <option value="coder">Coder</option>
                <option value="hermes">Hermes</option>
              </select>
              <textarea aria-label="Graph view note" value={viewNote} onChange={(event) => setViewNote(event.target.value)} placeholder="Short instruction for this view…" rows={3} style={graphDrawerInputStyle({ resize: 'vertical' })} />
            </GlassInspectorSection>
            {candidateHandbacks.map((view) => (
              <GlassInspectorSection key={view.viewId} title="Graph View" signal={view.status}>
                <InspectorRow label="View" value={view.viewId} mono />
                <InspectorRow label="Authority" value={LAYER[view.authority].label} />
                <InspectorRow label="Route" value={`${view.producingRole} → ${view.receivingRole}`} />
                <InspectorRow label="Roots" value={view.rootCanonicalNodeIds.join(' · ')} mono />
                <InspectorRow label="Included" value={`${view.includedCanonicalNodeIds.length} nodes · ${view.includedRelationships.length} relationships`} />
                <InspectorRow label="Note" value={view.note} />
              </GlassInspectorSection>
            ))}
          </div>
        ) : inspectorTab === 'invocation' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {runtimeHandbacks.length ? runtimeHandbacks.map((view) => (
              <GlassInspectorSection key={view.viewId} title={LAYER[view.authority].label} signal={view.status}>
                <InspectorRow label="View" value={view.viewId} mono />
                <InspectorRow label="Invocation" value={view.invocationId || view.runtime?.invocationId} mono />
                <InspectorRow label="Route" value={`${view.producingRole} → ${view.receivingRole}`} />
                <InspectorRow label="Runtime" value={view.runtime ? `${view.runtime.provider} · ${view.runtime.model}` : undefined} />
                <InspectorRow label="Included" value={`${view.includedCanonicalNodeIds.length} nodes · ${view.includedRelationships.length} relationships`} />
                <InspectorRow label="Context" value={view.runtime ? `${view.runtime.contextCharacters} characters · ~${view.runtime.estimatedTokens} tokens` : undefined} />
                <InspectorRow label="Parent" value={view.parentViewId} mono />
              </GlassInspectorSection>
            )) : (
              <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 12, lineHeight: 1.55, padding: '6px 3px' }}>
                No Graph View is attached to a running or completed invocation yet.
              </div>
            )}
          </div>
        ) : selectedNode ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ padding: '4px 3px 6px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 7 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: LAYER[selectedNode.authority || 'codegraph'].color, boxShadow: `0 0 12px ${LAYER[selectedNode.authority || 'codegraph'].color}` }} />
                <span style={{ color: GRAPH_THEME.accent.primary, fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase' }}>{selectedNode.label}</span>
              </div>
              <div style={{ color: GRAPH_THEME.surface.text, fontFamily: 'Georgia, Cambria, serif', fontSize: 21, lineHeight: 1.15, marginBottom: 9 }}>{selectedNode.name}</div>
              <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 12, lineHeight: 1.55 }}>{leadFor(selectedNode)}</div>
            </div>
            <GlassInspectorSection title="Identity" signal={LAYER[selectedNode.authority || 'codegraph'].label}>
              <InspectorRow label="Record ID" value={selectedNode.source_id || String(selectedNode.id)} />
              <InspectorRow label="Type" value={selectedNode.label} />
              <InspectorRow label="Project" value={projectId || codeGraphProject} />
              <InspectorRow label="File" value={selectedNode.file_path} mono />
              <InspectorRow label="Graph View" value={selectedNode.graph_view_id} mono />
              <InspectorRow label="View status" value={selectedNode.graph_view_status} />
            </GlassInspectorSection>
            <GlassInspectorSection
              title={selectedNode.authority === 'thinkgraph' ? 'ThinkGraph record' : selectedNode.authority === 'knowgraph' ? 'KnowGraph evidence' : 'CodeGraph symbol'}
              signal={selectedNode.status || selectedNode.label}
            >
              <InspectorRow label="Goal" value={selectedNode.goal_id} mono />
              <InspectorRow label="Episode" value={selectedNode.episode_id} mono />
              <InspectorRow label="Job / run" value={selectedNode.job_id || selectedNode.run_id} mono />
              <InspectorRow label="Status" value={selectedNode.status} />
              <InspectorRow label="Trust" value={selectedNode.trust} />
              <InspectorRow label="Quality" value={selectedNode.quality} />
              <InspectorRow label="Authority" value={LAYER[selectedNode.authority || 'codegraph'].label} />
              {selectedNode.authority === 'thinkgraph' ? (
                <>
                  <InspectorRow label="Questions" value={propertyValue(selectedNode, 'questions', 'open_questions')} />
                  <InspectorRow label="Alternatives" value={propertyValue(selectedNode, 'alternatives')} />
                  <InspectorRow label="Decision" value={propertyValue(selectedNode, 'decision')} />
                  <InspectorRow label="Supersedes" value={propertyValue(selectedNode, 'supersedes', 'supersedes_id')} mono />
                  <InspectorRow label="Timeline" value={propertyValue(selectedNode, 'valid_from', 'timestamp', 'created_at')} />
                  <InspectorRow label="Required proof" value={propertyValue(selectedNode, 'required_proof', 'proof')} />
                  <InspectorRow label="Jobs / reviews" value={propertyValue(selectedNode, 'jobs', 'reviews', 'review_id')} />
                </>
              ) : selectedNode.authority === 'knowgraph' ? (
                <>
                  <InspectorRow label="Assertion" value={propertyValue(selectedNode, 'text', 'assertion_text', 'claim')} />
                  <InspectorRow label="Assertion class" value={propertyValue(selectedNode, 'owlClass', 'assertion_class') || selectedNode.label} />
                  <InspectorRow label="Chunks" value={propertyValue(selectedNode, 'chunk_refs', 'chunks')} mono />
                  <InspectorRow label="Chapter / section" value={[propertyValue(selectedNode, 'chapter'), propertyValue(selectedNode, 'section')].filter(Boolean).join(' · ') || undefined} />
                  <InspectorRow label="Source" value={propertyValue(selectedNode, 'source_title', 'source_document', 'document_id')} />
                  <InspectorRow label="Concepts / entities" value={propertyValue(selectedNode, 'concepts', 'entities', 'related_entities')} />
                  <InspectorRow label="Extraction run" value={propertyValue(selectedNode, 'extraction_run', 'run_id')} mono />
                </>
              ) : (
                <>
                  <InspectorRow label="Symbol" value={selectedNode.name} />
                  <InspectorRow label="Kind" value={propertyValue(selectedNode, 'kind') || selectedNode.label} />
                  <InspectorRow label="Line range" value={propertyValue(selectedNode, 'line_range', 'start_line', 'line')} />
                  <InspectorRow label="Callers" value={propertyValue(selectedNode, 'callers')} />
                  <InspectorRow label="Callees" value={propertyValue(selectedNode, 'callees')} />
                  <InspectorRow label="Dependencies" value={propertyValue(selectedNode, 'dependencies')} />
                  <InspectorRow label="Freshness" value={propertyValue(selectedNode, 'freshness', 'indexed_at')} />
                  <InspectorRow label="Repository" value={codeGraphProject} mono />
                </>
              )}
            </GlassInspectorSection>
            <GlassInspectorSection title="Context" signal={selectedContext?.candidate ? 'Candidate' : 'Not selected'}>
              <button
                type="button"
                onClick={() => {
                  const ref = selectedNode.source_id || '';
                  if (!ref) return;
                  setPinnedContextRefs((current) => {
                    const next = new Set(current);
                    if (next.has(ref)) next.delete(ref);
                    else next.add(ref);
                    return next;
                  });
                }}
                style={graphDrawerButtonStyle({ width: '100%', marginBottom: 8 })}
              >
                {pinnedContextRefs.has(selectedNode.source_id || '') ? 'Remove from candidate context' : 'Add to candidate context'}
              </button>
              <InspectorRow label="Selection" value={selectedContext?.reason} />
              <InspectorRow label="Candidate" value={selectedContext?.candidate ? 'Selected; not sent until the next Main invocation' : 'Not selected'} />
              <InspectorRow label="Score" value={selectedContext?.score || 'Not supplied by this context run'} />
              <InspectorRow label="Rank" value={selectedContext?.rank || 'Not supplied by this context run'} />
              <InspectorRow label="Contribution" value={selectedContext ? `${selectedContext.characters} characters · ~${selectedContext.estimatedTokens} tokens` : undefined} />
              <InspectorRow label="Render limits" value={`${reasoningBudget} Think/Know · ${codeBudget.toLocaleString()} CodeGraph records`} />
              <InspectorRow label="Excluded" value={`${Math.max(0, combined.total_nodes - combined.nodes.length).toLocaleString()} nearby records`} />
            </GlassInspectorSection>
            <GlassInspectorSection title="Relationships" signal={String(selectedRelationships.length)}>
              {selectedRelationships.length ? selectedRelationships.map((edge, index) => (
                <div key={`${edge.source}:${edge.target}:${edge.type}:${index}`} style={{ color: GRAPH_THEME.surface.text, fontSize: 11.5, lineHeight: 1.45 }}>
                  {edge.source === selectedNode.id ? 'Outgoing' : 'Incoming'} · {edge.cross_authority ? 'Cross-graph' : 'Native'} · {edge.type}
                </div>
              )) : <span style={{ color: GRAPH_THEME.surface.mutedText }}>No visible relationships.</span>}
            </GlassInspectorSection>
            <GlassInspectorSection title="Properties" defaultOpen={false} signal={String(Object.keys(selectedNode.properties || {}).length)}>
              {Object.entries(selectedNode.properties || {}).map(([key, value]) => {
                const readable = readableValue(value);
                return readable ? <InspectorRow key={key} label={key} value={readable} /> : null;
              })}
            </GlassInspectorSection>
            <GlassInspectorSection title="Provenance" defaultOpen={false}>
              <InspectorRow label="Authority" value={LAYER[selectedNode.authority || 'codegraph'].label} />
              <InspectorRow label="Candidate" value={candidateRefs.has(selectedNode.source_id || '') ? 'Selected in the graph UI' : 'Not selected'} />
              {Object.entries(selectedNode.provenance || {}).map(([key, value]) => {
                const readable = readableValue(value);
                return readable ? <InspectorRow key={key} label={key} value={readable} /> : null;
              })}
            </GlassInspectorSection>
          </div>
        ) : (
          <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 12, lineHeight: 1.55, padding: '4px 3px' }}>
            Select a graph record to inspect its relationships, authority, and provenance.
          </div>
        )}
      </RightGlassDrawer>
    </div>
  );
}

function InspectorRow({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 9, fontSize: 11.5 }}>
      <span style={{ color: GRAPH_THEME.surface.mutedText }}>{label}</span>
      <span style={{ color: GRAPH_THEME.surface.text, overflowWrap: 'anywhere', fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : undefined }}>{value}</span>
    </div>
  );
}
