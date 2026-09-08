import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph from 'force-graph';
import { forceCollide, forceX, forceY } from 'd3-force';

import type { GraphData } from '../../vendor/codebase-memory-ui/src/lib/types';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls } from '../graph/GraphCanvasChrome';
import './nativeAuthorityGraphSurface.css';

const CbmGraphTab = lazy(async () => {
  const { GraphTab } = await import('../../vendor/codebase-memory-ui/src/components/GraphTab');
  return { default: GraphTab };
});

type GraphAuthority = 'knowgraph';

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
  analysis?: {
    revision: string;
    communities: Array<{ id: string; memberCount: number; members: string[]; centralNodes: string[]; gateways: string[] }>;
    gaps: Array<{ source: string; target: string; edgeClass: 'derived'; derivedType: string; reason: string }>;
    durationMs: number;
  };
  embedding?: Record<string, unknown>;
  counts?: { nodes: number; edges: number };
  nodes: GraphProjectionNode[];
  edges: GraphProjectionEdge[];
};

export function NativeKnowGraphSurface({
  projection,
  status = 'ready',
  error,
  onExpand,
  onUseAsContext,
}: {
  projection: GraphProjectionV1;
  status?: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  onExpand: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
}) {
  return (
    <NativeGraphProjectionSurface
      projection={projection}
      status={error ? 'error' : status}
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
  Entity: '#76c8bf',
  Episodic: '#b9a2d9',
  Community: '#e1c183',
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
  return semantic.length > 38 ? `${semantic.slice(0, 37)}…` : semantic;
}

function nodeRadius(node: NativeNode, size: number) {
  return node.etype === 'Episodic' ? 2.2 : Math.max(1.8, Math.min(7, size * Math.sqrt(node.val) * 0.45));
}

function sourceDocument(node: GraphProjectionNode) {
  const properties = node.properties || {};
  let body: Record<string, unknown> = {};
  if (typeof properties.content === 'string') {
    try {
      const parsed = JSON.parse(properties.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch { /* Plain-text episodes keep their original content. */ }
  }
  const candidates = [properties, body, ...(Array.isArray(body.sources) ? body.sources : [])];
  const links = new Map<string, { url: string; label: string }>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const url = candidate.source_url || candidate.url;
    if (typeof url !== 'string') continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      links.set(url, { url, label: String(candidate.title || candidate.publisher || parsed.hostname) });
    } catch { /* Invalid URLs are not clickable citations. */ }
  }
  return { links: [...links.values()], summary: typeof body.summary === 'string' ? body.summary : null };
}

export function NativeGraphProjectionSurface({
  projection,
  status,
  error,
  authority = 'knowgraph',
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
  const [selected, setSelected] = useState<NativeNode | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [settings] = useState({
    font: 12,
    labelDensity: 8,
    size: 3,
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
      }));
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
  }, [authority, projection]);

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
        setSelectedEdgeId(null);
        setSelected(node as NativeNode);
        setInspectorOpen(true);
      })
      .onLinkClick((link) => {
        setSelected(null);
        setSelectedEdgeId(String((link as NativeLink).id));
        setInspectorOpen(true);
      })
      .onNodeHover((node) => {
        hoveredRef.current = node ? String(node.id) : null;
        if (hostRef.current) hostRef.current.style.cursor = node ? 'pointer' : 'grab';
      });
    graphRef.current = graph;
    // A replacement renderer has no data even when React preserves these refs
    // across an effect replay. Reapply topology and the initial fit to it.
    appliedTopologyRef.current = '';
    appliedNodeIdsRef.current = new Set();
    appliedForceSettingsRef.current = '';
    initialFitRef.current = false;
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
        .sort((a, b) => Number(a.etype === 'Episodic') - Number(b.etype === 'Episodic') || b.degree - a.degree)
        .map((node, index) => [node.id, index]),
    );
    const hasTransient = nativeData.nodes.some((node) => node.transient);
    graph
      .nodeCanvasObject((node: NativeNode, context: CanvasRenderingContext2D) => {
        const focused = hoveredRef.current || selectedRef.current;
        const neighbors = focused ? adjacencyRef.current.get(focused) : null;
        const connectedFocus = Boolean(focused && neighbors && neighbors.size > 1);
        const isNeighbor = !connectedFocus || node.id === focused || neighbors?.has(node.id);
        const radius = nodeRadius(node, settings.size);
        const attentionAlpha = node.transient
          ? node.currentState === 'settled' ? 0.48 : 1
          : hasTransient ? 0.2 : 1;
        context.globalAlpha = attentionAlpha * (isNeighbor ? 1 : 0.12);
        context.beginPath();
        if (node.etype === 'Episodic') {
          const x = node.x || 0, y = node.y || 0;
          context.moveTo(x, y - radius); context.lineTo(x + radius, y); context.lineTo(x, y + radius); context.lineTo(x - radius, y); context.closePath();
        } else context.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        context.fillStyle = node.attentionActorColor
          || (node.transient && node.source
          ? LIVE_SOURCE_COLORS[node.source]
          : TYPE_COLORS[node.etype] || DEFAULT_TYPE_COLOR);
        context.fill();
        context.shadowBlur = 0;
        if (connectedFocus && node.id === focused) {
          context.lineWidth = 1.6;
          context.strokeStyle = '#A9ECE8';
          context.stroke();
        }
        context.globalAlpha = 1;
      })
      .nodePointerAreaPaint((node: NativeNode, color: string, context: CanvasRenderingContext2D) => {
        const radius = Math.max(3, nodeRadius(node, settings.size)) + 2;
        context.beginPath();
        context.arc(node.x || 0, node.y || 0, radius, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
      })
      .linkColor((link: NativeLink) => {
        const focused = hoveredRef.current || selectedRef.current;
        const connected = focused && (endpointId(link.source) === focused || endpointId(link.target) === focused);
        const defaultAlpha = link.transient ? 0.68 : hasTransient ? 0.1 : link.label === 'MENTIONS' ? 0.12 : 0.45;
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
      .linkCanvasObjectMode(() => 'after')
      .linkCanvasObject((link: NativeLink, context: CanvasRenderingContext2D, scale: number) => {
        const source = link.source as NativeNode;
        const target = link.target as NativeNode;
        const focused = hoveredRef.current || selectedRef.current;
        if (!focused || (source.id !== focused && target.id !== focused) || source.x == null || target.x == null) return;
        context.font = `${11 / scale}px sans-serif`;
        context.fillStyle = '#b6d8d3';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const label = link.label.replaceAll('_', ' ').toLowerCase();
        const x = ((source.x || 0) + (target.x || 0)) / 2;
        const y = ((source.y || 0) + (target.y || 0)) / 2;
        context.lineWidth = 4 / scale;
        context.strokeStyle = '#0b0e12';
        context.strokeText(label, x, y);
        context.fillText(label, x, y);
      })
      .onRenderFramePost((context: CanvasRenderingContext2D, scale: number) => {
        const cap = nativeData.nodes.length <= 100 ? 100 : Math.round(settings.labelDensity * Math.max(1, scale));
        const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.lineJoin = 'round';
        const focused = hoveredRef.current || selectedRef.current;
        const ordered = [...graph.graphData().nodes as NativeNode[]].sort((a, b) => Number(b.id === focused) - Number(a.id === focused) || b.degree - a.degree);
        for (const node of ordered) {
          const hovered = focused;
          const emphasized = node.id === hovered || node.id === selectedRef.current;
          if (
            node.x == null
            || (!emphasized && !node.transient && (labelRank.get(node.id) ?? Number.MAX_SAFE_INTEGER) >= cap)
          ) continue;
          const neighbors = hovered ? adjacencyRef.current.get(hovered) : null;
          const connectedFocus = Boolean(hovered && neighbors && neighbors.size > 1);
          const isNeighbor = !connectedFocus || node.id === hovered || neighbors?.has(node.id);
          if (!isNeighbor) continue;
          const radius = nodeRadius(node, settings.size);
          const fontSize = settings.font / scale;
          const y = (node.y || 0) + radius + 2 / scale;
          context.font = `${fontSize}px -apple-system,Segoe UI,sans-serif`;
          const width = context.measureText(node.label).width;
          const box = { x: node.x - width / 2, y, w: width, h: fontSize + 4 / scale };
          if (!emphasized && occupied.some(other => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y)) continue;
          occupied.push(box);
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
    graph.d3Force('collide', forceCollide((node: NativeNode) => nodeRadius(node, settings.size) + 2));
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
  }, [adjacency, authority, nativeData, settings]);

  useEffect(() => {
    if (!selected || nativeData.nodes.some((node) => node.id === selected.id)) return;
    setSelected(null);
    setInspectorOpen(false);
  }, [nativeData.nodes, selected]);

  const allNodes = projection?.nodes.length ?? 0;
  const selectedEdge = projection?.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedNative = projection?.nodes.find(node => node.id === selected?.id);
  const selectedSource = selectedNative ? sourceDocument(selectedNative) : null;
  const selectedRelationships = selected ? projection?.edges.filter(edge => edge.source === selected.id || edge.target === selected.id) || [] : [];
  const evidenceIds = new Set<string>(selected ? [selected.id] : []);
  for (const edge of selectedEdge ? [selectedEdge] : selectedRelationships) {
    const episodes = edge.properties?.episodes;
    for (const id of Array.isArray(episodes) ? episodes : typeof episodes === 'string' ? [episodes] : []) evidenceIds.add(String(id));
    if (edge.predicate === 'MENTIONS') evidenceIds.add(edge.source);
  }
  const evidence = (projection?.nodes || []).filter(node => evidenceIds.has(node.id)).map(node => ({ node, ...sourceDocument(node) })).filter(item => item.links.length);
  const surfaceLabel = 'KnowGraph';
  return (
    <div data-testid={`native-${authority}-surface`} className="native-authority-graph" aria-busy={status === 'loading'}>
      <div className="native-authority-canvas">
        <div ref={hostRef} className="native-authority-network" />
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
        {status === 'error' ? <div className="native-authority-empty">Graph failed: {error}</div> : null}
        {status === 'ready' && allNodes === 0 ? <div className="native-authority-empty">No knowledge yet.</div> : null}
      </div>
      <RightGlassDrawer
        isOpen={inspectorOpen}
        title={surfaceLabel}
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
      <div className="native-authority-controls">
        {selected ? <section data-testid={`${authority}-node-inspector`} data-native-id={selected.canonicalId}>
          <h4>{selected.fullLabel}</h4>
          {typeof selected.properties.summary === 'string' ? <p>{selected.properties.summary}</p> : null}
          {selectedSource?.summary ? <p>{selectedSource.summary}</p> : null}
          {Array.isArray(selected.properties.question_links) ? selected.properties.question_links.map((encoded, index) => {
            let link: any;
            try { link = typeof encoded === 'string' ? JSON.parse(encoded) : encoded; } catch { return null; }
            return link?.questionRef?.nativeId ? <p key={index}>Question: {link.questionRef.nativeId} · {link.relation} · {String(link.outcome || '').replaceAll('_', ' ')}</p> : null;
          }) : null}
        </section> : null}
        {selectedRelationships.length ? <section className="knowgraph-relationships">{selectedRelationships.filter(edge => edge.predicate !== 'MENTIONS').map(edge => <button key={edge.id} onClick={() => { setSelected(null); setSelectedEdgeId(edge.id); }}>
          <strong>{projection?.nodes.find(node => node.id === edge.source)?.label}</strong>
          <span>{edge.predicate.replaceAll('_', ' ').toLowerCase()}</span>
          <strong>{projection?.nodes.find(node => node.id === edge.target)?.label}</strong>
        </button>)}</section> : null}
        {selectedEdge ? <section data-testid="knowgraph-edge-inspector" data-native-id={selectedEdge.id}>
          <h4>{projection?.nodes.find((node) => node.id === selectedEdge.source)?.label} → {selectedEdge.predicate} → {projection?.nodes.find((node) => node.id === selectedEdge.target)?.label}</h4>
          {typeof selectedEdge.properties?.fact === 'string' ? <p>{selectedEdge.properties.fact}</p> : null}
          {typeof selectedEdge.properties?.summary === 'string' ? <p>{selectedEdge.properties.summary}</p> : null}
        </section> : null}
        {evidence.length ? <section className="knowgraph-sources"><h4>Sources</h4>{evidence.map(({ node, links }) => <div key={node.id}><p>{node.label}</p>{links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</div>)}</section> : null}
        {selected ? <div className="native-authority-actions">{onExpand ? <button disabled={expanding} onClick={() => {
          const native = projection?.nodes.find((node) => node.id === selected.id);
          if (!native) return;
          setExpanding(true);
          void onExpand(native).finally(() => setExpanding(false));
        }}>{expanding ? 'Expanding…' : 'Expand'}</button> : null}{onUseAsContext ? <button onClick={() => {
          const native = projection?.nodes.find((node) => node.id === selected.id);
          if (native) onUseAsContext(native);
        }}>Use in chat</button> : null}</div> : null}
      </div>
      </RightGlassDrawer>
    </div>
  );
}
