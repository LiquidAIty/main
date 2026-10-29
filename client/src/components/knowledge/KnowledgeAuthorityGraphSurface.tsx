/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file owns the single renderer lifecycle, camera, settings, selection, focus, and Inspector shared by the Project graph views.
 * Entity: ThinkGraph
 * Relationship: This file renders exact Engraphis nodes, relationships, Think records, native mention references, Jev provenance, focus neighborhoods, and confirmed removal actions.
 * Entity: KnowGraph
 * Relationship: This file renders exact Graphiti Entities, relationships, atomic and historical Knows, sources, focus neighborhoods, and confirmed episode removal actions.
 * Entity: CodeGraph
 * Relationship: This file renders the Code layer category-first, expands a selected File, and loads exact source only after an explicit Symbol action.
 * Entity: Jev Decisions
 * Relationship: This file presents validated relationship probabilities and bounded manual focus results as transient physics and navigation without writing graph meaning.
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
  JEV_GRAPH_PHYSICS_PROFILE_LABELS,
  JEV_GRAPH_PHYSICS_PROFILES,
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
  codeGraphMaterialFields,
  combinedCyberMaterialFields,
  composeVisibleGraphLayers,
  providerMemberKey,
  solarpunkMaterialFields,
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
  type ReadProviderFocusNeighborhood,
  type SolarpunkColors,
} from './knowledgeGraphProjection';
import {
  codeGraphCategoryProjection,
  type CodeGraphSelectedSymbol,
} from './codeGraphProjection';
import {
  CALM_FOCUS_GALAXY_SETTINGS,
  FOCUS_RELEASE_MILLISECONDS,
  MAX_JEV_FOCUS_CANDIDATES,
  buildJevFocusCandidates,
  composeExpandedFocusPresentation,
  composeFocusNeighborhoodPresentation,
  composeFocusReleasePresentation,
  composeManualFocusPresentation,
  focusCenterMembers,
  requestJevFocus,
  selectedFocusCandidates,
  type FocusReleaseView,
  type JevFocusDecisionView,
  type ManualFocusEntry,
} from './knowledgeGraphFocus';
import {
  SOLARPUNK_HEX,
  presentationStorageKey,
  rendererStyle,
  safePresentationPreferences,
  solarpunkEdgeFields,
  withoutSolarpunkEdgeMaterial,
  withoutSolarpunkMaterial,
  type GraphPresentationPreferences,
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
  compactProbability,
  graphEntryTime,
  knowEvidenceIdentity,
  probabilityLabel,
  type KnowInspectorRecord,
} from './KnowledgeGraphInspector';
import type { CanonicalEntityDirectory } from './canonicalEntityDirectory';
import './knowledgeAuthorityGraphSurface.css';

export function JoinedKnowledgeGraphSurface({
  projections,
  statuses,
  errors,
  codeGraph,
  onReadProviderFocusNeighborhood,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  entityFocusRequest,
  onOpenCodeGraph,
  onReadCodeGraphFile,
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
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
  onOpenCodeGraph?: () => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphFile?: (filePath: string) => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphSource?: (qualifiedName: string) => Promise<CodeGraphSelectedSymbol | null>;
}) {
  const [layerVisibility, setLayerVisibility] = useState<GraphLayerVisibility>(() => ({
    ...DEFAULT_GRAPH_LAYER_VISIBILITY,
  }));
  const [codeFeatureId, setCodeFeatureId] = useState<string | null>(null);
  const [codeFilePath, setCodeFilePath] = useState<string | null>(null);
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
    setCodeFeatureId(null);
    setCodeFilePath(null);
  }, [codeLayer.projection.projectId]);
  const visibleCodeProjection = useMemo(
    () => codeGraphCategoryProjection(codeLayer.projection, codeFeatureId, codeFilePath),
    [codeFeatureId, codeFilePath, codeLayer.projection],
  );
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
    if (layer === 'codegraph' && !visible) {
      setCodeFeatureId(null);
      setCodeFilePath(null);
    }
    if (layer === 'codegraph' && visible && codeLayer.status === 'idle' && onOpenCodeGraph) {
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
      onReadProviderFocusNeighborhood={onReadProviderFocusNeighborhood}
      status={status}
      error={error}
      warning={warning}
      onRemoveEvidence={onRemoveThinkGraphEvidence}
      onRemoveKnowEvidence={onRemoveKnowGraphEvidence}
      onReadCodeGraphFile={onReadCodeGraphFile ? async (filePath) => {
        setCodeFilePath(filePath);
        return onReadCodeGraphFile(filePath);
      } : undefined}
      onReadCodeGraphSource={onReadCodeGraphSource}
      codeNavigationActive={Boolean(codeFeatureId || codeFilePath)}
      onSelectCodeGraphFeature={(featureId) => {
        setCodeFeatureId(featureId);
        setCodeFilePath(null);
      }}
      onClearCodeGraphFeature={() => {
        setCodeFeatureId(null);
        setCodeFilePath(null);
      }}
      layerVisibility={layerVisibility}
      onLayerVisibilityChange={setLayerVisible}
      onResetLayerVisibility={() => {
        setCodeFeatureId(null);
        setCodeFilePath(null);
        setLayerVisibility({ ...DEFAULT_GRAPH_LAYER_VISIBILITY });
      }}
      layerCounts={{
        thinkgraph: projections.thinkgraph.nodes.length,
        knowgraph: projections.knowgraph.nodes.length,
        codegraph: visibleCodeProjection.nodes.length,
      }}
      codeLayerStatus={codeLayer.status}
      codeLayerFreshness={codeLayer.freshness}
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
  onReadProviderFocusNeighborhood,
  onRemoveEvidence,
  onRemoveKnowEvidence,
  canonicalEntityDirectory,
  entityFocusRequest,
  onReadCodeGraphFile,
  onReadCodeGraphSource,
  codeNavigationActive,
  onSelectCodeGraphFeature,
  onClearCodeGraphFeature,
  layerVisibility,
  onLayerVisibilityChange,
  onResetLayerVisibility,
  layerCounts,
  codeLayerStatus,
  codeLayerFreshness,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  warning?: string | null;
  authority?: GraphSurfaceAuthority;
  joinedPresentation?: JoinedGraphPresentation;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowEvidence?: (episodeId: string) => Promise<void>;
  canonicalEntityDirectory?: CanonicalEntityDirectory | null;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
  onReadCodeGraphFile?: (filePath: string) => Promise<GraphProjectionV1 | null>;
  onReadCodeGraphSource?: (qualifiedName: string) => Promise<CodeGraphSelectedSymbol | null>;
  codeNavigationActive?: boolean;
  onSelectCodeGraphFeature?: (featureId: string) => void;
  onClearCodeGraphFeature?: () => void;
  layerVisibility?: GraphLayerVisibility;
  onLayerVisibilityChange?: (
    layer: keyof GraphLayerVisibility,
    visible: boolean,
  ) => void;
  onResetLayerVisibility?: () => void;
  layerCounts?: Record<keyof GraphLayerVisibility, number>;
  codeLayerStatus?: 'idle' | 'loading' | 'ready' | 'error';
  codeLayerFreshness?: string;
}) {
  const savedPresentationRef = useRef(safePresentationPreferences(authority));
  const savedPresentation = savedPresentationRef.current;
  const savedPresentationIsCurrent = savedPresentation.schemaVersion === 6;
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<EngraphisRenderer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<GraphAuthority | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [selectedKnowEpisodeId, setSelectedKnowEpisodeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [settings, setSettings] = useState<Record<string, number | boolean | string>>(
    savedPresentationIsCurrent
      ? savedPresentation.settings || {}
      : { ...(savedPresentation.settings || {}), size: 5 },
  );
  const [layout, setLayout] = useState<RendererLayout>(savedPresentation.layout || 'compact');
  const [style, setStyle] = useState<PresentationStyle>(
    authority === 'codegraph'
      ? savedPresentation.style || 'cyber'
      : savedPresentationIsCurrent ? savedPresentation.style || 'solarpunk' : 'solarpunk',
  );
  const [physicsProfile, setPhysicsProfile] = useState<JevGraphPhysicsProfile>(
    savedPresentation.physicsProfile || 'galaxy',
  );
  const [solarpunkColors, setSolarpunkColors] = useState<SolarpunkColors>(
    savedPresentationIsCurrent
      ? savedPresentation.solarpunkColors || DEFAULT_SOLARPUNK_COLORS
      : DEFAULT_SOLARPUNK_COLORS,
  );
  const [appliedPresetNodeSize, setAppliedPresetNodeSize] = useState<number | null>(null);
  const [focusTrail, setFocusTrail] = useState<ManualFocusEntry[]>([]);
  const [expandedFocusResult, setExpandedFocusResult] = useState<ManualFocusEntry | null>(null);
  const [focusRelease, setFocusRelease] = useState<FocusReleaseView | null>(null);
  const focusRequestControllersRef = useRef(new Map<number, AbortController>());
  const focusRequestIdentityRef = useRef(0);
  const focusProjectionKeyRef = useRef('');
  const focusReleaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusActionRef = useRef<(id: string) => void>(() => undefined);
  const exitFocusRef = useRef<() => void>(() => undefined);
  const inspectNodeRef = useRef<(id: string) => void>(() => undefined);
  const consumedEntityFocusRequestRef = useRef<number | null>(null);
  const presentationStateRef = useRef<{
    layout: RendererLayout;
    style: PresentationStyle;
    physicsProfile: JevGraphPhysicsProfile;
    settings: Record<string, number | boolean | string>;
  }>({ layout: 'compact', style: 'cyber', physicsProfile: 'galaxy', settings: {} });
  const automaticPresentationRef = useRef<{
    renderer: EngraphisRenderer | null;
    snapshot: typeof presentationStateRef.current;
    manualLayout: boolean;
    manualStyle: boolean;
    manualPhysics: boolean;
    manualSettings: Set<string>;
    manualAllSettings: boolean;
  } | null>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [codeSource, setCodeSource] = useState<CodeGraphSelectedSymbol | null>(null);
  const [codeSourceLoading, setCodeSourceLoading] = useState(false);
  const [codeSourceError, setCodeSourceError] = useState<string | null>(null);
  const codeSourceSelectionRef = useRef(0);
  const [paperViewport, setPaperViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  presentationStateRef.current = { layout, style, physicsProfile, settings };
  const focusedEntry = focusTrail.length ? focusTrail[focusTrail.length - 1] : null;
  const successfulFocusedEntry = focusedEntry?.status === 'success'
    && focusedEntry.decision?.status === 'success'
    ? focusedEntry
    : null;
  const focusRequestPending = focusedEntry?.status === 'reading' || focusedEntry?.status === 'loading';
  const activeJoinedPresentation = successfulFocusedEntry?.presentation
    || expandedFocusResult?.presentation
    || joinedPresentation;
  const localDisplayProjection = useMemo(
    () => projection
      ? authority === 'codegraph' ? projection : applyJevGraphPhysics(projection, physicsProfile)
      : null,
    [authority, physicsProfile, projection],
  );
  const manualProjectionSource = useMemo(
    () => authority === 'joined' && activeJoinedPresentation
      ? applyJevGraphPhysics(activeJoinedPresentation.projection, physicsProfile)
      : localDisplayProjection,
    [activeJoinedPresentation, authority, localDisplayProjection, physicsProfile],
  );
  const focusProjectionKey = useMemo(() => {
    if (authority !== 'joined' || !joinedPresentation) return '';
    const projectionIdentity = (value: GraphProjectionV1) => {
      const material = JSON.stringify({
        authority: value.authority,
        projectId: value.projectId,
        revision: value.revision || '',
        nodes: value.nodes.map(node => [node.id, node.canonicalId || '', node.label]).sort(),
        edges: value.edges.map(edge => [
          edge.id, edge.source, edge.target, edge.predicate || '',
        ]).sort(),
      });
      let fingerprint = 2166136261;
      for (let index = 0; index < material.length; index += 1) {
        fingerprint ^= material.charCodeAt(index);
        fingerprint = Math.imul(fingerprint, 16777619);
      }
      return `${value.authority}:${value.nodes.length}:${value.edges.length}:${(fingerprint >>> 0).toString(16)}`;
    };
    return [
      joinedPresentation.projection.projectId,
      projectionIdentity(joinedPresentation.providerProjections.thinkgraph),
      projectionIdentity(joinedPresentation.providerProjections.knowgraph),
    ].join('|');
  }, [authority, joinedPresentation]);
  focusProjectionKeyRef.current = focusProjectionKey;
  const manualNavigationActive = focusedEntry !== null || expandedFocusResult !== null;
  const blackholePresentationActive = successfulFocusedEntry !== null;
  const manualFocusPresentation = useMemo(
    () => manualProjectionSource && successfulFocusedEntry
      ? composeManualFocusPresentation(manualProjectionSource, successfulFocusedEntry)
      : null,
    [manualProjectionSource, successfulFocusedEntry],
  );
  const expandedFocusPresentation = useMemo(
    () => manualProjectionSource
      ? composeExpandedFocusPresentation(manualProjectionSource, expandedFocusResult)
      : null,
    [expandedFocusResult, manualProjectionSource],
  );
  const displayProjection = useMemo(
    () => manualFocusPresentation?.projection
      || (expandedFocusPresentation || localDisplayProjection
        ? composeFocusReleasePresentation(
          expandedFocusPresentation || localDisplayProjection!,
          focusRelease,
        )
        : null),
    [expandedFocusPresentation, focusRelease, localDisplayProjection, manualFocusPresentation],
  );
  const selectedVisual = displayProjection?.nodes.find(node => node.id === selectedId);
  const selectedCodeNode = authority === 'codegraph'
    ? selectedVisual
    : selectedVisual && authority === 'joined'
      ? activeJoinedPresentation?.codeNodeVariants?.get(selectedVisual.id)
      : undefined;
  const selectedNodeVariants: JoinedGraphNodeVariant[] = selectedVisual
    && !selectedCodeNode
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
  const directThinkEvidenceAvailable = selectedNodeVariants.some(variant => (
    variant.authority === 'thinkgraph'
    && Array.isArray(variant.node.properties?.evidence)
    && variant.node.properties.evidence.some((item: unknown) => (
      item !== null && typeof item === 'object' && !Array.isArray(item)
    ))
  ));
  const directKnowEvidenceAvailable = selectedNodeVariants.some(variant => (
    variant.authority === 'knowgraph'
    && Array.isArray(variant.node.properties?.evidence)
    && variant.node.properties.evidence.some((item: unknown) => (
      item !== null && typeof item === 'object' && !Array.isArray(item)
      && knowEvidenceIdentity(item as Record<string, unknown>) !== null
    ))
  ));
  const defaultSelectedAuthority = directKnowAvailable
    ? 'knowgraph'
    : directThinkAvailable ? 'thinkgraph' : null;
  const inspectedNodeAuthority = selectedAuthority
    && ((selectedAuthority === 'thinkgraph' && directThinkAvailable)
      || (selectedAuthority === 'knowgraph' && directKnowAvailable))
    ? selectedAuthority
    : defaultSelectedAuthority;
  const selectedAuthorityVariants = selectedNodeVariants.filter(
    variant => variant.authority === inspectedNodeAuthority,
  );
  const selectedNodeVariant = selectedAuthorityVariants.find(
    variant => providerMemberKey(variant.authority, variant.node.id) === selectedMemberKey,
  ) || selectedAuthorityVariants[0];
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
    const codeNode = authority === 'codegraph'
      ? displayProjection?.nodes.find(node => node.id === visualNodeId)
      : authority === 'joined'
        ? activeJoinedPresentation?.codeNodeVariants?.get(visualNodeId)
        : null;
    if (codeNode?.properties?.recordKind === 'feature' && onSelectCodeGraphFeature) {
      onSelectCodeGraphFeature(codeNode.id);
    }
    const filePath = codeNode?.properties?.recordKind === 'file'
      && typeof codeNode.properties.filePath === 'string'
      ? codeNode.properties.filePath
      : '';
    if (filePath && codeNode?.properties?.structuralLoaded !== true && onReadCodeGraphFile) {
      void onReadCodeGraphFile(filePath).catch(failure => {
        setCodeSourceError(failure instanceof Error ? failure.message : String(failure));
      });
    }
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

  const beginFocusRelease = (entry: ManualFocusEntry | null) => {
    if (!entry || !manualProjectionSource) {
      setFocusRelease(null);
      return;
    }
    const focused = composeManualFocusPresentation(manualProjectionSource, entry);
    setFocusRelease({
      nodeIds: focused.nodeIds,
      edgeIds: focused.edgeIds,
    });
    if (focusReleaseTimeoutRef.current) clearTimeout(focusReleaseTimeoutRef.current);
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      setFocusRelease(null);
      return;
    }
    focusReleaseTimeoutRef.current = setTimeout(() => {
      focusReleaseTimeoutRef.current = null;
      setFocusRelease(null);
    }, FOCUS_RELEASE_MILLISECONDS);
  };

  const exitManualFocus = () => {
    const current = focusTrail.length ? focusTrail[focusTrail.length - 1] : null;
    if (!current && !focusRelease) return;
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    focusRequestIdentityRef.current += 1;
    if (current?.status === 'success' && current.decision?.status === 'success') {
      setExpandedFocusResult(current);
      beginFocusRelease(current);
    } else {
      setFocusRelease(null);
    }
    const automatic = automaticPresentationRef.current;
    if (automatic) {
      automatic.snapshot.layout = 'compact';
      automatic.snapshot.physicsProfile = 'galaxy';
    }
    setFocusTrail([]);
  };

  const enterManualFocus = (centerId: string) => {
    if (authority !== 'joined' || !activeJoinedPresentation || !manualProjectionSource) return;
    const center = manualProjectionSource.nodes.find(node => node.id === centerId);
    if (!center || (focusedEntry?.centerId === centerId
      && ['reading', 'loading', 'success'].includes(focusedEntry.status))) return;
    const sourcePresentation = activeJoinedPresentation;
    const centerProviderMembers = focusCenterMembers(sourcePresentation, centerId);
    if (!centerProviderMembers.length) return;
    if (focusReleaseTimeoutRef.current) {
      clearTimeout(focusReleaseTimeoutRef.current);
      focusReleaseTimeoutRef.current = null;
    }
    for (const pending of focusRequestControllersRef.current.values()) pending.abort();
    focusRequestControllersRef.current.clear();
    setFocusRelease(null);
    const requestIdentity = focusRequestIdentityRef.current + 1;
    focusRequestIdentityRef.current = requestIdentity;
    const entry: ManualFocusEntry = {
      centerId,
      centerTitle: center.label || center.title || center.id,
      status: 'reading',
      decision: null,
      requestIdentity,
      projectionKey: focusProjectionKey,
      presentation: sourcePresentation,
      readWarning: null,
    };
    setFocusTrail([entry]);
    const controller = new AbortController();
    focusRequestControllersRef.current.set(requestIdentity, controller);
    const stale = () => controller.signal.aborted
      || focusProjectionKeyRef.current !== entry.projectionKey;
    const failedDecision = (
      status: Exclude<JevFocusDecisionView['status'], 'success'>,
      errorCode: string,
    ): JevFocusDecisionView => ({
      status, errorCode, candidates: [],
    });
    void (async () => {
      if (!onReadProviderFocusNeighborhood) {
        if (stale()) return;
        const decision = failedDecision('unavailable', 'jev_focus_provider_reader_unavailable');
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? { ...item, status: decision.status, decision }
          : item));
        return;
      }
      const settled = await Promise.allSettled(centerProviderMembers.map(async member => ({
        authority: member.authority === 'ThinkGraph' ? 'thinkgraph' as const : 'knowgraph' as const,
        projection: await onReadProviderFocusNeighborhood(
          member.authority === 'ThinkGraph' ? 'thinkgraph' : 'knowgraph',
          member.entityId,
          controller.signal,
        ),
      })));
      if (stale()) return;
      const reads: Partial<Record<GraphAuthority, GraphProjectionV1[]>> = {};
      const failures: string[] = [];
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        if (result.status === 'fulfilled') {
          const list = reads[result.value.authority] || [];
          list.push(result.value.projection);
          reads[result.value.authority] = list;
        } else {
          const member = centerProviderMembers[index];
          failures.push(`${member.authority} ${member.entityId}`);
        }
      }
      if (!Object.values(reads).some(values => values?.length)) {
        const decision = failedDecision('unavailable', 'jev_focus_provider_read_unavailable');
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? { ...item, status: decision.status, decision, readWarning: failures.join(' · ') }
          : item));
        return;
      }
      const focusPresentation = composeFocusNeighborhoodPresentation(
        sourcePresentation,
        centerId,
        reads,
      );
      const candidates = buildJevFocusCandidates(
        focusPresentation.projection,
        focusPresentation,
        centerId,
      );
      const readWarning = failures.length
        ? `Provider neighborhood partial: ${failures.join(' · ')}`
        : null;
      if (failures.length || candidates.length > MAX_JEV_FOCUS_CANDIDATES) {
        const decision = failedDecision(
          'unavailable',
          failures.length
            ? 'jev_focus_provider_read_partial'
            : 'jev_focus_candidate_limit',
        );
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? {
            ...item,
            presentation: focusPresentation,
            status: decision.status,
            decision,
            readWarning: readWarning || (
              `Provider neighborhood has ${candidates.length} Entities; `
              + `JevFocus accepts at most ${MAX_JEV_FOCUS_CANDIDATES}.`
            ),
          }
          : item));
        return;
      }
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, presentation: focusPresentation, status: 'loading', readWarning }
        : item));
      const decision = await requestJevFocus({
        projectId: focusPresentation.projection.projectId,
        centerId,
        centerTitle: entry.centerTitle,
        centerProviderMembers: focusCenterMembers(focusPresentation, centerId),
        sourceRevision: entry.projectionKey,
        candidates,
        signal: controller.signal,
      });
      if (stale()) return;
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, status: decision.status, decision }
        : item));
    })().catch((failure: unknown) => {
      if (stale()) return;
      const decision = failedDecision(
        'error',
        failure instanceof Error ? failure.message : 'jev_focus_request_failed',
      );
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, status: 'error', decision }
        : item));
    }).finally(() => {
      focusRequestControllersRef.current.delete(requestIdentity);
    });
  };
  focusActionRef.current = enterManualFocus;
  exitFocusRef.current = exitManualFocus;

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const inspectNode = (node: { id: string }) => {
        inspectNodeRef.current(node.id);
      };
      const graph = window.EngraphisGraph.create(hostRef.current, {
        onNodeClick: inspectNode,
        ...(authority === 'joined' ? {
          onNodeDoubleClick: (node: { id: string }) => {
            inspectNode(node);
            focusActionRef.current(node.id);
          },
        } : {}),
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
          exitFocusRef.current();
          setSelectedMemberKey(null);
          setSelectedKnowEpisodeId(null);
          setSelectedId(null);
          setSelectedEdgeId(null);
          setInspectorOpen(false);
          setControlsOpen(authority === 'joined');
        },
      });
      const restoredLayout = savedPresentation.layout || 'compact';
      const restoredStyle = authority === 'codegraph'
        ? savedPresentation.style || 'cyber'
        : savedPresentationIsCurrent
          ? savedPresentation.style || 'solarpunk'
          : 'solarpunk';
      const restoredPhysics = savedPresentation.physicsProfile || 'galaxy';
      const defaults = graph.setPreset(restoredLayout);
      const savedSettings = savedPresentationIsCurrent
        ? savedPresentation.settings || {}
        : { ...(savedPresentation.settings || {}), size: 5 };
      const upgradingLegacyPresentation = !savedPresentationIsCurrent;
      const restoredSettings: Record<string, number | boolean | string> = {
        ...defaults,
        labels: true,
        ...savedSettings,
      };
      if (upgradingLegacyPresentation) {
        restoredSettings.linkw = Math.max(1, Number(restoredSettings.linkw) || 1);
      }
      graph.setCollapse(false);
      setLayout(restoredLayout); setStyle(restoredStyle); setPhysicsProfile(restoredPhysics);
      graph.setStyle(rendererStyle(restoredStyle));
      if (authority === 'codegraph') {
        graph.setColorBy('type');
        graph.setTypeColors({
          Feature: '#b789ff',
          File: '#22e0ff',
          Symbol: '#fff1a8',
        });
      } else if (authority === 'joined') {
        graph.setColorBy('type');
        graph.setTypeColors({
          Feature: CODE_GRAPH_LAYER_COLOR,
          File: CODE_GRAPH_LAYER_COLOR,
          Symbol: CODE_GRAPH_LAYER_COLOR,
        });
      }
      graph.setSettings(restoredSettings);
      setSettings(restoredSettings);
      graphRef.current = graph;
      return () => { graph.destroy(); graphRef.current = null; };
    } catch (failure) {
      setRenderError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    }
  }, [authority, savedPresentationIsCurrent]);

  useEffect(() => {
    if (authority === 'codegraph') {
      graphRef.current?.setColorBy('type');
      graphRef.current?.setTypeColors({
        Feature: '#b789ff', File: '#22e0ff', Symbol: '#fff1a8',
      });
      return;
    }
    if (authority === 'joined') {
      graphRef.current?.setColorBy('type');
      graphRef.current?.setTypeColors({
        Feature: CODE_GRAPH_LAYER_COLOR,
        File: CODE_GRAPH_LAYER_COLOR,
        Symbol: CODE_GRAPH_LAYER_COLOR,
      });
    }
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
    try {
      window.localStorage.setItem(presentationStorageKey(authority), JSON.stringify({
        schemaVersion: 6, layout, style, physicsProfile, settings, solarpunkColors,
      } satisfies GraphPresentationPreferences));
    } catch {
      // Presentation preferences are optional; graph rendering remains authoritative.
    }
  }, [authority, layout, physicsProfile, settings, solarpunkColors, style]);

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

  useEffect(() => () => {
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    if (focusReleaseTimeoutRef.current) clearTimeout(focusReleaseTimeoutRef.current);
  }, []);

  useEffect(() => {
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    focusRequestIdentityRef.current += 1;
    if (focusReleaseTimeoutRef.current) {
      clearTimeout(focusReleaseTimeoutRef.current);
      focusReleaseTimeoutRef.current = null;
    }
    setFocusRelease(null);
    setExpandedFocusResult(null);
    setFocusTrail(history => history.length ? [] : history);
  }, [focusProjectionKey]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (blackholePresentationActive) {
      let automatic = automaticPresentationRef.current;
      if (!automatic) {
        automatic = {
          renderer: null,
          snapshot: {
            ...presentationStateRef.current,
            settings: { ...presentationStateRef.current.settings },
          },
          manualLayout: false,
          manualStyle: false,
          manualPhysics: false,
          manualSettings: new Set<string>(),
          manualAllSettings: false,
        };
        automaticPresentationRef.current = automatic;
      }
      if (automatic.renderer !== graph) {
        graph.setPreset('galaxy');
        graph.setStyle('cyber');
        graph.setSettings(CALM_FOCUS_GALAXY_SETTINGS);
        automatic.renderer = graph;
      }
      return;
    }

    const automatic = automaticPresentationRef.current;
    if (!automatic) return;
    const current = presentationStateRef.current;
    if (!automatic.manualLayout) {
      graph.setPreset(automatic.snapshot.layout);
      setLayout(automatic.snapshot.layout);
    }
    const restoredSettings = automatic.manualLayout || automatic.manualAllSettings
      ? { ...current.settings }
      : { ...automatic.snapshot.settings };
    for (const key of automatic.manualSettings) {
      if (current.settings[key] !== undefined) restoredSettings[key] = current.settings[key];
    }
    graph.setSettings(restoredSettings);
    setSettings(restoredSettings);
    if (!automatic.manualStyle) {
      graph.setStyle(rendererStyle(automatic.snapshot.style));
      setStyle(automatic.snapshot.style);
    }
    if (!automatic.manualPhysics) setPhysicsProfile(automatic.snapshot.physicsProfile);
    automaticPresentationRef.current = null;
  }, [blackholePresentationActive]);

  const recordManualPresentationChange = (
    field: 'layout' | 'style' | 'physics' | 'all-settings' | 'setting',
    settingKey?: string,
  ) => {
    const automatic = automaticPresentationRef.current;
    if (!automatic || !blackholePresentationActive) return;
    if (field === 'layout') automatic.manualLayout = true;
    else if (field === 'style') automatic.manualStyle = true;
    else if (field === 'physics') automatic.manualPhysics = true;
    else if (field === 'all-settings') automatic.manualAllSettings = true;
    else if (settingKey) automatic.manualSettings.add(settingKey);
  };

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
        if (codeNode) {
          return {
            ...withoutSolarpunkMaterial(node),
            ...codeGraphMaterialFields(),
          };
        }
        if (authority === 'codegraph' || style !== 'solarpunk') {
          return withoutSolarpunkMaterial(node);
        }
        const combinedCyber = authority === 'joined';
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
          ...(combinedCyber
            ? combinedCyberMaterialFields(
              sourceKind, thinkActive, knowActive, solarpunkColors,
            )
            : solarpunkMaterialFields(
              sourceKind, thinkActive, knowActive, solarpunkColors,
            )),
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
          ? {
            ...withoutSolarpunkEdgeMaterial(semanticEdge),
            material_kind: 'solarpunk' as const,
            material_color: CODE_GRAPH_LAYER_COLOR,
          }
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
    if (successfulFocusedEntry) graph?.focus(successfulFocusedEntry.centerId);
    else graph?.clearFocus();
  }, [
    activeJoinedPresentation,
    authority,
    displayProjection,
    solarpunkColors,
    style,
    successfulFocusedEntry,
  ]);

  useEffect(() => {
    graphRef.current?.setHighlight(selectedId || successfulFocusedEntry?.centerId || null);
  }, [selectedId, successfulFocusedEntry?.centerId]);

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
      if (manualNavigationActive) exitFocusRef.current();
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
    manualNavigationActive,
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
      panelBodyRef.current?.querySelector<HTMLElement>('[tabindex="-1"], select')?.focus();
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
  const loadCodeSource = async (qualifiedName: string) => {
    if (!onReadCodeGraphSource) return;
    const requestId = ++codeSourceSelectionRef.current;
    setCodeSourceLoading(true);
    setCodeSourceError(null);
    try {
      const source = await onReadCodeGraphSource(qualifiedName);
      if (requestId !== codeSourceSelectionRef.current) return;
      if (!source || source.cbmQualifiedName !== qualifiedName) {
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
      ? directThinkEvidenceAvailable
      : directKnowEvidenceAvailable);
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
    <div data-testid={`knowledge-${authority}-surface`} className="knowledge-authority-graph" data-layout={layout} data-style={style} data-physics-profile={physicsProfile} data-focus-phase={successfulFocusedEntry ? 'manual_blackhole_focus' : focusRequestPending ? 'focus_preparing' : focusRelease ? 'focus_release' : 'local_relational'} data-panel-open={controlsOpen || inspectorOpen} aria-busy={status === 'loading'}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        if (focusedEntry) {
          event.stopPropagation();
          exitManualFocus();
          closePanel();
        } else if (inspectorOpen || controlsOpen) {
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
        {focusedEntry ? (
          <div
            data-testid="jev-focus-toolbar"
            role="status"
            style={{
              position: 'absolute', left: 16, top: 16, zIndex: 5,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: 8, borderRadius: 12,
              background: 'rgba(11, 14, 18, 0.88)',
              border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
              color: GRAPH_THEME.surface.text,
            }}
          >
            <span title={focusedEntry.readWarning || focusedEntry.decision?.errorCode || undefined}>
              {focusedEntry.status === 'reading'
                ? 'Focus · reading neighborhood…'
                : focusedEntry.status === 'loading'
                  ? 'Focus · reranking…'
                : focusedEntry.status === 'success'
                  ? `Focus · ${new Set(selectedFocusCandidates(focusedEntry).map(candidate => candidate.visualId)).size} neighbors`
                  : 'Focus unavailable · local view kept'}
            </span>
          </div>
        ) : focusRelease ? (
          <div
            data-testid="focus-release-status"
            role="status"
            style={{ position: 'absolute', left: 16, top: 16, zIndex: 5, color: GRAPH_THEME.surface.mutedText }}
          >
            Focus release
          </div>
        ) : null}
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
        {layerVisibility?.codegraph && codeNavigationActive && onClearCodeGraphFeature ? (
          <button
            type="button"
            data-testid="codegraph-back-to-features"
            onClick={onClearCodeGraphFeature}
            style={{ position: 'absolute', top: 12, left: 12, zIndex: 5 }}
          >
            ← All code features
          </button>
        ) : null}
        {status === 'ready' && allNodes === 0 ? <div className="knowledge-authority-empty">
          {noVisibleLayers
            ? 'No graph layers visible.'
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
          {!inspectorOpen ? <div ref={panelBodyRef} className="knowledge-authority-controls">
            {authority === 'joined' && layerVisibility && onLayerVisibilityChange
              ? <fieldset className="graph-layer-controls" aria-label="Graph layers">
                <legend>Layers</legend>
                <div className="graph-layer-legend">
                  {([
                    ['thinkgraph', 'Think', solarpunkColors.think],
                    ['knowgraph', 'Know', solarpunkColors.know],
                    ['codegraph', 'Code', CODE_GRAPH_LAYER_COLOR],
                  ] as const).map(([layer, label, color]) => (
                    <button
                      key={layer}
                      type="button"
                      aria-label={`${label} layer`}
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
                  aria-label="Reset graph layers"
                  onClick={onResetLayerVisibility}
                >
                  Reset layers
                </button> : null}
              </fieldset>
              : null}
            {authority !== 'codegraph' ? <label>Physics profile<select aria-label="Physics profile" value={physicsProfile} onChange={event => {
              recordManualPresentationChange('physics');
              setPhysicsProfile(event.target.value as JevGraphPhysicsProfile);
            }}>
              {JEV_GRAPH_PHYSICS_PROFILES.map(profile => <option key={profile} value={profile}>
                {JEV_GRAPH_PHYSICS_PROFILE_LABELS[profile]}
              </option>)}
            </select></label> : null}
            <label>Layout<select aria-label="Layout" value={layout} onChange={event => {
              recordManualPresentationChange('layout');
              setAppliedPresetNodeSize(null);
              const next = event.target.value as RendererLayout;
              const preset = graphRef.current?.setPreset(next);
              const defaults = preset
                ? { ...preset, linkw: Math.max(1, Number(preset.linkw) || 1) }
                : preset;
              setLayout(next); setSettings(current => ({ ...current, ...defaults }));
            }}>
              <option value="compact">Compact</option><option value="original">Original</option>
              <option value="communities">Communities</option><option value="radial">Radial</option>
              <option value="galaxy">Galaxy gravity</option>
            </select></label>
            <label>Style<select aria-label="Style" value={style} onChange={event => {
              recordManualPresentationChange('style');
              const next = event.target.value as PresentationStyle;
              graphRef.current?.setStyle(rendererStyle(next)); setStyle(next);
            }}>
              <option value="classic">Classic</option><option value="cyber">Cyberpunk</option>
              {authority !== 'codegraph' ? <option value="solarpunk">Solarpunk</option> : null}<option value="galaxy">Galaxy</option>
              <option value="solar">Solar</option>
            </select></label>
            {style === 'solarpunk'
              ? <fieldset aria-label="Solarpunk colors" style={{ display: 'grid', gap: 6 }}>
              <legend>Solarpunk colors</legend>
              {([['Think nodes', 'think'], ['Know nodes', 'know'],
                ['Think edges', 'thinkRelationship'],
                ['Know edges', 'knowRelationship']] as const)
                .map(([label, key]) => <label key={key}>
                  <span>{label}</span>
                  <input type="color" aria-label={label} value={solarpunkColors[key]}
                    onChange={event => {
                      const value = event.target.value;
                      if (!SOLARPUNK_HEX.test(value)) return;
                      setSolarpunkColors(current => ({ ...current, [key]: value }));
                    }} />
                  </label>)}
            </fieldset> : null}
            <label><input type="checkbox" checked={settings.labels === true} onChange={event => {
              recordManualPresentationChange('setting', 'labels');
              setAppliedPresetNodeSize(null);
              const patch = { labels: event.target.checked };
              graphRef.current?.setSettings(patch);
              setSettings(current => ({ ...current, ...patch }));
            }} />{authority === 'codegraph' ? 'Code labels' : 'Entity labels'}</label>
            {([
              ['Node size', 'size', 1, 12, 1], ['Text size', 'font', 6, 24, 1],
              ['Line width', 'linkw', 0.1, 2, 0.01], ['Label density', 'labelDensity', 1, 100, 1],
              ['Repel force', 'repel', 0, 400, 1], ['Link distance', 'link', 4, 80, 1],
              ['Center gravity', 'gravity', 0, 400, 1],
            ] as const).map(([label, key, min, max, step]) => <label key={key}>
              <span>{label}</span>
              <input aria-label={label} type="range" min={min} max={max} step={step}
                value={Number(settings[key] ?? min)} onChange={event => {
                  recordManualPresentationChange('setting', key);
                  setAppliedPresetNodeSize(null);
                  const patch = { [key]: Number(event.target.value) };
                  graphRef.current?.setSettings(patch);
                  setSettings(current => ({ ...current, ...patch }));
                }} />
              <output>{settings[key]}</output>
            </label>)}
            <button type="button" aria-label="Reset to preset defaults" onClick={() => {
              recordManualPresentationChange('all-settings');
              const defaults = graphRef.current?.setPreset(layout);
              const nextSettings = {
                ...defaults,
                labels: true,
                linkw: Math.max(1, Number(defaults?.linkw) || 1),
              };
              graphRef.current?.setSettings(nextSettings);
              setSettings(nextSettings);
              setAppliedPresetNodeSize(typeof defaults?.size === 'number' ? defaults.size : null);
            }}>{appliedPresetNodeSize === null
                ? 'Reset to preset defaults'
                : `Preset defaults applied · node size ${appliedPresetNodeSize}`}</button>
          </div> : (selected || selectedEdge) ? <div ref={panelBodyRef} className="knowledge-authority-controls" role="region" aria-label={`${entryTitle} details`}>
        {authority === 'joined' && selectedVisual ? (
          <div className="knowledge-authority-actions">
            <button
              type="button"
              disabled={focusRequestPending}
              onClick={() => {
                if (successfulFocusedEntry) exitFocusRef.current();
                else focusActionRef.current(selectedVisual.id);
              }}
            >
              {successfulFocusedEntry ? 'Expand' : 'Focus'}
            </button>
          </div>
        ) : null}
        {authority === 'joined' && selected && availableNodeAuthorities.length ? (
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
          onLoadSource={onReadCodeGraphSource ? qualifiedName => { void loadCodeSource(qualifiedName); } : undefined}
        /> : null}
        {visibleThinks.length ? <section className="graph-inspector-records" data-testid="knowledge-think-records">
          <h4>{visibleThinks.length > 1 ? 'Recent Thinks' : 'Recent Think'}</h4>
          {visibleThinks.map(item => <ThinkRecordCard
            key={item.id}
            item={item}
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
