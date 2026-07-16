import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph from 'force-graph';
import { forceCollide, forceX, forceY } from 'd3-force';

import { GraphTab as CbmGraphTab } from '../../vendor/codebase-memory-ui/src/components/GraphTab';
import type { GraphProjectionV1 } from './KnowledgeGraphFramework';
import './nativeAuthorityGraphSurface.css';

export function NativeCodeGraphSurface({ project }: { project: string | null }) {
  return (
    <div data-testid="native-codegraph-surface" className="cbm-native-surface h-full w-full min-h-0 bg-background text-foreground">
      <CbmGraphTab project={project} />
    </div>
  );
}

type NativeNode = {
  id: string;
  label: string;
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
  Goal: '#7c6bf5',
  Question: '#22d3ee',
  Decision: '#fbbf24',
  GraphView: '#60a5fa',
  Finding: '#4ade80',
  CodeInspectionNeed: '#a78bfa',
  ResearchNeed: '#f87171',
};

function endpointId(value: string | NativeNode): string {
  return typeof value === 'string' ? value : value.id;
}

export function NativeThinkGraphSurface({
  projection,
  status,
  error,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const hoveredRef = useRef<string | null>(null);
  const adjacencyRef = useRef(new Map<string, Set<string>>());
  const [hideIsolated, setHideIsolated] = useState(true);
  const [showLinkLabels, setShowLinkLabels] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<NativeNode | null>(null);
  const [settings, setSettings] = useState({
    font: 13,
    labelDensity: 40,
    size: 5,
    linkWidth: 1,
    repel: 120,
    linkDistance: 30,
    gravity: 14,
  });

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
        label: node.label || node.title || node.id,
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
        .autoPauseRedraw(false)
        .onNodeClick((node) => setSelected(node as NativeNode))
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
        const hovered = hoveredRef.current;
        const neighbors = hovered ? adjacencyRef.current.get(hovered) : null;
        const connectedFocus = Boolean(hovered && neighbors && neighbors.size > 1);
        const isNeighbor = !connectedFocus || node.id === hovered || neighbors?.has(node.id);
        const radius = Math.max(1.2, settings.size * Math.sqrt(node.val) * 0.45);
        context.globalAlpha = isNeighbor ? 1 : 0.12;
        context.beginPath();
        context.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        context.fillStyle = TYPE_COLORS[node.etype] || '#a78bfa';
        context.fill();
        if (connectedFocus && node.id === hovered) {
          context.lineWidth = 1.6;
          context.strokeStyle = '#d8d8e2';
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
        const hovered = hoveredRef.current;
        const connected = hovered && (endpointId(link.source) === hovered || endpointId(link.target) === hovered);
        const alpha = hovered ? (connected ? 0.92 : 0.05) : Math.min(0.9, 0.2 + 0.22 * settings.linkWidth);
        return `rgba(140,142,170,${alpha})`;
      })
      .linkWidth((link: NativeLink) => {
        const hovered = hoveredRef.current;
        return (hovered && (endpointId(link.source) === hovered || endpointId(link.target) === hovered) ? 1.8 : 0.85) * settings.linkWidth;
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
          if (node.x == null || (labelRank.get(node.id) ?? Number.MAX_SAFE_INTEGER) >= cap) continue;
          const hovered = hoveredRef.current;
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
        <div ref={hostRef} className="engraphis-native-network" />
        {status === 'loading' && !projection ? <div className="engraphis-native-empty">Loading graph…</div> : null}
        {status === 'error' ? <div className="engraphis-native-empty">Graph failed: {error}</div> : null}
        {status === 'ready' && allNodes === 0 ? <div className="engraphis-native-empty">No entities in this project yet.</div> : null}
      </div>
      <aside className="engraphis-native-controls">
        <section>
          <h3>Controls</h3>
          <div className="engraphis-native-actions">
            <button onClick={() => window.dispatchEvent(new Event('knowledge:refresh'))}>Refresh</button>
            <button onClick={() => graphRef.current?.d3ReheatSimulation()}>Reheat</button>
            <button onClick={() => graphRef.current?.zoomToFit(600, 60)}>Fit</button>
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
          {topConnected.map((node, index) => <button className="engraphis-native-rank" key={node.id} onClick={() => { setSearch(node.label); focusNode(node); }}><span>{index + 1}</span><i style={{ background: TYPE_COLORS[node.etype] || '#a78bfa' }} /> <b>{node.label}</b><em>{node.degree}</em></button>)}
        </section>
        <section>
          <h3>Entity types <span>{typeCounts.length}</span></h3>
          {typeCounts.map(([type, count]) => <div className="engraphis-native-type" key={type}><i style={{ background: TYPE_COLORS[type] || '#a78bfa' }} /><span>{type}</span><b>{count}</b></div>)}
        </section>
        <section>
          <h3>Graph stats</h3>
          <dl className="engraphis-native-stats"><div><dt>Entities</dt><dd>{allNodes}</dd></div><div><dt>Relations</dt><dd>{allEdges}</dd></div><div><dt>Connected</dt><dd>{connectedCount}</dd></div><div><dt>Isolated</dt><dd>{Math.max(0, allNodes - connectedCount)}</dd></div></dl>
        </section>
        {selected ? <section data-testid="thinkgraph-node-inspector"><h3>Entity</h3><h4>{selected.label}</h4><p>{selected.etype} · {selected.degree} connections</p><pre>{JSON.stringify(selected.properties, null, 2)}</pre></section> : null}
      </aside>
    </div>
  );
}
