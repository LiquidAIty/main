/**
 * Entity: Agent Builder
 * Relationship: This file composes the Project-scoped Agent Builder workspace and delegates each surface to its established state, transport, and persistence owner.
 * Entity: Projects
 * Relationship: This file binds workspace selection, navigation, canonical deck load, and save scope to the active Project.
 * Entity: Main Chat
 * Relationship: Selects Main or an explicitly addressed saved Bot Chat for the conversation surface; Hermes owns its messages, submission, history, Stop, voice, and Bot Mode state.
 * Entity: Agent Input
 * Relationship: Maps Hermes approval and clarification requests plus their response callbacks into the Main conversation surface without creating another request owner.
 * Entity: Builder Card
 * Relationship: This file mounts the saved Builder Card's own terminal as the permanent lower work surface beneath Main.
 * Entity: Saved Cards
 * Relationship: Composes exact deck hydration, persistence, Card attachment/authoring/editing, and explicit first-panel Card removal from the Project.
 * Entity: Card Topology
 * Relationship: This file owns the visible saved Card canvas composition, Card and edge selection, edge deletion, Hermes-sourced activity projection, and camera focus requests.
 * Entity: Card Terminals
 * Relationship: This file mounts the selected non-Main Card terminal in its CLI tab and keeps Builder's terminal separate from other Cards.
 * Entity: Magnetic Membership
 * Relationship: This file presents the inspect-only Tasks tab for Magnetic and the blue-connected Team Card without creating or mutating tasks.
 * Entity: Project Knowledge Graph
 * Relationship: This file mounts the shared ThinkGraph, KnowGraph, and CodeGraph workspace and routes exact chat Entity focus into that surface.
 * Entity: CodeGraph
 * Relationship: This file passes category inventory, File connection reads, and explicit File opening into the shared graph workspace.
 * Entity: Building Modeling
 * Relationship: Mounts the existing NRGSIM workspace and its Inspector only through the explicit modeling workspace URL, without probing other Projects on open.
 * Entity: Trading
 * Relationship: Opens the saved Trading Card's application surface and saves its Inspector configuration through the existing Card editor owner.
 * Entity: WorldView
 * Relationship: Resolves the saved WorldView profile and mounts its surface and controls through the shared workspace and Inspector.
 */

import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { tradingForecastCard } from '../features/trading/tradingState';

import MainProjectChat from '../components/main/MainProjectChat';
import {
  createCanonicalEntityMatcher,
  type CanonicalEntityFocusRequest,
  type CanonicalEntityFocusTarget,
} from '../components/builder/canonicalEntityLinks';
import {
  isCanonicalEntityDirectory,
  readCanonicalEntityProviderPointers,
} from '../components/knowledge/canonicalEntityDirectory';
import FrontendCrashBoundary from '../components/diagnostics/FrontendCrashBoundary';
import type { GodsEyeBridge } from '../components/worldsignal/GodsEyeSurface';
import WorldViewSurface from '../features/worldview/WorldViewSurface';
import AgentCanvasPane from '../features/agentbuilder/canvas/AgentCanvasPane';
import AgentBuilderRail from '../features/agentbuilder/core/AgentBuilderRail';
import AgentBuilderWorkspace from '../features/agentbuilder/core/AgentBuilderWorkspace';
import useAgentBuilderWorkspaceLayout from '../features/agentbuilder/core/useAgentBuilderWorkspaceLayout';
import CompanionSurfaceHost from '../features/agentbuilder/core/CompanionSurfaceHost';
import KnowledgeGraphFramework from '../components/knowledge/KnowledgeGraphFramework';
import type { GraphViewContext } from '../components/knowledge/knowledgeGraphProjection';
import AgentTerminalPanel from '../features/agentbuilder/console/AgentTerminalPanel';
import MainBuilderSplitPanel from '../features/agentbuilder/console/MainBuilderSplitPanel';
import useHermesMainChat from '../features/hermes/useHermesMainChat';
import useHermesCardRuntime from '../features/hermes/useHermesCardRuntime';
import { applicationFetch } from '../lib/applicationApi';
import useAgentBuilderAutosave, {
  projectDeckForPersistence,
} from '../features/agentbuilder/state/useAgentBuilderAutosave';
import useAgentBuilderCardEditor from '../features/agentbuilder/state/useAgentBuilderCardEditor';
import useAgentBuilderDeck from '../features/agentbuilder/state/useAgentBuilderDeck';
import useAgentBuilderDeckLoad from '../features/agentbuilder/state/useAgentBuilderDeckLoad';
import useAgentBuilderProject from '../features/agentbuilder/state/useAgentBuilderProject';
import AgentBuilderProjectDrawer from '../features/agentbuilder/project/AgentBuilderProjectDrawer';
import useAgentBuilderSelection from '../features/agentbuilder/state/useAgentBuilderSelection';
import useAgentBuilderKnowledgeGraphs from '../features/agentbuilder/state/useAgentBuilderKnowledgeGraphs';
import TradingUI from './tradingui';
import TradingUiInspectorPanel from '../features/trading/TradingUiInspectorPanel';
import MagneticTasksTab from '../features/agentbuilder/tasks/MagneticTasksTab';
import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
  graphDrawerSectionStyle,
} from '../components/graph/graphVisualTokens';
import RightGlassDrawer from '../components/graph/RightGlassDrawer';
// Decomposed Agent Builder modules (2026-07-08): the page is composition only;
// deck primitives/new-project template/document logic and rail derivation live in the feature.
import {
  cloneDeckDocument,
  safeText,
  wiredBotTargets,
} from '../features/agentbuilder/deck/deckPrimitives';
import {
  BUILDER_CARD_ID,
  BUILDER_DECK_ID,
} from '../features/agentbuilder/deck/newProjectDeck';
import {
  buildProjectlessDeckDocument,
  buildQuickAddAssistCard,
  formatBuilderStatusMessage,
  readDeckDocument,
  resolveProjectDeckLoadResult,
} from '../features/agentbuilder/deck/deckDocument';
import {
  deriveVisibleRailItems,
  isWorldViewCard,
} from '../features/agentbuilder/rail/railVisibility';
import {
  BuilderRailMoonOrb,
  synodicPhaseFromDate,
} from '../features/agentbuilder/core/BuilderRailMoonOrb';
import type {
  AgentCardInstance,
  DeckEdge,
  DeckDocument,
} from '../types/agentgraph';

type SavedCardChoice = {
  cardId: string;
  cardRevisionId: string;
  title: string;
  subtitle: string | null;
  runtimeProfile: string;
};

const loadCardEditor = () => import('../components/CardEditor');
const CardEditor = lazy(async () => {
  const mod = await loadCardEditor();
  return { default: mod.CardEditor };
});
void loadCardEditor();

// Agent Builder page: left workspace rail, Main Chat, canvas, and one six-tab Card inspector.
// No external deps. Persists per-project to localStorage. Includes mini force-graph.

const C = {
  primary: '#4FA2AD', // teal
  bg: '#1F1F1F',
  panel: '#2B2B2B',
  border: '#3A3A3A',
  text: '#FFFFFF',
  neutral: '#E0DED5',
  accent: '#8358A4',
  warn: '#D98458',
};

class KnowledgeSurfaceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-testid="knowledge-surface-error"
          style={{
            height: '100%',
            width: '100%',
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: GRAPH_THEME.background.knowledgeSurface,
          }}
        >
          <div
            style={graphDrawerSectionStyle({
              width: 'min(560px, 100%)',
              padding: 16,
              color: GRAPH_THEME.drawer.inputMuted,
              lineHeight: 1.5,
            })}
          >
            <div
              style={{
                color: GRAPH_THEME.drawer.inputText,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Knowledge graph unavailable
            </div>
            <div>
              {this.state.error.message || 'The Knowledge graph failed to load.'}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

class CardEditorErrorBoundary extends React.Component<
  { cardTitle: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="card-editor-error"
        style={graphDrawerSectionStyle({
          padding: '12px 14px',
          color: 'rgba(255,162,162,0.95)',
        })}
      >
        {this.props.cardTitle} configuration could not be rendered: {this.state.error.message}
      </div>
    );
  }
}

const BUILDER_PROJECT_TABS = ['Plan'] as const;
const BUILDER_NODE_TABS = ['Prompt', 'Runtime', 'Skills', 'Tools'] as const;
const AGENT_EDITOR_DEFAULT_WIDTH = 344;

function hasTaskLedger(card: AgentCardInstance | null | undefined): boolean {
  return card?.id === 'card_magentic' || card?.id === 'card_team';
}

// The Graphs workspace presents independently visible Think, Know, and opt-in Code
// layers on one canvas; all three remain backed by their own provider authority.
const PROJECTS_API = '/api/projects';
const NrgsimWorkspace = lazy(() => import('../../../agent-products/nrgsim/client/src/components/energy/NrgsimWorkspace'));

/** Mean synodic month in days (NASA/USNO convention). */
export default function AgentBuilder({ embedded = false }: { embedded?: boolean } = {}): React.ReactElement {
  const BUILDER_DEV = import.meta.env.DEV;
  const largeSurface = 'chat' as const;
  const [workspaceView, setWorkspaceView] = useState<
    | 'chat'
    | 'canvas'
    | 'knowledge'
    | 'trading'
    | 'worldview'
    | 'nrgsim'
  >(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('workspace') === 'knowledge') return 'knowledge';
    if (params.get('workspace') === 'worldview') return 'worldview';
    if (params.get('workspace') === 'nrgsim') return 'nrgsim';
    return params.get('projectId') ? 'canvas' : 'chat';
  });
  // Left-rail camera focus: carries a requested pan/zoom-to-fit to BuilderCanvas;
  // bumping nonce re-triggers the camera fit without swapping node sets.
  const [canvasFocusZone, setCanvasFocusZone] = useState<
    { zone: 'agents'; nonce: number } | null
  >(null);
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
  const publishGraphView = useCallback(async (body: string) => {
    const response = await applicationFetch('/api/thinkgraph/view-context', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) throw new Error('The displayed graph context could not be delivered.');
  }, []);
  const graphMapKeyRef = useRef('');
  const onGraphViewContext = useCallback((view: GraphViewContext) => {
    if (view.map.projectId !== canvasProjectId) return;
    const key = JSON.stringify({ projectId: view.map.projectId, map: view.map, openNode: view.openNode, selectionId: view.selectionId });
    if (graphMapKeyRef.current !== key) {
      graphMapKeyRef.current = key;
      void publishGraphView(key).catch(() => { graphMapKeyRef.current = ''; });
    }
  }, [canvasProjectId, publishGraphView]);
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
    setDeckState,
    deckRevision,
    setDeckRevision,
    deckLoadBusy,
    setDeckLoadBusy,
    deckSaveBusy,
    setDeckSaveBusy,
    deckStatusMessage,
    setDeckStatusMessage,
    deckLoadError,
    setDeckLoadError,
  } = useAgentBuilderDeck({
    createInitialDeck: buildProjectlessDeckDocument,
  });
  const [stateLoaded, setStateLoaded] = useState(false);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [deleteCardError, setDeleteCardError] = useState<string | null>(null);
  const [savedCardChooserOpen, setSavedCardChooserOpen] = useState(false);
  const [savedCardChoices, setSavedCardChoices] = useState<SavedCardChoice[]>([]);
  const [savedCardChooserBusy, setSavedCardChooserBusy] = useState(false);
  const [savedCardChooserError, setSavedCardChooserError] = useState<string | null>(null);
  const [transientNewCardIds, setTransientNewCardIds] = useState<Set<string>>(
    () => new Set(),
  );
  const canonicalDeckReady = Boolean(
    canvasProjectId
      && stateLoaded
      && !deckLoadBusy
      && !deckLoadError
      && deckRevision
      && deck.id === BUILDER_DECK_ID,
  );
  const runtimeIdentities = useMemo(() => canonicalDeckReady
    ? deck.nodes.flatMap((card) => (
        card.enabled !== false && card.runtime.kind === 'hermes'
          ? [{ cardId: card.id, profile: card.runtime.profile }]
          : []
      ))
    : [], [canonicalDeckReady, deck.nodes]);
  const cardRuntimeSnapshots = useHermesCardRuntime(runtimeIdentities);
  const activeCardIds = useMemo(() => Object.entries(cardRuntimeSnapshots)
    .filter(([, snapshot]) => snapshot.running)
    .map(([cardId]) => cardId), [cardRuntimeSnapshots]);
  const activeAgentCounts = useMemo(() => Object.fromEntries(
    Object.entries(cardRuntimeSnapshots).map(([cardId, snapshot]) => [
      cardId,
      snapshot.activeModelCount,
    ]),
  ), [cardRuntimeSnapshots]);
  const currentDeckRef = useRef(deck);
  useEffect(() => {
    currentDeckRef.current = deck;
  }, [deck]);
  const visibleRailItems = useMemo(
    () =>
      deriveVisibleRailItems({
        deck,
      }),
    [deck],
  );
  const {
    inspectorDrawerOpen,
    setInspectorDrawerOpen,
    selectedCardId,
    setSelectedCardId,
    selectedEdgeId,
    setSelectedEdgeId,
    setBuilderCanvasFocusRequest,
    tab,
    setTab,
    openDrawer,
    setOpenDrawer,
  } = useAgentBuilderSelection({
    deck,
  });
  const cardLeaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [worldViewInspectorHost, setWorldViewInspectorHost] = useState<HTMLDivElement | null>(null);
  const [worldViewInspectorOpen, setWorldViewInspectorOpen] = useState(true);
  const [modelingInspectorHost, setModelingInspectorHost] = useState<HTMLDivElement | null>(null);
  const [modelingInspectorOpen, setModelingInspectorOpen] = useState(true);
  const [transientCardInputs, setTransientCardInputs] = useState<Record<string, string>>({});
  const mainCardId = useMemo(
    () => deck.nodes.find((card) => (
      card.runtime.kind === 'hermes' && card.runtime.mode === 'main'
    ))?.id || null,
    [deck.nodes],
  );
  const builderCard = useMemo(
    () => deck.nodes.find((card) => (
      card.runtime.kind === 'hermes'
      && card.id === BUILDER_CARD_ID
    )) || null,
    [deck.nodes],
  );
  const mainChatTargets = useMemo(() => {
    if (!mainCardId) return [];
    const cardById = new Map(deck.nodes.map((card) => [card.id, card] as const));
    const targets = new Set<string>();
    for (const edge of deck.edges) {
      if (edge.enabled === false) continue;
      if (edge.edgeType === 'flow' && edge.source === mainCardId) targets.add(edge.target);
      if (edge.edgeType === 'magentic_option') {
        targets.add(edge.source);
        targets.add(edge.target);
      }
    }
    targets.delete(mainCardId);
    return [...targets].flatMap((cardId) => {
      const card = cardById.get(cardId);
      if (!card || card.enabled === false || card.runtime.kind !== 'hermes') return [];
      const title = safeText(card.title || card.id).trim();
      return title ? [{ cardId: card.id, title, address: title }] : [];
    });
  }, [deck.edges, deck.nodes, mainCardId]);
  const [chatSelection, setChatSelection] = useState<{ projectId: string; cardId: string } | null>(null);
  const chatCard = deck.nodes.find((card) => card.id === (
    chatSelection?.projectId === canvasProjectId ? chatSelection.cardId : mainCardId
  ));
  const chatProfile = chatCard?.runtime.kind === 'hermes' ? chatCard.runtime.profile : 'main';
  const chatTitle = chatCard?.title || 'Main';
  const mainChat = useHermesMainChat(canvasProjectId, chatProfile, chatTitle);
  const cardTitlesByProfile = useMemo(() => {
    const titles = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const card of deck.nodes) {
      const profile = String(card.runtime.profile || '').trim();
      const title = String(card.title || '').trim();
      if (!profile || !title) continue;
      const previous = titles.get(profile);
      if (previous && previous !== title) ambiguous.add(profile);
      else titles.set(profile, title);
    }
    for (const profile of ambiguous) titles.delete(profile);
    return Object.fromEntries(titles);
  }, [deck.nodes]);
  const [worldViewBridge, setWorldViewBridge] = useState<GodsEyeBridge | null>(null);
  const worldViewCard = useMemo(
    () => {
      const owners = deck.nodes.filter((node) => isWorldViewCard(node));
      return owners.length === 1 ? owners[0] : null;
    },
    [deck.nodes],
  );
  const tradingCard = useMemo(
    () => deck.nodes.find((card) => card.id === 'card_trading_workbench') || null,
    [deck.nodes],
  );
  const forecastCard = tradingForecastCard(tradingCard);
  const conversationId = canvasProjectId;
  const knowledgeGraphs = useAgentBuilderKnowledgeGraphs({
    projectId: activeProject,
    deckId: BUILDER_DECK_ID,
    conversationId,
    worldView: workspaceView === 'worldview' && worldViewCard?.enabled !== false && worldViewCard && worldViewBridge
      ? { cardId: worldViewCard.id, bridge: worldViewBridge } : null,
  });
  const canonicalEntityMatcher = useMemo(
    () => createCanonicalEntityMatcher({
      thinkgraph: knowledgeGraphs.projections.thinkgraph,
      knowgraph: knowledgeGraphs.projections.knowgraph,
    }),
    [knowledgeGraphs.projections.knowgraph, knowledgeGraphs.projections.thinkgraph],
  );
  const entityFocusRequestIdentityRef = useRef(0);
  const [entityFocusRequest, setEntityFocusRequest] =
    useState<CanonicalEntityFocusRequest | null>(null);
  useEffect(() => {
    if (workspaceView !== 'knowledge') setEntityFocusRequest(null);
  }, [activeProject, workspaceView]);
  const handleCanonicalEntityFocus = useCallback((target: CanonicalEntityFocusTarget) => {
    if (!activeProject || target.projectId !== activeProject) return;
    entityFocusRequestIdentityRef.current += 1;
    setWorkspaceView('knowledge');
    setEntityFocusRequest({
      ...target,
      requestId: entityFocusRequestIdentityRef.current,
    });
  }, [activeProject]);
  const handleKnowEvidenceFocus = useCallback((episodeId: string) => {
    const exactEpisodeId = episodeId.trim();
    const knowProjection = knowledgeGraphs.projections.knowgraph;
    const directory = knowledgeGraphs.projections.thinkgraph.canonicalEntityDirectory;
    if (!activeProject || !exactEpisodeId || !isCanonicalEntityDirectory(directory)) return;
    const entityNode = knowProjection.nodes.find((node) => {
      const evidence = Array.isArray(node.properties?.evidence)
        ? node.properties.evidence
        : [];
      return evidence.some((item) => (
        item && typeof item === 'object'
        && String((item as Record<string, unknown>).graphitiEpisodeId || '').trim()
          === exactEpisodeId
      ));
    });
    if (!entityNode) return;
    const directoryEntity = directory.entities.find((entity) => (
      readCanonicalEntityProviderPointers(entity)?.some((pointer) => (
        pointer.authority === 'knowgraph' && pointer.entityId === entityNode.id
      ))
    ));
    const members = directoryEntity
      ? readCanonicalEntityProviderPointers(directoryEntity)
      : null;
    if (!directoryEntity || !members?.length) return;
    handleCanonicalEntityFocus({
      projectId: activeProject,
      directorySha256: directory.sha256,
      canonicalName: directoryEntity.canonicalName,
      view: 'knowgraph',
      members,
      graphitiEpisodeId: exactEpisodeId,
    });
  }, [
    activeProject,
    handleCanonicalEntityFocus,
    knowledgeGraphs.projections.knowgraph,
    knowledgeGraphs.projections.thinkgraph.canonicalEntityDirectory,
  ]);
  useEffect(() => {
    const tick = () => setMoonPhase01(synodicPhaseFromDate(new Date()));
    tick();
    const id = window.setInterval(tick, 120000);
    return () => window.clearInterval(id);
  }, []);

  // agent builder state
  const lastBuilderDeckWriteReasonRef = useRef<string | null>(null);
  const lastBuilderUiOnlyActionRef = useRef<string | null>(null);
  const lastBuilderDeckFingerprintRef = useRef<string | null>(null);
  const lastPersistedBoardFingerprintRef = useRef<string | null>(null);
  const lastPersistedBoardSnapshotRef = useRef<{
    nodes: AgentCardInstance[];
    edges: DeckEdge[];
  } | null>(null);
  const lastDeckPersistReasonRef = useRef<string | null>(null);

  const recordDeckWriteReason = useCallback(
    (reason: string) => {
      lastBuilderDeckWriteReasonRef.current = reason;
      lastDeckPersistReasonRef.current = reason;
      lastBuilderUiOnlyActionRef.current = null;
    },
    [],
  );

  const recordUiOnlyAction = useCallback(
    (action: string) => {
      if (!BUILDER_DEV) return;
      lastBuilderUiOnlyActionRef.current = action;
    },
    [BUILDER_DEV],
  );

  const snapshotDeckBoard = useCallback(
    (document: DeckDocument) => ({
      nodes: cloneDeckDocument(document.nodes),
      edges: cloneDeckDocument(document.edges),
    }),
    [],
  );

  const evaluateBoardIntegrityForSave = useCallback(
    (nextDeck: DeckDocument, reason: string) => {
      const lastPersisted = lastPersistedBoardSnapshotRef.current;
      if (!lastPersisted) {
        return {
          ok: true,
          removedNodeIds: [] as string[],
        };
      }
      const nextNodeIds = new Set(nextDeck.nodes.map((node) => node.id));
      const removedNodeIds = lastPersisted.nodes
        .map((node) => node.id)
        .filter((nodeId) => !nextNodeIds.has(nodeId));
      if (lastPersisted.nodes.length > 0 && nextDeck.nodes.length === 0) {
        return {
          ok: false,
          removedNodeIds,
          message:
            'Blocked saving an empty board because the previous saved deck still had nodes.',
        };
      }
      if (removedNodeIds.length > 1) {
        return {
          ok: false,
          removedNodeIds,
          message: `Blocked saving a partial board because ${removedNodeIds.length} nodes disappeared during ${reason}.`,
        };
      }
      return {
        ok: true,
        removedNodeIds,
      };
    },
    [],
  );

  const setDeck = useCallback<
    React.Dispatch<React.SetStateAction<DeckDocument>>
  >(
    (update) => {
      setDeckState((prev) => {
        const next =
          typeof update === 'function'
            ? (update as (prevState: DeckDocument) => DeckDocument)(prev)
            : update;
        if (BUILDER_DEV) {
          const prevFingerprint = JSON.stringify(prev);
          const nextFingerprint = JSON.stringify(next);
          if (prevFingerprint === nextFingerprint) {
            console.warn(
              '[builder] ignored deck write without persisted graph mutation',
              {
                reason: lastBuilderDeckWriteReasonRef.current || 'unknown',
              },
            );
          }
        }
        return next;
      });
    },
    [BUILDER_DEV],
  );
  const setDeckFromPersistence = useCallback<
    React.Dispatch<React.SetStateAction<DeckDocument>>
  >(
    (update) => {
      setDeck((current) => {
        const persisted = typeof update === 'function'
          ? (update as (previous: DeckDocument) => DeckDocument)(current)
          : update;
        if (transientNewCardIds.size === 0) return persisted;
        const nextNodeIds = new Set(persisted.nodes.map((node) => node.id));
        const transientNodes = current.nodes.filter((node) => (
          transientNewCardIds.has(node.id) && !nextNodeIds.has(node.id)
        ));
        const nextEdgeIds = new Set(persisted.edges.map((edge) => edge.id));
        const transientEdges = current.edges.filter((edge) => (
          (transientNewCardIds.has(edge.source) || transientNewCardIds.has(edge.target))
          && !nextEdgeIds.has(edge.id)
        ));
        return {
          ...persisted,
          version: Math.max(current.version, persisted.version),
          nodes: [...persisted.nodes, ...transientNodes],
          edges: [...persisted.edges, ...transientEdges],
        };
      });
    },
    [setDeck, transientNewCardIds],
  );
  useEffect(() => {
    setTransientNewCardIds(new Set());
  }, [canvasProjectId]);
  const {
    handleSaveDeck,
    handleDeleteCard,
    persistenceFrozen,
    reloadCanonical,
    reloadToken,
  } = useAgentBuilderAutosave({
    builderDev: BUILDER_DEV,
    canvasProjectId,
    projectsApi: PROJECTS_API,
    builderDeckId: BUILDER_DECK_ID,
    deck,
    deckRevision,
    deckLoadBusy,
    deckLoadError,
    stateLoaded,
    transientCardIds: transientNewCardIds,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    lastDeckPersistReasonRef,
    evaluateBoardIntegrityForSave,
    snapshotDeckBoard,
    readDeckDocument,
    formatBuilderStatusMessage,
    setDeck: setDeckFromPersistence,
    setDeckRevision,
    setDeckSaveBusy,
    setDeckStatusMessage,
  });
  useAgentBuilderDeckLoad({
    canvasProjectId,
    projectsApi: PROJECTS_API,
    builderDeckId: BUILDER_DECK_ID,
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
    reloadToken,
  });



  const showDeckBuilder = workspaceView === 'canvas';
  const prepareDeckForCardSave = useCallback(
    (document: DeckDocument, cardId: string) => projectDeckForPersistence(
      document,
      transientNewCardIds,
      new Set([cardId]),
    ),
    [transientNewCardIds],
  );
  const handleCardPersisted = useCallback((cardId: string) => {
    setTransientNewCardIds((current) => {
      if (!current.has(cardId)) return current;
      const next = new Set(current);
      next.delete(cardId);
      return next;
    });
  }, []);
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
    onCardPersisted: handleCardPersisted,
  });
  const selectedWiredConnections = useMemo(() => {
    return selectedCard ? wiredBotTargets(deck, selectedCard.id) : [];
  }, [deck.edges, deck.nodes, selectedCard]);
  useEffect(() => { setDeleteCardError(null); }, [selectedCardId]);
  const deleteSelectedCard = async () => {
    if (!selectedCard || deletingCardId || deckSaveBusy || activeCardIds.includes(selectedCard.id)) return;
    const { id, title } = selectedCard;
    if (!window.confirm(`Delete ${title} from this Project? Its wires will be removed. Its saved profile and session history will be kept.`)) return;
    setDeletingCardId(id);
    setDeleteCardError(null);
    try {
      await handleDeleteCard(id);
      handleCardPersisted(id);
      setSelectedCardId(current => current === id ? null : current);
    } catch (error) {
      setDeleteCardError(error instanceof Error ? error.message : 'Card deletion failed.');
    } finally {
      setDeletingCardId(null);
    }
  };
  const builderTabs = useMemo(() => {
    if (selectedCard) return [
      ...BUILDER_NODE_TABS,
      ...(hasTaskLedger(selectedCard) ? ['Tasks'] : []),
      ...(selectedCard.runtime.kind === 'hermes'
        && !hasTaskLedger(selectedCard)
        && selectedCard.id !== mainCardId
        && selectedCard.id !== builderCard?.id
        ? ['CLI']
        : []),
    ];
    return [...BUILDER_PROJECT_TABS];
  }, [selectedCard, mainCardId, builderCard?.id]);
  const activeTabs = useMemo(() => {
    if (workspaceView === 'canvas') return builderTabs;
    return [];
  }, [builderTabs, workspaceView]);
  const deckPersistFingerprint = useMemo(
    () => (BUILDER_DEV ? JSON.stringify(deck) : ''),
    [BUILDER_DEV, deck],
  );

  useEffect(() => {
    if (!BUILDER_DEV) return;
    const previousFingerprint = lastBuilderDeckFingerprintRef.current;
    lastBuilderDeckFingerprintRef.current = deckPersistFingerprint;
    if (
      previousFingerprint === null ||
      previousFingerprint === deckPersistFingerprint
    )
      return;

    const writeReason = lastBuilderDeckWriteReasonRef.current;
    const uiOnlyAction = lastBuilderUiOnlyActionRef.current;
    if (!writeReason) {
      console.warn(
        '[builder] deck payload changed without an explicit write reason',
        {
          action: uiOnlyAction || 'unknown',
        },
      );
    } else if (uiOnlyAction) {
      console.warn('[builder] deck payload changed after a UI-only action', {
        action: uiOnlyAction,
        reason: writeReason,
      });
    }
    lastBuilderDeckWriteReasonRef.current = null;
    lastBuilderUiOnlyActionRef.current = null;
  }, [BUILDER_DEV, deckPersistFingerprint]);

  useEffect(() => {
    if (activeTabs.some((entry) => entry === tab)) return;
    setTab(activeTabs[0] || 'Plan');
  }, [activeTabs, tab]);

  useEffect(() => {
    if (workspaceView !== 'canvas') return;
    recordUiOnlyAction('tab-switch');
  }, [recordUiOnlyAction, tab, workspaceView]);

  useEffect(() => {
    if (workspaceView !== 'canvas') return;
    recordUiOnlyAction('drawer-toggle');
  }, [openDrawer, recordUiOnlyAction, workspaceView]);

  const handleOpenSavedCardChooser = useCallback(async () => {
    if (!canonicalDeckReady) {
      setDeckStatusMessage('Wait for the canvas to load.');
      return;
    }
    if (cardLeaveRef.current && !(await cardLeaveRef.current())) return;
    setSavedCardChooserOpen(true);
    setSavedCardChooserBusy(true);
    setSavedCardChooserError(null);
    try {
      const response = await applicationFetch(
        `${PROJECTS_API}/${canvasProjectId}/decks/${BUILDER_DECK_ID}/saved-cards`,
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true || !Array.isArray(payload.cards)) {
        throw new Error(String(payload?.error || 'Saved Cards unavailable.'));
      }
      setSavedCardChoices(payload.cards as SavedCardChoice[]);
    } catch (error) {
      setSavedCardChoices([]);
      setSavedCardChooserError(
        error instanceof Error ? error.message : 'Saved Cards unavailable.',
      );
    } finally {
      setSavedCardChooserBusy(false);
    }
  }, [
    canonicalDeckReady,
    canvasProjectId,
    setDeckStatusMessage,
  ]);

  const handleAttachSavedCard = useCallback(async (choice: SavedCardChoice) => {
    if (!canvasProjectId || !deckRevision || savedCardChooserBusy) return;
    setSavedCardChooserBusy(true);
    setSavedCardChooserError(null);
    const rightMostX = currentDeckRef.current.nodes.reduce(
      (maximum, node) => Math.max(maximum, Number(node.position?.x || 0)),
      -220,
    );
    try {
      const response = await applicationFetch(
        `${PROJECTS_API}/${canvasProjectId}/decks/${BUILDER_DECK_ID}/memberships`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cardId: choice.cardId,
            cardRevisionId: choice.cardRevisionId,
            expectedDeckRevision: deckRevision,
            position: { x: rightMostX + 320, y: 40 },
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true || !payload.deck) {
        throw new Error(String(payload?.error || 'Card attachment failed.'));
      }
      const loaded = readDeckDocument(payload.deck);
      const nextRevision = typeof payload?.meta?.deckRevision === 'string'
        ? payload.meta.deckRevision
        : null;
      if (!nextRevision) throw new Error('deck_revision_missing');
      recordDeckWriteReason('saved-card-attach');
      lastPersistedBoardFingerprintRef.current = JSON.stringify({
        nodes: loaded.nodes,
        edges: loaded.edges,
      });
      lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(loaded);
      setDeckFromPersistence(loaded);
      setDeckRevision(nextRevision);
      setSavedCardChoices((current) => current.filter((card) => card.cardId !== choice.cardId));
      setSavedCardChooserOpen(false);
      setSelectedEdgeId(null);
      setSelectedCardId(choice.cardId);
      setBuilderCanvasFocusRequest((current) => ({
        kind: 'card',
        cardId: choice.cardId,
        nonce: (current?.nonce || 0) + 1,
      }));
      setDeckStatusMessage(`Added existing saved Card ${choice.title} to this Project.`);
    } catch (error) {
      setSavedCardChooserError(error instanceof Error ? error.message : 'Card attachment failed.');
    } finally {
      setSavedCardChooserBusy(false);
    }
  }, [
    canvasProjectId,
    deckRevision,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    recordDeckWriteReason,
    savedCardChooserBusy,
    setBuilderCanvasFocusRequest,
    setDeckFromPersistence,
    setDeckRevision,
    setDeckStatusMessage,
    setSelectedCardId,
    setSelectedEdgeId,
    snapshotDeckBoard,
  ]);

  const handleCreateNewAgent = useCallback(async () => {
    if (!canonicalDeckReady || savedCardChooserBusy) return;
    setSavedCardChooserBusy(true);
    setSavedCardChooserError(null);
    try {
      const response = await applicationFetch('/api/idd/card-editor');
      const dictionary = await response.json().catch(() => null);
      const binding = dictionary?.templates?.template_assist?.runtime;
      if (!response.ok || dictionary?.ok !== true
        || binding?.kind !== 'hermes' || binding?.mode !== 'delegate') {
        throw new Error('Template unavailable.');
      }
      const { nextNode } = buildQuickAddAssistCard(currentDeckRef.current, binding);
      recordDeckWriteReason('deck-quick-add');
      setTransientNewCardIds((current) => new Set(current).add(nextNode.id));
      setDeck((current) => ({
        ...current,
        version: current.version + 1,
        nodes: [...current.nodes, nextNode],
      }));
      setSavedCardChooserOpen(false);
      setSelectedEdgeId(null);
      setInspectorDrawerOpen(true);
      setSelectedCardId(nextNode.id);
      setBuilderCanvasFocusRequest((current) => ({
        kind: 'card',
        cardId: nextNode.id,
        nonce: (current?.nonce || 0) + 1,
      }));
      if (!BUILDER_NODE_TABS.some((entry) => entry === tab)) setTab('Prompt');
      setDeckStatusMessage(
        `Added ${nextNode.title}. Save the Card to establish its permanent Card/profile authority.`,
      );
    } catch (error) {
      setSavedCardChooserError(error instanceof Error ? error.message : 'Template unavailable.');
    } finally {
      setSavedCardChooserBusy(false);
    }
  }, [
    BUILDER_NODE_TABS,
    canonicalDeckReady,
    recordDeckWriteReason,
    savedCardChooserBusy,
    setBuilderCanvasFocusRequest,
    setDeck,
    setDeckStatusMessage,
    setInspectorDrawerOpen,
    setSelectedCardId,
    setSelectedEdgeId,
    tab,
  ]);

  const handleSelectCard = useCallback(
    async (cardId: string | null) => {
      if (cardLeaveRef.current && !(await cardLeaveRef.current())) return;
      recordUiOnlyAction('node-selection');
      setSelectedCardId(cardId);
      const selectedNode = cardId
        ? deck.nodes.find((node) => node.id === cardId) || null
        : null;
      // Canvas selection always opens the saved-card editor. Agent app surfaces
      // are opened from their connected rail icons.
      setInspectorDrawerOpen(Boolean(selectedNode));
      const isMagenticSelection = Boolean(
        selectedNode &&
          selectedNode.runtime.kind === 'hermes'
          && selectedNode.runtime.mode === 'magentic_one',
      );
      if (cardId) {
        setBuilderCanvasFocusRequest((current) => ({
          kind: isMagenticSelection ? 'deck' : 'card',
          cardId: isMagenticSelection ? null : cardId,
          nonce: (current?.nonce || 0) + 1,
        }));
        setSelectedEdgeId(null);
        setTab('Prompt');
      } else {
        setBuilderCanvasFocusRequest((current) => ({
          kind: 'deck',
          cardId: null,
          nonce: (current?.nonce || 0) + 1,
        }));
      }
    },
    [deck.nodes, recordUiOnlyAction, tab, mainCardId, builderCard?.id],
  );

  const handleSelectEdge = useCallback(
    async (edgeId: string | null) => {
      if (cardLeaveRef.current && !(await cardLeaveRef.current())) return;
      recordUiOnlyAction('edge-selection');
      setInspectorDrawerOpen(false);
      setBuilderCanvasFocusRequest((current) => ({
        kind: 'deck',
        cardId: null,
        nonce: (current?.nonce || 0) + 1,
      }));
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

  const renderAgentBuilderPanel = () => {
    if (!showDeckBuilder) {
      return (
        <div
          style={graphDrawerSectionStyle({
            padding: '16px',
            borderStyle: 'dashed',
            color: GRAPH_THEME.drawer.inputMuted,
          })}
        >
          Select a Project to open its Agent Builder configuration.
        </div>
      );
    }

    const renderEditorContent = () => {
      if (selectedCard && selectedCardConfig) {
        if (
          tab === 'Tasks'
          && hasTaskLedger(selectedCard)
        ) {
          return <MagneticTasksTab
            profile={selectedCard.runtime.profile}
            sessionId={cardRuntimeSnapshots[selectedCard.id]?.sessionId || ''}
            label={selectedCard.title}
            cardTitlesByProfile={cardTitlesByProfile}
          />;
        }
        if (
          tab === 'CLI'
          && selectedCard.runtime.kind === 'hermes'
          && !hasTaskLedger(selectedCard)
          && selectedCard.id !== mainCardId
          && selectedCard.id !== builderCard?.id
        ) {
          return <AgentTerminalPanel
            key={`${canvasProjectId}:${BUILDER_DECK_ID}:${selectedCard.id}:${selectedCard.runtime.profile}`}
            identity={{
              projectId: canvasProjectId,
              deckId: BUILDER_DECK_ID,
              cardId: selectedCard.id,
              profile: selectedCard.runtime.profile,
            }}
          />;
        }
        if (BUILDER_NODE_TABS.some((entry) => entry === tab)) {
          return (
            <>
              {tab === 'Prompt' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => { void deleteSelectedCard(); }}
                    disabled={Boolean(deletingCardId) || deckSaveBusy || activeCardIds.includes(selectedCard.id)}
                    title="Remove this Card and its wires from this Project"
                    style={graphDrawerButtonStyle({ color: '#D9A5A5', fontSize: 12, padding: '5px 9px' })}
                  >
                    {deletingCardId === selectedCard.id ? 'Deleting…' : 'Delete Card'}
                  </button>
                </div>
              )}
              {deleteCardError && <div role="alert" style={{ color: '#D9A5A5', fontSize: 12 }}>{deleteCardError}</div>}
              <CardEditorErrorBoundary
                key={`card-editor-boundary:${selectedCard.id}`}
                cardTitle={String(selectedCard.title || 'Selected card')}
              >
                <Suspense
                  fallback={
                    <div
                      style={graphDrawerSectionStyle({
                        padding: '12px 14px',
                        borderRadius: 8,
                        color: GRAPH_THEME.drawer.inputMuted,
                      })}
                    >
                      Loading card configuration…
                    </div>
                  }
                >
                  <CardEditor
                    key="deck-card-editor"
                    cardId={selectedCard.id}
                    projectId={canvasProjectId}
                    deckId={BUILDER_DECK_ID}
                    activeTab={tab}
                    cardName={selectedCard.title}
                    onChangeCardName={handleRenameSelectedCard}
                    localConfig={selectedCardConfig}
                    onSaveLocalConfig={handleSaveSelectedCardConfig}
                    wiredConnections={selectedWiredConnections}
                    runtimeSnapshot={cardRuntimeSnapshots[selectedCard.id]}
                  />
                </Suspense>
              </CardEditorErrorBoundary>
            </>
          );
        }
      }

      if (tab === 'Plan') {
        return (
          <>
            <div
              style={graphDrawerSectionStyle({
                padding: '12px 14px',
                borderRadius: 8,
              })}
            >
              <div
                className="flex items-center gap-2"
              >
                <button
                  onClick={() => {
                    recordDeckWriteReason('save-board-now');
                    void handleSaveDeck(
                      projectDeckForPersistence(deck, transientNewCardIds),
                    ).catch(() => undefined);
                  }}
                  disabled={deckSaveBusy || !canonicalDeckReady}
                  style={graphDrawerButtonStyle({
                    opacity:
                      deckSaveBusy || !canonicalDeckReady
                        ? 0.58
                        : 1,
                    cursor:
                      deckSaveBusy || !canonicalDeckReady
                        ? 'not-allowed'
                        : 'pointer',
                  })}
                >
                  {deckSaveBusy ? 'Saving...' : 'Save Board Now'}
                </button>
              </div>
              {deckStatusMessage && (
                <div
                  className="text-xs"
                  style={{ marginTop: 8, color: GRAPH_THEME.drawer.inputMuted }}
                >
                  {deckStatusMessage}
                </div>
              )}
            </div>
          </>
        );
      }

      return null;
    };

    return <div className="space-y-3">{renderEditorContent()}</div>;
  };

  const inspectorDrawerRole = useMemo<'agent' | 'trading' | 'worldview' | 'nrgsim' | null>(() => {
    if (workspaceView === 'nrgsim') return 'nrgsim';
    if (workspaceView === 'canvas' && canonicalDeckReady && selectedCard) return 'agent';
    if (workspaceView === 'worldview' && worldViewCard) return 'worldview';
    if (workspaceView === 'trading' && tradingCard) return 'trading';
    return null;
  }, [canonicalDeckReady, selectedCard, tradingCard, worldViewCard, workspaceView]);
  const isInspectorDrawerVisible =
    inspectorDrawerRole === 'nrgsim'
      ? modelingInspectorOpen
      : inspectorDrawerRole === 'worldview'
        ? worldViewInspectorOpen
      : inspectorDrawerOpen && inspectorDrawerRole !== null;
  const inspectorDrawerDefaultWidth = AGENT_EDITOR_DEFAULT_WIDTH;
  const inspectorDrawerStorageKey = 'liquidaity.drawer.inspector.agent.v1.width';

  const closeInspectorDrawer = useCallback(async () => {
    if (cardLeaveRef.current && !(await cardLeaveRef.current())) return false;
    setInspectorDrawerOpen(false);
    setSelectedCardId(null);
    setSelectedEdgeId(null);
    setBuilderCanvasFocusRequest((current) => ({
      kind: 'deck',
      cardId: null,
      nonce: (current?.nonce || 0) + 1,
    }));
    return true;
  }, []);

  const dockInspectorDrawer = useCallback(() => {
    setInspectorDrawerOpen(false);
    if (cardLeaveRef.current) void cardLeaveRef.current();
    return true;
  }, []);

  const getSurfaceShellStyle = useCallback(
    (compact: boolean, extra?: React.CSSProperties): React.CSSProperties => {
      return {
        height: '100%',
        minHeight: compact ? 320 : undefined,
        ...extra,
      };
    },
    [],
  );

  const renderChatSurface = (
    projectId: string,
    compact = false,
    surfaceRole: 'large' | 'companion' = compact ? 'companion' : 'large',
  ) => {
    const chat = (
      <div style={{ height: '100%', minHeight: 0 }}>
        <MainProjectChat
          messages={mainChat.messages}
          directChatTargets={mainChatTargets}
          onSend={mainChat.send}
          busy={mainChat.busy}
          historyLoading={mainChat.historyLoading}
          error={mainChat.error}
          voiceError={mainChat.voiceError}
          voicePhase={mainChat.voicePhase}
          onVoiceStart={mainChat.startVoice}
          onVoiceStop={mainChat.stopVoice}
          onStop={mainChat.stop}
          pendingRequest={mainChat.pendingRequest}
          onApproval={mainChat.answerApproval}
          onClarify={mainChat.answerClarify}
          onRequestCancel={mainChat.cancelRequest}
          draft={mainCardId ? transientCardInputs[mainCardId] || '' : ''}
          onDraftChange={(value) => {
            if (!mainCardId) return;
            const address = /^\s*@([^\s]+)(?:\s|$)/u.exec(value)?.[1].toLowerCase();
            const targets = mainChatTargets.filter((target) => target.address.toLowerCase() === address);
            if (targets.length === 1) {
              setChatSelection({ projectId: canvasProjectId, cardId: targets[0].cardId });
            } else if (value.trim() && !value.trimStart().startsWith('@')) {
              setChatSelection(null);
            }
            setTransientCardInputs((current) => {
              if (!value) {
                const next = { ...current };
                delete next[mainCardId];
                return next;
              }
              return { ...current, [mainCardId]: value };
            });
          }}
          knowledgeProjectId={projectId}
          entityMatcher={canonicalEntityMatcher}
          onEntityFocus={handleCanonicalEntityFocus}
          onEvidenceFocus={handleKnowEvidenceFocus}
          colors={C}
        />
      </div>
    );
    const cardWorkSurface = () => (
      builderCard?.runtime.kind === 'hermes' && canvasProjectId ? (
        <div
          data-testid="under-chat-card-work-surface"
          data-card-id={builderCard.id}
          style={{ height: '100%', minHeight: 0 }}
        >
          <AgentTerminalPanel
            key={`${canvasProjectId}:${builderCard.id}:${builderCard.runtime.profile}`}
            identity={{
              projectId: canvasProjectId,
              deckId: BUILDER_DECK_ID,
              cardId: builderCard.id,
              profile: builderCard.runtime.profile,
            }}
          />
        </div>
      ) : null
    );
    return (
      <div
        data-testid={`${surfaceRole}-surface-chat`}
        style={getSurfaceShellStyle(compact)}
      >
        {compact ? (
          <div style={{ height: '100%' }}>{chat}</div>
        ) : (
          <MainBuilderSplitPanel
            storageKey={`liquidaity.main.agent-builder.split.v1:${projectId}`}
            chat={chat}
            terminal={cardWorkSurface()}
            workSurfaceLabel={builderCard?.title || 'Builder'}
          />
        )}
      </div>
    );
  };

  const renderCanvasSurface = (
    compact = false,
    surfaceRole: 'large' | 'companion' = compact ? 'companion' : 'large',
  ) => {
    const canvasPane = canonicalDeckReady ? (
      <AgentCanvasPane
        surfaceRole={surfaceRole}
        shellStyle={getSurfaceShellStyle(compact)}
        document={deck}
        setDocument={setDeck}
        onPersistGraphMutation={recordDeckWriteReason}
        activeCardIds={activeCardIds}
        activeAgentCounts={activeAgentCounts}
        activeEdgeIds={[]}
        selectedCardId={selectedCardId}
        selectedEdgeId={selectedEdgeId}
        onSelectCard={handleSelectCard}
        onSelectEdge={handleSelectEdge}
        onDeleteSelectedEdge={handleDeleteSelectedEdge}
        inspectMode={false}
        focusZone={canvasFocusZone}
      />
    ) : persistenceFrozen ? (
      <div
        role="alert"
        data-testid="canonical-canvas-reload-required"
        style={graphDrawerSectionStyle({
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          border: 0,
          borderRadius: 0,
          color: 'rgba(255,162,162,0.95)',
        })}
      >
        <div style={{ display: 'grid', justifyItems: 'center', gap: 12, maxWidth: 460 }}>
          <div style={{ textAlign: 'center' }}>
            {deckStatusMessage || 'The saved canvas must be reloaded before editing can continue.'}
          </div>
          <button
            type="button"
            data-testid="reload-canonical-canvas"
            onClick={reloadCanonical}
            disabled={deckSaveBusy}
            style={{
              border: `1px solid ${C.primary}`,
              borderRadius: 8,
              background: C.panel,
              color: C.text,
              padding: '8px 12px',
            }}
          >
            Reload saved canvas
          </button>
        </div>
      </div>
    ) : (
      <div
        role={deckLoadError ? 'alert' : 'status'}
        data-testid="canonical-canvas-load-state"
        style={graphDrawerSectionStyle({
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          border: 0,
          borderRadius: 0,
          color: deckLoadError
            ? 'rgba(255,162,162,0.95)'
            : GRAPH_THEME.drawer.inputMuted,
        })}
      >
        {deckLoadError
          ? `Canvas unavailable: ${deckLoadError}`
          : 'Loading…'}
      </div>
    );
    return (
      <div
        data-testid="workspace-canvas-surface"
        style={{ position: 'relative', height: '100%', minHeight: 0, overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>{canvasPane}</div>
      </div>
    );
  };

  const canvasSurface = renderCanvasSurface(false, 'large');

  const renderKnowledgeGraphSurface = ({
    minHeight = 280,
    surfaceRole = minHeight > 320 ? 'large' : 'companion',
  }: {
    minHeight?: number;
    surfaceRole?: 'large' | 'companion';
  }) => {
    return (
      <div style={getSurfaceShellStyle(minHeight <= 320)}>
        <KnowledgeSurfaceErrorBoundary>
          <KnowledgeGraphFramework
            minHeight={minHeight}
            surfaceRole={surfaceRole}
            projections={knowledgeGraphs.projections}
            onRemoveThinkGraphEvidence={knowledgeGraphs.removeThinkGraphEvidence}
            onRemoveKnowGraphEvidence={knowledgeGraphs.removeKnowGraphEvidence}
            errors={knowledgeGraphs.errors}
            statuses={knowledgeGraphs.statuses}
            entityFocusRequest={entityFocusRequest}
            codeGraph={knowledgeGraphs.codeGraph}
            onOpenCodeGraph={knowledgeGraphs.loadCodeGraph}
            onReadCodeGraphFiles={knowledgeGraphs.readCodeGraphFiles}
            onReadCodeGraphSource={knowledgeGraphs.readCodeGraphSource}
            onConfigureCodeCategories={knowledgeGraphs.configureCodeCategories}
            onViewContext={onGraphViewContext}
          />
        </KnowledgeSurfaceErrorBoundary>
      </div>
    );
  };

  const showCanvasWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    setWorkspaceView('canvas');
    const params = new URLSearchParams(window.location.search);
    params.delete('workspace');
    const nextQuery = params.toString();
    window.history.replaceState(
      {},
      '',
      nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname,
    );
    // Camera focus only — pan to the agent/bus zone on the same scene.
    setCanvasFocusZone({ zone: 'agents', nonce: Date.now() });
  }, [closeInspectorDrawer]);

  const showKnowledgeWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    setWorkspaceView('knowledge');
    const params = new URLSearchParams(window.location.search);
    params.set('workspace', 'knowledge');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [closeInspectorDrawer]);

  const showTradingWorkspace = useCallback(async () => {
    if (cardLeaveRef.current && !(await cardLeaveRef.current())) return;
    if (!tradingCard?.id) return setDeckStatusMessage('Trading saved Card is unavailable.');
    // Hide the editor while the operational presentation is open, but preserve
    // the Canvas selection. Returning to the Canvas therefore restores the
    // same Card context instead of treating app navigation as a Card edit.
    setInspectorDrawerOpen(false);
    setWorkspaceView('trading');
  }, [setDeckStatusMessage, setInspectorDrawerOpen, tradingCard?.id]);

  const showWorldviewWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    if (!worldViewCard?.id) return setDeckStatusMessage('WorldView saved Card is unavailable.');
    setWorkspaceView('worldview');
    setWorldViewInspectorOpen(true);
    const params = new URLSearchParams(window.location.search);
    params.set('workspace', 'worldview');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [closeInspectorDrawer, setDeckStatusMessage, worldViewCard?.id]);

  const handleCompanionTabClick = useCallback(async (nextTab: string) => {
    if (cardLeaveRef.current && !(await cardLeaveRef.current())) return;
    setTab(nextTab);
  }, []);

  const workspaceRail = (
    <AgentBuilderRail
      colors={C}
      workspaceView={workspaceView}
      visibleRailItems={visibleRailItems}
      moonOrb={<BuilderRailMoonOrb phase01={moonPhase01} />}
      onShowWorldviewWorkspace={showWorldviewWorkspace}
      onShowCanvasWorkspace={showCanvasWorkspace}
      onOpenAddAgent={handleOpenSavedCardChooser}
      onShowKnowledgeWorkspace={showKnowledgeWorkspace}
      onShowTradingWorkspace={showTradingWorkspace}
      onOpenNavigationDrawer={() => setOpenDrawer('navigation')}
    />
  );

  const workspaceCompanionSurfaceHost = (
    workspaceView === 'nrgsim' && canvasProjectId ? <Suspense fallback={null}>
      <NrgsimWorkspace key={canvasProjectId} projectId={canvasProjectId} inspectorContainer={modelingInspectorHost} />
    </Suspense> : <CompanionSurfaceHost
      workspaceView={workspaceView}
      knowledgeSurface={
        renderKnowledgeGraphSurface({
          minHeight: 420,
          surfaceRole: 'companion',
        })
      }
      tradingSurface={
        <TradingUI
          symbol="RDW"
          projectId={canvasProjectId || null}
          deckId={BUILDER_DECK_ID}
          card={tradingCard}
          forecastCard={forecastCard}
        />
      }
      worldviewSurface={
        <WorldViewSurface
          projectId={canvasProjectId || null}
          cardId={worldViewCard?.id || null}
          onBridgeChange={setWorldViewBridge}
          inspectorContainer={worldViewInspectorHost}
        />
      }
    />
  );

  const workspaceDrawer =
    inspectorDrawerRole !== null ? (
      <RightGlassDrawer
        isOpen={isInspectorDrawerVisible}
        title={
          inspectorDrawerRole === 'nrgsim' ? '' : inspectorDrawerRole === 'worldview'
              ? ''
            : inspectorDrawerRole === 'trading'
              ? 'Trading settings'
            : safeText(selectedCard?.title || 'Agent')
        }
        onClose={
          inspectorDrawerRole === 'nrgsim' ? () => setModelingInspectorOpen(false) : inspectorDrawerRole === 'worldview'
              ? () => setWorldViewInspectorOpen(false)
            : inspectorDrawerRole === 'trading'
              ? () => setInspectorDrawerOpen(false)
              : dockInspectorDrawer
        }
        onOpen={inspectorDrawerRole === 'nrgsim' ? () => setModelingInspectorOpen(true) : inspectorDrawerRole === 'worldview'
            ? () => setWorldViewInspectorOpen(true)
            : inspectorDrawerRole === 'trading' || inspectorDrawerRole === 'agent'
              ? () => setInspectorDrawerOpen(true)
              : undefined}
        collapsedLabel={null}
        openAriaLabel={inspectorDrawerRole === 'nrgsim' ? 'Open modeling Inspector' : inspectorDrawerRole === 'worldview'
            ? 'Open WorldView controls'
            : inspectorDrawerRole === 'agent'
              ? 'Open Card editor'
              : 'Open Trading Inspector'}
        movable={inspectorDrawerRole !== 'trading'}
        defaultWidth={inspectorDrawerDefaultWidth}
        resetWidthOnOpen={false}
        minWidth={300}
        maxWidth={560}
        storageKey={
          inspectorDrawerRole === 'nrgsim' ? 'building.inspector.width' : inspectorDrawerRole === 'worldview'
              ? 'liquidaity.drawer.inspector.worldview.v1.width'
            : inspectorDrawerRole === 'trading'
              ? 'card.drawer.inspector.trading.v1.width'
            : inspectorDrawerStorageKey
        }
        dataTestId="workspace-inspector-drawer"
        right={12}
        top={48}
      >
        {inspectorDrawerRole === 'nrgsim' ? <div ref={setModelingInspectorHost} /> : null}
        {inspectorDrawerRole === 'worldview' ? <div ref={setWorldViewInspectorHost} /> : null}
        {inspectorDrawerRole === 'trading' && tradingCard ? (
          <TradingUiInspectorPanel
            configuration={tradingCard.runtimeOptions?.configuration || {}}
            onSave={(configuration) => {
              handleSaveCardConfiguration(tradingCard.id, configuration);
            }}
          />
        ) : null}
        {inspectorDrawerRole === 'agent' && activeTabs.length > 0 ? (
          <div
            className="flex min-w-0"
            style={graphCompanionTabGroupStyle({
              gap: hasTaskLedger(selectedCard) ? 3 : 6,
              padding: hasTaskLedger(selectedCard) ? 4 : 6,
              flexWrap: hasTaskLedger(selectedCard) ? 'nowrap' : 'wrap',
              overflowX: hasTaskLedger(selectedCard) ? 'auto' : 'visible',
              marginBottom: 10,
            })}
          >
            {activeTabs.map((t) => {
              const selected = tab === t;
              return (
                <button
                  key={t}
                  data-testid={`companion-tab-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  aria-pressed={selected}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCompanionTabClick(t);
                  }}
                  className="whitespace-nowrap transition-colors duration-150 ease-out"
                  style={graphCompanionTabButtonStyle(selected, hasTaskLedger(selectedCard) ? {
                    padding: '5px 6px',
                    fontSize: 10,
                    flex: '0 0 auto',
                  } : undefined)}
                >
                  {t}
                </button>
              );
            })}
          </div>
        ) : null}
        {inspectorDrawerRole === 'agent' ? (
          <div
            data-testid="companion-surface-editor"
            style={{
              display: 'grid',
              gap: 8,
            }}
          >
            {renderAgentBuilderPanel()}
          </div>
        ) : null}
      </RightGlassDrawer>
    ) : null;

  return (
    <FrontendCrashBoundary scopeLabel="AgentBuilder">
      <div
        className={`${embedded ? 'h-full' : 'h-screen'} w-full flex overflow-hidden`}
        style={{ background: C.bg, color: C.text }}
      >
        <AgentBuilderWorkspace
          rail={workspaceRail}
          workspaceShellRef={workspaceShellRef}
          workspaceView={workspaceView}
          surfaceName={largeSurface}
          chatPanelWidth={chatPanelWidth}
          chatMinWidth={chatMinWidth}
          chat={renderChatSurface(activeProject, false, 'large')}
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

      {savedCardChooserOpen ? (
        <div
          data-testid="saved-card-chooser"
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.58)' }}
          onClick={() => !savedCardChooserBusy && setSavedCardChooserOpen(false)}
        >
          <div
            className="w-[min(560px,calc(100vw-32px))] max-h-[72vh] overflow-auto rounded-xl p-4"
            style={{ background: C.panel, border: `1px solid ${C.border}` }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold">Add Agent</div>
                <div className="text-xs mt-1" style={{ color: C.neutral }}>
                  Reuse a saved Card unchanged, or create and save one new Card.
                </div>
              </div>
              <button
                type="button"
                aria-label="Close Add Agent"
                onClick={() => setSavedCardChooserOpen(false)}
                disabled={savedCardChooserBusy}
              >
                ×
              </button>
            </div>
            {savedCardChooserError ? (
              <div className="text-xs mb-3" style={{ color: C.warn }}>{savedCardChooserError}</div>
            ) : null}
            <button
              type="button"
              className="w-full text-left rounded-lg p-3 mb-3"
              style={{ border: `1px solid ${C.primary}`, background: C.bg }}
              disabled={savedCardChooserBusy}
              onClick={() => void handleCreateNewAgent()}
              data-testid="add-agent-new-card"
            >
              <div className="text-sm font-medium">New Agent</div>
              <div className="text-xs mt-1" style={{ color: C.neutral }}>
                Open one new editable Card, then save it as the permanent authority.
              </div>
            </button>
            <div className="text-xs font-semibold mb-2" style={{ color: C.neutral }}>
              Saved Agents
            </div>
            {savedCardChooserBusy && savedCardChoices.length === 0 ? (
              <div className="text-sm" style={{ color: C.neutral }}>Loading saved Cards…</div>
            ) : null}
            {!savedCardChooserBusy && savedCardChoices.length === 0 ? (
              <div className="text-sm" style={{ color: C.neutral }}>
                Every available saved Card is already in this Project.
              </div>
            ) : null}
            <div className="grid gap-2">
              {savedCardChoices.map((choice) => (
                <button
                  key={`${choice.cardId}:${choice.cardRevisionId}`}
                  type="button"
                  className="text-left rounded-lg p-3"
                  style={{ border: `1px solid ${C.border}`, background: C.bg }}
                  disabled={savedCardChooserBusy}
                  onClick={() => void handleAttachSavedCard(choice)}
                  data-testid={`saved-card-choice-${choice.cardId}`}
                >
                  <div className="text-sm font-medium">{choice.title}</div>
                  <div className="text-xs mt-1" style={{ color: C.neutral }}>
                    {choice.subtitle || 'Saved Card'} · {choice.runtimeProfile}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <AgentBuilderProjectDrawer
        activeProject={activeProject}
        colors={C}
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
