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
import DataFormulatorSurface, {
  type DataFormulatorModelConfig,
} from '../components/dataformulator/DataFormulatorSurface';
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
import {
  streamSession,
  loadSessionHistory,
} from '../features/agentbuilder/console/openClaudeSessionClient';
import { openClaudeConsoleClient } from '../features/agentbuilder/console/openClaudeConsoleClient';
import { shouldShowOpenClaudeConsoleRail } from '../features/agentbuilder/console/consoleVisibility';
import useAgentBuilderAutosave from '../features/agentbuilder/state/useAgentBuilderAutosave';
import useAgentBuilderDeck from '../features/agentbuilder/state/useAgentBuilderDeck';
import useAgentBuilderDeckLoad from '../features/agentbuilder/state/useAgentBuilderDeckLoad';
import useAgentBuilderProject from '../features/agentbuilder/state/useAgentBuilderProject';
import useAgentBuilderProjectReset from '../features/agentbuilder/state/useAgentBuilderProjectReset';
import useAgentBuilderSelection from '../features/agentbuilder/state/useAgentBuilderSelection';
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
import {
  findDeckNodePreset,
  getAssistStarterRecipe,
  type AssistStarterRecipe,
  type DeckNodePreset,
} from '../components/builder/deckPresets';
import { resolveEffectiveAgent } from '../components/builder/deckRuntime';
import {
  buildDeckRuntimeVisualState,
  buildReloadStateFromDeckRuns,
  resolveDeckRunChatReply,
  streamDeckRunRequest,
} from '../components/builder/deckRunState';
import {
  buildDefaultDeckEdgeMetadata,
  sanitizeDeckEdges,
  validateDeckDocument,
} from '../components/builder/deckValidation';
import {
  formatRequestErrorLine,
  guardedRequest,
  isAbortLikeError,
  isLatestRequestSequence,
  nextRequestSequence,
  readJsonAndText,
  safeJson,
} from '../components/builder/requestGuards';
import {
  useBuilderDeckRuntimeActions,
} from '../components/builder/useBuilderDeckRuntimeActions';
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  AgentTemplate,
  DeckEdge,
  DeckEdgeType,
  DeckDocument,
  DeckRun,
  DeckRuntimeEvent,
  KnowledgeGraphKind,
  DeckWorkspaceContext,
  WorkspaceObjectContext,
  PromptTemplate,
  RuntimeBinding,
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
const KnowledgeSummaryPanel = lazy(
  () => import('../components/knowledge/KnowledgeSummaryPanel'),
);
const KnowledgeEvidencePanel = lazy(
  () => import('../components/knowledge/KnowledgeEvidencePanel'),
);
const KnowledgeGraphFramework = lazy(
  () => import('../components/knowledge/KnowledgeGraphFramework'),
);
// Type-only (erased at compile time — the component itself stays lazy).
import type { GraphProjectionV1 } from '../components/knowledge/KnowledgeGraphFramework';
// CodeGraph renders through its OWN CBM-backed surface (CodeGraphSurface → /api/layout → CBM →
// CodeGraphScene), never the generic shared graph shell. Restored to its pre-b32e5cdd direct mount.
const CodeGraphSurface = lazy(() =>
  import('../components/codegraph/CodeGraphSurface').then((mod) => ({ default: mod.CodeGraphSurface })),
);
import { resolveCbmProjectName } from '../components/codegraph/resolveCodeGraphProjectIdentity';
const DEFAULT_WORKSPACE_ROOT = 'C:\\Projects\\main';
void KnowledgeSummaryPanel;
void KnowledgeEvidencePanel;

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

const HOME_CHAT_TABS = ['Canvas', 'Knowledge', 'Plan'] as const;
const HOME_PLAN_TABS = ['Chat', 'Canvas', 'Knowledge'] as const;
const KNOWLEDGE_VIEW_TABS = ['Chat', 'Canvas', 'Plan'] as const;
const CODEGRAPH_VIEW_TABS = ['Chat', 'Canvas', 'Knowledge', 'Plan'] as const;
const BUILDER_PROJECT_TABS = ['Plan'] as const;
const BUILDER_NODE_TABS = ['Prompt', 'Knowledge', 'Tools', 'Runtime', 'Task'] as const;
const AGENTS_CHAT_MIN_WIDTH = 280;
const AGENTS_CANVAS_MIN_WIDTH = 520;
const WORKSPACE_COMPANION_MIN_WIDTH = 360;
const WORKSPACE_COLLAPSE_EDGE_PX = 28;
const AGENT_EDITOR_DEFAULT_WIDTH = 420;
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
    normalized === 'trading' ||
    normalized === 'code'
  ) {
    return normalized as WorkspaceTestingSurface;
  }
  return null;
}

// ---- utils ----
function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={graphDrawerSectionStyle({
        borderRadius: 8,
        padding: '12px 14px',
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
        {title}
      </div>
      {children}
    </div>
  );
}

function safeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    // fallback below
  }
  return String(value);
}

function cleanOptionalText(value: unknown): string | null {
  const text = safeText(value).trim();
  return text || null;
}

const DEFAULT_CARD_MODEL_KEY = 'z-ai/glm-5.2';
const DEFAULT_CARD_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openrouter';
const LOCAL_CODER_CONTROLLER_MODEL_KEY = DEFAULT_CARD_MODEL_KEY;
const LOCAL_CODER_CONTROLLER_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = DEFAULT_CARD_PROVIDER;
const LOCAL_CODER_CONTROLLER_TOOLS = ['run_local_coder'] as const;
const STALE_LOCAL_CODER_MODEL_KEYS = new Set([
  'gpt-5-mini',
  'or-openai-gpt-5-mini',
  'kimi-k2-thinking',
  'moonshotai/kimi-k2-thinking',
  'moonshotai/kimi-k2:free',
  'gpt-5.1-chat-latest',
  'or-openai-gpt-5.1-chat-latest',
  'openai/gpt-5.1-chat',
]);

function normalizeRuntimeType(value: unknown): AgentCardRuntimeType | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === 'assistant_agent') return 'assistant_agent';
  if (normalized === 'magentic_one') return 'magentic_one';
  if (normalized === 'graph_flow') return 'graph_flow';
  if (normalized === 'local_coder') return 'local_coder';
  return null;
}

function isTradingWorkbenchCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_trading_workbench' ||
    safeText(card.templateId).trim() === 'template_trading_workbench'
  );
}

function isCodeWorkbenchCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_code_workbench' ||
    safeText(card.templateId).trim() === 'template_code_workbench'
  );
}

function isDataFormulatorWorkbenchCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_data_formulator_workbench' ||
    safeText(card.templateId).trim() === 'template_data_formulator_workbench'
  );
}

function isLegacyUaCard(
  card: Pick<AgentCardInstance, 'id' | 'templateId' | 'title'> | null | undefined,
): boolean {
  if (!card) return false;
  const id = safeText(card.id).trim().toLowerCase();
  const templateId = safeText(card.templateId).trim().toLowerCase();
  const title = safeText(card.title).trim().toLowerCase();
  return (
    id.startsWith('card_ua_') ||
    (id.startsWith('card_') && id.includes('anything')) ||
    (templateId.startsWith('template_') && templateId.includes('anything')) ||
    title === 'understand anything'
  );
}

type WorkbenchSurfaceId =
  | 'trading'
  | 'code'
  | 'data-formulator';

type WorkbenchCardDescriptor = {
  id: WorkbenchSurfaceId;
  title: string;
  openLabel: string;
  disabledCopy: string;
  matches: (card: AgentCardInstance | null | undefined) => boolean;
};

const WORKBENCH_CARD_DESCRIPTORS: readonly WorkbenchCardDescriptor[] = [
  {
    id: 'trading',
    title: 'Trading Agent',
    openLabel: 'Open Trading Workspace',
    disabledCopy:
      'Trading is staged as a selectable workbench card. Runtime is disabled until the dedicated trading bridge exists.',
    matches: isTradingWorkbenchCard,
  },
  {
    id: 'code',
    title: 'Code Agent',
    openLabel: 'Open Code Workspace',
    disabledCopy:
      'Code Agent is staged as a selectable workbench card. Runtime is disabled until the canvas-owned code bridge is restored.',
    matches: isCodeWorkbenchCard,
  },
  {
    id: 'data-formulator',
    title: 'Data Formulator',
    openLabel: 'Open Data Formulator',
    disabledCopy:
      'Data Formulator opens the real in-process app surface.',
    matches: isDataFormulatorWorkbenchCard,
  },
] as const;

function resolveWorkbenchDescriptor(
  card: AgentCardInstance | null | undefined,
): WorkbenchCardDescriptor | null {
  if (!card) return null;
  return (
    WORKBENCH_CARD_DESCRIPTORS.find((descriptor) => descriptor.matches(card)) ??
    null
  );
}

function isWorldSignalsAgentCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  const id = safeText(card.id).trim().toLowerCase();
  const templateId = safeText(card.templateId).trim().toLowerCase();
  const title = safeText(card.title).trim().toLowerCase();
  return (
    id === 'card_worldsignals_agent' ||
    templateId === 'template_worldsignals_agent' ||
    title === 'worldsignals agent'
  );
}

function isThinkGraphSystemCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim().toLowerCase() === 'card_thinkgraph_agent' ||
    safeText(card.runtimeBinding).trim().toLowerCase() === 'thinkgraph_agent'
  );
}

function isKnowGraphSystemCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  const binding = safeText(card.runtimeBinding).trim().toLowerCase();
  return (
    safeText(card.id).trim().toLowerCase() === 'card_knowgraph_agent' ||
    binding === 'knowgraph_agent' ||
    binding === 'knowgraph'
  );
}

function isCodeGraphSystemCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim().toLowerCase() === 'card_codegraph_agent' ||
    safeText(card.runtimeBinding).trim().toLowerCase() === 'codegraph_agent'
  );
}

export type ActivationProposalState = {
  capability:
    | 'knowledge'
    | 'worldsignal'
    | 'code'
    | 'trading';
  title: string;
  sourceText: string;
  status: 'pending' | 'approved';
};

export type ProgressiveRailVisibility = {
  showKnowledge: boolean;
  showWorldsignal: boolean;
  showTrading: boolean;
  showCode: boolean;
  showDataFormulator: boolean;
  showOpenClaudeConsole: boolean;
};

export type ConnectedGraphStreams = {
  thinkGraph: boolean;
  knowGraph: boolean;
  codeGraph: boolean;
  anyGraph: boolean;
};

function buildBusConnectedCardIds(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const busIds = nodes
    .filter((node) => normalizeRuntimeType(node.runtimeType) === 'magentic_one')
    .map((node) => node.id);
  if (busIds.length === 0) return new Set<string>();

  const adjacency = new Map<string, string[]>();
  const connect = (left: string, right: string) => {
    const neighbors = adjacency.get(left) || [];
    neighbors.push(right);
    adjacency.set(left, neighbors);
  };

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const edgeType = normalizeDeckEdgeType(edge.edgeType);
    if (edgeType !== 'magentic_option' && edgeType !== 'flow') continue;
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }

  const connected = new Set<string>();
  const queue = [...busIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (connected.has(current)) continue;
    connected.add(current);
    for (const neighbor of adjacency.get(current) || []) {
      if (!connected.has(neighbor)) queue.push(neighbor);
    }
  }

  return connected;
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

function buildFlowAdjacency(edges: readonly DeckEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const connect = (left: string, right: string) => {
    const neighbors = adjacency.get(left) || [];
    neighbors.push(right);
    adjacency.set(left, neighbors);
  };

  for (const edge of edges) {
    if (normalizeDeckEdgeType(edge.edgeType) !== 'flow') continue;
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }

  return adjacency;
}

function areCardsInSameFlowComponent(
  adjacency: Map<string, string[]>,
  cardIds: readonly string[],
): boolean {
  const [head, ...tail] = cardIds.filter(Boolean);
  if (!head || tail.length === 0) return false;
  const visited = new Set<string>();
  const queue = [head];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) || []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return tail.every((cardId) => visited.has(cardId));
}

function resolveFirstMatchingCardId(
  nodes: readonly AgentCardInstance[],
  predicate: (card: AgentCardInstance) => boolean,
): string | null {
  return nodes.find(predicate)?.id ?? null;
}

export function isKnowledgeChainActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return deriveConnectedGraphStreams({ nodes: nodes as any, edges: edges as any }).anyGraph;
}

export function deriveConnectedGraphStreams(deck: Pick<DeckDocument, 'nodes' | 'edges'>): ConnectedGraphStreams {
  const busConnected = buildBusConnectedCardIds(deck.nodes, deck.edges);
  const thinkGraph = deck.nodes.some(
    (node) => busConnected.has(node.id) && isThinkGraphSystemCard(node),
  );
  const knowGraph = deck.nodes.some(
    (node) => busConnected.has(node.id) && isKnowGraphSystemCard(node),
  );
  const codeGraph = deck.nodes.some(
    (node) => busConnected.has(node.id) && isCodeGraphSystemCard(node),
  );
  return {
    thinkGraph,
    knowGraph,
    codeGraph,
    anyGraph: thinkGraph || knowGraph || codeGraph,
  };
}

export function getDefaultConnectedKnowledgeGraphKind(
  streams: ConnectedGraphStreams,
): KnowledgeGraphKind {
  if (streams.thinkGraph) return 'thinkgraph';
  return 'codegraph';
}

export function getConnectedKnowledgeGraphKinds(
  streams: ConnectedGraphStreams,
): KnowledgeGraphKind[] {
  const kinds: KnowledgeGraphKind[] = [];
  if (streams.thinkGraph) kinds.push('thinkgraph');
  if (streams.knowGraph) kinds.push('knowgraph');
  if (streams.codeGraph) kinds.push('codegraph');
  return kinds;
}

export function isLegacyKnowledgeChainFullyConnected(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  const thinkGraphId = resolveFirstMatchingCardId(nodes, isThinkGraphSystemCard);
  const knowGraphId = resolveFirstMatchingCardId(nodes, isKnowGraphSystemCard);
  const codeGraphId = resolveFirstMatchingCardId(nodes, isCodeGraphSystemCard);
  if (!thinkGraphId || !knowGraphId || !codeGraphId) return false;

  const busConnected = buildBusConnectedCardIds(nodes, edges);
  if (
    !busConnected.has(thinkGraphId) ||
    !busConnected.has(knowGraphId) ||
    !busConnected.has(codeGraphId)
  ) {
    return false;
  }

  return areCardsInSameFlowComponent(buildFlowAdjacency(edges), [
    thinkGraphId,
    knowGraphId,
    codeGraphId,
  ]);
}

export function isWorldSignalsAgentActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  const busConnected = buildBusConnectedCardIds(nodes, edges);
  return nodes.some(
    (node) => busConnected.has(node.id) && isWorldSignalsAgentCard(node),
  );
}

export function isTradingWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isTradingWorkbenchCard);
}

export function isCodeWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isCodeWorkbenchCard);
}

export function isDataFormulatorWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isDataFormulatorWorkbenchCard);
}

function isWorkbenchSurfaceActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
  predicate: (card: AgentCardInstance | null | undefined) => boolean,
): boolean {
  const busConnected = buildBusConnectedCardIds(nodes, edges);
  return nodes.some(
    (node) => busConnected.has(node.id) && predicate(node),
  );
}

export function deriveVisibleRailItems({
  deck,
  workspaceView,
  pendingActivationProposal,
}: {
  deck: Pick<DeckDocument, 'nodes' | 'edges'>;
  workspaceView: string;
  pendingActivationProposal: ActivationProposalState | null;
}): ProgressiveRailVisibility {
  const connectedGraphStreams = deriveConnectedGraphStreams(deck);
  return {
    showKnowledge: connectedGraphStreams.anyGraph,
    showWorldsignal:
      workspaceView === 'worldsignal' ||
      isWorldSignalsAgentActive(deck.nodes, deck.edges),
    showTrading:
      workspaceView === 'trading' ||
      isTradingWorkbenchActive(deck.nodes, deck.edges),
    showCode:
      workspaceView === 'code' ||
      isCodeWorkbenchActive(deck.nodes, deck.edges),
    showDataFormulator:
      workspaceView === 'data-formulator' ||
      isDataFormulatorWorkbenchActive(deck.nodes, deck.edges),
    showOpenClaudeConsole: shouldShowOpenClaudeConsoleRail({
      cards: deck.nodes,
      edges: deck.edges,
    }),
  };
}

function detectActivationProposal(
  text: string,
): ActivationProposalState | null {
  const normalized = safeText(text).trim().toLowerCase();
  if (!normalized || !/\b(enable|activate|open|use|add)\b/.test(normalized)) {
    return null;
  }

  const capability =
    /\b(knowledge|research|knowgraph|codegraph|thinkgraph)\b/.test(
            normalized,
          )
        ? 'knowledge'
        : /\b(worldsignal|world signals|world)\b/.test(normalized)
          ? 'worldsignal'
          : /\b(code|coder|openclaude|claude code|localcoder)\b/.test(
                  normalized,
                )
              ? 'code'
              : /\btrading\b/.test(normalized)
                ? 'trading'
                : null;
  if (!capability) return null;

  const titleByCapability = {
    knowledge: 'Enable Research + Knowledge',
    worldsignal: 'Enable WorldSignals',
    code: 'Enable Code Agent',
    trading: 'Enable Trading',
  } as const;

  return {
    capability,
    title: titleByCapability[capability],
    sourceText: text.trim(),
    status: 'pending',
  };
}

function isAssistLikeRuntimeType(runtimeType: AgentCardRuntimeType | null): boolean {
  return runtimeType === 'assistant_agent' || runtimeType === 'local_coder';
}

function normalizeRuntimeOptions(
  value: unknown,
): AgentCardRuntimeOptions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return cloneDeckDocument(value as AgentCardRuntimeOptions);
}

function isLocalCoderControllerCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim().toLowerCase() === 'card_local_coder' ||
    safeText(card.runtimeBinding).trim().toLowerCase() === 'local_coder' ||
    safeText(card.runtimeType).trim().toLowerCase() === 'local_coder' ||
    safeText(card.templateId).trim().toLowerCase() === 'template_local_coder'
  );
}

function isStaleLocalCoderModel(modelKey: string | null): boolean {
  return Boolean(modelKey && STALE_LOCAL_CODER_MODEL_KEYS.has(modelKey));
}

function normalizeLocalCoderControllerCard(card: AgentCardInstance): AgentCardInstance {
  if (!isLocalCoderControllerCard(card)) return card;
  const runtimeOptions = normalizeRuntimeOptions(card.runtimeOptions) ?? {};
  const modelKey = cleanOptionalText(runtimeOptions.modelKey);
  const provider = cleanOptionalText(runtimeOptions.provider);
  const shouldUseControllerDefault = !modelKey || isStaleLocalCoderModel(modelKey);
  return {
    ...card,
    runtimeBinding: 'local_coder',
    runtimeType: 'local_coder',
    runtimeOptions: {
      ...runtimeOptions,
      provider:
        shouldUseControllerDefault || !provider
          ? LOCAL_CODER_CONTROLLER_PROVIDER
          : runtimeOptions.provider,
      modelKey: shouldUseControllerDefault
        ? LOCAL_CODER_CONTROLLER_MODEL_KEY
        : runtimeOptions.modelKey,
      tools: Array.from(new Set([
        ...LOCAL_CODER_CONTROLLER_TOOLS,
        ...(Array.isArray(runtimeOptions.tools)
          ? runtimeOptions.tools.map((tool) => safeText(tool).trim()).filter(Boolean)
          : []),
      ])),
    },
  };
}

function resolveLocalCoderControllerConsoleConfig(
  deck: Pick<DeckDocument, 'nodes'>,
): { provider: string; model: string } {
  const card = deck.nodes.find(isLocalCoderControllerCard) || null;
  const runtimeOptions = normalizeRuntimeOptions(card?.runtimeOptions) ?? {};
  const template =
    INITIAL_AGENT_TEMPLATES.find((candidate) => candidate.id === card?.templateId) ||
    INITIAL_AGENT_TEMPLATES.find((candidate) => candidate.id === 'template_local_coder') ||
    null;
  const rawModel =
    cleanOptionalText(runtimeOptions.modelKey) ||
    cleanOptionalText(template?.model) ||
    LOCAL_CODER_CONTROLLER_MODEL_KEY;
  const shouldUseControllerDefault = isStaleLocalCoderModel(rawModel);
  return {
    provider:
      shouldUseControllerDefault
        ? LOCAL_CODER_CONTROLLER_PROVIDER
        : cleanOptionalText(runtimeOptions.provider) ||
          cleanOptionalText(template?.provider) ||
          LOCAL_CODER_CONTROLLER_PROVIDER,
    model: shouldUseControllerDefault ? LOCAL_CODER_CONTROLLER_MODEL_KEY : rawModel,
  };
}

function normalizeDeckEdgeType(value: unknown): DeckEdgeType {
  return safeText(value).trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'flow';
}

function isTopLevelCanvasCard(
  node: AgentCardInstance | null | undefined,
): node is AgentCardInstance {
  return Boolean(node && !cleanOptionalText(node.parentGraphId));
}

function isAssistCanvasCard(
  node: AgentCardInstance | null | undefined,
): node is AgentCardInstance {
  return Boolean(node && isAssistLikeRuntimeType(normalizeRuntimeType(node.runtimeType)));
}

function isVisibleAssistFlowPair(
  sourceNode: AgentCardInstance | null | undefined,
  targetNode: AgentCardInstance | null | undefined,
): boolean {
  if (!isAssistCanvasCard(sourceNode) || !isAssistCanvasCard(targetNode))
    return false;

  const sourceGraphId = cleanOptionalText(sourceNode.parentGraphId);
  const targetGraphId = cleanOptionalText(targetNode.parentGraphId);

  if (!sourceGraphId && !targetGraphId) {
    return true;
  }

  return Boolean(sourceGraphId && sourceGraphId === targetGraphId);
}

function collectVisibleAssistFlowIds(
  document: DeckDocument,
  startNodeId: string,
): Set<string> {
  const nodeMap = new Map(
    document.nodes.map((node) => [node.id, node] as const),
  );
  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);

    document.edges.forEach((edge) => {
      if (normalizeDeckEdgeType(edge.edgeType) !== 'flow') return;
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!isVisibleAssistFlowPair(sourceNode, targetNode)) return;

      if (edge.source === nodeId && !visited.has(edge.target)) {
        queue.push(edge.target);
      }
      if (edge.target === nodeId && !visited.has(edge.source)) {
        queue.push(edge.source);
      }
    });
  }

  return visited;
}

function collectGraphScopedNodeIds(
  document: DeckDocument,
  graphOwnerId: string,
): Set<string> {
  const scopedNodeIds = new Set<string>([graphOwnerId]);
  document.nodes.forEach((node) => {
    if (cleanOptionalText(node.parentGraphId) === graphOwnerId) {
      scopedNodeIds.add(node.id);
    }
  });
  return scopedNodeIds;
}

function buildSingleCardRunNodeScope(
  document: DeckDocument,
  selectedNode: AgentCardInstance,
): Set<string> {
  const nodeMap = new Map(
    document.nodes.map((node) => [node.id, node] as const),
  );
  const relatedNodeIds = new Set<string>();
  const selectedNodeId = selectedNode.id;
  const selectedRuntimeType = normalizeRuntimeType(selectedNode.runtimeType);
  const selectedParentGraphId = cleanOptionalText(selectedNode.parentGraphId);

  if (selectedParentGraphId) {
    return collectGraphScopedNodeIds(document, selectedParentGraphId);
  }

  if (
    selectedRuntimeType === 'magentic_one' &&
    isTopLevelCanvasCard(selectedNode)
  ) {
    relatedNodeIds.add(selectedNodeId);

    document.edges.forEach((edge) => {
      if (
        edge.source !== selectedNodeId ||
        normalizeDeckEdgeType(edge.edgeType) !== 'magentic_option'
      ) {
        return;
      }

      const targetNode = nodeMap.get(edge.target);
      if (!targetNode) return;

      const targetRuntimeType = normalizeRuntimeType(targetNode.runtimeType);
      if (
        targetRuntimeType === 'graph_flow' &&
        isTopLevelCanvasCard(targetNode)
      ) {
        collectGraphScopedNodeIds(document, targetNode.id).forEach((nodeId) => {
          relatedNodeIds.add(nodeId);
        });
        return;
      }

      collectVisibleAssistFlowIds(document, targetNode.id).forEach((nodeId) => {
        relatedNodeIds.add(nodeId);
      });
    });

    return relatedNodeIds;
  }

  if (
    selectedRuntimeType === 'graph_flow' &&
    isTopLevelCanvasCard(selectedNode)
  ) {
    return collectGraphScopedNodeIds(document, selectedNodeId);
  }

  if (isAssistCanvasCard(selectedNode) && isTopLevelCanvasCard(selectedNode)) {
    return collectVisibleAssistFlowIds(document, selectedNodeId);
  }

  relatedNodeIds.add(selectedNodeId);
  return relatedNodeIds;
}

export function buildSingleCardRunDocument(
  document: DeckDocument,
  cardId: string,
): DeckDocument | null {
  const selectedNode = document.nodes.find((node) => node.id === cardId);
  if (!selectedNode) return null;
  const relatedNodeIds = buildSingleCardRunNodeScope(document, selectedNode);

  return {
    ...document,
    nodes: document.nodes.filter((node) => relatedNodeIds.has(node.id)),
    edges: document.edges.filter(
      (edge) =>
        relatedNodeIds.has(edge.source) && relatedNodeIds.has(edge.target),
    ),
  };
}

const uid = () => Math.random().toString(36).slice(2, 8);
const PROJECTS_API = '/api/projects';
const EMPTY_PROJECT_STATE = {
  messages: [] as { role: 'assistant' | 'user'; text: string }[],
  links: [] as LinkRef[],
};

function buildSeedPromptTemplate(parts: {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
}): string {
  return `# LIQUIDAITY_PROMPT_V1
[ROLE]
${parts.role}

[GOAL]
${parts.goal}

[CONSTRAINTS]
${parts.constraints}

[IO_SCHEMA]
${parts.ioSchema}

[MEMORY_POLICY]
${parts.memoryPolicy}`;
}

function buildSpecialistGraphProposalPrompt(parts: {
  role: string;
  goal: string;
  proposalTarget: 'CodeGraph' | 'ThinkGraph' | 'KnowGraph' | 'PlanSurface';
  proposalGuidance: string;
}): string {
  return buildSeedPromptTemplate({
    role: parts.role,
    goal: parts.goal,
    constraints: [
      'You are a LiquidAIty-native Agent Canvas specialist, not a separate plugin or dashboard.',
      'Magentic-One is the conductor. Stay within the assigned card role and return useful output to the visible deck runtime.',
      'Do not mutate CodeGraph, ThinkGraph, KnowGraph, Plan Surface, Apache AGE, Neo4j, files, or database state.',
      'When graph or plan changes would be useful, return proposals only.',
      'Do not claim a proposal has been written or persisted.',
    ].join('\n'),
    ioSchema: [
      'Output: concise analysis for the user.',
      'When useful, append one JSON object that contains graphWriteProposals.',
      'Each graphWriteProposals item must use this exact shape:',
      '{"target":"CodeGraph|ThinkGraph|KnowGraph|PlanSurface","operation":"upsert_node|upsert_edge|annotate_node|link_plan_step|create_plan_step|flag_uncertainty","confidence":0.0,"reason":"plain reason","payload":{}}',
      `Default proposal target: ${parts.proposalTarget}.`,
      parts.proposalGuidance,
    ].join('\n'),
    memoryPolicy: [
      'Use only current input, visible deck context, and explicitly provided source snippets or graph snapshots.',
      'Treat model-generated structure as provisional unless source-grounded evidence is included in the payload.',
      'KnowGraph proposals require source/evidence fields in payload; otherwise target ThinkGraph.',
    ].join('\n'),
  });
}

const INITIAL_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'prompt_magentic',
    content: buildSeedPromptTemplate({
      role: [
        'You are Magentic-One, the conversational orchestrator/router for the visible AgentCanvas.',
      ].join('\n'),
      goal: [
        'chat naturally with the user',
        'understand the active user request',
        'route downstream agents/workflows when useful',
        'explain current state and next step',
        'preserve human-in-loop control',
        'use Plan Agent for real runtime proposals; the Plan projects authoritative sources and provenance-backed proposals',
      ].join('\n'),
      constraints: [
        'Do not dump raw JSON in normal chat unless in debug mode.',
        'Do not perform ThinkGraph extraction yourself.',
        'Do not output provisional entities/relationships as your own answer unless explicitly summarizing ThinkGraph Agent output.',
        'Do not perform Research Agent’s job.',
        'Do not perform KnowGraph Agent’s job.',
        'Do not run research before ThinkGraph has earned a research offer and user approval exists.',
        'Do not treat ThinkGraph reasoning as facts.',
        'Do not silently write KnowGraph.',
      ].join('\n'),
      ioSchema: [
        'Baseline research behavior:',
        '1. Start with chat.',
        '2. Answer naturally. Do not output raw JSON.',
        '3. After a meaningful user/assistant pair, route downstream to ThinkGraph Agent.',
        '4. ThinkGraph Agent reads the completed chat pair and updates the visible ThinkGraph Reveal.',
        '5. If ThinkGraph is sparse, ask the user to clarify.',
        '6. If ThinkGraph is rich enough, offer Plan Research.',
        '7. If user asks to Plan Research, route to Plan Agent.',
        '8. A real Plan Agent proposal may join the Plan only with runtime provenance.',
        '9. Wait for human approval.',
        '10. Only after approval may Research Agent run.',
        '11. Only after source-backed evidence exists may KnowGraph Agent write evidence/gaps.',
        '12. After KnowGraph is populated, answer using separated ThinkGraph and KnowGraph context.',
      ].join('\n'),
      memoryPolicy: [
        'magentic_option is direction-agnostic Magentic-One membership/option.',
        'flow is directed execution/sequence.',
        'Do not rewrite user canvas wiring.',
        'Active Skills: clarify_intent, route_by_graph_state, preserve_human_approval, explain_current_state, avoid_worker_job_leakage',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_main_chat',
    // The Harness driver prompt. This is the ONE LiquidAIty-specific instruction
    // layer appended (never replacing) the vendored base chat prompt — see
    // grpcChatClient.resolveMainChatSystemPrompt. It teaches the live Harness to
    // drive the real run_mag_one spine; it does NOT instruct any tool that does
    // not yet exist (no run-folder writer, no KnowGraph/CodeGraph read tool).
    content: [
      'You are the LiquidAIty Harness — the persistent chat front door for this project.',
      'You are not a worker and you are not the orchestrator. Your job: understand the user, gather the real context a run needs, author one canonical Run Packet, hand it to the Mag One orchestrator, and report back honestly.',
      '',
      'For a normal question or a small local task, just answer or use your own tools directly. Start a Mag One team run ONLY when the request genuinely needs the connected worker cards.',
      '',
      'When a team run is warranted, drive this exact spine:',
      '1. Use the active project and conversation you are already in. Never invent ids.',
      '2. Read relevant durable reasoning with mcp__liquidaity__thinkgraph_get_graph_slice for this project; use only what is relevant. If it returns nothing, say so plainly — never invent memory.',
      '3. Inspect the real connected workers with mcp__liquidaity__mag_one_describe_connected_agents. Use ONLY the workers it reports; never assume a card, tool, or capability that is not in that result.',
      '4. Author ONE canonical Run Packet in Markdown. Include: the user request; the project goal; relevant ThinkGraph state with its source/revision; real constraints and repo law; known blockers; relevant KnowGraph/CodeGraph context ONLY if you actually retrieved it; the connected worker cards and their tools from step 3; ownership boundaries; the evidence each result must carry; the expected result form; and explicit scope exclusions. Describe the goal and let Mag One choose workers — do not force research, coding, or every worker into the run.',
      '5. Send the Run Packet content unchanged to mcp__liquidaity__run_mag_one with the active projectId, the deckId, and the Run Packet Markdown as promptMarkdown. Do not rewrite it into a plan or task list on the way in.',
      '6. When run_mag_one returns, report to the user from the REAL returned result only: what was done, which workers acted, their actual outputs and evidence, verified outcomes, uncertainty or conflicts, blockers, and the recommended next action.',
      '',
      'Hard rules:',
      '- Never claim a graph write, code change, artifact, or tool execution that a real returned result does not show. No result → say the run failed or is blocked, and why.',
      '- Mag One chooses workers from the Run Packet and the real connected set. You never route by card name and never force a specific worker.',
      '- Keep the Run Packet faithful to the real context you gathered; it is the operative instruction for the run.',
    ].join('\n'),
  },
  {
    id: 'prompt_thinkgraph_agent',
    // No ThinkGraph semantic prompt is authored here. The persisted saved
    // ThinkGraph card prompt (project database) is the ONE ThinkGraph
    // semantic instruction source; a new/blank card starts with an empty
    // prompt, never a TypeScript-injected default.
    content: '',
  },
  {
    id: 'prompt_codegraph_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the CodeGraph Agent, a graph-specialist agent for structural code memory.',
        'You work only with CodeGraph, which stores files, symbols, routes, libraries, subsystem boundaries, and dependency/call structure.',
      ].join('\n'),
      goal: [
        'Extract and manage code structure: what does what, what library it uses, what part of the product this belongs to, what depends on what.',
        'CodeGraph is read second by the planner to understand what code areas, subsystems, files, symbols, and routes matter.',
      ].join('\n'),
      constraints: [
        'CodeGraph is structural code memory, separate from ThinkGraph and KnowGraph.',
        'Preserve Codebase-Memory-style usefulness for AI.',
        'Local-first storage is acceptable.',
        'Do not merge CodeGraph with other graph types.',
      ].join('\n'),
      ioSchema: [
        'Input: code analysis request or codebase context.',
        'Output: files, symbols, routes, libraries, subsystem boundaries, dependencies, call structure.',
      ].join('\n'),
      memoryPolicy: [
        'Use current input and existing CodeGraph context.',
        'CodeGraph stores: files, symbols, routes, libraries, subsystems, dependencies, call graphs.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_research_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Research Agent.',
      ].join('\n'),
      goal: [
        'Gather source-backed evidence for and against the thesis.',
      ].join('\n'),
      constraints: [
        'May run only after status = approved_for_research.',
        'Does not write KnowGraph itself.',
      ].join('\n'),
      ioSchema: [
        'Return evidence objects with source, snippet, claim, date if available, provenance.',
      ].join('\n'),
      memoryPolicy: [
        'Use researchable questions and evidence targets from provenance-backed Plan nodes and real ThinkGraph events.',
        'Active Skills: search_confirming_evidence, search_disconfirming_evidence, extract_source_claims, preserve_provenance, avoid_unsourced_claims',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_knowgraph_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the KnowGraph Agent.',
      ].join('\n'),
      goal: [
        'Only store source-backed evidence/gaps/provenance.',
      ].join('\n'),
      constraints: [
        'Must not store ThinkGraph reasoning as fact.',
        'Runs only after Research Agent produces source-backed evidence.',
      ].join('\n'),
      ioSchema: [
        'Input: source-backed evidence from Research Agent.',
        'Output: grounded entities, relationships, evidence summaries, citations, gaps, contradictions, and provenance.',
      ].join('\n'),
      memoryPolicy: [
        'Use current input and existing KnowGraph context.',
        'Active Skills: normalize_evidence_graph, preserve_citations, store_contradictions, store_evidence_gaps, reject_unsourced_reasoning_as_fact',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_assist',
    content: buildSeedPromptTemplate({
      role: [
        'You are an Assist Agent, a general-purpose worker agent.',
        'You perform tasks as directed by the orchestrator or flow.',
      ].join('\n'),
      goal: [
        'Execute the assigned task using available tools and context.',
        'Return clear, actionable results to continue the workflow.',
      ].join('\n'),
      constraints: [
        'Stay within your assigned scope.',
        'Use tools appropriately and efficiently.',
        'Return results in the expected format.',
      ].join('\n'),
      ioSchema: [
        'Input: task description and context from upstream nodes.',
        'Output: task results for downstream nodes.',
      ].join('\n'),
      memoryPolicy: [
        'Use provided context and upstream inputs.',
        'Store intermediate results if needed for downstream agents.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_plan_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Plan Agent.',
      ].join('\n'),
      goal: [
        'Read ThinkGraph readiness.',
        'Expose real ThinkGraph events beside provenance-backed Plan nodes.',
        'Expose graph richness / missing pieces when idea is not ready.',
        'Offer Plan Research when ThinkGraph is ready.',
        'Create research plan after user asks to plan research.',
        'Require approval before research runs.',
        'Expose approved research state and results.',
        'Expose divergence between subjective ThinkGraph and objective KnowGraph.',
      ].join('\n'),
      constraints: [
        'Do not fake local planning.',
      ].join('\n'),
      ioSchema: [
        'Input: activation proposal or planning context.',
        'Output: a visible plan/approval workspace for human review.',
      ].join('\n'),
      memoryPolicy: [
        'Keep planning visible and user-approved before graph changes are applied.',
        'Active Skills: expose_thinkgraph_events, project_planflow_sources, request_approval, show_missing_slots, show_subjective_vs_objective',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_worldsignals_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the WorldSignals Agent.',
        'You represent the WorldSignals surface as a visible system capability.',
      ].join('\n'),
      goal: [
        'Expose the WorldSignals workspace when the user activates outside-world context.',
      ].join('\n'),
      constraints: [
        'Do not call backend model runtime from this card.',
        'Use the existing WorldSignals surface for interaction.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future WorldSignals request.',
        'Output: open or focus the WorldSignals workspace surface.',
      ].join('\n'),
      memoryPolicy: [
        'This card is a visible system gateway to the WorldSignals surface.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_trading_workbench',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Trading Agent workbench card.',
        'You represent the visible trading and market analysis workspace on the board.',
      ].join('\n'),
      goal: [
        'Expose the Trading workspace as a connectable workbench capability.',
        'Keep this staged until the app-owned trading runtime and broker bridge are restored.',
      ].join('\n'),
      constraints: [
        'Do not call backend model runtime from this card.',
        'Do not imply live broker execution, order routing, or profit claims.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future trading workbench request.',
        'Output: open or focus the Trading workspace surface.',
      ].join('\n'),
      memoryPolicy: [
        'Treat this as a visible activation stub for the future trading bridge.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_code_workbench',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Code Agent workbench card.',
        'You represent the visible code workspace on the board.',
      ].join('\n'),
      goal: [
        'Expose the Code workspace as a connectable workbench capability.',
        'Keep this staged until the app-owned code bridge is restored.',
      ].join('\n'),
      constraints: [
        'Do not call backend model runtime from this card.',
        'Do not claim files changed, tests passed, or diffs exist unless a real code bridge produced them.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future code workbench request.',
        'Output: open or focus the Code workspace surface.',
      ].join('\n'),
      memoryPolicy: [
        'Treat this as a visible activation stub for the future code workflow.',
      ].join('\n'),
    }),
  },
];

const INITIAL_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'template_magentic',
    name: 'Magentic-One',
    promptTemplate: 'prompt_magentic',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_main_chat',
    name: 'Main Chat / Harness',
    promptTemplate: 'prompt_main_chat',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_thinkgraph_agent',
    name: 'ThinkGraph Agent',
    promptTemplate: 'prompt_thinkgraph_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_codegraph_agent',
    name: 'CodeGraph Agent',
    promptTemplate: 'prompt_codegraph_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_research_agent',
    name: 'Research Agent',
    promptTemplate: 'prompt_research_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_knowgraph_agent',
    name: 'KnowGraph Agent',
    promptTemplate: 'prompt_knowgraph_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
  },
  {
    id: 'template_assist',
    name: 'Assist',
    promptTemplate: 'prompt_assist',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_local_coder',
    name: 'Local Coder',
    promptTemplate: 'prompt_assist',
    model: LOCAL_CODER_CONTROLLER_MODEL_KEY,
    provider: LOCAL_CODER_CONTROLLER_PROVIDER,
    temperature: 0.2,
    maxTokens: 1200,
    tools: [...LOCAL_CODER_CONTROLLER_TOOLS],
  },
  {
    id: 'template_plan_agent',
    name: 'Plan Agent',
    promptTemplate: 'prompt_plan_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_worldsignals_agent',
    name: 'WorldSignals Agent',
    promptTemplate: 'prompt_worldsignals_agent',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_trading_workbench',
    name: 'Trading Agent',
    promptTemplate: 'prompt_trading_workbench',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_code_workbench',
    name: 'Code Agent',
    promptTemplate: 'prompt_code_workbench',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_data_formulator_workbench',
    name: 'Data Formulator',
    promptTemplate: 'prompt_assist',
    model: DEFAULT_CARD_MODEL_KEY,
    provider: DEFAULT_CARD_PROVIDER,
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
];

export const INITIAL_DECK: DeckDocument = {
  id: 'deck_builder',
  name: 'Agent Card Deck',
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  promptTemplates: cloneDeckDocument(INITIAL_PROMPT_TEMPLATES),
  version: 3,
  nodes: [
    {
      // The Harness front-door card. runtimeBinding 'main_chat' is the ONLY thing
      // that matters here: grpcChatClient reads this card's saved prompt/model
      // and appends the prompt to the live Harness chat. It is visually
      // bus-connected as the front door, but never a doorway or Mag One worker
      // (runtime filters exclude main_chat).
      id: 'card_main_chat',
      kind: 'agent',
      templateId: 'template_main_chat',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_main_chat',
        )?.content || '',
      runtimeBinding: 'main_chat',
      runtimeType: 'assistant_agent',
      runtimeOptions: {
        provider: DEFAULT_CARD_PROVIDER,
        modelKey: DEFAULT_CARD_MODEL_KEY,
      },
      parentGraphId: null,
      title: 'Main Chat / Harness',
      subtitle: 'Native Harness front door',
      position: { x: -24, y: -24 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_magentic',
      kind: 'agent',
      templateId: 'template_magentic',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_magentic',
        )?.content || '',
      runtimeBinding: null,
      runtimeType: 'magentic_one',
      runtimeOptions: {
        executionBackend: 'python_autogen',
        provider: DEFAULT_CARD_PROVIDER,
        modelKey: DEFAULT_CARD_MODEL_KEY,
        maxTurns: 2,
        maxStalls: 1,
      },
      parentGraphId: null,
      title: 'Magentic-One',
      subtitle: 'Admin orchestrator / planner',
      position: { x: 140, y: 120 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_thinkgraph_agent',
      kind: 'agent',
      templateId: 'template_thinkgraph_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_thinkgraph_agent',
        )?.content || '',
      runtimeBinding: 'thinkgraph_agent',
      runtimeType: 'assistant_agent',
      // Exactly the two scoped ThinkGraph tools — the card's ONLY write authority.
      // Default model follows the existing default-card convention and stays fully
      // editable on the card (canvas remains the source of truth).
      runtimeOptions: {
        tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'],
        modelKey: 'openai/gpt-5.1-chat',
        provider: 'openrouter',
      },
      parentGraphId: null,
      title: 'ThinkGraph Agent',
      subtitle: 'Provisional / planning memory (AGE)',
      position: { x: 0, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_codegraph_agent',
      kind: 'agent',
      templateId: 'template_codegraph_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_codegraph_agent',
        )?.content || '',
      runtimeBinding: 'codegraph_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: null,
      title: 'CodeGraph Agent',
      subtitle: 'Structural code memory',
      position: { x: -170, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_research_agent',
      kind: 'agent',
      templateId: 'template_research_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_research_agent',
        )?.content || '',
      runtimeBinding: 'research_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: null,
      title: 'Research Agent',
      subtitle: 'Research and analysis worker',
      position: { x: -340, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_knowgraph_agent',
      kind: 'agent',
      templateId: 'template_knowgraph_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_knowgraph_agent',
        )?.content || '',
      runtimeBinding: 'knowgraph_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: null,
      title: 'KnowGraph Agent',
      subtitle: 'Grounded / evidence-backed memory (Neo4j)',
      position: { x: -510, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_local_coder',
      kind: 'agent',
      templateId: 'template_local_coder',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_assist',
        )?.content || '',
      runtimeBinding: 'local_coder',
      runtimeType: 'local_coder',
      runtimeOptions: {
        provider: LOCAL_CODER_CONTROLLER_PROVIDER,
        modelKey: LOCAL_CODER_CONTROLLER_MODEL_KEY,
        tools: [...LOCAL_CODER_CONTROLLER_TOOLS],
      },
      parentGraphId: null,
      title: 'Local Coder',
      subtitle: 'Controlled code patch/test execution',
      position: { x: 520, y: 320 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_trading_workbench',
      kind: 'agent',
      templateId: 'template_trading_workbench',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_trading_workbench',
        )?.content || '',
      runtimeBinding: 'trading_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: 'workbench_trading',
      title: 'Trading Agent',
      subtitle: 'Market workspace',
      position: { x: 520, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_code_workbench',
      kind: 'agent',
      templateId: 'template_code_workbench',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_code_workbench',
        )?.content || '',
      runtimeBinding: 'code_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: 'workbench_code',
      title: 'Code Agent',
      subtitle: 'Scoped repo tasks',
      position: { x: 1040, y: 140 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_data_formulator_workbench',
      kind: 'agent',
      templateId: 'template_data_formulator_workbench',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_assist',
        )?.content || '',
      runtimeBinding: 'data_formulator_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: 'workbench_data_formulator',
      title: 'Data Formulator',
      subtitle: 'Embedded upstream app',
      position: { x: 1220, y: 320 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_plan_agent',
      kind: 'agent',
      templateId: 'template_plan_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_plan_agent',
        )?.content || '',
      runtimeBinding: 'plan_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: null,
      title: 'Plan Agent',
      subtitle: 'Approval and planning surface',
      position: { x: 0, y: 380 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_worldsignals_agent',
      kind: 'agent',
      templateId: 'template_worldsignals_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_worldsignals_agent',
        )?.content || '',
      runtimeBinding: 'worldsignals_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: null,
      title: 'WorldSignals Agent',
      subtitle: 'Outside-world context surface',
      position: { x: 0, y: 260 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
  ],
  edges: [
    {
      id: 'edge_main_chat_harness_bus',
      source: 'card_main_chat',
      target: 'card_magentic',
      targetHandle: 'bus-in-0',
      edgeType: 'magentic_option',
    },
  ],
};

const BUILDER_DECK_ID = INITIAL_DECK.id;
const SYSTEM_CARD_RUNTIME_BINDINGS: Record<string, RuntimeBinding> = {
  card_assist: 'assist',
  card_local_coder: 'local_coder',
  // New specialist graph roles (current seeded Admin model)
  card_thinkgraph_agent: 'thinkgraph_agent',
  card_codegraph_agent: 'codegraph_agent',
  card_research_agent: 'research_agent',
  card_knowgraph_agent: 'knowgraph_agent',
  card_plan_agent: 'plan_agent',
  card_worldsignals_agent: 'worldsignals_agent',
  card_trading_workbench: 'trading_agent',
  card_code_workbench: 'code_agent',
  card_data_formulator_workbench: 'data_formulator_agent',
  // Backward compatibility: legacy card IDs for existing saved decks
  card_main_chat: 'main_chat',
  card_kg_ingest: 'kg_ingest',
  card_research: 'research_agent',
  card_knowgraph: 'knowgraph',
  card_neo4j: 'neo4j',
};

const SYSTEM_CAPABILITY_REGISTRY = {
  openclaudeHarness: {
    label: 'LocalCoder / OpenClaude Harness',
    cardId: 'card_local_coder',
    runtimeBinding: 'local_coder' as const,
    routePrefix: '/api/coder/openclaude',
  },
} as const;
void SYSTEM_CAPABILITY_REGISTRY;

const BASELINE_OPTIONAL_CARD_IDS = new Set([
  'card_local_coder',
  'card_plan_agent',
  'card_worldsignals_agent',
  'card_trading_workbench',
  'card_code_workbench',
  'card_data_formulator_workbench',
]);
const REMOVED_DEFAULT_CARD_IDS = new Set(['card_assist']);
const REMOVED_DEFAULT_EDGE_IDS = new Set([
  'edge_magentic_research',
  'edge_magentic_assist',
  'edge_knowgraph_research',
  'edge_research_codegraph',
  'edge_codegraph_thinkgraph',
]);
const LEGACY_SYSTEM_CARD_IDS = new Set([
  'card_main_chat',
  'card_kg_ingest',
  'card_research',
  'card_knowgraph',
  'card_neo4j',
]);

function cloneDeckDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeRuntimeBinding(value: unknown): RuntimeBinding | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === 'assist') return 'assist';
  if (normalized === 'local_coder') return 'local_coder';
  if (normalized === 'main_chat') return 'main_chat';
  if (normalized === 'kg_ingest') return 'kg_ingest';
  if (normalized === 'research_agent') return 'research_agent';
  if (normalized === 'knowgraph') return 'knowgraph';
  if (normalized === 'neo4j') return 'neo4j';
  if (normalized === 'thinkgraph_agent') return 'thinkgraph_agent';
  if (normalized === 'codegraph_agent') return 'codegraph_agent';
  if (normalized === 'knowgraph_agent') return 'knowgraph_agent';
  if (normalized === 'plan_agent') return 'plan_agent';
  if (normalized === 'worldsignals_agent') return 'worldsignals_agent';
  if (normalized === 'trading_agent') return 'trading_agent';
  if (normalized === 'code_agent') return 'code_agent';
  if (normalized === 'data_formulator_agent') return 'data_formulator_agent';
  return null;
}

export function filterAuthoringCompatibleEdges(
  nodes: AgentCardInstance[],
  edges: DeckEdge[],
): DeckEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));

  return edges
    .filter((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) return false;

      const edgeType = normalizeDeckEdgeType(edge.edgeType);
      if (edgeType === 'magentic_option') {
        return (
          normalizeRuntimeType(sourceNode.runtimeType) === 'magentic_one' &&
          isTopLevelCanvasCard(sourceNode) &&
          isTopLevelCanvasCard(targetNode) &&
          ['assistant_agent', 'local_coder', 'graph_flow'].includes(
            normalizeRuntimeType(targetNode.runtimeType) || '',
          )
        );
      }

      if (
        normalizeRuntimeType(sourceNode.runtimeType) === 'graph_flow' &&
        cleanOptionalText(targetNode.parentGraphId) === sourceNode.id
      ) {
        return true;
      }

      return isVisibleAssistFlowPair(sourceNode, targetNode);
    })
    .map((edge) => cloneDeckDocument(edge));
}

function normalizeDeckNodes(value: unknown): AgentCardInstance[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_DECK.nodes);
  }
  if (value.length === 0) {
    return [];
  }
  const nextNodes = value.filter((node): node is AgentCardInstance =>
    Boolean(
      node &&
      typeof node === 'object' &&
      !REMOVED_DEFAULT_CARD_IDS.has(
        safeText((node as Partial<AgentCardInstance>).id).trim(),
      ) &&
      safeText((node as Partial<AgentCardInstance>).kind)
        .trim()
        .toLowerCase() !== 'blackboard' &&
      typeof (node as AgentCardInstance).id === 'string' &&
      typeof (node as AgentCardInstance).templateId === 'string',
    ),
  );
  const normalizedNodes =
    nextNodes.length > 0
      ? nextNodes.map((node) => ({
        id: safeText(node.id).trim(),
        kind: 'agent' as const,
        templateId: safeText(node.templateId).trim(),
        prompt: typeof node.prompt === 'string' ? node.prompt : '',
        runtimeBinding: normalizeRuntimeBinding(
          node.runtimeBinding ??
            SYSTEM_CARD_RUNTIME_BINDINGS[safeText(node.id).trim()] ??
            null,
        ),
        runtimeType:
          normalizeRuntimeType(node.runtimeType) ?? 'assistant_agent',
        runtimeOptions: normalizeRuntimeOptions(node.runtimeOptions),
        parentGraphId: cleanOptionalText(node.parentGraphId),
        title:
          safeText(node.title || node.id).trim() || safeText(node.id).trim(),
        subtitle: typeof node.subtitle === 'string' ? node.subtitle : undefined,
        position:
          node.position && typeof node.position === 'object'
            ? {
                x: Number((node.position as { x?: unknown }).x) || 0,
                y: Number((node.position as { y?: unknown }).y) || 0,
              }
            : { x: 0, y: 0 },
        overrides: node.overrides,
        status:
          node.status === 'idle' ||
          node.status === 'ready' ||
          node.status === 'running' ||
          node.status === 'error'
            ? node.status
            : undefined,
        cloneConfig:
          node.cloneConfig && typeof node.cloneConfig === 'object'
            ? node.cloneConfig
            : undefined,
      }))
      : [];
  return normalizedNodes.filter((node) => !isLegacyUaCard(node));
}

function normalizeDeckPromptTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_PROMPT_TEMPLATES);
  }
  if (value.length === 0) {
    return [];
  }
  const nextPromptTemplates = value.filter(
    (template): template is PromptTemplate =>
      Boolean(
        template &&
        typeof template === 'object' &&
        typeof (template as PromptTemplate).id === 'string' &&
        typeof (template as PromptTemplate).content === 'string',
      ),
  );
  return nextPromptTemplates.length > 0
    ? cloneDeckDocument(nextPromptTemplates)
    : cloneDeckDocument(INITIAL_PROMPT_TEMPLATES);
}

function normalizeDeckEdges(value: unknown): DeckEdge[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_DECK.edges);
  }
  return cloneDeckDocument(
    sanitizeDeckEdges(value).filter(
      (edge) =>
        safeText(edge.id).trim() !== 'edge_magentic_thinkgraph' &&
        !REMOVED_DEFAULT_EDGE_IDS.has(safeText(edge.id).trim()),
    ),
  );
}

function slugifyDeckIdPart(value: string): string {
  return (
    safeText(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'card'
  );
}

function buildDeckNodeFromPreset(
  preset: DeckNodePreset,
  promptTemplates: PromptTemplate[],
  position: { x: number; y: number },
  options: {
    title?: string;
    parentGraphId?: string | null;
  } = {},
): AgentCardInstance {
  const promptTemplateContent = preset.promptTemplateId
    ? promptTemplates.find(
        (template) => template.id === preset.promptTemplateId,
      )?.content ||
      INITIAL_PROMPT_TEMPLATES.find(
        (template) => template.id === preset.promptTemplateId,
      )?.content ||
      ''
    : '';
  const slug = slugifyDeckIdPart(preset.key);

  return {
    id: `card_${slug}_${uid()}`,
    kind: 'agent',
    templateId: preset.templateId,
    prompt: promptTemplateContent,
    runtimeBinding: preset.runtimeBinding,
    runtimeType: preset.runtimeType,
    runtimeOptions: null,
    parentGraphId: cleanOptionalText(options.parentGraphId),
    title: options.title || preset.title,
    subtitle: preset.subtitle,
    position,
    status: 'ready',
    cloneConfig: { enabled: false, seeds: [] },
  };
}

function getNextGraphScopedAssistTitle(
  deck: DeckDocument,
  graphOwnerId: string,
): string {
  const assistCount = deck.nodes.filter(
    (node) =>
      cleanOptionalText(node.parentGraphId) === graphOwnerId &&
      isAssistLikeRuntimeType(normalizeRuntimeType(node.runtimeType)),
  ).length;
  return `Assist ${assistCount + 1}`;
}

function resolveQuickAddParentGraphId(
  preset: DeckNodePreset,
  anchorNode: AgentCardInstance | null,
): string | null {
  if (
    (preset.runtimeType !== 'assistant_agent' &&
      preset.runtimeType !== 'local_coder') ||
    !anchorNode
  ) {
    return null;
  }

  const anchorParentGraphId = cleanOptionalText(anchorNode.parentGraphId);
  if (anchorParentGraphId) {
    return anchorParentGraphId;
  }

  if (
    normalizeRuntimeType(anchorNode.runtimeType) === 'graph_flow' &&
    isTopLevelCanvasCard(anchorNode)
  ) {
    return anchorNode.id;
  }

  return null;
}

function resolveQuickAddEdge(
  anchorNode: AgentCardInstance | null,
  nextNode: AgentCardInstance,
): DeckEdge | null {
  if (!anchorNode) return null;

  const anchorRuntimeType = normalizeRuntimeType(anchorNode.runtimeType);
  const nextRuntimeType = normalizeRuntimeType(nextNode.runtimeType);
  let edgeType: DeckEdgeType | null = null;

  if (
    anchorRuntimeType === 'magentic_one' &&
    isTopLevelCanvasCard(anchorNode) &&
    isTopLevelCanvasCard(nextNode) &&
    (nextRuntimeType === 'assistant_agent' ||
      nextRuntimeType === 'local_coder' ||
      nextRuntimeType === 'graph_flow')
  ) {
    edgeType = 'magentic_option';
  } else if (isVisibleAssistFlowPair(anchorNode, nextNode)) {
    edgeType = 'flow';
  }

  if (!edgeType) return null;

  const legacyCompatibility = Boolean(
    anchorRuntimeType === 'graph_flow' ||
    nextRuntimeType === 'graph_flow' ||
    cleanOptionalText(anchorNode.parentGraphId) ||
    cleanOptionalText(nextNode.parentGraphId),
  );

  return {
    id: `edge_${slugifyDeckIdPart(anchorNode.id)}_${slugifyDeckIdPart(nextNode.id)}_${uid()}`,
    source: anchorNode.id,
    target: nextNode.id,
    edgeType,
    metadata: buildDefaultDeckEdgeMetadata(edgeType, { legacyCompatibility }),
  };
}

function getSuggestedDeckNodePosition(
  deck: DeckDocument,
  preset: DeckNodePreset,
  anchorNode: AgentCardInstance | null,
): { x: number; y: number } {
  if (anchorNode) {
    const outgoingCount = deck.edges.filter(
      (edge) => edge.source === anchorNode.id,
    ).length;
    return {
      x: anchorNode.position.x + 320,
      y: anchorNode.position.y + outgoingCount * 180,
    };
  }

  const rightMostX = deck.nodes.reduce(
    (max, node) => Math.max(max, node.position.x),
    -220,
  );
  const nextColumnX = rightMostX + 320;
  const visibleTopLevelAgentXs = deck.nodes
    .filter(
      (node) =>
        !cleanOptionalText(node.parentGraphId) &&
        normalizeRuntimeType(node.runtimeType) !== 'magentic_one',
    )
    .map((node) => node.position.x);
  const wrappedColumnX =
    nextColumnX > 1040 && visibleTopLevelAgentXs.length > 0
      ? Math.min(...visibleTopLevelAgentXs)
      : nextColumnX;
  const occupiedInNextColumn = deck.nodes.filter(
    (node) => Math.abs(node.position.x - wrappedColumnX) < 72,
  ).length;
  return {
    x: wrappedColumnX,
    y: (wrappedColumnX === nextColumnX ? 40 : 140) + occupiedInNextColumn * 180,
  };
}

export function buildQuickAddDeckMutation(
  deck: DeckDocument,
  preset: DeckNodePreset,
  anchorNodeId: string | null,
): {
  nextDeck: DeckDocument;
  nextNode: AgentCardInstance;
  nextEdge: DeckEdge | null;
} {
  const anchorNode =
    deck.nodes.find((node) => node.id === anchorNodeId) || null;
  const nextParentGraphId = resolveQuickAddParentGraphId(preset, anchorNode);
  const nextTitle =
    nextParentGraphId &&
    (preset.runtimeType === 'assistant_agent' ||
      preset.runtimeType === 'local_coder')
      ? getNextGraphScopedAssistTitle(deck, nextParentGraphId)
      : preset.title;
  const nextNode = buildDeckNodeFromPreset(
    preset,
    deck.promptTemplates,
    getSuggestedDeckNodePosition(deck, preset, anchorNode),
    {
      title: nextTitle,
      parentGraphId: nextParentGraphId,
    },
  );
  const nextEdge = resolveQuickAddEdge(anchorNode, nextNode);

  return {
    nextDeck: {
      ...deck,
      version: deck.version + 1,
      nodes: [...deck.nodes, nextNode],
      edges: nextEdge ? [...deck.edges, nextEdge] : [...deck.edges],
    },
    nextNode,
    nextEdge,
  };
}

export type AssistStarterDeckMutation = {
  nextDeck: DeckDocument;
  createdNodes: AgentCardInstance[];
  createdEdges: DeckEdge[];
  focusNodeId: string | null;
  recipe: AssistStarterRecipe;
};

export function buildAssistStarterDeckMutation(
  deck: DeckDocument,
  anchorNodeId: string | null,
): AssistStarterDeckMutation | null {
  const anchorNode =
    deck.nodes.find((node) => node.id === anchorNodeId) || null;
  const recipe = getAssistStarterRecipe(anchorNode);
  if (!recipe) return null;

  let workingDeck = deck;
  let workingAnchorId = anchorNodeId;
  const createdNodes: AgentCardInstance[] = [];
  const createdEdges: DeckEdge[] = [];

  recipe.presetKeys.forEach((presetKey) => {
    const preset = findDeckNodePreset(presetKey);
    if (!preset) return;

    const mutation = buildQuickAddDeckMutation(
      workingDeck,
      preset,
      workingAnchorId,
    );
    workingDeck = mutation.nextDeck;
    workingAnchorId = mutation.nextNode.id;
    createdNodes.push(mutation.nextNode);
    if (mutation.nextEdge) {
      createdEdges.push(mutation.nextEdge);
    }
  });

  return {
    nextDeck: workingDeck,
    createdNodes,
    createdEdges,
    focusNodeId:
      createdNodes[recipe.focusNodeIndex]?.id || createdNodes[0]?.id || null,
    recipe,
  };
}

function formatBuilderStatusMessage(
  message: unknown,
  fallback: string,
): string {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (!text) return fallback;
  if (text === 'project_not_found')
    return 'Canvas data is unavailable for this selection.';
  if (text === 'deck_load_failed') return 'Canvas data could not be loaded.';
  if (text === 'deck_save_failed') return 'Could not save the current board.';
  if (text === 'card_run_failed') return 'Card run failed.';
  if (text === 'deck_run_failed') return 'Board run failed.';
  if (text === 'template_not_found')
    return 'The selected card template could not be resolved.';
  if (text === 'templates_required')
    return 'The selected card could not be run because its template set was missing.';
  if (text === 'card_required')
    return 'No card was provided to the backend run path.';
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('quota exceeded') ||
    (lower.includes('quota') && lower.includes('billing'))
  ) {
    return 'The configured model could not run because provider quota or billing is unavailable right now.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'The configured model is rate-limited right now. Try this card again shortly.';
  }
  if (
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key')
  ) {
    return 'The configured model request was rejected by the provider. Check the backend credentials for this card.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('load failed')
  ) {
    return 'The Builder backend is unavailable right now.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'The configured model timed out before the card completed.';
  }
  return text;
}

function seedCurrentSystemCardsIntoLegacyDeck(
  deck: DeckDocument,
): DeckDocument {
  const legacyCompatibleNodeIds = new Set([
    ...Array.from(LEGACY_SYSTEM_CARD_IDS),
    ...Array.from(BASELINE_OPTIONAL_CARD_IDS),
  ]);
  const hasOnlyLegacySystemNodes =
    deck.nodes.length > 0 &&
    deck.nodes.some((node) => LEGACY_SYSTEM_CARD_IDS.has(node.id)) &&
    deck.nodes.every((node) => legacyCompatibleNodeIds.has(node.id));
  void hasOnlyLegacySystemNodes;
  if (!hasOnlyLegacySystemNodes) {
    return deck;
  }

  const existingNodesById = new Map(
    deck.nodes.map((node) => [node.id, node] as const),
  );
  const existingPromptTemplatesById = new Map(
    deck.promptTemplates.map((template) => [template.id, template] as const),
  );
  const initialPromptTemplateIds = new Set(
    INITIAL_PROMPT_TEMPLATES.map((template) => template.id),
  );
  const upgradedNodes: AgentCardInstance[] = INITIAL_DECK.nodes.map(
    (seedNode): AgentCardInstance => {
      const existingNode = existingNodesById.get(seedNode.id);
      if (!existingNode) {
        return cloneDeckDocument(seedNode);
      }

      const nextTitle =
        seedNode.id === 'card_research' &&
        String(existingNode.title || '').trim() === 'Research'
          ? seedNode.title
          : existingNode.title || seedNode.title;
      const nextSubtitle =
        seedNode.id === 'card_research' &&
        String(existingNode.subtitle || '').trim() === 'Gather upstream inputs'
          ? seedNode.subtitle
          : existingNode.subtitle || seedNode.subtitle;
      return {
        ...cloneDeckDocument(seedNode),
        ...cloneDeckDocument(existingNode),
        kind: 'agent',
        prompt:
          typeof (existingNode as any).prompt === 'string'
            ? (existingNode as any).prompt
            : seedNode.prompt || '',
        title: nextTitle,
        subtitle: nextSubtitle,
        runtimeBinding: normalizeRuntimeBinding(
          existingNode.runtimeBinding ?? seedNode.runtimeBinding ?? null,
        ),
        runtimeType: normalizeRuntimeType(
          existingNode.runtimeType ?? seedNode.runtimeType ?? 'assistant_agent',
        ),
        runtimeOptions: normalizeRuntimeOptions(
          existingNode.runtimeOptions ?? seedNode.runtimeOptions ?? null,
        ),
        parentGraphId: cleanOptionalText(
          existingNode.parentGraphId ?? seedNode.parentGraphId ?? null,
        ),
        position: existingNode.position || seedNode.position,
        overrides: existingNode.overrides,
        status: existingNode.status ?? seedNode.status,
        cloneConfig: existingNode.cloneConfig ?? seedNode.cloneConfig,
      };
    },
  );

  const upgradedPromptTemplates = [
    ...INITIAL_PROMPT_TEMPLATES.map((seedTemplate) =>
      cloneDeckDocument(
        existingPromptTemplatesById.get(seedTemplate.id) || seedTemplate,
      ),
    ),
    ...deck.promptTemplates
      .filter((template) => !initialPromptTemplateIds.has(template.id))
      .map((template) => cloneDeckDocument(template)),
  ];

  // Preserve persisted edge state exactly; never infer/merge seed edges during hydration.
  const nextEdges = filterAuthoringCompatibleEdges(upgradedNodes, deck.edges);

  return {
    ...deck,
    version: Math.max(deck.version, INITIAL_DECK.version),
    promptTemplates: upgradedPromptTemplates,
    nodes: upgradedNodes,
    edges: nextEdges,
  };
}

export function hydrateDeckDocument(
  value: Partial<DeckDocument> | null | undefined,
): DeckDocument {
  if (!value || typeof value !== 'object') {
    return cloneDeckDocument(INITIAL_DECK);
  }
  const hasExplicitNodes = Array.isArray(value.nodes);
  const nextEdges = Array.isArray(value.edges)
    ? normalizeDeckEdges(value.edges)
    : hasExplicitNodes
      ? []
      : normalizeDeckEdges(value.edges);
  const hydratedDeck = seedCurrentSystemCardsIntoLegacyDeck({
    ...cloneDeckDocument(INITIAL_DECK),
    ...value,
    id: String(value.id || INITIAL_DECK.id).trim() || INITIAL_DECK.id,
    name: String(value.name || INITIAL_DECK.name).trim() || INITIAL_DECK.name,
    version: Number.isFinite(Number(value.version))
      ? Number(value.version)
      : INITIAL_DECK.version,
    nodes: normalizeDeckNodes(value.nodes),
    edges: nextEdges,
    promptTemplates: normalizeDeckPromptTemplates(value.promptTemplates),
  });
  const bannedNodeIds = new Set(['card_synthesis', 'card_review']);
  const bannedPromptTemplateIds = new Set([
    'prompt_synthesis',
    'prompt_review',
  ]);
  const baseDeck = {
    ...hydratedDeck,
    nodes: hydratedDeck.nodes
      .filter((node) => !bannedNodeIds.has(node.id))
      .map(normalizeLocalCoderControllerCard),
    edges: hydratedDeck.edges.filter(
      (edge) =>
        !bannedNodeIds.has(edge.source) && !bannedNodeIds.has(edge.target),
    ),
    promptTemplates: hydratedDeck.promptTemplates.filter(
      (template) => !bannedPromptTemplateIds.has(template.id),
    ),
  };
  return baseDeck;
}

export function resolveProjectDeckPayload(
  deckPayload: Partial<DeckDocument> | null | undefined,
): { deck: DeckDocument; usedFallback: boolean } {
  if (!deckPayload || typeof deckPayload !== 'object') {
    return {
      deck: hydrateDeckDocument(INITIAL_DECK),
      usedFallback: true,
    };
  }

  return {
    deck: hydrateDeckDocument(deckPayload),
    usedFallback: false,
  };
}

export function resolveProjectDeckLoadResult(
  currentDeck: DeckDocument,
  deckPayload: Partial<DeckDocument> | null | undefined,
  preserveCurrentOnFailure = false,
): {
  deck: DeckDocument;
  usedFallback: boolean;
  preservedCurrent: boolean;
} {
  if (preserveCurrentOnFailure) {
    return {
      deck: cloneDeckDocument(currentDeck),
      usedFallback: false,
      preservedCurrent: true,
    };
  }

  const resolved = resolveProjectDeckPayload(deckPayload);
  return {
    ...resolved,
    preservedCurrent: false,
  };
}

function buildProjectlessDeckDocument(): DeckDocument {
  return hydrateDeckDocument({
    id: INITIAL_DECK.id,
    name: INITIAL_DECK.name,
    version: INITIAL_DECK.version,
    promptTemplates: INITIAL_DECK.promptTemplates,
    nodes: [],
    edges: [],
  });
}

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
function loadProjectState(_projectId: string) {
  return {
    messages: [...EMPTY_PROJECT_STATE.messages],
    links: [...EMPTY_PROJECT_STATE.links],
  };
}

// helper: convert AGE query results to graph nodes/edges for visualization
/** Mean synodic month in days (NASA/USNO convention). */
const SYNODIC_MONTH_DAYS = 29.530588861;
/** Reference Julian Date of a known new moon (2000-01-06 18:14 UTC ≈ JD 2451550.09765). */
const REF_NEW_MOON_JD = 2451550.09765;

function julianDateUtc(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5;
}

/**
 * Synodic phase in [0,1): 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter, 1≡0 new.
 * Waxing for p in (0, 0.5), waning for p in (0.5, 1).
 */
function synodicPhaseFromDate(d: Date): number {
  const jd = julianDateUtc(d);
  let age = (jd - REF_NEW_MOON_JD) % SYNODIC_MONTH_DAYS;
  if (age < 0) age += SYNODIC_MONTH_DAYS;
  return age / SYNODIC_MONTH_DAYS;
}

/** Illuminated fraction of the lunar disk (0=new … 1=full … 0=new). */
function moonIllumination(phase01: number): number {
  const p = ((phase01 % 1) + 1) % 1;
  return 0.5 * (1 - Math.cos(2 * Math.PI * p));
}

/**
 * For two unit circles (R=1) whose centers are distance d=2t apart (t in [0,1]),
 * fraction of the left disk covered by the right disk (overlap / π).
 * Monotonic decreasing in t: t=0 → 1, t=1 → 0.
 */
function overlapFractionTwoUnitCircles(t: number): number {
  const tt = Math.min(1, Math.max(0, t));
  return (
    (2 / Math.PI) * (Math.acos(tt) - tt * Math.sqrt(Math.max(0, 1 - tt * tt)))
  );
}

/** Invert overlap fraction to separation parameter t=d/(2R) for the two-circle terminator model. */
function separationTFromOverlapFraction(targetOverlap: number): number {
  const g = Math.min(1, Math.max(0, targetOverlap));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const v = overlapFractionTwoUnitCircles(mid);
    if (v > g) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

type BuilderRailMoonOrbProps = {
  /** Synodic phase in [0,1); values outside are wrapped. */
  phase01: number;
};

/**
 * Code-driven lunar terminator: same-radius eclipser circle (true circular arc terminator),
 * waxing lit on the right, waning lit on the left. Overlap geometry inverts
 * illumination k = 0.5*(1-cos(2πp)) via overlap = 1 - k on the lit mask.
 */
function BuilderRailMoonOrb({
  phase01,
}: BuilderRailMoonOrbProps): React.ReactElement {
  const uid = React.useId().replace(/:/g, '');
  const diskClipId = `moon-disk-${uid}`;
  const litMaskId = `moon-lit-${uid}`;
  const litGradId = `moon-lit-grad-${uid}`;
  const baseGradId = `moon-base-grad-${uid}`;
  const glowFilterId = `moon-glow-${uid}`;

  const p = ((phase01 % 1) + 1) % 1;
  const illumination = moonIllumination(p);
  const targetOverlap = 1 - illumination;
  const t = separationTFromOverlapFraction(targetOverlap);

  const R = 14;
  const cx = 14;
  const cy = 14;
  const waxing = p <= 0.5;
  const sep = 2 * R * t;
  const shadowCx = waxing ? cx - sep : cx + sep;

  const limbGlowOpacity = 0.06 + 0.14 * illumination;
  const purpleRimOpacity = 0.12 + 0.08 * illumination;

  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 28 28"
      role="img"
      aria-label={`Moon phase ${Math.round(illumination * 100)}% illuminated`}
    >
      <defs>
        <radialGradient id={baseGradId} cx="38%" cy="35%" r="72%">
          <stop offset="0%" stopColor="rgba(12,42,52,0.98)" />
          <stop offset="55%" stopColor="rgba(30,89,102,0.96)" />
          <stop offset="100%" stopColor="rgba(6,22,30,0.98)" />
        </radialGradient>
        <radialGradient id={litGradId} cx="32%" cy="30%" r="78%">
          <stop offset="0%" stopColor="rgba(255,252,244,0.98)" />
          <stop offset="42%" stopColor="rgba(255,228,196,0.92)" />
          <stop offset="100%" stopColor="rgba(223,146,84,0.55)" />
        </radialGradient>
        <filter id={glowFilterId} x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.9" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={diskClipId}>
          <circle cx={cx} cy={cy} r={R} />
        </clipPath>
        <mask id={litMaskId} maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="28" height="28" fill="white" />
          <circle cx={shadowCx} cy={cy} r={R} fill="black" />
        </mask>
      </defs>

      <g filter={`url(#${glowFilterId})`}>
        <circle cx={cx} cy={cy} r={R} fill={`url(#${baseGradId})`} />
        <g clipPath={`url(#${diskClipId})`}>
          <circle
            cx={cx}
            cy={cy}
            r={R}
            fill={`url(#${litGradId})`}
            mask={`url(#${litMaskId})`}
          />
        </g>
        <circle
          cx={cx}
          cy={cy}
          r={R - 0.5}
          fill="none"
          stroke={`rgba(125,105,180,${purpleRimOpacity.toFixed(3)})`}
          strokeWidth={0.9}
        />
        <circle
          cx={cx}
          cy={cy}
          r={R - 1.25}
          fill="none"
          stroke={`rgba(79,162,173,${limbGlowOpacity.toFixed(3)})`}
          strokeWidth={1.1}
        />
      </g>
    </svg>
  );
}

// -------- Main page --------
export default function AgentBuilder(): React.ReactElement {
  const BUILDER_DEV = import.meta.env.DEV;
  const largeSurface = 'chat' as const;
  const [nativeSessionBusy, setNativeSessionBusy] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<
    | 'chat'
    | 'canvas'
    | 'knowledge'
    | 'codegraph'
    | 'trading'
    | 'code'
    | 'data-formulator'
    | 'worldsignal'
  >(() =>
    new URLSearchParams(window.location.search).get('projectId')
      ? 'canvas'
      : 'chat',
  );
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
    pendingActivationProposal,
    setPendingActivationProposal,
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
        pendingActivationProposal,
      }),
    [deck, pendingActivationProposal, workspaceView],
  );
  const connectedGraphStreams = useMemo(
    () => deriveConnectedGraphStreams(deck),
    [deck],
  );
  const connectedKnowledgeGraphKinds = useMemo(
    () => getConnectedKnowledgeGraphKinds(connectedGraphStreams),
    [connectedGraphStreams],
  );
  const {
    objectDrawerOpen,
    setObjectDrawerOpen,
    selectedCardId,
    setSelectedCardId,
    selectedEdgeId,
    setSelectedEdgeId,
    builderCanvasFocusRequest,
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
  const [sending, setSending] = useState(false);
  const [knowledgeGraphKind, setKnowledgeGraphKind] =
    useState<KnowledgeGraphKind>('thinkgraph');
  useEffect(() => {
    if (connectedKnowledgeGraphKinds.length === 0) return;
    if (connectedKnowledgeGraphKinds.includes(knowledgeGraphKind)) return;
    setKnowledgeGraphKind(
      getDefaultConnectedKnowledgeGraphKind(connectedGraphStreams),
    );
  }, [
    connectedGraphStreams,
    connectedKnowledgeGraphKinds,
    knowledgeGraphKind,
  ]);
  // ── thinkgraph.projection.v1 (Python-owned) for the ThinkGraph graph tab ────
  // The browser only requests the projection through the narrow backend transport
  // and passes the RAW response into the Cytoscape surface. No mapping, no
  // classification, no fallback data — an error or empty projection is honest.
  const [thinkGraphProjection, setThinkGraphProjection] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    projection: GraphProjectionV1 | null;
    error: string | null;
  }>({ status: 'idle', projection: null, error: null });
  // Refetch signal: bumped when a chat turn completes (knowledge:refresh), once
  // immediately and again at fixed delays after — the ThinkGraph run persists
  // server-side AFTER the reply (fire-and-forget, its own model call), so a
  // single fixed delay is a guess that can land before the write finishes.
  // Three bounded checkpoints per turn (immediate, +8s, +20s); never an
  // open-ended polling loop.
  const [thinkGraphRefreshNonce, setThinkGraphRefreshNonce] = useState(0);
  useEffect(() => {
    let timers: number[] = [];
    const onKnowledgeRefresh = () => {
      setThinkGraphRefreshNonce((n) => n + 1);
      timers.forEach((t) => window.clearTimeout(t));
      timers = [8_000, 20_000].map((delayMs) =>
        window.setTimeout(() => setThinkGraphRefreshNonce((n) => n + 1), delayMs),
      );
    };
    window.addEventListener('knowledge:refresh', onKnowledgeRefresh);
    return () => {
      window.removeEventListener('knowledge:refresh', onKnowledgeRefresh);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  // Last applied projection payload — an unchanged refetch is a no-op so the
  // rendered graph never re-lays-out ("dances") on identical data.
  const thinkGraphProjectionJsonRef = useRef<string | null>(null);
  useEffect(() => {
    if (workspaceView !== 'knowledge' || knowledgeGraphKind !== 'thinkgraph') return;
    const projectId = activeProject;
    if (!projectId) {
      thinkGraphProjectionJsonRef.current = null;
      setThinkGraphProjection({ status: 'idle', projection: null, error: null });
      return;
    }
    const controller = new AbortController();
    setThinkGraphProjection((prev) => ({
      ...prev,
      status: prev.projection ? prev.status : 'loading',
      error: null,
    }));
    void (async () => {
      try {
        const res = await fetch(
          `/api/thinkgraph/projection?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        );
        const data = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !data || typeof data !== 'object') {
          thinkGraphProjectionJsonRef.current = null;
          setThinkGraphProjection({
            status: 'error',
            projection: null,
            error: String((data as any)?.error || `HTTP ${res.status}`),
          });
          return;
        }
        const json = JSON.stringify(data);
        if (json === thinkGraphProjectionJsonRef.current) return; // unchanged — no re-render
        thinkGraphProjectionJsonRef.current = json;
        setThinkGraphProjection({
          status: 'ready',
          projection: data as GraphProjectionV1,
          error: null,
        });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        thinkGraphProjectionJsonRef.current = null;
        setThinkGraphProjection({
          status: 'error',
          projection: null,
          error: String(err?.message || err),
        });
      }
    })();
    return () => controller.abort();
  }, [activeProject, knowledgeGraphKind, workspaceView, thinkGraphRefreshNonce]);

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
  // chat state must be declared before callbacks/effects that write to it.
  const [messages, setMessages] = useState<
    { role: 'assistant' | 'user'; text: string }[]
  >(() => loadProjectState(activeProject).messages);
  const [links, setLinks] = useState<LinkRef[]>(
    () => loadProjectState(activeProject).links,
  );
  const [stateLoaded, setStateLoaded] = useState(false);

  // Restore the durable project-scoped Harness transcript on open / project
  // switch, so a reload shows the same conversation (persisted server-side in
  // conversations/store.ts, conversationId 'main'). This load is read-only and
  // best-effort: a fresh project or a read failure leaves chat empty, never
  // errors. A late response for a project the user already switched away from is
  // discarded (guarded by the captured projectId).
  useEffect(() => {
    const pid = canvasProjectId;
    if (!pid) {
      setMessages([]);
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    void loadSessionHistory({ projectId: pid, conversationId: 'main', signal: ctrl.signal })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasProjectId]);

  const lastLargeSurfaceTelemetryRef = useRef<WorkspaceTestingSurface | null>(
    null,
  );
  const lastCompanionSurfaceTelemetryRef = useRef<string | null>(null);
  const chatLoopTelemetryRef = useRef<{
    interactionId: string;
    sendStartedAt: number;
    responseReceivedAt: number | null;
    refreshRecorded: boolean;
  } | null>(null);
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

  const recordPostResponseRefreshIfPending = useCallback(
    (
      refreshKind: string,
      completedAt: number,
    ) => {
      const activeLoop = chatLoopTelemetryRef.current;
      if (!activeLoop?.responseReceivedAt || activeLoop.refreshRecorded) return;
      activeLoop.refreshRecorded = true;
      emitWorkspaceTestingEvent({
        event: 'post_response_refresh_completed',
        interactionId: activeLoop.interactionId,
        durationMs: Math.max(0, completedAt - activeLoop.responseReceivedAt),
        metadata: { refreshKind },
      });
    },
    [emitWorkspaceTestingEvent],
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
    const previousSurface = lastLargeSurfaceTelemetryRef.current;
    emitWorkspaceTestingEvent({
      event: 'surface_opened',
      surface: largeSurface,
      surfaceRole: 'large',
      metadata: { workspaceView },
    });
    if (
      largeSurface === 'chat' &&
      previousSurface &&
      previousSurface !== 'chat'
    ) {
      emitWorkspaceTestingEvent({
        event: 'return_to_chat',
        surface: 'chat',
        surfaceRole: 'large',
        metadata: { fromSurface: previousSurface },
      });
    }
    lastLargeSurfaceTelemetryRef.current = largeSurface;
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
  const dashboardPollRunRef = useRef(0);
  const dashboardPollTimerRef = useRef<number | null>(null);
  const dashboardPollAbortRef = useRef<AbortController | null>(null);
  const dashboardPollProjectRef = useRef('');
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
    recordPostResponseRefreshIfPending,
    setDeck,
    setDeckRevision,
    setDeckLoadBusy,
    setDeckLoadError,
    setLatestDeckRun,
    setLatestCardRun,
    setLiveDeckEvents,
    setMessages,
    setPendingActivationProposal: setPendingActivationProposal as any,
    setLinks,
    setStateLoaded,
    setDeckStatusMessage,
  });
  useAgentBuilderProjectReset({
    canvasProjectId,
    deckSaveAbortRef,
    layoutAutosaveAbortRef,
    deckExecutionAbortRef,
    setSending,
    setDeckSaveBusy,
    setDeckRunBusy,
    setCardRunBusy,
    setPendingActivationProposal: setPendingActivationProposal as any,
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
  const selectedEdge = useMemo(
    () => deck.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [deck.edges, selectedEdgeId],
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
  const dataFormulatorModelConfig =
    useMemo<DataFormulatorModelConfig | null>(() => {
      const card = deck.nodes.find(isDataFormulatorWorkbenchCard);
      if (!card) return null;

      const agent = resolveEffectiveAgent(card, INITIAL_AGENT_TEMPLATES);
      if (!agent) return null;
      const runtimeProvider =
        card.runtimeOptions?.provider === 'openai' ||
        card.runtimeOptions?.provider === 'openrouter'
          ? card.runtimeOptions.provider
          : null;
      const provider =
        runtimeProvider ||
        (agent.provider === 'openai' || agent.provider === 'openrouter'
          ? agent.provider
          : null);
      const model =
        cleanOptionalText(card.runtimeOptions?.modelKey) ||
        cleanOptionalText(agent.model);

      if (!provider || !model) return null;
      return {
        provider,
        model,
        ready: true,
      };
    }, [deck.nodes]);
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

  const handleQuickAddDeckNode = useCallback(
    (presetKey: string) => {
      const preset = findDeckNodePreset(presetKey);
      if (!preset) return;

      const mutation = buildQuickAddDeckMutation(deck, preset, null);
      const anchorNode = selectedCardId
        ? deck.nodes.find((node) => node.id === selectedCardId) || null
        : null;

      setLatestCardRun(null);
      setLatestDeckRun(null);
      recordDeckWriteReason('deck-quick-add');
      setDeck(mutation.nextDeck);
      setObjectDrawerOpen(false);
      setSelectedEdgeId(null);
      setSelectedCardId(null);
      // NO camera jump, NO zoom lock - let user position manually
      setDeckStatusMessage(
        mutation.nextEdge && anchorNode
          ? `Added ${preset.label} and connected it from ${safeText(anchorNode.title || anchorNode.id)}.`
          : `Added ${preset.label} to the canvas.`,
      );
    },
    [deck, recordDeckWriteReason, selectedCardId],
  );

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

  useEffect(() => {
    if (
      dashboardPollAbortRef.current &&
      dashboardPollProjectRef.current &&
      dashboardPollProjectRef.current !== activeProject
    ) {
      dashboardPollAbortRef.current.abort();
    }
    if (
      dashboardPollTimerRef.current != null &&
      dashboardPollProjectRef.current &&
      dashboardPollProjectRef.current !== activeProject
    ) {
      window.clearTimeout(dashboardPollTimerRef.current);
      dashboardPollTimerRef.current = null;
    }
  }, [activeProject]);

  // Poll for last ingest trace when Dashboard tab is active
  useEffect(() => {
    const projectId = activeProject;
    if (tab !== 'Dashboard' || !projectId) return;

    if (dashboardPollTimerRef.current != null) {
      window.clearTimeout(dashboardPollTimerRef.current);
      dashboardPollTimerRef.current = null;
    }
    dashboardPollAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardPollAbortRef.current = controller;
    dashboardPollProjectRef.current = projectId;

    const runId = ++dashboardPollRunRef.current;
    let cancelled = false;
    let failureCount = 0;
    const schedule = (baseMs: number) => {
      if (
        cancelled ||
        controller.signal.aborted ||
        runId !== dashboardPollRunRef.current
      )
        return;
      if (dashboardPollTimerRef.current != null) {
        window.clearTimeout(dashboardPollTimerRef.current);
      }
      const jitter = Math.floor(Math.random() * 300);
      dashboardPollTimerRef.current = window.setTimeout(() => {
        void fetchIngestTrace();
      }, baseMs + jitter);
    };
    const fetchIngestTrace = async () => {
      if (
        cancelled ||
        controller.signal.aborted ||
        runId !== dashboardPollRunRef.current ||
        activeProjectLatestRef.current !== projectId
      ) {
        return;
      }
      if (document.visibilityState !== 'visible') {
        schedule(3_000);
        return;
      }
      try {
        const endpoint = `${PROJECTS_API}/${projectId}/kg/last-trace`;
        const payload = await guardedRequest({
          key: `dashboard:last-trace:${projectId}`,
          method: 'GET',
          ttlMs: 1_200,
          signal: controller.signal,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, { signal });
            const data = await safeJson(res);
            return { data };
          },
        });
        if (
          cancelled ||
          controller.signal.aborted ||
          runId !== dashboardPollRunRef.current ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }
        failureCount = 0;
        schedule(3_000);
      } catch (err) {
        if (
          cancelled ||
          controller.signal.aborted ||
          runId !== dashboardPollRunRef.current ||
          activeProjectLatestRef.current !== projectId ||
          isAbortLikeError(err)
        ) {
          return;
        }
        console.error('[Dashboard] Failed to fetch ingest trace:', err);
        failureCount = Math.min(failureCount + 1, 4);
        schedule(3_000 * Math.pow(2, failureCount));
      }
    };

    void fetchIngestTrace();
    return () => {
      cancelled = true;
      if (dashboardPollTimerRef.current != null) {
        window.clearTimeout(dashboardPollTimerRef.current);
        dashboardPollTimerRef.current = null;
      }
      if (dashboardPollAbortRef.current === controller) {
        dashboardPollAbortRef.current.abort();
        dashboardPollAbortRef.current = null;
      }
      if (dashboardPollProjectRef.current === projectId) {
        dashboardPollProjectRef.current = '';
      }
    };
  }, [tab, activeProject]);

  const handleSend = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (sending || deckRunBusy || cardRunBusy || deckLoadBusy) return;

    if (!canvasProjectId) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: 'Select or create a project before running chat tasks.',
        },
      ]);
      return;
    }
    const interactionId = createWorkspaceTestingInteractionId('chat');
    const sendStartedAt = Date.now();
    const turnId = `assist:${Date.now()}:${uid()}`;
    chatLoopTelemetryRef.current = {
      interactionId,
      sendStartedAt,
      responseReceivedAt: null,
      refreshRecorded: false,
    };
    emitWorkspaceTestingEvent({
      event: 'chat_send_started',
      interactionId,
      surface:
        largeSurface === 'chat' ? 'chat' : normalizeWorkspaceSurface(tab),
      surfaceRole: largeSurface === 'chat' ? 'large' : 'companion',
      metadata: {
        messageLength: trimmed.length,
        responseMode: 'blocked_honest',
        turnId,
        workspaceView: activeDeckWorkspaceContext.workspaceView,
        objectEditorOpen: activeDeckWorkspaceContext.objectEditor.open,
        objectEditorCardId:
          activeDeckWorkspaceContext.objectEditor.selectedCardId,
        objectEditorTab: activeDeckWorkspaceContext.objectEditor.activeTab,
      },
    });

    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    setDeckRunInput(trimmed);

    setTimeout(async () => {
      // Real AutoGen run on the backend/Python path.
      const outcome = await handleRunDeck(trimmed);

      if (outcome && outcome.ok) {
        // Chat shows the real Magentic-One answer (outcome.finalText) when present.
        const answer = String(outcome.finalText || '').trim();
        if (answer) {
          setMessages((m) => [...m, { role: 'assistant', text: answer }]);
        }
      } else {
        setLatestDeckRun(null);
        setDeckStatusMessage(
          `AI call failed: ${outcome?.error || 'no answer returned'}`,
        );
      }

      const responseReceivedAt = Date.now();
      chatLoopTelemetryRef.current = {
        interactionId,
        sendStartedAt,
        responseReceivedAt,
        refreshRecorded: true,
      };
      emitWorkspaceTestingEvent({
        event: 'chat_response_received',
        interactionId,
        durationMs: Math.max(0, responseReceivedAt - sendStartedAt),
        surface: largeSurface === 'chat' ? 'chat' : normalizeWorkspaceSurface(tab),
        surfaceRole: largeSurface === 'chat' ? 'large' : 'companion',
        metadata: {
          responseMode: 'magentic_run',
          turnId,
          ok: outcome?.ok ?? false,
        },
      });
    }, 100);
  };

  const objectDrawerRole = useMemo<'agent' | null>(() => {
    if (workspaceView === 'canvas' && selectedCard) return 'agent';
    return null;
  }, [selectedCard, workspaceView]);
  const isObjectDrawerVisible = objectDrawerOpen && objectDrawerRole !== null;
  const objectDrawerDefaultWidth = AGENT_EDITOR_DEFAULT_WIDTH;
  const objectDrawerStorageKey = 'liquidaity.drawer.object.agent.width';

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
      const conversationId = 'main';
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
        onEvent: (event) => {
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
          // If authoritative final text arrived but nothing streamed, create the one
          // assistant bubble now. If NO text arrived, render NOTHING — no empty bubble,
          // no "(no response text)", no status line.
          if (!assistantStarted && finalText) appendAssistantText(finalText);
        })
        .catch(() => {
          // No response / error / disconnect: clear busy, KEEP the user message, and
          // render NO assistant bubble and NO fake error text.
          setNativeSessionBusy(false);
        });
    },
    [canvasProjectId, nativeSessionBusy, workspaceView],
  );

  const renderChatSurface = (
    projectId: string,
    compact = false,
    surfaceRole: 'large' | 'companion' = compact ? 'companion' : 'large',
  ) => {
    // Normal chat is the primary interaction surface: BuilderChat speaking to the
    // persistent Harness session, with compact real per-turn work shown inline
    // beneath the active assistant message (HarnessWork). The primary (non-compact)
    // surface keeps a near-invisible pull-tab that reveals the project PTY beneath
    // chat; the separate Code Console remains its own developer tool.
    const chat = (
      <BuilderChat
        messages={messages}
        onSend={handleNativeSend}
        knowledgeProjectId={projectId}
        disabled={nativeSessionBusy}
        colors={C}
      />
    );
    return (
      <div
        data-testid={`${surfaceRole}-surface-chat`}
        style={getSurfaceShellStyle(compact)}
      >
        {compact ? (
          <div style={{ height: '100%' }}>{chat}</div>
        ) : (
          <HarnessChatPanel chat={chat} targetRoot={DEFAULT_WORKSPACE_ROOT} projectId={projectId} />
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
  }) => (
    <div
      data-testid={`${surfaceRole}-surface-knowledge`}
      style={getSurfaceShellStyle(minHeight <= 320)}
    >
      <div className="h-full flex flex-col" style={{ position: 'relative' }}>
        {connectedKnowledgeGraphKinds.length > 0 ? (
          <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 6, display: 'flex', gap: 6 }}>
            {connectedKnowledgeGraphKinds.map((k) => {
              const active = k === knowledgeGraphKind;
              const label =
                k === 'codegraph'
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
              {knowledgeGraphKind === 'codegraph' ? (
                <CodeGraphSurface
                  projectId={codeGraphProjectName}
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
                      : undefined
                  }
                  minHeight={minHeight}
                />
              )}
            </Suspense>
          </KnowledgeSurfaceErrorBoundary>
        </div>
        {/* Honest ThinkGraph status OUTSIDE the graph canvas: real empty state or
            the actual transport error. Never fake nodes, never fallback data. */}
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
      </div>
    </div>
  );

  const showCanvasWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('canvas');
    // Camera focus only — pan to the agent/bus zone on the same scene.
    setCanvasFocusZone({ zone: 'agents', nonce: Date.now() });
  }, [closeObjectDrawer]);

  const showKnowledgeWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('knowledge');
    setKnowledgeGraphKind(
      getDefaultConnectedKnowledgeGraphKind(connectedGraphStreams),
    );
  }, [closeObjectDrawer, connectedGraphStreams]);

  const showWorkbenchWorkspace = useCallback((surface: WorkbenchSurfaceId) => {
    closeObjectDrawer();
    setWorkspaceView(surface);
  }, [closeObjectDrawer]);

  const showTradingWorkspace = useCallback(() => {
    showWorkbenchWorkspace('trading');
  }, [showWorkbenchWorkspace]);

  const showCodeWorkspace = useCallback(() => {
    showWorkbenchWorkspace('code');
  }, [showWorkbenchWorkspace]);

  const showDataFormulatorWorkspace = useCallback(() => {
    showWorkbenchWorkspace('data-formulator');
  }, [showWorkbenchWorkspace]);

  const showWorldsignalWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('worldsignal');
  }, [closeObjectDrawer]);

  const renderWorkbenchPlaceholderSurface = useCallback(
    ({
      testId,
      title,
      status,
      steps,
      accentColor,
    }: {
      testId: string;
      title: string;
      status: string;
      steps: readonly string[];
      accentColor: string;
    }) => (
      <div
        data-testid={testId}
        style={{
          height: '100%',
          padding: 18,
          display: 'grid',
          gap: 14,
          background: GRAPH_THEME.background.knowledgeSurface,
          color: GRAPH_THEME.drawer.inputText,
        }}
      >
        <div
          style={graphDrawerSectionStyle({
            padding: '16px 18px',
            display: 'grid',
            gap: 10,
          })}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700 }}>{title}</div>
            <div
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                border: `1px solid ${accentColor}`,
                color: accentColor,
                fontSize: 11,
                letterSpacing: 0.2,
              }}
            >
              {status}
            </div>
          </div>
          <div
            style={{
              color: GRAPH_THEME.drawer.inputMuted,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            Workspace path is staged. Activation comes from the canvas graph.
          </div>
        </div>
        <div
          style={graphDrawerSectionStyle({
            padding: '16px 18px',
          })}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: GRAPH_THEME.drawer.inputText,
              marginBottom: 10,
            }}
          >
            Intended Flow
          </div>
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              display: 'grid',
              gap: 8,
              color: GRAPH_THEME.drawer.inputMuted,
              lineHeight: 1.5,
            }}
          >
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    ),
    [],
  );

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
      onQuickAddAssistNode={() => handleQuickAddDeckNode('assist')}
      onShowKnowledgeWorkspace={showKnowledgeWorkspace}
      onShowTradingWorkspace={showTradingWorkspace}
      onShowCodeWorkspace={showCodeWorkspace}
      onShowDataFormulatorWorkspace={showDataFormulatorWorkspace}
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
      codeSurface={renderWorkbenchPlaceholderSurface({
        testId: 'code-workspace-placeholder',
        title: 'Code Agent Workspace',
        status: 'Demo / planned integration',
        accentColor: C.primary,
        steps: [
          'Main Chat creates a scoped code task.',
          'Code Agent receives selected object and repo context.',
          'A future Claude Code or sandbox bridge executes the task and returns reviewable diffs and tests.',
        ],
      })}
      dataFormulatorSurface={
        <DataFormulatorSurface
          modelConfig={dataFormulatorModelConfig}
        />
      }
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
        defaultWidth={objectDrawerDefaultWidth}
        minWidth={360}
        maxWidth={760}
        storageKey={objectDrawerStorageKey}
        dataTestId="workspace-object-drawer"
        right={12}
        top={48}
      >
        {objectDrawerRole === 'agent' && activeTabs.length > 0 ? (
          <div
            className="flex min-w-0 overflow-x-auto"
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
