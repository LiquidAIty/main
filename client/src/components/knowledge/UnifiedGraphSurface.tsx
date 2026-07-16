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
  const requestGeneration = useRef(0);
  const [role, setRole] = useState<Role>('main_chat');
  const [activeViewId, setActiveViewId] = useState('');
  const [authority, setAuthority] = useState<Layer | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [hopDepth, setHopDepth] = useState(1);
  const [expansionDepth, setExpansionDepth] = useState(0);
  const [selected, setSelected] = useState<CodeGraphNode | null>(null);
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
  }, [activeViewId, conversationId, expansionDepth, projectId, role]);

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
    let allowed = new Set(payload.nodes.filter((node) =>
      (authority === 'all' || node.authority === authority)
      && (typeFilter === 'all' || node.label === typeFilter)
      && !collapsedClusters.has(String(node.cluster || 'records'))
      && (!query || `${node.name} ${node.label} ${node.source_id} ${node.cluster}`.toLowerCase().includes(query)),
    ).map((node) => node.id));
    if (selected) {
      allowed = new Set([selected.id]);
      let frontier = new Set([selected.id]);
      for (let depth = 0; depth < hopDepth; depth += 1) {
        const next = new Set<number>();
        payload.edges.forEach((edge) => {
          if (frontier.has(edge.source)) next.add(edge.target);
          if (frontier.has(edge.target)) next.add(edge.source);
        });
        next.forEach((id) => allowed.add(id));
        frontier = next;
      }
    }
    const nodes = payload.nodes.filter((node) => allowed.has(node.id));
    const ids = new Set(nodes.map((node) => node.id));
    return { nodes, edges: payload.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), total_nodes: payload.counts.nodes };
  }, [authority, collapsedClusters, hopDepth, payload, search, selected, typeFilter]);

  const membership = useMemo(() => {
    const map = new Map<string, GraphView>();
    [...(payload?.graphViews || []), ...runtimeHandbacks].forEach((view) => view.includedCanonicalNodeIds.forEach((id) => map.set(id, view)));
    return map;
  }, [payload?.graphViews, runtimeHandbacks]);
  const sceneData = useMemo<CodeGraphData>(() => ({
    ...visibleData,
    nodes: visibleData.nodes.map((node) => {
      const view = membership.get(node.source_id || '');
      return view ? { ...node, graph_view_id: view.viewId, graph_view_status: view.status } : node;
    }),
  }), [membership, visibleData]);
  const counts = payload?.counts.selected || EMPTY_COUNTS;

  return (
    <div style={{ height: '100%', minHeight: 0, position: 'relative', overflow: 'hidden', background: GRAPH_THEME.background.knowledgeSurface }}>
      <GraphPaperBackground />
      <div style={{ position: 'absolute', inset: '52px 12px auto 12px', zIndex: 6, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', pointerEvents: 'none' }}>
        <span style={graphGlassPillStyle({ color: '#A9ECE8' })}>Main · {sceneData.nodes.length} records</span>
        <span style={graphGlassPillStyle()}>Think {counts.thinkgraph} · Know {counts.knowgraph} · Code {counts.codegraph} · {payload?.counts.crossAuthorityEdges || 0} refs</span>
        {payload ? <span title={payload.projectionId} style={graphGlassPillStyle({ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' })}>{payload.projectionId}</span> : null}
      </div>

      {error && !payload ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#FFB0A6' }}>Unified context failed: {error}</div> : null}
      {!payload && loading ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#91A9B8', pointerEvents: 'none' }}>Resolving bounded context…</div> : null}
      {payload && payload.nodes.length === 0 ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#91A9B8', padding: 30, textAlign: 'center' }}>The server returned an empty bounded projection for {payload.projectId} · {payload.receivingRole}. Open the inspector for authority counts and warnings.</div> : null}
      {payload ? <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}><CodeGraphScene data={sceneData} showLabels={labels || Boolean(selected)} highlightedIds={selected ? new Set([selected.id]) : null} onNodeClick={(node) => { setSelected(node); setDrawerOpen(true); }} autoRotate={false} cameraAction={cameraCommand.action} cameraActionToken={cameraCommand.token} focusNode={selected} cameraPosition={[0, -30, 520]} maxLabels={labels ? 18 : 1} /></div> : null}

      <GraphNavigationControls
        onZoomIn={() => setCameraCommand({ action: 'zoom_in', token: Date.now() })}
        onZoomOut={() => setCameraCommand({ action: 'zoom_out', token: Date.now() })}
        onFit={() => setCameraCommand({ action: 'fit_view', token: Date.now() })}
      />
      {payload?.warnings.length ? <div title={payload.warnings.map((warning) => `${warning.authority}: ${warning.detail}`).join('\n')} style={graphGlassPillStyle({ position: 'absolute', left: 244, bottom: 12, zIndex: 6, color: '#F0C674' })}>{payload.warnings.length} warning{payload.warnings.length === 1 ? '' : 's'} · {payload.warnings[0].code}</div> : null}
      {payload && loading ? <div style={graphGlassPillStyle({ position: 'absolute', left: 12, bottom: 46, zIndex: 6, color: '#91A9B8' })}>Updating · showing {payload.projectionId}</div> : null}
      {payload && error ? <div style={graphGlassPillStyle({ position: 'absolute', left: 12, bottom: 46, zIndex: 6, color: '#FFB0A6' })}>Update failed · unchanged {payload.projectionId} · {error}</div> : null}

      <RightGlassDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} onOpen={() => setDrawerOpen(true)} collapsedLabel={null} openAriaLabel="Open Unified Inspector" title="Unified Inspector" defaultWidth={380} minWidth={340} maxWidth={600} storageKey="liquidaity.drawer.unified.width" top={48} right={12} bottom={12} zIndex={7}>
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
          <select aria-label="Visual authority" value={authority} onChange={(event) => setAuthority(event.target.value as Layer | 'all')} style={graphDrawerInputStyle({ width: '100%', marginTop: 7 })}>
            <option value="all">All authorities</option><option value="thinkgraph">ThinkGraph</option><option value="knowgraph">KnowGraph</option><option value="codegraph">CodeGraph</option>
          </select>
          <select aria-label="Node type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={graphDrawerInputStyle({ width: '100%', marginTop: 7 })}>
            <option value="all">All record types</option>{nodeTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
          <label style={{ display: 'block', fontSize: 11, color: '#8CA1B0', marginTop: 10 }}>Neighborhood · {hopDepth} hop</label>
          <input aria-label="Neighborhood depth" type="range" min={1} max={3} value={hopDepth} onChange={(event) => setHopDepth(Number(event.target.value))} style={{ width: '100%' }} />
          <button type="button" style={graphDrawerButtonStyle({ width: '100%', marginTop: 6 })} onClick={() => { setSelected(null); setSearch(''); setAuthority('all'); setTypeFilter('all'); }}>Show full projection</button>
          <button type="button" style={graphDrawerButtonStyle({ width: '100%', marginTop: 6 })} onClick={() => setExpansionDepth((value) => Math.min(3, value + 1))}>Request reasoning expansion · {expansionDepth}</button>
          <button type="button" style={graphDrawerButtonStyle({ width: '100%', marginTop: 6 })} onClick={() => setLabels((value) => !value)}>{labels ? 'Hide labels' : 'Show labels'}</button>
          {clusters.map((cluster) => <label key={cluster} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11, margin: '6px 0', color: '#AFC0CB' }}><input type="checkbox" checked={!collapsedClusters.has(cluster)} onChange={() => setCollapsedClusters((current) => { const next = new Set(current); next.has(cluster) ? next.delete(cluster) : next.add(cluster); return next; })} />{cluster}</label>)}
        </GlassInspectorSection>
        {selected ? <>
          <GlassInspectorSection title="Canonical record">
            <InspectorRow label="Canonical ref" value={selected.source_id || String(selected.id)} />
            <InspectorRow label="Authority" value={selected.authority || 'unknown'} />
            <InspectorRow label="Source graph" value={String((selected as any).source_graph || '')} />
            <InspectorRow label="Epistemic level" value={String((selected as any).epistemic_level || '')} />
            <InspectorRow label="Cluster" value={String((selected as any).cluster || '')} />
            <InspectorRow label="Selection" value={String((selected as any).selection_state || 'available')} />
            <p style={{ color: GRAPH_THEME.drawer.inputText, fontSize: 12, lineHeight: 1.55 }}>{nodeLead(selected)}</p>
          </GlassInspectorSection>
          <GlassInspectorSection title="Graph View lifecycle">
            <InspectorRow label="View" value={selected.graph_view_id || 'available only'} />
            <InspectorRow label="State" value={selected.graph_view_status || 'available'} />
            {payload && Object.entries(payload.lifecycle).map(([state, ids]) => <InspectorRow key={state} label={state} value={ids.length ? ids.join(' · ') : '—'} />)}
          </GlassInspectorSection>
          <GlassInspectorSection title="Provenance and properties">
            {Object.entries(selected.provenance || {}).slice(0, 5).map(([key, value]) => <InspectorRow key={`p:${key}`} label={key} value={textValue(value) || '—'} />)}
            {Object.entries(selected.properties || {}).slice(0, 7).map(([key, value]) => <InspectorRow key={`v:${key}`} label={key} value={textValue(value) || (Array.isArray(value) ? value.slice(0, 5).join(' · ') : '—')} />)}
          </GlassInspectorSection>
          {selected.authority && onOpenAuthority ? <button type="button" style={graphDrawerButtonStyle({ width: '100%' })} onClick={() => onOpenAuthority(selected.authority as Layer)}>Open authoritative {selected.authority} view</button> : null}
        </> : null}
      </RightGlassDrawer>
    </div>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '108px 1fr', gap: 8, fontSize: 11, marginBottom: 7 }}><span style={{ color: GRAPH_THEME.drawer.inputMuted }}>{label}</span><span style={{ color: GRAPH_THEME.drawer.inputText, overflowWrap: 'anywhere' }}>{value || '—'}</span></div>;
}
