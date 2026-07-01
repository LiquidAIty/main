// One shared Sigma.js + Graphology graph explorer for LiquidAIty. It renders one or more real source
// graphs on ONE canvas with one camera / selection / Inspector / search:
//   • KnowGraph — the Neo4j evidence lens (/api/knowgraph/explore): exact focus, expand, provenance,
//     RDW/RWE contradiction, EDGAR navigation.
//   • ThinkGraph — a FAITHFUL read of the Apache AGE graph thinkgraph_liq: real stored node labels,
//     real stored edge types, real stored properties. No inference, no renaming.
// Each node/edge keeps its source identity (ownerGraph). No cross-graph edge is ever invented.

import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';

import type { GraphView, GraphViewEdge, GraphViewNode, GraphFocusRef } from './graphViewAdapter';
import { findSearchMatch, focusRefOf } from './graphViewAdapter';
import { graphSelection, useGraphSelection } from './graphSelectionStore';
import { edgeColor, edgeLabel, edgeSize, nodeBorder, nodeFill, nodeLabel, nodeSize } from './graphVisualGrammar';

/** A real source graph the user can enable on the shared canvas — exact names, never renamed. */
export type GraphSource = { id: 'knowgraph' | 'thinkgraph' | 'codegraph' | 'skillgraph'; name: 'KnowGraph' | 'ThinkGraph' | 'CodeGraph' | 'SkillGraph'; enabled: boolean; available: boolean; nodeCount: number; reason?: string };

type Props = {
  view: GraphView;
  height?: number;
  sources?: GraphSource[];
  onToggleSource?: (id: GraphSource['id']) => void;
  onSelectNode?: (node: GraphViewNode | null) => void;
  onSelectEdge?: (edge: GraphViewEdge | null) => void;
  /** KnowGraph exact focus (server). Only fires for KnowGraph nodes; ThinkGraph re-centers locally. */
  onRefocusNode?: (ref: GraphFocusRef) => void;
  /** KnowGraph expand-one-hop (server). Only fires for KnowGraph nodes. */
  onExpandNode?: (ref: GraphFocusRef) => void;
  /** KnowGraph search escalation to the server lens by label. */
  onFocusSearch?: (query: string) => void;
};

const SOURCE_ACCENT: Record<GraphSource['id'], string> = { knowgraph: '#2dd4bf', thinkgraph: '#f0c674', codegraph: '#58a6ff', skillgraph: '#bc8cff' };

/** Append an alpha byte to a #rrggbb color so dimmed elements recede without disappearing. */
function withAlpha(color: string, alpha: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}${alpha}`;
  if (/^#[0-9a-f]{8}$/i.test(color)) return `${color.slice(0, 7)}${alpha}`;
  return color;
}

export default function GraphExplorerCore({ view, height = 560, sources, onToggleSource, onSelectNode, onSelectEdge, onRefocusNode, onExpandNode, onFocusSearch }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const nodeIndex = useRef<Map<string, GraphViewNode>>(new Map());
  const edgeIndex = useRef<Map<string, GraphViewEdge>>(new Map());
  const focusNeighbors = useRef<Set<string>>(new Set());
  const selection = useGraphSelection();
  const [searchText, setSearchText] = useState('');
  // Raw visibility filters — exact node labels / edge types only. They hide visibility, never mutate
  // or reinterpret stored data, and there is no inferred analysis.
  const [hiddenLabels, setHiddenLabels] = useState<Set<string>>(new Set());
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Actual counts of the real node labels / edge types currently loaded.
  const nodeLabelCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of view.nodes) m.set(n.semanticKind, (m.get(n.semanticKind) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [view]);
  const edgeTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of view.edges) m.set(e.predicate, (m.get(e.predicate) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [view]);

  // The visible graph = the loaded view minus the labels/edge-types the user hid.
  const gview = useMemo<GraphView>(() => {
    if (hiddenLabels.size === 0 && hiddenEdgeTypes.size === 0) return view;
    const nodes = view.nodes.filter((n) => !hiddenLabels.has(n.semanticKind));
    const keep = new Set(nodes.map((n) => n.id));
    const edges = view.edges.filter((e) => keep.has(e.source) && keep.has(e.target) && !hiddenEdgeTypes.has(e.predicate));
    return { ...view, nodes, edges };
  }, [view, hiddenLabels, hiddenEdgeTypes]);

  const focusId = view.focus?.id ?? null;
  const filtersActive = hiddenLabels.size > 0 || hiddenEdgeTypes.size > 0;

  const centerOnNode = (id: string, ratio = 0.55) => {
    const r = sigmaRef.current;
    if (!r) return;
    const pos = r.getNodeDisplayData(id);
    if (pos) r.getCamera().animate({ x: pos.x, y: pos.y, ratio: Math.min(r.getCamera().ratio, ratio) }, { duration: 300 });
  };
  const fitNeighborhood = () => { try { sigmaRef.current?.getCamera().animatedReset(); } catch { /* killed */ } };

  // Build the graphology graph + Sigma instance whenever the (filtered) view changes.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({ multi: true, type: 'directed' });
    nodeIndex.current = new Map(gview.nodes.map((n) => [n.id, n]));
    edgeIndex.current = new Map(gview.edges.map((e) => [e.id, e]));

    for (const n of gview.nodes) {
      if (graph.hasNode(n.id)) continue;
      graph.addNode(n.id, {
        x: Math.random(), y: Math.random(),
        size: nodeSize(n, focusId === n.id),
        label: nodeLabel(n),
        color: nodeFill(n),
        borderColor: nodeBorder(n),
      });
    }
    for (const e of gview.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      try {
        graph.addDirectedEdgeWithKey(e.id, e.source, e.target, { label: edgeLabel(e), color: edgeColor(e), size: edgeSize(e), type: 'arrow' });
      } catch { /* duplicate edge id — skip */ }
    }

    focusNeighbors.current = new Set();
    if (focusId && graph.hasNode(focusId)) {
      graph.forEachNeighbor(focusId, (nb) => focusNeighbors.current.add(nb));
      focusNeighbors.current.add(focusId);
    }
    const sel0 = graphSelection.get();
    if (sel0.selectedNodeId && !graph.hasNode(sel0.selectedNodeId)) graphSelection.selectNode(null);
    if (sel0.selectedEdgeId && !graph.hasEdge(sel0.selectedEdgeId)) graphSelection.selectEdge(null);

    if (graph.order > 0) {
      forceAtlas2.assign(graph, { iterations: 240, settings: { gravity: 1.1, scalingRatio: 16, slowDown: 3, barnesHutOptimize: graph.order > 60 } });
    }

    const renderer = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderLabels: true, renderEdgeLabels: true,
      labelColor: { color: '#e3f1fb' }, labelSize: 12, labelWeight: '600',
      edgeLabelColor: { color: '#b7cdda' }, edgeLabelSize: 10,
      defaultEdgeType: 'arrow',
      labelRenderedSizeThreshold: 6, labelDensity: 0.7, labelGridCellSize: 70,
    });
    sigmaRef.current = renderer;
    const fit = () => { try { renderer.resize(); renderer.refresh(); } catch { /* killed */ } };
    requestAnimationFrame(fit);
    const fitTimer = window.setTimeout(fit, 300);

    renderer.setSetting('nodeReducer', (id, data) => {
      const res: any = { ...data };
      const sel = graphSelection.get();
      const isFocus = focusId === id;
      const isSel = sel.selectedNodeId === id;
      const isHover = sel.hoverNodeId === id;
      const isPinned = sel.pinnedNodeIds.includes(id);
      const g = renderer.getGraph();
      const neighborOfSel = sel.selectedNodeId ? (isSel || g.areNeighbors(sel.selectedNodeId, id)) : false;
      const neighborOfHover = sel.hoverNodeId ? (isHover || g.areNeighbors(sel.hoverNodeId, id)) : false;
      if (sel.selectedNodeId && !neighborOfSel) { res.color = withAlpha(String(data.color || '#9fb4c4'), '33'); res.label = ''; } else { res.label = data.label; }
      const priority = isFocus || isSel || isHover || isPinned || neighborOfSel || neighborOfHover || (!sel.selectedNodeId && focusNeighbors.current.has(id));
      if (priority && res.label !== '') res.forceLabel = true;
      if (isSel || isHover || isFocus) { res.size = (data.size || 8) + 3; res.zIndex = 2; }
      if (isSel || isPinned) res.highlighted = true;
      return res;
    });

    renderer.setSetting('edgeReducer', (id, data) => {
      const res: any = { ...data };
      const sel = graphSelection.get();
      const edge = edgeIndex.current.get(id);
      const g = renderer.getGraph();
      const s = g.source(id); const t = g.target(id);
      const incidentToSel = sel.selectedNodeId ? (s === sel.selectedNodeId || t === sel.selectedNodeId) : false;
      const incidentToHover = sel.hoverNodeId ? (s === sel.hoverNodeId || t === sel.hoverNodeId) : false;
      const incidentToFocus = focusId ? (s === focusId || t === focusId) : false;
      const isSelEdge = sel.selectedEdgeId === id;
      const isContradiction = String(edge?.predicate || '').toUpperCase() === 'CONTRADICTS' || Boolean(edge?.statusCounts?.contradicted);
      const noSelection = !sel.selectedNodeId && !sel.selectedEdgeId;
      if (isSelEdge) { res.color = '#ffffff'; res.size = (data.size || 1) + 1.5; res.label = data.label; res.forceLabel = true; res.zIndex = 2; }
      else if (incidentToSel || incidentToHover) { res.color = data.color; res.label = data.label; res.forceLabel = true; }
      else if (noSelection && incidentToFocus) { res.color = data.color; res.label = isContradiction ? data.label : ''; if (isContradiction) res.forceLabel = true; }
      else { res.color = withAlpha(String(data.color || '#566677'), '14'); res.label = ''; }
      return res;
    });

    renderer.on('clickNode', ({ node }) => { graphSelection.selectNode(node); centerOnNode(node); onSelectNode?.(nodeIndex.current.get(node) ?? null); });
    renderer.on('doubleClickNode', ({ node, event }) => {
      event.preventSigmaDefault();
      const n = nodeIndex.current.get(node);
      if (!n) return;
      // KnowGraph re-centers via the server lens (exact id). ThinkGraph is already fully loaded → local center.
      if (n.ownerGraph === 'know') onRefocusNode?.(focusRefOf(n)); else centerOnNode(node, 0.45);
    });
    renderer.on('clickEdge', ({ edge }) => { graphSelection.selectEdge(edge); onSelectEdge?.(edgeIndex.current.get(edge) ?? null); });
    renderer.on('clickStage', () => { graphSelection.selectNode(null); graphSelection.selectEdge(null); onSelectNode?.(null); onSelectEdge?.(null); });
    renderer.on('enterNode', ({ node }) => graphSelection.setHover(node));
    renderer.on('leaveNode', () => graphSelection.setHover(null));

    return () => { window.clearTimeout(fitTimer); renderer.kill(); sigmaRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gview]);

  useEffect(() => { sigmaRef.current?.refresh(); }, [selection]);

  // Apply a Harness graph_focus directive: center the camera on the requested ref if it is loaded
  // in the current view. Selection is already set by the store; this only moves the camera.
  useEffect(() => {
    const id = selection.focusRequest?.id;
    if (id && sigmaRef.current?.getGraph().hasNode(id)) centerOnNode(id, 0.45);
  }, [selection.focusRequest?.nonce]);

  const hovered = selection.hoverNodeId ? nodeIndex.current.get(selection.hoverNodeId) : null;
  const selectedNode = selection.selectedNodeId ? nodeIndex.current.get(selection.selectedNodeId) ?? null : null;
  const selectedEdge = selection.selectedEdgeId ? edgeIndex.current.get(selection.selectedEdgeId) ?? null : null;
  const edgeEndpointLabel = (id: string) => nodeIndex.current.get(id)?.displayLabel ?? id;

  const runSearch = () => {
    const q = searchText.trim();
    if (!q) return;
    const match = findSearchMatch(view.nodes, q);
    if (match) { graphSelection.selectNode(match.id); centerOnNode(match.id); onSelectNode?.(match); }
    else { onFocusSearch?.(q); }
  };
  const toggleLabel = (label: string) => setHiddenLabels((prev) => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });
  const toggleEdgeType = (t: string) => setHiddenEdgeTypes((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      {/* Search + fit + raw visibility filters. Sits below the surface kind-selector (top-left);
          the composite source rail + on-canvas counts are removed (one graph per surface). */}
      <div style={{ position: 'absolute', top: 48, left: 10, zIndex: 5, display: 'flex', gap: 6 }}>
        <input value={searchText} onChange={(e) => setSearchText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
          placeholder="Find by id / label" style={{ fontSize: 12, padding: '5px 9px', borderRadius: 7, width: 200, border: '1px solid #33414f', background: 'rgba(13,18,32,0.85)', color: '#e3f1fb', outline: 'none' }} />
        <button type="button" onClick={runSearch} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', border: '1px solid #33414f', background: 'rgba(13,18,32,0.7)', color: '#cfe8f5' }}>Find</button>
        <button type="button" title="Fit the graph" onClick={fitNeighborhood} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', border: '1px solid #33414f', background: 'rgba(13,18,32,0.7)', color: '#cfe8f5' }}>Fit</button>
        <button type="button" onClick={() => setShowFilters((v) => !v)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${filtersActive ? '#2dd4bf' : '#33414f'}`, background: showFilters ? 'rgba(45,212,191,0.14)' : 'rgba(13,18,32,0.7)', color: '#cfe8f5' }}>Filters{filtersActive ? ' •' : ''}</button>
      </div>

      {/* Raw filters — exact node labels + edge types with actual counts. Visibility only. */}
      {showFilters ? (
        <div style={{ position: 'absolute', top: 84, left: 10, zIndex: 6, width: 272, maxHeight: height - 110, overflowY: 'auto', fontSize: 12, padding: '11px 12px', borderRadius: 10, background: 'rgba(11,16,28,0.96)', border: '1px solid #33414f', color: '#cfe8f5' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b>Filters</b>
            <button type="button" onClick={() => { setHiddenLabels(new Set()); setHiddenEdgeTypes(new Set()); }} disabled={!filtersActive}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: filtersActive ? 'pointer' : 'default', border: '1px solid #33414f', background: 'transparent', color: filtersActive ? '#cfe8f5' : '#566677' }}>Show all</button>
          </div>
          <div style={{ color: '#6f8696', fontSize: 11, marginBottom: 4 }}>Node labels</div>
          <div style={{ display: 'grid', gap: 4, marginBottom: 9 }}>
            {nodeLabelCounts.map(([label, n]) => {
              const on = !hiddenLabels.has(label);
              return (
                <button key={label} type="button" onClick={() => toggleLabel(label)}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? '#33414f' : '#2a3744'}`, background: on ? 'rgba(255,255,255,0.04)' : 'transparent', color: on ? '#cfe8f5' : '#66788c' }}>
                  <span>{label}</span><span>{n}</span>
                </button>
              );
            })}
          </div>
          {edgeTypeCounts.length ? <div style={{ color: '#6f8696', fontSize: 11, marginBottom: 4 }}>Edge types</div> : null}
          <div style={{ display: 'grid', gap: 4 }}>
            {edgeTypeCounts.map(([t, n]) => {
              const on = !hiddenEdgeTypes.has(t);
              return (
                <button key={t} type="button" onClick={() => toggleEdgeType(t)}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? '#33414f' : '#2a3744'}`, background: on ? 'rgba(255,255,255,0.04)' : 'transparent', color: on ? '#cfe8f5' : '#66788c' }}>
                  <span>{t}</span><span>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Inspector — KnowGraph provenance OR ThinkGraph raw stored properties. Never invented. */}
      {selectedNode || selectedEdge ? (
        <div style={{ position: 'absolute', top: 84, right: 12, zIndex: 6, width: 300, maxHeight: height - 110, overflowY: 'auto', fontSize: 12, padding: '12px 13px', borderRadius: 10, background: 'rgba(11,16,28,0.95)', border: '1px solid #33414f', color: '#cfe8f5', boxShadow: '0 6px 22px rgba(0,0,0,0.45)' }}>
          {selectedNode ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e3f1fb', marginBottom: 2 }}>{selectedNode.displayLabel}</div>
              <div style={{ color: '#8fb3c8' }}>{selectedNode.semanticKind}{selectedNode.ownerGraph === 'think' ? ' · thinkgraph_liq' : selectedNode.ownerGraph === 'know' ? ' · KnowGraph' : ''}</div>
              {selectedNode.ownerGraph === 'know' ? (
                <>
                  <div style={{ marginTop: 8, color: '#9fd8c8' }}>{String((selectedNode.provenance as any)?.why || 'Connected in the evidence neighborhood')}</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 12, color: '#8fb3c8' }}>
                    <span>deg {selectedNode.degree ?? 0}</span>
                    {selectedNode.evidenceCount ? <span>{selectedNode.evidenceCount} evidence</span> : null}
                    {selectedNode.sourceCount ? <span>{selectedNode.sourceCount} sources</span> : null}
                  </div>
                  {selectedNode.statusSummary && Object.keys(selectedNode.statusSummary).length ? (
                    <div style={{ marginTop: 6, color: '#8fb3c8' }}>status: {Object.entries(selectedNode.statusSummary).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
                  ) : null}
                  <InspectorIdList title="Graph IDs" ids={selectedNode.rawIds} />
                  <InspectorIdList title="Assertion IDs" ids={selectedNode.evidenceIds} />
                  <InspectorIdList title="Source IDs" ids={selectedNode.sourceIds} />
                  <div style={{ marginTop: 11, display: 'flex', gap: 7 }}>
                    <button type="button" onClick={() => onExpandNode?.(focusRefOf(selectedNode))} style={{ fontSize: 11.5, padding: '5px 9px', borderRadius: 7, cursor: 'pointer', border: '1px solid #33414f', background: 'rgba(45,212,191,0.12)', color: '#a9ecdf' }}>Expand one hop +</button>
                    <button type="button" onClick={() => onRefocusNode?.(focusRefOf(selectedNode))} style={{ fontSize: 11.5, padding: '5px 9px', borderRadius: 7, cursor: 'pointer', border: '1px solid #33414f', background: 'rgba(13,18,32,0.7)', color: '#cfe8f5' }}>Focus here</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginTop: 6, color: '#8fb3c8' }}>deg {selectedNode.degree ?? 0}</div>
                  <PropertyList title="Stored properties" props={selectedNode.provenance as Record<string, unknown>} />
                </>
              )}
            </>
          ) : selectedEdge ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e3f1fb', marginBottom: 2 }}>{edgeEndpointLabel(selectedEdge.source)} → {edgeEndpointLabel(selectedEdge.target)}</div>
              <div style={{ color: '#8fb3c8' }}>{selectedEdge.predicate}{selectedEdge.ownerGraph === 'think' ? ' · thinkgraph_liq' : ''}</div>
              {selectedEdge.ownerGraph === 'know' ? (
                <>
                  {selectedEdge.statusCounts && Object.keys(selectedEdge.statusCounts).length ? (
                    <div style={{ marginTop: 8, color: '#8fb3c8' }}>status: {Object.entries(selectedEdge.statusCounts).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
                  ) : null}
                  <div style={{ marginTop: 6, color: '#8fb3c8' }}>{(selectedEdge.evidenceIds?.length ?? 0)} evidence · weight {selectedEdge.weight ?? 1}</div>
                  <InspectorIdList title="Assertion IDs" ids={selectedEdge.evidenceIds} />
                  <InspectorIdList title="Source IDs" ids={selectedEdge.sourceIds} />
                </>
              ) : (
                <PropertyList title="Stored edge properties" props={selectedEdge.properties} />
              )}
            </>
          ) : null}
        </div>
      ) : null}

      {hovered && !selectedNode && !selectedEdge ? (
        <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 5, maxWidth: 360, fontSize: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(13,18,32,0.92)', border: '1px solid #33414f', color: '#cfe8f5', pointerEvents: 'none' }}>
          <b>{hovered.displayLabel}</b> · {hovered.semanticKind}
        </div>
      ) : null}

      {gview.nodes.length === 0 ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8fb3c8', fontSize: 13 }}>
          {view.availability.map((a) => a.reason).join(' · ') || 'No graph data for this project yet.'}
        </div>
      ) : null}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden' }} />
    </div>
  );
}

/** Compact, scrollable id list for the Inspector — real ids, copy-selectable, never a JSON blob. */
function InspectorIdList({ title, ids }: { title: string; ids?: string[] }) {
  if (!ids || ids.length === 0) return null;
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ color: '#6f8696', fontSize: 11, marginBottom: 3 }}>{title} ({ids.length})</div>
      <div style={{ display: 'grid', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
        {ids.slice(0, 20).map((id) => (
          <code key={id} style={{ fontSize: 10.5, color: '#9fb8c8', background: 'rgba(255,255,255,0.04)', padding: '2px 5px', borderRadius: 4, wordBreak: 'break-all' }}>{id}</code>
        ))}
        {ids.length > 20 ? <div style={{ color: '#6f8696', fontSize: 10.5 }}>+{ids.length - 20} more</div> : null}
      </div>
    </div>
  );
}

/** Raw stored property list — shows the ACTUAL stored key/values, never an inferred meaning. */
function PropertyList({ title, props }: { title: string; props?: Record<string, unknown> }) {
  const entries = props ? Object.entries(props).filter(([k]) => k !== 'why') : [];
  if (entries.length === 0) return <div style={{ marginTop: 9, color: '#6f8696', fontSize: 11 }}>{title}: (none)</div>;
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ color: '#6f8696', fontSize: 11, marginBottom: 3 }}>{title} ({entries.length})</div>
      <div style={{ display: 'grid', gap: 3, maxHeight: 260, overflowY: 'auto' }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ fontSize: 10.5, lineHeight: 1.35 }}>
            <span style={{ color: '#7fa6bd' }}>{k}</span>{': '}
            <span style={{ color: '#cfe8f5', wordBreak: 'break-all' }}>{typeof v === 'string' ? v : JSON.stringify(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
