import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo, 
  useRef,
  useState,
} from 'react';

import type { AgentManagerLocalConfig } from '../components/AgentManager';
import BuilderChat from '../components/builder/BuilderChat';
import FrontendCrashBoundary from '../components/diagnostics/FrontendCrashBoundary';
import BuilderDrawer from '../components/builder/BuilderDrawer';
import WorldSignalSurface from '../components/worldsignal/WorldSignalSurface';
import AgentCanvasPane from '../features/agentbuilder/canvas/AgentCanvasPane';
import AgentBuilderCanvasRegion from '../features/agentbuilder/core/AgentBuilderCanvasRegion';
import AgentBuilderChatPane from '../features/agentbuilder/core/AgentBuilderChatPane';
import AgentBuilderRail from '../features/agentbuilder/core/AgentBuilderRail';
import AgentBuilderShell from '../features/agentbuilder/core/AgentBuilderShell';
import AgentBuilderSplitter from '../features/agentbuilder/core/AgentBuilderSplitter';
import AgentBuilderWorkspace from '../features/agentbuilder/core/AgentBuilderWorkspace';
import CompanionSurfaceHost from '../features/agentbuilder/core/CompanionSurfaceHost';
import OpenClaudeConsolePanel from '../features/agentbuilder/console/OpenClaudeConsolePanel';
import HarnessChatPanel from '../features/agentbuilder/console/HarnessChatPanel';
import HermesConsole, {
  EMPTY_HERMES_TERMINAL_STATE,
  reduceHermesTerminalEvent,
  type HermesTerminalState,
} from '../components/hermes/HermesConsole';
import {
  SessionStreamError,
  streamSession,
  loadSessionHistory,
  listSessionConversations,
  type SessionConversation,
} from '../features/agentbuilder/console/openClaudeSessionClient';
import useAgentBuilderAutosave from '../features/agentbuilder/state/useAgentBuilderAutosave';
import useAgentBuilderDeck from '../features/agentbuilder/state/useAgentBuilderDeck';
import useAgentBuilderDeckLoad from '../features/agentbuilder/state/useAgentBuilderDeckLoad';
import useAgentBuilderProject from '../features/agentbuilder/state/useAgentBuilderProject';
import useAgentBuilderProjectReset from '../features/agentbuilder/state/useAgentBuilderProjectReset';
import useAgentBuilderSelection from '../features/agentbuilder/state/useAgentBuilderSelection';
import useAgentBuilderThinkGraphProjection from '../features/agentbuilder/state/useAgentBuilderThinkGraphProjection';
import useAgentBuilderKnowGraphProjection from '../features/agentbuilder/state/useAgentBuilderKnowGraphProjection';
import useAgentBuilderHermesReport from '../features/agentbuilder/state/useAgentBuilderHermesReport';
import useAgentBuilderCoderAuditView from '../features/agentbuilder/state/useAgentBuilderCoderAuditView';
import TradingCanvasSurface from '../features/trading/TradingCanvasSurface';
import type { LinkRef } from '../components/builder/deckContinuityTypes';
import { resolveDeckWorkspaceRoot } from '../features/agentbuilder/state/deckWorkspaceRoot';
import { buildExecutionPlan } from '../components/builder/deckExecution';
import DeckExecutionPathSummary from '../components/builder/DeckExecutionPathSummary';
import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
  graphDrawerSectionStyle,
  graphGlassPillStyle,
} from '../components/graph/graphVisualTokens';
import RightGlassDrawer from '../components/graph/RightGlassDrawer';
// Decomposed Agent Builder modules (2026-07-08): the page is composition only;
// deck primitives/seed/document logic and rail derivation live in the feature.
import {
  cleanOptionalText,
  cloneDeckDocument,
  DEFAULT_WORKSPACE_ROOT,
  normalizeDeckEdgeType,
  normalizeRuntimeBinding,
  normalizeRuntimeOptions,
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
  filterAuthoringCompatibleEdges,
  formatBuilderStatusMessage,
  hydrateDeckDocument,
  resolveLocalCoderControllerConsoleConfig,
  resolveProjectDeckLoadResult,
} from '../features/agentbuilder/deck/deckDocument';
import {
  deriveVisibleRailItems,
  isHermesConnectedToMainChat,
  resolveWorkbenchDescriptor,
} from '../features/agentbuilder/rail/railVisibility';
import {
  BuilderRailMoonOrb,
  synodicPhaseFromDate,
} from '../features/agentbuilder/core/BuilderRailMoonOrb';
import { resolveEffectiveAgent } from '../components/builder/deckRuntime';
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
  AgentTemplate,
  DeckEdge,
  DeckDocument,
  KnowledgeGraphKind,
  DeckWorkspaceContext,
  WorkspaceObjectContext,
} from '../types/agentgraph';
import type { CodeGraphViewContract } from '../components/codegraph/types';
import {
  createWorkspaceTestingInteractionId,
  recordWorkspaceTestingEvent,
  type WorkspaceTestingEventInput,
  type WorkspaceTestingObjectType,
  type WorkspaceTestingSurface,
} from '../lib/workspaceTestingTelemetry';

const AgentManager = lazy(async () => {
  const mod = await import('../components/AgentManager');
  return { default: mod.AgentManager };
});
const KnowledgeGraphFramework = lazy(
  () => import('../components/knowledge/KnowledgeGraphFramework'),
);
const UnifiedGraphSurface = lazy(
  () => import('../components/knowledge/UnifiedGraphSurface'),
);
// CodeGraph renders through its OWN CBM-backed surface (CodeGraphSurface → /api/layout → CBM →
// CodeGraphScene), never the generic shared graph shell. Restored to its pre-b32e5cdd direct mount.
const CodeGraphSurface = lazy(() =>
  import('../components/codegraph/CodeGraphSurface').then((mod) => ({ default: mod.CodeGraphSurface })),
);
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
const AGENTS_CHAT_MIN_WIDTH = 280;
const AGENTS_CANVAS_MIN_WIDTH = 520;
const WORKSPACE_COMPANION_MIN_WIDTH = 360;
const WORKSPACE_COLLAPSE_EDGE_PX = 28;
const AGENT_EDITOR_DEFAULT_WIDTH = 344;
// Hermes owns one project-intelligence canvas. Its three tabs are authorities,
// not agent-card capabilities: card/bus wiring must never hide project
// reasoning, external evidence, or repository reality from that canvas.
type KnowledgeSurfaceKind = KnowledgeGraphKind | 'unified';
const HERMES_GRAPH_AUTHORITIES: readonly KnowledgeSurfaceKind[] = [
  'unified',
  'thinkgraph',
  'knowgraph',
  'codegraph',
];
type WorkspaceTestingEventDraft = Omit<
  WorkspaceTestingEventInput,
  'projectId'
> & {
  projectId?: string | null;
};

function normalizeWorkspaceSurface(
  value: string,
): WorkspaceTestingSurface | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (
    normalized === 'chat' ||
    normalized === 'canvas' ||
    normalized === 'knowledge' ||
    normalized === 'codegraph' ||
    normalized === 'worldsignal' ||
    normalized === 'trading'
  ) {
    return normalized as WorkspaceTestingSurface;
  }
  return null;
}

// ---- utils ----
function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}


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
const EMPTY_PROJECT_STATE = {
  messages: [] as { role: 'assistant' | 'user'; text: string }[],
  links: [] as LinkRef[],
};

function resolveAgentTemplate(
  card: AgentCardInstance | null,
  templates: AgentTemplate[],
): AgentTemplate | null {
  if (!card) return null;
  return templates.find((template) => template.id === card.templateId) || null;
}

function sameStringArray(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameObjectShape(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined,
): boolean {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function compactAgentOverrides(
  overrides: Partial<AgentTemplate>,
): Partial<AgentTemplate> | undefined {
  const filtered = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<AgentTemplate>;
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

// helper: load all project-local state (defaults only; real data is fetched from backend)
function loadProjectState() {
  return {
    messages: [...EMPTY_PROJECT_STATE.messages],
    links: [...EMPTY_PROJECT_STATE.links],
  };
}

// helper: convert AGE query results to graph nodes/edges for visualization
/** Mean synodic month in days (NASA/USNO convention). */
export default function AgentBuilder(): React.ReactElement {
  const BUILDER_DEV = import.meta.env.DEV;
  const largeSurface = 'chat' as const;
  const [nativeSessionBusy, setNativeSessionBusy] = useState(false);
  const [hermesTerminal, setHermesTerminal] = useState<HermesTerminalState>(
    EMPTY_HERMES_TERMINAL_STATE,
  );
  const [workspaceView, setWorkspaceView] = useState<
    | 'chat'
    | 'canvas'
    | 'knowledge'
    | 'codegraph'
    | 'trading'
    | 'code'
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
  const [chatPanelWidth, setChatPanelWidth] = useState(420);
  const [chatResizeHandleActive, setChatResizeHandleActive] = useState(false);
  const [chatResizeDragging, setChatResizeDragging] = useState(false);
  const workspaceShellRef = useRef<HTMLDivElement | null>(null);
  const chatResizeSessionRef = useRef<{
    startX: number;
    startWidth: number;
    pendingWidth: number;
    reservedWidth: number;
  } | null>(null);
  const chatResizeFrameRef = useRef<number | null>(null);
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
  const [openClaudeConsoleOpen, setOpenClaudeConsoleOpen] = useState(false);
  const localCoderConsoleConfig = useMemo(
    () => resolveLocalCoderControllerConsoleConfig(deck),
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
  const hermesConnectedToMainChat = useMemo(
    () => isHermesConnectedToMainChat(deck.nodes, deck.edges),
    [deck],
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
  const workspacePanelAlreadyOpen = Boolean(
    objectDrawerOpen && selectedCardId,
  );
  const [deckRunInput, setDeckRunInput] = useState('');
  const [showCreateProjectForm, setShowCreateProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [knowledgeGraphKind, setKnowledgeGraphKind] =
    useState<KnowledgeSurfaceKind>('unified');
  const [conversationId, setConversationId] = useState('main');
  const [conversations, setConversations] = useState<SessionConversation[]>([]);
  const [thinkGraphFocusIds, setThinkGraphFocusIds] = useState<string[]>([]);
  const [focusedGraphNodeId, setFocusedGraphNodeId] = useState<string | null>(null);
  const [focusedCodeGraphRef, setFocusedCodeGraphRef] = useState<string | null>(null);
  const thinkGraphProjection = useAgentBuilderThinkGraphProjection({
    activeProject,
    knowledgeGraphKind,
    workspaceView,
  });
  const knowGraphProjection = useAgentBuilderKnowGraphProjection({
    activeProject,
    knowledgeGraphKind,
    workspaceView,
  });
  const hermesReport = useAgentBuilderHermesReport({
    projectId: activeProject,
    conversationId,
    workspaceView,
  });
  const coderAuditView = useAgentBuilderCoderAuditView({
    projectId: activeProject,
    conversationId,
  });

  const [graphViewContract, setGraphViewContract] =
    useState<CodeGraphViewContract | null>(null);
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
  // Focus the existing CodeGraphSurface on a completed read-only audit's filtered
  // view. Applied once per audit run; stale/wrong-project views are ignored. The
  // view is focus/filter only — canonical CodeGraph facts are never rewritten.
  const appliedAuditRunRef = useRef<string | null>(null);
  useEffect(() => {
    const view = coderAuditView.view;
    if (!view || view.projectId !== activeProject) return;
    if (appliedAuditRunRef.current === view.childRunId) return;
    appliedAuditRunRef.current = view.childRunId;
    setGraphViewContract((prev) => ({
      projectId: codeGraphProjectName || prev?.projectId || null,
      nodeLabelAllowlist: view.viewContract.nodeLabelAllowlist ?? prev?.nodeLabelAllowlist,
      edgeTypeAllowlist: view.viewContract.edgeTypeAllowlist ?? prev?.edgeTypeAllowlist,
      showLabels:
        typeof view.viewContract.showLabels === 'boolean'
          ? view.viewContract.showLabels
          : (prev?.showLabels ?? true),
      maxNodes: view.viewContract.maxNodes ?? prev?.maxNodes,
      focusPaths: view.viewContract.focusPaths ?? prev?.focusPaths,
      focusSymbols: view.viewContract.focusSymbols ?? prev?.focusSymbols,
    }));
  }, [coderAuditView.view, activeProject, codeGraphProjectName]);
  // chat state must be declared before callbacks/effects that write to it.
  const [messages, setMessages] = useState<
    { role: 'assistant' | 'user'; text: string }[]
  >(() => loadProjectState().messages);
  const [stateLoaded, setStateLoaded] = useState(false);

  // Restore the durable project-scoped Harness transcript on open / project
  // switch, so a reload shows the selected named conversation. This load is read-only and
  // best-effort: a fresh project or a read failure leaves chat empty, never
  // errors. A late response for a project the user already switched away from is
  // discarded (guarded by the captured projectId).
  useEffect(() => {
    const pid = canvasProjectId;
    if (!pid) {
      setMessages([]);
      setHermesTerminal(EMPTY_HERMES_TERMINAL_STATE);
      return;
    }
    setHermesTerminal(EMPTY_HERMES_TERMINAL_STATE);
    const ctrl = new AbortController();
    let cancelled = false;
    void listSessionConversations({ projectId: pid, signal: ctrl.signal })
      .then((items) => {
        if (cancelled) return;
        setConversations(items);
        if (items.length > 0 && !items.some((item) => item.conversationId === conversationId)) {
          setConversationId(items[0].conversationId);
        }
      })
      .catch(() => {
        /* named-conversation navigation is best-effort */
      });
    void loadSessionHistory({ projectId: pid, conversationId, signal: ctrl.signal })
      .then((history) => {
        if (cancelled) return;
        setMessages(history);
      })
      .catch(() => {
        /* best-effort; chat opens regardless */
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [canvasProjectId, conversationId]);

  const lastCompanionSurfaceTelemetryRef = useRef<string | null>(null);
  const pendingPanelOpenTelemetryRef = useRef<{
    objectType: WorkspaceTestingObjectType;
    objectId: string;
    graphType: 'agent' | 'knowledge';
    interactionId: string;
    startedAt: number;
  } | null>(null);

  const emitWorkspaceTestingEvent = useCallback(
    (payload: WorkspaceTestingEventDraft) => {
      const metadata = {
        activeProjectId: activeProject || null,
        ...(payload.metadata || {}),
      };
      recordWorkspaceTestingEvent({
        ...payload,
        projectId:
          payload.projectId ?? cleanOptionalText(activeProject) ?? null,
        metadata,
      });
    },
    [activeProject],
  );

  const queueWorkspacePanelTelemetry = useCallback(
    (
      graphType: 'agent' | 'knowledge',
      objectType: WorkspaceTestingObjectType,
      objectId: string,
      interactionId: string,
    ) => {
      const startedAt = Date.now();
      if (workspacePanelAlreadyOpen) {
        emitWorkspaceTestingEvent({
          event: 'workspace_panel_opened_from_graph_selection',
          objectType,
          objectId,
          interactionId,
          durationMs: 0,
          metadata: { graphType, panelAlreadyOpen: true },
        });
        pendingPanelOpenTelemetryRef.current = null;
        return;
      }
      pendingPanelOpenTelemetryRef.current = {
        objectType,
        objectId,
        graphType,
        interactionId,
        startedAt,
      };
    },
    [emitWorkspaceTestingEvent, workspacePanelAlreadyOpen],
  );

  useEffect(() => {
    emitWorkspaceTestingEvent({
      event: 'surface_opened',
      surface: largeSurface,
      surfaceRole: 'large',
      metadata: { workspaceView },
    });
  }, [emitWorkspaceTestingEvent, largeSurface, workspaceView]);

  useEffect(() => {
    if (workspaceView === 'canvas') {
      lastCompanionSurfaceTelemetryRef.current = null;
      return;
    }
    const companionSurface = normalizeWorkspaceSurface(workspaceView);
    if (!companionSurface) {
      lastCompanionSurfaceTelemetryRef.current = null;
      return;
    }
    const nextKey = `${workspaceView}:${companionSurface}`;
    if (lastCompanionSurfaceTelemetryRef.current === nextKey) return;
    emitWorkspaceTestingEvent({
      event: 'surface_opened',
      surface: companionSurface,
      surfaceRole: 'companion',
      metadata: { workspaceView },
    });
    lastCompanionSurfaceTelemetryRef.current = nextKey;
  }, [emitWorkspaceTestingEvent, workspaceView]);

  useEffect(() => {
    const pending = pendingPanelOpenTelemetryRef.current;
    if (!workspacePanelAlreadyOpen || !pending) return;
    emitWorkspaceTestingEvent({
      event: 'workspace_panel_opened_from_graph_selection',
      objectType: pending.objectType,
      objectId: pending.objectId,
      interactionId: pending.interactionId,
      durationMs: Math.max(0, Date.now() - pending.startedAt),
      metadata: { graphType: pending.graphType, panelAlreadyOpen: false },
    });
    pendingPanelOpenTelemetryRef.current = null;
  }, [emitWorkspaceTestingEvent, workspacePanelAlreadyOpen]);

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
  const loggedProjectRef = useRef<string | null>(null);
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
    emptyProjectState: EMPTY_PROJECT_STATE,
    buildProjectlessDeckDocument,
    resolveProjectDeckLoadResult,
    loadProjectState,
    formatBuilderStatusMessage,
    recordDeckWriteReason,
    snapshotDeckBoard,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    emitWorkspaceTestingEvent: emitWorkspaceTestingEvent as any,
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
  const selectedCard = useMemo(
    () => deck.nodes.find((node) => node.id === selectedCardId) || null,
    [deck.nodes, selectedCardId],
  );
  const selectedWorkbenchDescriptor = useMemo(
    () => resolveWorkbenchDescriptor(selectedCard),
    [selectedCard],
  );
  const selectedTemplate = useMemo(
    () => resolveAgentTemplate(selectedCard, INITIAL_AGENT_TEMPLATES),
    [selectedCard],
  );
  const effectiveAgent = useMemo(
    () =>
      selectedCard
        ? resolveEffectiveAgent(selectedCard, INITIAL_AGENT_TEMPLATES)
        : null,
    [selectedCard],
  );
  const builderTabs = useMemo(() => {
    if (selectedCard) return [...BUILDER_NODE_TABS];
    return [...BUILDER_PROJECT_TABS];
  }, [selectedCard]);
  const activeTabs = useMemo(() => {
    if (workspaceView === 'canvas') return builderTabs;
    return [];
  }, [builderTabs, workspaceView]);
  const selectedCardConfig = useMemo<AgentManagerLocalConfig | null>(() => {
    if (!effectiveAgent || !selectedCard) return null;
    return {
      runtime_binding: selectedCard.runtimeBinding ?? null,
      runtime_type: selectedCard.runtimeType ?? 'assistant_agent',
      runtime_options: selectedCard.runtimeOptions ?? null,
      parent_graph_id: selectedCard.parentGraphId ?? null,
      provider:
        effectiveAgent.provider === 'openai' ||
        effectiveAgent.provider === 'openrouter' ||
        effectiveAgent.provider === 'local_openai_compatible'
          ? effectiveAgent.provider
          : '',
      model_key: effectiveAgent.model || null,
      temperature: effectiveAgent.temperature ?? null,
      max_tokens: effectiveAgent.maxTokens ?? null,
      prompt_template: selectedCard.prompt || '',
      tools: effectiveAgent.tools,
      knowledge_sources: effectiveAgent.knowledgeSources || [],
      response_format: effectiveAgent.ioSchema
        ? {
            type: 'json_schema',
            name: 'card_schema',
            schema: effectiveAgent.ioSchema,
          }
      : null,
    };
  }, [effectiveAgent, selectedCard]);
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
  const deckValidation = useMemo(
    () => validateDeckDocument(deck, { enforceStartCard: true }),
    [deck],
  );
  const deckExecutionPlan = useMemo(() => buildExecutionPlan(deck), [deck]);

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
      if (!cardId) {
        pendingPanelOpenTelemetryRef.current = null;
      } else {
        const interactionId = createWorkspaceTestingInteractionId('agent-node');
        emitWorkspaceTestingEvent({
          event: 'agent_graph_node_selected',
          objectType: 'agent_node',
          objectId: cardId,
          interactionId,
          metadata: { workspaceView: 'canvas' },
        });
        queueWorkspacePanelTelemetry(
          'agent',
          'agent_node',
          cardId,
          interactionId,
        );
      }
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
    [
      deck.nodes,
      emitWorkspaceTestingEvent,
      queueWorkspacePanelTelemetry,
      recordUiOnlyAction,
      tab,
    ],
  );

  const handleSelectEdge = useCallback(
    (edgeId: string | null) => {
      recordUiOnlyAction('edge-selection');
      if (edgeId) {
        const interactionId = createWorkspaceTestingInteractionId('agent-edge');
        emitWorkspaceTestingEvent({
          event: 'agent_graph_edge_selected',
          objectType: 'agent_edge',
          objectId: edgeId,
          interactionId,
          metadata: { workspaceView: 'canvas' },
        });
      }
      pendingPanelOpenTelemetryRef.current = null;
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
    [emitWorkspaceTestingEvent, recordUiOnlyAction],
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
      deckExecutionPlan,
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

  const handleSaveSelectedCardConfig = useCallback(
    (nextConfig: AgentManagerLocalConfig) => {
      if (!selectedCard || !selectedTemplate) return;

      setLatestCardRun(null);
      setLatestDeckRun(null);
      recordDeckWriteReason('card-editor');
      setDeck((currentDeck) => {
        const nextRuntimeBinding = normalizeRuntimeBinding(
          nextConfig.runtime_binding,
        );
        const nextRuntimeType =
          normalizeRuntimeType(nextConfig.runtime_type) ??
          normalizeRuntimeType(selectedCard.runtimeType) ??
          'assistant_agent';
        const nextParentGraphId = cleanOptionalText(nextConfig.parent_graph_id);
        const nextProvider =
          nextConfig.provider === 'openai' ||
          nextConfig.provider === 'openrouter' ||
          nextConfig.provider === 'local_openai_compatible'
            ? nextConfig.provider
            : null;
        const nextModel = String(nextConfig.model_key || '').trim() || null;
        const nextTemperature =
          typeof nextConfig.temperature === 'number'
            ? nextConfig.temperature
            : null;
        const nextMaxTokens =
          typeof nextConfig.max_tokens === 'number'
            ? nextConfig.max_tokens
            : null;
        const nextTools = Array.isArray(nextConfig.tools)
          ? nextConfig.tools
              .filter((tool): tool is string => typeof tool === 'string')
              .map((tool) => tool.trim())
              .filter(Boolean)
          : [];
        const nextRuntimeOptions = normalizeRuntimeOptions({
          ...(nextConfig.runtime_options || {}),
          tools: nextTools,
        });
        const nextKnowledgeSources = Array.isArray(nextConfig.knowledge_sources)
          ? nextConfig.knowledge_sources
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [];
        const nextIoSchema =
          nextConfig.response_format?.type === 'json_schema' &&
          nextConfig.response_format?.schema &&
          typeof nextConfig.response_format.schema === 'object'
            ? (nextConfig.response_format.schema as Record<string, unknown>)
            : null;

        const nextOverrides = compactAgentOverrides({
          provider:
            nextProvider !== (selectedTemplate.provider ?? null)
              ? nextProvider
              : undefined,
          model:
            nextModel !== (selectedTemplate.model ?? null)
              ? nextModel
              : undefined,
          temperature:
            nextTemperature !== (selectedTemplate.temperature ?? null)
              ? nextTemperature
              : undefined,
          maxTokens:
            nextMaxTokens !== (selectedTemplate.maxTokens ?? null)
              ? nextMaxTokens
              : undefined,
          knowledgeSources: !sameStringArray(
            nextKnowledgeSources,
            selectedTemplate.knowledgeSources,
          )
            ? nextKnowledgeSources
            : undefined,
          ioSchema: !sameObjectShape(nextIoSchema, selectedTemplate.ioSchema)
            ? nextIoSchema || undefined
            : undefined,
        });

        const nextNodes = currentDeck.nodes.map((node) =>
          node.id === selectedCard.id
            ? {
                ...node,
                prompt: String(nextConfig.prompt_template || ''),
                runtimeBinding: nextRuntimeBinding,
                runtimeType: nextRuntimeType,
                runtimeOptions: nextRuntimeOptions,
                parentGraphId: nextParentGraphId,
                overrides: nextOverrides,
              }
            : node,
        );

        return {
          ...currentDeck,
          version: currentDeck.version + 1,
          nodes: nextNodes,
          edges: filterAuthoringCompatibleEdges(nextNodes, currentDeck.edges),
        };
      });
    },
    [recordDeckWriteReason, selectedCard, selectedTemplate],
  );

  const handleRenameSelectedCard = useCallback(
    (nextName: string) => {
      if (!selectedCard) return;

      setLatestCardRun(null);
      setLatestDeckRun(null);
      recordDeckWriteReason('card-rename');
      setDeck((currentDeck) => ({
        ...currentDeck,
        version: currentDeck.version + 1,
        nodes: currentDeck.nodes.map((node) =>
          node.id === selectedCard.id
            ? {
                ...node,
                title: nextName,
              }
            : node,
        ),
      }));
    },
    [recordDeckWriteReason, selectedCard],
  );

  const handleUpdateSelectedCardSubtext = useCallback(
    (nextSubtext: string) => {
      if (!selectedCard) return;

      setLatestCardRun(null);
      setLatestDeckRun(null);
      recordDeckWriteReason('card-subtitle-update');
      setDeck((currentDeck) => ({
        ...currentDeck,
        version: currentDeck.version + 1,
        nodes: currentDeck.nodes.map((node) =>
          node.id === selectedCard.id
            ? {
                ...node,
                subtitle: nextSubtext.length > 0 ? nextSubtext : undefined,
              }
            : node,
        ),
      }));
    },
    [recordDeckWriteReason, selectedCard],
  );



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
              {selectedWorkbenchDescriptor ? (
                <div
                  style={graphDrawerSectionStyle({
                    padding: '10px 12px',
                    marginBottom: 10,
                    color: GRAPH_THEME.drawer.inputMuted,
                  })}
                >
                  <div style={{ marginBottom: 8 }}>
                    {selectedWorkbenchDescriptor.disabledCopy}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      showWorkbenchWorkspace(selectedWorkbenchDescriptor.id)
                    }
                    style={graphDrawerButtonStyle({})}
                  >
                    {selectedWorkbenchDescriptor.openLabel}
                  </button>
                </div>
              ) : null}
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
                  projectId={canvasProjectId || 'deck-card'}
                  deckId={BUILDER_DECK_ID}
                  agentType="agent_builder"
                  activeTab={tab}
                  selectedCardId={selectedCard.id}
                  promptTestInput={deckRunInput}
                  onChangePromptTestInput={setDeckRunInput}
                  onRunPromptTest={handleRunSelectedCard}
                  promptTestBusy={cardRunBusy}
                  promptTestDisabled={
                    Boolean(selectedWorkbenchDescriptor) ||
                    cardRunBusy ||
                    deckLoadBusy ||
                    !canvasProjectId
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
            <DeckExecutionPathSummary
              deck={deck}
              executionPlan={deckExecutionPlan}
              colors={C}
            />
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

  useEffect(() => {
    if (activeProject && loggedProjectRef.current !== activeProject) {
      console.log('[AgentBuilder] selected projectId=%s', activeProject);
      loggedProjectRef.current = activeProject;
    }
  }, [activeProject]);

  const objectDrawerRole = useMemo<'agent' | null>(() => {
    if (workspaceView === 'canvas' && selectedCard) return 'agent';
    return null;
  }, [selectedCard, workspaceView]);
  const isObjectDrawerVisible = objectDrawerOpen && objectDrawerRole !== null;
  const objectDrawerDefaultWidth = AGENT_EDITOR_DEFAULT_WIDTH;
  const objectDrawerStorageKey = 'liquidaity.drawer.object.agent.v2.width';

  const closeObjectDrawer = useCallback(() => {
    setObjectDrawerOpen(false);
    pendingPanelOpenTelemetryRef.current = null;
    setSelectedCardId(null);
    setSelectedEdgeId(null);
    setBuilderCanvasFocusRequest((current) => ({
      kind: 'deck',
      cardId: null,
      nonce: (current?.nonce || 0) + 1,
    }));
  }, []);

  const handleCreateProject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const name = newProjectName.trim();
    if (!name) return;

    const code = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const projectType = 'assist';

    try {
      const res = await fetch(PROJECTS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code,
          project_type: projectType,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => null);
      const newId =
        (data?.project && typeof data.project === 'object' && String(data.project.id || '').trim()) ||
        String(data?.id || '').trim();

      setShowCreateProjectForm(false);
      setNewProjectName('');

      await refreshProjects('after-create', newId);

      if (newId) {
        setActiveProjectWithUrl(newId);
      }
    } catch (err: any) {
      console.error('Create project failed', err);
      setProjectsError(
        `Failed to create project: ${err?.message || 'Unknown error'}`,
      );
    }
  };

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

  const clampAgentsChatWidth = useCallback(
    (nextWidth: number, reservedWidth: number) => {
      const shellWidth = workspaceShellRef.current?.clientWidth ?? 0;
      if (shellWidth <= 0) return Math.max(AGENTS_CHAT_MIN_WIDTH, nextWidth);
      const maxWidth = Math.max(
        AGENTS_CHAT_MIN_WIDTH,
        shellWidth - reservedWidth,
      );
      return clamp(nextWidth, AGENTS_CHAT_MIN_WIDTH, maxWidth);
    },
    [],
  );

  const resolveAgentsChatMaxWidth = useCallback(
    (reservedWidth: number) => {
      const shellWidth = workspaceShellRef.current?.clientWidth ?? 0;
      if (shellWidth <= 0) return AGENTS_CHAT_MIN_WIDTH;
      return Math.max(AGENTS_CHAT_MIN_WIDTH, shellWidth - reservedWidth);
    },
    [],
  );

  const finishChatResize = useCallback(
    (mode: 'commit' | 'cancel') => {
      const session = chatResizeSessionRef.current;
      if (!session) return;
      chatResizeSessionRef.current = null;
      setChatResizeDragging(false);
      setChatResizeHandleActive(false);
      if (chatResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(chatResizeFrameRef.current);
        chatResizeFrameRef.current = null;
      }
      if (mode === 'cancel') {
        setChatPanelWidth(session.startWidth);
        return;
      }
      setChatPanelWidth(session.pendingWidth);
      const maxWidth = resolveAgentsChatMaxWidth(session.reservedWidth);
      if (session.pendingWidth >= maxWidth - WORKSPACE_COLLAPSE_EDGE_PX) {
        setWorkspaceView('chat');
      }
    },
    [resolveAgentsChatMaxWidth],
  );

  useEffect(() => {
    if (!chatResizeDragging) return;
    const handleMouseMove = (event: MouseEvent) => {
      const session = chatResizeSessionRef.current;
      if (!session) return;
      const delta = event.clientX - session.startX;
      session.pendingWidth = clampAgentsChatWidth(
        session.startWidth + delta,
        session.reservedWidth,
      );
      if (chatResizeFrameRef.current !== null) return;
      chatResizeFrameRef.current = window.requestAnimationFrame(() => {
        chatResizeFrameRef.current = null;
        const activeSession = chatResizeSessionRef.current;
        if (!activeSession) return;
        setChatPanelWidth(activeSession.pendingWidth);
      });
    };
    const handleMouseUp = () => finishChatResize('commit');
    const handleWindowBlur = () => finishChatResize('commit');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finishChatResize('cancel');
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [chatResizeDragging, clampAgentsChatWidth, finishChatResize]);

  useEffect(() => {
    return () => {
      if (chatResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(chatResizeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const reservedWidth =
      workspaceView === 'canvas'
        ? AGENTS_CANVAS_MIN_WIDTH
        : WORKSPACE_COMPANION_MIN_WIDTH;
    const syncAgentsWidths = () => {
      setChatPanelWidth((current) =>
        clampAgentsChatWidth(current, reservedWidth),
      );
    };
    syncAgentsWidths();
    window.addEventListener('resize', syncAgentsWidths);
    return () => window.removeEventListener('resize', syncAgentsWidths);
  }, [clampAgentsChatWidth, workspaceView]);

  // Native persistent OpenClaude chat: send goes to the gRPC QueryEngine SSE
  // bridge (NOT the Python deck-run). Upper chat stays compact (user message +
  // final done.full_text); raw events go to the lower OpenClaude session stream.
  const handleNativeSend = useCallback(
    (t: string) => {
      const trimmed = t.trim();
      if (!trimmed) return;
      if (!canvasProjectId) {
        setMessages((m) => [...m, { role: 'assistant', text: 'Select or create a project before chatting.' }]);
        return;
      }
      if (nativeSessionBusy) return;
      // Only the REAL user message is added on send. No empty assistant placeholder —
      // the assistant bubble is created lazily on the FIRST real text token (below),
      // never before. If the model emits no text, no assistant bubble is created.
      setMessages((m) => [...m, { role: 'user', text: trimmed }]);
      setNativeSessionBusy(true);
      // Append real model text into the single assistant bubble for this turn,
      // creating that bubble on the first non-empty chunk (never an empty bubble).
      let assistantStarted = false;
      const appendAssistantText = (chunk: string) => {
        if (!chunk) return;
        assistantStarted = true;
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { role: 'assistant', text: last.text + chunk };
          } else {
            copy.push({ role: 'assistant', text: chunk });
          }
          return copy;
        });
      };
      void streamSession({
        projectId: canvasProjectId,
        conversationId,
        message: trimmed,
        // Agent Builder canvas surface (the hex+ view) = canvas mode: every
        // eligible saved card is a direct Single Assist doorway. Normal project
        // chat = chat mode: only the ThinkGraph doorway. Explicit surface state,
        // never inferred from message content.
        mode: workspaceView === 'canvas' ? 'canvas' : 'chat',
        ...(thinkGraphFocusIds.length > 0 && trimmed.length <= 2_000
          ? {
              investigationContext: {
                focusNodeIds: thinkGraphFocusIds,
                requestedOutcome: trimmed,
              },
            }
          : {}),
        onEvent: (event) => {
          setHermesTerminal((current) => reduceHermesTerminalEvent(current, event));
          if (event.kind === 'text') {
            // Real model text streams into the chat — creates the assistant bubble on
            // the first token, appends to it afterward. Nothing renders before this.
            appendAssistantText(String((event as { text?: unknown }).text || ''));
            return;
          }
        },
      })
        .then(({ finalText }) => {
          setNativeSessionBusy(false);
          const completedText = finalText.trim();
          if (!assistantStarted && completedText) {
            appendAssistantText(completedText);
          } else if (!assistantStarted) {
            appendAssistantText('The chat completed without an assistant response. Please try again.');
          }
        })
        .catch((error: unknown) => {
          setNativeSessionBusy(false);
          setHermesTerminal((current) => reduceHermesTerminalEvent(current, {
            kind: 'error',
            message: error instanceof Error ? error.message : 'Hermes stream cancelled.',
          }));
          if (error instanceof SessionStreamError) {
            const correlation = error.correlationId ? ` Correlation: ${error.correlationId}.` : '';
            appendAssistantText(`Chat failed (${error.code}).${correlation}`);
            return;
          }
          appendAssistantText('Chat request failed before the stream opened. Route: /api/coder/openclaude/session/chat.');
        });
    },
    [canvasProjectId, conversationId, nativeSessionBusy, thinkGraphFocusIds, workspaceView],
  );

  const renderChatSurface = (
    projectId: string,
    compact = false,
    surfaceRole: 'large' | 'companion' = compact ? 'companion' : 'large',
  ) => {
    // Normal chat is the primary interaction surface: BuilderChat speaking to the
    // persistent Harness session, with compact real per-turn work shown inline
    // beneath the active assistant message (HarnessWork). The primary (non-compact)
    // surface keeps a near-invisible pull-tab that reveals the active native
    // Hermes child stream beneath chat; the Code Console remains separate.
    const chat = (
      <div style={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 0' }}>
          <span style={{ color: C.textMuted, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>Conversation</span>
          <select
            aria-label="Selected conversation"
            value={conversationId}
            onChange={(event) => setConversationId(event.target.value)}
            style={graphDrawerInputStyle({ minWidth: 150, height: 28, padding: '0 8px', fontSize: 11 })}
          >
            {conversations.length === 0 ? <option value={conversationId}>{conversationId}</option> : null}
            {conversations.map((conversation) => (
              <option key={conversation.conversationId} value={conversation.conversationId}>
                {conversation.title}
              </option>
            ))}
          </select>
        </div>
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
            hermes={<HermesConsole terminal={hermesTerminal} />}
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
        executionPlan={deckExecutionPlan}
        activeCardIds={runtimeVisualState.activeCardIds}
        activeEdgeIds={runtimeVisualState.activeEdgeIds}
        swarmProgressByCardId={runtimeVisualState.swarmProgressByCardId}
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

  const KnowledgeGraphSurface = ({
    minHeight = 280,
    surfaceRole = minHeight > 320 ? 'large' : 'companion',
  }: {
    minHeight?: number;
    surfaceRole?: 'large' | 'companion';
  }) => {
    return (
      <div
      data-testid={`${surfaceRole}-surface-knowledge`}
      style={getSurfaceShellStyle(minHeight <= 320)}
    >
      <div className="h-full flex flex-col" style={{ position: 'relative' }}>
        {HERMES_GRAPH_AUTHORITIES.length > 0 ? (
          <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
            {HERMES_GRAPH_AUTHORITIES.map((k) => {
              const active = k === knowledgeGraphKind;
              const label =
                k === 'unified'
                  ? 'Unified'
                  : k === 'codegraph'
                  ? 'CodeGraph'
                  : k === 'thinkgraph'
                    ? 'ThinkGraph'
                    : k === 'knowgraph'
                      ? 'KnowGraph'
                      : k;
              return (
                <button
                  key={k}
                  type="button"
                  data-testid={`graph-kind-${k}`}
                  onClick={() => setKnowledgeGraphKind(k)}
                  style={{
                    fontSize: 12,
                    padding: '4px 12px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    border: `1px solid ${active ? '#2dd4bf' : '#26313f'}`,
                    background: active ? 'rgba(45,212,191,0.12)' : 'rgba(13,18,32,0.7)',
                    color: active ? '#a9ecdf' : '#8fb3c8',
                  }}
                >
                  {label}
                </button>
              );
            })}
            </div>
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            flex: 1,
            minHeight,
          }}
        >
          <KnowledgeSurfaceErrorBoundary key={`knowledge-${knowledgeGraphKind}`}>
            <Suspense
              fallback={
                <div
                  style={graphDrawerSectionStyle({
                    width: '100%',
                    minHeight,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    color: GRAPH_THEME.drawer.inputMuted,
                  })}
                >
                  Loading knowledge graph...
                </div>
              }
            >
              {knowledgeGraphKind === 'unified' ? (
                <UnifiedGraphSurface
                  projectId={activeProject}
                  codeGraphProject={codeGraphProjectName}
                  thinkProjection={thinkGraphProjection.projection ?? undefined}
                  knowProjection={knowGraphProjection.projection ?? undefined}
                  activeHermesReport={hermesReport.report}
                  focusedThinkIds={thinkGraphFocusIds}
                />
              ) : knowledgeGraphKind === 'codegraph' ? (
                <CodeGraphSurface
                  projectId={codeGraphProjectName}
                  focusReference={focusedCodeGraphRef}
                  viewContract={{
                    projectId: codeGraphProjectName,
                    nodeLabelAllowlist: graphViewContract?.nodeLabelAllowlist,
                    edgeTypeAllowlist: graphViewContract?.edgeTypeAllowlist,
                    showLabels: graphViewContract?.showLabels,
                    maxNodes: graphViewContract?.maxNodes,
                    focusPaths: graphViewContract?.focusPaths,
                    focusSymbols: graphViewContract?.focusSymbols,
                  }}
                  onViewContractChange={(nextContract) =>
                    setGraphViewContract((prev) => ({
                      projectId: codeGraphProjectName,
                      nodeLabelAllowlist: nextContract.nodeLabelAllowlist,
                      edgeTypeAllowlist: nextContract.edgeTypeAllowlist,
                      showLabels:
                        typeof nextContract.showLabels === 'boolean'
                          ? nextContract.showLabels
                          : (prev?.showLabels ?? true),
                      maxNodes: nextContract.maxNodes ?? prev?.maxNodes,
                      focusPaths: nextContract.focusPaths ?? prev?.focusPaths,
                      focusSymbols: nextContract.focusSymbols ?? prev?.focusSymbols,
                    }))
                  }
                />
              ) : (
                <KnowledgeGraphFramework
                  projection={
                    knowledgeGraphKind === 'thinkgraph'
                      ? (thinkGraphProjection.projection ?? undefined)
                      : knowledgeGraphKind === 'knowgraph'
                        ? (knowGraphProjection.projection ?? undefined)
                        : undefined
                  }
                  minHeight={minHeight}
                  activeHermesReport={hermesReport.report}
                  focusedNodeId={focusedGraphNodeId}
                  onNodeSelectionChange={(nodeId) => {
                    if (knowledgeGraphKind === 'thinkgraph') {
                      setThinkGraphFocusIds(nodeId ? [nodeId] : []);
                    }
                  }}
                  onHermesReportReference={({ authority, id }) => {
                    setKnowledgeGraphKind(authority);
                    if (authority === 'codegraph') {
                      setFocusedCodeGraphRef(id);
                      setFocusedGraphNodeId(null);
                    } else {
                      setFocusedGraphNodeId(id);
                      setFocusedCodeGraphRef(null);
                    }
                  }}
                />
              )}
            </Suspense>
          </KnowledgeSurfaceErrorBoundary>
        </div>
        {/* Honest ThinkGraph status OUTSIDE the graph canvas: real empty state or
            the actual transport error. Never fake nodes, never fallback data. */}
        {knowledgeGraphKind === 'thinkgraph' &&
        thinkGraphProjection.status === 'loading' &&
        !thinkGraphProjection.projection ? (
          <div
            data-testid="thinkgraph-loading-message"
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 5,
              ...graphGlassPillStyle({ fontSize: 11, padding: '5px 10px' }),
            }}
          >
            Loading ThinkGraph projection…
          </div>
        ) : null}
        {knowledgeGraphKind === 'thinkgraph' &&
        thinkGraphProjection.status === 'ready' &&
        (thinkGraphProjection.projection?.nodes?.length ?? 0) === 0 ? (
          <div
            data-testid="thinkgraph-empty-message"
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 5,
              ...graphGlassPillStyle({ fontSize: 11, padding: '5px 10px' }),
            }}
          >
            No ThinkGraph records exist for this project yet.
          </div>
        ) : null}
        {knowledgeGraphKind === 'thinkgraph' && thinkGraphProjection.status === 'error' ? (
          <div
            data-testid="thinkgraph-projection-error"
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 5,
              maxWidth: 520,
              ...graphGlassPillStyle({ fontSize: 11, padding: '5px 10px' }),
            }}
          >
            ThinkGraph projection unavailable: {thinkGraphProjection.error}
          </div>
        ) : null}
        {/* Honest KnowGraph states: the tab now renders the REAL project-scoped
            Neo4j browse projection (GET /api/knowgraph/graph). Loading, error,
            and empty are each stated plainly; agent writes still go through the
            Python rails only — this view is read-only. */}
        {knowledgeGraphKind === 'knowgraph' &&
        knowGraphProjection.status === 'loading' &&
        !knowGraphProjection.projection ? (
          <div
            data-testid="knowgraph-loading-message"
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 5,
              ...graphGlassPillStyle({ fontSize: 11, padding: '5px 10px' }),
            }}
          >
            Loading KnowGraph projection…
          </div>
        ) : null}
        {knowledgeGraphKind === 'knowgraph' &&
        knowGraphProjection.status === 'ready' &&
        (knowGraphProjection.projection?.nodes?.length ?? 0) === 0 ? (
          <div
            data-testid="knowgraph-empty-message"
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 5,
              maxWidth: 560,
              ...graphGlassPillStyle({ fontSize: 11, padding: '5px 10px' }),
            }}
          >
            No KnowGraph evidence exists for this project yet. This view is
            read-only; research runs write evidence through the Python rails.
          </div>
        ) : null}
        {knowledgeGraphKind === 'knowgraph' && knowGraphProjection.status === 'error' ? (
          <div
            data-testid="knowgraph-projection-error"
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 5,
              maxWidth: 560,
              ...graphGlassPillStyle({ fontSize: 11, padding: '5px 10px' }),
            }}
          >
            KnowGraph projection unavailable: {knowGraphProjection.error}
          </div>
        ) : null}
      </div>
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

  const previousHermesConnectionRef = useRef(false);
  useEffect(() => {
    const becameConnected =
      hermesConnectedToMainChat && !previousHermesConnectionRef.current;
    previousHermesConnectionRef.current = hermesConnectedToMainChat;
    if (!becameConnected) return;

    closeObjectDrawer();
    setWorkspaceView('knowledge');
    setKnowledgeGraphKind('thinkgraph');
    const params = new URLSearchParams(window.location.search);
    params.set('workspace', 'knowledge');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [
    closeObjectDrawer,
    hermesConnectedToMainChat,
  ]);

  const showWorkbenchWorkspace = useCallback((surface: 'trading') => {
    closeObjectDrawer();
    setWorkspaceView(surface);
  }, [closeObjectDrawer]);

  const showTradingWorkspace = useCallback(() => {
    showWorkbenchWorkspace('trading');
  }, [showWorkbenchWorkspace]);

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
      openClaudeConsoleActive={openClaudeConsoleOpen}
      onOpenOpenClaudeConsole={() => setOpenClaudeConsoleOpen((prev) => !prev)}
    />
  );

  const workspaceChatPane = (
    <AgentBuilderChatPane
      workspaceView={workspaceView}
      surfaceName={largeSurface}
      chatPanelWidth={chatPanelWidth}
      minWidth={AGENTS_CHAT_MIN_WIDTH}
    >
      {renderChatSurface(activeProject, false, 'large')}
    </AgentBuilderChatPane>
  );

  const workspaceSplitter = workspaceView !== 'chat' ? (
    <AgentBuilderSplitter
      active={chatResizeHandleActive}
      dragging={chatResizeDragging}
      onMouseEnter={() => setChatResizeHandleActive(true)}
      onMouseLeave={() => {
        if (!chatResizeDragging) {
          setChatResizeHandleActive(false);
        }
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        setChatResizeHandleActive(true);
        const reservedWidth =
          workspaceView === 'canvas'
            ? AGENTS_CANVAS_MIN_WIDTH
            : WORKSPACE_COMPANION_MIN_WIDTH;
        chatResizeSessionRef.current = {
          startX: event.clientX,
          startWidth: chatPanelWidth,
          pendingWidth: chatPanelWidth,
          reservedWidth,
        };
        setChatResizeDragging(true);
      }}
    />
  ) : null;

  const workspaceCanvasRegion = workspaceView === 'canvas' ? (
    <AgentBuilderCanvasRegion minWidth={AGENTS_CANVAS_MIN_WIDTH}>
      {renderCanvasSurface(false, 'large')}
    </AgentBuilderCanvasRegion>
  ) : null;

  const workspaceCompanionSurfaceHost = (
    <CompanionSurfaceHost
      workspaceView={workspaceView}
      minWidth={WORKSPACE_COMPANION_MIN_WIDTH}
      hasKnowledgeWorkspaceSelection={false}
      hasActiveUaSurface={false}
      knowledgeSelectionSurface={null}
      knowledgeSurface={
        <KnowledgeGraphSurface
          minHeight={420}
          surfaceRole="companion"
        />
      }
      codegraphSurface={
        <KnowledgeGraphSurface
          minHeight={420}
          surfaceRole="companion"
        />
      }
      tradingSurface={<TradingCanvasSurface />}
      uaSurface={null}
      worldsignalSurface={<WorldSignalSurface />}
    />
  );

  const workspaceDrawer =
    workspaceView === 'canvas' ? (
      <RightGlassDrawer
        isOpen={isObjectDrawerVisible}
        title={safeText(selectedCard?.title || 'Agent')}
        onClose={closeObjectDrawer}
        movable
        defaultWidth={objectDrawerDefaultWidth}
        minWidth={300}
        maxWidth={560}
        storageKey={objectDrawerStorageKey}
        dataTestId="workspace-object-drawer"
        right={12}
        top={48}
      >
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
        <div
          data-testid="companion-surface-editor"
          style={{
            display: 'grid',
            gap: 8,
          }}
        >
          {renderAgentBuilderPanel()}
        </div>
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
          shell={
            <AgentBuilderShell
              workspaceShellRef={workspaceShellRef}
              chatPane={workspaceChatPane}
              splitter={workspaceSplitter}
              canvasRegion={workspaceCanvasRegion}
              companionSurfaceHost={workspaceCompanionSurfaceHost}
              drawer={
                <>
                  {workspaceDrawer}
                  <OpenClaudeConsolePanel
                    open={openClaudeConsoleOpen}
                    targetRoot="C:/Projects/main"
                    projectId={typeof activeProject === 'string' ? activeProject : undefined}
                    provider={localCoderConsoleConfig.provider}
                    model={localCoderConsoleConfig.model}
                    onClose={() => setOpenClaudeConsoleOpen(false)}
                  />
                </>
              }
            />
          }
        />

      {/* drawers */}
      {openDrawer === 'navigation' && (
        <BuilderDrawer
          title="Projects"
          onClose={() => setOpenDrawer(null)}
          colors={C}
        >
          <div data-testid="navigation-drawer" className="space-y-3">
            <div
              data-testid="drawer-projects-section"
              className="text-xs uppercase mb-2 flex items-center justify-between"
              style={{ color: C.neutral }}
            >
              <span>Chat Projects</span>
              <button
                onClick={() => setShowCreateProjectForm(!showCreateProjectForm)}
                className="text-[11px] px-2 py-1 rounded"
                style={{ border: `1px solid ${C.border}`, color: C.text }}
                data-testid="new-project-button"
              >
                New Project
              </button>
            </div>

            {showCreateProjectForm && (
              <form
                onSubmit={handleCreateProject}
                className="mb-2 p-2 rounded"
                style={{ border: `1px solid ${C.border}`, background: C.bg }}
                data-testid="create-project-form"
              >
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Project name"
                    autoFocus
                    className="flex-1 px-2 py-1 text-xs rounded focus:outline-none"
                    style={{
                      background: C.panel,
                      border: `1px solid ${C.border}`,
                      color: C.text,
                    }}
                    data-testid="project-name-input"
                  />
                  <button
                    type="submit"
                    disabled={!newProjectName.trim()}
                    className="text-xs py-1 px-3 rounded font-medium"
                    style={{
                      background: newProjectName.trim()
                        ? `rgba(79,162,173,0.18)`
                        : C.panel,
                      border: `1px solid ${newProjectName.trim() ? C.primary : C.border}`,
                      color: C.text,
                      cursor: newProjectName.trim() ? 'pointer' : 'not-allowed',
                    }}
                    data-testid="create-project-submit"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            <div
              className="space-y-2"
              style={{ maxHeight: 400, overflowY: 'auto' }}
            >
              {projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  {safeText(projectsError)}
                </div>
              )}
              {assistProjects.map((project) => (
                <div key={project.id} className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setActiveProjectWithUrl(project.id);
                      setOpenDrawer(null);
                    }}
                    className="flex-1 text-left p-3 rounded"
                    style={{
                      background:
                        activeProject === project.id
                          ? 'rgba(79,162,173,0.18)'
                          : 'transparent',
                      border: `1px solid ${activeProject === project.id ? C.primary : C.border}`,
                      color: C.text,
                    }}
                  >
                    <div className="font-medium">
                      {safeText(project.name || project.id)}
                    </div>
                    {project.code && (
                      <div
                        className="opacity-60 text-xs"
                        style={{ marginTop: 2 }}
                      >
                        {safeText(project.code)}
                      </div>
                    )}
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        !confirm(
                          `Delete project "${project.name}"? This cannot be undone.`,
                        )
                      )
                        return;
                      try {
                        const res = await fetch(
                          `${PROJECTS_API}/${project.id}`,
                          { method: 'DELETE' },
                        );
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        await refreshProjects('after-delete');
                        if (activeProject === project.id) {
                          const remaining = assistProjects.filter(
                            (entry) => entry.id !== project.id,
                          );
                          if (remaining.length > 0) {
                            setActiveProjectWithUrl(remaining[0].id);
                          } else {
                            setActiveProjectWithUrl('');
                          }
                        }
                      } catch (err: any) {
                        alert(`Failed to delete project: ${err.message}`);
                      }
                    }}
                    className="p-2 rounded"
                    style={{
                      background: 'transparent',
                      border: `1px solid ${C.border}`,
                      color: C.warn,
                    }}
                    title="Delete project"
                  >
                    ×
                  </button>
                </div>
              ))}

              {assistProjects.length === 0 && !projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  No projects available.
                </div>
              )}
            </div>

            <div
              className="mt-6 pt-4"
              style={{ borderTop: `1px solid ${C.border}` }}
            >
              <div
                className="text-xs uppercase mb-2"
                style={{ color: C.neutral }}
              >
                Account
              </div>
              <button
                onClick={async () => {
                  try {
                    await fetch('/api/auth/logout', {
                      method: 'POST',
                      credentials: 'include',
                    });
                    window.location.href = '/login';
                  } catch (err) {
                    console.error('Logout failed:', err);
                  }
                }}
                className="w-full text-left p-3 rounded"
                style={{
                  background: 'transparent',
                  border: `1px solid ${C.border}`,
                  color: C.text,
                }}
              >
                <div className="font-medium">Sign Out</div>
              </button>
            </div>
          </div>
        </BuilderDrawer>
      )}
      </div>
    </FrontendCrashBoundary>
  );
}
