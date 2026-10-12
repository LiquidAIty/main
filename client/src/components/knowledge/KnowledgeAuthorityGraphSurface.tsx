import { useEffect, useMemo, useRef, useState } from 'react';

import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import { GRAPH_THEME } from '../graph/graphVisualTokens';
import {
  resolveCanonicalEntityFocusVisualId,
  type CanonicalEntityFocusRequest,
} from './canonicalEntityLinks';
import {
  composeThinkKnowPresentation,
  selectThinkKnowPresentation,
  type GraphAuthority,
  type GraphProjectionV1,
  type JoinedGraphPresentation,
  type KnowledgeGraphViewMode,
} from './joinedKnowledgeGraphProjection';
import {
  readCanonicalEntityProviderPointers,
  type CanonicalEntityDirectory,
  type CanonicalEntityHeader,
} from './canonicalEntityDirectory';
import {
  selectedFocusCandidates,
  type ReadProviderFocusNeighborhood,
} from './knowledgeGraphFocusPresentation';
import { KnowledgeGraphInspector } from './KnowledgeGraphInspector';
import { KnowledgeGraphPresentationControls } from './KnowledgeGraphPresentationControls';
import { deriveKnowledgeGraphVisualSelection } from './knowledgeGraphVisualSelection';
import { useKnowledgeGraphPresentationLifecycle } from './useKnowledgeGraphPresentationLifecycle';
import './knowledgeAuthorityGraphSurface.css';

export function JoinedKnowledgeGraphSurface({
  projections,
  statuses,
  errors,
  onReadProviderFocusNeighborhood,
  relevanceQuery,
  onReadEntityContext,
  onRemoveThinkGraphEvidence,
  onRemoveThinkGraphRelationship,
  onRemoveKnowGraphEvidence,
  onRemoveKnowGraphRelationship,
  entityFocusRequest,
}: {
  projections: Record<GraphAuthority, GraphProjectionV1>;
  statuses?: Partial<Record<GraphAuthority, 'idle' | 'loading' | 'ready' | 'error'>>;
  errors?: Partial<Record<GraphAuthority, string>>;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  relevanceQuery?: string;
  onReadEntityContext?: (
    entity: CanonicalEntityHeader,
    query: string,
    limit?: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, any>>;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveThinkGraphRelationship?: (edgeId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  onRemoveKnowGraphRelationship?: (graphitiRelationshipId: string) => Promise<void>;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
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
      canonicalEntityDirectory={
        projections.thinkgraph.canonicalEntityDirectory
      }
      entityFocusRequest={entityFocusRequest}
      joinedPresentation={presentation}
      onReadProviderFocusNeighborhood={onReadProviderFocusNeighborhood}
      relevanceQuery={relevanceQuery}
      onReadEntityContext={onReadEntityContext}
      status={status}
      error={error}
      warning={warning}
      onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
      onRemoveThinkGraphRelationship={onRemoveThinkGraphRelationship}
      onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
      onRemoveKnowGraphRelationship={onRemoveKnowGraphRelationship}
    />
  );
}
function JoinedKnowledgeGraphProjectionSurface({
  status,
  error,
  warning,
  joinedPresentation,
  onReadProviderFocusNeighborhood,
  relevanceQuery,
  onReadEntityContext,
  onRemoveThinkGraphEvidence,
  onRemoveThinkGraphRelationship,
  onRemoveKnowGraphEvidence,
  onRemoveKnowGraphRelationship,
  canonicalEntityDirectory,
  entityFocusRequest,
}: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  warning?: string | null;
  joinedPresentation: JoinedGraphPresentation;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  relevanceQuery?: string;
  onReadEntityContext?: (
    entity: CanonicalEntityHeader,
    query: string,
    limit?: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, any>>;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveThinkGraphRelationship?: (edgeId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  onRemoveKnowGraphRelationship?: (graphitiRelationshipId: string) => Promise<void>;
  canonicalEntityDirectory?: CanonicalEntityDirectory | null;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<GraphAuthority | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<KnowledgeGraphViewMode>('combined');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [selectedEntityContext, setSelectedEntityContext] = useState<Record<string, any> | null>(null);
  const [entityContextError, setEntityContextError] = useState<string | null>(null);
  const [entityContextQuery, setEntityContextQuery] = useState(
    String(relevanceQuery || '').trim(),
  );
  const [entityContextLimit, setEntityContextLimit] = useState(1);
  const inspectNodeRef = useRef<(id: string) => void>(() => undefined);
  const consumedEntityFocusRequestRef = useRef<number | null>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const openNodeInspector = (visualNodeId: string) => {
    setControlsOpen(false);
    setSelectedMemberKey(null);
    setSelectedId(visualNodeId);
    setSelectedEdgeId(null);
    setInspectorOpen(true);
  };
  inspectNodeRef.current = openNodeInspector;
  const viewPresentation = useMemo(
    () => selectThinkKnowPresentation(joinedPresentation, viewMode),
    [joinedPresentation, viewMode],
  );
  const {
    activeJoinedPresentation,
    displayProjection,
    enterManualFocus,
    exitManualFocus,
    focusRelease,
    focusedEntry,
    focusRequestPending,
    manualNavigationActive,
    successfulFocusedEntry,
    hostRef,
    renderError,
    paperViewport,
    layout,
    style,
    physicsProfile,
    presentationControls,
    camera,
  } = useKnowledgeGraphPresentationLifecycle({
    projection: viewPresentation.projection,
    joinedPresentation: viewPresentation,
    onReadProviderFocusNeighborhood,
    selectedId,
    onInspectNode: visualNodeId => inspectNodeRef.current(visualNodeId),
    onInspectEdge: visualEdgeId => {
      setControlsOpen(false);
      setSelectedMemberKey(null);
      setSelectedId(null);
      setSelectedEdgeId(visualEdgeId);
      setInspectorOpen(true);
    },
    onClearSelection: () => {
      setViewMode('combined');
      setSelectedMemberKey(null);
      setSelectedId(null);
      setSelectedEdgeId(null);
      setInspectorOpen(false);
      setControlsOpen(false);
    },
    viewMode,
  });
  const {
    selectedVisual,
    directThinkAvailable,
    knowgraphEntityAvailable,
    selected,
    selectedEdge,
    inspectedAuthority,
    inspectedProjection,
  } = deriveKnowledgeGraphVisualSelection({
    displayProjection,
    activeJoinedPresentation,
    selectedId,
    selectedEdgeId,
    selectedAuthority,
    selectedMemberKey,
  });

  useEffect(() => {
    setEntityContextQuery(String(relevanceQuery || '').trim());
    setEntityContextLimit(1);
  }, [relevanceQuery, selectedId]);

  useEffect(() => {
    setSelectedEntityContext(null);
    setEntityContextError(null);
    const query = entityContextQuery.trim();
    if (!selected || selectedEdge || !inspectedAuthority || !query || !onReadEntityContext
      || !canonicalEntityDirectory) return undefined;
    const selectedEntityId = selected.id;
    const exactEntity = canonicalEntityDirectory.entities.find((entity) => (
      entity.canonicalName === selected.label
      && readCanonicalEntityProviderPointers(entity)?.some((pointer) => (
        pointer.authority === inspectedAuthority && pointer.entityId === selectedEntityId
      ))
    ));
    if (!exactEntity) return undefined;
    const controller = new AbortController();
    void onReadEntityContext(exactEntity, query, entityContextLimit, controller.signal).then(
      setSelectedEntityContext,
      (error) => {
        if (controller.signal.aborted) return;
        setEntityContextError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => controller.abort();
  }, [
    canonicalEntityDirectory,
    entityContextLimit,
    entityContextQuery,
    inspectedAuthority,
    onReadEntityContext,
    selected,
    selectedEdge,
  ]);

  useEffect(() => {
    if (!controlsOpen) return;
    const scrollHost = panelBodyRef.current?.parentElement;
    if (scrollHost) scrollHost.scrollTop = 0;
  }, [controlsOpen]);

  useEffect(() => {
    if (!entityFocusRequest
      || consumedEntityFocusRequestRef.current === entityFocusRequest.requestId
      || !displayProjection) return;
    const baseProjection = viewPresentation.projection;
    const visualNodeId = resolveCanonicalEntityFocusVisualId({
      projection: baseProjection,
      joinedPresentation: viewPresentation,
      directory: canonicalEntityDirectory,
      request: entityFocusRequest,
    });
    if (!visualNodeId) return;
    if (!displayProjection.nodes.some(node => node.id === visualNodeId)) {
      if (manualNavigationActive) exitManualFocus();
      return;
    }
    consumedEntityFocusRequestRef.current = entityFocusRequest.requestId;
    inspectNodeRef.current(visualNodeId);
  }, [
    canonicalEntityDirectory,
    displayProjection,
    viewPresentation,
    manualNavigationActive,
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
  const allNodes = displayProjection?.nodes.length ?? 0;
  const entryTitle = selected?.label || (selectedEdge ? selectedEdge.predicate : '');

  return (
    <div data-testid="knowledge-joined-surface" className="knowledge-authority-graph" data-layout={layout} data-style={style} data-physics-profile={physicsProfile} data-view-mode={viewMode} data-focus-phase={successfulFocusedEntry ? 'manual_blackhole_focus' : focusRequestPending ? 'focus_preparing' : focusRelease ? 'focus_release' : 'local_relational'} data-panel-open={controlsOpen || inspectorOpen} aria-busy={status === 'loading'}
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
        <div className="knowledge-authority-view-key" aria-label="Knowledge graph view">
          {([['thinkgraph', 'Think'], ['knowgraph', 'Know']] as const).map(([mode, label]) => (
            <button key={mode} type="button" aria-label={`${label} view`}
              aria-pressed={viewMode === mode} data-active={viewMode === mode}
              data-authority={mode}
              style={{ color: mode === 'thinkgraph'
                ? GRAPH_THEME.accent.think : GRAPH_THEME.accent.solar }} onClick={() => {
                exitManualFocus();
                setSelectedMemberKey(null);
                setSelectedId(null);
                setSelectedEdgeId(null);
                setInspectorOpen(false);
                setViewMode(mode);
              }}>
              <span aria-hidden="true" style={{ background: mode === 'thinkgraph'
                ? GRAPH_THEME.accent.think : GRAPH_THEME.accent.solar }} />{label}
            </button>
          ))}
        </div>
        <div ref={hostRef} className="knowledge-authority-network graph-canvas"
          data-renderer="engraphis-1.7.1"
          onWheelCapture={camera.beginCameraGesture}
          onWheel={camera.syncPaper}
          onPointerDown={camera.beginCameraGesture}
          onPointerMove={event => { if (event.buttons) camera.syncPaper(); }}
          onKeyDownCapture={camera.beginCameraGesture}
          onKeyDown={camera.syncPaper}
        />
        <GraphNavigationControls
          onZoomIn={() => camera.zoom('+')}
          onZoomOut={() => camera.zoom('-')}
          onFit={camera.fit}
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
            {...presentationControls}
          /> : (selected || selectedEdge) ? (
            <KnowledgeGraphInspector
              containerRef={panelBodyRef}
              selectedVisual={selectedVisual}
              selected={selected}
              selectedEdge={selectedEdge}
              inspectedAuthority={inspectedAuthority}
              inspectedProjection={inspectedProjection}
              activeJoinedPresentation={activeJoinedPresentation}
              selectedEntityContext={selectedEntityContext}
              entityContextError={entityContextError}
              entityContextQuery={entityContextQuery}
              entityContextLimit={entityContextLimit}
              directThinkAvailable={directThinkAvailable}
              knowgraphEntityAvailable={knowgraphEntityAvailable}
              focusRequestPending={focusRequestPending}
              focused={successfulFocusedEntry !== null}
              onToggleFocus={() => {
                if (successfulFocusedEntry) exitManualFocus();
                else if (selectedVisual) enterManualFocus(selectedVisual.id);
              }}
              onSelectAuthority={(nextAuthority) => {
                setSelectedAuthority(nextAuthority);
                setSelectedMemberKey(null);
              }}
              onSearchEntityContext={onReadEntityContext
                ? (query) => setEntityContextQuery(query.trim())
                : undefined}
              onSetEntityContextLimit={onReadEntityContext
                ? (limit) => setEntityContextLimit(
                  Math.max(1, Math.min(12, Math.trunc(limit))),
                )
                : undefined}
              onInspectNode={(visualId, nextAuthority, memberKey) => {
                inspectNodeRef.current(visualId);
                setSelectedAuthority(nextAuthority);
                setSelectedMemberKey(memberKey);
              }}
              onRefreshSelection={() => {
                if (selectedVisual) inspectNodeRef.current(selectedVisual.id);
              }}
              onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
              onRemoveThinkGraphRelationship={onRemoveThinkGraphRelationship}
              onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
              onRemoveKnowGraphRelationship={onRemoveKnowGraphRelationship}
            />
          ) : null}
        </RightGlassDrawer>
    </div>
  );
}
