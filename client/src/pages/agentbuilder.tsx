import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import FrontendCrashBoundary from '../components/diagnostics/FrontendCrashBoundary';
import AgentCanvas from '../features/agentbuilder/canvas/AgentCanvas';
import AgentBuilderRail from '../features/agentbuilder/core/AgentBuilderRail';
import AgentBuilderWorkspace from '../features/agentbuilder/core/AgentBuilderWorkspace';
import useAgentBuilderWorkspaceLayout from '../features/agentbuilder/core/useAgentBuilderWorkspaceLayout';
import AgentBuilderCompanionSurfaces from '../features/agentbuilder/core/AgentBuilderCompanionSurfaces';
import AgentBuilderChatWorkSurface from '../features/agentbuilder/console/AgentBuilderChatWorkSurface';
import useAgentBuilderSharedChat from '../features/agentbuilder/console/useAgentBuilderSharedChat';
import { selectedConversationId } from '../features/agentbuilder/console/sharedChatClient';
import useAgentBuilderAutosave, {
  projectDeckForPersistence,
} from '../features/agentbuilder/state/useAgentBuilderAutosave';
import useAgentBuilderCardEditor from '../features/agentbuilder/state/useAgentBuilderCardEditor';
import useAgentBuilderDeck from '../features/agentbuilder/state/useAgentBuilderDeck';
import useAgentBuilderDeckLoad from '../features/agentbuilder/state/useAgentBuilderDeckLoad';
import useAgentBuilderProject from '../features/agentbuilder/state/useAgentBuilderProject';
import AgentBuilderProjectDrawer from '../features/agentbuilder/project/AgentBuilderProjectDrawer';
import AgentCardChooserDialog from '../features/agentbuilder/project/AgentCardChooserDialog';
import useAgentBuilderSelection from '../features/agentbuilder/state/useAgentBuilderSelection';
import useAgentBuilderKnowledgeGraphs from '../features/agentbuilder/state/useAgentBuilderKnowledgeGraphs';
import useCardActiveAgentCounts from '../features/agentbuilder/state/useCardActiveAgentCounts';
import useAgentCardChooser from '../features/agentbuilder/state/useAgentCardChooser';
import AgentBuilderWorkspaceInspector from '../features/agentbuilder/inspector/AgentBuilderWorkspaceInspector';
import useAgentBuilderInspectorBridges from '../features/agentbuilder/inspector/useAgentBuilderInspectorBridges';
import { DEFAULT_PROJECT_DECK_ID } from '../features/agentbuilder/deck/newProjectDeck';
import {
  buildProjectlessDeckDocument,
  formatBuilderStatusMessage,
  readDeckDocument,
  resolveProjectDeckLoadResult,
} from '../features/agentbuilder/deck/deckDocument';
import { deriveVisibleRailItems } from '../features/agentbuilder/rail/railVisibility';
import { deriveAgentBuilderWorkspaceIdentity } from '../features/agentbuilder/core/agentBuilderWorkspaceIdentity';
import {
  BuilderRailMoonOrb,
  synodicPhaseFromDate,
} from '../features/agentbuilder/core/BuilderRailMoonOrb';
import {
  isAbortLikeError,
} from '../features/agentbuilder/api/requestGuards';
import {
  useAgentBuilderDeckSave,
} from '../features/agentbuilder/state/useAgentBuilderDeckSave';
import useAgentBuilderWorkspaceNavigation, {
  type AgentBuilderCanvasFocus,
  type AgentBuilderWorkspaceView,
} from '../features/agentbuilder/core/useAgentBuilderWorkspaceNavigation';
import type {
  DeckDocument,
} from '../types/agentgraph';

// Agent Builder composes Project navigation, Main/Builder chat, the agent
// canvas, knowledge/app surfaces, and the one shared inspector drawer.

const AGENT_BUILDER_COLORS = {
  primary: '#4FA2AD', // teal
  bg: '#1F1F1F',
  panel: '#2B2B2B',
  border: '#3A3A3A',
  text: '#FFFFFF',
  neutral: '#E0DED5',
  warn: '#D98458',
};
// The launch surface renders one mixed human graph. ThinkGraph and KnowGraph
// remain separate provider authorities; CodeGraph remains agent-facing through CBM.
const PROJECTS_API = '/api/projects';

export default function AgentBuilder(): ReactElement {
  const BUILDER_DEV = import.meta.env.DEV;
  const [workspaceView, setWorkspaceView] = useState<AgentBuilderWorkspaceView>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('workspace') === 'knowledge') return 'knowledge';
    if (params.get('workspace') === 'worldview') return 'worldview';
    return params.get('projectId') ? 'canvas' : 'chat';
  });
  // Left-rail camera focus: carries a requested pan/zoom-to-fit to AgentCanvas;
  // bumping nonce re-triggers the camera fit without swapping node sets.
  const [canvasFocusZone, setCanvasFocusZone] = useState<AgentBuilderCanvasFocus>(null);
  const {
    activeProject,
    canvasProjectId,
    builderProjects,
    projectsError,
    setProjectsError,
    setActiveProjectWithUrl,
    refreshProjects,
  } = useAgentBuilderProject({
    projectsApi: PROJECTS_API,
    workspaceView,
    openCanvasWorkspace: () => setWorkspaceView('canvas'),
  });
  const {
    chatMinWidth,
    chatPanelWidth,
    companionContentMinWidth,
    companionMinWidth,
    companionOverlayWidth,
    companionViewportWidth,
    companionVisibleWidth,
    handleSplitterPointerDown,
    onSplitterPointerEnter,
    onSplitterPointerLeave,
    splitterActive,
    workspaceShellRef,
  } = useAgentBuilderWorkspaceLayout({
    workspaceView,
  });
  const [moonPhase01, setMoonPhase01] = useState(() =>
    synodicPhaseFromDate(new Date()),
  );
  const {
    deck,
    setDeck,
    setDeckFromPersistence,
    deckRevision,
    setDeckRevision,
    deckLoadBusy,
    setDeckLoadBusy,
    setDeckSaveBusy,
    setDeckStatusMessage,
    deckLoadError,
    setDeckLoadError,
    stateLoaded,
    setStateLoaded,
    transientCardIds,
    setTransientCardIds,
    currentDeckRef,
    deckSaveAbortRef,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    lastDeckPersistReasonRef,
    recordDeckWriteReason,
    recordUiOnlyAction,
    snapshotDeckBoard,
    evaluateBoardIntegrityForSave,
  } = useAgentBuilderDeck({
    builderDev: BUILDER_DEV,
    canvasProjectId,
    createInitialDeck: buildProjectlessDeckDocument,
  });
  const canonicalDeckReady = Boolean(
    canvasProjectId
      && stateLoaded
      && !deckLoadBusy
      && !deckLoadError
      && deckRevision
      && deck.id === DEFAULT_PROJECT_DECK_ID,
  );
  const cardActivity = useCardActiveAgentCounts({
    projectId: canonicalDeckReady ? canvasProjectId : '',
    deck,
  });
  const visibleRailItems = useMemo(
    () =>
      deriveVisibleRailItems({
        deck,
        workspaceView,
      }),
    [deck, workspaceView],
  );
  const {
    inspectorDrawerOpen,
    setInspectorDrawerOpen,
    selectedCardId,
    setSelectedCardId,
    selectedEdgeId,
    setSelectedEdgeId,
    tab,
    setTab,
    openDrawer,
    setOpenDrawer,
  } = useAgentBuilderSelection({
    deck,
  });
  const cardDraftFlushRef = useRef<(() => Promise<boolean>) | null>(null);
  const registerCardDraftFlush = useCallback((save: (() => Promise<boolean>) | null) => {
    cardDraftFlushRef.current = save;
  }, []);
  const inspectorBridges = useAgentBuilderInspectorBridges();
  const {
    mainCardId,
    directChatTargets,
    builderCard,
    cardTitlesByProfile,
    worldSignalsCardId,
    worldViewCard,
    tradingCard,
  } = useMemo(() => deriveAgentBuilderWorkspaceIdentity(deck), [deck]);
  const [conversationId] = useState(() => selectedConversationId(window.location.search));
  const knowledgeGraphs = useAgentBuilderKnowledgeGraphs({
    projectId: activeProject,
    deckId: DEFAULT_PROJECT_DECK_ID,
    conversationId,
  });
  const {
    setCurrentResponderCardId,
    subjectFocusRequest,
    sharedChatProps,
  } = useAgentBuilderSharedChat({
    activeProject,
    canvasProjectId,
    conversationId,
    workspaceView,
    setWorkspaceView,
    canonicalDeckReady,
    setDeckStatusMessage,
    mainCardId,
    directChatTargets,
    knowledgeGraphs,
    worldSignalsCardId,
    worldViewCard,
    tradingCard,
    worldViewBridge: inspectorBridges.worldViewBridge,
    colors: AGENT_BUILDER_COLORS,
  });
  useEffect(() => {
    const tick = () => setMoonPhase01(synodicPhaseFromDate(new Date()));
    tick();
    const id = window.setInterval(tick, 120000);
    return () => window.clearInterval(id);
  }, []);

  useAgentBuilderDeckLoad({
    canvasProjectId,
    projectsApi: PROJECTS_API,
    builderDeckId: DEFAULT_PROJECT_DECK_ID,
    resolveProjectDeckLoadResult,
    formatBuilderStatusMessage,
    recordDeckWriteReason,
    snapshotDeckBoard,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    setDeck,
    setDeckRevision,
    setDeckLoadBusy,
    setDeckLoadError,
    setStateLoaded,
    setDeckStatusMessage,
    reloadToken: 0,
  });
  const { handleSaveDeck } =
    useAgentBuilderDeckSave({
      builderDev: BUILDER_DEV,
      canvasProjectId,
      deck,
      deckId: DEFAULT_PROJECT_DECK_ID,
      deckRevision,
      deckSaveAbortRef,
      formatBuilderStatusMessage,
      readDeckDocument,
      setDeck: setDeckFromPersistence,
      setDeckRevision,
      setDeckSaveBusy,
      setDeckStatusMessage,
      projectsApi: PROJECTS_API,
      recordDeckWriteReason,
      onDeckSaveSettled: (entry) => {
        if (entry.ok) {
          lastPersistedBoardFingerprintRef.current = JSON.stringify({
            nodes: (entry.document || deck).nodes,
            edges: (entry.document || deck).edges,
          });
          lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(entry.document || deck);
        }
        console.info('[builder][deck-save]', entry);
      },
    });
  useAgentBuilderAutosave({
    builderDev: BUILDER_DEV,
    canvasProjectId,
    projectsApi: PROJECTS_API,
    builderDeckId: DEFAULT_PROJECT_DECK_ID,
    deck,
    deckRevision,
    deckLoadBusy,
    deckLoadError,
    stateLoaded,
    transientCardIds,
    deckSaveAbortRef,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    lastDeckPersistReasonRef,
    evaluateBoardIntegrityForSave,
    snapshotDeckBoard,
    formatBuilderStatusMessage,
    isAbortLikeError,
    setDeckRevision,
    setDeckStatusMessage,
  });

  const handleSetBuilderProjectCodeFolder = useCallback(async (folder: string) => {
    const normalizedFolder = folder.trim();
    const nextDeck = projectDeckForPersistence(
      {
        ...deck,
        projectCodeFolder: normalizedFolder || null,
        version: deck.version + 1,
      },
      transientCardIds,
    );
    recordDeckWriteReason('builder-project-code-folder');
    await handleSaveDeck(nextDeck);
  }, [deck, handleSaveDeck, recordDeckWriteReason, transientCardIds]);
  const prepareDeckForCardSave = useCallback(
    (document: DeckDocument, cardId: string) => projectDeckForPersistence(
      document,
      transientCardIds,
      new Set([cardId]),
    ),
    [transientCardIds],
  );
  const cardChooser = useAgentCardChooser({
    canonicalDeckReady,
    canvasProjectId,
    deckRevision,
    currentDeckRef,
    cardDraftFlushRef,
    setTransientCardIds,
    setDeck,
    setDeckFromPersistence,
    setDeckRevision,
    setDeckStatusMessage,
    setInspectorDrawerOpen,
    setSelectedCardId,
    setSelectedEdgeId,
    recordDeckWriteReason,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    snapshotDeckBoard,
  });
  const {
    handleSaveCardConfiguration,
    handleSaveSelectedCardConfig,
    handleRenameSelectedCard,
    selectedCard,
    selectedCardConfig,
  } = useAgentBuilderCardEditor({
    persistDeck: handleSaveDeck,
    deck,
    recordDeckWriteReason,
    selectedCardId,
    setDeck,
    prepareDeckForCardSave,
    onCardPersisted: cardChooser.markCardPersisted,
  });
  useEffect(() => {
    if (workspaceView !== 'canvas') return;
    recordUiOnlyAction('tab-switch');
  }, [recordUiOnlyAction, tab, workspaceView]);

  useEffect(() => {
    if (workspaceView !== 'canvas') return;
    recordUiOnlyAction('drawer-toggle');
  }, [openDrawer, recordUiOnlyAction, workspaceView]);

  const handleSelectCard = useCallback(
    async (cardId: string | null) => {
      if (cardDraftFlushRef.current && !(await cardDraftFlushRef.current())) return;
      recordUiOnlyAction('node-selection');
      setSelectedCardId(cardId);
      const selectedNode = cardId
        ? deck.nodes.find((node) => node.id === cardId) || null
        : null;
      // Canvas selection always opens the saved-card editor. Agent app surfaces
      // are opened from their connected rail icons.
      setInspectorDrawerOpen(Boolean(selectedNode));
      if (cardId) {
        setSelectedEdgeId(null);
        setTab('Prompt');
      }
    },
    [deck.nodes, recordUiOnlyAction, setInspectorDrawerOpen, setSelectedCardId, setSelectedEdgeId, setTab],
  );

  const handleSelectEdge = useCallback(
    async (edgeId: string | null) => {
      if (cardDraftFlushRef.current && !(await cardDraftFlushRef.current())) return;
      recordUiOnlyAction('edge-selection');
      setInspectorDrawerOpen(false);
      setSelectedEdgeId(edgeId);
      if (edgeId) {
        setSelectedCardId(null);
      }
    },
    [recordUiOnlyAction],
  );

  const handleDeleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    recordDeckWriteReason('edge-delete');
    setDeck((currentDeck) => ({
      ...currentDeck,
      version: currentDeck.version + 1,
      edges: currentDeck.edges.filter((edge) => edge.id !== selectedEdgeId),
    }));
    setSelectedEdgeId(null);
  }, [recordDeckWriteReason, selectedEdgeId]);

  const closeInspectorDrawer = useCallback(async () => {
    if (cardDraftFlushRef.current && !(await cardDraftFlushRef.current())) return false;
    setInspectorDrawerOpen(false);
    setSelectedCardId(null);
    setSelectedEdgeId(null);
    return true;
  }, []);

  const dockInspectorDrawer = useCallback(async () => {
    if (cardDraftFlushRef.current && !(await cardDraftFlushRef.current())) return false;
    setInspectorDrawerOpen(false);
    return true;
  }, []);

  const chatSurface = (
    <AgentBuilderChatWorkSurface
      activeProject={activeProject}
      canvasProjectId={canvasProjectId}
      conversationId={conversationId}
      builderCard={builderCard}
      sharedChatProps={sharedChatProps}
    />
  );

  const canvasSurface = (
    <AgentCanvas
      surfaceRole="large"
      shellStyle={{ height: '100%' }}
      ready={canonicalDeckReady}
      loadError={deckLoadError}
      document={deck}
      setDocument={setDeck}
      onPersistGraphMutation={recordDeckWriteReason}
      activeCardIds={cardActivity.activeCardIds}
      activeAgentCounts={cardActivity.activeAgentCounts}
      activeEdgeIds={[]}
      selectedCardId={selectedCardId}
      selectedEdgeId={selectedEdgeId}
      onSelectCard={handleSelectCard}
      onSelectEdge={handleSelectEdge}
      onDeleteSelectedEdge={handleDeleteSelectedEdge}
      inspectMode={false}
      focusZone={canvasFocusZone}
    />
  );

  const {
    showCanvasWorkspace,
    showKnowledgeWorkspace,
    showTradingWorkspace,
    showWorldSignalsWorkspace,
    showWorldViewWorkspace,
  } = useAgentBuilderWorkspaceNavigation({
    cardDraftFlushRef,
    closeInspectorDrawer,
    setCurrentResponderCardId,
    setDeckStatusMessage,
    setInspectorDrawerOpen,
    setWorkspaceView,
    setCanvasFocusZone,
    setWorldViewInspectorOpen: inspectorBridges.setWorldViewInspectorOpen,
    tradingCard,
    worldSignalsCardId,
    worldViewCard,
  });

  const workspaceRail = (
    <AgentBuilderRail
      colors={AGENT_BUILDER_COLORS}
      workspaceView={workspaceView}
      visibleRailItems={visibleRailItems}
      moonOrb={<BuilderRailMoonOrb phase01={moonPhase01} />}
      onShowWorldSignalsWorkspace={showWorldSignalsWorkspace}
      onShowWorldViewWorkspace={showWorldViewWorkspace}
      onShowCanvasWorkspace={showCanvasWorkspace}
      onOpenAddAgent={cardChooser.openChooser}
      onShowKnowledgeWorkspace={showKnowledgeWorkspace}
      onShowTradingWorkspace={showTradingWorkspace}
      onOpenNavigationDrawer={() => setOpenDrawer('navigation')}
    />
  );

  const workspaceCompanionSurfaceHost = (
    <AgentBuilderCompanionSurfaces
      workspaceView={workspaceView}
      knowledgeGraphProps={{
        minHeight: 420,
        surfaceRole: 'companion',
        projections: knowledgeGraphs.projections,
        onRemoveThinkGraphEvidence: knowledgeGraphs.removeThinkGraphEvidence,
        onRemoveKnowGraphEvidence: knowledgeGraphs.removeKnowGraphEvidence,
        errors: knowledgeGraphs.errors,
        statuses: knowledgeGraphs.statuses,
        onReadFocusNeighborhood: knowledgeGraphs.readProviderNeighborhood,
        subjectFocusRequest,
      }}
      tradingProps={{
        symbol: 'RDW',
        projectId: canvasProjectId || null,
        deckId: DEFAULT_PROJECT_DECK_ID,
        card: tradingCard,
      }}
      worldSignalsProps={{
        projectId: typeof activeProject === 'string' && activeProject ? activeProject : null,
        cardId: worldSignalsCardId,
        onInspectorSectionRequest: inspectorBridges.handleWorldSignalsInspectorRequest,
        onLayerStateChange: inspectorBridges.setWorldSignalsLayerState,
        onBridgeChange: inspectorBridges.setWorldSignalsBridge,
      }}
      worldViewProps={{
        projectId: canvasProjectId || null,
        cardId: worldViewCard?.id || null,
        onBridgeChange: inspectorBridges.setWorldViewBridge,
        inspectorContainer: inspectorBridges.worldViewInspectorHost,
      }}
    />
  );

  const workspaceDrawer = (
    <AgentBuilderWorkspaceInspector
      workspaceView={workspaceView}
      agent={selectedCard ? {
        available: canonicalDeckReady,
        open: inspectorDrawerOpen,
        title: String(selectedCard.title || 'Agent'),
        onClose: () => { void dockInspectorDrawer(); },
        onOpen: () => setInspectorDrawerOpen(true),
        panelProps: {
          canvasProjectId,
          conversationId,
          deck,
          selectedCard,
          selectedCardConfig,
          tab,
          setTab,
          mainCardId,
          builderCardId: builderCard?.id || null,
          cardTitlesByProfile,
          cardDraftFlushRef,
          registerCardDraftFlush,
          onRenameSelectedCard: handleRenameSelectedCard,
          onSaveSelectedCardConfig: handleSaveSelectedCardConfig,
          onSetBuilderProjectCodeFolder: handleSetBuilderProjectCodeFolder,
          projectCodeFolder: deck.projectCodeFolder ?? null,
        },
      } : null}
      worldSignals={{
        section: inspectorBridges.worldSignalsInspectorSection,
        open: inspectorBridges.worldSignalsInspectorOpen,
        bridge: inspectorBridges.worldSignalsBridge,
        layerState: inspectorBridges.worldSignalsLayerState,
        onClose: inspectorBridges.closeWorldSignalsInspector,
        onOpen: () => inspectorBridges.setWorldSignalsInspectorOpen(true),
        onSectionChange: inspectorBridges.setWorldSignalsInspectorSection,
      }}
      worldView={{
        available: Boolean(worldViewCard),
        open: inspectorBridges.worldViewInspectorOpen,
        onClose: () => inspectorBridges.setWorldViewInspectorOpen(false),
        onOpen: () => inspectorBridges.setWorldViewInspectorOpen(true),
        setInspectorHost: inspectorBridges.setWorldViewInspectorHost,
      }}
      trading={{
        available: Boolean(tradingCard),
        open: inspectorDrawerOpen,
        configuration: tradingCard?.runtimeOptions?.configuration || {},
        onClose: () => setInspectorDrawerOpen(false),
        onOpen: () => setInspectorDrawerOpen(true),
        onSave: (configuration) => {
          handleSaveCardConfiguration(tradingCard!.id, configuration);
        },
      }}
    />
  );

  return (
    <FrontendCrashBoundary scopeLabel="AgentBuilder">
      <div
        className="h-screen w-full flex overflow-hidden"
        style={{ background: AGENT_BUILDER_COLORS.bg, color: AGENT_BUILDER_COLORS.text }}
      >
        <AgentBuilderWorkspace
          rail={workspaceRail}
          workspaceShellRef={workspaceShellRef}
          workspaceView={workspaceView}
          surfaceName="chat"
          chatPanelWidth={chatPanelWidth}
          chatMinWidth={chatMinWidth}
          chat={chatSurface}
          splitterActive={splitterActive}
          onSplitterPointerEnter={onSplitterPointerEnter}
          onSplitterPointerLeave={onSplitterPointerLeave}
          onSplitterPointerDown={handleSplitterPointerDown}
          companionMinWidth={companionMinWidth}
          companionContentMinWidth={companionContentMinWidth}
          companionOverlayWidth={companionOverlayWidth}
          companionViewportWidth={companionViewportWidth}
          companionVisibleWidth={companionVisibleWidth}
          canvas={canvasSurface}
          companion={workspaceCompanionSurfaceHost}
          drawer={<>{workspaceDrawer}</>}
        />

        <AgentCardChooserDialog
          open={cardChooser.open}
          choices={cardChooser.choices}
          busy={cardChooser.busy}
          error={cardChooser.error}
          colors={AGENT_BUILDER_COLORS}
          onClose={cardChooser.close}
          onCreateNewAgent={() => { void cardChooser.createNewAgent(); }}
          onAttachSavedCard={(choice) => { void cardChooser.attachSavedCard(choice); }}
        />

        <AgentBuilderProjectDrawer
          activeProject={activeProject}
          colors={AGENT_BUILDER_COLORS}
          open={openDrawer === 'navigation'}
          projects={builderProjects}
          projectsApi={PROJECTS_API}
          projectsError={projectsError}
          onClose={() => setOpenDrawer(null)}
          refreshProjects={refreshProjects}
          setActiveProjectWithUrl={setActiveProjectWithUrl}
          setProjectsError={setProjectsError}
        />
      </div>
    </FrontendCrashBoundary>
  );
}
