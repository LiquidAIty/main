import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph from 'force-graph';
import { forceCollide, forceX, forceY } from 'd3-force';

import { GraphTab as CbmGraphTab } from '../../vendor/codebase-memory-ui/src/components/GraphTab';
import type { GraphData } from '../../vendor/codebase-memory-ui/src/lib/types';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import './nativeAuthorityGraphSurface.css';

type GraphAuthority = 'thinkgraph' | 'knowgraph' | 'codegraph' | 'agentgraph';

// The server-owned graph projection contract rendered by the native surfaces.
export type GraphProjectionNode = {
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
  trustState?: string;
  qualityState?: string;
  productionPath?: string;
  retrievalReason?: string;
};

export type GraphProjectionEdge = {
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

export function NativeKnowGraphSurface({
  projection,
  error,
  onExpand,
  onUseAsContext,
}: {
  projection: GraphProjectionV1;
  error: string | null;
  onExpand: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
}) {
  return (
    <NativeGraphProjectionSurface
      projection={projection}
      status={error ? 'error' : 'ready'}
      error={error}
      authority="knowgraph"
      onExpand={onExpand}
      onUseAsContext={onUseAsContext}
    />
  );
}

function toCodeGraphData(projection: GraphProjectionV1): GraphData {
  const indexById = new Map(projection.nodes.map((node, index) => [node.id, index + 1]));
  const count = Math.max(1, projection.nodes.length);
  const nodes = projection.nodes.map((node, index) => {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const properties = node.properties || {};
    return {
      id: index + 1,
      x: Math.cos(angle) * radial * 180,
      y: y * 180,
      z: Math.sin(angle) * radial * 180,
      label: String(node.type || 'Symbol'),
      name: String(node.label || node.title || node.id),
      file_path: typeof properties.file_path === 'string' ? properties.file_path : undefined,
      size: 10,
      color: String(properties.attentionActorColor || '#37ADAA'),
      native_id: node.id,
      canonical_id: node.canonicalId || node.id,
      authority: 'codegraph',
      actor_card_id: typeof properties.attentionActorCardId === 'string' ? properties.attentionActorCardId : undefined,
      actor_color: typeof properties.attentionActorColor === 'string' ? properties.attentionActorColor : undefined,
      tool_name: typeof properties.attentionToolName === 'string' ? properties.attentionToolName : undefined,
      properties,
      provenance: node.provenance,
    };
  });
  const edges = projection.edges.flatMap((edge) => {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    return source && target ? [{ source, target, type: edge.predicate }] : [];
  });
  return { nodes, edges, total_nodes: nodes.length };
}

export function NativeCodeGraphSurface({
  project,
  projection,
  onExpand,
  onUseAsContext,
}: {
  project: string | null;
  projection: GraphProjectionV1;
  onExpand: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
}) {
  const attentionData = useMemo(() => toCodeGraphData(projection), [projection]);
  return (
    <div data-testid="native-codegraph-surface" className="cbm-native-surface h-full w-full min-h-0 bg-background text-foreground">
      <CbmGraphTab
        project={project}
        attentionData={attentionData}
        onExpand={async (node) => {
          const native = projection.nodes.find((candidate) => candidate.id === node.native_id);
          if (native) await onExpand(native);
        }}
        onUseAsContext={(node) => {
          const native = projection.nodes.find((candidate) => candidate.id === node.native_id);
          if (native) onUseAsContext?.(native);
        }}
      />
    </div>
  );
}

type NativeNode = {
  id: string;
  canonicalId: string;
  label: string;
  fullLabel: string;
  etype: string;
  authority: string;
  currentState?: string;
  trustState?: string;
  qualityState?: string;
  codeGraphRef?: string;
  knowGraphRef?: string;
  provenance: Record<string, unknown>;
  degree: number;
  val: number;
  properties: Record<string, unknown>;
  attentionActorCardId?: string;
  attentionActorColor?: string;
  attentionToolName?: string;
  attentionActive: boolean;
  source?: 'user' | 'assistant' | 'reasoning' | 'tool';
  transient: boolean;
  presentationLayer?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};

type NativeLink = {
  id: string;
  source: string | NativeNode;
  target: string | NativeNode;
  label: string;
  transient: boolean;
  attentionActorColor?: string;
};

const TYPE_COLORS: Record<string, string> = {
  Goal: '#37ADAA',
  Question: '#62B0E8',
  Decision: '#7BC8C4',
  Finding: '#91C4B3',
  CodeInspectionNeed: '#8FA9B3',
  ResearchNeed: '#6D8F99',
  Risk: '#8798A0',
};
const DEFAULT_TYPE_COLOR = '#A7B0BA';
const LIVE_SOURCE_COLORS: Record<string, string> = {
  user: '#F3B35B',
  reasoning: '#A98BF3',
  assistant: '#63D8D2',
  tool: '#EE8C66',
};

function endpointId(value: string | NativeNode): string {
  return typeof value === 'string' ? value : value.id;
}

function shortNodeLabel(node: GraphProjectionV1['nodes'][number]): string {
  const properties = node.properties || {};
  const semantic = String(properties.display_label || node.label || node.title || node.type || 'record').trim();
  return semantic.split(/\s+/).slice(0, 3).join(' ');
}

export function NativeGraphProjectionSurface({
  projection,
  status,
  error,
  authority = 'thinkgraph',
  onExpand,
  onUseAsContext,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  authority?: GraphAuthority;
  onExpand?: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const adjacencyRef = useRef(new Map<string, Set<string>>());
  const nodeObjectsRef = useRef(new Map<string, NativeNode>());
  const linkObjectsRef = useRef(new Map<string, NativeLink>());
  const appliedTopologyRef = useRef('');
  const appliedNodeIdsRef = useRef(new Set<string>());
  const appliedForceSettingsRef = useRef('');
  const initialFitRef = useRef(false);
  const initialFitTimerRef = useRef<number | null>(null);
  const [hideIsolated, setHideIsolated] = useState(true);
  const [showLinkLabels, setShowLinkLabels] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<NativeNode | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [settings, setSettings] = useState({
    font: 10,
    labelDensity: 8,
    size: 5,
    linkWidth: 1,
    repel: 120,
    linkDistance: 30,
    gravity: 14,
  });

  selectedRef.current = selected?.id || null;

  const nativeData = useMemo(() => {
    const nodes = projection?.nodes ?? [];
    const edges = projection?.edges ?? [];
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    }
    const nodeDescriptions: NativeNode[] = nodes
      .map((node) => ({
        id: node.id,
        canonicalId: String(node.canonicalId || node.id),
        label: shortNodeLabel(node),
        fullLabel: String(node.label || node.title || node.id),
        etype: node.type || 'person_or_concept',
        authority: String(node.authority || projection?.authority || authority),
        currentState: node.currentState,
        trustState: node.trustState,
        qualityState: node.qualityState,
        codeGraphRef: node.codeGraphRef,
        knowGraphRef: node.knowGraphRef,
        provenance: node.provenance || {},
        degree: degree.get(node.id) || 0,
        val: 1 + (degree.get(node.id) || 0),
        properties: node.properties || {},
        attentionActorCardId: typeof node.properties?.attentionActorCardId === 'string'
          ? node.properties.attentionActorCardId
          : undefined,
        attentionActorColor: typeof node.properties?.attentionActorColor === 'string'
          ? node.properties.attentionActorColor
          : undefined,
        attentionToolName: typeof node.properties?.attentionToolName === 'string'
          ? node.properties.attentionToolName
          : undefined,
        attentionActive: node.properties?.attentionActive === true,
        source: ['user', 'assistant', 'reasoning', 'tool'].includes(String(node.properties?.source))
          ? node.properties?.source as NativeNode['source']
          : undefined,
        transient: node.properties?.transient === true,
        presentationLayer: typeof node.properties?.presentationLayer === 'string'
          ? node.properties.presentationLayer
          : undefined,
      }))
      .filter((node) => !hideIsolated || node.degree > 0 || node.transient || node.attentionActive);
    const ids = new Set(nodeDescriptions.map((node) => node.id));
    const linkDescriptions: NativeLink[] = edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.predicate,
        transient: edge.properties?.persisted === false,
        attentionActorColor: typeof edge.properties?.attentionActorColor === 'string'
          ? edge.properties.attentionActorColor
          : undefined,
      }));

    const nextNodes = new Map<string, NativeNode>();
    const visibleNodes = nodeDescriptions.map((description) => {
      const existing = nodeObjectsRef.current.get(description.id);
      if (!existing) {
        nextNodes.set(description.id, description);
        return description;
      }
      Object.assign(existing, description);
      nextNodes.set(existing.id, existing);
      return existing;
    });
    nodeObjectsRef.current = nextNodes;

    const nextLinks = new Map<string, NativeLink>();
    const links = linkDescriptions.map((description) => {
      const existing = linkObjectsRef.current.get(description.id);
      if (!existing) {
        nextLinks.set(description.id, description);
        return description;
      }
      if (endpointId(existing.source) !== description.source) existing.source = description.source;
      if (endpointId(existing.target) !== description.target) existing.target = description.target;
      existing.label = description.label;
      existing.transient = description.transient;
      existing.attentionActorColor = description.attentionActorColor;
      nextLinks.set(existing.id, existing);
      return existing;
    });
    linkObjectsRef.current = nextLinks;
    return {
      nodes: visibleNodes,
      links,
      topology: `${visibleNodes.map((node) => node.id).sort().join('|')}::${links
        .map((link) => `${link.id}:${endpointId(link.source)}>${endpointId(link.target)}`)
        .sort()
        .join('|')}`,
    };
  }, [authority, hideIsolated, projection]);

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
    if (!hostRef.current || graphRef.current) return;
    const graph = new ForceGraph(hostRef.current)
      .backgroundColor('rgba(0,0,0,0)')
      .cooldownTime(900)
      .warmupTicks(20)
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
    graphRef.current = graph;
    const resize = new ResizeObserver(([entry]) => {
      graph.width(entry.contentRect.width).height(entry.contentRect.height);
    });
    resize.observe(hostRef.current);
    return () => {
      resize.disconnect();
      if (initialFitTimerRef.current != null) {
        window.clearTimeout(initialFitTimerRef.current);
        initialFitTimerRef.current = null;
      }
      graph._destructor?.();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const labelRank = new Map(
      [...nativeData.nodes]
        .sort((a, b) => b.degree - a.degree)
        .map((node, index) => [node.id, index]),
    );
    const hasTransient = nativeData.nodes.some((node) => node.transient);
    graph
      .nodeCanvasObject((node: NativeNode, context: CanvasRenderingContext2D) => {
        const focused = hoveredRef.current || selectedRef.current;
        const neighbors = focused ? adjacencyRef.current.get(focused) : null;
        const connectedFocus = Boolean(focused && neighbors && neighbors.size > 1);
        const isNeighbor = !connectedFocus || node.id === focused || neighbors?.has(node.id);
        const radius = Math.max(1.2, settings.size * Math.sqrt(node.val) * 0.45);
        const attentionAlpha = node.transient
          ? node.currentState === 'settled' ? 0.48 : 1
          : hasTransient ? 0.2 : 1;
        context.globalAlpha = attentionAlpha * (isNeighbor ? 1 : 0.12);
        context.beginPath();
        context.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        context.fillStyle = node.attentionActorColor
          || (node.transient && node.source
          ? LIVE_SOURCE_COLORS[node.source]
          : TYPE_COLORS[node.etype] || DEFAULT_TYPE_COLOR);
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
        const defaultAlpha = link.transient ? 0.68 : hasTransient ? 0.1 : Math.min(0.72, 0.16 + 0.18 * settings.linkWidth);
        const alpha = focused ? (connected ? 0.92 : 0.05) : defaultAlpha;
        return link.attentionActorColor
          ? link.attentionActorColor
          : link.transient
          ? `rgba(145,211,209,${alpha})`
          : `rgba(112,154,160,${alpha})`;
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
          if (
            node.x == null
            || (!emphasized && !node.transient && (labelRank.get(node.id) ?? Number.MAX_SAFE_INTEGER) >= cap)
          ) continue;
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
          context.globalAlpha = node.transient
            ? node.currentState === 'settled' ? 0.58 : 1
            : hasTransient ? 0.28 : 1;
          context.fillStyle = node.attentionActorColor
            || (node.transient && node.source
            ? LIVE_SOURCE_COLORS[node.source]
            : '#d8d8e2');
          context.fillText(node.label, node.x, y);
          context.globalAlpha = 1;
        }
      });
    graph.d3Force('charge').strength(-settings.repel);
    graph.d3Force('link').distance(settings.linkDistance);
    graph.d3Force('x', forceX(0).strength(settings.gravity / 100));
    graph.d3Force('y', forceY(0).strength(settings.gravity / 100));
    graph.d3Force('collide', forceCollide((node: NativeNode) => Math.max(2, settings.size * Math.sqrt(node.val) * 0.45) + 1.5));
    const nextNodeIds = new Set(nativeData.nodes.map((node) => node.id));
    const topologyChanged = appliedTopologyRef.current !== nativeData.topology;
    const topologyAdded = nativeData.nodes.some((node) => !appliedNodeIdsRef.current.has(node.id));
    const forceSettings = [settings.size, settings.repel, settings.linkDistance, settings.gravity].join(':');
    const forceSettingsChanged = Boolean(
      appliedForceSettingsRef.current
      && appliedForceSettingsRef.current !== forceSettings,
    );
    if (topologyChanged) {
      graph.graphData({ nodes: nativeData.nodes, links: nativeData.links });
      appliedTopologyRef.current = nativeData.topology;
      appliedNodeIdsRef.current = nextNodeIds;
    } else {
      graph.refresh?.();
    }
    appliedForceSettingsRef.current = forceSettings;
    if (topologyAdded || forceSettingsChanged) {
      graph.cooldownTime(900);
      graph.d3ReheatSimulation();
    }
    if (!initialFitRef.current && nativeData.nodes.length > 0) {
      initialFitRef.current = true;
      initialFitTimerRef.current = window.setTimeout(() => {
        graph.zoomToFit(320, 60);
        initialFitTimerRef.current = null;
      }, 180);
    }
  }, [adjacency, nativeData, settings, showLinkLabels]);

  useEffect(() => {
    if (!selected || nativeData.nodes.some((node) => node.id === selected.id)) return;
    setSelected(null);
    setInspectorOpen(false);
  }, [nativeData.nodes, selected]);

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
  const surfaceLabel = authority === 'knowgraph' ? 'KnowGraph' : 'ThinkGraph';
  return (
    <div data-testid={`native-${authority}-surface`} className="engraphis-native-graph">
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
        {status === 'ready' && allNodes === 0 ? <div className="engraphis-native-empty">No {surfaceLabel} data viewed in this attention scope yet.</div> : null}
      </div>
      <RightGlassDrawer
        isOpen={inspectorOpen}
        title={`${surfaceLabel} Inspector`}
        onClose={() => setInspectorOpen(false)}
        onOpen={() => setInspectorOpen(true)}
        collapsedLabel={null}
        openAriaLabel={`Open ${surfaceLabel} Inspector`}
        defaultWidth={340}
        minWidth={320}
        maxWidth={520}
        storageKey={`liquidaity.drawer.${authority}.width`}
        top={48}
        right={12}
        bottom={12}
        zIndex={6}
      >
      <div className="engraphis-native-controls">
        {selected ? <section data-testid={`${authority}-node-inspector`}><h3>Identity</h3><h4>{selected.fullLabel}</h4><p>{selected.authority} · {selected.etype} · {selected.degree} connections</p><p>{selected.canonicalId}{selected.currentState ? ` · ${selected.currentState}` : ''}{selected.trustState ? ` · ${selected.trustState}` : ''}{selected.qualityState ? ` · ${selected.qualityState}` : ''}</p>{selected.codeGraphRef ? <p>CodeGraph: {selected.codeGraphRef}</p> : null}{selected.knowGraphRef ? <p>KnowGraph: {selected.knowGraphRef}</p> : null}</section> : null}
        {selected?.attentionActorCardId ? <section><h3>Attention</h3><p><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6, background: selected.attentionActorColor || DEFAULT_TYPE_COLOR }} />{selected.attentionActorCardId}</p><p>{selected.attentionToolName}</p>{onExpand ? <button disabled={expanding} onClick={() => {
          const native = projection?.nodes.find((node) => node.id === selected.id);
          if (!native) return;
          setExpanding(true);
          void onExpand(native).finally(() => setExpanding(false));
        }}>{expanding ? 'Expanding…' : `Expand from native ${surfaceLabel}`}</button> : null}{onUseAsContext ? <button onClick={() => {
          const native = projection?.nodes.find((node) => node.id === selected.id);
          if (native) onUseAsContext(native);
        }}>Attach native reference to Main</button> : null}</section> : null}
        <section>
          <h3>Controls</h3>
          <div className="engraphis-native-actions">
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
        {selected && Object.keys(selected.provenance).length > 0 ? <section><h3>Provenance</h3><pre>{JSON.stringify(selected.provenance, null, 2)}</pre></section> : null}
        {selected ? <section><h3>Technical details</h3><pre>{JSON.stringify(selected.properties, null, 2)}</pre></section> : null}
      </div>
      </RightGlassDrawer>
    </div>
  );
}
