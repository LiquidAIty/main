/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file owns the single renderer lifecycle, camera, settings, selection and Inspector shared by the Project graph views.
 * Entity: ThinkGraph
 * Relationship: This file renders exact Engraphis nodes, relationships, Think records, native mention references, Jev provenance, and confirmed removal actions.
 * Entity: KnowGraph
 * Relationship: This file renders exact Graphiti Entities, relationships, atomic and historical Knows, sources, and confirmed episode removal actions.
 * Entity: CodeGraph
 * Relationship: This file renders category-selected Code Files, loads directed CBM connections, loads exact source on request, and mounts CodeGraph review controls in its existing Inspector.
 * Entity: Jev Decisions
 * Relationship: This file presents validated relationship probabilities as transient physics without writing graph meaning.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import '../../vendor/engraphis/vendor/d3.min.js';
import '../../vendor/engraphis/vendor/force-graph.min.js';
import '../../vendor/engraphis/engraphis-graph.js';

import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import { GRAPH_THEME } from '../graph/graphVisualTokens';
import {
  applyJevGraphPhysics,
  type JevGraphPhysicsProfile,
} from './jevGraphPhysics';
import {
  createPersistedEntityMentionMatcher,
  resolveCanonicalEntityFocusVisualId,
  type CanonicalEntityFocusRequest,
  type CanonicalEntityFocusTarget,
} from '../builder/canonicalEntityLinks';
import {
  DEFAULT_SOLARPUNK_COLORS,
  CODE_GRAPH_LAYER_COLOR,
  DEFAULT_GRAPH_LAYER_VISIBILITY,
  composeVisibleGraphLayers,
  providerMemberKey,
  solarpunkMaterialFields,
  combinedCyberMaterialFields,
  visualSourceKind,
  type GraphAuthority,
  type GraphLayerVisibility,
  type GraphProjectionEdge,
  type GraphProjectionNode,
  type GraphProjectionV1,
  type GraphSurfaceAuthority,
  type JoinedGraphEdgeVariant,
  type JoinedGraphNodeVariant,
  type JoinedGraphPresentation,
} from './knowledgeGraphProjection';
import {
  applyCodeGraphPhysics,
  codeGraphCategoryProjection,
  codeGraphFeatures,
  type CodeGraphFileSource,
} from './codeGraphProjection';
import {
  solarpunkEdgeFields,
  withoutSolarpunkEdgeMaterial,
  withoutSolarpunkMaterial,
  type PresentationStyle,
  type RendererLayout,
  type RendererStyle,
} from './knowledgeGraphPresentationPreferences';
import {
  INSPECTOR_RECORD_LIMIT,
  CodeGraphNodeDetails,
  KnowGraphKnow,
  KnowSourceList,
  ThinkRecordCard,
  SourceSearchControls,
  compactProbability,
  graphEntryTime,
  knowEvidenceIdentity,
  probabilityLabel,
  type KnowInspectorRecord,
} from './KnowledgeGraphInspector';
import type { CanonicalEntityDirectory } from './canonicalEntityDirectory';
import { CodeGraphChangeReview } from './CodeGraphChangeReview';
import './knowledgeAuthorityGraphSurface.css';

export function JoinedKnowledgeGraphSurface({
  projections,
  statuses,
  errors,
  codeGraph,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  entityFocusRequest,
  onOpenCodeGraph,
  onReadCodeGraphFiles,
  onReadCodeGraphSource,
}: {
  projections: Record<GraphAuthority, GraphProjectionV1>;
  statuses?: Partial<Record<GraphAuthority, 'idle' | 'loading' | 'ready' | 'error'>>;
  errors?: Partial<Record<GraphAuthority, string>>;
  codeGraph?: {
    projection: GraphProjectionV1;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
    warning: string | null;
    freshness: string;
  };
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
  onOpenCodeGraph?: () => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphFiles?: (filePaths: string[]) => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphSource?: (filePath: string) => Promise<CodeGraphFileSource | null>;
}) {
  const [layerVisibility, setLayerVisibility] = useState<GraphLayerVisibility>(() => ({
    ...DEFAULT_GRAPH_LAYER_VISIBILITY,
  }));
  const [codeFeatureIds, setCodeFeatureIds] = useState<string[]>([]);
  const [codeConnections, setCodeConnections] = useState('');
  const codeLayer = codeGraph || {
    projection: {
      schemaVersion: 'codegraph.projection.v1',
      authority: 'codegraph',
      projectId: projections.thinkgraph.projectId || projections.knowgraph.projectId,
      counts: { nodes: 0, edges: 0 },
      nodes: [],
      edges: [],
    },
    status: 'idle' as const,
    error: null,
    warning: null,
    freshness: 'unverified',
  };
  useEffect(() => {
    setCodeFeatureIds([]);
  }, [codeLayer.projection.projectId]);
  const visibleCodeProjection = useMemo(
    () => codeGraphCategoryProjection(codeLayer.projection, codeFeatureIds),
    [codeFeatureIds, codeLayer.projection],
  );
  const codeFeatures = useMemo(() => codeGraphFeatures(codeLayer.projection), [codeLayer.projection]);
  const selectedPathsKey = JSON.stringify([...new Set(codeFeatures
    .filter(feature => codeFeatureIds.includes(feature.id))
    .flatMap(feature => Array.isArray(feature.properties?.memberFilePaths)
      ? feature.properties.memberFilePaths.filter((path): path is string => typeof path === 'string') : []))].sort());
  useEffect(() => {
    let cancelled = false;
    const paths: string[] = JSON.parse(selectedPathsKey);
    if (!layerVisibility.codegraph || !onReadCodeGraphFiles || !paths.length) {
      setCodeConnections('');
      return;
    }
    setCodeConnections(`Reading connections · ${paths.length} selected files`);
    void onReadCodeGraphFiles(paths).then(result => {
      if (cancelled) return;
      const complete = result?.nodes.filter(node => node.properties?.structuralComplete === true).length;
      setCodeConnections(complete === paths.length
        ? `Connections read · ${paths.length} files`
        : 'Connections incomplete. Select a file to inspect or retry.');
    }).catch(error => {
      if (!cancelled) setCodeConnections(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [layerVisibility.codegraph, selectedPathsKey, onReadCodeGraphFiles, codeLayer.projection.projectId]);
  const presentation = useMemo(
    () => composeVisibleGraphLayers(
      projections.thinkgraph,
      projections.knowgraph,
      visibleCodeProjection,
      layerVisibility,
    ),
    [layerVisibility, projections.knowgraph, projections.thinkgraph, visibleCodeProjection],
  );
  const visibleStatuses = [
    ...(layerVisibility.thinkgraph
      ? [errors?.thinkgraph ? 'error' : statuses?.thinkgraph || 'ready']
      : []),
    ...(layerVisibility.knowgraph
      ? [errors?.knowgraph ? 'error' : statuses?.knowgraph || 'ready']
      : []),
    ...(layerVisibility.codegraph ? [codeLayer.error ? 'error' : codeLayer.status] : []),
  ];
  const authorityErrors = [
    ...(layerVisibility.thinkgraph && errors?.thinkgraph
      ? [`ThinkGraph unavailable: ${errors.thinkgraph}`]
      : []),
    ...(layerVisibility.knowgraph && errors?.knowgraph
      ? [`KnowGraph unavailable: ${errors.knowgraph}`]
      : []),
    ...(layerVisibility.codegraph && codeLayer.error
      ? [`CodeGraph unavailable: ${codeLayer.error}`]
      : []),
  ];
  const authorityWarnings = [
    ...authorityErrors,
    ...(layerVisibility.codegraph && codeLayer.warning ? [codeLayer.warning] : []),
  ];
  const status = visibleStatuses.length === 0
    ? 'ready'
    : visibleStatuses.every(value => value === 'error')
    ? 'error'
    : visibleStatuses.some(value => value === 'ready')
      ? 'ready'
      : visibleStatuses.some(value => value === 'loading')
        ? 'loading'
        : 'idle';
  const error = status === 'error'
    ? authorityErrors.join(' · ')
    : null;
  const warning = status !== 'error' && authorityWarnings.length
    ? authorityWarnings.join(' · ')
    : null;
  const setLayerVisible = (layer: keyof GraphLayerVisibility, visible: boolean) => {
    setLayerVisibility(current => ({ ...current, [layer]: visible }));
    if (layer === 'codegraph' && visible && codeLayer.status !== 'loading' && onOpenCodeGraph) {
      void onOpenCodeGraph();
    }
  };
  return (
    <KnowledgeGraphProjectionSurface
      authority="joined"
      canonicalEntityDirectory={
        projections.thinkgraph.canonicalEntityDirectory
      }
      entityFocusRequest={entityFocusRequest}
      projection={presentation.projection}
      joinedPresentation={presentation}
      status={status}
      error={error}
      warning={warning}
      onRemoveEvidence={onRemoveThinkGraphEvidence}
      onRemoveKnowEvidence={onRemoveKnowGraphEvidence}
      onReadCodeGraphFiles={onReadCodeGraphFiles}
      onReadCodeGraphSource={onReadCodeGraphSource}
      codeFeatures={codeFeatures}
      selectedCodeFeatureIds={codeFeatureIds}
      onToggleCodeGraphFeature={(featureId) => {
        setCodeFeatureIds(current => current.includes(featureId)
          ? current.filter(id => id !== featureId) : [...current, featureId]);
      }}
      onClearCodeGraphFeature={() => setCodeFeatureIds([])}
      onSelectAllCodeGraphFeatures={() => setCodeFeatureIds(codeFeatures.map(feature => feature.id))}
      layerVisibility={layerVisibility}
      onLayerVisibilityChange={setLayerVisible}
      onResetLayerVisibility={() => {
        setCodeFeatureIds([]);
        setLayerVisibility({ ...DEFAULT_GRAPH_LAYER_VISIBILITY });
      }}
      layerCounts={{
        thinkgraph: projections.thinkgraph.nodes.length,
        knowgraph: projections.knowgraph.nodes.length,
        codegraph: visibleCodeProjection.nodes.length,
      }}
      codeLayerStatus={codeLayer.status}
      codeLayerFreshness={codeLayer.freshness}
      codeConnections={codeConnections}
    />
  );
}

type EngraphisRenderer = {
  setPreset: (name: RendererLayout) => Record<string, number | boolean | string>;
  setStyle: (name: RendererStyle) => void;
  setSettings: (settings: Record<string, number | boolean | string>) => void;
  setData: (data: { nodes: unknown[]; links?: unknown[]; edges?: unknown[] }) => void;
  setHighlight: (id: string | null) => void;
  setThemeColors: (colors: Record<string, string>) => void;
  setColorBy: (name: string) => void;
  setTypeColors: (colors: Record<string, string>) => void;
  graphToScreen: (x: number, y: number) => { x: number; y: number };
  fit: () => void;
  resize: () => void;
  freeze: (on: boolean) => void;
  reheat: () => void;
  setCollapse: (mode: boolean | 'auto') => void;
  destroy: () => void;
};

declare global {
  interface Window {
    EngraphisGraph: { create: (host: HTMLElement, options: {
      onNodeClick: (node: { id: string }) => void;
      onNodeDoubleClick?: (node: { id: string }) => void;
      onLinkClick: (link: { id: string }) => void;
      onBackgroundClick: () => void;
    }) => EngraphisRenderer };
  }
}

export function KnowledgeGraphProjectionSurface({
  projection,
  status,
  error,
  warning,
  authority = 'knowgraph',
  joinedPresentation,
  onRemoveEvidence,
  onRemoveKnowEvidence,
  canonicalEntityDirectory,
  entityFocusRequest,
  onReadCodeGraphFiles,
  onReadCodeGraphSource,
  codeFeatures,
  selectedCodeFeatureIds,
  onToggleCodeGraphFeature,
  onClearCodeGraphFeature,
  onSelectAllCodeGraphFeatures,
  layerVisibility,
  onLayerVisibilityChange,
  onResetLayerVisibility,
  layerCounts,
  codeLayerStatus,
  codeLayerFreshness,
  codeConnections,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  warning?: string | null;
  authority?: GraphSurfaceAuthority;
  joinedPresentation?: JoinedGraphPresentation;
  onRemoveEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowEvidence?: (episodeId: string) => Promise<void>;
  canonicalEntityDirectory?: CanonicalEntityDirectory | null;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
  onReadCodeGraphFiles?: (filePaths: string[]) => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphSource?: (filePath: string) => Promise<CodeGraphFileSource | null>;
  codeFeatures?: GraphProjectionNode[];
  selectedCodeFeatureIds?: string[];
  onToggleCodeGraphFeature?: (featureId: string) => void;
  onClearCodeGraphFeature?: () => void;
  onSelectAllCodeGraphFeatures?: () => void;
  layerVisibility?: GraphLayerVisibility;
  onLayerVisibilityChange?: (
    layer: keyof GraphLayerVisibility,
    visible: boolean,
  ) => void;
  onResetLayerVisibility?: () => void;
  layerCounts?: Record<keyof GraphLayerVisibility, number>;
  codeLayerStatus?: 'idle' | 'loading' | 'ready' | 'error';
  codeLayerFreshness?: string;
  codeConnections?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<EngraphisRenderer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<GraphAuthority | 'codegraph' | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [selectedKnowEpisodeId, setSelectedKnowEpisodeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const codeOnly = authority === 'codegraph' || (authority === 'joined'
    && layerVisibility?.codegraph === true
    && !layerVisibility.thinkgraph && !layerVisibility.knowgraph);
  const layout: RendererLayout = codeOnly ? 'communities' : 'compact';
  const style: PresentationStyle = codeOnly ? 'cyber' : 'solarpunk';
  const physicsProfile: JevGraphPhysicsProfile = 'galaxy';
  const solarpunkColors = DEFAULT_SOLARPUNK_COLORS;
  const inspectNodeRef = useRef<(id: string) => void>(() => undefined);
  const consumedEntityFocusRequestRef = useRef<number | null>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [codeSource, setCodeSource] = useState<CodeGraphFileSource | null>(null);
  const [codeSourceLoading, setCodeSourceLoading] = useState(false);
  const [codeSourceError, setCodeSourceError] = useState<string | null>(null);
  const [codeFileLoading, setCodeFileLoading] = useState(false);
  const [codeFileError, setCodeFileError] = useState<string | null>(null);
  const codeSourceSelectionRef = useRef(0);
  const [paperViewport, setPaperViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const activeJoinedPresentation = joinedPresentation;
  const displayProjection = useMemo(() => projection
    ? applyCodeGraphPhysics(authority === 'codegraph' ? projection : applyJevGraphPhysics(projection, physicsProfile))
    : null, [authority, physicsProfile, projection]);
  const selectedVisual = displayProjection?.nodes.find(node => node.id === selectedId);
  const availableCodeNode = authority === 'codegraph'
    ? selectedVisual
    : selectedVisual && authority === 'joined'
      ? activeJoinedPresentation?.codeNodeVariants?.get(selectedVisual.id)
      : undefined;
  const selectedNodeVariants: JoinedGraphNodeVariant[] = selectedVisual
    && authority !== 'codegraph'
    ? activeJoinedPresentation?.nodeVariants.get(selectedVisual.id)
      || (authority !== 'joined' ? [{ authority, node: selectedVisual }] : [])
    : [];
  const directThinkAvailable = selectedNodeVariants.some(
    variant => variant.authority === 'thinkgraph',
  );
  const directKnowAvailable = selectedNodeVariants.some(
    variant => variant.authority === 'knowgraph',
  );
  const defaultSelectedAuthority = directKnowAvailable
    ? 'knowgraph'
    : directThinkAvailable ? 'thinkgraph' : availableCodeNode ? 'codegraph' : null;
  const inspectedNodeAuthority = selectedAuthority
    && ((selectedAuthority === 'thinkgraph' && directThinkAvailable)
      || (selectedAuthority === 'knowgraph' && directKnowAvailable)
      || (selectedAuthority === 'codegraph' && availableCodeNode))
    ? selectedAuthority
    : defaultSelectedAuthority;
  const selectedAuthorityVariants = selectedNodeVariants.filter(
    variant => variant.authority === inspectedNodeAuthority,
  );
  const selectedNodeVariant = selectedAuthorityVariants.find(
    variant => providerMemberKey(variant.authority, variant.node.id) === selectedMemberKey,
  ) || selectedAuthorityVariants[0];
  const selectedCodeNode = inspectedNodeAuthority === 'codegraph' && availableCodeNode
    ? { ...availableCodeNode, properties: { ...availableCodeNode.properties, ...selectedVisual?.properties } }
    : undefined;
  const selected = selectedCodeNode || selectedNodeVariant?.node;
  const selectedEdgeVisual = displayProjection?.edges.find(edge => edge.id === selectedEdgeId);
  const selectedCodeEdge = authority === 'codegraph'
    ? selectedEdgeVisual
    : selectedEdgeVisual && authority === 'joined'
      ? activeJoinedPresentation?.codeEdgeVariants?.get(selectedEdgeVisual.id)
      : undefined;
  const selectedEdgeVariant: JoinedGraphEdgeVariant | undefined = selectedEdgeVisual
    && !selectedCodeEdge
    && authority !== 'codegraph'
    ? activeJoinedPresentation?.edgeVariants.get(selectedEdgeVisual.id)
      || (authority !== 'joined' ? { authority, edge: selectedEdgeVisual } : undefined)
    : undefined;
  const selectedEdge = selectedCodeEdge || selectedEdgeVariant?.edge;
  const inspectedAuthority: GraphAuthority | 'codegraph' | null = selectedCodeNode || selectedCodeEdge
    ? 'codegraph'
    : selectedEdgeVariant?.authority || selectedNodeVariant?.authority || null;
  const inspectedProjection = authority === 'joined' && inspectedAuthority
    ? inspectedAuthority === 'codegraph'
      ? activeJoinedPresentation?.codeProviderProjection || null
      : activeJoinedPresentation?.providerProjections[inspectedAuthority] || null
    : displayProjection;
  const selectedProperties = selected?.properties || {};
  useEffect(() => {
    codeSourceSelectionRef.current += 1;
    setCodeSource(null);
    setCodeSourceLoading(false);
    setCodeSourceError(null);
    setCodeFileError(null);
  }, [selectedEdgeId, selectedId]);
  const openNodeInspector = (visualNodeId: string) => {
    setControlsOpen(false);
    setRemoveError(null);
    setSelectedMemberKey(null);
    setSelectedKnowEpisodeId(null);
    setSelectedId(visualNodeId);
    setSelectedEdgeId(null);
    setInspectorOpen(true);
    setCodeSource(null);
    setCodeSourceError(null);
  };
  inspectNodeRef.current = openNodeInspector;
  const mentionVisualId = (target: CanonicalEntityFocusTarget) => displayProjection
    ? resolveCanonicalEntityFocusVisualId({ projection: displayProjection,
      joinedPresentation: activeJoinedPresentation, directory: canonicalEntityDirectory,
      request: { ...target, requestId: 1 } })
    : null;
  const openMention = (target: CanonicalEntityFocusTarget) => {
    const visualId = mentionVisualId(target);
    if (!visualId) return;
    openNodeInspector(visualId);
    setSelectedAuthority(target.view === 'all' ? null : target.view);
  };
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
      const inspectNode = (node: { id: string }) => {
        inspectNodeRef.current(node.id);
      };
      const graph = window.EngraphisGraph.create(hostRef.current, {
        onNodeClick: inspectNode,
        onLinkClick: link => {
          setControlsOpen(false);
          setRemoveError(null);
          setSelectedMemberKey(null);
          setSelectedKnowEpisodeId(null);
          setSelectedId(null);
          setSelectedEdgeId(String(link.id));
          setInspectorOpen(true);
        },
        onBackgroundClick: () => {
          setSelectedMemberKey(null);
          setSelectedKnowEpisodeId(null);
          setSelectedId(null);
          setSelectedEdgeId(null);
          setInspectorOpen(false);
          setControlsOpen(authority === 'joined');
        },
      });
      graph.setCollapse(false);
      graph.setStyle('cyber');
      graphRef.current = graph;
      return () => { graph.destroy(); graphRef.current = null; };
    } catch (failure) {
      setRenderError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    }
  }, [authority]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.setPreset(layout);
    graph.setSettings({ labels: true, size: 5, linkw: 1 });
  }, [authority, layout]);

  useEffect(() => {
    if (authority === 'codegraph') return;
    graphRef.current?.setThemeColors(style === 'solarpunk' ? {
      material_blue: solarpunkColors.think,
      material_orange: solarpunkColors.know,
      material_surface: GRAPH_THEME.surface.base,
      accent: solarpunkColors.think,
      solar: solarpunkColors.know,
      surface: GRAPH_THEME.surface.base,
      label: GRAPH_THEME.surface.text,
    } : {});
  }, [authority, solarpunkColors, style]);

  useEffect(() => {
    const host = hostRef.current;
    const graph = graphRef.current;
    if (!host || !graph || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const apply = () => {
      frame = 0;
      graph.resize();
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!controlsOpen) return;
    const scrollHost = panelBodyRef.current?.parentElement;
    if (scrollHost) scrollHost.scrollTop = 0;
  }, [controlsOpen]);

  useEffect(() => {
    // Engraphis scenes retain all engine-owned layout and evidence fields.
    // Graphiti uses the renderer's supported field aliases; no graph is inferred here.
    const scene = displayProjection?.scene;
    const sceneNodes = Array.isArray(scene?.nodes) ? scene.nodes : displayProjection?.nodes || [];
    const sceneLinks = Array.isArray(scene?.links)
      ? scene.links
      : Array.isArray(scene?.edges)
        ? scene.edges
        : displayProjection?.edges || [];
    const projectionEdgesById = new Map((displayProjection?.edges || []).map(edge => [edge.id, edge]));
    const data = {
      ...(scene || {}),
      nodes: sceneNodes.map((rawNode) => {
        const node = rawNode as GraphProjectionNode;
        const codeNode = authority === 'joined'
          ? activeJoinedPresentation?.codeNodeVariants?.get(node.id)
          : null;
        if (codeNode && !activeJoinedPresentation?.nodeVariants.get(node.id)?.length) {
          return withoutSolarpunkMaterial(node);
        }
        if (authority === 'codegraph' || style !== 'solarpunk') {
          return withoutSolarpunkMaterial(node);
        }
        const variants = authority === 'joined'
          ? activeJoinedPresentation?.nodeVariants.get(node.id) || []
          : [{ authority, node }] as JoinedGraphNodeVariant[];
        const sourceKind = authority === 'joined'
          ? visualSourceKind(variants)
          : authority === 'knowgraph' ? 'know' : 'think';
        const thinkActive = typeof node.material_think_active === 'boolean'
          ? node.material_think_active
          : false;
        const knowActive = typeof node.material_know_active === 'boolean'
          ? node.material_know_active
          : false;
        return {
          ...node,
          authority: node.authority || authority,
          ...(authority === 'joined'
            ? combinedCyberMaterialFields(sourceKind, thinkActive, knowActive, solarpunkColors)
            : solarpunkMaterialFields(sourceKind, thinkActive, knowActive, solarpunkColors)),
          material_code_present: node.material_code_present === true,
        };
      }),
      links: sceneLinks.map(rawEdge => {
        const edge = rawEdge as GraphProjectionEdge;
        const projected = projectionEdgesById.get(String(edge.id));
        const properties = { ...(edge.properties || {}), ...(projected?.properties || {}) };
        const semanticEdge = { ...edge, ...(projected || {}), properties };
        const codeEdge = authority === 'joined'
          ? activeJoinedPresentation?.codeEdgeVariants?.get(String(semanticEdge.id))
          : undefined;
        const edgeAuthority: GraphAuthority | 'codegraph' | undefined = authority === 'joined'
          ? codeEdge
            ? 'codegraph'
            : activeJoinedPresentation?.edgeVariants.get(String(semanticEdge.id))?.authority
          : authority === 'codegraph' ? 'codegraph' : authority;
        const materialEdge = edgeAuthority === 'codegraph'
          ? withoutSolarpunkEdgeMaterial(semanticEdge)
          : style === 'solarpunk' && edgeAuthority
          ? { ...semanticEdge, ...solarpunkEdgeFields(edgeAuthority, solarpunkColors) }
          : withoutSolarpunkEdgeMaterial(semanticEdge);
        if (edgeAuthority === 'codegraph') {
          return {
            ...materialEdge,
            relation: materialEdge.predicate,
            label: '',
            hover_label: materialEdge.predicate,
            directional_arrow_length: 3,
            directional_arrow_rel_pos: 0.88,
          };
        }
        if (edgeAuthority !== 'thinkgraph') {
          return {
            ...materialEdge,
            relation: materialEdge.predicate,
            label: '',
            hover_label: materialEdge.predicate,
          };
        }
        const jev = materialEdge.properties?.jev;
        const distribution = jev && typeof jev === 'object' && !Array.isArray(jev)
          && (jev as Record<string, unknown>).distribution
          && typeof (jev as Record<string, unknown>).distribution === 'object'
          ? (jev as Record<string, any>).distribution as Record<string, unknown>
          : null;
        const winner = jev && typeof jev === 'object' && !Array.isArray(jev)
          ? String((jev as Record<string, unknown>).winner || materialEdge.predicate)
          : materialEdge.predicate;
        const probability = compactProbability(
          distribution?.[winner]
            ?? materialEdge.properties?.relationship_strength
            ?? materialEdge.relationship_strength,
        );
        return {
          ...materialEdge,
          relation: materialEdge.predicate,
          label: '',
          hover_label: `${winner}${probability ? ` · ${probability}` : ''}`,
          directional_arrow_length: 3,
          directional_arrow_rel_pos: 0.9,
        };
      }),
    };
    const graph = graphRef.current;
    graph?.setData(data);
  }, [
    activeJoinedPresentation,
    authority,
    displayProjection,
    solarpunkColors,
    style,
  ]);

  useEffect(() => {
    graphRef.current?.setHighlight(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!entityFocusRequest
      || consumedEntityFocusRequestRef.current === entityFocusRequest.requestId
      || !displayProjection
      || authority !== 'joined') return;
    const baseProjection = joinedPresentation?.projection;
    if (!baseProjection) return;
    const visualNodeId = resolveCanonicalEntityFocusVisualId({
      projection: baseProjection,
      joinedPresentation,
      directory: canonicalEntityDirectory,
      request: entityFocusRequest,
    });
    if (!visualNodeId) return;
    if (!displayProjection.nodes.some(node => node.id === visualNodeId)) {
      return;
    }
    consumedEntityFocusRequestRef.current = entityFocusRequest.requestId;
    inspectNodeRef.current(visualNodeId);
    if (entityFocusRequest.graphitiEpisodeId) {
      const knowMember = entityFocusRequest.members.find(
        member => member.authority === 'knowgraph',
      );
      if (knowMember) {
        setSelectedAuthority('knowgraph');
        setSelectedMemberKey(providerMemberKey('knowgraph', knowMember.entityId));
        setSelectedKnowEpisodeId(entityFocusRequest.graphitiEpisodeId);
      }
    }
  }, [
    authority,
    canonicalEntityDirectory,
    displayProjection,
    joinedPresentation,
    projection,
    entityFocusRequest,
  ]);

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
      if (inspectorOpen && panelBodyRef.current) panelBodyRef.current.scrollTop = 0;
      const panel = panelBodyRef.current;
      (panel?.querySelector<HTMLElement>('[tabindex="-1"], .graph-layer-legend button') || panel)?.focus();
    }
  }, [controlsOpen, inspectorOpen, selectedAuthority, selectedEdgeId, selectedId, selectedMemberKey]);

  const closePanel = () => {
    setInspectorOpen(false);
    setControlsOpen(false);
  };
  const deleteThink = async (memoryId: string) => {
    if (!onRemoveEvidence) return;
    setRemovingId(memoryId);
    setRemoveError(null);
    try { await onRemoveEvidence(memoryId); }
    catch (failure) { setRemoveError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setRemovingId(null); }
  };
  const deleteKnow = async (episodeId: string) => {
    if (!onRemoveKnowEvidence) return;
    setRemovingId(episodeId);
    setRemoveError(null);
    try {
      await onRemoveKnowEvidence(episodeId);
      if (selectedVisual) inspectNodeRef.current(selectedVisual.id);
    } catch (failure) {
      setRemoveError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRemovingId(null);
    }
  };
  const loadCodeSource = async (filePath: string) => {
    if (!onReadCodeGraphSource) return;
    const requestId = ++codeSourceSelectionRef.current;
    setCodeSourceLoading(true);
    setCodeSourceError(null);
    try {
      const source = await onReadCodeGraphSource(filePath);
      if (requestId !== codeSourceSelectionRef.current) return;
      if (!source || source.properties.file !== filePath) {
        throw new Error('codegraph_source_identity_mismatch');
      }
      setCodeSource(source);
    } catch (failure) {
      if (requestId !== codeSourceSelectionRef.current) return;
      setCodeSource(null);
      setCodeSourceError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (requestId === codeSourceSelectionRef.current) setCodeSourceLoading(false);
    }
  };
  const allNodes = displayProjection?.nodes.length ?? 0;
  const noVisibleLayers = authority === 'joined'
    && layerVisibility
    && !layerVisibility.thinkgraph
    && !layerVisibility.knowgraph
    && !layerVisibility.codegraph;
  const selectedEvidence = (selectedEdge?.properties || selectedProperties).evidence;
  const evidenceRecords = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item): item is Record<string, any> =>
    item !== null && typeof item === 'object' && typeof item.id === 'string') : [];
  const directThinks = inspectedAuthority === 'thinkgraph' && selected && !selectedEdge
    ? evidenceRecords
    : [];
  const thinks = directThinks.map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = graphEntryTime(left.item.ingestedAt)?.dateTime || '';
      const rightTime = graphEntryTime(right.item.ingestedAt)?.dateTime || '';
      return rightTime.localeCompare(leftTime) || left.index - right.index;
    })
    .map(({ item }) => item);
  const visibleThinks = thinks.slice(0, INSPECTOR_RECORD_LIMIT);
  const entryTitle = selected?.label || (selectedEdge ? selectedEdge.predicate : '');
  const providerNodeLabel = (id: string) => inspectedProjection?.nodes.find(node => node.id === id)?.label || id;
  const directKnowItems: KnowInspectorRecord[] = inspectedAuthority === 'knowgraph' && selected && !selectedEdge
    ? evidenceRecords.flatMap((item): KnowInspectorRecord[] => {
        const episodeId = knowEvidenceIdentity(item);
        if (!episodeId) return [];
        const observation = typeof item.observation === 'string'
          ? item.observation.trim()
          : '';
        const interpretation = typeof item.interpretation === 'string'
          ? item.interpretation.trim()
          : '';
        const citation = item.citation
          && typeof item.citation === 'object'
          && !Array.isArray(item.citation)
          ? item.citation as Record<string, unknown>
          : {};
        const direction = item.direction
          && typeof item.direction === 'object'
          && !Array.isArray(item.direction)
          ? item.direction as Record<string, unknown>
          : {};
        if (!observation || !interpretation || !Object.keys(citation).length) return [];
        const properties = item.properties
          && typeof item.properties === 'object'
          && !Array.isArray(item.properties)
          ? item.properties as Record<string, unknown>
          : {};
        return [{
          episodeId,
          know: {
            title: String(item.title || properties.name || 'Know'),
            kind: 'Know',
            observation,
            interpretation,
            citation,
            ...(Object.keys(direction).length ? { direction } : {}),
            observedAt: item.ingestedAt ?? properties.created_at,
            sourceDate: item.validFrom ?? properties.valid_at,
          },
          episode: { ...properties, ...item },
        }];
      }).sort((left, right) => {
        const leftTime = graphEntryTime(left.know.observedAt)?.dateTime || '';
        const rightTime = graphEntryTime(right.know.observedAt)?.dateTime || '';
        return rightTime.localeCompare(leftTime) || left.episodeId.localeCompare(right.episodeId);
      })
    : [];
  const focusedKnowItem = selectedKnowEpisodeId
    ? directKnowItems.find(item => item.episodeId === selectedKnowEpisodeId)
    : null;
  const visibleKnowItems = (
    focusedKnowItem
      ? [focusedKnowItem, ...directKnowItems.filter(item => item !== focusedKnowItem)]
      : directKnowItems
  ).slice(0, INSPECTOR_RECORD_LIMIT);
  const jev = selectedEdge?.properties?.jev
    && typeof selectedEdge.properties.jev === 'object'
    && !Array.isArray(selectedEdge.properties.jev)
    ? selectedEdge.properties.jev as Record<string, unknown>
    : null;
  const jevDistribution = jev?.distribution
    && typeof jev.distribution === 'object'
    ? Object.entries(jev.distribution as Record<string, unknown>)
      .filter((entry): entry is [string, number] => Number.isFinite(Number(entry[1])))
      .sort((left, right) => Number(right[1]) - Number(left[1]))
    : [];
  const jevWinner = jev ? String(jev.winner || selectedEdge?.predicate || '') : '';
  const naturalRelationship = jev && typeof jev.natural_relationship === 'string'
    ? jev.natural_relationship
    : '';
  const jevWinnerProbability = probabilityLabel(
    jevDistribution.find(([choice]) => choice === jevWinner)?.[1],
  );
  const availableNodeAuthorities = (['thinkgraph', 'knowgraph'] as const)
    .filter(candidate => candidate === 'thinkgraph'
      ? directThinkAvailable
      : directKnowAvailable);
  const visualNodeIdForProvider = (providerId: string) => inspectedAuthority === 'codegraph'
    ? authority === 'joined'
      ? activeJoinedPresentation?.visualNodeIdByCodeProviderMember?.get(providerId) || providerId
      : providerId
    : inspectedAuthority
    ? activeJoinedPresentation?.visualNodeIdByProviderMember.get(
      providerMemberKey(inspectedAuthority, providerId),
    ) || providerId
    : providerId;
  return (
    <div data-testid={`knowledge-${authority}-surface`} className="knowledge-authority-graph" data-layout={layout} data-style={style} data-physics-profile={physicsProfile} data-panel-open={controlsOpen || inspectorOpen} aria-busy={status === 'loading'}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        if (inspectorOpen || controlsOpen) {
          event.stopPropagation();
          closePanel();
        }
      }}>
      <GraphPaperBackground viewport={paperViewport} />
      <div className="knowledge-authority-canvas">
        <div ref={hostRef} className="knowledge-authority-network graph-canvas"
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
        {status === 'error' || renderError ? <div className="knowledge-authority-empty">Graph failed: {renderError || error}</div> : null}
        {status !== 'error' && !renderError && warning ? (
          <div
            role="status"
            data-testid="knowledge-authority-warning"
            style={{
              position: 'absolute', top: 48, left: 12, zIndex: 5,
              maxWidth: 'min(520px, calc(100% - 96px))', padding: '6px 9px', borderRadius: 7,
              background: 'rgba(74, 35, 45, 0.9)', color: '#fecdd3', fontSize: 11,
            }}
          >
            {warning}
          </div>
        ) : null}
        {status === 'ready' && allNodes === 0 ? <div className="knowledge-authority-empty">
          {noVisibleLayers
            ? 'No graph sources enabled.'
            : authority === 'codegraph' ? 'No CodeGraph data available.' : 'No knowledge yet.'}
        </div> : null}
      </div>
        <RightGlassDrawer
          isOpen={controlsOpen || inspectorOpen}
          title={inspectorOpen ? (selectedEdge ? '' : entryTitle) : 'Graph settings'}
          onClose={closePanel}
          onOpen={() => {
            const reopenInspector = Boolean(selectedId || selectedEdgeId);
            setControlsOpen(!reopenInspector);
            setInspectorOpen(reopenInspector);
          }}
          collapsedLabel={null}
          openAriaLabel="Open graph settings"
          movable
          defaultWidth={340} minWidth={280} maxWidth={520}
          storageKey={`liquidaity.drawer.${authority}.width`}
          top={48} right={12} bottom={12} zIndex={6}
        >
          {projection?.projectId && (authority === 'codegraph' || inspectedAuthority === 'codegraph'
            || (!inspectorOpen && layerVisibility?.codegraph)) ? <div className="knowledge-authority-controls">
              <CodeGraphChangeReview key={projection.projectId} projectId={projection.projectId}
                selectedNode={selectedCodeNode || null} />
            </div> : null}
          {layerVisibility?.codegraph && Boolean(codeFeatures?.length) && onToggleCodeGraphFeature ? (
            <details className="knowledge-authority-controls codegraph-categories" open>
              <summary>Code categories · {selectedCodeFeatureIds?.length || 0} / {codeFeatures?.length} selected</summary>
              {codeConnections ? <p role="status">{codeConnections}</p> : null}
              <fieldset aria-label="CodeGraph categories">
                <legend>Load connected files</legend>
                {codeFeatures?.map(feature => (
                  <div key={feature.id} className="codegraph-category-row"><label>
                    <input type="checkbox" checked={selectedCodeFeatureIds?.includes(feature.id) || false}
                      onChange={() => onToggleCodeGraphFeature(feature.id)} />
                    {feature.label}
                  </label></div>
                ))}
              </fieldset>
              <div className="knowledge-authority-actions">
                <button type="button" onClick={onSelectAllCodeGraphFeatures} aria-label="Select all code categories">All</button>
                <button type="button" onClick={onClearCodeGraphFeature} aria-label="Clear category selection">None</button>
              </div>
            </details>
          ) : null}
          {!inspectorOpen ? <div ref={panelBodyRef} className="knowledge-authority-controls" tabIndex={-1}>
            {authority !== 'codegraph' && projection?.projectId ? <SourceSearchControls key={projection.projectId} projectId={projection.projectId} /> : null}
            {authority === 'joined' && layerVisibility && onLayerVisibilityChange
              ? <fieldset className="graph-layer-controls" aria-label="Graph sources">
                <legend>Sources</legend>
                <div className="graph-layer-legend">
                  {([
                    ['thinkgraph', 'Think', solarpunkColors.think],
                    ['knowgraph', 'Know', solarpunkColors.know],
                    ['codegraph', 'Code', CODE_GRAPH_LAYER_COLOR],
                  ] as const).map(([layer, label, color]) => (
                    <button
                      key={layer}
                      type="button"
                      aria-label={`${label} source`}
                      aria-pressed={layerVisibility[layer]}
                      data-layer={layer}
                      onClick={() => onLayerVisibilityChange(layer, !layerVisibility[layer])}
                    >
                      <span className="graph-layer-swatch" style={{ background: color }} aria-hidden="true" />
                      <span>{label}</span>
                      <small>{layerCounts?.[layer] ?? 0}</small>
                    </button>
                  ))}
                </div>
                <small className="graph-layer-scope" data-testid="codegraph-scope">
                  CodeGraph · Repository-scoped
                  {layerVisibility.codegraph
                    ? ` · ${codeLayerStatus || 'idle'} · ${codeLayerFreshness || 'unverified'}`
                    : ''}
                </small>
                {onResetLayerVisibility ? <button
                  type="button"
                  aria-label="Reset graph sources"
                  onClick={onResetLayerVisibility}
                >
                  Reset sources
                </button> : null}
              </fieldset>
              : null}
          </div> : (selected || selectedEdge) ? <div ref={panelBodyRef} className="knowledge-authority-controls" role="region" aria-label={`${entryTitle} details`}>
        {authority === 'joined' && selected && availableNodeAuthorities.length > 0
          && (availableNodeAuthorities.length > 1 || visibleThinks.length > 0 || visibleKnowItems.length > 0) ? (
          <div role="tablist" aria-label={`${selected.label} graph evidence`} style={{ display: 'flex', gap: 6 }}>
            {availableNodeAuthorities.map(candidate => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={candidate === inspectedAuthority}
                onClick={() => {
                  setSelectedAuthority(candidate);
                  setSelectedMemberKey(null);
                  setSelectedKnowEpisodeId(null);
                }}
                style={{
                  minWidth: 72,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${candidate === inspectedAuthority
                    ? GRAPH_THEME.accent.primaryBorder
                    : GRAPH_THEME.drawer.inputBorder}`,
                  background: candidate === inspectedAuthority
                    ? GRAPH_THEME.accent.primarySoft
                    : GRAPH_THEME.drawer.inputBackground,
                  color: candidate === inspectedAuthority
                    ? GRAPH_THEME.surface.text
                    : GRAPH_THEME.drawer.inputMuted,
                  fontWeight: 700,
                }}
              >
                {candidate === 'thinkgraph' ? 'Think' : 'Know'}
              </button>
            ))}
          </div>
        ) : null}
        {selected ? <span className="graph-inspector-entity" tabIndex={-1} aria-hidden="true"
          data-testid={`${inspectedAuthority}-node-inspector`} data-provider-id={selected.id}>
          {selected.label}
        </span> : null}
        {inspectedAuthority === 'codegraph' && selected && !selectedEdge ? <CodeGraphNodeDetails
          node={selected}
          source={codeSource}
          sourceLoading={codeSourceLoading}
          sourceError={codeSourceError}
          onLoadSource={onReadCodeGraphSource ? filePath => { void loadCodeSource(filePath); } : undefined}
          connectionLoading={codeFileLoading}
          connectionError={codeFileError}
          onLoadConnections={onReadCodeGraphFiles ? async () => {
            setCodeFileLoading(true);
            setCodeFileError(null);
            try { await onReadCodeGraphFiles([String(selected.properties?.filePath || '')]); }
            catch (failure) { setCodeFileError(failure instanceof Error ? failure.message : String(failure)); }
            finally { setCodeFileLoading(false); }
          } : undefined}
          connections={inspectedProjection?.edges.flatMap(edge => {
            if (!['CALLS', 'IMPORTS'].includes(edge.predicate)) return [];
            const direction = edge.target === selected.id ? 'incoming' as const
              : edge.source === selected.id ? 'outgoing' as const : null;
            const neighborId = direction === 'incoming' ? edge.source : edge.target;
            const file = inspectedProjection.nodes.find(node => node.id === neighborId);
            return direction && file?.properties?.recordKind === 'file'
              ? [{ filePath: String(file.properties.filePath), direction, kind: edge.predicate }] : [];
          })}
          onOpenFile={path => {
            const file = inspectedProjection?.nodes.find(node => node.properties?.recordKind === 'file'
              && node.properties?.filePath === path);
            if (file) openNodeInspector(visualNodeIdForProvider(file.id));
          }}
        /> : null}
        {visibleThinks.length ? <section className="graph-inspector-records" data-testid="knowledge-think-records">
          <h4>{visibleThinks.length > 1 ? 'Recent Thinks' : 'Recent Think'}</h4>
          {visibleThinks.map(item => <ThinkRecordCard
            key={item.id}
            item={item}
            projectId={projection?.projectId}
            heading="Think"
            renderText={text => createPersistedEntityMentionMatcher(canonicalEntityDirectory, item.mentions)
              ?.segmentMessage('assistant', text).map((segment, index) => segment.target && mentionVisualId(segment.target) ? <button key={index} type="button"
                aria-label={`Open ${segment.text} in graph`}
                style={{ display: 'inline', width: 'auto', margin: 0, padding: 0, border: 0,
                  background: 'transparent', color: 'inherit', font: 'inherit', fontStyle: 'italic',
                  textDecoration: 'underline dotted', textUnderlineOffset: 3, cursor: 'pointer' }}
                onClick={() => { void openMention(segment.target!); }}>{segment.text}</button> : segment.text) || text}
            removing={removingId === item.id}
            onRemove={inspectedAuthority === 'thinkgraph' && onRemoveEvidence
              ? () => { void deleteThink(item.id); }
              : undefined}
          />)}
        </section> : null}
        {inspectedAuthority === 'thinkgraph' && selected && !selectedEdge && !visibleThinks.length
          ? <p>No Think is attached yet.</p>
          : null}
        {inspectedAuthority === 'thinkgraph' && selected && !selectedEdge
          && Array.isArray(selectedProperties.references) && selectedProperties.references.length > 0
          ? <section className="graph-inspector-records" aria-label="Mention references">
            <h4>Mentioned in</h4>
            {selectedProperties.references.map((reference: Record<string, string>) => {
              const target: CanonicalEntityFocusTarget = {
                  projectId: reference.projectId, directorySha256: canonicalEntityDirectory?.sha256 || '',
                  canonicalName: reference.canonicalName, view: 'thinkgraph',
                  members: [{ authority: 'thinkgraph', entityId: reference.engraphisEntityId }],
              };
              return mentionVisualId(target)
                ? <button type="button" key={reference.id} data-reference-memory-id={reference.engraphisMemoryId}
                  onClick={() => openMention(target)}>{reference.title}</button>
                : <p key={reference.id}>{reference.title}</p>;
            })}
          </section>
          : null}
        {visibleKnowItems.length ? <section className="graph-inspector-records" data-testid="knowledge-know-records">
          <h4>{visibleKnowItems.length > 1 ? 'Current Knows' : 'Current Know'}</h4>
          {visibleKnowItems.map((record, index) => <KnowGraphKnow
            key={record.episodeId}
            record={record}
            heading={visibleKnowItems.length > 1 ? `Know ${index + 1}` : 'Know'}
            removing={removingId === record.episodeId}
            onRemove={onRemoveKnowEvidence
              ? () => { void deleteKnow(record.episodeId); }
              : undefined}
          />)}
        </section> : null}
        {inspectedAuthority === 'knowgraph' && selected && !selectedEdge && !visibleKnowItems.length
          ? <p>No Know is attached yet.</p>
          : null}
        {inspectedAuthority === 'knowgraph' && selected && !selectedEdge
          ? <KnowSourceList records={directKnowItems} />
          : null}
        {selectedEdge ? <article data-testid={`${inspectedAuthority}-edge-inspector`} data-provider-id={selectedEdge.id}>
          <h4 tabIndex={-1}>{providerNodeLabel(selectedEdge.source)} → {selectedEdge.predicate} → {providerNodeLabel(selectedEdge.target)}</h4>
          {(['fact', 'summary', 'reason'] as const).map(key => typeof selectedEdge.properties?.[key] === 'string'
            && selectedEdge.properties[key] ? <p key={key}>{String(selectedEdge.properties[key])}</p> : null)}
          <button type="button" onClick={() => {
            const visualId = visualNodeIdForProvider(selectedEdge.source);
            inspectNodeRef.current(visualId);
            setSelectedAuthority(inspectedAuthority === 'codegraph' ? null : inspectedAuthority);
            setSelectedMemberKey(inspectedAuthority && inspectedAuthority !== 'codegraph'
              ? providerMemberKey(inspectedAuthority, selectedEdge.source)
              : null);
          }}>{providerNodeLabel(selectedEdge.source)}</button>
          <button type="button" onClick={() => {
            const visualId = visualNodeIdForProvider(selectedEdge.target);
            inspectNodeRef.current(visualId);
            setSelectedAuthority(inspectedAuthority === 'codegraph' ? null : inspectedAuthority);
            setSelectedMemberKey(inspectedAuthority && inspectedAuthority !== 'codegraph'
              ? providerMemberKey(inspectedAuthority, selectedEdge.target)
              : null);
          }}>{providerNodeLabel(selectedEdge.target)}</button>
        </article> : null}
        {selectedEdge ? <dl className="graph-record-fields graph-edge-meaning">
          <div><dt>Direction</dt><dd>{providerNodeLabel(selectedEdge.source)} → {providerNodeLabel(selectedEdge.target)}</dd></div>
          {selectedCodeEdge && typeof selectedCodeEdge.properties?.relationship === 'string'
            ? <div><dt>Declared relationship</dt><dd>{selectedCodeEdge.properties.relationship}</dd></div> : null}
          {selectedCodeEdge && typeof selectedCodeEdge.properties?.evidence === 'string'
            ? <div><dt>Relationship source</dt><dd>{selectedCodeEdge.properties.evidence}</dd></div> : null}
          {jevWinner ? <div><dt>Jev winner</dt><dd>{jevWinner}</dd></div> : null}
          {jevWinnerProbability ? <div><dt>Probability</dt><dd>{jevWinnerProbability}</dd></div> : null}
          {naturalRelationship ? <div><dt>Natural extracted relationship</dt><dd>{naturalRelationship}</dd></div> : null}
        </dl> : null}
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
      </div> : null}
        </RightGlassDrawer>
    </div>
  );
}
