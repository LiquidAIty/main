import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph from 'force-graph';
import { forceCollide, forceX, forceY } from 'd3-force';

import { GraphTab as CbmGraphTab } from '../../vendor/codebase-memory-ui/src/components/GraphTab';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import { AskMainAction, type GraphObjectRef } from './GraphObjectContext';
import './nativeAuthorityGraphSurface.css';

// The server-owned graph projection contract rendered by the native surfaces.
type GraphProjectionNode = {
  id: string;
  canonicalId?: string;
  label: string;
  title?: string;
  type?: string;
  labels?: string[];
  authority?: string;
  projectId?: string;
  conversationId?: string;
  episodeId?: string;
  jobId?: string;
  runId?: string;
  goalId?: string;
  memoryType?: string;
  currentState?: string;
  createdAt?: string;
  validFrom?: string;
  validTo?: string | null;
  ingestedAt?: string;
  updatedAt?: string;
  mentionCount: number;
  lastMentionedAt?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  provenanceCount?: number;
  degree?: number;
  cardId?: string;
  correlationId?: string;
  codeGraphRef?: string;
  knowGraphRef?: string;
  artifactRef?: string;
  promptRef?: string;
  trustState?: string;
  qualityState?: string;
  productionPath?: string;
  retrievalReason?: string;
};

type GraphProjectionEdge = {
  id: string;
  source: string;
  target: string;
  predicate: string;
  mentionCount: number;
  lastMentionedAt?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  provenanceCount?: number;
  validFrom?: string;
  validTo?: string | null;
};

export type GraphProjectionV1 = {
  schemaVersion: string;
  authority?: string;
  projectId: string;
  revision?: string;
  embedding?: Record<string, unknown>;
  counts?: { nodes: number; edges: number };
  nodes: GraphProjectionNode[];
  edges: GraphProjectionEdge[];
};

export function NativeCodeGraphSurface({
  project,
  onAskMain,
  onSelectedObjectChange,
}: {
  project: string | null;
  onAskMain?: (reference: GraphObjectRef) => void;
  onSelectedObjectChange?: (reference: GraphObjectRef | null) => void;
}) {
  const asReference = (node: { name: string }): GraphObjectRef => ({
    authority: 'codegraph',
    canonicalId: node.name,
    selectedThrough: 'codegraph',
    displayLabel: node.name,
  });
  return (
    <div data-testid="native-codegraph-surface" className="cbm-native-surface h-full w-full min-h-0 bg-background text-foreground">
      <CbmGraphTab
        project={project}
        onAskMainNode={(node) => onAskMain?.(asReference(node))}
        onSelectedNodeChange={(node) => onSelectedObjectChange?.(node ? asReference(node) : null)}
      />
    </div>
  );
}

type NativeNode = {
  id: string;
  label: string;
  fullLabel: string;
  etype: string;
  degree: number;
  val: number;
  properties: Record<string, unknown>;
  x?: number;
  y?: number;
};

type NativeLink = {
  source: string | NativeNode;
  target: string | NativeNode;
  label: string;
};

const TYPE_COLORS: Record<string, string> = {
  Goal: '#37ADAA',
  Question: '#62B0E8',
  Decision: '#7BC8C4',
  GraphView: '#6FA8B8',
  Finding: '#91C4B3',
  CodeInspectionNeed: '#8FA9B3',
  ResearchNeed: '#6D8F99',
  Risk: '#8798A0',
};
const DEFAULT_TYPE_COLOR = '#A7B0BA';

function endpointId(value: string | NativeNode): string {
  return typeof value === 'string' ? value : value.id;
}

function shortNodeLabel(node: GraphProjectionV1['nodes'][number]): string {
  const properties = node.properties || {};
  const semantic = String(properties.display_label || node.label || node.title || node.type || 'record').trim();
  return semantic.split(/\s+/).slice(0, 3).join(' ');
}

export function NativeThinkGraphSurface({
  projection,
  status,
  error,
  onAskMain,
  onSelectedObjectChange,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  onAskMain?: (reference: GraphObjectRef) => void;
  onSelectedObjectChange?: (reference: GraphObjectRef | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const adjacencyRef = useRef(new Map<string, Set<string>>());
  const [hideIsolated, setHideIsolated] = useState(true);
  const [showLinkLabels, setShowLinkLabels] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<NativeNode | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [settings, setSettings] = useState({
    font: 10,
    labelDensity: 8,
    size: 5,
    linkWidth: 1,
    repel: 120,
    linkDistance: 30,
    gravity: 14,
  });

  useEffect(() => {
    onSelectedObjectChange?.(selected ? {
      authority: 'thinkgraph',
      canonicalId: selected.id,
      selectedThrough: 'thinkgraph',
      displayLabel: selected.fullLabel,
    } : null);
  }, [onSelectedObjectChange, selected]);
  selectedRef.current = selected?.id || null;

  const nativeData = useMemo(() => {
    const nodes = projection?.nodes ?? [];
    const edges = projection?.edges ?? [];
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    }
    const visibleNodes: NativeNode[] = nodes
      .map((node) => ({
        id: node.id,
        label: shortNodeLabel(node),
        fullLabel: String(node.label || node.title || node.id),
        etype: node.type || 'person_or_concept',
        degree: degree.get(node.id) || 0,
        val: 1 + (degree.get(node.id) || 0),
        properties: node.properties || {},
      }))
      .filter((node) => !hideIsolated || node.degree > 0);
    const ids = new Set(visibleNodes.map((node) => node.id));
    const links: NativeLink[] = edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target, label: edge.predicate }));
    return { nodes: visibleNodes, links };
  }, [hideIsolated, projection]);

  const adjacency = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const link of nativeData.links) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (!result.has(source)) result.set(source, new Set());
      if (!result.has(target)) result.set(target, new Set());
      result.get(source)!.add(target);
      result.get(target)!.add(source);
    }
    return result;
  }, [nativeData.links]);
  adjacencyRef.current = adjacency;

  useEffect(() => {
    if (!hostRef.current) return;
    if (!graphRef.current) {
      graphRef.current = new ForceGraph(hostRef.current)
        .backgroundColor('rgba(0,0,0,0)')
        .cooldownTime(4000)
        .warmupTicks(40)
        .nodeRelSize(1)
        .autoPauseRedraw(true)
        .onNodeClick((node) => {
          setSelected(node as NativeNode);
          setInspectorOpen(true);
        })
        .onNodeHover((node) => {
          hoveredRef.current = node ? String(node.id) : null;
          if (hostRef.current) hostRef.current.style.cursor = node ? 'pointer' : 'grab';
        });
    }
    const graph = graphRef.current;
    const labelRank = new Map(
      [...nativeData.nodes]
        .sort((a, b) => b.degree - a.degree)
        .map((node, index) => [node.id, index]),
    );
    graph
      .nodeCanvasObject((node: NativeNode, context: CanvasRenderingContext2D) => {
        const focused = hoveredRef.current || selectedRef.current;
        const neighbors = focused ? adjacencyRef.current.get(focused) : null;
        const connectedFocus = Boolean(focused && neighbors && neighbors.size > 1);
        const isNeighbor = !connectedFocus || node.id === focused || neighbors?.has(node.id);
        const radius = Math.max(1.2, settings.size * Math.sqrt(node.val) * 0.45);
        context.globalAlpha = isNeighbor ? 1 : 0.12;
        context.beginPath();
        context.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        context.fillStyle = TYPE_COLORS[node.etype] || DEFAULT_TYPE_COLOR;
        context.fill();
        if (connectedFocus && node.id === focused) {
          context.lineWidth = 1.6;
          context.strokeStyle = '#A9ECE8';
          context.stroke();
        }
        context.globalAlpha = 1;
      })
      .nodePointerAreaPaint((node: NativeNode, color: string, context: CanvasRenderingContext2D) => {
        const radius = Math.max(3, settings.size * Math.sqrt(node.val) * 0.45) + 2;
        context.beginPath();
        context.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
      })
      .linkColor((link: NativeLink) => {
        const focused = hoveredRef.current || selectedRef.current;
        const connected = focused && (endpointId(link.source) === focused || endpointId(link.target) === focused);
        const alpha = focused ? (connected ? 0.92 : 0.05) : Math.min(0.72, 0.16 + 0.18 * settings.linkWidth);
        return `rgba(112,154,160,${alpha})`;
      })
      .linkWidth((link: NativeLink) => {
        const focused = hoveredRef.current || selectedRef.current;
        return (focused && (endpointId(link.source) === focused || endpointId(link.target) === focused) ? 1.8 : 0.75) * settings.linkWidth;
      })
      .linkDirectionalArrowLength(2)
      .linkDirectionalArrowRelPos(1)
      .linkCanvasObjectMode(() => (showLinkLabels ? 'after' : undefined))
      .linkCanvasObject((link: NativeLink, context: CanvasRenderingContext2D, scale: number) => {
        const source = link.source as NativeNode;
        const target = link.target as NativeNode;
        if (!showLinkLabels || scale < 2.4 || source.x == null || target.x == null) return;
        context.font = `${(settings.font * 0.82) / scale}px sans-serif`;
        context.fillStyle = '#7a7a8c';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(link.label, ((source.x || 0) + (target.x || 0)) / 2, ((source.y || 0) + (target.y || 0)) / 2);
      })
      .onRenderFramePost((context: CanvasRenderingContext2D, scale: number) => {
        const cap = Math.round(settings.labelDensity * Math.max(0.3, scale - 1));
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.lineJoin = 'round';
        for (const node of graph.graphData().nodes as NativeNode[]) {
          const hovered = hoveredRef.current;
          const emphasized = node.id === hovered || node.id === selectedRef.current;
          if (node.x == null || (!emphasized && (labelRank.get(node.id) ?? Number.MAX_SAFE_INTEGER) >= cap)) continue;
          const neighbors = hovered ? adjacencyRef.current.get(hovered) : null;
          const connectedFocus = Boolean(hovered && neighbors && neighbors.size > 1);
          const isNeighbor = !connectedFocus || node.id === hovered || neighbors?.has(node.id);
          if (!isNeighbor) continue;
          const radius = Math.max(1.2, settings.size * Math.sqrt(node.val) * 0.45);
          const fontSize = settings.font / scale;
          const y = (node.y || 0) + radius + 2 / scale;
          context.font = `${fontSize}px -apple-system,Segoe UI,sans-serif`;
          context.lineWidth = 3 / scale;
          context.strokeStyle = '#0a0a0f';
          context.strokeText(node.label, node.x, y);
          context.fillStyle = '#d8d8e2';
          context.fillText(node.label, node.x, y);
        }
      });
    graph.d3Force('charge').strength(-settings.repel);
    graph.d3Force('link').distance(settings.linkDistance);
    graph.d3Force('x', forceX(0).strength(settings.gravity / 100));
    graph.d3Force('y', forceY(0).strength(settings.gravity / 100));
    graph.d3Force('collide', forceCollide((node: NativeNode) => Math.max(2, settings.size * Math.sqrt(node.val) * 0.45) + 1.5));
    graph.graphData(nativeData);
    graph.d3ReheatSimulation();

    const resize = new ResizeObserver(([entry]) => {
      graph.width(entry.contentRect.width).height(entry.contentRect.height);
    });
    resize.observe(hostRef.current);
    const fit = window.setTimeout(() => graph.zoomToFit(600, 60), 900);
    return () => {
      resize.disconnect();
      window.clearTimeout(fit);
    };
  }, [adjacency, nativeData, settings, showLinkLabels]);

  const focusNode = (match: NativeNode) => {
    setSelected(match);
    if (match.x != null && match.y != null && graphRef.current) {
      hoveredRef.current = match.id;
      graphRef.current.centerAt(match.x, match.y, 700);
      graphRef.current.zoom(5, 700);
    }
  };

  const focusSearch = () => {
    const query = search.trim().toLowerCase();
    if (!query || !graphRef.current) return;
    const match = (graphRef.current.graphData().nodes as NativeNode[]).find((node) => node.label.toLowerCase().includes(query));
    if (match) focusNode(match);
  };

  const allNodes = projection?.nodes.length ?? 0;
  const allEdges = projection?.edges.length ?? 0;
  const topConnected = [...nativeData.nodes].sort((a, b) => b.degree - a.degree).slice(0, 8);
  const typeCounts = [...nativeData.nodes.reduce((counts, node) => {
    counts.set(node.etype, (counts.get(node.etype) || 0) + 1);
    return counts;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const connectedCount = nativeData.nodes.filter((node) => node.degree > 0).length;
  return (
    <div data-testid="native-thinkgraph-surface" className="engraphis-native-graph">
      <div className="engraphis-native-canvas">
        <GraphPaperBackground />
        <div ref={hostRef} className="engraphis-native-network" />
        <GraphNavigationControls
          onZoomIn={() => {
            const graph = graphRef.current;
            if (graph) graph.zoom(graph.zoom() * 1.2, 220);
          }}
          onZoomOut={() => {
            const graph = graphRef.current;
            if (graph) graph.zoom(graph.zoom() / 1.2, 220);
          }}
          onFit={() => graphRef.current?.zoomToFit(320, 60)}
        />
        {status === 'loading' && !projection ? <div className="engraphis-native-empty">Loading graph…</div> : null}
        {status === 'error' ? <div className="engraphis-native-empty">Graph failed: {error}</div> : null}
        {status === 'ready' && allNodes === 0 ? <div className="engraphis-native-empty">No entities in this project yet.</div> : null}
      </div>
      <RightGlassDrawer
        isOpen={inspectorOpen}
        title="ThinkGraph Inspector"
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
      <div className="engraphis-native-controls">
        {selected ? <section data-testid="thinkgraph-node-inspector"><h3>Identity</h3><h4>{selected.fullLabel}</h4><p>{selected.label} · {selected.etype} · {selected.degree} connections</p><AskMainAction reference={{ authority: 'thinkgraph', canonicalId: selected.id, selectedThrough: 'thinkgraph', displayLabel: selected.fullLabel }} onAskMain={onAskMain} /></section> : null}
        <section>
          <h3>Controls</h3>
          <div className="engraphis-native-actions">
            <button onClick={() => window.dispatchEvent(new Event('knowledge:refresh'))}>Refresh</button>
            <button onClick={() => graphRef.current?.d3ReheatSimulation()}>Reheat</button>
          </div>
          <label><input type="checkbox" checked={hideIsolated} onChange={(event) => setHideIsolated(event.target.checked)} /> Hide unconnected entities</label>
          <label><input type="checkbox" checked={showLinkLabels} onChange={(event) => setShowLinkLabels(event.target.checked)} /> Show link labels</label>
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && focusSearch()} placeholder="Find entity…" />
          {([
            ['Text size', 'font', 6, 28], ['Label density', 'labelDensity', 5, 200],
            ['Node size', 'size', 2, 14], ['Line width', 'linkWidth', 0.4, 4],
            ['Repel force', 'repel', 20, 400], ['Link distance', 'linkDistance', 10, 150],
            ['Center gravity', 'gravity', 0, 50],
          ] as const).map(([label, key, min, max]) => (
            <label className="engraphis-native-slider" key={key}><span>{label}</span><input type="range" min={min} max={max} step={key === 'linkWidth' ? 0.1 : 1} value={settings[key]} onChange={(event) => setSettings((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>
          ))}
        </section>
        <section>
          <h3>Top connected</h3>
          {topConnected.map((node, index) => <button className="engraphis-native-rank" key={node.id} onClick={() => { setSearch(node.label); focusNode(node); }}><span>{index + 1}</span><i style={{ background: TYPE_COLORS[node.etype] || DEFAULT_TYPE_COLOR }} /> <b>{node.label}</b><em>{node.degree}</em></button>)}
        </section>
        <section>
          <h3>Entity types <span>{typeCounts.length}</span></h3>
          {typeCounts.map(([type, count]) => <div className="engraphis-native-type" key={type}><i style={{ background: TYPE_COLORS[type] || DEFAULT_TYPE_COLOR }} /><span>{type}</span><b>{count}</b></div>)}
        </section>
        <section>
          <h3>Graph stats</h3>
          <dl className="engraphis-native-stats"><div><dt>Entities</dt><dd>{allNodes}</dd></div><div><dt>Relations</dt><dd>{allEdges}</dd></div><div><dt>Connected</dt><dd>{connectedCount}</dd></div><div><dt>Isolated</dt><dd>{Math.max(0, allNodes - connectedCount)}</dd></div></dl>
        </section>
        {selected ? <section><h3>Technical details</h3><pre>{JSON.stringify(selected.properties, null, 2)}</pre></section> : null}
      </div>
      </RightGlassDrawer>
    </div>
  );
}
