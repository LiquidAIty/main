import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo, 
  useRef,
  useState,
} from 'react';

import BuilderChat from '../components/builder/BuilderChat';
import FrontendCrashBoundary from '../components/diagnostics/FrontendCrashBoundary';
import WorldSignalSurface, {
  type WorldSignalsInspectorBridge,
  type WorldSignalsInspectorSection,
  type WorldSignalsLayerState,
} from '../components/worldsignal/WorldSignalSurface';
import WorldSignalsInspectorPanel from '../components/worldsignal/WorldSignalsInspectorPanel';
import AgentCanvasPane from '../features/agentbuilder/canvas/AgentCanvasPane';
import AgentBuilderRail from '../features/agentbuilder/core/AgentBuilderRail';
import AgentBuilderWorkspace from '../features/agentbuilder/core/AgentBuilderWorkspace';
import useAgentBuilderWorkspaceLayout from '../features/agentbuilder/core/useAgentBuilderWorkspaceLayout';
import CompanionSurfaceHost from '../features/agentbuilder/core/CompanionSurfaceHost';
import KnowledgeGraphFramework from '../components/knowledge/KnowledgeGraphFramework';
import OpenClaudeConsolePanel from '../features/agentbuilder/console/OpenClaudeConsolePanel';
import HarnessChatPanel from '../features/agentbuilder/console/HarnessChatPanel';
import HermesConsole from '../components/hermes/HermesConsole';
import useAgentBuilderMainChat from '../features/agentbuilder/console/useAgentBuilderMainChat';
import type { AgentBuilderChatMessage } from '../features/agentbuilder/console/useAgentBuilderMainChat';
import useAgentBuilderAutosave from '../features/agentbuilder/state/useAgentBuilderAutosave';
import useAgentBuilderCardEditor from '../features/agentbuilder/state/useAgentBuilderCardEditor';
import useAgentBuilderDeck from '../features/agentbuilder/state/useAgentBuilderDeck';
import useAgentBuilderDeckLoad from '../features/agentbuilder/state/useAgentBuilderDeckLoad';
import useAgentBuilderProject from '../features/agentbuilder/state/useAgentBuilderProject';
import AgentBuilderProjectDrawer from '../features/agentbuilder/project/AgentBuilderProjectDrawer';
import useAgentBuilderProjectReset from '../features/agentbuilder/state/useAgentBuilderProjectReset';
import useAgentBuilderSelection from '../features/agentbuilder/state/useAgentBuilderSelection';
import useAgentBuilderThinkGraphProjection from '../features/agentbuilder/state/useAgentBuilderThinkGraphProjection';
import TradingUI from './tradingui';
import { resolveDeckWorkspaceRoot } from '../features/agentbuilder/state/deckWorkspaceRoot';
import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
  graphDrawerSectionStyle,
} from '../components/graph/graphVisualTokens';
import RightGlassDrawer from '../components/graph/RightGlassDrawer';
import type { UnifiedProjectionIdentity } from '../components/knowledge/UnifiedGraphSurface';
import {
  graphObjectRefKey,
  type GraphObjectRef,
} from '../components/knowledge/GraphObjectContext';
// Decomposed Agent Builder modules (2026-07-08): the page is composition only;
// deck primitives/seed/document logic and rail derivation live in the feature.
import {
  cleanOptionalText,
  cloneDeckDocument,
  DEFAULT_WORKSPACE_ROOT,
  normalizeDeckEdgeType,
  normalizeRuntimeType,
  safeText,
  uid,
} from '../features/agentbuilder/deck/deckPrimitives';
import {
  BUILDER_DECK_ID,
  INITIAL_AGENT_TEMPLATES,
} from '../features/agentbuilder/deck/deckSeed';
import {
  buildProjectlessDeckDocument,
  buildSingleCardRunDocument,
  formatBuilderStatusMessage,
  hydrateDeckDocument,
  resolveLocalCoderControllerConsoleConfig,
  resolveProjectDeckLoadResult,
} from '../features/agentbuilder/deck/deckDocument';
import {
  deriveVisibleRailItems,
  isWorldSignalsAgentCard,
} from '../features/agentbuilder/rail/railVisibility';
import {
  BuilderRailMoonOrb,
  synodicPhaseFromDate,
} from '../features/agentbuilder/core/BuilderRailMoonOrb';
import {
  buildDeckRuntimeVisualState,
} from '../components/builder/deckRunState';
import {
  validateDeckDocument,
} from '../components/builder/deckValidation';
import {
  isAbortLikeError,
} from '../components/builder/requestGuards';
import {
  useBuilderDeckRuntimeActions,
} from '../components/builder/useBuilderDeckRuntimeActions';
import type {
  AgentCardInstance,
  DeckEdge,
  DeckDocument,
  KnowledgeGraphKind,
  DeckWorkspaceContext,
  WorkspaceObjectContext,
} from '../types/agentgraph';

const AgentManager = lazy(async () => {
  const mod = await import('../components/AgentManager');
  return { default: mod.AgentManager };
});
import { resolveCbmProjectName } from '../components/codegraph/resolveCodeGraphProjectIdentity';

// AgentPage (MVP): left icon rail + main chat + right tabs (Plan, Links, Knowledge, Dashboard)
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

const BUILDER_PROJECT_TABS = ['Plan'] as const;
const BUILDER_NODE_TABS = ['Prompt', 'Knowledge', 'Tools', 'Runtime', 'Task'] as const;
const AGENT_EDITOR_DEFAULT_WIDTH = 344;
// Hermes owns one project-intelligence canvas. Its three tabs are authorities,
// not agent-card capabilities: card/bus wiring must never hide project
// reasoning, external evidence, or repository reality from that canvas.
type KnowledgeSurfaceKind = KnowledgeGraphKind | 'unified';
const WORKSPACE_OBJECT_CONTEXT_LIST_LIMIT = 12;
const WORKSPACE_OBJECT_SELECTED_TEXT_LIMIT = 240;
const WORKSPACE_OBJECT_SUMMARY_LIMIT = 400;

function compactAwarenessText(value: unknown, limit: number): string | null {
  const text = safeText(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= limit
    ? text
    : `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function compactAwarenessList(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = compactAwarenessText(value, 96);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= WORKSPACE_OBJECT_CONTEXT_LIST_LIMIT) break;
  }
  return out;
}

function getCardDisplayName(card: AgentCardInstance | null | undefined): string {
  return (
    compactAwarenessText(card?.title, 96) ||
    compactAwarenessText(card?.id, 96) ||
    'Agent'
  );
}

function buildCanvasObjectAwareness(document: DeckDocument): Pick<
  WorkspaceObjectContext,
  'activeMagenticParticipants' | 'availableCanvasAgents' | 'excludedAgents'
> {
  const topLevelCards = document.nodes.filter((node) => !cleanOptionalText(node.parentGraphId));
  const nodeMap = new Map(topLevelCards.map((node) => [node.id, node] as const));
  const magenticIds = new Set(
    topLevelCards
      .filter((node) => normalizeRuntimeType(node.runtimeType) === 'magentic_one')
      .map((node) => node.id),
  );
  const activeMagenticParticipants = compactAwarenessList(
    document.edges
      .filter(
        (edge) =>
          (magenticIds.has(edge.source) || magenticIds.has(edge.target)) &&
          normalizeDeckEdgeType(edge.edgeType) === 'magentic_option',
      )
      .map((edge) => nodeMap.get(magenticIds.has(edge.source) ? edge.target : edge.source))
      .filter(Boolean)
      .map((node) => getCardDisplayName(node)),
  );
  const availableCanvasAgents = compactAwarenessList(
    topLevelCards.map((node) => getCardDisplayName(node)),
  );
  const excludedAgents = compactAwarenessList(
    topLevelCards
      .filter((node) => {
        const runtimeType = normalizeRuntimeType(node.runtimeType);
        return runtimeType === 'local_coder' || runtimeType === 'graph_flow';
      })
      .map((node) => getCardDisplayName(node)),
  );
  return {
    activeMagenticParticipants,
    availableCanvasAgents,
    excludedAgents,
  };
}

const PROJECTS_API = '/api/projects';
const EMPTY_PROJECT_MESSAGES: AgentBuilderChatMessage[] = [];

/** Mean synodic month in days (NASA/USNO convention). */
export default function AgentBuilder(): React.ReactElement {
  const BUILDER_DEV = import.meta.env.DEV;
  const largeSurface = 'chat' as const;
  const [workspaceView, setWorkspaceView] = useState<
    | 'chat'
    | 'canvas'
    | 'knowledge'
    | 'trading'
    | 'worldsignal'
  >(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('workspace') === 'knowledge') return 'knowledge';
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
    assistProjects,
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
    canvasMinWidth,
    chatMinWidth,
    chatPanelWidth,
    companionMinWidth,
    handleSplitterMouseDown,
    onSplitterMouseEnter,
    onSplitterMouseLeave,
    splitterActive,
    workspaceShellRef,
  } = useAgentBuilderWorkspaceLayout({
    setWorkspaceView,
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
    latestDeckRun,
    setLatestDeckRun,
    setLatestCardRun,
    liveDeckEvents,
    setLiveDeckEvents,
    deckRunBusy,
    setDeckRunBusy,
    cardRunBusy,
    setCardRunBusy,
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
  const currentDeckRef = useRef(deck);
  useEffect(() => {
    currentDeckRef.current = deck;
  }, [deck]);
  const [hermesConsoleOpen, setHermesConsoleOpen] = useState(false);
  const localCoderConsoleConfig = useMemo(
    () => resolveLocalCoderControllerConsoleConfig(deck),
    [deck],
  );
  const terminalRoot = useMemo(
    () => resolveDeckWorkspaceRoot(deck, null) || DEFAULT_WORKSPACE_ROOT,
    [deck],
  );
  const visibleRailItems = useMemo(
    () =>
      deriveVisibleRailItems({
        deck,
        workspaceView,
      }),
    [deck, workspaceView],
  );
  const {
    objectDrawerOpen,
    setObjectDrawerOpen,
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
  // WorldSignals → canonical Inspector: the companion surface requests a
  // section and provides state adapters; the ONE workspace drawer below
  // renders it. No second inspector, no drawer inside the map region.
  const [worldSignalInspectorSection, setWorldSignalInspectorSection] = useState<
    'markets' | 'layers' | null
  >(null);
  const [worldSignalLayerState, setWorldSignalLayerState] =
    useState<WorldSignalsLayerState | null>(null);
  const [worldSignalBridge, setWorldSignalBridge] =
    useState<WorldSignalsInspectorBridge | null>(null);
  const handleWorldSignalInspectorRequest = useCallback(
    (section: WorldSignalsInspectorSection) => {
      // Only sections with a real canonical destination open today.
      if (section === 'markets' || section === 'layers') {
        setWorldSignalInspectorSection(section);
      }
    },
    [],
  );
  const worldSignalsCardId = useMemo(
    () => deck.nodes.find((node) => isWorldSignalsAgentCard(node))?.id ?? null,
    [deck.nodes],
  );
  const [deckRunInput, setDeckRunInput] = useState('');
  const [knowledgeGraphKind, setKnowledgeGraphKind] =
    useState<KnowledgeSurfaceKind>('unified');
  const conversationId = 'main';
  const [activeProjection, setActiveProjection] = useState<UnifiedProjectionIdentity | null>(null);
  const [pendingGraphObjectRef, setPendingGraphObjectRef] = useState<GraphObjectRef | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const handleAskMain = useCallback((reference: GraphObjectRef) => {
    setPendingGraphObjectRef(reference);
    setComposerFocusRequest((current) => current + 1);
  }, []);
  const handleGraphSelectionChange = useCallback((reference: GraphObjectRef | null) => {
    setPendingGraphObjectRef((current) => {
      if (!current) return current;
      if (!reference) return null;
      return graphObjectRefKey(current) === graphObjectRefKey(reference) ? current : reference;
    });
  }, []);
  const handleProjectionChange = useCallback((next: UnifiedProjectionIdentity | null) => {
    setActiveProjection((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, []);
  useEffect(() => {
    setActiveProjection(null);
    setPendingGraphObjectRef(null);
  }, [activeProject, conversationId]);
  const thinkGraphProjection = useAgentBuilderThinkGraphProjection({
    activeProject,
    knowledgeGraphKind,
    workspaceView,
  });

  // CodeGraph repository identity is resolved from the authoritative CBM index — the
  // indexed project whose root_path is this repo — never a hardcoded project name.
  const [codeGraphProjectName, setCodeGraphProjectName] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    void resolveCbmProjectName(DEFAULT_WORKSPACE_ROOT)
      .then((name) => {
        if (!cancelled && name) setCodeGraphProjectName(name);
      })
      .catch(() => {
        /* CBM unreachable: leave unresolved so CodeGraph shows its honest empty state. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const {
    handleNativeSend,
    messages,
    nativeSessionBusy,
    setMessages,
  } = useAgentBuilderMainChat({
    activeProjection,
    canvasProjectId,
    conversationId,
    initialMessages: EMPTY_PROJECT_MESSAGES,
    pendingGraphObjectRef,
    setPendingGraphObjectRef,
    workspaceView,
  });
  const [stateLoaded, setStateLoaded] = useState(false);

  useEffect(() => {
    const tick = () => setMoonPhase01(synodicPhaseFromDate(new Date()));
    tick();
    const id = window.setInterval(tick, 120000);
    return () => window.clearInterval(id);
  }, []);

  // agent builder state
  const deckSaveAbortRef = useRef<AbortController | null>(null);
  const deckExecutionAbortRef = useRef<AbortController | null>(null);
  const activeProjectLatestRef = useRef('');
  const lastBuilderDeckWriteReasonRef = useRef<string | null>(null);
  const lastBuilderUiOnlyActionRef = useRef<string | null>(null);
  const lastBuilderDeckFingerprintRef = useRef<string | null>(null);
  const lastPersistedBoardFingerprintRef = useRef<string | null>(null);
  const lastPersistedBoardSnapshotRef = useRef<{
    nodes: AgentCardInstance[];
    edges: DeckEdge[];
  } | null>(null);
  const layoutAutosaveAbortRef = useRef<AbortController | null>(null);
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
  useAgentBuilderDeckLoad({
    canvasProjectId,
    projectsApi: PROJECTS_API,
    builderDeckId: BUILDER_DECK_ID,
    currentDeckRef,
    emptyMessages: EMPTY_PROJECT_MESSAGES,
    buildProjectlessDeckDocument,
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
    setLatestDeckRun,
    setLatestCardRun,
    setLiveDeckEvents,
    setMessages,
    setStateLoaded,
    setDeckStatusMessage,
  });
  useAgentBuilderProjectReset({
    canvasProjectId,
    deckSaveAbortRef,
    layoutAutosaveAbortRef,
    deckExecutionAbortRef,
    setDeckSaveBusy,
    setDeckRunBusy,
    setCardRunBusy,
  });
  useAgentBuilderAutosave({
    builderDev: BUILDER_DEV,
    canvasProjectId,
    projectsApi: PROJECTS_API,
    builderDeckId: BUILDER_DECK_ID,
    deck,
    deckRevision,
    deckLoadBusy,
    deckLoadError,
    stateLoaded,
    layoutAutosaveAbortRef,
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

  const showDeckBuilder = workspaceView === 'canvas';
  const runtimeEvents = useMemo(
    () =>
      liveDeckEvents.length > 0 ? liveDeckEvents : latestDeckRun?.events || [],
    [latestDeckRun?.events, liveDeckEvents],
  );
  const runtimeVisualState = useMemo(
    () => buildDeckRuntimeVisualState(runtimeEvents),
    [runtimeEvents],
  );
  const {
    effectiveAgent,
    handleRenameSelectedCard,
    handleSaveSelectedCardConfig,
    handleUpdateSelectedCardSubtext,
    selectedCard,
    selectedCardConfig,
  } = useAgentBuilderCardEditor({
    deck,
    recordDeckWriteReason,
    selectedCardId,
    setDeck,
    setLatestCardRun,
    setLatestDeckRun,
  });
  const builderTabs = useMemo(() => {
    if (selectedCard) return [...BUILDER_NODE_TABS];
    return [...BUILDER_PROJECT_TABS];
  }, [selectedCard]);
  const activeTabs = useMemo(() => {
    if (workspaceView === 'canvas') return builderTabs;
    return [];
  }, [builderTabs, workspaceView]);
  const activeDeckWorkspaceContext = useMemo<DeckWorkspaceContext>(
    () => {
      const workspaceRoot = resolveDeckWorkspaceRoot(
        deck,
        DEFAULT_WORKSPACE_ROOT,
      );
      return {
        workspaceView,
        largeSurface,
        activeSurface: null,
        activeWorkbench: null,
        connectedWorkbenchAgent: false,
        repoPath: workspaceRoot,
        workspaceRoot,
        graphSource: null,
        analysisStatus: null,
        selectedNodeId: null,
        selectedNodeName: null,
        activeTab: tab,
        objectEditor: {
          open: Boolean(objectDrawerOpen && selectedCard),
          activeTab: selectedCard ? tab : null,
          selectedCardId: selectedCard?.id ?? null,
          selectedCardTitle: selectedCard
            ? safeText(selectedCard.title || '').trim() || null
            : null,
          selectedCardRuntimeType: selectedCard?.runtimeType ?? null,
          editable: Boolean(
            workspaceView === 'canvas' &&
              objectDrawerOpen &&
              selectedCard &&
              !deckLoadBusy,
          ),
          runnable: Boolean(
            workspaceView === 'canvas' &&
              selectedCard &&
              canvasProjectId &&
              !deckLoadBusy &&
              !deckRunBusy &&
              !cardRunBusy,
          ),
        },
      };
    },
    [
      cardRunBusy,
      canvasProjectId,
      deck,
      deckLoadBusy,
      deckRunBusy,
      largeSurface,
      objectDrawerOpen,
      selectedCard,
      tab,
      workspaceView,
    ],
  );
  const activeWorkspaceObjectContext = useMemo<WorkspaceObjectContext>(() => {
    const canvasAwareness = buildCanvasObjectAwareness(deck);
    const workspaceRoot = resolveDeckWorkspaceRoot(
      deck,
      DEFAULT_WORKSPACE_ROOT,
    );
    const context: WorkspaceObjectContext = {
      activeSurface:
        compactAwarenessText(largeSurface, 64) ||
        compactAwarenessText(workspaceView, 64) ||
        'chat',
      workspaceView: compactAwarenessText(workspaceView, 64),
      ...canvasAwareness,
    };
    context.repoPath = compactAwarenessText(workspaceRoot, 220);
    context.workspaceRoot = compactAwarenessText(workspaceRoot, 220);

    if (workspaceView === 'canvas' && selectedCard) {
      const runtimeType = normalizeRuntimeType(selectedCard.runtimeType) || 'assistant_agent';
      const binding = cleanOptionalText(selectedCard.runtimeBinding);
      context.selectedObjectId = compactAwarenessText(selectedCard.id, 96);
      context.selectedObjectType = compactAwarenessText(runtimeType, 64);
      context.selectedObjectTitle = compactAwarenessText(selectedCard.title, 120);
      context.selectedText = compactAwarenessText(
        selectedCard.prompt,
        WORKSPACE_OBJECT_SELECTED_TEXT_LIMIT,
      );
      context.openObjectSummary = compactAwarenessText(
        [
          `Selected canvas card: ${getCardDisplayName(selectedCard)}`,
          `runtimeType=${runtimeType}`,
          binding ? `runtimeBinding=${binding}` : null,
          tab ? `activeTab=${tab}` : null,
        ]
          .filter(Boolean)
          .join('; '),
        WORKSPACE_OBJECT_SUMMARY_LIMIT,
      );
    }

    return context;
  }, [
    deck,
    largeSurface,
    selectedCard,
    tab,
    workspaceView,
  ]);
  const deckValidation = useMemo(() => validateDeckDocument(deck), [deck]);

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

  const handleSelectCard = useCallback(
    (cardId: string | null) => {
      recordUiOnlyAction('node-selection');
      setSelectedCardId(cardId);
      const selectedNode = cardId
        ? deck.nodes.find((node) => node.id === cardId) || null
        : null;
      // Open the agent-card drawer only for real deck cards.
      setObjectDrawerOpen(Boolean(selectedNode));
      const isMagenticSelection = Boolean(
        selectedNode &&
          normalizeRuntimeType(selectedNode.runtimeType) === 'magentic_one',
      );
      if (cardId) {
        setBuilderCanvasFocusRequest((current) => ({
          kind: isMagenticSelection ? 'deck' : 'card',
          cardId: isMagenticSelection ? null : cardId,
          nonce: (current?.nonce || 0) + 1,
        }));
        setSelectedEdgeId(null);
        if (!BUILDER_NODE_TABS.some((entry) => entry === tab)) {
          setTab('Prompt');
        }
      } else {
        setBuilderCanvasFocusRequest((current) => ({
          kind: 'deck',
          cardId: null,
          nonce: (current?.nonce || 0) + 1,
        }));
      }
    },
    [deck.nodes, recordUiOnlyAction, tab],
  );

  const handleSelectEdge = useCallback(
    (edgeId: string | null) => {
      recordUiOnlyAction('edge-selection');
      setObjectDrawerOpen(false);
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

  const { handleSaveDeck, handleRunSelectedCard, handleRunDeck } =
    useBuilderDeckRuntimeActions({
      builderDev: BUILDER_DEV,
      buildSingleCardRunDocument,
      canvasProjectId,
      deck,
      deckExecutionAbortRef,
      deckId: BUILDER_DECK_ID,
      deckRevision,
      deckRunInput,
      deckSaveAbortRef,
      deckValidation,
      effectiveAgent,
      formatBuilderStatusMessage,
      hydrateDeckDocument,
      selectedCard,
      workspaceContext: activeDeckWorkspaceContext,
      workspaceObjectContext: activeWorkspaceObjectContext,
      setCardRunBusy,
      setDeck,
      setDeckRevision,
      setDeckRunBusy,
      setDeckSaveBusy,
      setDeckStatusMessage,
      setLatestCardRun,
      setLatestDeckRun,
      setLiveDeckEvents,
      templates: INITIAL_AGENT_TEMPLATES,
      uid,
      projectsApi: PROJECTS_API,
      activeProjectLatestRef,
      recordDeckWriteReason,
      onDeckPersistProof: (entry) => {
        if (entry.ok) {
          lastPersistedBoardFingerprintRef.current = JSON.stringify({
            nodes: deck.nodes,
            edges: deck.edges,
          });
          lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(deck);
        }
        console.info('[builder][deck-save-proof]', entry);
      },
    });



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
          Select an Assist project for system agents or an Agent workspace for
          Agent Builder config.
        </div>
      );
    }

    const renderEditorContent = () => {
      if (selectedCard && selectedCardConfig) {
        if (
          tab === 'Prompt' ||
          tab === 'Knowledge' ||
          tab === 'Tools' ||
          tab === 'Runtime' ||
          tab === 'Task'
        ) {
          const showCardIdentityFields = tab === BUILDER_NODE_TABS[0];
          return (
            <>
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
                <AgentManager
                  key={`deck-card:${selectedCard.id}:${tab}`}
                  agentType="agent_builder"
                  activeTab={tab}
                  selectedCardId={selectedCard.id}
                  promptTestInput={deckRunInput}
                  onChangePromptTestInput={setDeckRunInput}
                  onRunPromptTest={handleRunSelectedCard}
                  promptTestBusy={cardRunBusy}
                  promptTestDisabled={
                    cardRunBusy || deckLoadBusy || !canvasProjectId
                  }
                  localConfig={selectedCardConfig}
                  cardName={
                    showCardIdentityFields
                      ? String(selectedCard.title || '')
                      : undefined
                  }
                  cardSubtext={
                    showCardIdentityFields
                      ? String(selectedCard.subtitle || '')
                      : undefined
                  }
                  onChangeCardName={
                    showCardIdentityFields
                      ? handleRenameSelectedCard
                      : undefined
                  }
                  onChangeCardSubtext={
                    showCardIdentityFields
                      ? handleUpdateSelectedCardSubtext
                      : undefined
                  }
                  onSaveLocalConfig={handleSaveSelectedCardConfig}
                  onGraphRefresh={() => {
                    // no-op
                  }}
                />
              </Suspense>
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
                className="text-xs"
                style={{
                  color: GRAPH_THEME.drawer.inputText,
                  fontWeight: 700,
                  marginBottom: 8,
                }}
              >
                Run Input
              </div>
              <textarea
                value={deckRunInput}
                onChange={(event) => setDeckRunInput(event.target.value)}
                rows={6}
                style={{
                  ...graphDrawerInputStyle(),
                  resize: 'vertical',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              />
              <div
                className="flex items-center gap-2"
                style={{ marginTop: 10 }}
              >
                <button
                  onClick={() => {
                    recordDeckWriteReason('save-board-now');
                    void handleSaveDeck();
                  }}
                  disabled={deckSaveBusy || deckLoadBusy || !canvasProjectId}
                  style={graphDrawerButtonStyle({
                    opacity:
                      deckSaveBusy || deckLoadBusy || !canvasProjectId
                        ? 0.58
                        : 1,
                    cursor:
                      deckSaveBusy || deckLoadBusy || !canvasProjectId
                        ? 'not-allowed'
                        : 'pointer',
                  })}
                >
                  {deckSaveBusy ? 'Saving...' : 'Save Board Now'}
                </button>
                <button
                  onClick={() => handleRunDeck()}
                  disabled={
                    deckRunBusy ||
                    deckLoadBusy ||
                    deck.nodes.length === 0 ||
                    !canvasProjectId
                  }
                  style={graphDrawerButtonStyle({
                    border: `1px solid ${deckRunBusy ? GRAPH_THEME.drawer.inputBorder : C.primary}`,
                    background: deckRunBusy
                      ? 'rgba(18,20,24,0.74)'
                      : GRAPH_THEME.drawer.buttonBackground,
                    opacity:
                      deckRunBusy ||
                      deckLoadBusy ||
                      deck.nodes.length === 0 ||
                      !canvasProjectId
                        ? 0.58
                        : 1,
                    cursor:
                      deckRunBusy ||
                      deckLoadBusy ||
                      deck.nodes.length === 0 ||
                      !canvasProjectId
                        ? 'not-allowed'
                        : 'pointer',
                  })}
                >
                  {deckRunBusy ? 'Running...' : 'Run Deck'}
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
              {latestDeckRun?.error && (
                <div
                  className="text-xs"
                  style={{ marginTop: 8, color: C.warn }}
                >
                  {latestDeckRun.error}
                </div>
              )}
              {latestDeckRun?.steps?.map((step) =>
                step.magenticTrace?.promptTrace ? (
                  <details
                    key={`trace-${step.id}`}
                    className="text-xs"
                    style={{
                      marginTop: 12,
                      color: GRAPH_THEME.drawer.inputMuted,
                      border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                      padding: 8,
                      borderRadius: 4,
                      background: 'rgba(0,0,0,0.1)'
                    }}
                  >
                    <summary style={{ cursor: 'pointer', outline: 'none', fontWeight: 600 }}>
                      Prompt Trace (Card: {step.title})
                    </summary>
                    <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 10 }}>
                      {JSON.stringify(step.magenticTrace.promptTrace, null, 2)}
                    </pre>
                  </details>
                ) : null
              )}
            </div>
          </>
        );
      }

      return (
        <div
          style={graphDrawerSectionStyle({
            padding: '16px',
            borderStyle: 'dashed',
            color: GRAPH_THEME.drawer.inputMuted,
          })}
        >
          Select an agent node on the canvas to edit it. Edge links are
          canvas-only connections.
        </div>
      );
    };

    return <div className="space-y-3">{renderEditorContent()}</div>;
  };

  useEffect(() => {
    activeProjectLatestRef.current = activeProject;
  }, [activeProject]);

  const objectDrawerRole = useMemo<'agent' | 'worldsignal' | null>(() => {
    if (workspaceView === 'canvas' && selectedCard) return 'agent';
    // The canonical Inspector also serves the WorldSignals companion surface —
    // same drawer, same renderer, section requested by the vendor controls.
    if (workspaceView === 'worldsignal' && worldSignalInspectorSection) return 'worldsignal';
    return null;
  }, [selectedCard, workspaceView, worldSignalInspectorSection]);
  const isObjectDrawerVisible =
    objectDrawerRole === 'worldsignal'
      ? true
      : objectDrawerOpen && objectDrawerRole !== null;
  const objectDrawerDefaultWidth = AGENT_EDITOR_DEFAULT_WIDTH;
  const objectDrawerStorageKey = 'liquidaity.drawer.object.agent.v2.width';

  const closeObjectDrawer = useCallback(() => {
    setObjectDrawerOpen(false);
    setSelectedCardId(null);
    setSelectedEdgeId(null);
    setBuilderCanvasFocusRequest((current) => ({
      kind: 'deck',
      cardId: null,
      nonce: (current?.nonce || 0) + 1,
    }));
  }, []);

  const closeWorldSignalInspector = useCallback(() => {
    setWorldSignalInspectorSection(null);
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
    // Normal chat is the primary interaction surface. The existing persistent
    // OpenClaude PTY stays mounted beneath it so collapse and workspace changes
    // do not destroy the selected project's live terminal session.
    const chat = (
      <div style={{ height: '100%', minHeight: 0 }}>
        <BuilderChat
          messages={messages}
          onSend={handleNativeSend}
          knowledgeProjectId={projectId}
          colors={C}
          busy={nativeSessionBusy}
          composerFocusRequest={composerFocusRequest}
          graphObjectPlaceholder={pendingGraphObjectRef?.displayLabel}
        />
      </div>
    );
    return (
      <div
        data-testid={`${surfaceRole}-surface-chat`}
        style={getSurfaceShellStyle(compact)}
      >
        {compact ? (
          <div style={{ height: '100%' }}>{chat}</div>
        ) : (
          <HarnessChatPanel
            chat={chat}
            terminal={
              <OpenClaudeConsolePanel
                open
                placement="docked"
                title="OpenClaude Code"
                targetRoot={terminalRoot}
                projectId={typeof activeProject === 'string' ? activeProject : undefined}
                provider={localCoderConsoleConfig.provider}
                model={localCoderConsoleConfig.model}
              />
            }
          />
        )}
      </div>
    );
  };

  const renderCanvasSurface = (
    compact = false,
    surfaceRole: 'large' | 'companion' = compact ? 'companion' : 'large',
  ) => {
    return (
      <AgentCanvasPane
        surfaceRole={surfaceRole}
        shellStyle={getSurfaceShellStyle(compact)}
        document={deck}
        setDocument={setDeck}
        onPersistGraphMutation={recordDeckWriteReason}
        presentationViewportKey={
          surfaceRole === 'large' && workspaceView === 'canvas'
            ? chatPanelWidth
            : null
        }
        activeCardIds={runtimeVisualState.activeCardIds}
        activeEdgeIds={runtimeVisualState.activeEdgeIds}
        selectedCardId={selectedCardId}
        selectedEdgeId={selectedEdgeId}
        onSelectCard={handleSelectCard}
        onSelectEdge={handleSelectEdge}
        onDeleteSelectedEdge={handleDeleteSelectedEdge}
        inspectMode={false}
        focusZone={canvasFocusZone}
      />
    );
  };

  const renderKnowledgeGraphSurface = ({
    minHeight = 280,
    surfaceRole = minHeight > 320 ? 'large' : 'companion',
  }: {
    minHeight?: number;
    surfaceRole?: 'large' | 'companion';
  }) => {
    return (
      <div style={getSurfaceShellStyle(minHeight <= 320)}>
        <KnowledgeSurfaceErrorBoundary key={`knowledge-${knowledgeGraphKind}`}>
          <KnowledgeGraphFramework
            projectId={activeProject || null}
            codeGraphProjectName={codeGraphProjectName || null}
            conversationId={conversationId || null}
            kind={knowledgeGraphKind}
            minHeight={minHeight}
            surfaceRole={surfaceRole}
            thinkGraphProjection={thinkGraphProjection}
            onKindChange={setKnowledgeGraphKind}
            onProjectionChange={handleProjectionChange}
            onAskMain={handleAskMain}
            onSelectedObjectChange={handleGraphSelectionChange}
          />
        </KnowledgeSurfaceErrorBoundary>
      </div>
    );
  };

  const showCanvasWorkspace = useCallback(() => {
    closeObjectDrawer();
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
  }, [closeObjectDrawer]);

  const showKnowledgeWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('knowledge');
    setKnowledgeGraphKind('unified');
    const params = new URLSearchParams(window.location.search);
    params.set('workspace', 'knowledge');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [closeObjectDrawer]);

  const showTradingWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('trading');
  }, [closeObjectDrawer]);

  const showWorldsignalWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('worldsignal');
  }, [closeObjectDrawer]);

  const handleCompanionTabClick = useCallback((nextTab: string) => {
    setTab(nextTab);
  }, []);

  const workspaceRail = (
    <AgentBuilderRail
      colors={C}
      workspaceView={workspaceView}
      visibleRailItems={visibleRailItems}
      moonOrb={<BuilderRailMoonOrb phase01={moonPhase01} />}
      onShowWorldsignalWorkspace={showWorldsignalWorkspace}
      onShowCanvasWorkspace={showCanvasWorkspace}
      onShowKnowledgeWorkspace={showKnowledgeWorkspace}
      onShowTradingWorkspace={showTradingWorkspace}
      onOpenNavigationDrawer={() => setOpenDrawer('navigation')}
      hermesTerminalActive={hermesConsoleOpen}
      onOpenHermesTerminal={() => setHermesConsoleOpen((prev) => !prev)}
    />
  );

  const workspaceCompanionSurfaceHost = (
    <CompanionSurfaceHost
      workspaceView={workspaceView}
      minWidth={companionMinWidth}
      knowledgeSurface={
        renderKnowledgeGraphSurface({
          minHeight: 420,
          surfaceRole: 'companion',
        })
      }
      tradingSurface={<TradingUI />}
      worldsignalSurface={
        <WorldSignalSurface
          projectId={
            typeof activeProject === 'string' && activeProject ? activeProject : null
          }
          cardId={worldSignalsCardId}
          onInspectorSectionRequest={handleWorldSignalInspectorRequest}
          onLayerStateChange={setWorldSignalLayerState}
          onBridgeChange={setWorldSignalBridge}
        />
      }
    />
  );

  const workspaceDrawer =
    objectDrawerRole !== null ? (
      <RightGlassDrawer
        isOpen={isObjectDrawerVisible}
        title={
          objectDrawerRole === 'worldsignal'
            ? 'WorldSignals'
            : safeText(selectedCard?.title || 'Agent')
        }
        onClose={
          objectDrawerRole === 'worldsignal' ? closeWorldSignalInspector : closeObjectDrawer
        }
        movable
        defaultWidth={objectDrawerDefaultWidth}
        minWidth={300}
        maxWidth={560}
        storageKey={
          objectDrawerRole === 'worldsignal'
            ? 'liquidaity.drawer.object.worldsignal.v1.width'
            : objectDrawerStorageKey
        }
        dataTestId="workspace-object-drawer"
        right={12}
        top={48}
      >
        {objectDrawerRole === 'worldsignal' && worldSignalInspectorSection ? (
          <div
            className="flex min-w-0 flex-wrap"
            style={graphCompanionTabGroupStyle({
              gap: 6,
              marginBottom: 10,
            })}
          >
            {(['markets', 'layers'] as const).map((section) => {
              const selected = worldSignalInspectorSection === section;
              return (
                <button
                  key={section}
                  data-testid={`worldsignals-inspector-tab-${section}`}
                  aria-pressed={selected}
                  onClick={(event) => {
                    event.stopPropagation();
                    setWorldSignalInspectorSection(section);
                  }}
                  className="whitespace-nowrap transition-colors duration-150 ease-out"
                  style={graphCompanionTabButtonStyle(selected)}
                >
                  {section === 'markets' ? 'Markets' : 'Layers'}
                </button>
              );
            })}
          </div>
        ) : null}
        {objectDrawerRole === 'worldsignal' && worldSignalInspectorSection ? (
          <WorldSignalsInspectorPanel
            section={worldSignalInspectorSection}
            bridge={worldSignalBridge}
            layerState={worldSignalLayerState}
          />
        ) : null}
        {objectDrawerRole === 'agent' && activeTabs.length > 0 ? (
          <div
            className="flex min-w-0 flex-wrap"
            style={graphCompanionTabGroupStyle({
              gap: 6,
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
                  style={graphCompanionTabButtonStyle(selected)}
                >
                  {t}
                </button>
              );
            })}
          </div>
        ) : null}
        {objectDrawerRole === 'agent' ? (
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
        className="h-screen w-full flex overflow-hidden"
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
          onSplitterMouseEnter={onSplitterMouseEnter}
          onSplitterMouseLeave={onSplitterMouseLeave}
          onSplitterMouseDown={handleSplitterMouseDown}
          canvasMinWidth={canvasMinWidth}
          canvas={renderCanvasSurface(false, 'large')}
          companion={workspaceCompanionSurfaceHost}
          drawer={
            <>
              {workspaceDrawer}
              <HermesConsole
                open={hermesConsoleOpen}
                targetRoot={terminalRoot}
                projectId={typeof activeProject === 'string' ? activeProject : undefined}
                onClose={() => setHermesConsoleOpen(false)}
              />
            </>
          }
        />

      <AgentBuilderProjectDrawer
        activeProject={activeProject}
        colors={C}
        open={openDrawer === 'navigation'}
        projects={assistProjects}
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
