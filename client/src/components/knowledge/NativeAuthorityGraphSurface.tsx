import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import '../../vendor/engraphis/vendor/d3.min.js';
import '../../vendor/engraphis/vendor/force-graph.min.js';
import '../../vendor/engraphis/engraphis-graph.js';

import type { GraphData } from '../../vendor/codebase-memory-ui/src/lib/types';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import {
  applyJevGraphPhysics,
  JEV_GRAPH_PHYSICS_PROFILE_LABELS,
  JEV_GRAPH_PHYSICS_PROFILES,
  type JevGraphPhysicsProfile,
} from './jevGraphPhysics';
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
  semantic_mass?: number;
  gravity_mass?: number;
  visual_radius?: number;
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
  relation?: string;
  label?: string;
  mentionCount?: number;
  lastMentionedAt?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  provenanceCount?: number;
  validFrom?: string;
  validTo?: string | null;
  relationship_strength?: number;
  label_confidence?: number;
  strength?: number;
  spring_strength?: number;
  rest_length?: number;
  visual_width?: number;
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

type NativeLayout = 'compact' | 'original' | 'communities' | 'radial' | 'galaxy';
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

function nativeEntryTime(value: unknown): { dateTime: string; label: string } | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const milliseconds = Number.isFinite(numeric)
    ? numeric * (Math.abs(numeric) < 10_000_000_000 ? 1_000 : 1)
    : Date.parse(String(value));
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return { dateTime: date.toISOString(), label: date.toLocaleString() };
}

function probabilityLabel(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${(Math.max(0, Math.min(1, numeric)) * 100).toFixed(1)}%`;
}

function compactProbability(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric)).toFixed(2).replace(/^0/, '');
}

function thinkMetadata(item: Record<string, any>): Record<string, any> {
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const structured = metadata.structured_extraction;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return {};
  const think = structured.think;
  return think && typeof think === 'object' && !Array.isArray(think) ? think : {};
}

function thinkStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function ThinkGraphThink({
  item,
  heading,
  removing = false,
  onRemove,
}: {
  item: Record<string, any>;
  heading: string;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const think = thinkMetadata(item);
  const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : {};
  const entryTime = nativeEntryTime(item.ingestedAt);
  const summary = typeof think.summary === 'string' && think.summary.trim()
    ? think.summary
    : typeof item.summary === 'string' && item.summary.trim()
      ? item.summary
      : typeof item.content === 'string' && item.content.trim()
        ? item.content
        : null;
  const keywords = thinkStrings(metadata.keywords);
  const concepts = thinkStrings(think.concepts);
  const semanticSections = ([
    ['Propositions', thinkStrings(think.propositions)],
    ['Questions', thinkStrings(think.questions)],
    ['Predictions', thinkStrings(think.predictions)],
    ['Assumptions', thinkStrings(think.assumptions)],
    ['Preferences', thinkStrings(think.preferences)],
    ['Corrections', thinkStrings(think.corrections)],
    ['Uncertainty', thinkStrings(think.uncertainty)],
    ['Relationship observations', thinkStrings(think.relationship_observations)],
  ] as const).filter(([, values]) => values.length > 0);
  const properties = Array.isArray(think.properties)
    ? think.properties.filter((property: unknown): property is { name: string; value: unknown } => {
      if (!property || typeof property !== 'object' || Array.isArray(property)) return false;
      const candidate = property as Record<string, unknown>;
      return typeof candidate.name === 'string' && candidate.name.trim().length > 0
        && candidate.value !== null && candidate.value !== undefined && String(candidate.value).trim().length > 0;
    })
    : [];
  const importance = Number(think.importance);
  return <section className="graph-note graph-think" data-memory-id={item.id}>
    <div className="graph-think-heading">
      <h4>{heading}</h4>
      {typeof think.kind === 'string' && think.kind ? <span>{think.kind}</span> : null}
    </div>
    {entryTime ? <time dateTime={entryTime.dateTime}>{entryTime.label}</time> : null}
    {summary ? <p>{summary}</p> : null}
    {Number.isFinite(importance) ? <dl className="graph-think-fields">
      <div><dt>Importance</dt><dd>{String(importance)}</dd></div>
    </dl> : null}
    {properties.length ? <section className="graph-think-section">
      <h5>Properties</h5>
      <dl>{properties.map(property => <div key={`${property.name}:${String(property.value)}`}>
        <dt>{property.name}</dt><dd>{String(property.value)}</dd>
      </div>)}</dl>
    </section> : null}
    {semanticSections.map(([label, values]) => <section className="graph-think-section" key={label}>
      <h5>{label}</h5><ul>{values.map(value => <li key={value}>{value}</li>)}</ul>
    </section>)}
    {keywords.length ? <section className="graph-think-section">
      <h5>Keywords</h5><p>{keywords.join(' · ')}</p>
    </section> : null}
    {concepts.length ? <section className="graph-think-section">
      <h5>Concepts</h5><p>{concepts.join(' · ')}</p>
    </section> : null}
    {onRemove ? <button type="button" disabled={removing} onClick={onRemove}>
      {removing ? 'Removing…' : 'Remove Think'}
    </button> : null}
  </section>;
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
  const [physicsProfile, setPhysicsProfile] = useState<JevGraphPhysicsProfile>('balanced');
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const [expanding, setExpanding] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [paperViewport, setPaperViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const displayProjection = useMemo(
    () => projection ? applyJevGraphPhysics(projection, physicsProfile) : null,
    [physicsProfile, projection],
  );
  const selected = displayProjection?.nodes.find(node => node.id === selectedId);
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
    const data = displayProjection?.scene || {
      nodes: displayProjection?.nodes || [],
      links: (displayProjection?.edges || []).map(edge => {
        if (authority !== 'thinkgraph') return { ...edge, relation: edge.predicate };
        const jev = edge.properties?.jev;
        const distribution = jev && typeof jev === 'object' && !Array.isArray(jev)
          && (jev as Record<string, unknown>).distribution
          && typeof (jev as Record<string, unknown>).distribution === 'object'
          ? (jev as Record<string, any>).distribution as Record<string, unknown>
          : null;
        const winner = jev && typeof jev === 'object' && !Array.isArray(jev)
          ? String((jev as Record<string, unknown>).winner || edge.predicate)
          : edge.predicate;
        const probability = compactProbability(
          distribution?.[winner]
            ?? edge.properties?.relationship_strength
            ?? edge.relationship_strength,
        );
        return {
          ...edge,
          relation: edge.predicate,
          label: `${winner}${probability ? ` · ${probability}` : ''}`,
          label_min_scale: 0.35,
          directional_arrow_length: 3,
          directional_arrow_rel_pos: 0.9,
        };
      }),
    };
    graphRef.current?.setData(data);
  }, [displayProjection, authority]);

  useEffect(() => {
    graphRef.current?.setHighlight(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId && !displayProjection?.nodes.some(node => node.id === selectedId)) {
      setSelectedId(null);
      setInspectorOpen(false);
      setControlsOpen(true);
    }
    if (selectedEdgeId && !displayProjection?.edges.some(edge => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
      setInspectorOpen(false);
      setControlsOpen(true);
    }
  }, [displayProjection, selectedId, selectedEdgeId]);

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

  const allNodes = displayProjection?.nodes.length ?? 0;
  const selectedEdge = displayProjection?.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedNative = displayProjection?.nodes.find(node => node.id === selected?.id);
  const selectedSource = selectedNative ? sourceDocument(selectedNative) : null;
  const selectedRelationships = selected ? displayProjection?.edges.filter(edge => edge.source === selected.id || edge.target === selected.id) || [] : [];
  const evidenceIds = new Set<string>(selected ? [selected.id] : []);
  for (const edge of selectedEdge ? [selectedEdge] : selectedRelationships) {
    for (const value of [edge.properties?.episodes, edge.properties?.supportingEpisodeUuids]) {
      for (const id of Array.isArray(value) ? value : typeof value === 'string' ? [value] : []) {
        evidenceIds.add(String(id));
      }
    }
    if (edge.predicate === 'MENTIONS') evidenceIds.add(edge.source);
  }
  const evidence = (displayProjection?.nodes || []).filter(node => evidenceIds.has(node.id)).map(node => ({ node, ...sourceDocument(node) })).filter(item => item.links.length);
  const selectedEvidence = (selectedEdge?.properties || selectedProperties).evidence;
  const evidenceRecords = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item): item is Record<string, any> =>
    item !== null && typeof item === 'object' && typeof item.id === 'string') : [];
    const thinks = authority === 'thinkgraph' && selected && !selectedEdge
      ? evidenceRecords.filter(item => item.metadata !== null
        && typeof item.metadata === 'object'
        && item.metadata.structured_extraction !== null
        && typeof item.metadata.structured_extraction === 'object'
        && item.metadata.structured_extraction.think !== null
        && typeof item.metadata.structured_extraction.think === 'object')
      : evidenceRecords;
    const latestThink = authority === 'thinkgraph' && selected && !selectedEdge
      ? thinks[0] : null;
  const entryTitle = selected?.label || (selectedEdge ? selectedEdge.predicate : '');
  const nativeLabel = (id: string) => displayProjection?.nodes.find(node => node.id === id)?.label || id;
  const relationshipStrength = probabilityLabel(selectedEdge?.properties?.relationship_strength);
  const labelConfidence = probabilityLabel(selectedEdge?.properties?.label_confidence);
  const portableKnow = authority === 'knowgraph'
    && selectedEdge?.properties?.portableKind === 'know'
    ? selectedEdge.properties
    : null;
  const jev = selectedEdge?.properties?.jev
    && typeof selectedEdge.properties.jev === 'object'
    && !Array.isArray(selectedEdge.properties.jev)
    ? selectedEdge.properties.jev as Record<string, unknown>
    : null;
  const jevDistribution = jev?.distribution
    && typeof jev.distribution === 'object'
    ? Object.entries(jev.distribution as Record<string, unknown>)
      .filter((entry): entry is [string, number] => Number.isFinite(Number(entry[1])))
    : [];
  const jevWinner = jev ? String(jev.winner || selectedEdge?.predicate || '') : '';
  const naturalRelationship = jev && typeof jev.natural_relationship === 'string'
    ? jev.natural_relationship
    : '';
  const jevWinnerProbability = probabilityLabel(
    jevDistribution.find(([choice]) => choice === jevWinner)?.[1],
  );
  return (
    <div data-testid={`native-${authority}-surface`} className="native-authority-graph" data-layout={layout} data-style={style} data-physics-profile={physicsProfile} data-panel-open={controlsOpen || inspectorOpen} aria-busy={status === 'loading'}
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
            <label>Physics profile<select aria-label="Physics profile" value={physicsProfile} onChange={event => {
              setPhysicsProfile(event.target.value as JevGraphPhysicsProfile);
            }}>
              {JEV_GRAPH_PHYSICS_PROFILES.map(profile => <option key={profile} value={profile}>
                {JEV_GRAPH_PHYSICS_PROFILE_LABELS[profile]}
              </option>)}
            </select></label>
            <label>Layout<select aria-label="Layout" value={layout} onChange={event => {
              const next = event.target.value as NativeLayout;
              const defaults = graphRef.current?.setPreset(next);
              setLayout(next); setSettings(current => ({ ...current, ...defaults }));
            }}>
              <option value="compact">Compact</option><option value="original">Original</option>
              <option value="communities">Communities</option><option value="radial">Radial</option>
              <option value="galaxy">Galaxy gravity</option>
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
          {authority === 'knowgraph' ? (['statement', 'fact', 'content', 'summary', 'reason'] as const).map(key => selectedProperties[key])
            .filter((value, index, values): value is string => typeof value === 'string' && !!value && values.indexOf(value) === index)
            .map(value => <p key={value}>{value}</p>) : null}
          {authority === 'knowgraph' && selectedSource?.summary ? <p>{selectedSource.summary}</p> : null}
        </article> : null}
        {latestThink ? <ThinkGraphThink
          item={latestThink}
          heading="Latest Think"
          removing={removingId === latestThink.id}
          onRemove={authority === 'thinkgraph' && onRemoveEvidence ? async () => {
            setRemovingId(latestThink.id); setRemoveError(null);
            try { await onRemoveEvidence(latestThink.id); }
            catch (failure) { setRemoveError(failure instanceof Error ? failure.message : String(failure)); }
            finally { setRemovingId(null); }
          } : undefined}
        /> : null}
        {thinks.length > 1 ? <details className="graph-think-history">
          <summary>Earlier Thinks ({thinks.length - 1})</summary>
          <div>{thinks.slice(1).map((item, index) => <ThinkGraphThink
            key={item.id}
            item={item}
            heading={`Earlier Think ${index + 1}`}
          />)}</div>
        </details> : null}
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
        {selectedEdge ? <dl className="graph-record-fields graph-edge-meaning">
          <div><dt>Direction</dt><dd>{nativeLabel(selectedEdge.source)} → {nativeLabel(selectedEdge.target)}</dd></div>
          {jevWinner ? <div><dt>Jev winner</dt><dd>{jevWinner}</dd></div> : null}
          {jevWinnerProbability ? <div><dt>Probability</dt><dd>{jevWinnerProbability}</dd></div> : null}
          {naturalRelationship ? <div><dt>Natural extracted relationship</dt><dd>{naturalRelationship}</dd></div> : null}
          {!jevWinnerProbability && relationshipStrength ? <div><dt>Relationship strength</dt><dd>{relationshipStrength}</dd></div> : null}
          {!jevWinnerProbability && labelConfidence ? <div><dt>Label confidence</dt><dd>{labelConfidence}</dd></div> : null}
        </dl> : null}
        {portableKnow ? <section className="graph-note" data-testid="portable-know">
          <h4>{portableKnow.temporalStatus === 'historical' ? 'Historical Know' : 'Current Know'}</h4>
          {typeof portableKnow.fact === 'string' && portableKnow.fact
            ? <p>{portableKnow.fact}</p> : null}
          <dl className="graph-record-fields">
            {portableKnow.nativeRelation ? <div><dt>Native Graphiti relation</dt><dd>{String(portableKnow.nativeRelation)}</dd></div> : null}
            {jev?.status === 'success' && jev.winner ? <div><dt>Jev canonical relation</dt><dd>{String(jev.winner)}</dd></div> : null}
            {jev?.status && jev.status !== 'success' ? <div><dt>Jev classification</dt><dd>{String(jev.status)}</dd></div> : null}
            {([
              ['Learned', portableKnow.createdAt],
              ['Reference time', portableKnow.referenceTime],
              ['Valid from', portableKnow.validAt],
              ['Invalid from', portableKnow.invalidAt],
              ['Expired', portableKnow.expiredAt],
            ] as const).map(([label, value]) => value
              ? <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>
              : null)}
          </dl>
        </section> : null}
        {jevDistribution.length ? <details className="graph-jev-distribution" open>
          <summary>Jev relationship probabilities</summary>
          <dl>{jevDistribution.map(([choice, probability]) => {
            const probabilityText = probabilityLabel(probability) || '0.0%';
            return <div key={choice} data-winner={choice === jevWinner}>
              <dt>{choice}</dt><dd>
                <span className="graph-jev-probability-track" aria-hidden="true">
                  <span className="graph-jev-probability-fill" style={{ width: probabilityText }} />
                </span>
                <span>{probabilityText}</span>
              </dd>
            </div>;
          })}</dl>
        </details> : null}
        {removeError ? <p role="alert">{removeError}</p> : null}
        {evidence.length ? <section className="knowgraph-sources"><h4>Sources</h4>{evidence.map(({ node, links }) =>
          <details key={node.id}>
            <summary>{node.label}</summary>
            {links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}
            {typeof node.properties?.content === 'string' ? <pre>{node.properties.content}</pre> : null}
          </details>)}</section> : null}
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
