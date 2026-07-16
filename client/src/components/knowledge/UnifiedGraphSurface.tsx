import { useEffect, useMemo, useRef, useState } from 'react';

import { CodeGraphScene } from '../codegraph/CodeGraphScene';
import type { CodeGraphData, CodeGraphNode } from '../codegraph/types';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GRAPH_THEME, graphDrawerButtonStyle, graphGlassPillStyle } from '../graph/graphVisualTokens';

type Layer = 'thinkgraph' | 'knowgraph' | 'codegraph';

export type UnifiedProjectionIdentity = {
  projectionId: string;
  role: 'main_chat' | 'coder' | 'hermes';
  activeGraphViewId: string | null;
  knowgraphScope: string | null;
};

type UnifiedPayload = {
  schemaVersion: 'unified.context.v1';
  projectionId: string;
  nodes: CodeGraphNode[];
  edges: CodeGraphData['edges'];
  counts: {
    selected: Record<Layer, number>;
    nodes: number;
    edges: number;
    crossAuthorityEdges: number;
  };
  warnings: Array<{ authority: string; code: string; detail: string }>;
};

const LAYERS: Array<{ id: Layer; label: string }> = [
  { id: 'codegraph', label: 'CodeGraph' },
  { id: 'thinkgraph', label: 'ThinkGraph' },
  { id: 'knowgraph', label: 'KnowGraph' },
];

function displayLabel(node: CodeGraphNode): string {
  const props = node.properties || {};
  const value = props.display_label || props.title || props.short_label || node.name || node.label || node.source_id;
  return String(value || 'Record').trim();
}

export default function UnifiedGraphSurface({
  projectId,
  conversationId,
  onProjectionChange,
  onOpenAuthority,
}: {
  projectId: string;
  conversationId: string;
  runtimeHandbacks?: unknown[];
  onProjectionChange?: (projection: UnifiedProjectionIdentity | null) => void;
  onOpenAuthority?: (authority: Layer) => void;
}) {
  const [payload, setPayload] = useState<UnifiedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [enabledLayers, setEnabledLayers] = useState<Set<Layer>>(new Set(LAYERS.map((layer) => layer.id)));
  const [showRelationships, setShowRelationships] = useState(true);
  const [showCrossAuthority, setShowCrossAuthority] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [selected, setSelected] = useState<CodeGraphNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const requestGeneration = useRef(0);
  const [cameraCommand, setCameraCommand] = useState<{ action: 'zoom_in' | 'zoom_out' | 'fit_view'; token: number }>({ action: 'fit_view', token: 0 });

  useEffect(() => {
    if (!projectId) {
      setPayload(null);
      setError('Unified requires a project.');
      onProjectionChange?.(null);
      return;
    }
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    const params = new URLSearchParams({ projectId, conversationId, role: 'main_chat' });
    setLoading(true);
    setError(null);
    void fetch(`/api/unified/context?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.schemaVersion !== 'unified.context.v1') throw new Error(String(body?.detail || body?.error || `HTTP ${response.status}`));
        return body as UnifiedPayload;
      })
      .then((next) => {
        if (controller.signal.aborted || generation !== requestGeneration.current) return;
        setPayload(next);
        setLoading(false);
        onProjectionChange?.({ projectionId: next.projectionId, role: 'main_chat', activeGraphViewId: null, knowgraphScope: null });
      })
      .catch((reason) => {
        if (controller.signal.aborted || generation !== requestGeneration.current) return;
        setLoading(false);
        setError(String(reason?.message || reason));
      });
    return () => controller.abort();
  }, [conversationId, onProjectionChange, projectId, refresh]);

  const sceneData = useMemo<CodeGraphData>(() => {
    if (!payload) return { nodes: [], edges: [], total_nodes: 0 };
    const nodes = payload.nodes.filter((node) => enabledLayers.has((node.authority || 'codegraph') as Layer));
    const ids = new Set(nodes.map((node) => node.id));
    const edges = showRelationships
      ? payload.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && (showCrossAuthority || !edge.cross_authority))
      : [];
    return { nodes, edges, total_nodes: payload.nodes.length };
  }, [enabledLayers, payload, showCrossAuthority, showRelationships]);

  const highlightedIds = useMemo(() => {
    if (!selected || !payload) return null;
    const ids = new Set([selected.id]);
    payload.edges.forEach((edge) => {
      if (edge.source === selected.id) ids.add(edge.target);
      if (edge.target === selected.id) ids.add(edge.source);
    });
    return ids;
  }, [payload, selected]);

  const toggleLayer = (layer: Layer) => setEnabledLayers((current) => {
    const next = new Set(current);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    return next;
  });

  return (
    <div data-testid="unified-graph-surface" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', background: GRAPH_THEME.background.knowledgeSurface }}>
      <GraphPaperBackground />
      {payload ? <div style={graphGlassPillStyle({ position: 'absolute', left: 12, top: 52, zIndex: 5, pointerEvents: 'none' })}>
        Full authority data · Code {payload.counts.selected.codegraph.toLocaleString()} · Think {payload.counts.selected.thinkgraph.toLocaleString()} · Know {payload.counts.selected.knowgraph.toLocaleString()}
      </div> : null}
      {payload ? <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <CodeGraphScene
          data={sceneData}
          highlightedIds={highlightedIds}
          showLabels={showLabels}
          maxLabels={showLabels ? 60 : 0}
          autoRotate={false}
          cameraAction={cameraCommand.action}
          cameraActionToken={cameraCommand.token}
          onNodeClick={(node) => { setSelected(node); setDrawerOpen(true); }}
          showAmbientDust={false}
          curveCrossAuthority
          preserveDimmedEdges
        />
      </div> : null}
      {loading && !payload ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#91A9B8' }}>Loading full graph authorities…</div> : null}
      {error && !payload ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#FFB0A6', textAlign: 'center' }}><div>{error}<br /><button type="button" onClick={() => setRefresh((value) => value + 1)} style={graphDrawerButtonStyle({ marginTop: 10 })}>Retry</button></div></div> : null}
      {payload && payload.nodes.length === 0 ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#91A9B8' }}>No graph data is available for Unified.</div> : null}
      <GraphNavigationControls onZoomIn={() => setCameraCommand({ action: 'zoom_in', token: Date.now() })} onZoomOut={() => setCameraCommand({ action: 'zoom_out', token: Date.now() })} onFit={() => setCameraCommand({ action: 'fit_view', token: Date.now() })} />
      <button type="button" onClick={() => setDrawerOpen(true)} style={graphDrawerButtonStyle({ position: 'absolute', right: 62, top: 54, zIndex: 5 })}>Layers</button>
      <RightGlassDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} onOpen={() => setDrawerOpen(true)} collapsedLabel={null} openAriaLabel="Open Unified Inspector" title="Unified Inspector" defaultWidth={360} minWidth={320} maxWidth={520} storageKey="liquidaity.drawer.unified.width" top={48} right={12} bottom={12} zIndex={7}>
        {selected ? <section style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 8px', color: GRAPH_THEME.surface.text }}>{displayLabel(selected)}</h3>
          <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 11 }}>{selected.authority} · {selected.label}</div>
          <div style={{ color: GRAPH_THEME.surface.mutedText, fontFamily: 'monospace', fontSize: 10, marginTop: 6, overflowWrap: 'anywhere' }}>{selected.source_id}</div>
          {onOpenAuthority && selected.authority ? <button type="button" onClick={() => onOpenAuthority(selected.authority as Layer)} style={graphDrawerButtonStyle({ width: '100%', marginTop: 10 })}>Open {selected.authority}</button> : null}
        </section> : null}
        <section>
          <h3 style={{ color: GRAPH_THEME.surface.text }}>Visible layers</h3>
          {LAYERS.map((layer) => <label key={layer.id} style={{ display: 'flex', gap: 8, margin: '10px 0', color: GRAPH_THEME.surface.text, fontSize: 12 }}><input type="checkbox" checked={enabledLayers.has(layer.id)} onChange={() => toggleLayer(layer.id)} />{layer.label} · {payload?.counts.selected[layer.id] || 0}</label>)}
          <label style={{ display: 'flex', gap: 8, margin: '10px 0', color: GRAPH_THEME.surface.text, fontSize: 12 }}><input type="checkbox" checked={showRelationships} onChange={(event) => setShowRelationships(event.target.checked)} />Relationships</label>
          <label style={{ display: 'flex', gap: 8, margin: '10px 0', color: GRAPH_THEME.surface.text, fontSize: 12 }}><input type="checkbox" checked={showCrossAuthority} onChange={(event) => setShowCrossAuthority(event.target.checked)} />Cross-authority references</label>
          <label style={{ display: 'flex', gap: 8, margin: '10px 0', color: GRAPH_THEME.surface.text, fontSize: 12 }}><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />Labels</label>
          <div style={{ marginTop: 14, color: GRAPH_THEME.surface.mutedText, fontSize: 10, lineHeight: 1.45 }}>Visibility controls affect this scene only. Source graphs and Main projection membership are unchanged.</div>
        </section>
      </RightGlassDrawer>
    </div>
  );
}
