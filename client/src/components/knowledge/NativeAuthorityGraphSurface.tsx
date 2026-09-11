import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import '../../vendor/engraphis/vendor/d3.min.js';
import '../../vendor/engraphis/vendor/force-graph.min.js';
import '../../vendor/engraphis/engraphis-graph.js';

import type { GraphData } from '../../vendor/codebase-memory-ui/src/lib/types';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import './nativeAuthorityGraphSurface.css';

const CbmGraphTab = lazy(async () => {
  const { GraphTab } = await import('../../vendor/codebase-memory-ui/src/components/GraphTab');
  return { default: GraphTab };
});

type GraphAuthority = 'thinkgraph' | 'knowgraph';

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
  mentionCount?: number;
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
  mentionCount?: number;
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
  scene?: { nodes: GraphProjectionNode[]; edges: GraphProjectionEdge[]; [key: string]: unknown };
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

type NativeLayout = 'compact' | 'original' | 'communities' | 'radial';
type NativeStyle = 'classic' | 'cyber' | 'galaxy' | 'solar';
type EngraphisRenderer = {
  setPreset: (name: NativeLayout) => Record<string, number | boolean | string>;
  setStyle: (name: NativeStyle) => void;
  setSettings: (settings: Record<string, number | boolean | string>) => void;
  setData: (data: { nodes: unknown[]; links?: unknown[]; edges?: unknown[] }) => void;
  setHighlight: (id: string | null) => void;
  graphToScreen: (x: number, y: number) => { x: number; y: number };
  fit: () => void;
  resize: () => void;
  focus: (id: string) => boolean;
  clearFocus: () => void;
  freeze: (on: boolean) => void;
  reheat: () => void;
  setCollapse: (mode: boolean | 'auto') => void;
  destroy: () => void;
};

declare global {
  interface Window {
    EngraphisGraph: { create: (host: HTMLElement, options: {
      onNodeClick: (node: { id: string }) => void;
      onBackgroundClick: () => void;
    }) => EngraphisRenderer };
  }
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
  const candidates = [properties, body, ...(Array.isArray(body.sources) ? body.sources : []), ...(Array.isArray(body.findings) ? body.findings : [])];
  const links = new Map<string, { url: string; label: string }>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const url = candidate.source_url || candidate.url;
    if (typeof url !== 'string') continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      links.set(url, { url, label: String(candidate.source_title || candidate.title || candidate.publisher || parsed.hostname) });
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
  onRemoveEvidence,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  authority?: GraphAuthority;
  onExpand?: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
  onRemoveEvidence?: (memoryId: string) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<EngraphisRenderer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [settings, setSettings] = useState<Record<string, number | boolean | string>>({});
  const [layout, setLayout] = useState<NativeLayout>('compact');
  const [style, setStyle] = useState<NativeStyle>('classic');
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const [expanding, setExpanding] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [paperViewport, setPaperViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const selected = projection?.nodes.find(node => node.id === selectedId);
  const selectedProperties = selected?.properties || {};
  const syncPaper = () => {
    const graph = graphRef.current;
    if (!graph) return;
    const origin = graph.graphToScreen(0, 0);
    const unit = graph.graphToScreen(1, 0);
    const current = { x: origin.x, y: origin.y, scale: unit.x - origin.x };
    const previous = cameraRef.current;
    cameraRef.current = current;
    if (previous && previous.scale > 0) setPaperViewport(paper => ({
      x: paper.x + current.x - previous.x, y: paper.y + current.y - previous.y,
      zoom: paper.zoom * current.scale / previous.scale,
    }));
  };
  const beginCameraGesture = () => { cameraRef.current = null; syncPaper(); };
  const zoom = (key: '+' | '-') => {
    beginCameraGesture();
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
      deltaY: key === '+' ? -120 : 120 }));
  };

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const graph = window.EngraphisGraph.create(hostRef.current, {
        onNodeClick: node => {
          setControlsOpen(false);
          setRemoveError(null);
          setSelectedId(node.id);
          setSelectedEdgeId(null);
          setInspectorOpen(true);
        },
        onBackgroundClick: () => {
          setSelectedId(null);
          setSelectedEdgeId(null);
          setInspectorOpen(false);
          setControlsOpen(true);
        },
      });
      const defaults = graph.setPreset('compact');
      graph.setCollapse(false);
      setLayout('compact'); setStyle('classic');
      graph.setStyle('classic');
      graph.setSettings({ labels: true });
      setSettings({ ...defaults, labels: true });
      graphRef.current = graph;
      return () => { graph.destroy(); graphRef.current = null; };
    } catch (failure) {
      setRenderError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    }
  }, [authority]);

  useEffect(() => { graphRef.current?.resize(); }, [controlsOpen, inspectorOpen]);

  useEffect(() => {
    // Engraphis scenes retain all engine-owned layout and evidence fields.
    // Graphiti uses the renderer's supported field aliases; no graph is inferred here.
    const data = projection?.scene || {
      nodes: projection?.nodes || [],
      links: (projection?.edges || []).map(edge => ({ ...edge, relation: edge.predicate })),
    };
    graphRef.current?.setData(data);
  }, [projection, authority]);

  useEffect(() => {
    graphRef.current?.setHighlight(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId && !projection?.nodes.some(node => node.id === selectedId)) {
      setSelectedId(null);
      setInspectorOpen(false);
      setControlsOpen(true);
    }
    if (selectedEdgeId && !projection?.edges.some(edge => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
      setInspectorOpen(false);
      setControlsOpen(true);
    }
  }, [projection, selectedId, selectedEdgeId]);

  useEffect(() => {
    if (inspectorOpen || controlsOpen) {
      panelBodyRef.current?.querySelector<HTMLElement>('[tabindex="-1"], select')?.focus();
    }
  }, [inspectorOpen, controlsOpen, selectedId, selectedEdgeId]);

  const closePanel = () => {
    setSelectedId(null);
    setSelectedEdgeId(null);
    setInspectorOpen(false);
    setControlsOpen(inspectorOpen);
  };

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
  const selectedEvidence = (selectedEdge?.properties || selectedProperties).evidence;
  const notes = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item): item is Record<string, any> =>
    item !== null && typeof item === 'object' && typeof item.id === 'string') : [];
  const entryTitle = selected?.label || (selectedEdge ? selectedEdge.predicate : '');
  const nativeLabel = (id: string) => projection?.nodes.find(node => node.id === id)?.label || id;
  const fields = (value: Record<string, unknown>) => Object.entries(value).filter(([, item]) =>
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
  return (
    <div data-testid={`native-${authority}-surface`} className="native-authority-graph" data-layout={layout} data-style={style} data-panel-open={controlsOpen || inspectorOpen} aria-busy={status === 'loading'}
      onKeyDown={event => { if (event.key === 'Escape' && (inspectorOpen || controlsOpen)) { event.stopPropagation(); closePanel(); } }}>
      <GraphPaperBackground viewport={paperViewport} />
      <div className="native-authority-canvas">
        <div ref={hostRef} className="native-authority-network graph-canvas"
          data-renderer="engraphis-1.7.1"
          onWheelCapture={beginCameraGesture}
          onWheel={syncPaper}
          onPointerDown={beginCameraGesture}
          onPointerMove={event => { if (event.buttons) syncPaper(); }}
          onKeyDownCapture={beginCameraGesture}
          onKeyDown={syncPaper}
        />
        <GraphNavigationControls
          onZoomIn={() => zoom('+')}
          onZoomOut={() => zoom('-')}
          onFit={() => {
            cameraRef.current = null;
            setPaperViewport({ x: 0, y: 0, zoom: 1 });
            graphRef.current?.fit();
          }}
        />
        {status === 'error' || renderError ? <div className="native-authority-empty">Graph failed: {renderError || error}</div> : null}
        {status === 'ready' && allNodes === 0 ? <div className="native-authority-empty">No knowledge yet.</div> : null}
      </div>
        <RightGlassDrawer
          isOpen={controlsOpen || inspectorOpen}
          title={inspectorOpen ? entryTitle : 'Graph settings'}
          onClose={closePanel}
          onOpen={() => { setSelectedId(null); setSelectedEdgeId(null); setControlsOpen(true); setInspectorOpen(false); }}
          collapsedLabel={null}
          openAriaLabel="Open graph settings"
          movable
          defaultWidth={340} minWidth={280} maxWidth={520}
          storageKey={`liquidaity.drawer.${authority}.width`}
          top={48} right={12} bottom={12} zIndex={6}
        >
          {!inspectorOpen ? <div ref={panelBodyRef} className="native-authority-controls">
            <label>Layout<select aria-label="Layout" value={layout} onChange={event => {
              const next = event.target.value as NativeLayout;
              const defaults = graphRef.current?.setPreset(next);
              setLayout(next); setSettings(current => ({ ...current, ...defaults }));
            }}>
              <option value="compact">Compact</option><option value="original">Original</option>
              <option value="communities">Communities</option><option value="radial">Radial</option>
            </select></label>
            <label>Style<select aria-label="Style" value={style} onChange={event => {
              const next = event.target.value as NativeStyle;
              graphRef.current?.setStyle(next); setStyle(next);
            }}>
              <option value="classic">Classic</option><option value="cyber">Cyberpunk</option>
              <option value="galaxy">Galaxy</option><option value="solar">Solar</option>
            </select></label>
            <label><input type="checkbox" checked={settings.labels === true} onChange={event => {
              const patch = { labels: event.target.checked };
              graphRef.current?.setSettings(patch);
              setSettings(current => ({ ...current, ...patch }));
            }} />Entity labels</label>
            {([
              ['Node size', 'size', 1, 12, 1], ['Text size', 'font', 6, 24, 1],
              ['Line width', 'linkw', 0.1, 2, 0.01], ['Label density', 'labelDensity', 1, 100, 1],
              ['Repel force', 'repel', 0, 400, 1], ['Link distance', 'link', 4, 80, 1],
              ['Center gravity', 'gravity', 0, 400, 1],
            ] as const).map(([label, key, min, max, step]) => <label key={key}>
              <span>{label}</span>
              <input aria-label={label} type="range" min={min} max={max} step={step}
                value={Number(settings[key] ?? min)} onChange={event => {
                  const patch = { [key]: Number(event.target.value) };
                  graphRef.current?.setSettings(patch);
                  setSettings(current => ({ ...current, ...patch }));
                }} />
              <output>{settings[key]}</output>
            </label>)}
            <button type="button" onClick={() => {
              const defaults = graphRef.current?.setPreset(layout);
              graphRef.current?.setSettings({ labels: true });
              setSettings({ ...defaults, labels: true });
            }}>Reset to preset defaults</button>
          </div> : (selected || selectedEdge) ? <div ref={panelBodyRef} className="native-authority-controls" role="region" aria-label={`${entryTitle} details`}>
        {selected ? <article data-testid={`${authority}-node-inspector`} data-native-id={selected.id}>
          <h4 tabIndex={-1}>{selected.label}</h4>
          {(['statement', 'fact', 'content', 'summary', 'reason'] as const).map(key => selectedProperties[key])
            .filter((value, index, values): value is string => typeof value === 'string' && !!value && values.indexOf(value) === index)
            .map(value => <p key={value}>{value}</p>)}
          {selectedSource?.summary ? <p>{selectedSource.summary}</p> : null}
        </article> : null}
        {selectedRelationships.length ? <section className="knowgraph-relationships">
          {selectedRelationships.map(edge => <button type="button" key={edge.id} data-edge-id={edge.id}
            onClick={() => { setSelectedId(null); setSelectedEdgeId(edge.id); }}>
            <strong>{nativeLabel(edge.source)}</strong><span>{edge.predicate}</span><strong>{nativeLabel(edge.target)}</strong>
          </button>)}
        </section> : null}
        {selectedEdge ? <article data-testid={`${authority}-edge-inspector`} data-native-id={selectedEdge.id}>
          <h4 tabIndex={-1}>{nativeLabel(selectedEdge.source)} → {selectedEdge.predicate} → {nativeLabel(selectedEdge.target)}</h4>
          {(['fact', 'summary', 'reason'] as const).map(key => typeof selectedEdge.properties?.[key] === 'string'
            && selectedEdge.properties[key] ? <p key={key}>{String(selectedEdge.properties[key])}</p> : null)}
          <button type="button" onClick={() => { setSelectedId(selectedEdge.source); setSelectedEdgeId(null); }}>{nativeLabel(selectedEdge.source)}</button>
          <button type="button" onClick={() => { setSelectedId(selectedEdge.target); setSelectedEdgeId(null); }}>{nativeLabel(selectedEdge.target)}</button>
        </article> : null}
        <dl className="graph-record-fields">
          <dt>Source graph</dt><dd>{authority === 'thinkgraph' ? 'ThinkGraph / Engraphis' : 'KnowGraph / Graphiti'}</dd>
          <dt>Native ID</dt><dd>{selected?.id || selectedEdge?.id}</dd>
          {selectedEdge ? <><dt>Source</dt><dd>{selectedEdge.source}</dd><dt>Predicate</dt><dd>{selectedEdge.predicate}</dd><dt>Target</dt><dd>{selectedEdge.target}</dd>
            <dt>Direction</dt><dd>{selectedEdge.properties?.directed === false ? 'Undirected' : selectedEdge.properties?.directed === true ? 'Source → target' : 'Not supplied'}</dd></> : null}
        </dl>
        {notes.map(item => <section className="graph-note" key={item.id} data-memory-id={item.id}>
          <details>
            <summary>{item.title || 'Supporting note'}</summary>
            <p>{item.content || item.summary}</p>
            <code>{item.id}</code>
            {item.provenance && typeof item.provenance === 'object' ? <dl>{fields(item.provenance).map(([key, value]) =>
              <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl> : null}
            {authority === 'thinkgraph' && onRemoveEvidence ? <button type="button" disabled={removingId !== null} onClick={async () => {
              setRemovingId(item.id); setRemoveError(null);
              try { await onRemoveEvidence(item.id); }
              catch (failure) { setRemoveError(failure instanceof Error ? failure.message : String(failure)); }
              finally { setRemovingId(null); }
            }}>{removingId === item.id ? 'Removing…' : 'Remove note'}</button> : null}
          </details>
        </section>)}
        {removeError ? <p role="alert">{removeError}</p> : null}
        {evidence.length ? <section className="knowgraph-sources"><h4>Sources</h4>{evidence.map(({ node, links }) =>
          <details key={node.id}>
            <summary>{node.label}</summary>
            {links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}
            {typeof node.properties?.content === 'string' ? <pre>{node.properties.content}</pre> : null}
            <code>{node.id}</code>
          </details>)}</section> : null}
        <details className="graph-record"><summary>Record</summary>
          <code>{selected?.id || selectedEdge?.id}</code>
          {selectedEdge ? <dl><dt>Source</dt><dd>{selectedEdge.source}</dd><dt>Target</dt><dd>{selectedEdge.target}</dd></dl> : null}
          <dl>{fields((selected || selectedEdge || {}) as Record<string, unknown>).filter(([key]) =>
            !['id', 'label', 'source', 'target'].includes(key)).map(([key, value]) =>
            <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
          <pre>{JSON.stringify({ properties: (selected || selectedEdge)?.properties,
            provenance: (selected || selectedEdge)?.provenance }, null, 2)}</pre>
        </details>
        {authority === 'knowgraph' && selected ? <div className="native-authority-actions">
          {onExpand ? <button type="button" disabled={expanding} onClick={() => {
            setExpanding(true);
            void onExpand(selected).finally(() => setExpanding(false));
          }}>{expanding ? 'Expanding…' : 'Expand'}</button> : null}
          {onUseAsContext ? <button type="button" onClick={() => onUseAsContext(selected)}>Use in chat</button> : null}
        </div> : null}
      </div> : null}
        </RightGlassDrawer>
    </div>
  );
}
