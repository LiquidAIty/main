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

type EngraphisRenderer = {
  setPreset: (name: 'original') => Record<string, number | boolean | string>;
  setStyle: (name: 'classic') => void;
  setSettings: (settings: Record<string, number | boolean | string>) => void;
  setData: (data: { nodes: unknown[]; links?: unknown[]; edges?: unknown[] }) => void;
  setHighlight: (id: string | null) => void;
  graphToScreen: (x: number, y: number) => { x: number; y: number };
  fit: () => void;
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
        },
      });
      const defaults = graph.setPreset('original');
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
    }
    if (selectedEdgeId && !projection?.edges.some(edge => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
      setInspectorOpen(false);
    }
  }, [projection, selectedId, selectedEdgeId]);

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
      {authority === 'thinkgraph' ? <>
        <RightGlassDrawer
          isOpen={controlsOpen}
          title="Graph settings"
          onClose={() => setControlsOpen(false)}
          onOpen={() => { setControlsOpen(true); setInspectorOpen(false); }}
          collapsedLabel={null}
          openAriaLabel="Open graph settings"
          defaultWidth={340} minWidth={280} maxWidth={520}
          storageKey="liquidaity.drawer.thinkgraph.width"
          top={48} right={12} bottom={12} zIndex={6}
        >
          <div className="native-authority-controls">
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
              const defaults = graphRef.current?.setPreset('original');
              graphRef.current?.setSettings({ labels: true });
              setSettings({ ...defaults, labels: true });
            }}>Reset to preset defaults</button>
          </div>
        </RightGlassDrawer>
        {inspectorOpen && selected ? <div className="thinkgraph-entry" role="dialog" aria-label={selected.label}>
          <button type="button" aria-label="Close entry" onClick={() => setInspectorOpen(false)}>×</button>
          <article data-testid="thinkgraph-node-inspector" data-native-id={selected.id}>
            <h4>{selected.label}</h4>
            {typeof selectedProperties.summary === 'string' ? <p>{selectedProperties.summary}</p> : null}
            {Array.isArray(selectedProperties.evidence) ? selectedProperties.evidence.map((item: any) =>
              <section key={item.id}>
                <p>{item.content || item.summary}</p>
                {onRemoveEvidence && typeof item.id === 'string' ? <button type="button"
                  disabled={removingId !== null} onClick={async () => {
                    setRemovingId(item.id);
                    setRemoveError(null);
                    try { await onRemoveEvidence(item.id); }
                    catch (failure) { setRemoveError(failure instanceof Error ? failure.message : String(failure)); }
                    finally { setRemovingId(null); }
                  }}>{removingId === item.id ? 'Removing…' : 'Remove note'}</button> : null}
              </section>) : null}
            {removeError ? <p role="alert">{removeError}</p> : null}
            {selectedRelationships.length ? <ul>{selectedRelationships.map(edge => <li key={edge.id}>
              {projection?.nodes.find(node => node.id === edge.source)?.label} · {edge.predicate} · {projection?.nodes.find(node => node.id === edge.target)?.label}
              {typeof edge.properties?.reason === 'string' && edge.properties.reason ? <p>{edge.properties.reason}</p> : null}
              {typeof edge.properties?.fact === 'string' && edge.properties.fact ? <p>{edge.properties.fact}</p> : null}
            </li>)}</ul> : null}
          </article>
        </div> : null}
      </> : <RightGlassDrawer
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
        {selected ? <section data-testid={`${authority}-node-inspector`} data-native-id={selected.canonicalId || selected.id}>
          <h4>{selected.label}</h4>
          {typeof selectedProperties.fullContent === 'string' ? <p>{selectedProperties.fullContent}</p> : typeof selectedProperties.summary === 'string' ? <p>{selectedProperties.summary}</p> : null}
          {selectedSource?.summary ? <p>{selectedSource.summary}</p> : null}
          {Array.isArray(selectedProperties.question_links) ? selectedProperties.question_links.map((encoded, index) => {
            let link: any;
            try { link = typeof encoded === 'string' ? JSON.parse(encoded) : encoded; } catch { return null; }
            return link?.questionRef?.nativeId ? <p key={index}>Question: {link.questionRef.nativeId} · {link.relation} · {String(link.outcome || '').replaceAll('_', ' ')}</p> : null;
          }) : null}
        </section> : null}
        {selectedRelationships.length ? <section className="knowgraph-relationships">{selectedRelationships.filter(edge => edge.predicate !== 'MENTIONS').map(edge => <button key={edge.id} onClick={() => { setSelectedId(null); setSelectedEdgeId(edge.id); }}>
          <strong>{projection?.nodes.find(node => node.id === edge.source)?.label}</strong>
          <span>{edge.predicate.replaceAll('_', ' ').toLowerCase()}</span>
          <strong>{projection?.nodes.find(node => node.id === edge.target)?.label}</strong>
        </button>)}</section> : null}
        {selectedEdge ? <section data-testid={`${authority}-edge-inspector`} data-native-id={selectedEdge.id}>
          <h4>{projection?.nodes.find((node) => node.id === selectedEdge.source)?.label} → {selectedEdge.predicate} → {projection?.nodes.find((node) => node.id === selectedEdge.target)?.label}</h4>
          {typeof selectedEdge.properties?.fact === 'string' ? <p>{selectedEdge.properties.fact}</p> : null}
          {typeof selectedEdge.properties?.summary === 'string' ? <p>{selectedEdge.properties.summary}</p> : null}
          {typeof selectedEdge.properties?.reason === 'string' ? <p>{selectedEdge.properties.reason}</p> : null}
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
      </RightGlassDrawer>}
    </div>
  );
}
