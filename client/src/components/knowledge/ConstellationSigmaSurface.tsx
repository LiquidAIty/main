import { useEffect, useMemo, useRef, useState } from 'react';
import { MultiDirectedGraph } from 'graphology';
import Sigma from 'sigma';

import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls } from '../graph/GraphCanvasChrome';
import { synchronizeProjectionGraph } from './constellationSigmaGraph';
import type { GraphProjectionNode, GraphProjectionV1 } from './NativeAuthorityGraphSurface';
import './nativeAuthorityGraphSurface.css';

function reducedMotionPreferred(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const graph = useMemo(() => new MultiDirectedGraph(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [search, setSearch] = useState('');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [rendered, setRendered] = useState({ nodes: 0, edges: 0, filteredEdges: 0 });

  const selected = useMemo(
    () => projection?.nodes.find((node) => node.id === selectedId) || null,
    [projection, selectedId],
  );

  useEffect(() => {
    try {
      const result = synchronizeProjectionGraph(graph, projection);
      setRendered({
        nodes: result.renderedNodes,
        edges: result.renderedEdges,
        filteredEdges: result.filteredEdges,
      });
      setSyncError(null);
      if (selectedId && !graph.hasNode(selectedId)) {
        setSelectedId(null);
        setInspectorOpen(false);
      }
      if (hoveredId && !graph.hasNode(hoveredId)) setHoveredId(null);
      const renderer = rendererRef.current;
      if (renderer) {
        if (result.becamePopulated) {
          renderer.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
        }
        renderer.refresh();
      }
    } catch (caught) {
      setSyncError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [graph, hoveredId, projection, selectedId]);

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
      const camera = rendererRef.current.getCamera();
      const state = { x: display.x, y: display.y, ratio: 0.18 };
      if (reducedMotionPreferred()) camera.setState(state);
      else void camera.animate(state, { duration: 500 });
    }
  };

  const runtime = projection && 'runtime' in projection
    ? (projection as GraphProjectionV1 & { runtime?: Record<string, unknown> }).runtime
    : undefined;
  const embeddingState = String(projection?.embedding?.state || '');
  const degradedReason = projection?.embedding?.reason;
  const displayedError = error || syncError;

  const changeZoom = (factor: number) => {
    const camera = rendererRef.current?.getCamera();
    if (!camera) return;
    const next = { ratio: camera.getState().ratio * factor };
    if (reducedMotionPreferred()) camera.setState(next);
    else void camera.animate(next, { duration: 220 });
  };

  const resetCamera = () => {
    const camera = rendererRef.current?.getCamera();
    if (!camera) return;
    if (reducedMotionPreferred()) camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    else void camera.animatedReset({ duration: 320 });
  };

  return (
    <div data-testid="native-thinkgraph-surface" className="constellation-sigma-surface">
      <div className="constellation-sigma-canvas">
        <div className="constellation-sigma-stars" aria-hidden="true" />
        <div ref={containerRef} className="constellation-sigma-network" />
        <div className="constellation-sigma-badge">
          <strong>Constellation</strong>
          <span>{rendered.nodes} memories · {rendered.edges} relations</span>
          {rendered.filteredEdges > 0 ? <span>{rendered.filteredEdges} relation endpoints outside projection</span> : null}
        </div>
        <GraphNavigationControls
          onZoomIn={() => changeZoom(1 / 1.5)}
          onZoomOut={() => changeZoom(1.5)}
          onFit={resetCamera}
        />
        {status === 'idle' && !projection ? <div className="native-authority-empty">Waiting for Constellation…</div> : null}
        {status === 'loading' && !projection ? <div className="native-authority-empty">Loading Constellation…</div> : null}
        {(status === 'error' || syncError) ? <div role="alert" className="native-authority-empty">Constellation failed: {displayedError}</div> : null}
        {status === 'ready' && graph.order === 0 ? <div className="native-authority-empty">No Constellation memories in this attention scope yet.</div> : null}
        {status === 'ready' && embeddingState === 'degraded' ? (
          <div role="status" className="constellation-sigma-degraded">
            Deterministic topology active; semantic retrieval degraded{degradedReason ? `: ${String(degradedReason)}` : '.'}
          </div>
        ) : null}
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
