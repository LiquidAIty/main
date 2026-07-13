import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import cytoscape from 'cytoscape';
import type {
  Core,
  ElementDefinition,
  LayoutOptions,
  StylesheetJson,
} from 'cytoscape';
import fcose from 'cytoscape-fcose';

import {
  getGraphMajorGridGap,
  GRAPH_WORKSPACE,
} from '../graph/graphWorkspaceContract';
import { GRAPH_THEME } from '../graph/graphVisualTokens';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import type { HermesReportReference, HermesReportView } from './hermesReportView';

// Cytoscape fit padding is PIXELS (the shared nav token is a fraction for
// other renderers), and fit alone has no zoom ceiling — small graphs blow up.
const FIT_PADDING_PX = 48;
const SETTLE_MAX_ZOOM = 1;

// Capped logarithmic node-size mapping: real mentionCount drives size, but
// growth flattens out so no single noun's bubble can dominate the canvas.
const MENTION_LOG_CAP = 6; // mentionCount ~63 already reaches full size
const NODE_MIN_PX = 18;
const NODE_MAX_PX = 40;

let fcoseRegistered = false;

function ensureFcoseRegistered() {
  if (fcoseRegistered) return;
  cytoscape.use(fcose);
  fcoseRegistered = true;
}

// One graph model: nouns (nodes) and verb-phrase relationships (edges). No
// kind/tag/class vocabulary, no visual-class translation layer. The ONLY
// signal beyond raw content is mention-count-driven size — mechanical, from
// a real returned integer, never inferred from labels or predicate text.
export type GraphProjectionV1 = {
  schemaVersion: string;
  projectId: string;
  nodes: Array<{
    id: string;
    label: string;
    title?: string;
    type?: string;
    labels?: string[];
    mentionCount: number;
    lastMentionedAt?: string;
    properties?: Record<string, unknown>;
    provenanceCount?: number;
    // Stored write provenance (conversation / card / run correlation) exactly
    // as persisted by the canonical writer — absent when the store has none.
    conversationId?: string;
    cardId?: string;
    correlationId?: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    predicate: string;
    mentionCount: number;
    lastMentionedAt?: string;
    properties?: Record<string, unknown>;
    provenanceCount?: number;
  }>;
};

type KnowledgeGraphFrameworkProps = {
  projection?: GraphProjectionV1;
  minHeight?: number;
  /** Existing Inspector default content when no graph node is selected. */
  activeHermesReport?: HermesReportView | null;
  focusedNodeId?: string | null;
  onNodeSelectionChange?: (nodeId: string | null) => void;
  onHermesReportReference?: (reference: HermesReportReference) => void;
};

type SkippedEdge = { id: string; source: string; target: string; reason: string };

function cappedLogMentions(mentionCount: number): number {
  const safe = Number.isFinite(mentionCount) && mentionCount > 0 ? mentionCount : 0;
  return Math.min(Math.log2(safe + 1), MENTION_LOG_CAP);
}

function projectionToElements(projection: GraphProjectionV1 | null | undefined): {
  elements: ElementDefinition[];
  skippedEdges: SkippedEdge[];
} {
  if (!projection) {
    return { elements: [], skippedEdges: [] };
  }

  const nodeIds = new Set(projection.nodes.map((node) => node.id));

  // The ONLY allowed exclusion: an edge whose endpoint is absent from the same
  // returned projection. It is skipped with an exact reported reason — never
  // silently, never replaced with a fake edge.
  const skippedEdges: SkippedEdge[] = [];
  const survivingEdges: GraphProjectionV1['edges'] = [];
  for (const edge of projection.edges) {
    const missing = !nodeIds.has(edge.source)
      ? `source "${edge.source}" not in returned node set`
      : !nodeIds.has(edge.target)
        ? `target "${edge.target}" not in returned node set`
        : null;
    if (missing) {
      skippedEdges.push({ id: edge.id, source: edge.source, target: edge.target, reason: missing });
      continue;
    }
    survivingEdges.push(edge);
  }

  const nodes: ElementDefinition[] = projection.nodes.map((node) => ({
    group: 'nodes',
    data: {
      id: node.id,
      label: node.label,
      title: node.title,
      type: node.type,
      labels: node.labels,
      mentionCount: node.mentionCount,
      logMentions: cappedLogMentions(node.mentionCount),
      lastMentionedAt: node.lastMentionedAt,
      properties: node.properties,
      provenanceCount: node.provenanceCount,
    },
  }));

  const edges: ElementDefinition[] = survivingEdges.map((edge) => ({
    group: 'edges',
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      predicate: edge.predicate,
      mentionCount: edge.mentionCount,
      lastMentionedAt: edge.lastMentionedAt,
      properties: edge.properties,
      provenanceCount: edge.provenanceCount,
    },
  }));

  return { elements: [...nodes, ...edges], skippedEdges };
}

// Presentation only. Every noun is the same round liquid-glass bubble, every
// verb phrase is the same labeled line — no per-entity/category/question/
// property visual distinction. The only visual signal is mechanical bubble
// size from a capped-log mapping over the real returned mentionCount.
const cytoscapeStyle: StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'ellipse',
      'background-color': '#101820',
      'background-opacity': 0.88,
      width: `mapData(logMentions, 0, ${MENTION_LOG_CAP}, ${NODE_MIN_PX}, ${NODE_MAX_PX})`,
      height: `mapData(logMentions, 0, ${MENTION_LOG_CAP}, ${NODE_MIN_PX}, ${NODE_MAX_PX})`,
      'border-color': 'rgba(96, 214, 210, 0.75)',
      'border-width': 1.4,
      'underlay-color': GRAPH_THEME.accent.primary,
      'underlay-opacity': 0.12,
      'underlay-padding': 7,
      label: 'data(label)',
      color: GRAPH_THEME.surface.text,
      'font-size': 10.5,
      'text-outline-color': 'rgba(11, 14, 18, 0.95)',
      'text-outline-width': 2,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 7,
      // ponytail: truncate to one line so a paragraph-length label (e.g. a verbose
      // RunRecord summary) can't leak a tall text block out of the node. Full text
      // belongs in the node inspector drawer, not the canvas label.
      'text-wrap': 'ellipsis',
      'text-max-width': '150px',
      'min-zoomed-font-size': 8,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.8,
      'line-color': GRAPH_THEME.accent.primary,
      'target-arrow-color': GRAPH_THEME.accent.primary,
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      'curve-style': 'bezier',
      opacity: 0.75,
      label: 'data(predicate)',
      color: GRAPH_THEME.surface.mutedText,
      'font-size': 8,
      'text-rotation': 'none',
      'text-wrap': 'wrap',
      'text-max-width': '140px',
      'text-background-color': '#0B0E12',
      'text-background-opacity': 0.85,
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
      // Selection reveals the full returned label (wrap, wider) — same string.
      'text-wrap': 'wrap',
      'text-max-width': '280px',
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': GRAPH_THEME.edge.selected,
      'target-arrow-color': GRAPH_THEME.edge.selected,
      width: 2.6,
      opacity: 1,
    },
  },
  // Presentation-only dimming for unrelated rendered elements on selection.
  {
    selector: '.kgf-dim',
    style: {
      opacity: 0.14,
      'text-opacity': 0.08,
    },
  },
];

// Human-readable summary rows for the node drawer: real stored properties only,
// short strings/numbers, skipping raw identity keys. Leads with meaning, not ids.
function readableNodeSummary(node: GraphProjectionV1['nodes'][number]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const props = (node.properties ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'id' || key === 'project_id' || key === 'projectId') continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) out.push([key, trimmed.length > 320 ? `${trimmed.slice(0, 317)}…` : trimmed]);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out.push([key, String(value)]);
    }
  }
  return out.slice(0, 8);
}

export default function KnowledgeGraphFramework({
  projection,
  minHeight = 360,
  activeHermesReport = null,
  focusedNodeId = null,
  onNodeSelectionChange,
  onHermesReportReference,
}: KnowledgeGraphFrameworkProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [reportDismissed, setReportDismissed] = useState(false);
  const [hoveredNav, setHoveredNav] = useState<string | null>(null);
  // Fingerprint of the last applied element content: an identical projection
  // (even as a new object) must never rerun layout or churn elements.
  const appliedFingerprintRef = useRef<string | null>(null);
  const { elements, skippedEdges } = useMemo(
    () => projectionToElements(projection),
    [projection],
  );
  const selectedNode = useMemo(
    () => projection?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [projection, selectedNodeId],
  );
  const selectedNodeEdgeCount = useMemo(
    () =>
      selectedNode
        ? projection?.edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id).length ?? 0
        : 0,
    [projection, selectedNode],
  );
  const reportVisible = Boolean(activeHermesReport && !selectedNode && !reportDismissed);

  useEffect(() => {
    setReportDismissed(false);
  }, [activeHermesReport?.reportId]);

  useEffect(() => {
    if (!focusedNodeId || !projection?.nodes.some((node) => node.id === focusedNodeId)) return;
    setSelectedNodeId(focusedNodeId);
    setReportDismissed(false);
    onNodeSelectionChange?.(focusedNodeId);
    const cy = cyRef.current;
    const node = cy?.getElementById(focusedNodeId);
    if (!cy || !node || node.length === 0) return;
    const neighborhood = node.closedNeighborhood();
    cy.batch(() => {
      cy.elements().removeClass('kgf-dim');
      cy.elements().difference(neighborhood).addClass('kgf-dim');
    });
  }, [focusedNodeId, onNodeSelectionChange, projection]);
  useEffect(() => {
    ensureFcoseRegistered();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!cyRef.current) {
      const cyInstance = cytoscape({
        container,
        elements: [],
        style: cytoscapeStyle,
        minZoom: GRAPH_THEME.nav.minZoom,
        maxZoom: GRAPH_THEME.nav.maxZoom,
        wheelSensitivity: GRAPH_THEME.nav.wheelDelta,
        boxSelectionEnabled: false,
        autoungrabify: false,
      });
      // Selection display only, from the already-rendered real element set:
      // node tap highlights its immediate Cytoscape neighborhood, edge tap
      // highlights the edge + its endpoints, blank tap clears. No semantic
      // computation, no data mutation, no panels.
      cyInstance.on('tap', 'node', (event) => {
        const neighborhood = event.target.closedNeighborhood();
        const data = event.target.data() as { id?: unknown };
        const nodeId = typeof data.id === 'string' ? data.id : null;
        setSelectedNodeId(nodeId);
        setReportDismissed(false);
        onNodeSelectionChange?.(nodeId);
        cyInstance.batch(() => {
          cyInstance.elements().removeClass('kgf-dim');
          cyInstance.elements().difference(neighborhood).addClass('kgf-dim');
        });
      });
      cyInstance.on('tap', 'edge', (event) => {
        const scope = event.target.union(event.target.connectedNodes());
        cyInstance.batch(() => {
          cyInstance.elements().removeClass('kgf-dim');
          cyInstance.elements().difference(scope).addClass('kgf-dim');
        });
      });
      cyInstance.on('tap', (event) => {
        if (event.target !== cyInstance) return;
        setSelectedNodeId(null);
        onNodeSelectionChange?.(null);
        cyInstance.batch(() => cyInstance.elements().removeClass('kgf-dim'));
      });
      // Force-directed feel on interaction: releasing a dragged node re-runs an
      // INCREMENTAL fcose pass (randomize:false keeps every other node near its
      // position), so the graph settles around the moved node like a live
      // physics simulation instead of leaving a torn layout.
      cyInstance.on('dragfree', 'node', () => {
        if (cyInstance.elements().length === 0) return;
        cyInstance
          .layout({
            name: 'fcose',
            animate: true,
            randomize: false,
            fit: false,
            animationDuration: 450,
          } as LayoutOptions)
          .run();
      });
      cyRef.current = cyInstance;
    }

    const cy = cyRef.current;
    const fingerprint = JSON.stringify(elements);
    if (fingerprint === appliedFingerprintRef.current) return;
    appliedFingerprintRef.current = fingerprint;

    if (skippedEdges.length > 0) {
      // Exact honest report — never silent, never replaced with fake edges.
      console.warn('[thinkgraph-graph] skipped edges (endpoint missing from projection):', skippedEdges);
    }

    // Diff instead of rebuild: elements that survive a refresh keep their
    // current positions, so a real graph write moves only what changed.
    cy.batch(() => {
      const nextIds = new Set(elements.map((el) => String(el.data.id)));
      cy.elements().forEach((el) => {
        if (!nextIds.has(el.id())) el.remove();
      });
      elements.forEach((el) => {
        const existing = cy.getElementById(String(el.data.id));
        if (existing.length > 0) {
          existing.data(el.data);
        } else {
          cy.add(el);
        }
      });
    });
    if (cy.elements().length === 0) {
      return;
    }
    // fCoSE force simulation with knowledge-graph-scale physics: stronger
    // repulsion + degree-independent ideal edge length spreads hub-and-spoke
    // clusters instead of collapsing them into a blob. After settling, clamp
    // the fit zoom so a small graph composes calmly.
    const settle = () => {
      cy.fit(undefined, FIT_PADDING_PX);
      if (cy.zoom() > SETTLE_MAX_ZOOM) {
        cy.zoom(SETTLE_MAX_ZOOM);
        cy.center();
      }
    };
    const layout: LayoutOptions = {
      name: 'fcose',
      animate: true,
      fit: true,
      padding: FIT_PADDING_PX,
      quality: 'proof',
      nodeRepulsion: 9000,
      idealEdgeLength: 90,
      edgeElasticity: 0.45,
      gravity: 0.25,
      numIter: 2500,
      stop: settle,
    } as LayoutOptions;
    cy.layout(layout).run();
  }, [elements, onNodeSelectionChange, skippedEdges]);

  useEffect(() => {
    const container = containerRef.current;
    const cy = cyRef.current;
    if (!container || !cy) return;
    const observer = new ResizeObserver(() => {
      cy.resize();
      if (cy.elements().length > 0) {
        cy.fit(undefined, FIT_PADDING_PX);
        if (cy.zoom() > SETTLE_MAX_ZOOM) {
          cy.zoom(SETTLE_MAX_ZOOM);
          cy.center();
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
      // The fingerprint belongs to the destroyed instance — reset it so a
      // remount (StrictMode double-mount, HMR) reapplies elements to the new one.
      appliedFingerprintRef.current = null;
    };
  }, []);

  const majorGridGap = getGraphMajorGridGap();
  const graphPaperStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
    backgroundImage: [
      `linear-gradient(to right, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to right, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
      `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
    ].join(', '),
    backgroundSize: [
      `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
      `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
      `${majorGridGap}px ${majorGridGap}px`,
      `${majorGridGap}px ${majorGridGap}px`,
    ].join(', '),
  };
  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
    cy.zoom({ level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };
  const fitGraph = () => {
    const cy = cyRef.current;
    if (cy && cy.elements().length > 0) cy.fit(undefined, 42);
  };
  const centerGraph = () => {
    const cy = cyRef.current;
    if (cy) cy.center();
  };
  const navButtons: Array<{ key: string; glyph: string; title: string; onClick: () => void }> = [
    { key: 'in', glyph: '+', title: 'Zoom in', onClick: () => zoomBy(1.2) },
    { key: 'out', glyph: '−', title: 'Zoom out', onClick: () => zoomBy(1 / 1.2) },
    { key: 'fit', glyph: '⤢', title: 'Fit graph to view', onClick: fitGraph },
    { key: 'center', glyph: '◉', title: 'Center view', onClick: centerGraph },
  ];
  const navButtonStyle = (active: boolean): CSSProperties => ({
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    border: `1px solid ${active ? GRAPH_THEME.accent.primary : GRAPH_THEME.drawer.sectionBorder}`,
    background: active ? 'rgba(45, 212, 191, 0.12)' : 'rgba(11, 14, 18, 0.72)',
    color: active ? GRAPH_THEME.accent.primary : GRAPH_THEME.surface.mutedText,
    fontSize: 14,
    lineHeight: 1,
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'border-color 120ms ease, color 120ms ease, background 120ms ease',
  });
  return (
    <div
      data-testid="knowledge-graph-framework"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight,
        overflow: 'hidden',
        background: GRAPH_THEME.background.knowledgeSurface,
      }}
    >
      <div aria-hidden="true" style={graphPaperStyle} />
      <div
        ref={containerRef}
        data-testid="cytoscape-graph"
        data-node-count={projection?.nodes?.length ?? 0}
        data-edge-count={projection?.edges?.length ?? 0}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
        }}
      />
      <div
        data-testid="knowledge-graph-nav-controls"
        style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        {navButtons.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-label={b.title}
            title={b.title}
            onClick={b.onClick}
            onMouseEnter={() => setHoveredNav(b.key)}
            onMouseLeave={() => setHoveredNav((k) => (k === b.key ? null : k))}
            style={navButtonStyle(hoveredNav === b.key)}
          >
            {b.glyph}
          </button>
        ))}
      </div>
      <RightGlassDrawer
        isOpen={Boolean(selectedNode || reportVisible)}
        title={selectedNode ? selectedNode.title || selectedNode.label || 'Node' : 'Hermes report'}
        onClose={() => {
          if (selectedNode) {
            setSelectedNodeId(null);
            onNodeSelectionChange?.(null);
          } else {
            setReportDismissed(true);
          }
          const cy = cyRef.current;
          if (cy) cy.batch(() => cy.elements().removeClass('kgf-dim'));
        }}
        dataTestId="knowledge-graph-node-drawer"
        storageKey="liquidaity.drawer.knowledge-node.width"
        defaultWidth={340}
        minWidth={280}
        maxWidth={520}
        top={44}
      >
        {selectedNode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
            <div>
              <div style={{ color: GRAPH_THEME.surface.text, fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                {selectedNode.title || selectedNode.label}
              </div>
              {selectedNode.type || (selectedNode.labels?.length ?? 0) > 0 ? (
                <div style={{ color: GRAPH_THEME.accent.primary, fontSize: 11, letterSpacing: '0.04em' }}>
                  {selectedNode.type || (selectedNode.labels ?? []).join(', ')}
                </div>
              ) : null}
            </div>
            {readableNodeSummary(selectedNode).map(([k, v]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                <span style={{ color: GRAPH_THEME.surface.mutedText }}>{k}</span>
                <span style={{ color: GRAPH_THEME.surface.text, overflowWrap: 'anywhere' }}>{v}</span>
              </div>
            ))}
            <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 11 }}>
              {selectedNodeEdgeCount} connected {selectedNodeEdgeCount === 1 ? 'edge' : 'edges'}
            </div>
            <details>
              <summary style={{ cursor: 'pointer', color: GRAPH_THEME.surface.mutedText, fontSize: 11 }}>
                Technical details
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 8px', margin: '6px 0 0', fontSize: 11, color: GRAPH_THEME.surface.mutedText }}>
                <span>id</span>
                <span style={{ overflowWrap: 'anywhere' }}>{selectedNode.id}</span>
                {selectedNode.cardId ? <span>written by</span> : null}
                {selectedNode.cardId ? <span style={{ overflowWrap: 'anywhere' }}>{selectedNode.cardId}</span> : null}
                {selectedNode.correlationId ? <span>run</span> : null}
                {selectedNode.correlationId ? <span style={{ overflowWrap: 'anywhere' }}>{selectedNode.correlationId}</span> : null}
              </div>
            </details>
          </div>
        ) : reportVisible && activeHermesReport ? (
          <div data-testid="knowledge-graph-hermes-report" style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
            <div>
              <div style={{ color: GRAPH_THEME.surface.text, fontWeight: 700, fontSize: 13, marginBottom: 3 }}>
                {activeHermesReport.summary}
              </div>
              <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 11 }}>
                {activeHermesReport.reportId} · revision {activeHermesReport.revision} · {activeHermesReport.updatedAt}
              </div>
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: GRAPH_THEME.surface.text, fontFamily: 'inherit', lineHeight: 1.5 }}>
              {activeHermesReport.reportMarkdown}
            </pre>
            <div style={{ borderTop: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`, paddingTop: 10 }}>
              <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 11, marginBottom: 6 }}>Linked graph context</div>
              {([
                ['thinkgraph', activeHermesReport.linkedThinkGraphNodeIds],
                ['knowgraph', activeHermesReport.linkedKnowGraphRefs],
                ['codegraph', activeHermesReport.linkedCodeGraphRefs],
              ] as const).map(([authority, references]) => references.length > 0 ? (
                <div key={authority} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  <span style={{ color: GRAPH_THEME.accent.primary, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{authority}</span>
                  {references.map((id) => (
                    <button
                      key={`${authority}:${id}`}
                      type="button"
                      data-testid={`hermes-report-reference-${authority}-${id}`}
                      onClick={() => onHermesReportReference?.({ authority, id })}
                      style={{ textAlign: 'left', border: 0, background: 'transparent', padding: 0, color: GRAPH_THEME.surface.text, cursor: 'pointer', overflowWrap: 'anywhere' }}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              ) : null)}
              {activeHermesReport.linkedThinkGraphNodeIds.length === 0 && activeHermesReport.linkedKnowGraphRefs.length === 0 && activeHermesReport.linkedCodeGraphRefs.length === 0 ? (
                <span style={{ color: GRAPH_THEME.surface.mutedText }}>No linked graph records were returned.</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </RightGlassDrawer>
    </div>
  );
}
