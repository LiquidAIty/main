import { useEffect, useMemo, useRef, useState } from 'react';
import '../../vendor/engraphis/vendor/d3.min.js';
import '../../vendor/engraphis/vendor/force-graph.min.js';
import '../../vendor/engraphis/engraphis-graph.js';

import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import { GRAPH_THEME } from '../graph/graphVisualTokens';
import { applyJevGraphPhysics, type JevGraphPhysicsProfile } from './jevGraphPhysics';
import {
  resolveCanonicalSubjectFocusVisualId,
  type CanonicalSubjectFocusRequest,
} from './canonicalSubjectLinks';
import {
  DEFAULT_SOLARPUNK_COLORS,
  composeThinkKnowPresentation,
  providerMemberKey,
  type GraphAuthority,
  type GraphProjectionV1,
  type JoinedGraphEdgeVariant,
  type JoinedGraphNodeVariant,
  type JoinedGraphPresentation,
  type SolarpunkColors,
} from './joinedKnowledgeGraphProjection';
import type { CanonicalSubjectDirectory } from './canonicalSubjectDirectory';
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
  selectedFocusCandidates,
  type FocusReleaseView,
  type JevFocusCandidateView,
  type JevFocusCenterMemberView,
  type JevFocusDecisionView,
  type ManualFocusEntry,
  type ReadProviderFocusNeighborhood,
} from './knowledgeGraphFocusPresentation';
import { KnowledgeGraphInspector } from './KnowledgeGraphInspector';
import { graphitiFactIdentity } from './knowledgeGraphInspectorRecords';
import {
  initialPresentationStyle,
  presentationStorageKey,
  rendererGraphStyle,
  safePresentationPreferences,
  type GraphLayout,
  type GraphPresentationPreferences,
  type GraphStyle,
  type RendererGraphStyle,
} from './knowledgeGraphPresentationPreferences';
import { projectKnowledgeRendererData } from './knowledgeGraphRendererProjection';
import { requestJevFocus } from './knowledgeGraphJevFocusClient';
import { knowledgeGraphFocusProjectionIdentity } from './knowledgeGraphFocusProjectionIdentity';
import { KnowledgeGraphPresentationControls } from './KnowledgeGraphPresentationControls';
import './knowledgeAuthorityGraphSurface.css';

export function JoinedKnowledgeGraphSurface({
  projections,
  statuses,
  errors,
  onReadProviderFocusNeighborhood,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  subjectFocusRequest,
}: {
  projections: Record<GraphAuthority, GraphProjectionV1>;
  statuses?: Partial<Record<GraphAuthority, 'idle' | 'loading' | 'ready' | 'error'>>;
  errors?: Partial<Record<GraphAuthority, string>>;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (graphitiFactUuid: string) => Promise<void>;
  subjectFocusRequest?: CanonicalSubjectFocusRequest | null;
}) {
  const presentation = useMemo(
    () => composeThinkKnowPresentation(
      projections.thinkgraph,
      projections.knowgraph,
    ),
    [projections.knowgraph, projections.thinkgraph],
  );
  const visibleAuthorities = ['thinkgraph', 'knowgraph'] as const;
  const visibleStatuses = visibleAuthorities.map(authority => (
    errors?.[authority] ? 'error' : statuses?.[authority] || 'ready'
  ));
  const authorityErrors = visibleAuthorities.flatMap(authority => errors?.[authority]
    ? [`${authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph'} unavailable: ${errors[authority]}`]
    : []);
  const status = visibleStatuses.every(value => value === 'error')
    ? 'error'
    : visibleStatuses.some(value => value === 'ready')
      ? 'ready'
      : visibleStatuses.some(value => value === 'loading')
        ? 'loading'
        : 'idle';
  const error = status === 'error'
    ? authorityErrors.join(' · ')
    : null;
  const warning = status !== 'error' && authorityErrors.length
    ? authorityErrors.join(' · ')
    : null;
  return (
    <JoinedKnowledgeGraphProjectionSurface
      canonicalSubjectDirectory={
        projections.thinkgraph.canonicalSubjectDirectory
      }
      subjectFocusRequest={subjectFocusRequest}
      projection={presentation.projection}
      joinedPresentation={presentation}
      onReadProviderFocusNeighborhood={onReadProviderFocusNeighborhood}
      status={status}
      error={error}
      warning={warning}
      onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
      onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
    />
  );
}
type EngraphisRenderer = {
  setPreset: (name: GraphLayout) => Record<string, number | boolean | string>;
  setStyle: (name: RendererGraphStyle) => void;
  setSettings: (settings: Record<string, number | boolean | string>) => void;
  setData: (data: { nodes: unknown[]; links?: unknown[]; edges?: unknown[] }) => void;
  setHighlight: (id: string | null) => void;
  setThemeColors: (colors: Record<string, string>) => void;
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
function JoinedKnowledgeGraphProjectionSurface({
  projection,
  status,
  error,
  warning,
  joinedPresentation,
  onReadProviderFocusNeighborhood,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  canonicalSubjectDirectory,
  subjectFocusRequest,
}: {
  projection: GraphProjectionV1;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  warning?: string | null;
  joinedPresentation: JoinedGraphPresentation;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (graphitiFactUuid: string) => Promise<void>;
  canonicalSubjectDirectory?: CanonicalSubjectDirectory | null;
  subjectFocusRequest?: CanonicalSubjectFocusRequest | null;
}) {
  const savedPresentationRef = useRef(safePresentationPreferences());
  const savedPresentation = savedPresentationRef.current;
  const savedPresentationIsCurrent = savedPresentation.schemaVersion === 6;
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<EngraphisRenderer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<GraphAuthority | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [settings, setSettings] = useState<Record<string, number | boolean | string>>(
    savedPresentationIsCurrent
      ? savedPresentation.settings || {}
      : { ...(savedPresentation.settings || {}), size: 5 },
  );
  const [layout, setLayout] = useState<GraphLayout>(savedPresentation.layout || 'compact');
  const [style, setStyle] = useState<GraphStyle>(
    initialPresentationStyle(savedPresentationIsCurrent ? savedPresentation.style : undefined),
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
  const consumedSubjectFocusRequestRef = useRef<number | null>(null);
  const presentationStateRef = useRef<{
    layout: GraphLayout;
    style: GraphStyle;
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
    () => applyJevGraphPhysics(projection, physicsProfile),
    [physicsProfile, projection],
  );
  const manualProjectionSource = useMemo(
    () => applyJevGraphPhysics(activeJoinedPresentation.projection, physicsProfile),
    [activeJoinedPresentation, physicsProfile],
  );
  const focusProjectionKey = useMemo(
    () => knowledgeGraphFocusProjectionIdentity(joinedPresentation),
    [joinedPresentation],
  );
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
  const selectedNodeVariants: JoinedGraphNodeVariant[] = selectedVisual
    ? activeJoinedPresentation.nodeVariants.get(selectedVisual.id) || []
    : [];
  const directThinkAvailable = selectedNodeVariants.some(variant => (
    variant.authority === 'thinkgraph'
    && Array.isArray(variant.node.properties?.evidence)
    && variant.node.properties.evidence.some((item: unknown) => (
      item !== null && typeof item === 'object' && !Array.isArray(item)
    ))
  ));
  const graphitiEdges = activeJoinedPresentation.providerProjections.knowgraph.edges;
  const directKnowAvailable = selectedNodeVariants.some(variant => (
    variant.authority === 'knowgraph'
    && graphitiEdges.some(edge => (
      (edge.source === variant.node.id || edge.target === variant.node.id)
      && edge.predicate !== 'MENTIONS'
      && graphitiFactIdentity(edge) !== null
      && typeof edge.properties?.fact === 'string'
      && edge.properties.fact.trim().length > 0
    ))
  ));
  const defaultSelectedAuthority = directThinkAvailable
    ? 'thinkgraph'
    : directKnowAvailable ? 'knowgraph' : null;
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
  const selected = selectedNodeVariant?.node;
  const selectedEdgeVisual = displayProjection?.edges.find(edge => edge.id === selectedEdgeId);
  const selectedEdgeVariant: JoinedGraphEdgeVariant | undefined = selectedEdgeVisual
    ? activeJoinedPresentation.edgeVariants.get(selectedEdgeVisual.id)
    : undefined;
  const selectedEdge = selectedEdgeVariant?.edge;
  const inspectedAuthority = selectedEdgeVariant?.authority || selectedNodeVariant?.authority || null;
  const inspectedProjection = inspectedAuthority
    ? activeJoinedPresentation.providerProjections[inspectedAuthority]
    : null;
  const selectedProperties = selected?.properties || {};
  const openNodeInspector = (visualNodeId: string) => {
    setControlsOpen(false);
    setSelectedMemberKey(null);
    setSelectedId(visualNodeId);
    setSelectedEdgeId(null);
    setInspectorOpen(true);
  };
  inspectNodeRef.current = openNodeInspector;
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
      centerId: entry.centerId,
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
    if (!manualProjectionSource) return;
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
      candidates: [],
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
      schemaVersion: 'jev-focus.v1', sourceRevision: entry.projectionKey,
      status, decisionId: null, errorCode, distribution: {}, candidates: [],
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
            candidates,
            status: decision.status,
            decision,
            readWarning: readWarning || (
              `Provider neighborhood has ${candidates.length} subjects; `
              + `JevFocus accepts at most ${MAX_JEV_FOCUS_CANDIDATES}.`
            ),
          }
          : item));
        return;
      }
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, presentation: focusPresentation, candidates, status: 'loading', readWarning }
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
        onNodeDoubleClick: (node: { id: string }) => {
          inspectNode(node);
          focusActionRef.current(node.id);
        },
        onLinkClick: link => {
          setControlsOpen(false);
          setSelectedMemberKey(null);
          setSelectedId(null);
          setSelectedEdgeId(String(link.id));
          setInspectorOpen(true);
        },
        onBackgroundClick: () => {
          exitFocusRef.current();
          setSelectedMemberKey(null);
          setSelectedId(null);
          setSelectedEdgeId(null);
          setInspectorOpen(false);
          setControlsOpen(false);
        },
      });
      const restoredLayout = savedPresentation.layout || 'compact';
      const restoredStyle = initialPresentationStyle(
        savedPresentationIsCurrent ? savedPresentation.style : undefined,
      );
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
      graph.setStyle(rendererGraphStyle(restoredStyle));
      graph.setSettings(restoredSettings);
      setSettings(restoredSettings);
      graphRef.current = graph;
      return () => { graph.destroy(); graphRef.current = null; };
    } catch (failure) {
      setRenderError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    }
  }, [savedPresentationIsCurrent]);

  useEffect(() => {
    graphRef.current?.setThemeColors(style === 'solarpunk' ? {
      material_blue: solarpunkColors.think,
      material_orange: solarpunkColors.know,
      material_surface: GRAPH_THEME.surface.base,
      accent: solarpunkColors.think,
      solar: solarpunkColors.know,
      surface: GRAPH_THEME.surface.base,
      label: GRAPH_THEME.surface.text,
    } : {});
  }, [solarpunkColors, style]);

  useEffect(() => {
    try {
      window.localStorage.setItem(presentationStorageKey(), JSON.stringify({
        schemaVersion: 6, layout, style, physicsProfile, settings, solarpunkColors,
      } satisfies GraphPresentationPreferences));
    } catch {
      // Presentation preferences are optional; graph rendering remains authoritative.
    }
  }, [layout, physicsProfile, settings, solarpunkColors, style]);

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
      graph.setStyle(rendererGraphStyle(automatic.snapshot.style));
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
    const data = projectKnowledgeRendererData({
      displayProjection,
      activeJoinedPresentation,
      style,
      solarpunkColors,
    });
    const graph = graphRef.current;
    graph?.setData(data);
    if (successfulFocusedEntry) graph?.focus(successfulFocusedEntry.centerId);
    else graph?.clearFocus();
  }, [
    activeJoinedPresentation,
    displayProjection,
    solarpunkColors,
    style,
    successfulFocusedEntry,
  ]);

  useEffect(() => {
    graphRef.current?.setHighlight(selectedId || successfulFocusedEntry?.centerId || null);
  }, [selectedId, successfulFocusedEntry?.centerId]);

  useEffect(() => {
    if (!subjectFocusRequest
      || consumedSubjectFocusRequestRef.current === subjectFocusRequest.requestId
      || !displayProjection) return;
    const baseProjection = joinedPresentation.projection;
    const visualNodeId = resolveCanonicalSubjectFocusVisualId({
      projection: baseProjection,
      joinedPresentation,
      directory: canonicalSubjectDirectory,
      request: subjectFocusRequest,
    });
    if (!visualNodeId) return;
    if (!displayProjection.nodes.some(node => node.id === visualNodeId)) {
      if (manualNavigationActive) exitFocusRef.current();
      return;
    }
    consumedSubjectFocusRequestRef.current = subjectFocusRequest.requestId;
    inspectNodeRef.current(visualNodeId);
  }, [
    canonicalSubjectDirectory,
    displayProjection,
    joinedPresentation,
    manualNavigationActive,
    projection,
    subjectFocusRequest,
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
  const allNodes = displayProjection?.nodes.length ?? 0;
  const entryTitle = selected?.label || (selectedEdge ? selectedEdge.predicate : '');

  return (
    <div data-testid="knowledge-joined-surface" className="knowledge-authority-graph" data-layout={layout} data-style={style} data-physics-profile={physicsProfile} data-focus-phase={successfulFocusedEntry ? 'manual_blackhole_focus' : focusRequestPending ? 'focus_preparing' : focusRelease ? 'focus_release' : 'local_relational'} data-panel-open={controlsOpen || inspectorOpen} aria-busy={status === 'loading'}
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
        {status === 'ready' && allNodes === 0 ? <div className="knowledge-authority-empty">No knowledge yet.</div> : null}
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
          storageKey="liquidaity.drawer.joined.width"
          top={48} right={12} bottom={12} zIndex={6}
        >
          {!inspectorOpen ? <KnowledgeGraphPresentationControls
            containerRef={panelBodyRef}
            physicsProfile={physicsProfile}
            changePhysicsProfile={(value) => {
              recordManualPresentationChange('physics');
              setPhysicsProfile(value);
            }}
            layout={layout}
            changeLayout={(next) => {
              recordManualPresentationChange('layout');
              setAppliedPresetNodeSize(null);
              const preset = graphRef.current?.setPreset(next);
              const defaults = preset
                ? { ...preset, linkw: Math.max(1, Number(preset.linkw) || 1) }
                : preset;
              setLayout(next); setSettings(current => ({ ...current, ...defaults }));
            }}
            style={style}
            changeStyle={(next) => {
              recordManualPresentationChange('style');
              graphRef.current?.setStyle(rendererGraphStyle(next)); setStyle(next);
            }}
            solarpunkColors={solarpunkColors}
            changeSolarpunkColor={(key, value) => {
              setSolarpunkColors(current => ({ ...current, [key]: value }));
            }}
            settings={settings}
            changeSetting={(key, value) => {
              recordManualPresentationChange('setting', key);
              setAppliedPresetNodeSize(null);
              const patch = { [key]: value };
              graphRef.current?.setSettings(patch);
              setSettings(current => ({ ...current, ...patch }));
            }}
            resetPresetDefaults={() => {
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
            }}
            appliedPresetNodeSize={appliedPresetNodeSize}
          /> : (selected || selectedEdge) ? (
            <KnowledgeGraphInspector
              containerRef={panelBodyRef}
              selectedVisual={selectedVisual}
              selected={selected}
              selectedEdge={selectedEdge}
              inspectedAuthority={inspectedAuthority}
              inspectedProjection={inspectedProjection}
              activeJoinedPresentation={activeJoinedPresentation}
              directThinkAvailable={directThinkAvailable}
              directKnowAvailable={directKnowAvailable}
              focusRequestPending={focusRequestPending}
              focused={successfulFocusedEntry !== null}
              onToggleFocus={() => {
                if (successfulFocusedEntry) exitFocusRef.current();
                else if (selectedVisual) focusActionRef.current(selectedVisual.id);
              }}
              onSelectAuthority={(nextAuthority) => {
                setSelectedAuthority(nextAuthority);
                setSelectedMemberKey(null);
              }}
              onInspectNode={(visualId, nextAuthority, memberKey) => {
                inspectNodeRef.current(visualId);
                setSelectedAuthority(nextAuthority);
                setSelectedMemberKey(memberKey);
              }}
              onRefreshSelection={() => {
                if (selectedVisual) inspectNodeRef.current(selectedVisual.id);
              }}
              onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
              onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
            />
          ) : null}
        </RightGlassDrawer>
    </div>
  );
}
