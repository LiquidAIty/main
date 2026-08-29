import { useEffect, useMemo, useRef, useState } from 'react';
import { MultiDirectedGraph } from 'graphology';
import Sigma from 'sigma';

import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls } from '../graph/GraphCanvasChrome';
import type { GraphProjectionNode, GraphProjectionV1 } from './NativeAuthorityGraphSurface';
import './nativeAuthorityGraphSurface.css';

const LEVEL_COLORS: Record<string, string> = {
  L2: '#ffd166',
  L1: '#7dd3fc',
  L0: '#a78bfa',
};

function stableAngle(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function nodePosition(node: GraphProjectionNode, index: number, total: number) {
  const distance = Number(node.properties?.distance);
  const normalizedDistance = Number.isFinite(distance) ? Math.max(0, distance) : null;
  const angle = stableAngle(node.id) + index * Math.PI * (3 - Math.sqrt(5));
  const radius = normalizedDistance == null
    ? 1.2 + Math.sqrt((index + 1) / Math.max(1, total)) * 8
    : 1.2 + Math.min(10, normalizedDistance * 7);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export default function ConstellationSigmaSurface({
  projection,
  status,
  error,
  onExpand,
  onUseAsContext,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  authority?: 'thinkgraph';
  onExpand?: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Sigma | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(
    () => projection?.nodes.find((node) => node.id === selectedId) || null,
    [projection, selectedId],
  );

  const graph = useMemo(() => {
    const next = new MultiDirectedGraph();
    const nodes = projection?.nodes || [];
    const degree = new Map<string, number>();
    for (const edge of projection?.edges || []) {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    }
    nodes.forEach((node, index) => {
      const position = nodePosition(node, index, nodes.length);
      const level = String(node.properties?.level || '');
      const nodeDegree = degree.get(node.id) || 0;
      next.addNode(node.id, {
        ...position,
        label: String(node.label || node.title || node.id),
        color: String(node.properties?.attentionActorColor || LEVEL_COLORS[level] || '#5eead4'),
        size: Math.max(3, Math.min(14, 4 + Math.sqrt(nodeDegree + 1) * 1.8)),
        zIndex: level === 'L2' ? 3 : level === 'L1' ? 2 : 1,
      });
    });
    for (const edge of projection?.edges || []) {
      if (!next.hasNode(edge.source) || !next.hasNode(edge.target)) continue;
      next.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
        label: edge.predicate,
        color: 'rgba(111, 190, 210, 0.34)',
        size: Math.max(0.4, Math.min(3, Number(edge.properties?.strength) || 0.8)),
      });
    }
    return next;
  }, [projection]);

  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      defaultNodeColor: '#5eead4',
      defaultEdgeColor: '#315b6a',
      labelColor: { color: '#e6f6ff' },
      labelFont: 'Public Sans, Segoe UI, sans-serif',
      labelRenderedSizeThreshold: 7,
      labelDensity: 0.7,
      labelGridCellSize: 120,
      renderEdgeLabels: false,
      zIndex: true,
    });
    renderer.on('clickNode', ({ node }) => {
      setSelectedId(node);
      setInspectorOpen(true);
    });
    renderer.on('enterNode', ({ node }) => setHoveredId(node));
    renderer.on('leaveNode', () => setHoveredId(null));
    renderer.on('clickStage', () => setSelectedId(null));
    rendererRef.current = renderer;
    return () => {
      renderer.kill();
      rendererRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const focus = hoveredId || selectedId;
    const neighbors = focus && graph.hasNode(focus) ? new Set(graph.neighbors(focus)) : null;
    renderer.setSetting('nodeReducer', (node, attributes) => {
      if (!focus || node === focus || neighbors?.has(node)) return attributes;
      return { ...attributes, color: '#18232f', label: '' };
    });
    renderer.setSetting('edgeReducer', (edge, attributes) => {
      if (!focus || graph.extremities(edge).includes(focus)) return attributes;
      return { ...attributes, hidden: true };
    });
    renderer.refresh();
  }, [graph, hoveredId, selectedId]);

  const focusSearch = () => {
    const query = search.trim().toLowerCase();
    if (!query || !rendererRef.current) return;
    const match = graph.nodes().find((id) => String(graph.getNodeAttribute(id, 'label')).toLowerCase().includes(query));
    if (!match) return;
    setSelectedId(match);
    setInspectorOpen(true);
    const display = rendererRef.current.getNodeDisplayData(match);
    if (display) {
      void rendererRef.current.getCamera().animate(
        { x: display.x, y: display.y, ratio: 0.18 },
        { duration: 500 },
      );
    }
  };

  const runtime = projection && 'runtime' in projection
    ? (projection as GraphProjectionV1 & { runtime?: Record<string, unknown> }).runtime
    : undefined;

  return (
    <div data-testid="native-thinkgraph-surface" className="constellation-sigma-surface">
      <div className="constellation-sigma-canvas">
        <div className="constellation-sigma-stars" aria-hidden="true" />
        <div ref={containerRef} className="constellation-sigma-network" />
        <div className="constellation-sigma-badge">
          <strong>Constellation</strong>
          <span>{projection?.nodes.length || 0} memories · {projection?.edges.length || 0} relations</span>
        </div>
        <GraphNavigationControls
          onZoomIn={() => { void rendererRef.current?.getCamera().animatedZoom({ duration: 220 }); }}
          onZoomOut={() => { void rendererRef.current?.getCamera().animatedUnzoom({ duration: 220 }); }}
          onFit={() => { void rendererRef.current?.getCamera().animatedReset({ duration: 320 }); }}
        />
        {status === 'loading' && !projection ? <div className="native-authority-empty">Loading Constellation…</div> : null}
        {status === 'error' ? <div className="native-authority-empty">Constellation failed: {error}</div> : null}
        {status === 'ready' && graph.order === 0 ? <div className="native-authority-empty">No Constellation memories in this attention scope yet.</div> : null}
      </div>
      <RightGlassDrawer
        isOpen={inspectorOpen}
        title="Constellation Inspector"
        onClose={() => setInspectorOpen(false)}
        onOpen={() => setInspectorOpen(true)}
        collapsedLabel={null}
        openAriaLabel="Open Constellation Inspector"
        defaultWidth={340}
        minWidth={320}
        maxWidth={520}
        storageKey="liquidaity.drawer.thinkgraph.width"
        top={48}
        right={12}
        bottom={12}
        zIndex={6}
      >
        <div className="native-authority-controls">
          <section>
            <h3>Find memory</h3>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && focusSearch()}
              placeholder="Search visible memories…"
            />
          </section>
          {selected ? (
            <section data-testid="thinkgraph-node-inspector">
              <h3>Native memory</h3>
              <h4>{selected.label || selected.title || selected.id}</h4>
              <p>{selected.id}</p>
              <div className="native-authority-actions">
                {onExpand ? <button disabled={expanding} onClick={() => {
                  setExpanding(true);
                  void onExpand(selected).finally(() => setExpanding(false));
                }}>{expanding ? 'Expanding…' : 'Expand native neighborhood'}</button> : null}
                {onUseAsContext ? <button onClick={() => onUseAsContext(selected)}>Attach native reference</button> : null}
              </div>
            </section>
          ) : null}
          <section>
            <h3>Native state</h3>
            <pre>{JSON.stringify({
              authority: projection?.authority,
              schemaVersion: projection?.schemaVersion,
              revision: projection?.revision,
              embedding: projection?.embedding,
              runtime,
            }, null, 2)}</pre>
          </section>
          {selected ? <section><h3>Technical details</h3><pre>{JSON.stringify({ properties: selected.properties, provenance: selected.provenance }, null, 2)}</pre></section> : null}
        </div>
      </RightGlassDrawer>
    </div>
  );
}
