import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions, StylesheetJson } from 'cytoscape';
import fcose from 'cytoscape-fcose';

import { getGraphMajorGridGap, GRAPH_WORKSPACE } from '../graph/graphWorkspaceContract';
import {
  GRAPH_THEME,
  graphInspectorPanelStyle,
} from '../graph/graphVisualTokens';
import type { HermesReportReference, HermesReportView } from './hermesReportView';
import GlassInspectorSection from '../graph/GlassInspectorSection';

const FIT_PADDING_PX = 48;
const SETTLE_MAX_ZOOM = 1;
const MENTION_LOG_CAP = 6;
let fcoseRegistered = false;

function ensureFcoseRegistered() {
  if (fcoseRegistered) return;
  cytoscape.use(fcose);
  fcoseRegistered = true;
}

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
  promptRef?: string;
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

type KnowledgeGraphFrameworkProps = {
  projection?: GraphProjectionV1;
  minHeight?: number;
  activeHermesReport?: HermesReportView | null;
  focusedNodeId?: string | null;
  onNodeSelectionChange?: (nodeId: string | null) => void;
  onHermesReportReference?: (reference: HermesReportReference) => void;
  showInspector?: boolean;
};

type SkippedEdge = { id: string; source: string; target: string; reason: string };

function cappedLogMentions(mentionCount: number): number {
  const safe = Number.isFinite(mentionCount) && mentionCount > 0 ? mentionCount : 0;
  return Math.min(Math.log2(safe + 1), MENTION_LOG_CAP);
}

function projectionToElements(projection?: GraphProjectionV1): {
  elements: ElementDefinition[];
  skippedEdges: SkippedEdge[];
} {
  if (!projection) return { elements: [], skippedEdges: [] };
  const nodeIds = new Set(projection.nodes.map((node) => node.id));
  const skippedEdges: SkippedEdge[] = [];
  const edges = projection.edges.filter((edge) => {
    const missing = !nodeIds.has(edge.source)
      ? `source "${edge.source}" not in returned node set`
      : !nodeIds.has(edge.target)
        ? `target "${edge.target}" not in returned node set`
        : null;
    if (missing) {
      skippedEdges.push({ id: edge.id, source: edge.source, target: edge.target, reason: missing });
      return false;
    }
    return true;
  });
  return {
    elements: [
      ...projection.nodes.map((node) => ({
        group: 'nodes' as const,
        data: { ...node, logMentions: cappedLogMentions(node.mentionCount) },
      })),
      ...edges.map((edge) => ({ group: 'edges' as const, data: edge })),
    ],
    skippedEdges,
  };
}

function buildCytoscapeStyle(args: {
  showLinkLabels: boolean;
  textSize: number;
  labelDensity: number;
  nodeScale: number;
  linkWidth: number;
}): StylesheetJson {
  const nodeMin = Math.round(16 * args.nodeScale);
  const nodeMax = Math.round(42 * args.nodeScale);
  return [
    {
      selector: 'node',
      style: {
        shape: 'ellipse',
        'background-color': '#101820',
        'background-opacity': 0.88,
        width: `mapData(logMentions, 0, ${MENTION_LOG_CAP}, ${nodeMin}, ${nodeMax})`,
        height: `mapData(logMentions, 0, ${MENTION_LOG_CAP}, ${nodeMin}, ${nodeMax})`,
        'border-color': 'rgba(96, 214, 210, 0.75)',
        'border-width': 1.4,
        'underlay-color': GRAPH_THEME.accent.primary,
        'underlay-opacity': 0.12,
        'underlay-padding': 7,
        label: 'data(label)',
        color: GRAPH_THEME.surface.text,
        'font-size': args.textSize,
        'text-outline-color': 'rgba(11, 14, 18, 0.95)',
        'text-outline-width': 2,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 7,
        'text-wrap': 'ellipsis',
        'text-max-width': `${Math.round(80 + args.labelDensity * 100)}px`,
        'min-zoomed-font-size': Math.max(5, 11 - args.labelDensity * 3),
      },
    },
    {
      selector: 'edge',
      style: {
        width: args.linkWidth,
        'line-color': GRAPH_THEME.accent.primary,
        'target-arrow-color': GRAPH_THEME.accent.primary,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        opacity: 0.7,
        label: args.showLinkLabels ? 'data(predicate)' : '',
        color: GRAPH_THEME.surface.mutedText,
        'font-size': Math.max(7, args.textSize - 2),
        'text-rotation': 'none',
        'text-wrap': 'wrap',
        'text-max-width': '140px',
        'text-background-color': '#0B0E12',
        'text-background-opacity': args.showLinkLabels ? 0.85 : 0,
        'text-background-shape': 'roundrectangle',
        'text-background-padding': '2px',
        'min-zoomed-font-size': 7,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-color': GRAPH_THEME.surface.text,
        'border-width': 2.4,
        'text-wrap': 'wrap',
        'text-max-width': '280px',
      },
    },
    {
      selector: 'edge:selected',
      style: {
        'line-color': GRAPH_THEME.edge.selected,
        'target-arrow-color': GRAPH_THEME.edge.selected,
        width: args.linkWidth + 1,
        opacity: 1,
      },
    },
    {
      selector: '.kgf-dim',
      style: { opacity: 0.14, 'text-opacity': 0.08 },
    },
  ];
}

const InspectorSection = GlassInspectorSection;

function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === undefined || children === null || children === '') return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '108px minmax(0, 1fr)', gap: 10 }}>
      <span style={{ color: GRAPH_THEME.surface.mutedText }}>{label}</span>
      <span style={{ color: GRAPH_THEME.surface.text, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

function propertiesRows(properties?: Record<string, unknown>) {
  if (!properties) return [];
  return Object.entries(properties).filter(([, value]) =>
    ['string', 'number', 'boolean'].includes(typeof value),
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '92px 1fr', alignItems: 'center', gap: 8 }}>
      <span style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 11 }}>{label}</span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: '100%', accentColor: GRAPH_THEME.accent.primary }}
      />
    </label>
  );
}

export default function KnowledgeGraphFramework({
  projection,
  minHeight = 360,
  activeHermesReport = null,
  focusedNodeId = null,
  onNodeSelectionChange,
  onHermesReportReference,
  showInspector = true,
}: KnowledgeGraphFrameworkProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const appliedFingerprintRef = useRef<string | null>(null);
  const controlsMountedRef = useRef(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideUnconnected, setHideUnconnected] = useState(true);
  const [showLinkLabels, setShowLinkLabels] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('current');
  const [goalFilter, setGoalFilter] = useState('all');
  const [textSize, setTextSize] = useState(10);
  const [labelDensity, setLabelDensity] = useState(0.6);
  const [nodeScale, setNodeScale] = useState(1);
  const [linkWidth, setLinkWidth] = useState(1.6);
  const [repelForce, setRepelForce] = useState(9000);
  const [linkDistance, setLinkDistance] = useState(90);
  const [centerGravity, setCenterGravity] = useState(0.25);

  const degree = useMemo(() => {
    const out = new Map<string, number>();
    for (const edge of projection?.edges ?? []) {
      out.set(edge.source, (out.get(edge.source) ?? 0) + 1);
      out.set(edge.target, (out.get(edge.target) ?? 0) + 1);
    }
    return out;
  }, [projection]);
  const types = useMemo(
    () => [...new Set((projection?.nodes ?? []).map((node) => node.type).filter(Boolean) as string[])].sort(),
    [projection],
  );
  const goals = useMemo(
    () => (projection?.nodes ?? []).filter((node) => node.type === 'Goal'),
    [projection],
  );
  const filteredProjection = useMemo<GraphProjectionV1 | undefined>(() => {
    if (!projection) return undefined;
    const needle = search.trim().toLowerCase();
    let allowed = new Set(
      projection.nodes
        .filter((node) => !needle || `${node.id} ${node.label} ${node.type ?? ''}`.toLowerCase().includes(needle))
        .filter((node) => !hideUnconnected || (degree.get(node.id) ?? node.degree ?? 0) > 0)
        .filter((node) => typeFilter === 'all' || node.type === typeFilter)
        .filter((node) =>
          stateFilter === 'all'
          || (stateFilter === 'historical' ? node.currentState === 'historical' : node.currentState !== 'historical'),
        )
        .map((node) => node.id),
    );
    if (goalFilter !== 'all') {
      const goalIds = new Set([goalFilter]);
      for (const edge of projection.edges) {
        if (edge.source === goalFilter) goalIds.add(edge.target);
        if (edge.target === goalFilter) goalIds.add(edge.source);
      }
      allowed = new Set([...allowed].filter((id) => goalIds.has(id)));
    }
    const nodes = projection.nodes.filter((node) => allowed.has(node.id));
    const edges = projection.edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
    return { ...projection, nodes, edges };
  }, [degree, goalFilter, hideUnconnected, projection, search, stateFilter, typeFilter]);
  const { elements, skippedEdges } = useMemo(
    () => projectionToElements(filteredProjection),
    [filteredProjection],
  );
  const selectedNode = useMemo(
    () => filteredProjection?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [filteredProjection, selectedNodeId],
  );
  const outgoing = useMemo(
    () => (projection?.edges ?? []).filter((edge) => edge.source === selectedNode?.id),
    [projection, selectedNode],
  );
  const incoming = useMemo(
    () => (projection?.edges ?? []).filter((edge) => edge.target === selectedNode?.id),
    [projection, selectedNode],
  );
  const connectedGoal = useMemo(() => {
    if (!selectedNode || !projection) return null;
    if (selectedNode.type === 'Goal') return selectedNode;
    if (selectedNode.goalId) return projection.nodes.find((node) => node.id === selectedNode.goalId) ?? null;
    const neighborIds = new Set([...outgoing.map((edge) => edge.target), ...incoming.map((edge) => edge.source)]);
    return projection.nodes.find((node) => node.type === 'Goal' && neighborIds.has(node.id)) ?? null;
  }, [incoming, outgoing, projection, selectedNode]);
  const selectedHermesContext = useMemo(
    () => selectedNode && activeHermesReport?.linkedThinkGraphNodeIds.includes(selectedNode.id)
      ? activeHermesReport
      : null,
    [activeHermesReport, selectedNode],
  );
  const topConnected = useMemo(
    () => [...(projection?.nodes ?? [])]
      .sort((a, b) => (degree.get(b.id) ?? b.degree ?? 0) - (degree.get(a.id) ?? a.degree ?? 0))
      .slice(0, 8),
    [degree, projection],
  );

  useEffect(() => {
    if (selectedNodeId && !filteredProjection?.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
      onNodeSelectionChange?.(null);
      cyRef.current?.elements().removeClass('kgf-dim');
    }
  }, [filteredProjection, onNodeSelectionChange, selectedNodeId]);

  useEffect(() => {
    if (!focusedNodeId || !filteredProjection?.nodes.some((node) => node.id === focusedNodeId)) return;
    setSelectedNodeId(focusedNodeId);
    onNodeSelectionChange?.(focusedNodeId);
    const cy = cyRef.current;
    const node = cy?.getElementById(focusedNodeId);
    if (!cy || !node || node.length === 0) return;
    const neighborhood = node.closedNeighborhood();
    cy.batch(() => {
      cy.elements().removeClass('kgf-dim');
      cy.elements().difference(neighborhood).addClass('kgf-dim');
    });
  }, [filteredProjection, focusedNodeId, onNodeSelectionChange]);

  useEffect(() => {
    ensureFcoseRegistered();
  }, []);

  const layoutOptions = (randomize: boolean): LayoutOptions => ({
    name: 'fcose',
    animate: true,
    randomize,
    fit: !randomize,
    padding: FIT_PADDING_PX,
    quality: 'proof',
    nodeRepulsion: repelForce,
    idealEdgeLength: linkDistance,
    edgeElasticity: 0.45,
    gravity: centerGravity,
    numIter: 2500,
  } as LayoutOptions);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!cyRef.current) {
      const cy = cytoscape({
        container,
        elements: [],
        style: buildCytoscapeStyle({ showLinkLabels, textSize, labelDensity, nodeScale, linkWidth }),
        minZoom: GRAPH_THEME.nav.minZoom,
        maxZoom: GRAPH_THEME.nav.maxZoom,
        wheelSensitivity: GRAPH_THEME.nav.wheelDelta,
        boxSelectionEnabled: false,
      });
      cy.on('tap', 'node', (event) => {
        const data = event.target.data() as { id?: unknown };
        const nodeId = typeof data.id === 'string' ? data.id : '';
        setSelectedNodeId(nodeId || null);
        onNodeSelectionChange?.(nodeId || null);
        const neighborhood = event.target.closedNeighborhood();
        cy.batch(() => {
          cy.elements().removeClass('kgf-dim');
          cy.elements().difference(neighborhood).addClass('kgf-dim');
        });
      });
      cy.on('tap', 'edge', (event) => {
        const scope = event.target.union(event.target.connectedNodes());
        cy.batch(() => {
          cy.elements().removeClass('kgf-dim');
          cy.elements().difference(scope).addClass('kgf-dim');
        });
      });
      cy.on('tap', (event) => {
        if (event.target !== cy) return;
        setSelectedNodeId(null);
        onNodeSelectionChange?.(null);
        cy.batch(() => cy.elements().removeClass('kgf-dim'));
      });
      cy.on('dragfree', 'node', () => {
        if (cy.elements().length > 0) cy.layout(layoutOptions(false)).run();
      });
      cyRef.current = cy;
    }
    const cy = cyRef.current;
    const fingerprint = JSON.stringify(elements);
    if (fingerprint === appliedFingerprintRef.current) return;
    appliedFingerprintRef.current = fingerprint;
    if (skippedEdges.length > 0) {
      console.warn('[thinkgraph-graph] skipped edges (endpoint missing from projection):', skippedEdges);
    }
    cy.batch(() => {
      const nextIds = new Set(elements.map((element) => String(element.data.id)));
      cy.elements().forEach((element) => {
        if (!nextIds.has(element.id())) element.remove();
      });
      for (const element of elements) {
        const existing = cy.getElementById(String(element.data.id));
        if (existing.length > 0) existing.data(element.data);
        else cy.add(element);
      }
    });
    if (cy.elements().length > 0) cy.layout(layoutOptions(false)).run();
  }, [elements, onNodeSelectionChange, skippedEdges]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!controlsMountedRef.current) {
      controlsMountedRef.current = true;
      return;
    }
    (cy as any).style(buildCytoscapeStyle({ showLinkLabels, textSize, labelDensity, nodeScale, linkWidth }));
    if (cy.elements().length > 0) cy.layout(layoutOptions(false)).run();
  }, [centerGravity, labelDensity, linkDistance, linkWidth, nodeScale, repelForce, showLinkLabels, textSize]);

  useEffect(() => {
    const container = containerRef.current;
    const cy = cyRef.current;
    if (!container || !cy) return;
    const observer = new ResizeObserver(() => {
      cy.resize();
      if (cy.elements().length > 0) cy.fit(undefined, FIT_PADDING_PX);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    cyRef.current?.destroy();
    cyRef.current = null;
    appliedFingerprintRef.current = null;
    controlsMountedRef.current = false;
  }, []);

  const majorGridGap = getGraphMajorGridGap();
  const graphPaperStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    backgroundImage: [
      `linear-gradient(to right, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to right, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
    ].join(','),
    backgroundSize: [
      `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
      `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
      `${majorGridGap}px ${majorGridGap}px`,
      `${majorGridGap}px ${majorGridGap}px`,
    ].join(','),
  };
  const buttonStyle: CSSProperties = {
    border: '1px solid rgba(126, 232, 226, 0.18)',
    borderRadius: 8,
    background: 'linear-gradient(180deg, rgba(34,49,58,0.54), rgba(14,22,28,0.38))',
    color: GRAPH_THEME.surface.text,
    minHeight: 28,
    padding: '4px 9px',
    cursor: 'pointer',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
  };
  const inputStyle: CSSProperties = {
    ...buttonStyle,
    width: '100%',
    cursor: 'text',
    outline: 'none',
  };
  const fitGraph = () => cyRef.current?.fit(undefined, 42);
  const reheatGraph = () => cyRef.current?.layout(layoutOptions(true)).run();

  return (
    <div
      data-testid="knowledge-graph-framework"
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        minHeight,
        overflow: 'hidden',
        background: GRAPH_THEME.background.knowledgeSurface,
      }}
    >
      <div style={{ position: 'relative', minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
        <div aria-hidden="true" style={graphPaperStyle} />
        <div
          ref={containerRef}
          data-testid="cytoscape-graph"
          data-node-count={filteredProjection?.nodes.length ?? 0}
          data-edge-count={filteredProjection?.edges.length ?? 0}
          style={{ position: 'absolute', inset: 0, zIndex: 1 }}
        />
        <div
          data-testid="knowledge-graph-nav-controls"
          style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 4, display: 'flex', gap: 4 }}
        >
          <button type="button" aria-label="Zoom in" style={buttonStyle} onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)}>+</button>
          <button type="button" aria-label="Zoom out" style={buttonStyle} onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)}>−</button>
          <button type="button" aria-label="Fit graph to view" style={buttonStyle} onClick={fitGraph}>Fit</button>
          <button type="button" aria-label="Center view" style={buttonStyle} onClick={() => cyRef.current?.center()}>Center</button>
        </div>
      </div>

      {showInspector ? <aside
        data-testid="knowledge-graph-node-drawer"
        data-open="true"
        aria-label="ThinkGraph Inspector"
        style={{
          ...graphInspectorPanelStyle(),
          position: 'relative',
          flex: '0 0 clamp(320px, 25vw, 410px)',
          width: 'clamp(320px, 25vw, 410px)',
          height: 'calc(100% - 20px)',
          margin: 10,
          marginLeft: 0,
          borderRadius: 18,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 5,
          isolation: 'isolate',
        }}
      >
        <div aria-hidden="true" style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(126,232,226,.76), rgba(255,255,255,.24), transparent)', boxShadow: '0 0 18px rgba(55,173,170,.35)' }} />
        <div style={{ padding: '14px 15px 12px', borderBottom: '1px solid rgba(126,232,226,.12)', background: 'linear-gradient(110deg, rgba(55,173,170,.09), transparent 58%)' }}>
          <div style={{ color: GRAPH_THEME.surface.text, fontWeight: 750, fontSize: 13 }}>
            {selectedNode ? selectedNode.title || selectedNode.label : 'ThinkGraph overview'}
          </div>
          <div style={{ color: GRAPH_THEME.accent.primary, fontSize: 10, marginTop: 3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {selectedNode?.type || projection?.authority || 'Engraphis v2'}
          </div>
        </div>
        <div
          style={{
            padding: 14,
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(96,214,210,.28) transparent',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            fontSize: 12,
          }}
        >
          <InspectorSection title="Graph view" signal={`${filteredProjection?.nodes.length ?? 0} nodes`}>
            <input
              aria-label="Find entity"
              placeholder="Find entity…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={inputStyle}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <button type="button" style={buttonStyle} onClick={reheatGraph}>Reheat</button>
              <button type="button" style={buttonStyle} onClick={fitGraph}>Fit</button>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => {
                  setSearch('');
                  setTypeFilter('all');
                  setStateFilter('current');
                  setGoalFilter('all');
                }}
              >
                Reset
              </button>
            </div>
            <label style={{ color: GRAPH_THEME.surface.mutedText }}>
              <input type="checkbox" checked={hideUnconnected} onChange={(event) => setHideUnconnected(event.target.checked)} /> Hide unconnected
            </label>
            <label style={{ color: GRAPH_THEME.surface.mutedText }}>
              <input type="checkbox" checked={showLinkLabels} onChange={(event) => setShowLinkLabels(event.target.checked)} /> Show relationship labels
            </label>
            <select aria-label="Record type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={inputStyle}>
              <option value="all">All record types</option>
              {types.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <select aria-label="Current or historical" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} style={inputStyle}>
              <option value="current">Current records</option>
              <option value="historical">Historical records</option>
              <option value="all">Current + historical</option>
            </select>
            <select aria-label="Goal-centered view" value={goalFilter} onChange={(event) => setGoalFilter(event.target.value)} style={inputStyle}>
              <option value="all">All Goals</option>
              {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.label.slice(0, 70)}</option>)}
            </select>
          </InspectorSection>

          <InspectorSection title="Physics & labels" defaultOpen={false}>
            <Slider label="Text size" min={8} max={16} step={1} value={textSize} onChange={setTextSize} />
            <Slider label="Label density" min={0} max={1} step={0.1} value={labelDensity} onChange={setLabelDensity} />
            <Slider label="Node size" min={0.7} max={1.7} step={0.1} value={nodeScale} onChange={setNodeScale} />
            <Slider label="Line width" min={0.5} max={4} step={0.1} value={linkWidth} onChange={setLinkWidth} />
            <Slider label="Repel force" min={2000} max={18000} step={500} value={repelForce} onChange={setRepelForce} />
            <Slider label="Link distance" min={40} max={180} step={5} value={linkDistance} onChange={setLinkDistance} />
            <Slider label="Center gravity" min={0} max={1} step={0.05} value={centerGravity} onChange={setCenterGravity} />
          </InspectorSection>

          {selectedNode ? (
            <>
              <InspectorSection title="Record identity" signal={selectedNode.currentState || 'current'}>
                <Field label="Canonical ID">{selectedNode.canonicalId || selectedNode.id}</Field>
                <Field label="Authority">{selectedNode.authority || projection?.authority}</Field>
                <Field label="Project">{selectedNode.projectId || projection?.projectId}</Field>
                <Field label="Conversation">{selectedNode.conversationId}</Field>
                <Field label="Episode">{selectedNode.episodeId}</Field>
                <Field label="Job">{selectedNode.jobId}</Field>
                <Field label="Run">{selectedNode.runId || selectedNode.correlationId}</Field>
                <Field label="State">{selectedNode.currentState}</Field>
                <Field label="Memory type">{selectedNode.memoryType}</Field>
                <Field label="Created">{selectedNode.createdAt}</Field>
                <Field label="Valid from">{selectedNode.validFrom}</Field>
                <Field label="Valid to">{selectedNode.validTo}</Field>
                <Field label="Updated">{selectedNode.updatedAt || selectedNode.lastMentionedAt}</Field>
                <Field label="Connected Goal">{connectedGoal ? connectedGoal.id : 'none in current projection'}</Field>
                <Field label="Why displayed">{selectedNode.retrievalReason}</Field>
              </InspectorSection>
              <InspectorSection title="Properties" signal={`${propertiesRows(selectedNode.properties).length}`}>
                {propertiesRows(selectedNode.properties).length > 0
                  ? propertiesRows(selectedNode.properties).map(([key, value]) => <Field key={key} label={key}>{String(value)}</Field>)
                  : <span style={{ color: GRAPH_THEME.surface.mutedText }}>No stored properties.</span>}
              </InspectorSection>
              <InspectorSection title="Relationships" signal={`${incoming.length + outgoing.length}`}>
                <Field label="Outgoing">{outgoing.length}</Field>
                {outgoing.map((edge) => <div key={edge.id} style={{ color: GRAPH_THEME.surface.text }}>{edge.predicate} → {edge.target}</div>)}
                <Field label="Incoming">{incoming.length}</Field>
                {incoming.map((edge) => <div key={edge.id} style={{ color: GRAPH_THEME.surface.text }}>{edge.source} → {edge.predicate}</div>)}
              </InspectorSection>
              <InspectorSection title="Provenance & quality" defaultOpen={false}>
                <Field label="Provenance">{selectedNode.provenance ? JSON.stringify(selectedNode.provenance) : undefined}</Field>
                <Field label="CodeGraph">{selectedNode.codeGraphRef}</Field>
                <Field label="KnowGraph">{selectedNode.knowGraphRef}</Field>
                <Field label="Artifact">{selectedNode.artifactRef}</Field>
                <Field label="Prompt">{selectedNode.promptRef}</Field>
                <Field label="Trust">{selectedNode.trustState}</Field>
                <Field label="Quality">{selectedNode.qualityState}</Field>
                <Field label="Production">{selectedNode.productionPath}</Field>
              </InspectorSection>
              {selectedHermesContext ? (
                <InspectorSection testId="knowledge-graph-hermes-context" title="Linked run provenance" defaultOpen={false}>
                  <Field label="Run artifact">{selectedHermesContext.reportId} · revision {selectedHermesContext.revision}</Field>
                  {[...selectedHermesContext.linkedKnowGraphRefs, ...selectedHermesContext.linkedCodeGraphRefs].map((id) => (
                    <button
                      key={id}
                      type="button"
                      style={{ ...buttonStyle, textAlign: 'left' }}
                      onClick={() => onHermesReportReference?.({
                        authority: selectedHermesContext.linkedKnowGraphRefs.includes(id) ? 'knowgraph' : 'codegraph',
                        id,
                      })}
                    >
                      {id}
                    </button>
                  ))}
                </InspectorSection>
              ) : null}
            </>
          ) : (
            <>
              <InspectorSection title="Scope" signal={projection?.authority || 'engraphis-v2'}>
                <Field label="Project">{projection?.projectId || 'No project selected'}</Field>
                <Field label="Authority">{projection?.authority || 'engraphis-v2'}</Field>
                <Field label="Revision">{projection?.revision}</Field>
                <Field label="Active Goal">{goals[0]?.id || 'none in current projection'}</Field>
                <Field label="Episode">{projection?.nodes.find((node) => node.episodeId)?.episodeId}</Field>
                <Field label="Records">{projection?.nodes.length ?? 0}</Field>
                <Field label="Relationships">{projection?.edges.length ?? 0}</Field>
                <Field label="Visible">{filteredProjection?.nodes.length ?? 0} / {filteredProjection?.edges.length ?? 0}</Field>
              </InspectorSection>
              <InspectorSection title="Top connected" signal={`${topConnected.length}`}>
                {topConnected.map((node, index) => (
                  <button
                    key={node.id}
                    type="button"
                    style={{ ...buttonStyle, display: 'grid', gridTemplateColumns: '18px 1fr auto', textAlign: 'left', gap: 6 }}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <span>{index + 1}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.label}</span>
                    <span>{degree.get(node.id) ?? node.degree ?? 0}</span>
                  </button>
                ))}
              </InspectorSection>
              <InspectorSection title="Current filters" defaultOpen={false}>
                <Field label="Type">{typeFilter}</Field>
                <Field label="State">{stateFilter}</Field>
                <Field label="Goal">{goalFilter}</Field>
                <Field label="Isolated">{hideUnconnected ? 'hidden' : 'shown'}</Field>
              </InspectorSection>
            </>
          )}
        </div>
      </aside> : null}
    </div>
  );
}
