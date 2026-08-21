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
import CoderTerminalPanel from '../features/agentbuilder/console/CoderTerminalPanel';
import HarnessChatPanel from '../features/agentbuilder/console/HarnessChatPanel';
import HermesKanbanWorkspace from '../features/hermeskanban/HermesKanbanWorkspace';
import useAgentBuilderMainChat from '../features/agentbuilder/console/useAgentBuilderMainChat';
import type {
  AgentBuilderChatMessage,
  LoadedCardGraphReference,
  StagedCardInvocationLoaded,
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
import TradingUI from './tradingui';
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
  BUILDER_DECK_ID,
  INITIAL_DECK,
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
  isHermesStewardCard,
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

const AgentManager = lazy(async () => {
  const mod = await import('../components/AgentManager');
  return { default: mod.AgentManager };
});
import type { StandaloneCardTestResult } from '../components/AgentManager';

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
const BUILDER_NODE_TABS = ['Invocation', 'Prompt', 'Knowledge', 'Capabilities', 'Runtime'] as const;
const AGENT_EDITOR_DEFAULT_WIDTH = 344;
// Hermes owns one project-intelligence canvas. Its three tabs are authorities,
// not agent-card capabilities: card/bus wiring must never hide project
// reasoning, external evidence, or repository reality from that canvas.
type KnowledgeSurfaceKind = KnowledgeGraphKind;
const PROJECTS_API = '/api/projects';
const EMPTY_PROJECT_MESSAGES: AgentBuilderChatMessage[] = [];

export function getStandaloneCardUnavailableReason(
  card: AgentCardInstance | null,
): string | null {
  if (!card) return 'Select a saved card before testing.';
  if (card.runtime.kind === 'hermes' && card.runtime.mode === 'main') {
    return 'Main uses its persistent conversation route and is not tested as an isolated Card.';
  }
  return null;
}

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
    | 'hermes'
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
  const currentDeckRef = useRef(deck);
  useEffect(() => {
    currentDeckRef.current = deck;
  }, [deck]);
  const priorWorkspaceViewRef = useRef<'chat' | 'canvas' | 'knowledge' | 'trading' | 'worldsignal'>('canvas');
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
  const [transientCardInputs, setTransientCardInputs] = useState<Record<string, string>>({});
  const [transientCardGraphContext, setTransientCardGraphContext] =
    useState<Record<string, LoadedCardGraphReference[]>>({});
  const standaloneTestPrompt = selectedCardId
    ? transientCardInputs[selectedCardId] || ''
    : '';
  const setStandaloneTestPrompt = useCallback((value: string) => {
    if (!selectedCardId) return;
    setTransientCardInputs((current) => {
      if (!value) {
        const next = { ...current };
        delete next[selectedCardId];
        return next;
      }
      return { ...current, [selectedCardId]: value };
    });
  }, [selectedCardId]);
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
  const [knowledgeGraphKind, setKnowledgeGraphKind] =
    useState<KnowledgeSurfaceKind>('knowgraph');
  const conversationId = 'main';
  const graphAttention = useAgentBuilderGraphAttention({ projectId: activeProject });
  const [standaloneTestResult, setStandaloneTestResult] = useState<StandaloneCardTestResult | null>(null);
  const handleCardInvocationStaged = useCallback((loaded: StagedCardInvocationLoaded) => {
    const target = deck.nodes.find((card) => card.id === loaded.targetCardId);
    const graphProjection = loaded.invocation.resolvedGraphProjection;
    const supportedTarget = target && (
      (target.runtime.kind === 'hermes' && target.runtime.mode === 'delegate')
      || (target.runtime.kind === 'autogen' && target.runtime.mode === 'magentic_one')
    );
    if (!target || !supportedTarget || !graphProjection) {
      setDeckStatusMessage('Grounded invocation target is not an active saved Coder or Mag One Card.');
      return;
    }
    const graphContext: LoadedCardGraphReference[] = loaded.dataAnchors.map((anchor, order) => ({
      targetCardId: target.id,
      sourceCardId: loaded.sourceCardId,
      reference: {
        authority: anchor.authority,
        nativeId: anchor.nativeId,
        reason: anchor.reason,
        order,
        boundedExpansion: anchor.boundedExpansion,
        resultLimit: anchor.resultLimit,
        required: true,
      },
      resolvedReferences: loaded.invocation.resolvedNativeReads || [],
      resolvedContextMarkdown: '',
      graphProjection,
      resolved: true,
      ready: true,
    }));
    setTransientCardInputs((current) => ({
      ...current,
      [target.id]: loaded.mission,
    }));
    setTransientCardGraphContext((current) => ({ ...current, [target.id]: graphContext }));
    setStandaloneTestResult({
      status: 'ready',
      output: '',
      error: null,
      toolCallCount: 0,
      tools: loaded.invocation.idf.enabledTools,
      provider: String(loaded.invocation.idf.provider.provider || ''),
      model: String(loaded.invocation.idf.provider.providerModelId || ''),
      runtimeLabel: `${target.runtime.kind}/${target.runtime.mode}`,
      invocation: loaded.invocation,
    });
    setSelectedCardId(target.id);
    setTab('Invocation');
    setDeckStatusMessage(`${target.title} grounded invocation is ready for review. Nothing ran.`);
  }, [deck.nodes, setDeckStatusMessage, setSelectedCardId, setTab]);

  const handleCardGraphReferenceLoaded = useCallback((loaded: LoadedCardGraphReference) => {
    const target = deck.nodes.find((card) => card.id === loaded.targetCardId);
    if (!target) {
      setDeckStatusMessage('Graph reference target is not an active saved Card.');
      return;
    }
    setTransientCardGraphContext((current) => {
      const existing = current[target.id] || [];
      const replacementKey = `${loaded.reference.authority}:${loaded.reference.nativeId}`;
      return {
        ...current,
        [target.id]: [
          ...existing.filter(
            (item) => `${item.reference.authority}:${item.reference.nativeId}` !== replacementKey,
          ),
          loaded,
        ].sort((left, right) => left.reference.order - right.reference.order),
      };
    });
    // A new native reference invalidates any older materialization preview.
    // The Knowledge tab must never label a stale projection as model-bound.
    setStandaloneTestResult(null);
    setSelectedCardId(target.id);
    setTab('Knowledge');
    setDeckStatusMessage(
      loaded.ready
        ? `${target.title} graph context is loaded for review.`
        : `${target.title} graph context is not ready: ${loaded.error || 'required reference unresolved'}.`,
    );
  }, [deck.nodes, setDeckStatusMessage, setSelectedCardId, setTab]);

  // CodeGraph repository identity is resolved from the authoritative CBM index.
  // The canonical ready project wins over stale same-root validation indexes.
  const [codeGraphProjectName, setCodeGraphProjectName] = useState<string>('');
  const [codeGraphProjectError, setCodeGraphProjectError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void resolveCbmProjectName(DEFAULT_WORKSPACE_ROOT)
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
  }, []);
  const {
    handleNativeSend,
    messages,
    nativeSessionBusy,
    setMessages,
  } = useAgentBuilderMainChat({
    canvasProjectId,
    deckId: BUILDER_DECK_ID,
    conversationId,
    initialMessages: EMPTY_PROJECT_MESSAGES,
    workspaceView,
    onUserTurnStarted: graphAttention.startAttentionScope,
    onNativeTurnEvent: graphAttention.observeNativeTurnEvent,
    onCardInvocationStaged: handleCardInvocationStaged,
    onCardGraphReferenceLoaded: handleCardGraphReferenceLoaded,
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
    emptyMessages: EMPTY_PROJECT_MESSAGES,
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
    setMessages,
    setStateLoaded,
    setDeckStatusMessage,
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

  const showDeckBuilder = workspaceView === 'canvas';
  const {
    handleSaveSelectedCardConfig,
    handleRenameSelectedCard,
    handleUpdateSelectedCardSubtext,
    selectedCard,
    selectedCardConfig,
  } = useAgentBuilderCardEditor({
    deck,
    recordDeckWriteReason,
    selectedCardId,
    setDeck,
  });
  const selectedMagOneWorkers = useMemo(() => {
    if (!selectedCard || selectedCard.runtime.kind !== 'autogen' || selectedCard.runtime.mode !== 'magentic_one') {
      return [];
    }
    return deck.edges
      .filter((edge) => edge.edgeType === 'magentic_option')
      .map((edge) => edge.source === selectedCard.id ? edge.target : edge.target === selectedCard.id ? edge.source : null)
      .filter((cardId): cardId is string => Boolean(cardId))
      .map((cardId) => deck.nodes.find((card) => card.id === cardId))
      .filter((card): card is AgentCardInstance => Boolean(card))
      .map((card) => ({
        cardId: card.id,
        title: card.title,
        ready: card.status !== 'error'
          && card.runtime.kind === 'autogen'
          && card.runtime.mode === 'assistant'
          && Boolean(card.runtimeOptions?.provider)
          && Boolean(card.runtimeOptions?.modelKey),
        provider: card.runtimeOptions?.provider || null,
        model: card.runtimeOptions?.modelKey || null,
      }));
  }, [deck.edges, deck.nodes, selectedCard]);
  const [standaloneTestBusy, setStandaloneTestBusy] = useState(false);
  const standaloneTestRequestRef = useRef<string | null>(null);
  const standaloneTestUnavailableReason = useMemo(
    () => getStandaloneCardUnavailableReason(selectedCard),
    [selectedCard],
  );
  // Main's ordinary Chat input + Send control is its only invocation composer.
  // The Inspector can display Main, but must not expose a second self-test input.
  const showStandaloneTestControls =
    Boolean(selectedCard)
    && !(selectedCard?.runtime.kind === 'hermes' && selectedCard.runtime.mode === 'main');
  useEffect(() => {
    standaloneTestRequestRef.current = null;
    setStandaloneTestBusy(false);
    setStandaloneTestResult((current) => (
      current?.invocation?.cardIdentity.cardId === selectedCardId ? current : null
    ));
  }, [selectedCardId]);

  const executeStandaloneInvocation = useCallback(async (
    input: string,
  ) => {
    if (!selectedCard || !canvasProjectId || standaloneTestBusy || standaloneTestUnavailableReason) return;
    const correlationId = `card-run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    standaloneTestRequestRef.current = correlationId;
    setStandaloneTestBusy(true);
    setStandaloneTestResult(null);
    try {
      const response = await fetch('/api/coder/mcp-bridge/run_configured_card', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          projectId: canvasProjectId,
          deckId: BUILDER_DECK_ID,
          cardId: selectedCard.id,
          correlationId,
          input,
          conversationId,
          dataAnchors: (transientCardGraphContext[selectedCard.id] || []).map((item) => ({
            authority: item.reference.authority,
            nativeId: item.reference.nativeId,
            reason: item.reference.reason,
            priority: -item.reference.order,
            boundedExpansion: item.reference.boundedExpansion,
            resultLimit: item.reference.resultLimit,
            required: item.reference.required,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      const result = payload?.result;
      if (!result || typeof result !== 'object') {
        throw new Error(String(payload?.error || `standalone_card_test_http_${response.status}`));
      }
      if (standaloneTestRequestRef.current === correlationId) {
        const status = String(result.status || (response.ok ? 'completed' : 'failed'));
        setStandaloneTestResult({
          status,
          output: String(result.output || ''),
          error: result.error ? String(result.error) : null,
          toolCallCount: typeof result.toolCallCount === 'number' ? result.toolCallCount : null,
          tools: Array.isArray(result.invocation?.idf?.enabledTools)
            ? result.invocation.idf.enabledTools.map((tool: unknown) => String(tool))
            : [],
          provider: selectedCard.runtimeOptions?.provider || null,
          model: selectedCard.runtimeOptions?.modelKey || null,
          runtimeLabel: `${selectedCard.runtime.kind}/${selectedCard.runtime.mode}`,
          invocation: result.invocation || null,
          receipt: result.receipt || null,
        });
        setDeckStatusMessage(
          result.error
            ? String(result.error)
            : `${selectedCard.title} run ${String(result.status || 'completed')}.`,
        );
        if (!result.error && status === 'completed') {
          setTransientCardInputs((current) => {
            const next = { ...current };
            delete next[selectedCard.id];
            return next;
          });
          setTransientCardGraphContext((current) => {
            const next = { ...current };
            delete next[selectedCard.id];
            return next;
          });
        }
      }
    } catch (error) {
      if (standaloneTestRequestRef.current === correlationId) {
        setStandaloneTestResult({
          status: 'failed', output: '', error: error instanceof Error ? error.message : 'Standalone card test failed.',
          toolCallCount: null, tools: [], provider: selectedCard.runtimeOptions?.provider || null,
          model: selectedCard.runtimeOptions?.modelKey || null,
          runtimeLabel: `${selectedCard.runtime.kind}/${selectedCard.runtime.mode}`,
        });
        setDeckStatusMessage(error instanceof Error ? error.message : 'Standalone card test failed.');
      }
    } finally {
      if (standaloneTestRequestRef.current === correlationId) {
        standaloneTestRequestRef.current = null;
        setStandaloneTestBusy(false);
      }
    }
  }, [
    canvasProjectId,
    conversationId,
    selectedCard,
    standaloneTestBusy,
    standaloneTestUnavailableReason,
    transientCardGraphContext,
  ]);

  const runStandaloneCardTest = useCallback(async () => {
    if (
      !selectedCard ||
      !canvasProjectId ||
      standaloneTestBusy ||
      standaloneTestUnavailableReason ||
      !standaloneTestPrompt.trim()
    ) {
      return;
    }
    await executeStandaloneInvocation(standaloneTestPrompt.trim());
  }, [
    executeStandaloneInvocation,
    selectedCard,
    standaloneTestBusy,
    standaloneTestPrompt,
    standaloneTestUnavailableReason,
  ]);

  const materializeStandaloneCard = useCallback(async () => {
    if (!selectedCard || !canvasProjectId || standaloneTestBusy || standaloneTestUnavailableReason) return;
    const input = standaloneTestPrompt.trim();
    if (!input) return;
    const correlationId = `card-invocation-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    standaloneTestRequestRef.current = correlationId;
    setStandaloneTestBusy(true);
    setStandaloneTestResult(null);
    try {
      const response = await fetch('/api/coder/mcp-bridge/run_configured_card', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'materialize',
          projectId: canvasProjectId,
          deckId: BUILDER_DECK_ID,
          cardId: selectedCard.id,
          correlationId,
          input,
          conversationId,
          dataAnchors: (transientCardGraphContext[selectedCard.id] || []).map((item) => ({
            authority: item.reference.authority,
            nativeId: item.reference.nativeId,
            reason: item.reference.reason,
            priority: -item.reference.order,
            boundedExpansion: item.reference.boundedExpansion,
            resultLimit: item.reference.resultLimit,
            required: item.reference.required,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      const result = payload?.result;
      if (!response.ok || !result?.invocation) {
        throw new Error(String(payload?.error || result?.error || `card_materialize_http_${response.status}`));
      }
      if (standaloneTestRequestRef.current === correlationId) {
        setStandaloneTestResult({
          status: String(result.status || 'previewed'),
          output: String(result.output || ''),
          error: result.error ? String(result.error) : null,
          toolCallCount: typeof result.toolCallCount === 'number' ? result.toolCallCount : null,
          tools: Array.isArray(result.invocation.idf?.enabledTools)
            ? result.invocation.idf.enabledTools.map(String)
            : [],
          provider: result.invocation.idf?.provider?.provider
            ? String(result.invocation.idf.provider.provider)
            : selectedCard.runtimeOptions?.provider || null,
          model: result.invocation.idf?.provider?.providerModelId
            ? String(result.invocation.idf.provider.providerModelId)
            : selectedCard.runtimeOptions?.modelKey || null,
          runtimeLabel: `${selectedCard.runtime.kind}/${selectedCard.runtime.mode}`,
          invocation: result.invocation,
        });
        setDeckStatusMessage(`${selectedCard.title} IDF previewed in memory. Nothing was persisted or executed.`);
      }
    } catch (error) {
      if (standaloneTestRequestRef.current === correlationId) {
        setStandaloneTestResult({
          status: 'failed', output: '', error: error instanceof Error ? error.message : String(error),
          toolCallCount: null, tools: [], provider: selectedCard.runtimeOptions?.provider || null,
          model: selectedCard.runtimeOptions?.modelKey || null,
          runtimeLabel: `${selectedCard.runtime.kind}/${selectedCard.runtime.mode}`,
        });
      }
    } finally {
      if (standaloneTestRequestRef.current === correlationId) {
        standaloneTestRequestRef.current = null;
        setStandaloneTestBusy(false);
      }
    }
  }, [canvasProjectId, conversationId, selectedCard, standaloneTestBusy, standaloneTestPrompt, standaloneTestUnavailableReason, transientCardGraphContext]);

  const builderTabs = useMemo(() => {
    if (selectedCard) return [...BUILDER_NODE_TABS];
    return [...BUILDER_PROJECT_TABS];
  }, [selectedCard]);
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

  const handleQuickAddAssistNode = useCallback(() => {
    if (!canonicalDeckReady) {
      setDeckStatusMessage('Wait for the canonical canvas to load before adding a Card.');
      return;
    }
    const { nextDeck, nextNode } = buildQuickAddAssistCard(deck);
    recordDeckWriteReason('deck-quick-add');
    setDeck(nextDeck);
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
      setTab('Invocation');
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
    (cardId: string | null) => {
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
          selectedNode.runtime.kind === 'autogen'
          && selectedNode.runtime.mode === 'magentic_one',
      );
      if (cardId) {
        setBuilderCanvasFocusRequest((current) => ({
          kind: isMagenticSelection ? 'deck' : 'card',
          cardId: isMagenticSelection ? null : cardId,
          nonce: (current?.nonce || 0) + 1,
        }));
        setSelectedEdgeId(null);
        setTab('Invocation');
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

  const openHermesKanban = useCallback(() => {
    const hermesCard = deck.nodes.find(isHermesStewardCard);
    if (!hermesCard) return;
    // Keep the chat panel on the left; the Kanban board renders in the canvas
    // region to its right, exactly like the Agent Canvas. The canvas pane stays
    // mounted beneath it (hidden), so closing Hermes restores the exact prior
    // viewport/selection. The installed Hermes terminal starts only from its
    // explicit button inside the Hermes workspace.
    priorWorkspaceViewRef.current =
      workspaceView === 'hermes' ? 'canvas' : workspaceView;
    setInspectorDrawerOpen(false);
    setWorldSignalInspectorSection(null);
    setWorkspaceView('hermes');
  }, [deck.nodes, workspaceView]);

  const closeHermesKanban = useCallback(() => {
    setWorkspaceView(priorWorkspaceViewRef.current);
  }, []);

  const handleSelectEdge = useCallback(
    (edgeId: string | null) => {
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

  const { handleSaveDeck } =
    useBuilderDeckPersistenceActions({
      builderDev: BUILDER_DEV,
      canvasProjectId,
      deck,
      deckId: BUILDER_DECK_ID,
      deckRevision,
      deckSaveAbortRef,
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
          Select a Project to open its Agent Builder configuration.
        </div>
      );
    }

    const renderEditorContent = () => {
      if (selectedCard && selectedCardConfig) {
        if (
          tab === 'Invocation' ||
          tab === 'Prompt' ||
          tab === 'Knowledge' ||
          tab === 'Capabilities' ||
          tab === 'Runtime'
        ) {
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
                    key={`deck-card:${selectedCard.id}:${tab}`}
                    cardId={selectedCard.id}
                    agentType="agent_builder"
                    activeTab={tab}
                    cardName={selectedCard.title}
                    cardSubtext={selectedCard.subtitle || ''}
                    onChangeCardName={handleRenameSelectedCard}
                    onChangeCardSubtext={handleUpdateSelectedCardSubtext}
                    localConfig={selectedCardConfig}
                    promptTestInput={standaloneTestPrompt}
                    onChangePromptTestInput={(value) => {
                      setStandaloneTestPrompt(value);
                      setStandaloneTestResult(null);
                    }}
                    onMaterializeCard={() => {
                      void materializeStandaloneCard();
                    }}
                    onRunCard={() => {
                      void runStandaloneCardTest();
                    }}
                    runBusy={standaloneTestBusy}
                    runDisabled={
                      !showStandaloneTestControls ||
                      !standaloneTestPrompt.trim() ||
                      (selectedCard.runtime.kind === 'autogen' &&
                        selectedCard.runtime.mode === 'magentic_one' &&
                        (
                          selectedMagOneWorkers.length === 0 ||
                          selectedMagOneWorkers.some((worker) => !worker.ready) ||
                          (transientCardGraphContext[selectedCard.id] || []).some(
                            (item) => item.reference.required && !item.ready,
                          )
                        ))
                    }
                    runResult={standaloneTestResult}
                    loadedGraphContext={transientCardGraphContext[selectedCard.id] || []}
                    magOneWorkers={selectedMagOneWorkers}
                    saveDeckStatusMessage={deckStatusMessage}
                    openDeckRevision={deckRevision}
                    onSaveLocalConfig={handleSaveSelectedCardConfig}
                    onGraphRefresh={() => {
                      // no-op
                    }}
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

  const inspectorDrawerRole = useMemo<'agent' | 'worldsignal' | null>(() => {
    if (workspaceView === 'canvas' && canonicalDeckReady && selectedCard) return 'agent';
    // The canonical Inspector also serves the WorldSignals companion surface —
    // same drawer, same renderer, section requested by the vendor controls.
    if (workspaceView === 'worldsignal' && worldSignalInspectorSection) return 'worldsignal';
    return null;
  }, [canonicalDeckReady, selectedCard, workspaceView, worldSignalInspectorSection]);
  const isInspectorDrawerVisible =
    inspectorDrawerRole === 'worldsignal'
      ? true
      : inspectorDrawerOpen && inspectorDrawerRole !== null;
  const inspectorDrawerDefaultWidth = AGENT_EDITOR_DEFAULT_WIDTH;
  const inspectorDrawerStorageKey = 'liquidaity.drawer.inspector.agent.v1.width';

  const closeInspectorDrawer = useCallback(() => {
    setInspectorDrawerOpen(false);
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
    // Normal chat is primary. The saved Coder Card's Hermes terminal remains
    // mounted beneath it so layout changes do not destroy the live session.
    const chat = (
      <div style={{ height: '100%', minHeight: 0 }}>
        <BuilderChat
          messages={messages}
          onSend={handleNativeSend}
          knowledgeProjectId={projectId}
          colors={C}
          busy={nativeSessionBusy}
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
              <CoderTerminalPanel
                open
                placement="docked"
                title="Coder"
                testIdPrefix="coder-console"
                projectId={typeof activeProject === 'string' ? activeProject : undefined}
                deckId={BUILDER_DECK_ID}
                conversationId={conversationId}
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
    const isHermesWorkspace = workspaceView === 'hermes';
    const canvasPane = canonicalDeckReady ? (
      <AgentCanvasPane
        surfaceRole={surfaceRole}
        shellStyle={getSurfaceShellStyle(compact)}
        document={deck}
        setDocument={setDeck}
        onPersistGraphMutation={recordDeckWriteReason}
        activeCardIds={[]}
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
          ? `Canonical canvas unavailable: ${deckLoadError}`
          : 'Loading canonical canvas…'}
      </div>
    );
    return (
      <div
        data-testid="workspace-canvas-surface"
        style={{ position: 'relative', height: '100%', minHeight: 0, overflow: 'hidden' }}
      >
        {/* Always keep the AgentCanvasPane mounted (hidden while Hermes is
            open) so closing Hermes restores the exact prior viewport/selection. */}
        <div
          aria-hidden={isHermesWorkspace ? true : undefined}
          style={{
            position: 'absolute',
            inset: 0,
            visibility: isHermesWorkspace ? 'hidden' : 'visible',
            pointerEvents: isHermesWorkspace ? 'none' : 'auto',
          }}
        >
          {canvasPane}
        </div>
        {isHermesWorkspace ? (
          <div
            data-testid="hermes-kanban-region"
            style={{ position: 'absolute', inset: 0 }}
          >
            <HermesKanbanWorkspace
              onClose={closeHermesKanban}
            />
          </div>
        ) : null}
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
            attentionErrors={graphAttention.errors}
            onExpandAttentionNode={(authority, node) => graphAttention.expandNode({
              authority,
              node,
              projectId: activeProject,
              codeGraphProject: codeGraphProjectName || null,
            })}
            onKindChange={setKnowledgeGraphKind}
          />
        </KnowledgeSurfaceErrorBoundary>
      </div>
    );
  };

  const showCanvasWorkspace = useCallback(() => {
    closeInspectorDrawer();
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

  const showKnowledgeWorkspace = useCallback(() => {
    closeInspectorDrawer();
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

  const showTradingWorkspace = useCallback(() => {
    closeInspectorDrawer();
    setWorkspaceView('trading');
  }, [closeInspectorDrawer]);

  const showWorldsignalWorkspace = useCallback(() => {
    closeInspectorDrawer();
    setWorkspaceView('worldsignal');
  }, [closeInspectorDrawer]);

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
      onQuickAddAssistNode={handleQuickAddAssistNode}
      onShowKnowledgeWorkspace={showKnowledgeWorkspace}
      onShowTradingWorkspace={showTradingWorkspace}
      onOpenNavigationDrawer={() => setOpenDrawer('navigation')}
      hermesKanbanActive={workspaceView === 'hermes'}
      onOpenHermesKanban={openHermesKanban}
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
      tradingSurface={<TradingUI symbol="RDW" />}
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
    inspectorDrawerRole !== null ? (
      <RightGlassDrawer
        isOpen={isInspectorDrawerVisible}
        title={
          inspectorDrawerRole === 'worldsignal'
            ? 'WorldSignals'
            : safeText(selectedCard?.title || 'Agent')
        }
        onClose={
          inspectorDrawerRole === 'worldsignal' ? closeWorldSignalInspector : closeInspectorDrawer
        }
        movable
        defaultWidth={inspectorDrawerDefaultWidth}
        minWidth={300}
        maxWidth={560}
        storageKey={
          inspectorDrawerRole === 'worldsignal'
            ? 'liquidaity.drawer.inspector.worldsignal.v1.width'
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
        {inspectorDrawerRole === 'worldsignal' && worldSignalInspectorSection ? (
          <WorldSignalsInspectorPanel
            section={worldSignalInspectorSection}
            bridge={worldSignalBridge}
            layerState={worldSignalLayerState}
          />
        ) : null}
        {inspectorDrawerRole === 'agent' && activeTabs.length > 0 ? (
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
