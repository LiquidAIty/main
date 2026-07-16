import { useEffect, useMemo, useRef, useState } from 'react';

import { CodeGraphScene } from '../codegraph/CodeGraphScene';
import type { CodeGraphData, CodeGraphNode } from '../codegraph/types';
import GlassInspectorSection from '../graph/GlassInspectorSection';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GRAPH_THEME, graphDrawerButtonStyle, graphDrawerInputStyle, graphGlassPillStyle } from '../graph/graphVisualTokens';
import type { GraphView } from './graphView';

type Layer = 'thinkgraph' | 'knowgraph' | 'codegraph';
type Role = 'main_chat' | 'coder' | 'hermes';
type VisualMode = 'all' | 'reasoning' | 'evidence' | 'code' | 'cross' | 'neighborhood';

type UnifiedPayload = {
  schemaVersion: 'unified.context.v1';
  projectId: string;
  conversationId: string;
  receivingRole: string;
  projectionId: string;
  identity: {
    applicationProjectId: string;
    thinkGraphWorkspaceId: string;
    knowGraphScopeId: string | null;
    codeGraphProjectId: string | null;
    conversationId: string;
    activeGraphViewId: string | null;
    receivingRole: string;
    projectionId: string;
  };
  configurationHash: string;
  contentHash: string;
  activeGraphViewId?: string | null;
  graphViews: GraphView[];
  availableGraphViews: GraphView[];
  lifecycle: Record<'available' | 'selected' | 'attached' | 'delivered' | 'consumed' | 'returned' | 'superseded', string[]>;
  nodes: Array<CodeGraphNode & { source_graph?: string; epistemic_level?: string; cluster?: string; selection_state?: string }>;
  edges: CodeGraphData['edges'];
  regions: Array<{ id: Layer; label: string; color: string; z: number }>;
  counts: { available: Record<Layer, number>; selected: Record<Layer, number>; nodes: number; edges: number; crossAuthorityEdges: number };
  warnings: Array<{ authority: string; code: string; detail: string }>;
};

const EMPTY_COUNTS: Record<Layer, number> = { thinkgraph: 0, knowgraph: 0, codegraph: 0 };
const AUTHORITY_DISPLAY: Record<Layer, { x: number; y: number; z: number; spread: number; color: string; scale: number }> = {
  thinkgraph: { x: 0, y: 145, z: 90, spread: 0.34, color: '#37ADAA', scale: 1.12 },
  knowgraph: { x: -95, y: -65, z: -75, spread: 0.52, color: '#86AEB7', scale: 0.86 },
  codegraph: { x: 255, y: -35, z: 70, spread: 0.32, color: '#C7D9DD', scale: 1.55 },
};

function conciseLabel(value: string, maxWords = 6): string {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const label = words.slice(0, maxWords).join(' ');
  return words.length > maxWords ? `${label}…` : label;
}

function usefulName(node: CodeGraphNode): string | null {
  const name = node.name?.trim();
  if (!name || name === node.label || name === node.source_id) return null;
  if (node.label === 'Chunk' || name.startsWith('analysis:') || name.startsWith('kgdemo:') || name.startsWith('know:')) return null;
  return name;
}

export function unifiedSemanticLabel(node: CodeGraphNode): string {
  const properties = node.properties || {};
  for (const candidate of [properties.display_label, properties.title, properties.short_label, usefulName(node), properties.summary, properties.description]) {
    const value = textValue(candidate);
    if (value) return conciseLabel(value);
  }
  return conciseLabel(node.label || 'Record');
}

function neighborhoodFor(nodeId: number | null, edges: CodeGraphData['edges'], depth: number): Set<number> | null {
  if (nodeId === null) return null;
  const allowed = new Set([nodeId]);
  let frontier = new Set([nodeId]);
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<number>();
    edges.forEach((edge) => {
      if (frontier.has(edge.source)) next.add(edge.target);
      if (frontier.has(edge.target)) next.add(edge.source);
    });
    next.forEach((id) => allowed.add(id));
    frontier = next;
  }
  return allowed;
}

/** Projection IDENTITY the chat request may carry — the request configuration
 * plus the server-minted projectionId. Never view content: the server resolves
 * the persisted projection itself and derives the model context. */
export type UnifiedProjectionIdentity = {
  projectionId: string;
  role: Role;
  activeGraphViewId: string | null;
  expansionDepth: number;
  knowgraphScope: string | null;
};

function textValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function nodeLead(node: CodeGraphNode): string {
  for (const key of ['description', 'summary', 'text', 'decision', 'question', 'content']) {
    const value = textValue(node.properties?.[key]);
    if (value) return value;
  }
  return `${node.name} is a ${node.label} record in ${node.authority || 'unknown'}.`;
}

export default function UnifiedGraphSurface({
  projectId,
  conversationId,
  runtimeHandbacks = [],
  onProjectionChange,
  onOpenAuthority,
}: {
  projectId: string;
  conversationId: string;
  runtimeHandbacks?: GraphView[];
  onProjectionChange?: (projection: UnifiedProjectionIdentity | null) => void;
  onOpenAuthority?: (authority: Layer) => void;
}) {
  const [payload, setPayload] = useState<UnifiedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const requestGeneration = useRef(0);
  const [role, setRole] = useState<Role>('main_chat');
  const [activeViewId, setActiveViewId] = useState('');
  const [authority, setAuthority] = useState<Layer | 'all'>('all');
  const [visualMode, setVisualMode] = useState<VisualMode>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [hopDepth, setHopDepth] = useState(1);
  const [expansionDepth, setExpansionDepth] = useState(0);
  const [selected, setSelected] = useState<CodeGraphNode | null>(null);
  const [hovered, setHovered] = useState<CodeGraphNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<{ action: 'zoom_in' | 'zoom_out' | 'fit_view'; token: number }>({ action: 'fit_view', token: 0 });
  // Read once per mount: the optional KnowGraph scope override rides the URL.
  const knowgraphScope = useMemo(() => new URLSearchParams(window.location.search).get('kgScope'), []);
  // The identity of the projection currently on screen — stamped atomically
  // with its payload from the exact request configuration that produced it,
  // never recombined from later config state (a mismatched pair would fail
  // server-side hash verification).
  const [projectionIdentity, setProjectionIdentity] = useState<UnifiedProjectionIdentity | null>(null);

  useEffect(() => {
    if (!projectId) {
      setPayload(null);
      setProjectionIdentity(null);
      setError('Unified context requires a selected project.');
      return;
    }
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    const controller = new AbortController();
    const params = new URLSearchParams({ projectId, conversationId, role });
    params.set('expansionDepth', String(expansionDepth));
    if (activeViewId) params.set('activeGraphViewId', activeViewId);
    const scope = knowgraphScope;
    if (scope) params.set('knowgraphScope', scope);
    setError(null);
    setLoading(true);
    void fetch(`/api/unified/context?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.schemaVersion !== 'unified.context.v1') throw new Error(String(body?.error || `HTTP ${response.status}`));
        return body as UnifiedPayload;
      })
      .then((next) => {
        if (controller.signal.aborted || requestGeneration.current !== generation) return;
        setPayload(next);
        setProjectionIdentity({
          projectionId: next.projectionId,
          role,
          activeGraphViewId: activeViewId || null,
          expansionDepth,
          knowgraphScope,
        });
        setLoading(false);
      })
      .catch((reason) => {
        if (!controller.signal.aborted && requestGeneration.current === generation) {
          setLoading(false);
          setError(String(reason?.message || reason));
        }
      });
    return () => controller.abort();
  }, [activeViewId, conversationId, expansionDepth, projectId, refreshGeneration, role]);

  useEffect(() => {
    // Hand back projection IDENTITY only — the chat request never carries
    // view content; the server resolves the persisted projection itself.
    onProjectionChange?.(projectionIdentity);
  }, [onProjectionChange, projectionIdentity]);

  const nodeTypes = useMemo(() => [...new Set((payload?.nodes || []).map((node) => node.label))].sort(), [payload?.nodes]);
  const clusters = useMemo(() => [...new Set((payload?.nodes || []).map((node) => String(node.cluster || 'records')))].sort(), [payload?.nodes]);
  const visibleData = useMemo<CodeGraphData>(() => {
    if (!payload) return { nodes: [], edges: [], total_nodes: 0 };
    const query = search.trim().toLowerCase();
    const crossLinked = new Set(payload.edges.filter((edge) => edge.cross_authority).flatMap((edge) => [edge.source, edge.target]));
    const selectedNeighborhood = neighborhoodFor(selected?.id ?? null, payload.edges, hopDepth);
    const allowed = new Set(payload.nodes.filter((node) =>
      (authority === 'all' || node.authority === authority)
      && (visualMode === 'all'
        || (visualMode === 'reasoning' && node.authority === 'thinkgraph')
        || (visualMode === 'evidence' && node.authority === 'knowgraph')
        || (visualMode === 'code' && node.authority === 'codegraph')
        || (visualMode === 'cross' && crossLinked.has(node.id))
        || (visualMode === 'neighborhood' && Boolean(selectedNeighborhood?.has(node.id))))
      && (typeFilter === 'all' || node.label === typeFilter)
      && !collapsedClusters.has(String(node.cluster || 'records'))
      && (!query || `${unifiedSemanticLabel(node)} ${node.name} ${node.label} ${node.source_id} ${node.cluster}`.toLowerCase().includes(query)),
    ).map((node) => node.id));
    const nodes = payload.nodes.filter((node) => allowed.has(node.id));
    const ids = new Set(nodes.map((node) => node.id));
    return { nodes, edges: payload.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), total_nodes: payload.counts.nodes };
  }, [authority, collapsedClusters, hopDepth, payload, search, selected, typeFilter, visualMode]);

  const membership = useMemo(() => {
    const map = new Map<string, GraphView>();
    [...(payload?.graphViews || []), ...runtimeHandbacks].forEach((view) => view.includedCanonicalNodeIds.forEach((id) => map.set(id, view)));
    return map;
  }, [payload?.graphViews, runtimeHandbacks]);
  const sceneData = useMemo<CodeGraphData>(() => ({
    ...visibleData,
    nodes: visibleData.nodes.map((node) => {
      const view = membership.get(node.source_id || '');
      const display = AUTHORITY_DISPLAY[(node.authority as Layer) || 'knowgraph'] || AUTHORITY_DISPLAY.knowgraph;
      return {
        ...node,
        name: unifiedSemanticLabel(node),
        x: node.x * display.spread + display.x,
        y: node.y * display.spread + display.y,
        z: display.z + node.z * 0.18,
        size: Math.max(2.5, node.size * display.scale),
        color: display.color,
        ...(view ? { graph_view_id: view.viewId, graph_view_status: view.status } : {}),
      };
    }),
    edges: [...new Map(visibleData.edges.map((edge) => [edge.id || `${edge.source}:${edge.target}:${edge.type}`, edge])).values()],
  }), [membership, visibleData]);
  const focusNode = selected || hovered;
  const highlightedIds = useMemo(() => neighborhoodFor(focusNode?.id ?? null, payload?.edges || [], hopDepth), [focusNode?.id, hopDepth, payload?.edges]);
  const selectedRelationships = useMemo(() => {
    if (!payload || !selected) return [];
    const byId = new Map(payload.nodes.map((node) => [node.id, node]));
    const connected = payload.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id);
    return [...new Map(connected.map((edge) => [edge.id || `${edge.source}:${edge.target}:${edge.type}`, edge])).values()].map((edge) => {
      const outbound = edge.source === selected.id;
      return { edge, outbound, node: byId.get(outbound ? edge.target : edge.source) };
    }).filter((item) => item.node);
  }, [payload, selected]);
  const counts = payload?.counts.selected || EMPTY_COUNTS;

  return (
    <div data-testid="unified-graph-surface" style={{ width: '100%', height: '100%', minHeight: 0, position: 'relative', overflow: 'hidden', background: GRAPH_THEME.background.knowledgeSurface }}>
      <GraphPaperBackground />
      {payload ? <button type="button" aria-label="Open projection details" onClick={() => setDrawerOpen(true)} title={payload.projectionId} style={graphGlassPillStyle({ position: 'absolute', top: 52, left: 12, zIndex: 6, padding: '5px 9px', color: '#A9ECE8', cursor: 'pointer', fontFamily: 'inherit' })}>
        Main · {payload.counts.nodes} · Think {counts.thinkgraph} / Know {counts.knowgraph} / Code {counts.codegraph} · {payload.counts.crossAuthorityEdges} refs · <span style={{ fontFamily: 'monospace', color: '#91A9B8' }}>{payload.projectionId.slice(0, 18)}…</span>
      </button> : null}

      {error && !payload ? <div style={{ position: 'absolute', inset: 0, zIndex: 4, display: 'grid', placeItems: 'center', color: '#FFB0A6' }}><div style={{ textAlign: 'center' }}><div>Unified context failed: {error}</div><button type="button" onClick={() => setRefreshGeneration((value) => value + 1)} style={graphDrawerButtonStyle({ marginTop: 10 })}>Retry</button></div></div> : null}
      {!payload && loading ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#91A9B8', pointerEvents: 'none' }}><div style={{ textAlign: 'center' }}><div>Loading Main context</div><div style={{ marginTop: 6, fontSize: 10, fontFamily: 'monospace', opacity: .72 }}>{projectId}</div></div></div> : null}
      {payload && payload.nodes.length === 0 ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#91A9B8', padding: 30, textAlign: 'center' }}>The server returned an empty bounded projection for {payload.projectId} · {payload.receivingRole}. Open the inspector for authority counts and warnings.</div> : null}
      {payload && payload.nodes.length > 0 && sceneData.nodes.length === 0 ? <div style={{ position: 'absolute', inset: 0, zIndex: 4, display: 'grid', placeItems: 'center', color: '#91A9B8', padding: 30, textAlign: 'center', pointerEvents: 'none' }}>Local visual filters hide all {payload.nodes.length} projection records. Reset visual filters in the inspector.</div> : null}
      {payload ? <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}><CodeGraphScene data={sceneData} showLabels highlightedIds={highlightedIds} onNodeClick={(node) => { setSelected(node); setDrawerOpen(true); }} onNodeHover={setHovered} autoRotate={false} cameraAction={cameraCommand.action} cameraActionToken={cameraCommand.token} focusNode={null} cameraPosition={[0, -30, 650]} maxLabels={labels ? 18 : focusNode ? 10 : 9} showAmbientDust={false} curveCrossAuthority preserveDimmedEdges /></div> : null}

      <GraphNavigationControls
        onZoomIn={() => setCameraCommand({ action: 'zoom_in', token: Date.now() })}
        onZoomOut={() => setCameraCommand({ action: 'zoom_out', token: Date.now() })}
        onFit={() => setCameraCommand({ action: 'fit_view', token: Date.now() })}
      />
      {selected ? <button type="button" aria-label="Reset focus" style={graphDrawerButtonStyle({ position: 'absolute', right: 62, bottom: 16, zIndex: 6, padding: '8px 10px' })} onClick={() => { setSelected(null); setHovered(null); if (visualMode === 'neighborhood') setVisualMode('all'); }}>Reset focus</button> : null}
      {payload?.warnings.length ? <div title={payload.warnings.map((warning) => `${warning.authority}: ${warning.detail}`).join('\n')} style={graphGlassPillStyle({ position: 'absolute', left: 244, bottom: 12, zIndex: 6, color: '#F0C674' })}>{payload.warnings.length} warning{payload.warnings.length === 1 ? '' : 's'} · {payload.warnings[0].code}</div> : null}
      {payload && loading ? <div style={graphGlassPillStyle({ position: 'absolute', left: 12, bottom: 46, zIndex: 6, color: '#91A9B8' })}>Updating · showing {payload.projectionId}</div> : null}
      {payload && error ? <button type="button" onClick={() => setRefreshGeneration((value) => value + 1)} style={graphGlassPillStyle({ position: 'absolute', left: 12, bottom: 46, zIndex: 6, color: '#FFB0A6', cursor: 'pointer' })}>Update failed · keeping {payload.projectionId} · Retry</button> : null}

      <RightGlassDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} onOpen={() => setDrawerOpen(true)} collapsedLabel={null} openAriaLabel="Open Unified Inspector" title="Unified Inspector" defaultWidth={380} minWidth={340} maxWidth={600} storageKey="liquidaity.drawer.unified.width" top={48} right={12} bottom={12} zIndex={7}>
        {selected ? <>
          <GlassInspectorSection title={unifiedSemanticLabel(selected)} signal={selected.authority || 'record'}>
            <InspectorRow label="Authority" value={selected.authority || 'unknown'} />
            <InspectorRow label="Record type" value={selected.label || 'Record'} />
            <InspectorRow label="Canonical ID" value={selected.source_id || String(selected.id)} />
            <InspectorRow label="Graph View" value={selected.graph_view_id || 'available only'} />
            <InspectorRow label="View state" value={selected.graph_view_status || 'available'} />
            <p style={{ color: GRAPH_THEME.drawer.inputText, fontSize: 12, lineHeight: 1.55 }}>{nodeLead(selected)}</p>
          </GlassInspectorSection>
          <GlassInspectorSection title="Persisted relationships" signal={String(selectedRelationships.length)}>
            {selectedRelationships.length ? selectedRelationships.map(({ edge, outbound, node }) => <button key={edge.id || `${edge.source}:${edge.target}:${edge.type}`} type="button" onClick={() => setSelected(node || null)} style={graphDrawerButtonStyle({ width: '100%', display: 'grid', gridTemplateColumns: '74px 1fr', gap: 8, marginBottom: 6, textAlign: 'left', color: GRAPH_THEME.drawer.inputText })}>
              <span style={{ color: edge.cross_authority ? '#F2A64A' : '#91A9B8' }}>{outbound ? edge.type : `← ${edge.type}`}</span>
              <span>{node ? unifiedSemanticLabel(node) : 'Missing record'} · {node?.authority || 'unknown'}</span>
            </button>) : <p style={{ color: '#F2A64A', fontSize: 11, lineHeight: 1.5 }}>No persisted relationship connects this record to the current projection. The missing link is shown honestly; Unified does not infer one.</p>}
          </GlassInspectorSection>
          <GlassInspectorSection title="Provenance and full properties" defaultOpen={false}>
            {Object.entries(selected.provenance || {}).map(([key, value]) => <InspectorRow key={`p:${key}`} label={key} value={textValue(value) || '—'} />)}
            {Object.entries(selected.properties || {}).map(([key, value]) => <InspectorRow key={`v:${key}`} label={key} value={textValue(value) || (Array.isArray(value) ? value.join(' · ') : '—')} />)}
          </GlassInspectorSection>
          {selected.authority && onOpenAuthority ? <button type="button" style={graphDrawerButtonStyle({ width: '100%', marginBottom: 8 })} onClick={() => onOpenAuthority(selected.authority as Layer)}>Open authoritative {selected.authority} view</button> : null}
        </> : null}
        <GlassInspectorSection title="Agent context" signal={role} defaultOpen={!selected}>
          <select aria-label="Receiving role" value={role} onChange={(event) => setRole(event.target.value as Role)} style={graphDrawerInputStyle({ width: '100%' })}>
            <option value="main_chat">Main chat</option><option value="hermes">Hermes</option><option value="coder">Coder</option>
          </select>
          <select aria-label="Graph View" value={activeViewId} onChange={(event) => setActiveViewId(event.target.value)} style={graphDrawerInputStyle({ width: '100%', marginTop: 7 })}>
            <option value="">Automatic Graph View</option>
            {payload?.availableGraphViews.map((view) => <option key={view.viewId} value={view.viewId}>{view.status} · {view.viewId}</option>)}
          </select>
          <InspectorRow label="Projection" value={payload?.projectionId || 'resolving'} />
          <InspectorRow label="App project" value={payload?.identity?.applicationProjectId || projectId} />
          <InspectorRow label="Think workspace" value={payload?.identity?.thinkGraphWorkspaceId || projectId} />
          <InspectorRow label="Know scope" value={payload?.identity?.knowGraphScopeId || 'missing'} />
          <InspectorRow label="Code project" value={payload?.identity?.codeGraphProjectId || 'missing'} />
          <InspectorRow label="Think / Know / Code" value={`${counts.thinkgraph} / ${counts.knowgraph} / ${counts.codegraph}`} />
        </GlassInspectorSection>
        <GlassInspectorSection title="Visual filters" defaultOpen={false}>
          <input aria-label="Search context" placeholder="Search canonical context" value={search} onChange={(event) => setSearch(event.target.value)} style={graphDrawerInputStyle({ width: '100%', boxSizing: 'border-box' })} />
          <select aria-label="Local view mode" value={visualMode} onChange={(event) => setVisualMode(event.target.value as VisualMode)} style={graphDrawerInputStyle({ width: '100%', marginTop: 7 })}>
            <option value="all">All context</option><option value="reasoning">Reasoning</option><option value="evidence">Evidence</option><option value="code">Code</option><option value="cross">Cross-links</option><option value="neighborhood">Selected neighborhood</option>
          </select>
          <p style={{ margin: '6px 0 0', color: '#91A9B8', fontSize: 10, lineHeight: 1.4 }}>Visual filter only · Main’s server projection is unchanged.</p>
          <select aria-label="Visual authority" value={authority} onChange={(event) => setAuthority(event.target.value as Layer | 'all')} style={graphDrawerInputStyle({ width: '100%', marginTop: 7 })}>
            <option value="all">All authorities</option><option value="thinkgraph">ThinkGraph</option><option value="knowgraph">KnowGraph</option><option value="codegraph">CodeGraph</option>
          </select>
          <select aria-label="Node type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={graphDrawerInputStyle({ width: '100%', marginTop: 7 })}>
            <option value="all">All record types</option>{nodeTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
          <label style={{ display: 'block', fontSize: 11, color: '#8CA1B0', marginTop: 10 }}>Neighborhood · {hopDepth} hop</label>
          <input aria-label="Neighborhood depth" type="range" min={1} max={3} value={hopDepth} onChange={(event) => setHopDepth(Number(event.target.value))} style={{ width: '100%' }} />
          <button type="button" style={graphDrawerButtonStyle({ width: '100%', marginTop: 6 })} onClick={() => { setSelected(null); setHovered(null); setSearch(''); setAuthority('all'); setTypeFilter('all'); setVisualMode('all'); }}>Show full projection</button>
          <button type="button" style={graphDrawerButtonStyle({ width: '100%', marginTop: 6 })} onClick={() => setExpansionDepth((value) => Math.min(3, value + 1))}>Request reasoning expansion · {expansionDepth}</button>
          <button type="button" style={graphDrawerButtonStyle({ width: '100%', marginTop: 6 })} onClick={() => setLabels((value) => !value)}>{labels ? 'Hide labels' : 'Show labels'}</button>
          {clusters.map((cluster) => <label key={cluster} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11, margin: '6px 0', color: '#AFC0CB' }}><input type="checkbox" checked={!collapsedClusters.has(cluster)} onChange={() => setCollapsedClusters((current) => { const next = new Set(current); next.has(cluster) ? next.delete(cluster) : next.add(cluster); return next; })} />{cluster}</label>)}
        </GlassInspectorSection>
      </RightGlassDrawer>
    </div>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '108px 1fr', gap: 8, fontSize: 11, marginBottom: 7 }}><span style={{ color: GRAPH_THEME.drawer.inputMuted }}>{label}</span><span style={{ color: GRAPH_THEME.drawer.inputText, overflowWrap: 'anywhere' }}>{value || '—'}</span></div>;
}
