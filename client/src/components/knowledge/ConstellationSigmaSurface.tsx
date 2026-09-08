import { useEffect, useMemo, useRef, useState } from 'react';
import { MultiDirectedGraph } from 'graphology';
import Sigma from 'sigma';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { inferSettings } from 'graphology-layout-forceatlas2';

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
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [community, setCommunity] = useState('');
  const topologyRef = useRef('');
  const layoutRef = useRef<FA2Layout | null>(null);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const selected = useMemo(
    () => projection?.nodes.find((node) => node.id === selectedId) || null,
    [projection, selectedId],
  );
  const selectedEdge = projection?.edges.find(edge => edge.id === selectedEdgeId);
  useEffect(() => {
    if (community && !projection?.analysis?.communities.some(group => group.id === community)) setCommunity('');
  }, [community, projection]);
  const expandRef = useRef(onExpand);
  const projectionRef = useRef(projection);
  expandRef.current = onExpand;
  projectionRef.current = projection;

  useEffect(() => {
    try {
      const result = synchronizeProjectionGraph(graph, projection);
      const topology = JSON.stringify([graph.nodes().sort(), graph.edges().sort().map(id => [id, graph.extremities(id), graph.getEdgeAttribute(id, 'weight')])]);
      if (topology !== topologyRef.current) {
        layoutRef.current?.kill();
        if (layoutTimer.current) clearTimeout(layoutTimer.current);
        topologyRef.current = topology;
        if (graph.order > 1) {
          const layout = new FA2Layout(graph, { settings: { ...inferSettings(graph), gravity: 1, scalingRatio: 10, slowDown: 5 } });
          layoutRef.current = layout;
          const started = performance.now();
          layout.start();
          layoutTimer.current = setTimeout(() => {
            layout.stop();
            if (containerRef.current) containerRef.current.dataset.layoutMs = String(Math.round(performance.now() - started));
          }, result.becamePopulated ? 1600 : 600);
        }
      }
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
  }, [graph, projection]);

  useEffect(() => () => {
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutRef.current?.kill();
    layoutRef.current = null;
    topologyRef.current = '';
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      defaultNodeColor: '#5eead4',
      defaultEdgeColor: '#315b6a',
      labelColor: { color: '#e6f6ff' },
      labelFont: 'Public Sans, Segoe UI, sans-serif',
      labelSize: 13,
      stagePadding: 65,
      labelRenderedSizeThreshold: 7,
      labelDensity: 0.7,
      labelGridCellSize: 120,
      renderEdgeLabels: false,
      enableEdgeEvents: true,
      zIndex: true,
    });
    renderer.on('clickNode', ({ node }) => {
      setSelectedId(node);
      setSelectedEdgeId(null);
      setInspectorOpen(true);
      const item = projectionRef.current?.nodes.find(candidate => candidate.id === node);
      if (item && expandRef.current) {
        setExpanding(true);
        void expandRef.current(item).catch(caught => setSyncError(String(caught))).finally(() => setExpanding(false));
      }
    });
    renderer.on('clickEdge', ({ edge }) => {
      setSelectedEdgeId(edge);
      setSelectedId(null);
      setInspectorOpen(true);
    });
    renderer.on('enterNode', ({ node }) => setHoveredId(node));
    renderer.on('leaveNode', () => setHoveredId(null));
    renderer.on('clickStage', () => { setSelectedId(null); setSelectedEdgeId(null); });
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
      if (community && attributes.communityId !== community) return { ...attributes, hidden: true };
      if (!focus || node === focus || neighbors?.has(node)) return attributes;
      return { ...attributes, color: '#18232f', label: '' };
    });
    renderer.setSetting('edgeReducer', (edge, attributes) => {
      if (community && graph.extremities(edge).some(node => graph.getNodeAttribute(node, 'communityId') !== community)) return { ...attributes, hidden: true };
      if (!focus || graph.extremities(edge).includes(focus)) return attributes;
      return { ...attributes, hidden: true };
    });
    renderer.refresh();
  }, [graph, hoveredId, selectedId, community, projection]);

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
    <div data-testid="native-thinkgraph-surface" className="constellation-sigma-surface" aria-busy={status === 'loading'}>
      <div className="constellation-sigma-canvas">
        {(projection?.analysis?.communities.length || 0) > 1 ? <select aria-label="Community" className="thinkgraph-community" value={community} onChange={event => setCommunity(event.target.value)}>
          <option value="">All</option>
          {projection?.analysis?.communities.map(group => <option key={group.id} value={group.id}>{group.centralNodes.map(id => projection.nodes.find(node => node.id === id)?.label).filter(Boolean).slice(0, 2).join(' · ')} ({group.memberCount})</option>)}
        </select> : null}
        <div ref={containerRef} className="constellation-sigma-network" />
        <GraphNavigationControls
          onZoomIn={() => changeZoom(1 / 1.5)}
          onZoomOut={() => changeZoom(1.5)}
          onFit={resetCamera}
        />
        {(status === 'error' || syncError) ? <div role="alert" className="native-authority-empty" title={displayedError || undefined}>Unable to load graph.</div> : null}
      </div>
      <RightGlassDrawer
        isOpen={inspectorOpen}
        title="ThinkGraph"
        onClose={() => setInspectorOpen(false)}
        onOpen={() => setInspectorOpen(true)}
        collapsedLabel={null}
        openAriaLabel="Open ThinkGraph Inspector"
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
          {selected ? (
            <section data-testid="thinkgraph-node-inspector">
              <h4>{selected.label || selected.title || selected.id}</h4>
              {typeof selected.properties?.summary === 'string' ? <p>{selected.properties.summary}</p> : null}
              {typeof selected.properties?.fullContent === 'string' && selected.properties.fullContent !== selected.properties.summary ? <p className="thinkgraph-content">{selected.properties.fullContent}</p> : null}
              {selected.properties?.questionStatus ? <p>{String(selected.properties.questionStatus).replaceAll('_', ' ')}</p> : null}
              <GraphReferences title="Evidence" value={selected.properties?.answerRefs} />
              <GraphReferences title="Related" value={selected.properties?.relatedRefs} />
              <details><summary>Details</summary><dl className="thinkgraph-details">
                {(['nodeType', 'memoryCategory', 'authoredBy', 'decisionState', 'projectScope', 'userScope', 'centrality', 'gatewayScore', 'currentInterest'] as const).map(key => {
                  const value = selected.properties?.[key];
                  const labels = { nodeType: 'Type', memoryCategory: 'Memory', authoredBy: 'Author', decisionState: 'Decision', questionStatus: 'Question', projectScope: 'Project', userScope: 'User', centrality: 'Centrality', gatewayScore: 'Gateway', currentInterest: 'Interest' };
                  return value != null ? <div key={key}><dt>{labels[key]}</dt><dd>{typeof value === 'number' ? value.toFixed(3) : String(value).replaceAll('_', ' ')}</dd></div> : null;
                })}
              </dl></details>
              <details><summary>References</summary><p>{selected.id}</p><p>{String(selected.provenance?.source || '')}</p><GraphReferences title="Origin" value={selected.provenance?.references} /></details>
              <div className="native-authority-actions">
                {onExpand ? <button disabled={expanding} onClick={() => {
                  setExpanding(true);
                  void onExpand(selected).catch(caught => setSyncError(String(caught))).finally(() => setExpanding(false));
                }}>{expanding ? 'Expanding…' : 'Expand'}</button> : null}
                {onUseAsContext ? <button onClick={() => onUseAsContext(selected)}>Use in chat</button> : null}
              </div>
            </section>
          ) : null}
          {selectedEdge ? <section data-testid="thinkgraph-edge-inspector">
            <h4>{selectedEdge.predicate}</h4>
            <p>{projection?.nodes.find(node => node.id === selectedEdge.source)?.label} → {projection?.nodes.find(node => node.id === selectedEdge.target)?.label}</p>
            <p>{String(selectedEdge.properties?.edgeClass || '')}{selectedEdge.properties?.derivedType ? ` · ${String(selectedEdge.properties.derivedType)}` : ''}</p>
            {selectedEdge.properties?.strength != null ? <p>Strength {Number(selectedEdge.properties.strength).toFixed(2)}</p> : null}
            {selectedEdge.properties?.rationale || selectedEdge.properties?.content ? <p>{String(selectedEdge.properties.rationale || selectedEdge.properties.content)}</p> : null}
            <details><summary>References</summary><p>{selectedEdge.id}</p><p>{String(selectedEdge.provenance?.source || '')}</p></details>
          </section> : null}
          {selected && projection?.analysis?.gaps.filter(gap => gap.source === selected.id || gap.target === selected.id).map(gap => <p key={`${gap.source}:${gap.target}`} className="thinkgraph-gap">Possible connection: {projection.nodes.find(node => node.id === (gap.source === selected.id ? gap.target : gap.source))?.label}. {gap.reason}</p>)}
        </div>
      </RightGlassDrawer>
    </div>
  );
}

function GraphReferences({ title, value }: { title: string; value: unknown }) {
  if (!Array.isArray(value) || !value.length) return null;
  return <div><h5>{title}</h5><ul>{value.map((ref, index) => <li key={index}>{typeof ref === 'string' ? ref : `${ref.authority}: ${ref.nativeId}`}</li>)}</ul></div>;
}
