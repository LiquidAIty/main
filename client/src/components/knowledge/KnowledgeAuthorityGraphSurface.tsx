import { useEffect, useMemo, useRef, useState } from 'react';

import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import { GRAPH_THEME } from '../graph/graphVisualTokens';
import {
  resolveCanonicalSubjectFocusVisualId,
  type CanonicalSubjectFocusRequest,
} from './canonicalSubjectLinks';
import {
  composeThinkKnowPresentation,
  type GraphAuthority,
  type GraphProjectionV1,
  type JoinedGraphPresentation,
} from './joinedKnowledgeGraphProjection';
import type { CanonicalSubjectDirectory } from './canonicalSubjectDirectory';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<GraphAuthority | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const inspectNodeRef = useRef<(id: string) => void>(() => undefined);
  const consumedSubjectFocusRequestRef = useRef<number | null>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const openNodeInspector = (visualNodeId: string) => {
    setControlsOpen(false);
    setSelectedMemberKey(null);
    setSelectedId(visualNodeId);
    setSelectedEdgeId(null);
    setInspectorOpen(true);
  };
  inspectNodeRef.current = openNodeInspector;
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
    projection,
    joinedPresentation,
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
      setSelectedMemberKey(null);
      setSelectedId(null);
      setSelectedEdgeId(null);
      setInspectorOpen(false);
      setControlsOpen(false);
    },
  });
  const {
    selectedVisual,
    directThinkAvailable,
    directKnowAvailable,
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
    if (!controlsOpen) return;
    const scrollHost = panelBodyRef.current?.parentElement;
    if (scrollHost) scrollHost.scrollTop = 0;
  }, [controlsOpen]);

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
      if (manualNavigationActive) exitManualFocus();
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
              directThinkAvailable={directThinkAvailable}
              directKnowAvailable={directKnowAvailable}
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
