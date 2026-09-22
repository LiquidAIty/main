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
import WorldViewSurface from '../features/worldview/WorldViewSurface';
import AgentCanvasPane from '../features/agentbuilder/canvas/AgentCanvasPane';
import AgentBuilderRail from '../features/agentbuilder/core/AgentBuilderRail';
import AgentBuilderWorkspace from '../features/agentbuilder/core/AgentBuilderWorkspace';
import useAgentBuilderWorkspaceLayout from '../features/agentbuilder/core/useAgentBuilderWorkspaceLayout';
import CompanionSurfaceHost from '../features/agentbuilder/core/CompanionSurfaceHost';
import KnowledgeGraphFramework from '../components/knowledge/KnowledgeGraphFramework';
import type {
  GraphProjectionNode,
} from '../components/knowledge/NativeAuthorityGraphSurface';
import AgentTerminalPanel from '../features/agentbuilder/console/AgentTerminalPanel';
import HarnessChatPanel from '../features/agentbuilder/console/HarnessChatPanel';
import { selectedConversationId } from '../features/agentbuilder/console/mainSessionClient';
import useAgentBuilderMainChat from '../features/agentbuilder/console/useAgentBuilderMainChat';
import type {
  LoadedCardGraphReference,
} from '../features/agentbuilder/console/useAgentBuilderMainChat';
import useAgentBuilderAutosave from '../features/agentbuilder/state/useAgentBuilderAutosave';
import useAgentBuilderCardEditor from '../features/agentbuilder/state/useAgentBuilderCardEditor';
import useAgentBuilderDeck from '../features/agentbuilder/state/useAgentBuilderDeck';
import useAgentBuilderDeckLoad from '../features/agentbuilder/state/useAgentBuilderDeckLoad';
import useAgentBuilderProject from '../features/agentbuilder/state/useAgentBuilderProject';
import AgentBuilderProjectDrawer from '../features/agentbuilder/project/AgentBuilderProjectDrawer';
import useAgentBuilderProjectReset from '../features/agentbuilder/state/useAgentBuilderProjectReset';
import useAgentBuilderSelection from '../features/agentbuilder/state/useAgentBuilderSelection';
import useAgentBuilderGraphAttention from '../features/agentbuilder/state/useAgentBuilderGraphAttention';
import useCardActiveAgentCounts from '../features/agentbuilder/state/useCardActiveAgentCounts';
import TradingUI from './tradingui';
import TradingUiInspectorPanel from '../features/trading/TradingUiInspectorPanel';
import CardSubsystemTab from '../features/agentbuilder/subsystems/CardSubsystemTab';
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
  DEFAULT_WORKSPACE_ROOT,
  safeText,
} from '../features/agentbuilder/deck/deckPrimitives';
import {
  BUILDER_CARD_ID,
  BUILDER_DECK_ID,
  INITIAL_DECK,
} from '../features/agentbuilder/deck/newProjectDeck';
import { readCardSubsystemAttachments } from '../features/agentbuilder/deck/cardSubsystems';
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
  isWorldSignalsAgentCard,
} from '../features/agentbuilder/rail/railVisibility';
import {
  BuilderRailMoonOrb,
  synodicPhaseFromDate,
} from '../features/agentbuilder/core/BuilderRailMoonOrb';
import {
  isAbortLikeError,
} from '../components/builder/requestGuards';
import {
  useBuilderDeckPersistenceActions,
} from '../components/builder/useBuilderDeckPersistenceActions';
import type {
  AgentCardInstance,
  DeckEdge,
  DeckDocument,
  KnowledgeGraphKind,
} from '../types/agentgraph';

const loadAgentManager = () => import('../components/AgentManager');
const AgentManager = lazy(async () => {
  const mod = await loadAgentManager();
  return { default: mod.AgentManager };
});
void loadAgentManager();

import { resolveCbmProjectName } from '../components/codegraph/resolveCodeGraphProjectIdentity';

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
const BUILDER_NODE_TABS = ['Prompt', 'Runtime', 'Memory', 'Skills', 'Tools'] as const;
const AGENT_EDITOR_DEFAULT_WIDTH = 344;

function isMagneticCard(card: AgentCardInstance | null | undefined): boolean {
  return card?.id === 'card_magentic';
}

function hasTaskLedger(card: AgentCardInstance | null | undefined): boolean {
  return card?.id === 'card_magentic' || card?.id === 'card_team';
}

function taskLedgerRunCardId(card: AgentCardInstance, deck: DeckDocument): string {
  if (card.id !== 'card_team') return card.id;
  for (const edge of deck.edges) {
    if (edge.edgeType !== 'magentic_option' || edge.enabled === false) continue;
    const peerId = edge.source === card.id
      ? edge.target
      : edge.target === card.id ? edge.source : null;
    const peer = peerId ? deck.nodes.find((node) => node.id === peerId) : null;
    if (peer?.id === 'card_magentic') return peer.id;
  }
  return card.id;
}
// Hermes owns one project-intelligence canvas. Its three tabs are authorities,
// not agent-card capabilities: card/bus wiring must never hide project
// reasoning, external evidence, or repository reality from that canvas.
type KnowledgeSurfaceKind = KnowledgeGraphKind;
const PROJECTS_API = '/api/projects';

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
    | 'worldview'
  >(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('workspace') === 'knowledge') return 'knowledge';
    if (params.get('workspace') === 'worldview') return 'worldview';
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
  const canonicalDeckReady = Boolean(
    canvasProjectId
      && stateLoaded
      && !deckLoadBusy
      && !deckLoadError
      && deckRevision
      && deck.id === BUILDER_DECK_ID,
  );
  const cardActivity = useCardActiveAgentCounts({
    projectId: canonicalDeckReady ? canvasProjectId : '',
    deck,
  });

  const currentDeckRef = useRef(deck);
  useEffect(() => {
    currentDeckRef.current = deck;
  }, [deck]);
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
    setBuilderCanvasFocusRequest,
    tab,
    setTab,
    openDrawer,
    setOpenDrawer,
  } = useAgentBuilderSelection({
    deck,
  });
  const cardLeaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const registerCardLeave = useCallback((save: (() => Promise<boolean>) | null) => {
    cardLeaveRef.current = save;
  }, []);

  const [transientCardInputs, setTransientCardInputs] = useState<Record<string, string>>({});
  const [transientCardGraphContext, setTransientCardGraphContext] =
    useState<Record<string, LoadedCardGraphReference[]>>({});
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
  const worldViewCard = useMemo(
    () => deck.nodes.find((node) => isWorldViewCard(node)) || null,
    [deck.nodes],
  );
  const signalAnalystCard = useMemo(
    () => deck.nodes.find((node) => (
      node.runtime.kind === 'hermes'
      && node.runtime.profile === 'signal-analyst'
    )) || null,
    [deck.nodes],
  );
  const [knowledgeGraphKind, setKnowledgeGraphKind] =
    useState<KnowledgeSurfaceKind>('knowgraph');
  // Resolve existing conversation links once; continuity stays project-owned,
  // without conversation navigation controls or a URL-driven swap mid-turn.
  const [conversationId] = useState(() => (
    selectedConversationId(window.location.search)
  ));
  const graphAttention = useAgentBuilderGraphAttention({
    projectId: activeProject,
    deckId: BUILDER_DECK_ID,
    conversationId,
    selectedCardId,
  });
  useEffect(() => {
    if (!activeProject) return undefined;
    const params = new URLSearchParams({
      projectId: activeProject,
      deckId: BUILDER_DECK_ID,
      stream: 'true',
      ...(selectedCardId ? { cardId: selectedCardId } : {}),
    });
    const stream = new EventSource(`/api/main/session/attention?${params.toString()}`, { withCredentials: true });
    stream.onopen = () => { void graphAttention.refreshThinkGraph(); };
    stream.addEventListener('session', (event) => {
      graphAttention.observeAttentionSession(JSON.parse((event as MessageEvent).data));
    });
    stream.addEventListener('native_attention', (event) => {
      graphAttention.observeAttentionEvent(JSON.parse((event as MessageEvent).data));
    });
    stream.onerror = (error) => {
      console.warn('[NATIVE_GRAPH_ATTENTION_READBACK]', error);
    };
    return () => stream.close();
  }, [activeProject, selectedCardId, graphAttention.observeAttentionEvent, graphAttention.observeAttentionSession, graphAttention.refreshThinkGraph]);
  const handleUseAttentionNode = useCallback((
    authority: 'thinkgraph' | 'knowgraph' | 'codegraph',
    node: GraphProjectionNode,
  ) => {
    if (!mainCardId) {
      setDeckStatusMessage('Main Card is unavailable for graph context selection.');
      return;
    }
    const nativeId = String(node.canonicalId || node.id || '').trim();
    if (!nativeId) {
      setDeckStatusMessage('Selected graph object has no native identity.');
      return;
    }
    const authorityName = ({
      thinkgraph: 'ThinkGraph',
      knowgraph: 'KnowGraph',
      codegraph: 'CodeGraph',
    } as const)[authority];
    const sourceProjection = graphAttention.projections[authority];
    const relatedEdges = sourceProjection.edges.filter(
      (edge) => edge.source === node.id || edge.target === node.id,
    );
    const relatedNodeIds = new Set<string>([node.id]);
    for (const edge of relatedEdges) {
      relatedNodeIds.add(edge.source);
      relatedNodeIds.add(edge.target);
    }
    setTransientCardGraphContext((current) => {
      const existing = current[mainCardId] || [];
      const replacementKey = `${authorityName}:${nativeId}`;
      const next: LoadedCardGraphReference = {
        targetCardId: mainCardId,
        reference: {
          authority: authorityName,
          nativeId,
          reason: 'Explicitly selected by the user as grounding for the next Main invocation.',
          order: existing.length,
          boundedExpansion: authority === 'thinkgraph' ? 0 : 1,
          resultLimit: 12,
          required: true,
        },
        resolvedReferences: [],
        resolvedContextMarkdown: '',
        graphProjection: {
          ...sourceProjection,
          nodes: sourceProjection.nodes.filter((candidate) => relatedNodeIds.has(candidate.id)),
          edges: relatedEdges,
        },
        resolved: false,
        ready: false,
      };
      return {
        ...current,
        [mainCardId]: [
          ...existing.filter((item) => (
            `${item.reference.authority}:${item.reference.nativeId}` !== replacementKey
          )),
          next,
        ].map((item, order) => ({
          ...item,
          reference: { ...item.reference, order },
        })),
      };
    });
    setDeckStatusMessage(`${authorityName} reference selected for Main; Python will reread it on send.`);
  }, [graphAttention.projections, mainCardId, setDeckStatusMessage]);
  // CodeGraph repository identity is resolved from the authoritative CBM index.
  // The canonical ready project wins over stale same-root validation indexes.
  const [codeGraphProjectName, setCodeGraphProjectName] = useState<string>('');
  const [codeGraphProjectError, setCodeGraphProjectError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // CodeGraph is an explicitly opened product surface. Agent Canvas and the
    // other graph tabs must not probe CBM merely because the workspace mounted.
    if (
      workspaceView !== 'knowledge'
      || knowledgeGraphKind !== 'codegraph'
      || !canvasProjectId
      || !mainCardId
    ) return;
    void resolveCbmProjectName(DEFAULT_WORKSPACE_ROOT, {
      context: { projectId: canvasProjectId, deckId: BUILDER_DECK_ID, cardId: mainCardId },
    })
      .then((name) => {
        if (!cancelled) {
          setCodeGraphProjectName(name);
          setCodeGraphProjectError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCodeGraphProjectName('');
          setCodeGraphProjectError(
            error instanceof Error ? error.message : 'CBM project identity resolution failed',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canvasProjectId, knowledgeGraphKind, mainCardId, workspaceView]);
  const {
    handleNativeSend,
    messages,
    addressableAgents,
    nativeSessionActive,
    nativeSessionConnecting,
    mainDriverSource,
    sessionHistoryLoading,
    stopMainTurn,
    technicalError,
  } = useAgentBuilderMainChat({
    canvasProjectId,
    deckId: BUILDER_DECK_ID,
    conversationId,
    dataAnchors: mainCardId
      ? (transientCardGraphContext[mainCardId] || []).map((item) => item.reference)
      : [],
    onUserTurnStarted: graphAttention.startAttentionScope,
    onNativeTurnEvent: graphAttention.observeNativeTurnEvent,
    onTurnFinished: graphAttention.finishAttentionScope,
  });
  useEffect(() => {
    const tick = () => setMoonPhase01(synodicPhaseFromDate(new Date()));
    tick();
    const id = window.setInterval(tick, 120000);
    return () => window.clearInterval(id);
  }, []);

  // agent builder state
  const deckSaveAbortRef = useRef<AbortController | null>(null);
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
  useAgentBuilderProjectReset({
    canvasProjectId,
    deckSaveAbortRef,
    layoutAutosaveAbortRef,
    setDeckSaveBusy,
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

  const { handleSaveDeck } =
    useBuilderDeckPersistenceActions({
      builderDev: BUILDER_DEV,
      canvasProjectId,
      deck,
      deckId: BUILDER_DECK_ID,
      deckRevision,
      deckSaveAbortRef: layoutAutosaveAbortRef,
      formatBuilderStatusMessage,
      readDeckDocument,
      setDeck,
      setDeckRevision,
      setDeckSaveBusy,
      setDeckStatusMessage,
      projectsApi: PROJECTS_API,
      activeProjectLatestRef,
      recordDeckWriteReason,
      onDeckPersistProof: (entry) => {
        if (entry.ok) {
          lastPersistedBoardFingerprintRef.current = JSON.stringify({
            nodes: (entry.document || deck).nodes,
            edges: (entry.document || deck).edges,
          });
          lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(entry.document || deck);
        }
        console.info('[builder][deck-save-proof]', entry);
      },
    });



  const showDeckBuilder = workspaceView === 'canvas';
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
  });
  const tradingCard = useMemo(
    () => deck.nodes.find((card) => card.id === 'card_trading_workbench') || null,
    [deck.nodes],
  );
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
      ...readCardSubsystemAttachments(selectedCard.runtimeOptions)
        .filter((attachment) => attachment.cardTab.enabled)
        .map((attachment) => attachment.label),
    ];
    return [...BUILDER_PROJECT_TABS];
  }, [selectedCard, mainCardId, builderCard?.id]);
  const selectedCardSubsystem = useMemo(
    () => readCardSubsystemAttachments(selectedCard?.runtimeOptions)
      .find((attachment) => attachment.cardTab.enabled && attachment.label === tab) || null,
    [selectedCard?.runtimeOptions, tab],
  );
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

  const handleQuickAddAssistNode = useCallback(async () => {
    if (!canonicalDeckReady) {
      setDeckStatusMessage('Wait for the canvas to load.');
      return;
    }
    if (cardLeaveRef.current && !(await cardLeaveRef.current())) return;
    let runtime: { kind: 'hermes'; mode: 'delegate' };
    try {
      const response = await fetch('/api/idd/card-editor');
      const dictionary = await response.json();
      const binding = dictionary?.templates?.template_assist?.runtime;
      if (!response.ok || dictionary?.ok !== true
        || binding?.kind !== 'hermes' || binding?.mode !== 'delegate') {
        throw new Error('Template unavailable.');
      }
      runtime = binding;
    } catch (error) {
      setDeckStatusMessage(error instanceof Error ? error.message : 'Template unavailable.');
      return;
    }
    const { nextNode } = buildQuickAddAssistCard(currentDeckRef.current, runtime);
    recordDeckWriteReason('deck-quick-add');
    setDeck((current) => ({ ...current, version: current.version + 1, nodes: [...current.nodes, nextNode] }));
    setSelectedEdgeId(null);
    setInspectorDrawerOpen(false);
    // Select and open the new card's editor immediately.
    setSelectedCardId(nextNode.id);
    setBuilderCanvasFocusRequest((current) => ({
      kind: 'card',
      cardId: nextNode.id,
      nonce: (current?.nonce || 0) + 1,
    }));
    setInspectorDrawerOpen(true);
    if (!BUILDER_NODE_TABS.some((entry) => entry === tab)) {
      setTab('Prompt');
    }
    setDeckStatusMessage(
      `Added ${nextNode.title} to the canvas. Open its editor to configure it.`,
    );
  }, [
    BUILDER_NODE_TABS,
    canonicalDeckReady,
    deck,
    recordDeckWriteReason,
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
            projectId={canvasProjectId}
            deckId={BUILDER_DECK_ID}
            cardId={taskLedgerRunCardId(selectedCard, deck)}
            label={selectedCard.title}
            cardTitlesByProfile={cardTitlesByProfile}
          />;
        }
        if (selectedCardSubsystem) {
          return <CardSubsystemTab
            attachment={selectedCardSubsystem}
            readinessEndpoint={selectedCardSubsystem.id === 'lumibot'
              ? '/api/trading/readiness'
              : selectedCardSubsystem.id === 'gods-eye'
                ? '/api/worldview/readiness'
              : null}
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
            }}
          />;
        }
        if (BUILDER_NODE_TABS.some((entry) => entry === tab)) {
          return (
            <>
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
                  <AgentManager
                    key="deck-card-editor"
                    cardId={selectedCard.id}
                    projectId={canvasProjectId}
                    deckId={BUILDER_DECK_ID}
                    registerCardLeave={registerCardLeave}
                    activeTab={tab}
                    cardName={selectedCard.title}
                    onChangeCardName={handleRenameSelectedCard}
                    localConfig={selectedCardConfig}
                    onSaveLocalConfig={handleSaveSelectedCardConfig}
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
                    void handleSaveDeck();
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

  useEffect(() => {
    activeProjectLatestRef.current = activeProject;
  }, [activeProject]);

  const inspectorDrawerRole = useMemo<'agent' | 'trading' | 'worldsignal' | null>(() => {
    if (workspaceView === 'canvas' && canonicalDeckReady && selectedCard) return 'agent';
    // The canonical Inspector also serves the WorldSignals companion surface —
    // same drawer, same renderer, section requested by the vendor controls.
    if (workspaceView === 'worldsignal' && worldSignalInspectorSection) return 'worldsignal';
    if (workspaceView === 'trading' && tradingCard) return 'trading';
    return null;
  }, [canonicalDeckReady, selectedCard, tradingCard, workspaceView, worldSignalInspectorSection]);
  const isInspectorDrawerVisible =
    inspectorDrawerRole === 'worldsignal'
      ? true
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
    // Main owns the chat above; the permanent lower work surface belongs only
    // to the separately saved Builder Card and its own Hermes session.
    const chat = (
      <div style={{ height: '100%', minHeight: 0 }}>
        <BuilderChat
          messages={messages}
          mainCardId={mainCardId || undefined}
          addressableAgents={addressableAgents}
          onSend={handleNativeSend}
          draft={mainCardId ? transientCardInputs[mainCardId] || '' : ''}
          onDraftChange={(value) => {
            if (!mainCardId) return;
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
          colors={C}
          busy={nativeSessionActive}
          connecting={nativeSessionConnecting}
          historyLoading={sessionHistoryLoading}
          error={technicalError}
          onStop={() => {
            void stopMainTurn().catch((error) => {
              setDeckStatusMessage(error instanceof Error ? error.message : 'Main run stop failed.');
            });
          }}
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
          <HarnessChatPanel
            activeDriver={mainDriverSource === 'external_plugin'
              ? 'external_plugin'
              : nativeSessionActive || nativeSessionConnecting
                ? 'internal_chat'
                : null}
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
        <KnowledgeSurfaceErrorBoundary key={`knowledge-${knowledgeGraphKind}`}>
          <KnowledgeGraphFramework
            codeGraphProjectName={codeGraphProjectName || null}
            codeGraphProjectError={codeGraphProjectError}
            kind={knowledgeGraphKind}
            minHeight={minHeight}
            surfaceRole={surfaceRole}
            attentionProjections={graphAttention.projections}
            onRemoveThinkGraphEvidence={graphAttention.removeThinkGraphEvidence}
            attentionErrors={graphAttention.errors}
            attentionStatuses={graphAttention.statuses}
            onExpandAttentionNode={(authority, node) => graphAttention.expandNode({
              authority,
              node,
              projectId: activeProject,
              codeGraphProject: codeGraphProjectName || null,
              readerCardId: mainCardId,
            })}
            onUseAttentionNode={handleUseAttentionNode}
            onKindChange={setKnowledgeGraphKind}
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
    setKnowledgeGraphKind('knowgraph');
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
    // Hide the editor while the operational presentation is open, but preserve
    // the Canvas selection. Returning to the Canvas therefore restores the
    // same Card context instead of treating app navigation as a Card edit.
    setInspectorDrawerOpen(false);
    setWorkspaceView('trading');
  }, [setInspectorDrawerOpen]);

  const showWorldsignalWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    setWorkspaceView('worldsignal');
  }, [closeInspectorDrawer]);

  const showWorldviewWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    setWorkspaceView('worldview');
    const params = new URLSearchParams(window.location.search);
    params.set('workspace', 'worldview');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [closeInspectorDrawer]);

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
      onShowWorldsignalWorkspace={showWorldsignalWorkspace}
      onShowWorldviewWorkspace={showWorldviewWorkspace}
      onShowCanvasWorkspace={showCanvasWorkspace}
      onQuickAddAssistNode={handleQuickAddAssistNode}
      onShowKnowledgeWorkspace={showKnowledgeWorkspace}
      onShowTradingWorkspace={showTradingWorkspace}
      onOpenNavigationDrawer={() => setOpenDrawer('navigation')}
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
      tradingSurface={
        <TradingUI
          symbol="RDW"
          projectId={canvasProjectId || null}
          deckId={BUILDER_DECK_ID}
          card={tradingCard}
        />
      }
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
      worldviewSurface={
        <WorldViewSurface
          projectId={canvasProjectId || null}
          deckId={BUILDER_DECK_ID}
          cardId={worldViewCard?.id || null}
          analystCardId={signalAnalystCard?.id || null}
        />
      }
    />
  );

  const workspaceDrawer =
    inspectorDrawerRole !== null ? (
      <RightGlassDrawer
        isOpen={isInspectorDrawerVisible}
        title={
          inspectorDrawerRole === 'worldsignal'
            ? 'WorldSignals'
            : inspectorDrawerRole === 'trading'
              ? 'Trading settings'
            : safeText(selectedCard?.title || 'Agent')
        }
        onClose={
          inspectorDrawerRole === 'worldsignal'
            ? closeWorldSignalInspector
            : inspectorDrawerRole === 'trading'
              ? () => setInspectorDrawerOpen(false)
              : closeInspectorDrawer
        }
        onOpen={inspectorDrawerRole === 'trading' ? () => setInspectorDrawerOpen(true) : undefined}
        collapsedLabel={null}
        openAriaLabel="Open Trading Inspector"
        movable={inspectorDrawerRole !== 'trading'}
        defaultWidth={inspectorDrawerDefaultWidth}
        resetWidthOnOpen={false}
        minWidth={300}
        maxWidth={560}
        storageKey={
          inspectorDrawerRole === 'worldsignal'
            ? 'liquidaity.drawer.inspector.worldsignal.v1.width'
            : inspectorDrawerRole === 'trading'
              ? 'card.drawer.inspector.trading.v1.width'
            : inspectorDrawerStorageKey
        }
        dataTestId="workspace-inspector-drawer"
        right={12}
        top={48}
      >
        {inspectorDrawerRole === 'worldsignal' && worldSignalInspectorSection ? (
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
        {inspectorDrawerRole === 'trading' && tradingCard ? (
          <TradingUiInspectorPanel
            configuration={tradingCard.runtimeOptions?.configuration || {}}
            onSave={(configuration) => {
              handleSaveCardConfiguration(tradingCard.id, configuration);
            }}
          />
        ) : null}
        {inspectorDrawerRole === 'worldsignal' && worldSignalInspectorSection ? (
          <WorldSignalsInspectorPanel
            section={worldSignalInspectorSection}
            bridge={worldSignalBridge}
            layerState={worldSignalLayerState}
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
          canvas={canvasSurface}
          companion={workspaceCompanionSurfaceHost}
          drawer={<>{workspaceDrawer}</>}
        />

      <AgentBuilderProjectDrawer
        activeProject={activeProject}
        builderDeckId={BUILDER_DECK_ID}
        colors={C}
        initialDeck={INITIAL_DECK}
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
