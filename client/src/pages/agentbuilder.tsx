import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  AgentManagerLocalConfig,
  AgentManagerMemoryGraphData,
} from '../components/AgentManager';
import BuilderCanvas, {
  type BuilderCanvasFocusRequest,
} from '../components/builder/BuilderCanvas';
import BuilderChat from '../components/builder/BuilderChat';
import BuilderDrawer from '../components/builder/BuilderDrawer';
import PlanMissionFlow from '../components/assist/PlanMissionFlow';
import WorldSignalSurface from '../components/worldsignal/WorldSignalSurface';
import type {
  PlanMissionNodeData,
  PlanMissionNodeOverrideMap,
} from '../components/assist/planMissionModel';
import { buildPlanMissionGraph } from '../components/assist/planMissionModel';
import {
  buildStructuredAssistPlanSurface,
  type LinkRef,
  normalizeAnchorSurface,
  type PlanItem,
} from '../components/builder/assistPlanSurface';
import { buildExecutionPlan } from '../components/builder/deckExecution';
import DeckExecutionPathSummary from '../components/builder/DeckExecutionPathSummary';
import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
  graphCompanionPanelStyle,
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
  graphDrawerSectionStyle,
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
  resolveDeckRunFinalText,
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
  isCachedGraphFresh,
  isLatestRequestSequence,
  nextRequestSequence,
  readCachedGraphPayload,
  readJsonAndText,
  safeJson,
  writeCachedGraphPayload,
} from '../components/builder/requestGuards';
import {
  type LatestCardRunRecord,
  useBuilderDeckRuntimeActions,
} from '../components/builder/useBuilderDeckRuntimeActions';
import { useBuilderProjects } from '../components/builder/useBuilderProjects';
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
  GraphViewContract,
  GraphViewData,
  KnowledgeGraphKind,
  DeckWorkspaceContext,
  WorkspaceObjectContext,
  PromptTemplate,
  RuntimeBinding,
} from '../types/agentgraph';
import {
  ENERGY_DEFAULT_PARAMETERS,
  type EnergyObjectId,
  type EnergyParameterKey,
  type EnergySurfaceParameters,
  type WorkspaceAction,
  type WorkspaceActionCall,
  type WorkspaceActionResult,
  type WorkspaceObject,
} from '../types/workspaceActions';
import type {
  KnowledgeGraphScope,
  KnowledgeGraphRelationship,
  KnowledgeGraphNode,
} from '../components/knowledge/KnowledgeGraphNVL';
import {
  createWorkspaceTestingInteractionId,
  recordWorkspaceTestingEvent,
  type WorkspaceTestingEventInput,
  type WorkspaceTestingObjectType,
  type WorkspaceTestingSurface,
} from '../lib/workspaceTestingTelemetry';
import {
  getUaAgentDefinitionBySurface,
  getUiUaAgentDefinitions,
  UA_AGENT_DEFINITIONS,
  type UaAgentDefinition,
  type UaUiAgentDefinition,
  type UaAgentSurfaceId,
} from '../runtime/uaAgentDefinitions';

const AgentManager = lazy(async () => {
  const mod = await import('../components/AgentManager');
  return { default: mod.AgentManager };
});
const UaAgentPanelHost = lazy(
  () => import('../components/agents/ua/UaAgentPanelHost'),
);
const KnowledgeSummaryPanel = lazy(
  () => import('../components/knowledge/KnowledgeSummaryPanel'),
);
const KnowledgeEvidencePanel = lazy(
  () => import('../components/knowledge/KnowledgeEvidencePanel'),
);
const KnowledgeGraphFramework = lazy(
  () => import('../components/knowledge/KnowledgeGraphFramework'),
);
const EnergyFacadeSurface = lazy(
  () => import('../components/energy/EnergyFacadeSurface'),
);
const TradingCanvasSurface = lazy(
  () => import('../features/trading/TradingCanvasSurface'),
);
const CODEBASE_MEMORY_PROJECT_NAME = 'C-Projects-LiquidAIty-main';
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

const ENERGY_WORKSPACE_ACTIONS: WorkspaceAction[] = [
  {
    id: 'select_object',
    label: 'Select object',
    surface: 'energy',
  },
  {
    id: 'update_object_parameter',
    label: 'Update object parameter',
    surface: 'energy',
  },
  {
    id: 'reset_energy_surface',
    label: 'Reset energy surface',
    surface: 'energy',
  },
];

const ENERGY_OBJECT_PARAMETERS: Record<EnergyObjectId, EnergyParameterKey[]> = {
  'energy:surface': [
    'width',
    'height',
    'depth',
    'glazing',
    'overhang',
    'leftFin',
    'rightFin',
    'day',
    'hour',
    'orientation',
  ],
  'energy:facade': ['width', 'height', 'depth'],
  'energy:window': ['glazing'],
  'energy:overhang': ['overhang'],
  'energy:leftFin': ['leftFin'],
  'energy:rightFin': ['rightFin'],
  'energy:sun': ['day', 'hour'],
  'energy:results': [],
};

function isEnergyObjectId(value: string): value is EnergyObjectId {
  return Object.prototype.hasOwnProperty.call(ENERGY_OBJECT_PARAMETERS, value);
}

function isEnergyParameterKey(value: string): value is EnergyParameterKey {
  return Object.prototype.hasOwnProperty.call(ENERGY_DEFAULT_PARAMETERS, value);
}

function buildEnergyWorkspaceObjects(
  inputs: EnergySurfaceParameters,
): WorkspaceObject[] {
  return [
    {
      id: 'energy:surface',
      surface: 'energy',
      type: 'energy_surface',
      label: 'Energy Surface',
      parameters: { ...inputs },
    },
    {
      id: 'energy:facade',
      surface: 'energy',
      type: 'facade_mass',
      label: 'Facade',
      parameters: {
        width: inputs.width,
        height: inputs.height,
        depth: inputs.depth,
      },
    },
    {
      id: 'energy:window',
      surface: 'energy',
      type: 'window_glazing',
      label: 'Window / Glazing',
      parameters: {
        glazing: inputs.glazing,
      },
    },
    {
      id: 'energy:overhang',
      surface: 'energy',
      type: 'shade_overhang',
      label: 'Overhang',
      parameters: {
        overhang: inputs.overhang,
      },
    },
    {
      id: 'energy:leftFin',
      surface: 'energy',
      type: 'shade_fin',
      label: 'Left Fin',
      parameters: {
        leftFin: inputs.leftFin,
      },
    },
    {
      id: 'energy:rightFin',
      surface: 'energy',
      type: 'shade_fin',
      label: 'Right Fin',
      parameters: {
        rightFin: inputs.rightFin,
      },
    },
    {
      id: 'energy:sun',
      surface: 'energy',
      type: 'solar_context',
      label: 'Sun',
      parameters: {
        day: inputs.day,
        hour: inputs.hour,
      },
    },
    {
      id: 'energy:results',
      surface: 'energy',
      type: 'results_summary',
      label: 'Results Summary',
    },
  ];
}

function formatEnergyParameterLabel(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').toLowerCase();
}

class EnergySurfaceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-testid="energy-facade-error"
          style={{
            height: '100%',
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: GRAPH_THEME.background.knowledgeSurface,
          }}
        >
          <div
            style={graphDrawerSectionStyle({
              width: 'min(520px, 100%)',
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
              Energy canvas unavailable
            </div>
            <div>{this.state.error.message || 'The Energy surface failed to load.'}</div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

class KnowledgeSurfaceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

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
const BUILDER_NODE_TABS = ['Prompt', 'Knowledge', 'Tools', 'Runtime'] as const;
const AGENTS_CHAT_MIN_WIDTH = 360;
const AGENTS_CANVAS_MIN_WIDTH = 520;
const WORKSPACE_COMPANION_MIN_WIDTH = 360;
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
    normalized === 'plan' ||
    normalized === 'canvas' ||
    normalized === 'knowledge' ||
    normalized === 'codegraph' ||
    normalized === 'energy' ||
    normalized === 'worldsignal' ||
    normalized === 'trading' ||
    normalized === 'image' ||
    normalized === 'code' ||
    normalized === 'video'
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = safeText(text).trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse errors
  }
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fencedMatch?.[1]) return null;
  try {
    const parsed = JSON.parse(fencedMatch[1].trim());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function normalizeCodeGraphViewContractCandidate(
  candidate: unknown,
  projectId?: string | null,
): GraphViewContract | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    return null;
  const record = candidate as Record<string, unknown>;
  const nodeLabelAllowlistRaw =
    record.nodeLabelAllowlist ??
    record.node_labels ??
    record.nodeLabels ??
    null;
  const edgeTypeAllowlistRaw =
    record.edgeTypeAllowlist ?? record.edge_types ?? record.edgeTypes ?? null;
  const showLabelsRaw = record.showLabels ?? record.show_labels;
  const focusPathsRaw = record.focusPaths ?? record.focus_paths;
  const focusSymbolsRaw = record.focusSymbols ?? record.focus_symbols;
  const maxNodesRaw = record.maxNodes ?? record.max_nodes;
  const graphKindRaw = record.graphKind ?? record.graph_kind ?? 'codegraph';
  const focusNodeIdsRaw = record.focusNodeIds ?? record.focus_node_ids;
  const cameraModeRaw = record.cameraMode ?? record.camera_mode;
  const animationModeRaw = record.animationMode ?? record.animation_mode;
  const narrativeIntentRaw = record.narrativeIntent ?? record.narrative_intent;

  const toStringArray = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const normalized = value
      .map((entry) => safeText(entry).trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  };

  const nodeLabelAllowlist = toStringArray(nodeLabelAllowlistRaw);
  const edgeTypeAllowlist = toStringArray(edgeTypeAllowlistRaw);
  const focusPaths = toStringArray(focusPathsRaw);
  const focusSymbols = toStringArray(focusSymbolsRaw);
  const focusNodeIds = toStringArray(focusNodeIdsRaw);
  const showLabels =
    typeof showLabelsRaw === 'boolean' ? showLabelsRaw : undefined;
  const maxNodes = Number.isFinite(Number(maxNodesRaw))
    ? Number(maxNodesRaw)
    : undefined;
  const graphKindNormalized = safeText(graphKindRaw).trim().toLowerCase();
  const graphKind: KnowledgeGraphKind =
    graphKindNormalized === 'thinkgraph' ||
    graphKindNormalized === 'knowgraph' ||
    graphKindNormalized === 'codegraph'
      ? (graphKindNormalized as KnowledgeGraphKind)
      : 'codegraph';
  const cameraMode =
    cameraModeRaw === 'overview' ||
    cameraModeRaw === 'focus' ||
    cameraModeRaw === 'trace' ||
    cameraModeRaw === 'cluster'
      ? cameraModeRaw
      : undefined;
  const animationMode =
    animationModeRaw === 'calm' ||
    animationModeRaw === 'guided' ||
    animationModeRaw === 'active'
      ? animationModeRaw
      : undefined;
  const narrativeIntent = cleanOptionalText(narrativeIntentRaw);

  if (
    !nodeLabelAllowlist &&
    !edgeTypeAllowlist &&
    showLabels == null &&
    !focusPaths &&
    !focusSymbols &&
    !focusNodeIds &&
    maxNodes == null &&
    !cameraMode &&
    !animationMode &&
    !narrativeIntent
  ) {
    return null;
  }

  return {
    graphKind,
    projectId: cleanOptionalText(projectId) ?? undefined,
    focusNodeIds,
    nodeLabelAllowlist,
    edgeTypeAllowlist,
    showLabels,
    focusPaths,
    focusSymbols,
    maxNodes,
    cameraMode,
    animationMode,
    narrativeIntent,
  };
}

function extractCodeGraphViewContractFromUnknown(
  payload: unknown,
  projectId?: string | null,
): GraphViewContract | null {
  const direct = normalizeCodeGraphViewContractCandidate(payload, projectId);
  if (direct) return direct;

  if (typeof payload === 'string') {
    const parsed = parseJsonObject(payload);
    if (!parsed) return null;
    return extractCodeGraphViewContractFromUnknown(parsed, projectId);
  }

  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const nestedKeys = [
    'codeGraphViewContract',
    'codegraphViewContract',
    'graphViewContract',
    'codegraph_view_contract',
    'codegraph',
    'graph_view',
    'view',
    'contract',
  ] as const;
  for (const key of nestedKeys) {
    if (record[key] == null) continue;
    const nested = extractCodeGraphViewContractFromUnknown(
      record[key],
      projectId,
    );
    if (nested) return nested;
  }
  return null;
}

function extractCodeGraphViewContractFromEvent(
  event: DeckRuntimeEvent,
  projectId?: string | null,
): GraphViewContract | null {
  const typedContract = normalizeCodeGraphViewContractCandidate(
    event.codegraphViewContract,
    projectId,
  );
  if (typedContract) return typedContract;
  const candidates: unknown[] = [
    event.content,
    event.text,
    event.progressText,
    ...(Array.isArray(event.notes) ? event.notes : []),
  ];
  for (const candidate of candidates) {
    const contract = extractCodeGraphViewContractFromUnknown(
      candidate,
      projectId,
    );
    if (contract) return contract;
  }
  return null;
}

function extractCodeGraphViewContractFromRun(
  run: DeckRun | null | undefined,
  projectId?: string | null,
): GraphViewContract | null {
  const typedRunContract = normalizeCodeGraphViewContractCandidate(
    run?.codegraphViewContract,
    projectId,
  );
  if (typedRunContract) return typedRunContract;
  const steps = Array.isArray(run?.steps) ? [...run.steps].reverse() : [];
  for (const step of steps) {
    const typedStepContract = normalizeCodeGraphViewContractCandidate(
      step.codegraphViewContract,
      projectId,
    );
    if (typedStepContract) return typedStepContract;
    const contractFromOutput = extractCodeGraphViewContractFromUnknown(
      step.output,
      projectId,
    );
    if (contractFromOutput) return contractFromOutput;
    const contractFromSummary = extractCodeGraphViewContractFromUnknown(
      step.outputSummary,
      projectId,
    );
    if (contractFromSummary) return contractFromSummary;
    const contractFromTaskContract = extractCodeGraphViewContractFromUnknown(
      step.contract,
      projectId,
    );
    if (contractFromTaskContract) return contractFromTaskContract;
  }
  return null;
}

function normalizeRuntimeType(value: unknown): AgentCardRuntimeType | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === 'assistant_agent') return 'assistant_agent';
  if (normalized === 'magentic_one') return 'magentic_one';
  if (normalized === 'graph_flow') return 'graph_flow';
  if (normalized === 'local_coder') return 'local_coder';
  return null;
}

function isEnergyWorkbenchCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_energy_workbench' ||
    safeText(card.templateId).trim() === 'template_energy_workbench'
  );
}

function isTradingWorkbenchCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_trading_workbench' ||
    safeText(card.templateId).trim() === 'template_trading_workbench'
  );
}

function isImageWorkbenchCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_image_workbench' ||
    safeText(card.templateId).trim() === 'template_image_workbench'
  );
}

function isCodeWorkbenchCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_code_workbench' ||
    safeText(card.templateId).trim() === 'template_code_workbench'
  );
}

function isVideoWorkbenchCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_video_workbench' ||
    safeText(card.templateId).trim() === 'template_video_workbench'
  );
}

function isUaAgentCard(
  card: AgentCardInstance | null | undefined,
  agent: UaAgentDefinition,
): boolean {
  if (!card) return false;
  return (
    safeText(card.templateId).trim() === agent.templateId ||
    safeText(card.title).trim() === agent.name
  );
}

type WorkbenchSurfaceId =
  | 'energy'
  | 'trading'
  | 'image'
  | 'code'
  | 'video'
  | UaAgentSurfaceId;

type WorkbenchCardDescriptor = {
  id: WorkbenchSurfaceId;
  title: string;
  openLabel: string;
  disabledCopy: string;
  matches: (card: AgentCardInstance | null | undefined) => boolean;
};

const WORKBENCH_CARD_DESCRIPTORS: readonly WorkbenchCardDescriptor[] = [
  {
    id: 'energy',
    title: 'NRGSim / Energy',
    openLabel: 'Open Energy Surface',
    disabledCopy:
      'NRGSim is staged as a selectable workbench card. Runtime is disabled until the dedicated Energy backend exists.',
    matches: isEnergyWorkbenchCard,
  },
  {
    id: 'trading',
    title: 'Trading Agent',
    openLabel: 'Open Trading Workspace',
    disabledCopy:
      'Trading is staged as a selectable workbench card. Runtime is disabled until the dedicated trading bridge exists.',
    matches: isTradingWorkbenchCard,
  },
  {
    id: 'image',
    title: 'Image Maker Agent',
    openLabel: 'Open Image Workspace',
    disabledCopy:
      'Image Maker is staged as a selectable workbench card. Runtime is disabled until the image generation bridge exists.',
    matches: isImageWorkbenchCard,
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
    id: 'video',
    title: 'Video Agent',
    openLabel: 'Open Video Workspace',
    disabledCopy:
      'Video Agent is staged as a selectable workbench card. Runtime is disabled until the video generation bridge exists.',
    matches: isVideoWorkbenchCard,
  },
  ...getUiUaAgentDefinitions().map(
    (agent): WorkbenchCardDescriptor => ({
      id: agent.surfaceId,
      title: agent.name,
      openLabel: `Open ${agent.name}`,
      disabledCopy: agent.panel.drawerCopy,
      matches: (card) => isUaAgentCard(card, agent),
    }),
  ),
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

function isPlanAgentCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  const id = safeText(card.id).trim().toLowerCase();
  const templateId = safeText(card.templateId).trim().toLowerCase();
  const title = safeText(card.title).trim().toLowerCase();
  return (
    id === 'card_plan_agent' ||
    templateId === 'template_plan_agent' ||
    title === 'plan agent'
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
    | 'plan'
    | 'knowledge'
    | 'energy'
    | 'worldsignal'
    | 'image'
    | 'code'
    | 'video'
    | 'trading';
  title: string;
  sourceText: string;
  status: 'pending' | 'approved';
};

export type ProgressiveRailVisibility = {
  showKnowledge: boolean;
  showPlan: boolean;
  showWorldsignal: boolean;
  showEnergy: boolean;
  showTrading: boolean;
  showImage: boolean;
  showCode: boolean;
  showVideo: boolean;
  uaAgents: readonly UaUiAgentDefinition[];
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
          magenticIds.has(edge.source) &&
          normalizeDeckEdgeType(edge.edgeType) === 'magentic_option',
      )
      .map((edge) => nodeMap.get(edge.target))
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

export function isPlanAgentActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  const busConnected = buildBusConnectedCardIds(nodes, edges);
  return nodes.some((node) => busConnected.has(node.id) && isPlanAgentCard(node));
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

export function isEnergyWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isEnergyWorkbenchCard);
}

export function isTradingWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isTradingWorkbenchCard);
}

export function isImageWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isImageWorkbenchCard);
}

export function isCodeWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isCodeWorkbenchCard);
}

export function isVideoWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isVideoWorkbenchCard);
}

function getVisibleUaRailAgents(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
  _workspaceView: string,
): readonly UaUiAgentDefinition[] {
  const busConnected = buildBusConnectedCardIds(nodes, edges);
  return getUiUaAgentDefinitions().filter(
    (agent) =>
      nodes.some(
        (node) => busConnected.has(node.id) && isUaAgentCard(node, agent),
      ),
  );
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

export function shouldShowEnergyRailButton(
  deck: Pick<DeckDocument, 'nodes' | 'edges'>,
  workspaceView: string,
): boolean {
  return deriveVisibleRailItems({
    deck,
    workspaceView,
    pendingActivationProposal: null,
  }).showEnergy;
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
  return {
    showKnowledge:
      workspaceView === 'knowledge' ||
      isKnowledgeChainActive(deck.nodes, deck.edges),
    showPlan:
      workspaceView === 'plan' ||
      pendingActivationProposal !== null ||
      isPlanAgentActive(deck.nodes, deck.edges),
    showWorldsignal:
      workspaceView === 'worldsignal' ||
      isWorldSignalsAgentActive(deck.nodes, deck.edges),
    showEnergy:
      workspaceView === 'energy' ||
      isEnergyWorkbenchActive(deck.nodes, deck.edges),
    showTrading:
      workspaceView === 'trading' ||
      isTradingWorkbenchActive(deck.nodes, deck.edges),
    showImage:
      workspaceView === 'image' ||
      isImageWorkbenchActive(deck.nodes, deck.edges),
    showCode:
      workspaceView === 'code' ||
      isCodeWorkbenchActive(deck.nodes, deck.edges),
    showVideo:
      workspaceView === 'video' ||
      isVideoWorkbenchActive(deck.nodes, deck.edges),
    uaAgents: getVisibleUaRailAgents(deck.nodes, deck.edges, workspaceView),
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
    /\b(plan|planning)\b/.test(normalized)
      ? 'plan'
      : /\b(knowledge|research|knowgraph|codegraph|thinkgraph)\b/.test(
            normalized,
          )
        ? 'knowledge'
        : /\b(energy|nrgsim)\b/.test(normalized)
          ? 'energy'
          : /\b(worldsignal|world signals|world)\b/.test(normalized)
            ? 'worldsignal'
            : /\b(image|poster|print|shirt)\b/.test(normalized)
              ? 'image'
              : /\b(code|coder|openclaude|claude code|localcoder)\b/.test(
                    normalized,
                  )
                ? 'code'
                : /\b(video|clips|storyboard)\b/.test(normalized)
                  ? 'video'
                  : /\btrading\b/.test(normalized)
                    ? 'trading'
                    : null;
  if (!capability) return null;

  const titleByCapability = {
    plan: 'Enable Plan',
    knowledge: 'Enable Research + Knowledge',
    energy: 'Enable Energy',
    worldsignal: 'Enable WorldSignals',
    image: 'Enable Image Maker',
    code: 'Enable Code Agent',
    video: 'Enable Video Agent',
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

function normalizeDeckEdgeType(value: unknown): DeckEdgeType {
  return safeText(value).trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'flow';
}

function extractPromptTemplateField(
  template: string,
  field: 'ROLE' | 'GOAL' | 'CONSTRAINTS' | 'IO_SCHEMA' | 'MEMORY_POLICY',
): string | null {
  const normalizedTemplate = safeText(template).replace(/\r\n/g, '\n');
  if (!normalizedTemplate.includes(`[${field}]`)) return null;

  const tagRegex = /\[(ROLE|GOAL|CONSTRAINTS|IO_SCHEMA|MEMORY_POLICY)\]/gi;
  const tags: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(normalizedTemplate)) !== null) {
    tags.push({
      key: String(match[1] || '').toUpperCase(),
      start: match.index,
      end: tagRegex.lastIndex,
    });
  }

  for (let index = 0; index < tags.length; index += 1) {
    const current = tags[index];
    if (current.key !== field) continue;
    const next = tags[index + 1];
    const value = normalizedTemplate
      .slice(current.end, next ? next.start : normalizedTemplate.length)
      .trim();
    return value || null;
  }

  return null;
}

function summarizeMemoryGraphLabel(value: string, fallback: string): string {
  const text = safeText(value).trim();
  if (!text) return fallback;
  const normalized = text
    .replace(/^https?:\/\//i, '')
    .replace(/^[a-z]+:\/\//i, '');
  if (normalized.length <= 30) return normalized;
  const lastSegment =
    normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
  if (lastSegment.length <= 30) return lastSegment;
  return `${lastSegment.slice(0, 27)}…`;
}

function normalizeKnowledgeScope(
  value: unknown,
  fallback: KnowledgeGraphScope,
): KnowledgeGraphScope {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === 'agent') return 'agent';
  if (normalized === 'project') return 'project';
  if (normalized === 'system') return 'system';
  if (
    normalized === 'grounded_research' ||
    normalized === 'grounded-research'
  ) {
    return 'grounded_research';
  }
  return fallback;
}

function formatKnowledgeScope(scope: KnowledgeGraphScope): string {
  if (scope === 'grounded_research') return 'grounded research';
  return scope;
}

function buildSelectedCardMemoryGraphData(
  document: DeckDocument,
  selectedCard: AgentCardInstance | null,
  selectedCardConfig: AgentManagerLocalConfig | null,
): AgentManagerMemoryGraphData | null {
  if (!selectedCard || !selectedCardConfig) return null;

  const nodeMap = new Map(
    document.nodes.map((node) => [node.id, node] as const),
  );
  const entityMap = new Map<string, KnowledgeGraphNode>();
  const relationshipMap = new Map<string, KnowledgeGraphRelationship>();
  const agentNodeId = `memory:${selectedCard.id}`;

  const pushEntity = (entity: KnowledgeGraphNode) => {
    if (!entityMap.has(entity.id)) {
      entityMap.set(entity.id, entity);
    }
  };
  const pushRelationship = (relationship: KnowledgeGraphRelationship) => {
    if (!relationshipMap.has(relationship.id)) {
      relationshipMap.set(relationship.id, relationship);
    }
  };
  pushEntity({
    id: agentNodeId,
    rawId: selectedCard.id,
    label: safeText(selectedCard.title || selectedCard.id),
    type: 'Agent',
    source: 'mixed',
    scope: 'agent',
  });
  pushEntity({
    id: `runtime_input:${selectedCard.id}`,
    rawId: 'Current user or upstream turn input.',
    label: 'Current Input',
    type: 'Runtime Input',
    source: 'think',
    scope: 'agent',
  });
  pushRelationship({
    id: `rel:runtime_input:${selectedCard.id}`,
    from: `runtime_input:${selectedCard.id}`,
    to: agentNodeId,
    type: 'feeds_input',
    source: 'think',
    scope: 'agent',
    evidence_snippet: 'Current turn input is routed into this card at runtime.',
  });

  const memoryPolicy = extractPromptTemplateField(
    String(selectedCardConfig.prompt_template || selectedCard.prompt || ''),
    'MEMORY_POLICY',
  );
  if (memoryPolicy) {
    pushEntity({
      id: `memory_policy:${selectedCard.id}`,
      rawId: memoryPolicy,
      label: 'Memory Policy',
      type: 'Memory Policy',
      source: 'think',
      scope: 'agent',
    });
    pushRelationship({
      id: `rel:memory_policy:${selectedCard.id}`,
      from: `memory_policy:${selectedCard.id}`,
      to: agentNodeId,
      type: 'shapes_memory',
      source: 'think',
      scope: 'agent',
      evidence_snippet:
        'This prompt section shapes how the card carries or constrains memory.',
    });
  }

  (Array.isArray(selectedCardConfig.knowledge_sources)
    ? selectedCardConfig.knowledge_sources
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
  ).forEach((source, index) => {
    const sourceNodeId = `knowledge_source:${selectedCard.id}:${index}`;
    pushEntity({
      id: sourceNodeId,
      rawId: source,
      label: summarizeMemoryGraphLabel(source, 'Knowledge Source'),
      type: 'Knowledge Source',
      source: 'know',
      scope: 'agent',
      originSource: 'know',
    });
    pushRelationship({
      id: `rel:knowledge_source:${selectedCard.id}:${index}`,
      from: sourceNodeId,
      to: agentNodeId,
      type: 'grounds_context',
      source: 'know',
      scope: 'agent',
      evidence_snippet: 'Configured knowledge source available to this card.',
    });
  });

  document.edges.forEach((edge) => {
    const edgeType = normalizeDeckEdgeType(edge.edgeType);
    const sourceNode = nodeMap.get(edge.source) || null;
    const targetNode = nodeMap.get(edge.target) || null;

    if (
      edge.target === selectedCard.id &&
      sourceNode &&
      (edgeType === 'flow' || edgeType === 'magentic_option')
    ) {
      const sourceEntityId = `upstream:${sourceNode.id}`;
      pushEntity({
        id: sourceEntityId,
        rawId: sourceNode.id,
        label: safeText(sourceNode.title || sourceNode.id),
        type:
          sourceNode.runtimeType === 'magentic_one'
            ? 'Orchestrator'
            : 'Upstream Agent',
        source: edgeType === 'magentic_option' ? 'mixed' : 'think',
        scope: 'project',
      });
      pushRelationship({
        id: `rel:upstream:${edge.id}`,
        from: sourceEntityId,
        to: agentNodeId,
        type: edgeType === 'magentic_option' ? 'routes_input' : 'feeds_input',
        source: edgeType === 'magentic_option' ? 'mixed' : 'think',
        scope: 'project',
        evidence_snippet:
          edgeType === 'magentic_option'
            ? 'Visible orchestrator route into this card.'
            : 'Visible upstream graph input into this card.',
      });
    }

    if (
      edge.source === selectedCard.id &&
      targetNode &&
      (edgeType === 'flow' || edgeType === 'magentic_option')
    ) {
      const targetEntityId = `downstream:${targetNode.id}`;
      pushEntity({
        id: targetEntityId,
        rawId: targetNode.id,
        label: safeText(targetNode.title || targetNode.id),
        type:
          targetNode.runtimeType === 'magentic_one'
            ? 'Orchestrator'
            : 'Downstream Agent',
        source: edgeType === 'magentic_option' ? 'mixed' : 'think',
        scope: 'project',
      });
      pushRelationship({
        id: `rel:downstream:${edge.id}`,
        from: agentNodeId,
        to: targetEntityId,
        type: edgeType === 'magentic_option' ? 'routes_output' : 'feeds_output',
        source: edgeType === 'magentic_option' ? 'mixed' : 'think',
        scope: 'project',
        evidence_snippet:
          edgeType === 'magentic_option'
            ? 'This card exposes a callable route into the downstream graph.'
            : 'Visible downstream graph consumer of this card output.',
      });
    }
  });

  return {
    entities: Array.from(entityMap.values()),
    relationships: Array.from(relationshipMap.values()),
  };
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
const V2_PROJECTS_API = '/api/v2/projects';
const V3_PROJECTS_API = '/api/v3/projects';
const EMPTY_PROJECT_STATE = {
  messages: [] as { role: 'assistant' | 'user'; text: string }[],
  plan: [] as PlanItem[],
  links: [] as LinkRef[],
};

const KG_CACHE_PREFIX = 'agentbuilder:kg-cache:v1';
const KG_CACHE_TTL_MS = 60_000;

type KNode = {
  id: string;
  rawId?: string;
  label: string;
  type?: string;
  graphSource?: 'think' | 'know';
  scope?: KnowledgeGraphScope;
  last_seen_ts?: string;
  degree?: number;
  createdAtMs?: number;
  confidence?: number;
};

type KEdge = {
  a: string;
  b: string;
  id?: string;
  rawId?: string;
  graphSource?: 'think' | 'know';
  scope?: KnowledgeGraphScope;
  source?: string;
  target?: string;
  type?: string;
  weight?: number;
  confidence?: number;
  last_seen_ts?: string;
  lastSeenMs?: number;
  evidence_doc_id?: string;
  evidence_snippet?: string;
};

const KG_SEED_QUERY = [
  'MATCH (a:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(b:Entity { project_id: $projectId })',
  "WHERE ($typeFilter IS NULL OR toLower(coalesce(a.etype, 'unknown')) = $typeFilter OR toLower(coalesce(b.etype, 'unknown')) = $typeFilter)",
  'AND ($sinceTs IS NULL OR coalesce(r.created_at, a.created_at, b.created_at) >= $sinceTs)',
  'AND ($minConfidence IS NULL OR coalesce(r.confidence, 0.0) >= $minConfidence)',
  'RETURN {',
  "  a_id: id(a), a_name: coalesce(a.name, toString(id(a))), a_type: coalesce(a.etype, 'unknown'), a_ts: coalesce(a.created_at, r.created_at, b.created_at), a_doc_id: coalesce(a.source.doc_id, a.source.docId, r.source.doc_id, r.source.docId),",
  "  r_type: coalesce(r.rtype, 'related_to'), r_weight: coalesce(r.weight, r.confidence, 0.5), r_confidence: coalesce(r.confidence, r.weight, 0.5), r_ts: coalesce(r.created_at, a.created_at, b.created_at), r_doc_id: coalesce(r.source.doc_id, r.source.docId, a.source.doc_id, b.source.doc_id), r_snippet: coalesce(r.source.snippet, r.attrs.snippet),",
  "  b_id: id(b), b_name: coalesce(b.name, toString(id(b))), b_type: coalesce(b.etype, 'unknown'), b_ts: coalesce(b.created_at, r.created_at, a.created_at), b_doc_id: coalesce(b.source.doc_id, b.source.docId, r.source.doc_id, r.source.docId)",
  '} AS row',
  'ORDER BY coalesce(r.created_at, a.created_at, b.created_at) DESC',
  'LIMIT toInteger($limit)',
].join(' ');
const KG_EXPAND_QUERY = [
  'MATCH (n:Entity { project_id: $projectId })',
  'WHERE id(n) = toInteger($nodeId)',
  'MATCH (n)-[r:REL { project_id: $projectId }]-(m:Entity { project_id: $projectId })',
  "WHERE ($typeFilter IS NULL OR toLower(coalesce(n.etype, 'unknown')) = $typeFilter OR toLower(coalesce(m.etype, 'unknown')) = $typeFilter)",
  'AND ($sinceTs IS NULL OR coalesce(r.created_at, n.created_at, m.created_at) >= $sinceTs)',
  'AND ($minConfidence IS NULL OR coalesce(r.confidence, 0.0) >= $minConfidence)',
  'RETURN {',
  "  a_id: id(n), a_name: coalesce(n.name, toString(id(n))), a_type: coalesce(n.etype, 'unknown'), a_ts: coalesce(n.created_at, r.created_at, m.created_at), a_doc_id: coalesce(n.source.doc_id, n.source.docId, r.source.doc_id, r.source.docId),",
  "  r_type: coalesce(r.rtype, 'related_to'), r_weight: coalesce(r.weight, r.confidence, 0.5), r_confidence: coalesce(r.confidence, r.weight, 0.5), r_ts: coalesce(r.created_at, n.created_at, m.created_at), r_doc_id: coalesce(r.source.doc_id, r.source.docId, n.source.doc_id, m.source.doc_id), r_snippet: coalesce(r.source.snippet, r.attrs.snippet),",
  "  b_id: id(m), b_name: coalesce(m.name, toString(id(m))), b_type: coalesce(m.etype, 'unknown'), b_ts: coalesce(m.created_at, r.created_at, n.created_at), b_doc_id: coalesce(m.source.doc_id, m.source.docId, r.source.doc_id, r.source.docId)",
  '} AS row',
  'ORDER BY coalesce(r.created_at, n.created_at, m.created_at) DESC',
  'LIMIT toInteger($limit)',
].join(' ');

function normalizeRelationType(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseTimestampMs(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

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
        'You are Magentic-One, the lead orchestrator for the visible agent graph.',
        'You are part of the visible team, not a hidden side system.',
      ].join('\n'),
      goal: [
        'Understand the user goal, make a short working plan for the current task, and decide whether to answer directly or delegate.',
        'Track whether progress is being made, and revise the next step if progress stalls.',
      ].join('\n'),
      constraints: [
        'The visible canvas is your full action space.',
        'You may only delegate through visible outgoing magentic_option connections from this card.',
        'Only visibly connected outgoing magentic_option paths are callable.',
        'If the task can be answered directly without delegation, do so.',
        'If delegation is needed, choose exactly one connected node for the next assignment and explain why that node is the best next move.',
        'Do not invent agents, tools, routes, subprocesses, hidden plans, or capabilities that are not present on the canvas.',
        'Do not create workflow steps that are not represented by the visible graph structure.',
        'If no connected node can validly help, stop and return control to the human.',
      ].join('\n'),
      ioSchema: [
        'Input: user request plus visible callable node summaries and any completed results from this run.',
        'Output: either a direct answer or one selected connected node for the next assignment.',
        'Use the plan stream to report short plain-text updates in this shape:',
        'Goal: ...',
        'Next: calling [Node Title] because ...',
        'Progress: ...',
        'Result: ...',
        'Waiting: more work, human input, or done.',
      ].join('\n'),
      memoryPolicy: [
        'Use only the current request, the visible callable node list, completed results from this run, and explicit deck context.',
        'Keep the working plan short, update it after each result, and re-plan if progress stalls.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_thinkgraph_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the ThinkGraph Agent, a graph-specialist agent for provisional and planning memory.',
        'You work only with ThinkGraph (PostgreSQL + AGE), which stores provisional semantic structure.',
      ].join('\n'),
      goal: [
        'Extract and manage provisional entities, relationships, hypotheses, working state, and gaps.',
        'ThinkGraph is read first by the planner to understand current ideas, goals, and open loops.',
      ].join('\n'),
      constraints: [
        'ThinkGraph is provisional/subjective memory, not grounded facts.',
        'Separate candidate claims from grounded evidence.',
        'Keep structure concise and useful for planning.',
        'Do not merge ThinkGraph with KnowGraph or CodeGraph.',
      ].join('\n'),
      ioSchema: [
        'Input: user request or planning context.',
        'Output: provisional entities, relationships, hypotheses, gaps, and next research targets.',
      ].join('\n'),
      memoryPolicy: [
        'Use current input and existing ThinkGraph context.',
        'ThinkGraph stores: ideas, prompts, goals, hypotheses, working summaries, open questions.',
      ].join('\n'),
    }),
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
        'You are the Research Agent, a worker agent for conducting research and gathering information.',
        'You analyze requests, perform research, and produce structured findings for downstream agents.',
      ].join('\n'),
      goal: [
        'Analyze research requests and gather relevant information from available sources.',
        'Produce structured research findings that can be consumed by KnowGraph Agent for grounding.',
      ].join('\n'),
      constraints: [
        'Focus on research and analysis tasks.',
        'Produce structured output suitable for downstream processing.',
        'Do not store grounded knowledge yourself; pass findings to KnowGraph Agent.',
      ].join('\n'),
      ioSchema: [
        'Input: research request or analysis task from upstream agents.',
        'Output: structured research findings, analysis results, and recommendations.',
      ].join('\n'),
      memoryPolicy: [
        'Use current input and any provided context from upstream agents.',
        'Research output should be structured for KnowGraph Agent to ground and store.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_knowgraph_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the KnowGraph Agent, a graph-specialist agent for grounded and evidence-backed memory.',
        'You work only with KnowGraph (Neo4j), which stores grounded entities, relationships, docs, PDFs, web research summaries, links, and provenance.',
      ].join('\n'),
      goal: [
        'Extract and manage grounded knowledge: evidence-backed entities, relationships, research summaries, and citations.',
        'KnowGraph is read third by the planner to understand what docs, PDFs, research, grounded evidence, summaries, and links matter.',
      ].join('\n'),
      constraints: [
        'KnowGraph is grounded/evidence-backed memory, not provisional thought.',
        'Only promote structure backed by sources.',
        'Preserve citations and provenance.',
        'Do not merge KnowGraph with ThinkGraph or CodeGraph.',
      ].join('\n'),
      ioSchema: [
        'Input: research findings or grounded knowledge request.',
        'Output: grounded entities, relationships, evidence summaries, citations, and provenance.',
      ].join('\n'),
      memoryPolicy: [
        'Use current input and existing KnowGraph context.',
        'KnowGraph stores: grounded entities, relationships, docs, PDFs, research summaries, links, provenance.',
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
  ...UA_AGENT_DEFINITIONS.map((agent): PromptTemplate => ({
    id: agent.promptTemplateId,
    content: buildSpecialistGraphProposalPrompt(agent.prompt),
  })),
  {
    id: 'prompt_energy_workbench',
    content: buildSeedPromptTemplate({
      role: [
        'You are the NRGSim / Energy workbench card.',
        'You represent the visible Building Modeler and Energy surface on the board.',
      ].join('\n'),
      goal: [
        'Expose the Energy workspace as a selectable board capability.',
        'Keep this as a staged capability; a runtime bridge can be attached later.',
      ].join('\n'),
      constraints: [
        'Do not call backend model runtime from this card.',
        'Use the existing Energy surface for interaction.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future Energy workbench request.',
        'Output: open or focus the Energy workspace surface.',
      ].join('\n'),
      memoryPolicy: [
        'Use this as a placeholder workspace until a runtime bridge is connected.',
      ].join('\n'),
    }),
  },
  {
    id: 'prompt_plan_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Plan Agent.',
        'You represent planning and approval as a visible, selectable system card.',
      ].join('\n'),
      goal: [
        'Expose the plan workspace and approval surface when the user activates planning.',
      ].join('\n'),
      constraints: [
        'Do not silently rewire the canvas.',
        'Do not claim an activation was executed unless the graph was actually changed.',
      ].join('\n'),
      ioSchema: [
        'Input: activation proposal or planning context.',
        'Output: a visible plan/approval workspace for human review.',
      ].join('\n'),
      memoryPolicy: [
        'Keep planning visible and user-approved before graph changes are applied.',
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
    id: 'prompt_telescope_agent',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Telescope Agent.',
        'You represent the visible Telescope imagery and inspection workspace on the board.',
      ].join('\n'),
      goal: [
        'Explain and coordinate Telescope/JWST imagery context when the user selects that capability.',
        'Keep this prompt-only until a safe Telescope tool bridge is connected.',
      ].join('\n'),
      constraints: [
        'Do not claim image tiles, external data pulls, or exports were produced unless a real bridge exists.',
        'Use only canvas context and explicit user input until direct tooling is available.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future Telescope workbench request.',
        'Output: image/context reasoning or a request to open the Telescope workspace.',
      ].join('\n'),
      memoryPolicy: [
        'Treat this as a visible prompt-level agent until the Telescope tool bridge is available.',
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
    id: 'prompt_image_workbench',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Image Maker Agent workbench card.',
        'You represent the visible image generation and print-placement workspace on the board.',
      ].join('\n'),
      goal: [
        'Expose the Image Maker workspace as a connectable workbench capability.',
        'Keep this staged until the app-owned image generation bridge is restored.',
      ].join('\n'),
      constraints: [
        'Do not call backend model runtime from this card.',
        'Do not claim images were generated or exported unless a real bridge exists.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future image workbench request.',
        'Output: open or focus the Image Maker workspace surface.',
      ].join('\n'),
      memoryPolicy: [
        'Treat this as a visible activation stub for the future image workflow.',
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
  {
    id: 'prompt_video_workbench',
    content: buildSeedPromptTemplate({
      role: [
        'You are the Video Agent workbench card.',
        'You represent the visible video workflow workspace on the board.',
      ].join('\n'),
      goal: [
        'Expose the Video workspace as a connectable workbench capability.',
        'Keep this staged until the app-owned video generation bridge is restored.',
      ].join('\n'),
      constraints: [
        'Do not call backend model runtime from this card.',
        'Do not claim clips, renders, or exports were produced unless a real bridge exists.',
      ].join('\n'),
      ioSchema: [
        'Input: user selection or future video workbench request.',
        'Output: open or focus the Video workspace surface.',
      ].join('\n'),
      memoryPolicy: [
        'Treat this as a visible activation stub for the future video workflow.',
      ].join('\n'),
    }),
  },
];

const INITIAL_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'template_magentic',
    name: 'Magentic-One',
    promptTemplate: 'prompt_magentic',
    model: 'gpt-5.1-chat-latest',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_thinkgraph_agent',
    name: 'ThinkGraph Agent',
    promptTemplate: 'prompt_thinkgraph_agent',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1400,
    tools: ['thinkgraph_query', 'thinkgraph_write', 'entity_extractor'],
  },
  {
    id: 'template_codegraph_agent',
    name: 'CodeGraph Agent',
    promptTemplate: 'prompt_codegraph_agent',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1400,
    tools: ['codegraph_query', 'codegraph_write', 'code_analyzer'],
  },
  {
    id: 'template_research_agent',
    name: 'Research Agent',
    promptTemplate: 'prompt_research_agent',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1400,
    tools: ['web_search', 'knowledge_ingest'],
  },
  {
    id: 'template_knowgraph_agent',
    name: 'KnowGraph Agent',
    promptTemplate: 'prompt_knowgraph_agent',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1400,
    tools: [
      'knowgraph_query',
      'knowgraph_write',
      'web_search',
      'knowledge_ingest',
    ],
  },
  {
    id: 'template_assist',
    name: 'Assist',
    promptTemplate: 'prompt_assist',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  ...UA_AGENT_DEFINITIONS.map((agent): AgentTemplate => ({
    id: agent.templateId,
    name: agent.name,
    promptTemplate: agent.promptTemplateId,
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1400,
    tools: [],
    skills: [...agent.skills],
    personas: [agent.skillId],
  })),
  {
    id: 'template_local_coder',
    name: 'Local Coder',
    promptTemplate: 'prompt_assist',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: 'template_energy_workbench',
    name: 'NRGSim / Energy',
    promptTemplate: 'prompt_energy_workbench',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_plan_agent',
    name: 'Plan Agent',
    promptTemplate: 'prompt_plan_agent',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_worldsignals_agent',
    name: 'WorldSignals Agent',
    promptTemplate: 'prompt_worldsignals_agent',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_telescope_agent',
    name: 'Telescope Agent',
    promptTemplate: 'prompt_telescope_agent',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_trading_workbench',
    name: 'Trading Agent',
    promptTemplate: 'prompt_trading_workbench',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_image_workbench',
    name: 'Image Maker Agent',
    promptTemplate: 'prompt_image_workbench',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_code_workbench',
    name: 'Code Agent',
    promptTemplate: 'prompt_code_workbench',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
  {
    id: 'template_video_workbench',
    name: 'Video Agent',
    promptTemplate: 'prompt_video_workbench',
    model: 'gpt-5-mini',
    provider: 'openai',
    temperature: 0.2,
    maxTokens: 800,
    tools: [],
  },
];

const UA_AGENT_CARD_COLUMNS = 3;
const UA_AGENT_CARD_ORIGIN = { x: 340, y: -180 };
const UA_AGENT_CARD_GAP = { x: 260, y: 120 };

const UA_AGENT_CARD_IDS = new Set(
  UA_AGENT_DEFINITIONS.map((agent) => `card_ua_${agent.id}`),
);
const UA_AGENT_TEMPLATE_IDS = new Set(
  UA_AGENT_DEFINITIONS.map((agent) => agent.templateId),
);

function buildUaAgentSeedNodes(): AgentCardInstance[] {
  return UA_AGENT_DEFINITIONS.map((agent, index) => {
    const column = index % UA_AGENT_CARD_COLUMNS;
    const row = Math.floor(index / UA_AGENT_CARD_COLUMNS);
    return {
      id: `card_ua_${agent.id}`,
      kind: 'agent',
      templateId: agent.templateId,
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === agent.promptTemplateId,
        )?.content || '',
      runtimeBinding: agent.runtimeBinding,
      runtimeType: agent.runtimeType,
      parentGraphId: null,
      title: agent.name,
      subtitle: agent.subtitle,
      position: {
        x: UA_AGENT_CARD_ORIGIN.x + column * UA_AGENT_CARD_GAP.x,
        y: UA_AGENT_CARD_ORIGIN.y + row * UA_AGENT_CARD_GAP.y,
      },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    };
  });
}

export const INITIAL_DECK: DeckDocument = {
  id: 'deck_builder',
  name: 'Agent Card Deck',
  promptTemplates: cloneDeckDocument(INITIAL_PROMPT_TEMPLATES),
  version: 3,
  nodes: [
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
        provider: 'openai',
        modelKey: 'gpt-5.1-chat-latest',
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
      id: 'card_energy_workbench',
      kind: 'agent',
      templateId: 'template_energy_workbench',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_energy_workbench',
        )?.content || '',
      runtimeBinding: 'energy_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: 'workbench_energy',
      title: 'NRGSim / Energy',
      subtitle: 'Building Modeler workbench',
      position: { x: 260, y: 140 },
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
      id: 'card_image_workbench',
      kind: 'agent',
      templateId: 'template_image_workbench',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_image_workbench',
        )?.content || '',
      runtimeBinding: 'image_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: 'workbench_image',
      title: 'Image Maker Agent',
      subtitle: 'Generation and print placement',
      position: { x: 780, y: 140 },
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
      id: 'card_video_workbench',
      kind: 'agent',
      templateId: 'template_video_workbench',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_video_workbench',
        )?.content || '',
      runtimeBinding: 'video_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: 'workbench_video',
      title: 'Video Agent',
      subtitle: 'Storyboard and clips',
      position: { x: 780, y: 320 },
      status: 'ready',
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: 'card_telescope_agent',
      kind: 'agent',
      templateId: 'template_telescope_agent',
      prompt:
        INITIAL_PROMPT_TEMPLATES.find(
          (template) => template.id === 'prompt_telescope_agent',
        )?.content || '',
      runtimeBinding: 'telescope_agent',
      runtimeType: 'assistant_agent',
      parentGraphId: null,
      title: 'Telescope Agent',
      subtitle: 'JWST imagery and inspection context',
      position: { x: 1040, y: 320 },
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
    ...buildUaAgentSeedNodes(),
  ],
  edges: [],
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
  card_telescope_agent: 'telescope_agent',
  card_energy_workbench: 'energy_agent',
  card_trading_workbench: 'trading_agent',
  card_image_workbench: 'image_agent',
  card_code_workbench: 'code_agent',
  card_video_workbench: 'video_agent',
  // Backward compatibility: legacy card IDs for existing saved decks
  card_main_chat: 'main_chat',
  card_kg_ingest: 'kg_ingest',
  card_research: 'research_agent',
  card_knowgraph: 'knowgraph',
  card_neo4j: 'neo4j',
};

const BASELINE_OPTIONAL_CARD_IDS = new Set([
  'card_local_coder',
  'card_plan_agent',
  'card_worldsignals_agent',
  'card_telescope_agent',
  'card_energy_workbench',
  'card_trading_workbench',
  'card_image_workbench',
  'card_code_workbench',
  'card_video_workbench',
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
  if (normalized === 'telescope_agent') return 'telescope_agent';
  if (normalized === 'energy_agent') return 'energy_agent';
  if (normalized === 'trading_agent') return 'trading_agent';
  if (normalized === 'image_agent') return 'image_agent';
  if (normalized === 'code_agent') return 'code_agent';
  if (normalized === 'video_agent') return 'video_agent';
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
          (isTopLevelCanvasCard(targetNode) || isEnergyWorkbenchCard(targetNode)) &&
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
  if (normalizedNodes.length === 0) return [];

  const existingIds = new Set(normalizedNodes.map((node) => node.id));
  const existingTemplateIds = new Set(
    normalizedNodes.map((node) => node.templateId),
  );
  const appendedNodes = INITIAL_DECK.nodes
    .filter(
      (node) =>
        BASELINE_OPTIONAL_CARD_IDS.has(node.id) ||
        UA_AGENT_CARD_IDS.has(node.id),
    )
    .filter((node) => {
      if (existingIds.has(node.id)) return false;
      if (
        UA_AGENT_CARD_IDS.has(node.id) &&
        UA_AGENT_TEMPLATE_IDS.has(node.templateId) &&
        existingTemplateIds.has(node.templateId)
      ) {
        return false;
      }
      return true;
    })
    .map((node) => cloneDeckDocument(node));
  return [...normalizedNodes, ...appendedNodes];
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
  const defaultNodeIds = new Set(INITIAL_DECK.nodes.map((node) => node.id));
  const legacyCompatibleNodeIds = new Set([
    ...Array.from(LEGACY_SYSTEM_CARD_IDS),
    ...Array.from(BASELINE_OPTIONAL_CARD_IDS),
  ]);
  const hasOnlyLegacySystemNodes =
    deck.nodes.length > 0 &&
    deck.nodes.some((node) => LEGACY_SYSTEM_CARD_IDS.has(node.id)) &&
    deck.nodes.every((node) => legacyCompatibleNodeIds.has(node.id));
  if (hasOnlyLegacySystemNodes) {
    return {
      ...cloneDeckDocument(INITIAL_DECK),
      id: deck.id || INITIAL_DECK.id,
      name: deck.name || INITIAL_DECK.name,
      version: Math.max(deck.version, INITIAL_DECK.version),
    };
  }
  const hasOnlySystemNodes =
    deck.nodes.length > 0 &&
    deck.nodes.every((node) => defaultNodeIds.has(node.id));
  const isExactSystemDeckShape =
    hasOnlySystemNodes && deck.nodes.length === defaultNodeIds.size;
  const isPartialSystemDeckShape =
    hasOnlySystemNodes && deck.nodes.length < defaultNodeIds.size;

  if (!isExactSystemDeckShape && !isPartialSystemDeckShape) {
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

  const nextEdges = isPartialSystemDeckShape
    ? (() => {
        const mergedEdges = new Map<string, DeckEdge>();
        deck.edges.forEach((edge) => {
          mergedEdges.set(edge.id, cloneDeckDocument(edge));
        });
        INITIAL_DECK.edges.forEach((edge) => {
          if (!mergedEdges.has(edge.id)) {
            mergedEdges.set(edge.id, cloneDeckDocument(edge));
          }
        });
        return filterAuthoringCompatibleEdges(
          upgradedNodes,
          Array.from(mergedEdges.values()),
        );
      })()
    : filterAuthoringCompatibleEdges(upgradedNodes, deck.edges);

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
    nodes: hydratedDeck.nodes.filter((node) => !bannedNodeIds.has(node.id)),
    edges: hydratedDeck.edges.filter(
      (edge) =>
        !bannedNodeIds.has(edge.source) && !bannedNodeIds.has(edge.target),
    ),
    promptTemplates: hydratedDeck.promptTemplates.filter(
      (template) => !bannedPromptTemplateIds.has(template.id),
    ),
  };
  const hasTopLevelMagentic = baseDeck.nodes.some(
    (node) =>
      normalizeRuntimeType(node.runtimeType) === 'magentic_one' &&
      !String(node.parentGraphId || '').trim(),
  );
  if (hasTopLevelMagentic) {
    return baseDeck;
  }
  const seedMagentic = INITIAL_DECK.nodes.find(
    (node) =>
      normalizeRuntimeType(node.runtimeType) === 'magentic_one' &&
      !String(node.parentGraphId || '').trim(),
  );
  if (!seedMagentic) return baseDeck;
  return {
    ...baseDeck,
    nodes: [...baseDeck.nodes, { ...seedMagentic }],
  };
}

function isTruncatedSystemDeckPayload(
  deckPayload: Partial<DeckDocument>,
): boolean {
  if (!Array.isArray(deckPayload.nodes)) {
    return false;
  }

  const canonicalNodeIds = new Set(INITIAL_DECK.nodes.map((node) => node.id));
  const nodeIds = deckPayload.nodes
    .map((node) => safeText((node as { id?: unknown } | null)?.id).trim())
    .filter(Boolean);

  if (nodeIds.length === 0) {
    return false;
  }

  return (
    nodeIds.length < canonicalNodeIds.size &&
    nodeIds.every((nodeId) => canonicalNodeIds.has(nodeId))
  );
}

export function resolveProjectDeckPayload(
  deckPayload: Partial<DeckDocument> | null | undefined,
): { deck: DeckDocument; usedFallback: boolean; displayFallbackOnly: boolean } {
  if (!deckPayload || typeof deckPayload !== 'object') {
    return {
      deck: hydrateDeckDocument(INITIAL_DECK),
      usedFallback: true,
      displayFallbackOnly: false,
    };
  }

  if (isTruncatedSystemDeckPayload(deckPayload)) {
    return {
      deck: hydrateDeckDocument(deckPayload),
      usedFallback: true,
      displayFallbackOnly: true,
    };
  }

  return {
    deck: hydrateDeckDocument(deckPayload),
    usedFallback: false,
    displayFallbackOnly: false,
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
  displayFallbackOnly: boolean;
} {
  if (preserveCurrentOnFailure) {
    return {
      deck: cloneDeckDocument(currentDeck),
      usedFallback: false,
      preservedCurrent: true,
      displayFallbackOnly: false,
    };
  }

  const resolved = resolveProjectDeckPayload(deckPayload);
  return {
    ...resolved,
    preservedCurrent: false,
  };
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
    plan: [...EMPTY_PROJECT_STATE.plan],
    links: [...EMPTY_PROJECT_STATE.links],
  };
}

// helper: convert AGE query results to graph nodes/edges for visualization
function ageRowsToGraph(rows: any[]): { nodes: KNode[]; edges: KEdge[] } {
  const nodeMap = new Map<string, KNode>();
  const edgeMap = new Map<string, KEdge>();

  const asObject = (raw: any): Record<string, any> | null => {
    const parsed =
      typeof raw === 'string'
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })()
        : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.row && typeof parsed.row === 'object')
      return parsed.row as Record<string, any>;
    return parsed as Record<string, any>;
  };

  const normalizeType = (value: unknown): string => {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    return normalized || 'unknown';
  };

  const toNum = (value: unknown): number | undefined => {
    if (value == null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  const toIsoTs = (value: unknown): string | undefined => {
    const ms = parseTimestampMs(value);
    if (typeof ms !== 'number') return undefined;
    return new Date(ms).toISOString();
  };

  const upsertNode = (
    idRaw: unknown,
    labelRaw: unknown,
    typeRaw: unknown,
    tsRaw: unknown,
    scopeRaw?: unknown,
  ) => {
    const id = String(idRaw ?? '').trim();
    if (!id) return;

    const label = String(labelRaw ?? '').trim() || id.slice(0, 12);
    const type = normalizeType(typeRaw);
    const scope = normalizeKnowledgeScope(scopeRaw, 'project');
    const nextMs = parseTimestampMs(tsRaw);
    const nextTs =
      typeof nextMs === 'number' ? new Date(nextMs).toISOString() : undefined;

    const existing = nodeMap.get(id);
    if (!existing) {
      nodeMap.set(id, {
        id,
        label,
        type,
        scope,
        createdAtMs: nextMs,
        last_seen_ts: nextTs,
      });
      return;
    }

    if (!existing.label || existing.label === existing.id.slice(0, 12)) {
      existing.label = label;
    }
    if ((!existing.type || existing.type === 'unknown') && type !== 'unknown') {
      existing.type = type;
    }
    existing.scope = normalizeKnowledgeScope(existing.scope, scope);
    if (
      typeof nextMs === 'number' &&
      (!existing.createdAtMs || nextMs > existing.createdAtMs)
    ) {
      existing.createdAtMs = nextMs;
      existing.last_seen_ts = nextTs;
    }
  };

  const upsertEdge = (
    sourceRaw: unknown,
    targetRaw: unknown,
    relTypeRaw: unknown,
    row: Record<string, any>,
  ) => {
    const source = String(sourceRaw ?? '').trim();
    const target = String(targetRaw ?? '').trim();
    if (!source || !target) return;

    const relType = normalizeRelationType(relTypeRaw) || 'related_to';
    const evidenceDocId =
      String(row.r_doc_id ?? row.doc_id ?? '').trim() || undefined;
    const evidenceSnippet =
      String(row.r_snippet ?? row.snippet ?? '').trim() || undefined;
    const edgeTs = toIsoTs(row.r_ts ?? row.r_created_at ?? row.created_at);
    const edgeWeight = toNum(row.r_weight ?? row.weight ?? row.confidence);
    const edgeConfidence = toNum(
      row.r_confidence ?? row.confidence ?? row.r_weight ?? row.weight,
    );
    const scope = normalizeKnowledgeScope(
      row.r_scope ?? row.scope ?? row.relationship_scope,
      'project',
    );
    const explicitEdgeId = String(row.r_id ?? row.edge_id ?? '').trim();
    const edgeId =
      explicitEdgeId ||
      `${source}->${target}:${relType}:${evidenceDocId || ''}:${edgeTs || ''}`;

    const existing = edgeMap.get(edgeId);
    if (!existing) {
      edgeMap.set(edgeId, {
        id: edgeId,
        source,
        target,
        a: source,
        b: target,
        type: relType,
        scope,
        weight: edgeWeight,
        confidence: edgeConfidence,
        last_seen_ts: edgeTs,
        lastSeenMs: parseTimestampMs(edgeTs),
        evidence_doc_id: evidenceDocId,
        evidence_snippet: evidenceSnippet,
      });
      return;
    }

    if (typeof edgeWeight === 'number') {
      existing.weight = Math.max(existing.weight ?? 0, edgeWeight);
    }
    if (typeof edgeConfidence === 'number') {
      existing.confidence = Math.max(existing.confidence ?? 0, edgeConfidence);
    }
    existing.scope = normalizeKnowledgeScope(existing.scope, scope);
    if (!existing.evidence_doc_id && evidenceDocId) {
      existing.evidence_doc_id = evidenceDocId;
    }
    if (!existing.evidence_snippet && evidenceSnippet) {
      existing.evidence_snippet = evidenceSnippet;
    }
    const nextMs = parseTimestampMs(edgeTs);
    if (
      typeof nextMs === 'number' &&
      (!existing.lastSeenMs || nextMs > existing.lastSeenMs)
    ) {
      existing.lastSeenMs = nextMs;
      existing.last_seen_ts = edgeTs;
    }
  };

  const extractNodeId = (obj: any): string => {
    if (!obj) return '';
    if (obj.id != null) return String(obj.id);
    if (obj._id != null) return String(obj._id);
    if (obj.vid != null) return String(obj.vid);
    return '';
  };

  rows.forEach((rawRow) => {
    const row = asObject(rawRow);
    if (!row) return;

    if (row.a_id != null && row.b_id != null) {
      upsertNode(
        row.a_id,
        row.a_name,
        row.a_type ?? row.a_etype ?? row.a_category,
        row.a_ts ?? row.a_created_at,
        row.a_scope,
      );
      upsertNode(
        row.b_id,
        row.b_name,
        row.b_type ?? row.b_etype ?? row.b_category,
        row.b_ts ?? row.b_created_at,
        row.b_scope,
      );
      upsertEdge(row.a_id, row.b_id, row.r_type ?? row.rel_type, row);
      return;
    }

    if (row.a && row.b) {
      const aId = extractNodeId(row.a);
      const bId = extractNodeId(row.b);
      const aProps = row.a?.properties || row.a;
      const bProps = row.b?.properties || row.b;
      upsertNode(
        aId,
        aProps?.name ?? aProps?.label,
        aProps?.etype ?? aProps?.type,
        aProps?.created_at,
        aProps?.scope ?? row.a?.scope,
      );
      upsertNode(
        bId,
        bProps?.name ?? bProps?.label,
        bProps?.etype ?? bProps?.type,
        bProps?.created_at,
        bProps?.scope ?? row.b?.scope,
      );
      upsertEdge(aId, bId, row.r?.rtype ?? row.r?.type ?? row.rtype, {
        ...row,
        r_ts: row.r?.created_at,
        r_weight: row.r?.weight,
        r_confidence: row.r?.confidence,
        r_doc_id: row.r?.source?.doc_id,
        r_snippet: row.r?.source?.snippet,
        r_scope: row.r?.scope ?? row.r?.properties?.scope,
      });
    }
  });

  const edges = Array.from(edgeMap.values());
  const degreeByNode = new Map<string, number>();
  edges.forEach((e) => {
    const source = e.source || e.a;
    const target = e.target || e.b;
    if (!source || !target) return;
    degreeByNode.set(source, (degreeByNode.get(source) || 0) + 1);
    degreeByNode.set(target, (degreeByNode.get(target) || 0) + 1);
    if (!nodeMap.has(source)) {
      upsertNode(source, source, 'unknown', e.last_seen_ts, 'project');
    }
    if (!nodeMap.has(target)) {
      upsertNode(target, target, 'unknown', e.last_seen_ts, 'project');
    }
  });

  const nodes = Array.from(nodeMap.values()).map((n) => ({
    ...n,
    rawId: n.id,
    graphSource: 'think' as const,
    scope: normalizeKnowledgeScope(n.scope, 'project'),
    degree: degreeByNode.get(n.id) || 0,
    type: normalizeType(n.type),
  }));

  return {
    nodes,
    edges: edges.map((e) => ({
      ...e,
      rawId: e.id,
      graphSource: 'think' as const,
      scope: normalizeKnowledgeScope(e.scope, 'project'),
    })),
  };
}

function safeRecord(input: unknown): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, any>;
}

function normalizeKnowGraphResponseToGraph(payload: any): {
  nodes: KNode[];
  edges: KEdge[];
} {
  const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const rawRels = Array.isArray(payload?.relationships)
    ? payload.relationships
    : [];

  const nodes: KNode[] = [];
  const edges: KEdge[] = [];
  const seenNodeIds = new Set<string>();
  const seenEdgeIds = new Set<string>();

  rawNodes.forEach((raw: any) => {
    const rawId = String(raw?.id ?? '').trim();
    if (!rawId) return;
    const id = `kg:${rawId}`;
    if (seenNodeIds.has(id)) return;
    seenNodeIds.add(id);

    const props = safeRecord(raw?.properties);
    const ts =
      props.last_seen_ts ?? props.created_at ?? props.updated_at ?? undefined;
    nodes.push({
      id,
      rawId,
      graphSource: 'know',
      scope: normalizeKnowledgeScope(
        props.scope ?? raw?.scope,
        'grounded_research',
      ),
      label: safeText(raw?.label || props.name || props.title || rawId),
      type: safeText(
        raw?.type ||
          (Array.isArray(raw?.labels) ? raw.labels[0] : '') ||
          'NeoEntity',
      ).toLowerCase(),
      last_seen_ts: typeof ts === 'string' ? ts : undefined,
      createdAtMs: parseTimestampMs(ts),
      degree: 0,
    });
  });

  rawRels.forEach((raw: any) => {
    const rawId =
      String(raw?.id ?? '').trim() ||
      `${raw?.from ?? ''}->${raw?.to ?? ''}:${raw?.type ?? 'RELATED_TO'}`;
    const fromRaw = String(raw?.from ?? '').trim();
    const toRaw = String(raw?.to ?? '').trim();
    if (!fromRaw || !toRaw) return;

    const id = `kg:${rawId}`;
    if (seenEdgeIds.has(id)) return;
    seenEdgeIds.add(id);

    const props = safeRecord(raw?.properties);
    const source = `kg:${fromRaw}`;
    const target = `kg:${toRaw}`;
    const lastSeen =
      props.last_seen_ts ?? props.created_at ?? props.updated_at ?? undefined;
    const confidenceNum = Number(props.confidence ?? props.score ?? NaN);
    const weightNum = Number(
      props.weight ?? props.score ?? props.confidence ?? NaN,
    );

    edges.push({
      id,
      rawId,
      graphSource: 'know',
      scope: normalizeKnowledgeScope(
        props.scope ?? raw?.scope,
        'grounded_research',
      ),
      a: source,
      b: target,
      source,
      target,
      type: safeText(raw?.type || 'RELATED_TO').toLowerCase(),
      weight: Number.isFinite(weightNum) ? weightNum : undefined,
      confidence: Number.isFinite(confidenceNum) ? confidenceNum : undefined,
      last_seen_ts: typeof lastSeen === 'string' ? lastSeen : undefined,
      lastSeenMs: parseTimestampMs(lastSeen),
      evidence_doc_id: safeText(props.document_id || props.doc_id || ''),
      evidence_snippet: safeText(props.snippet || props.evidence_snippet || ''),
    });
  });

  const degreeByNode = new Map<string, number>();
  edges.forEach((e) => {
    const s = e.source || e.a;
    const t = e.target || e.b;
    if (s) degreeByNode.set(s, (degreeByNode.get(s) || 0) + 1);
    if (t) degreeByNode.set(t, (degreeByNode.get(t) || 0) + 1);
  });

  return {
    nodes: nodes.map((n) => ({
      ...n,
      degree: degreeByNode.get(n.id) || n.degree || 0,
    })),
    edges,
  };
}

function buildThinkRowsFromMergedGraphPayload(payload: any): any[] {
  const rawEntities = Array.isArray(payload?.entities) ? payload.entities : [];
  const rawRelationships = Array.isArray(payload?.relationships)
    ? payload.relationships
    : [];
  if (rawEntities.length === 0 || rawRelationships.length === 0) return [];

  const entityById = new Map<
    string,
    {
      id: string;
      label: string;
      type: string;
      lastSeenTs?: string;
    }
  >();

  rawEntities.forEach((entry: any) => {
    const id = String(entry?.id ?? '').trim();
    if (!id) return;
    entityById.set(id, {
      id,
      label: safeText(entry?.label || entry?.name || entry?.title || id),
      type: safeText(entry?.type || entry?.labels?.[0] || 'entity').toLowerCase(),
      lastSeenTs: cleanOptionalText(
        entry?.last_seen_ts ??
          entry?.lastSeenTs ??
          entry?.updated_at ??
          entry?.created_at,
      ) ?? undefined,
    });
  });

  const rows = rawRelationships
    .map((entry: any, index: number) => {
      const sourceId = String(entry?.from ?? entry?.source ?? '').trim();
      const targetId = String(entry?.to ?? entry?.target ?? '').trim();
      if (!sourceId || !targetId) return null;
      const source = entityById.get(sourceId);
      const target = entityById.get(targetId);
      if (!source || !target) return null;

      const relationType = safeText(entry?.type || 'related_to').toLowerCase();
      const relationId =
        cleanOptionalText(entry?.id) ||
        `${sourceId}:${relationType}:${targetId}:${index}`;
      const confidence = Number(entry?.confidence ?? entry?.weight ?? 0.5);
      const weight = Number(entry?.weight ?? entry?.confidence ?? 0.5);
      const relationTs =
        cleanOptionalText(
          entry?.last_seen_ts ??
            entry?.lastSeenTs ??
            entry?.updated_at ??
            entry?.created_at,
        ) || source.lastSeenTs || target.lastSeenTs;

      return {
        a_id: source.id,
        a_name: source.label,
        a_type: source.type,
        a_ts: source.lastSeenTs,
        r_id: relationId,
        r_type: relationType,
        r_weight: Number.isFinite(weight) ? weight : 0.5,
        r_confidence: Number.isFinite(confidence) ? confidence : 0.5,
        r_ts: relationTs,
        b_id: target.id,
        b_name: target.label,
        b_type: target.type,
        b_ts: target.lastSeenTs,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return rows;
}

function prefixThinkGraphIds(graph: { nodes: KNode[]; edges: KEdge[] }): {
  nodes: KNode[];
  edges: KEdge[];
} {
  const rawToPrefixed = new Map<string, string>();
  graph.nodes.forEach((n) => {
    rawToPrefixed.set(n.id, `tg:${n.id}`);
  });

  const nodes = graph.nodes.map((n) => ({
    ...n,
    rawId: n.rawId || n.id,
    id: rawToPrefixed.get(n.id) || `tg:${n.id}`,
    graphSource: 'think' as const,
  }));

  const edges = graph.edges.map((e) => {
    const rawSource = String(e.source || e.a || '').trim();
    const rawTarget = String(e.target || e.b || '').trim();
    const prefSource = rawToPrefixed.get(rawSource) || `tg:${rawSource}`;
    const prefTarget = rawToPrefixed.get(rawTarget) || `tg:${rawTarget}`;
    return {
      ...e,
      rawId: e.rawId || e.id,
      graphSource: 'think' as const,
      id: e.id
        ? `tg:${e.id}`
        : `${prefSource}->${prefTarget}:${e.type || 'related_to'}`,
      a: prefSource,
      b: prefTarget,
      source: prefSource,
      target: prefTarget,
    };
  });

  return { nodes, edges };
}

function mergeKnowledgeGraphs(
  ...graphs: Array<{ nodes: KNode[]; edges: KEdge[] }>
): { nodes: KNode[]; edges: KEdge[] } {
  const nodeMap = new Map<string, KNode>();
  const edgeMap = new Map<string, KEdge>();

  graphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      if (!node?.id) return;
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    });
    graph.edges.forEach((edge) => {
      const edgeId = String(edge?.id || '').trim();
      if (!edgeId) return;
      if (!edgeMap.has(edgeId)) {
        edgeMap.set(edgeId, edge);
      }
    });
  });

  const degreeByNode = new Map<string, number>();
  Array.from(edgeMap.values()).forEach((e) => {
    const s = e.source || e.a;
    const t = e.target || e.b;
    if (s) degreeByNode.set(s, (degreeByNode.get(s) || 0) + 1);
    if (t) degreeByNode.set(t, (degreeByNode.get(t) || 0) + 1);
  });

  return {
    nodes: Array.from(nodeMap.values()).map((n) => ({
      ...n,
      degree: degreeByNode.get(n.id) || n.degree || 0,
    })),
    edges: Array.from(edgeMap.values()),
  };
}
void mergeKnowledgeGraphs;

function buildGraphVizForNVL(graph: { nodes: KNode[]; edges: KEdge[] }) {
  const entities: KnowledgeGraphNode[] = graph.nodes.map((n) => {
    const source = n.graphSource === 'know' ? 'know' : 'think';
    return {
      id: n.id,
      rawId: n.rawId || n.id,
      label: n.label || n.id,
      type: String(n.type || 'unknown').toLowerCase(),
      source,
      scope: normalizeKnowledgeScope(
        n.scope,
        n.graphSource === 'know' ? 'grounded_research' : 'project',
      ),
      originSource: source,
      last_seen_ts: n.last_seen_ts,
      degree: n.degree || 0,
    };
  });

  const relationships: KnowledgeGraphRelationship[] = [];
  graph.edges.forEach((e) => {
    const source = e.source || e.a;
    const target = e.target || e.b;
    if (!source || !target) return;
    relationships.push({
      id: e.id || `${source}->${target}:${e.type || 'related_to'}`,
      rawId:
        e.rawId || e.id || `${source}->${target}:${e.type || 'related_to'}`,
      from: source,
      to: target,
      type: e.type || 'related_to',
      source: e.graphSource === 'know' ? 'know' : 'think',
      scope: normalizeKnowledgeScope(
        e.scope,
        e.graphSource === 'know' ? 'grounded_research' : 'project',
      ),
      weight: e.weight,
      confidence: e.confidence,
      last_seen_ts: e.last_seen_ts,
      evidence_doc_id: e.evidence_doc_id,
      evidence_snippet: e.evidence_snippet,
    });
  });

  return { entities, relationships };
}

function buildThinkGraphSeedFromPlanMissionGraph(
  missionGraph: ReturnType<typeof buildPlanMissionGraph>,
): { nodes: KNode[]; edges: KEdge[] } {
  const resolveThinkNodeType = (kindRaw: string): 'entity' | 'concept' | 'goal' | 'hypothesis' => {
    const kind = safeText(kindRaw).trim().toLowerCase();
    if (kind === 'goal' || kind === 'output') return 'goal';
    if (kind === 'approval' || kind === 'note') return 'hypothesis';
    if (kind === 'research' || kind === 'synthesize') return 'concept';
    return 'entity';
  };
  const nodes: KNode[] = missionGraph.nodes.map((node, index) => {
    const nodeData = safeRecord(node.data);
    const status = safeText(nodeData.status || 'seeded').trim().toLowerCase();
    const statusConfidence =
      status === 'complete'
        ? 0.94
        : status === 'running'
          ? 0.82
          : status === 'ready'
            ? 0.74
            : status === 'awaiting_review'
              ? 0.68
              : 0.62;
    return {
      id: `plan:${safeText(node.id)}`,
      rawId: safeText(node.id),
      graphSource: 'think',
      scope: 'project',
      label: safeText(nodeData.label || node.id),
      type: resolveThinkNodeType(safeText(nodeData.kind || 'task')),
      confidence: statusConfidence,
      createdAtMs: Date.now() - Math.max(0, (missionGraph.nodes.length - index) * 1_000),
    };
  });

  const edges: KEdge[] = missionGraph.edges.map((edge) => {
    const edgeData = safeRecord(edge.data);
    const motion = safeText(edgeData.motion || 'idle').trim().toLowerCase();
    const edgeConfidence =
      motion === 'running' ? 0.9 : motion === 'active' ? 0.78 : 0.62;
    const source = `plan:${safeText(edge.source)}`;
    const target = `plan:${safeText(edge.target)}`;
    const type = motion === 'running' ? 'supports' : 'depends_on';
    return {
      id: `plan:${safeText(edge.id)}`,
      rawId: safeText(edge.id),
      graphSource: 'think',
      scope: 'project',
      a: source,
      b: target,
      source,
      target,
      type,
      confidence: edgeConfidence,
      weight: edgeConfidence,
    };
  });

  return { nodes, edges };
}

// ---- small components ----
function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function HexPlusIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="4.75"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M32 4.5L55.5 18V46L32 59.5L8.5 46V18L32 4.5Z" />
      <path d="M32 19V45" strokeLinecap="round" />
      <path d="M19 32H45" strokeLinecap="round" />
    </svg>
  );
}

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
  const [workspaceView, setWorkspaceView] = useState<
    | 'chat'
    | 'plan'
    | 'canvas'
    | 'knowledge'
    | 'codegraph'
    | 'energy'
    | 'trading'
    | 'image'
    | 'code'
    | 'video'
    | 'worldsignal'
    | UaAgentSurfaceId
  >('chat');
  const {
    activeProject,
    assistProjects,
    projectsError,
    setProjectsError,
    setActiveProjectWithUrl,
    refreshProjects,
  } = useBuilderProjects({
    projectsApi: V2_PROJECTS_API,
    workspaceView,
  });
  const [objectDrawerOpen, setObjectDrawerOpen] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(420);
  const [chatResizeHandleActive, setChatResizeHandleActive] = useState(false);
  const workspaceShellRef = useRef<HTMLDivElement | null>(null);
  const [moonPhase01, setMoonPhase01] = useState(() =>
    synodicPhaseFromDate(new Date()),
  );
  const canvasProjectId = cleanOptionalText(activeProject) ?? '';
  const [deck, setDeckState] = useState<DeckDocument>(() =>
    hydrateDeckDocument(INITIAL_DECK),
  );
  const [pendingActivationProposal, setPendingActivationProposal] =
    useState<ActivationProposalState | null>(null);
  const visibleRailItems = useMemo(
    () =>
      deriveVisibleRailItems({
        deck,
        workspaceView,
        pendingActivationProposal,
      }),
    [deck, pendingActivationProposal, workspaceView],
  );
  const activeUaAgentDefinition = useMemo(
    () => getUaAgentDefinitionBySurface(workspaceView),
    [workspaceView],
  );
  const [deckRevision, setDeckRevision] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedKnowledgeEntityId, setSelectedKnowledgeEntityId] = useState<
    string | null
  >(null);
  const [selectedKnowledgeRelationshipId, setSelectedKnowledgeRelationshipId] =
    useState<string | null>(null);
  const [planMissionFocus, setPlanMissionFocus] = useState<{
    nodeId: string;
    nodeLabel: string;
    nodeKind: string;
    nodeData: PlanMissionNodeData;
  } | null>(null);
  const [planNodeDrafts, setPlanNodeDrafts] =
    useState<PlanMissionNodeOverrideMap>({});
  const workspacePanelAlreadyOpen = Boolean(
    (objectDrawerOpen && (selectedCardId || planMissionFocus?.nodeId)) ||
    selectedKnowledgeEntityId ||
    selectedKnowledgeRelationshipId,
  );
  const [builderCanvasFocusRequest, setBuilderCanvasFocusRequest] =
    useState<BuilderCanvasFocusRequest | null>(null);
  // TODO: replace manual deck input with plan-driven execution input.
  const [deckRunInput, setDeckRunInput] = useState('');
  const [latestDeckRun, setLatestDeckRun] = useState<DeckRun | null>(null);
  const [, setLatestCardRun] = useState<LatestCardRunRecord | null>(null);
  const [liveDeckEvents, setLiveDeckEvents] = useState<DeckRuntimeEvent[]>([]);
  const [deckRunBusy, setDeckRunBusy] = useState(false);
  const [cardRunBusy, setCardRunBusy] = useState(false);
  const [deckLoadBusy, setDeckLoadBusy] = useState(false);
  const [deckSaveBusy, setDeckSaveBusy] = useState(false);
  const [deckStatusMessage, setDeckStatusMessage] = useState<string | null>(
    null,
  );
  const [deckUsingDisplayFallback, setDeckUsingDisplayFallback] =
    useState(false);

  const [tab, setTab] = useState<string>('Canvas');
  const [openDrawer, setOpenDrawer] = useState<null | 'navigation'>(null);
  const [showCreateProjectForm, setShowCreateProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [sending, setSending] = useState(false);
  const [knowledgeGraphKind, setKnowledgeGraphKind] =
    useState<KnowledgeGraphKind>('knowgraph');
  const [graphViewContract, setGraphViewContract] =
    useState<GraphViewContract | null>(null);
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
      refreshKind: 'workspace_state' | 'agent_graph' | 'knowledge_graph',
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
  const healthCheckScheduledRef = useRef(false);
  const kgAutoLoadKeyRef = useRef('');
  const kgLoadAbortRef = useRef<AbortController | null>(null);
  const kgLoadProjectRef = useRef('');
  const kgExpandAbortRef = useRef<AbortController | null>(null);
  const kgExpandProjectRef = useRef('');
  const graphHydrateKeyRef = useRef('');
  const dashboardPollRunRef = useRef(0);
  const dashboardPollTimerRef = useRef<number | null>(null);
  const dashboardPollAbortRef = useRef<AbortController | null>(null);
  const dashboardPollProjectRef = useRef('');
  const loggedProjectRef = useRef<string | null>(null);
  const lastBuilderDeckWriteReasonRef = useRef<string | null>(null);
  const lastBuilderUiOnlyActionRef = useRef<string | null>(null);
  const lastBuilderDeckFingerprintRef = useRef<string | null>(null);

  const recordDeckWriteReason = useCallback(
    (reason: string) => {
      if (!BUILDER_DEV) return;
      lastBuilderDeckWriteReasonRef.current = reason;
      lastBuilderUiOnlyActionRef.current = null;
    },
    [BUILDER_DEV],
  );

  const recordUiOnlyAction = useCallback(
    (action: string) => {
      if (!BUILDER_DEV) return;
      lastBuilderUiOnlyActionRef.current = action;
    },
    [BUILDER_DEV],
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

  useEffect(() => {
    if (!canvasProjectId) {
      recordDeckWriteReason('builder-reset');
      setDeck(hydrateDeckDocument(INITIAL_DECK));
      setDeckRevision(null);
      setDeckUsingDisplayFallback(false);
      setLatestDeckRun(null);
      setLatestCardRun(null);
      setLiveDeckEvents([]);
      setMessages([...EMPTY_PROJECT_STATE.messages]);
      setPlanSource([...EMPTY_PROJECT_STATE.plan]);
      setPlan([...EMPTY_PROJECT_STATE.plan]);
      setLinks([...EMPTY_PROJECT_STATE.links]);
      setStateLoaded(false);
      setDeckStatusMessage(null);
      return;
    }

    const controller = new AbortController();
    const deckRefreshStartedAt = Date.now();
    let usedDisplayFallback = false;
    setDeckLoadBusy(true);
    setStateLoaded(false);
    setDeckRevision(null);
    setDeckStatusMessage('Loading canvas...');

    void (async () => {
      try {
        const endpoint = `${V3_PROJECTS_API}/${canvasProjectId}/decks/${BUILDER_DECK_ID}`;
        const payload = await guardedRequest({
          key: `v3-deck:${canvasProjectId}:${BUILDER_DECK_ID}`,
          method: 'GET',
          ttlMs: 1_000,
          signal: controller.signal,
          fetcher: async (signal) => {
            const response = await fetch(endpoint, { signal });
            const data = await safeJson(response);
            return { response, data };
          },
        });

        if (controller.signal.aborted) return;
        if (!payload.response.ok) {
          throw new Error(safeText(payload.data?.error || 'deck_load_failed'));
        }

        const loadResult = resolveProjectDeckLoadResult(
          deck,
          payload.data?.deck && typeof payload.data.deck === 'object'
            ? { ...(payload.data.deck as DeckDocument), id: BUILDER_DECK_ID }
            : null,
        );

        recordDeckWriteReason(
          loadResult.usedFallback ? 'deck-load-default' : 'deck-load',
        );
        setDeck(loadResult.deck);
        setDeckRevision(
          typeof payload.data?.meta?.deckRevision === 'string'
            ? payload.data.meta.deckRevision
            : null,
        );
        setDeckUsingDisplayFallback(loadResult.displayFallbackOnly);
        usedDisplayFallback = loadResult.displayFallbackOnly;
        const persistedLatestRun =
          payload.data?.latestRun && typeof payload.data.latestRun === 'object'
            ? (payload.data.latestRun as DeckRun)
            : null;
        const persistedRuns = Array.isArray(payload.data?.runs)
          ? (payload.data.runs as DeckRun[])
          : [];
        const continuity = buildReloadStateFromDeckRuns(
          persistedRuns,
          persistedLatestRun,
        );
        setLatestDeckRun(persistedLatestRun);
        setLatestCardRun(null);
        setLiveDeckEvents([]);
        setMessages(continuity.messages);
        setPendingActivationProposal(null);
        setPlanSource(continuity.planSource);
        setPlan(continuity.plan);
        setLinks(continuity.links);
        setStateLoaded(true);
        setDeckStatusMessage(
          loadResult.displayFallbackOnly
            ? 'Showing the canonical chain as a temporary fallback for a truncated saved canvas.'
            : loadResult.usedFallback
              ? 'Using default canvas.'
              : 'Canvas loaded.',
        );
      } catch (err: any) {
        if (controller.signal.aborted) return;
        recordDeckWriteReason('deck-load-default-error');
        setDeck(hydrateDeckDocument(INITIAL_DECK));
        setDeckUsingDisplayFallback(false);
        const next = loadProjectState(canvasProjectId);
        setLatestDeckRun(null);
        setLatestCardRun(null);
        setLiveDeckEvents([]);
        setDeckRevision(null);
        setMessages([...next.messages]);
        setPendingActivationProposal(null);
        setPlanSource([...next.plan]);
        setPlan([...next.plan]);
        setLinks([...next.links]);
        setStateLoaded(true);
        setDeckStatusMessage(
          formatBuilderStatusMessage(err?.message, 'Using default canvas.'),
        );
      } finally {
        if (!controller.signal.aborted) {
          const completedAt = Date.now();
          emitWorkspaceTestingEvent({
            event: 'graph_refresh_completed',
            durationMs: Math.max(0, completedAt - deckRefreshStartedAt),
            metadata: {
              graphType: 'agent',
              source: 'deck_load',
              usedDisplayFallback,
            },
          });
          recordPostResponseRefreshIfPending('agent_graph', completedAt);
          setDeckLoadBusy(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    emitWorkspaceTestingEvent,
    recordDeckWriteReason,
    recordPostResponseRefreshIfPending,
    canvasProjectId,
  ]);

  useEffect(() => {
    deckSaveAbortRef.current?.abort();
    deckSaveAbortRef.current = null;
    deckExecutionAbortRef.current?.abort();
    deckExecutionAbortRef.current = null;
    setSending(false);
    setDeckSaveBusy(false);
    setDeckRunBusy(false);
    setCardRunBusy(false);
    setPendingActivationProposal(null);
  }, [canvasProjectId]);

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
        effectiveAgent.provider === 'openrouter'
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
  const selectedCardMemoryGraph = useMemo<AgentManagerMemoryGraphData | null>(
    () =>
      buildSelectedCardMemoryGraphData(deck, selectedCard, selectedCardConfig),
    [deck, selectedCard, selectedCardConfig],
  );
  const activeDeckWorkspaceContext = useMemo<DeckWorkspaceContext>(
    () => ({
      workspaceView,
      largeSurface,
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
    }),
    [
      cardRunBusy,
      canvasProjectId,
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
    const context: WorkspaceObjectContext = {
      activeSurface:
        compactAwarenessText(largeSurface, 64) ||
        compactAwarenessText(workspaceView, 64) ||
        'chat',
      workspaceView: compactAwarenessText(workspaceView, 64),
      ...canvasAwareness,
    };

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
    } else if (workspaceView === 'plan' && planMissionFocus) {
      const nodeData = planMissionFocus.nodeData || {};
      context.selectedObjectId = compactAwarenessText(planMissionFocus.nodeId, 96);
      context.selectedObjectType = compactAwarenessText(
        `plan:${nodeData.kind || planMissionFocus.nodeKind || 'Task'}`,
        64,
      );
      context.selectedObjectTitle = compactAwarenessText(
        nodeData.label || planMissionFocus.nodeLabel,
        120,
      );
      context.selectedText = compactAwarenessText(
        nodeData.description || nodeData.starterPrompt,
        WORKSPACE_OBJECT_SELECTED_TEXT_LIMIT,
      );
      context.openObjectSummary = compactAwarenessText(
        [
          `Selected Plan Canvas node: ${nodeData.label || planMissionFocus.nodeLabel}`,
          `kind=${nodeData.kind || planMissionFocus.nodeKind || 'Task'}`,
          nodeData.status ? `status=${nodeData.status}` : null,
          nodeData.assignedAgentId ? `assignedAgent=${nodeData.assignedAgentId}` : null,
        ]
          .filter(Boolean)
          .join('; '),
        WORKSPACE_OBJECT_SUMMARY_LIMIT,
      );
    }

    return context;
  }, [deck, largeSurface, planMissionFocus, selectedCard, tab, workspaceView]);
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
    if (!selectedCardId) return;
    if (deck.nodes.some((node) => node.id === selectedCardId)) return;
    setSelectedCardId(null);
  }, [deck.nodes, selectedCardId]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    if (deck.edges.some((edge) => edge.id === selectedEdgeId)) return;
    setSelectedEdgeId(null);
  }, [deck.edges, selectedEdgeId]);

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
      setObjectDrawerOpen(Boolean(cardId));
      setSelectedCardId(cardId);
      const selectedNode = cardId
        ? deck.nodes.find((node) => node.id === cardId) || null
        : null;
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
        setPlanMissionFocus(null);
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

  const handleSelectKnowledgeEntity = useCallback(
    (entity: KnowledgeGraphNode | null) => {
      recordUiOnlyAction('knowledge-node-selection');
      if (!entity?.id) {
        pendingPanelOpenTelemetryRef.current = null;
      } else {
        const interactionId =
          createWorkspaceTestingInteractionId('knowledge-node');
        emitWorkspaceTestingEvent({
          event: 'knowledge_graph_node_selected',
          objectType: 'knowledge_node',
          objectId: entity.id,
          interactionId,
          metadata: { scope: entity.scope, source: entity.source },
        });
        queueWorkspacePanelTelemetry(
          'knowledge',
          'knowledge_node',
          entity.id,
          interactionId,
        );
      }
      setObjectDrawerOpen(false);
      setSelectedEdgeEvidence(null);
      setSelectedKnowledgeRelationshipId(null);
      setSelectedKnowledgeEntityId(entity?.id ?? null);
    },
    [
      emitWorkspaceTestingEvent,
      queueWorkspacePanelTelemetry,
      recordUiOnlyAction,
    ],
  );

  const handleSelectKnowledgeRelationship = useCallback(
    (relationship: KnowledgeGraphRelationship | null) => {
      recordUiOnlyAction('knowledge-edge-selection');
      if (!relationship?.id) {
        pendingPanelOpenTelemetryRef.current = null;
      } else {
        const interactionId =
          createWorkspaceTestingInteractionId('knowledge-edge');
        emitWorkspaceTestingEvent({
          event: 'knowledge_graph_edge_selected',
          objectType: 'knowledge_edge',
          objectId: relationship.id,
          interactionId,
          metadata: { scope: relationship.scope, source: relationship.source },
        });
        queueWorkspacePanelTelemetry(
          'knowledge',
          'knowledge_edge',
          relationship.id,
          interactionId,
        );
      }
      setObjectDrawerOpen(false);
      setSelectedEdgeEvidence(relationship);
      setSelectedKnowledgeEntityId(null);
      setSelectedKnowledgeRelationshipId(relationship?.id ?? null);
    },
    [
      emitWorkspaceTestingEvent,
      queueWorkspacePanelTelemetry,
      recordUiOnlyAction,
    ],
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
      deckUsingDisplayFallback,
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
      v3ProjectsApi: V3_PROJECTS_API,
      activeProjectLatestRef,
      recordDeckWriteReason,
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
        const nextRuntimeOptions = normalizeRuntimeOptions(
          nextConfig.runtime_options,
        );
        const nextParentGraphId = cleanOptionalText(nextConfig.parent_graph_id);
        const nextProvider =
          nextConfig.provider === 'openai' ||
          nextConfig.provider === 'openrouter'
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
          tools: !sameStringArray(nextTools, selectedTemplate.tools)
            ? nextTools
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

  const selectedPlanNodeDraft = useMemo<PlanMissionNodeData | null>(() => {
    if (!planMissionFocus?.nodeId) return null;
    const override = planNodeDrafts[planMissionFocus.nodeId] || {};
    const baseline = planMissionFocus.nodeData;
    return {
      label: String(
        override.label ?? baseline.label ?? planMissionFocus.nodeLabel,
      ),
      kind: (String(
        override.kind ?? baseline.kind ?? planMissionFocus.nodeKind,
      ) || 'Task') as PlanMissionNodeData['kind'],
      status: (String(override.status ?? baseline.status ?? 'seeded') ||
        'seeded') as PlanMissionNodeData['status'],
      description: String(override.description ?? baseline.description ?? ''),
      assignedAgentId: String(
        override.assignedAgentId ?? baseline.assignedAgentId ?? '',
      ),
      starterPrompt: String(
        override.starterPrompt ?? baseline.starterPrompt ?? '',
      ),
      updateKey: String(override.updateKey ?? baseline.updateKey ?? ''),
      outputKey: String(override.outputKey ?? baseline.outputKey ?? ''),
      editable: Boolean(override.editable ?? true),
    };
  }, [planMissionFocus, planNodeDrafts]);

  const updatePlanNodeDraft = useCallback(
    (nodeId: string, patch: Partial<PlanMissionNodeData>) => {
      setPlanNodeDrafts((current) => ({
        ...current,
        [nodeId]: {
          ...(current[nodeId] || {}),
          ...patch,
        },
      }));
    },
    [],
  );

  const renderPlanMissionEditorPanel = useCallback(() => {
    if (!planMissionFocus || !selectedPlanNodeDraft) {
      return (
        <div
          style={graphDrawerSectionStyle({
            padding: '16px',
            borderStyle: 'dashed',
            color: GRAPH_THEME.drawer.inputMuted,
          })}
        >
          Select a plan node to edit details.
        </div>
      );
    }
    const focusId = planMissionFocus.nodeId;
    const setField = (
      field: keyof PlanMissionNodeData,
      value: PlanMissionNodeData[keyof PlanMissionNodeData],
    ) => {
      updatePlanNodeDraft(focusId, {
        [field]: value,
      } as Partial<PlanMissionNodeData>);
    };
    return (
      <div style={{ display: 'grid', gap: 10 }}>
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
            Plan Node
          </div>
          <input
            value={selectedPlanNodeDraft.label || ''}
            onChange={(event) => setField('label', event.target.value)}
            style={graphDrawerInputStyle()}
          />
          <textarea
            value={selectedPlanNodeDraft.description || ''}
            onChange={(event) => setField('description', event.target.value)}
            rows={4}
            style={{
              ...graphDrawerInputStyle({
                marginTop: 8,
                resize: 'vertical',
                fontFamily: 'inherit',
                fontSize: 12,
              }),
            }}
          />
        </div>
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
            Runtime Fields
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <select
              value={selectedPlanNodeDraft.status || 'seeded'}
              onChange={(event) =>
                setField(
                  'status',
                  event.target.value as PlanMissionNodeData['status'],
                )
              }
              style={graphDrawerInputStyle()}
            >
              {[
                'seeded',
                'ready',
                'running',
                'blocked',
                'awaiting_review',
                'complete',
                'error',
              ].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <input
              placeholder="Assigned agent id"
              value={selectedPlanNodeDraft.assignedAgentId || ''}
              onChange={(event) =>
                setField('assignedAgentId', event.target.value)
              }
              style={graphDrawerInputStyle()}
            />
            <textarea
              placeholder="Starter prompt"
              value={selectedPlanNodeDraft.starterPrompt || ''}
              onChange={(event) =>
                setField('starterPrompt', event.target.value)
              }
              rows={5}
              style={{
                ...graphDrawerInputStyle({
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  fontSize: 12,
                }),
              }}
            />
          </div>
          <div
            className="text-[11px]"
            style={{ marginTop: 10, color: GRAPH_THEME.drawer.inputMuted }}
          >
            Keys: {safeText(selectedPlanNodeDraft.updateKey)} /{' '}
            {safeText(selectedPlanNodeDraft.outputKey)}
          </div>
        </div>
      </div>
    );
  }, [planMissionFocus, selectedPlanNodeDraft, updatePlanNodeDraft]);

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

    // Editor content based on node selection
    const renderEditorContent = () => {
      if (selectedCard && selectedCardConfig) {
        if (
          tab === 'Prompt' ||
          tab === 'Knowledge' ||
          tab === 'Tools' ||
          tab === 'Runtime'
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
                  memoryGraphData={selectedCardMemoryGraph}
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
                  onClick={handleSaveDeck}
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
                  {deckSaveBusy ? 'Saving...' : 'Save Deck'}
                </button>
                <button
                  onClick={handleRunDeck}
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

    // Left rail plus is the only add mechanism - no right panel add UI
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

  // chat state
  const [messages, setMessages] = useState<
    { role: 'assistant' | 'user'; text: string }[]
  >(() => loadProjectState(activeProject).messages);

  // plan
  const [planSource, setPlanSource] = useState<unknown>(
    () => loadProjectState(activeProject).plan,
  );
  const [plan, setPlan] = useState<PlanItem[]>(
    () => loadProjectState(activeProject).plan,
  );
  const [stateLoaded, setStateLoaded] = useState(false);

  const [energyInputs, setEnergyInputs] = useState<EnergySurfaceParameters>(
    () => ({ ...ENERGY_DEFAULT_PARAMETERS }),
  );
  const [selectedWorkspaceObjectId, setSelectedWorkspaceObjectId] =
    useState<EnergyObjectId>('energy:facade');
  const [latestWorkspaceActionSummary, setLatestWorkspaceActionSummary] =
    useState<string | null>(null);
  const energyWorkspaceObjects = useMemo(
    () => buildEnergyWorkspaceObjects(energyInputs),
    [energyInputs],
  );
  const applyWorkspaceAction = useCallback(
    (actionCall: WorkspaceActionCall): WorkspaceActionResult => {
      const action = ENERGY_WORKSPACE_ACTIONS.find(
        (entry) => entry.id === actionCall.actionId,
      );
      if (!action) {
        return {
          ok: false,
          actionId: actionCall.actionId,
          targetObjectId: actionCall.targetObjectId,
          summary: `Unknown workspace action: ${safeText(actionCall.actionId)}`,
          error: 'unknown_action',
        };
      }

      if (!isEnergyObjectId(actionCall.targetObjectId)) {
        return {
          ok: false,
          actionId: action.id,
          targetObjectId: actionCall.targetObjectId,
          summary: `Unknown workspace object: ${safeText(actionCall.targetObjectId)}`,
          error: 'unknown_target_object',
        };
      }

      const targetObject = energyWorkspaceObjects.find(
        (entry) => entry.id === actionCall.targetObjectId,
      );
      const targetLabel = targetObject?.label || actionCall.targetObjectId;
      let summary = '';

      if (action.id === 'select_object') {
        setSelectedWorkspaceObjectId(actionCall.targetObjectId);
        summary = `Selected ${targetLabel}.`;
      } else if (action.id === 'reset_energy_surface') {
        setEnergyInputs({ ...ENERGY_DEFAULT_PARAMETERS });
        setSelectedWorkspaceObjectId('energy:facade');
        summary = 'Reset the Energy surface to default parameters.';
      } else if (action.id === 'update_object_parameter') {
        const parameter = safeText(actionCall.parameters?.parameter);
        const value = Number(actionCall.parameters?.value);
        if (!isEnergyParameterKey(parameter)) {
          return {
            ok: false,
            actionId: action.id,
            targetObjectId: actionCall.targetObjectId,
            summary: `Unknown Energy parameter: ${parameter || 'empty'}`,
            error: 'unknown_parameter',
          };
        }
        if (!ENERGY_OBJECT_PARAMETERS[actionCall.targetObjectId].includes(parameter)) {
          return {
            ok: false,
            actionId: action.id,
            targetObjectId: actionCall.targetObjectId,
            summary: `${targetLabel} does not expose ${formatEnergyParameterLabel(parameter)}.`,
            error: 'parameter_not_allowed_for_object',
          };
        }
        if (!Number.isFinite(value)) {
          return {
            ok: false,
            actionId: action.id,
            targetObjectId: actionCall.targetObjectId,
            summary: `Invalid value for ${formatEnergyParameterLabel(parameter)}.`,
            error: 'invalid_parameter_value',
          };
        }
        setEnergyInputs((current) => ({
          ...current,
          [parameter]: value,
        }));
        setSelectedWorkspaceObjectId(actionCall.targetObjectId);
        summary = `Updated ${targetLabel} ${formatEnergyParameterLabel(parameter)} to ${value}.`;
      }

      const planEventSummary = `[workspace_action] ${summary}`;
      setLatestWorkspaceActionSummary(planEventSummary);
      return {
        ok: true,
        actionId: action.id,
        targetObjectId: actionCall.targetObjectId,
        summary,
        planEventSummary,
      };
    },
    [energyWorkspaceObjects],
  );

  useEffect(() => {
    (window as any).__LIQUIDAITY_APPLY_WORKSPACE_ACTION__ =
      applyWorkspaceAction;
    return () => {
      delete (window as any).__LIQUIDAITY_APPLY_WORKSPACE_ACTION__;
    };
  }, [applyWorkspaceAction]);

  // links
  const [links, setLinks] = useState<LinkRef[]>(
    () => loadProjectState(activeProject).links,
  );
  const assistAnchorSurface = useMemo(
    () =>
      normalizeAnchorSurface(planSource, { messages, planItems: plan, links }),
    [planSource, messages, plan, links],
  );
  const structuredAssistPlan = useMemo(
    () =>
      buildStructuredAssistPlanSurface(planSource, {
        planItems: plan,
        anchorSurface: assistAnchorSurface,
      }),
    [planSource, plan, assistAnchorSurface],
  );
  useEffect(() => {
    setPlanMissionFocus(null);
    setPlanNodeDrafts({});
  }, [activeProject]);
  // knowledge graph
  const [cypher, setCypher] = useState('');
  const [graphResult, setGraphResult] = useState<any[]>([]);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [knowledgeGraphStatus, setKnowledgeGraphStatus] =
    useState<string>('Idle');
  const [graphResetToken, setGraphResetToken] = useState(0);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);
  const [graphTypeFilter] = useState<string>('all');
  const [graphRecencyFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [graphMinConfidence] = useState<number>(0);
  const [, setSelectedEdgeEvidence] =
    useState<KnowledgeGraphRelationship | null>(null);
  const clearKnowledgeWorkspaceSelection = useCallback(() => {
    setSelectedKnowledgeEntityId(null);
    setSelectedKnowledgeRelationshipId(null);
    setSelectedEdgeEvidence(null);
  }, []);
  const [knowGraphData, setKnowGraphData] = useState<{
    nodes: any[];
    relationships: any[];
  }>({
    nodes: [],
    relationships: [],
  });
  const graphResultRef = useRef<any[]>([]);
  const [, setLastIngestTrace] = useState<any>(null);
  const scopeKey = activeProject || '';
  const graphCacheScope = `${scopeKey}:${graphTypeFilter}:${graphRecencyFilter}:${graphMinConfidence}`;
  const graphCacheKey = `${KG_CACHE_PREFIX}:${graphCacheScope}`;

  const resetKnowledgePanelState = useCallback(() => {
    kgLoadAbortRef.current?.abort();
    kgLoadAbortRef.current = null;
    kgLoadProjectRef.current = '';
    kgExpandAbortRef.current?.abort();
    kgExpandAbortRef.current = null;
    kgExpandProjectRef.current = '';
    graphHydrateKeyRef.current = '';
    kgAutoLoadKeyRef.current = '';
    setCypher('');
    setGraphResult([]);
    setKnowGraphData({ nodes: [], relationships: [] });
    setGraphError(null);
    setGraphLoading(false);
    setKnowledgeGraphStatus('Idle');
    setExpandingNodeId(null);
    setGraphResetToken((v) => v + 1);
    clearKnowledgeWorkspaceSelection();
  }, [clearKnowledgeWorkspaceSelection]);

  useEffect(() => {
    resetKnowledgePanelState();
  }, [activeProject, resetKnowledgePanelState]);

  useEffect(() => {
    graphResultRef.current = graphResult;
  }, [graphResult]);

  useEffect(() => {
    if (healthCheckScheduledRef.current) return;
    healthCheckScheduledRef.current = true;
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const endpoint = '/api/health';
    const requestType = 'health-check';
    const runCheck = async () => {
      const requestSeq = nextRequestSequence(requestType);
      try {
        const payload = await guardedRequest({
          key: endpoint,
          method: 'GET',
          ttlMs: 20_000,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, {
              credentials: 'include',
              signal,
            });
            const { data, text } = await readJsonAndText(res);
            return { res, data, text };
          },
        });
        if (cancelled || !isLatestRequestSequence(requestType, requestSeq))
          return;
        if (!payload.res.ok) {
          throw new Error(
            formatRequestErrorLine(
              endpoint,
              payload.res.status,
              (payload.data && safeText(payload.data)) || payload.text,
            ),
          );
        }
        setGraphError((prev) =>
          prev && prev.includes(endpoint) ? null : prev,
        );
      } catch (err: any) {
        if (
          cancelled ||
          isAbortLikeError(err) ||
          !isLatestRequestSequence(requestType, requestSeq)
        )
          return;
        setGraphError(
          formatRequestErrorLine(
            endpoint,
            0,
            err?.message || 'Failed to fetch',
          ),
        );
      }
    };
    const schedule = () => {
      const maybeWindow = window as Window & {
        requestIdleCallback?: (
          cb: () => void,
          options?: { timeout: number },
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (typeof maybeWindow.requestIdleCallback === 'function') {
        idleId = maybeWindow.requestIdleCallback(
          () => {
            void runCheck();
          },
          { timeout: 1500 },
        );
        return;
      }
      timeoutId = window.setTimeout(() => {
        void runCheck();
      }, 0);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      const maybeWindow = window as Window & {
        cancelIdleCallback?: (id: number) => void;
      };
      if (
        idleId != null &&
        typeof maybeWindow.cancelIdleCallback === 'function'
      ) {
        maybeWindow.cancelIdleCallback(idleId);
      }
    };
  }, []);

  const runGraphQuery = useCallback(
    async (
      query?: string,
      opts?: {
        merge?: boolean;
        queryParams?: Record<string, unknown>;
        signal?: AbortSignal;
        requestType?: string;
        requestSeq?: number;
        manageLoading?: boolean;
      },
    ): Promise<boolean> => {
      const projectId = activeProject;
      const q = (query ?? cypher).trim();
      const requestType = opts?.requestType || 'kg-query';
      const requestSeq = opts?.requestSeq ?? nextRequestSequence(requestType);
      if (!projectId) return false;
      if (!q) {
        setGraphError('Enter a Cypher query first.');
        return false;
      }
      if (isLatestRequestSequence(requestType, requestSeq)) {
        setGraphError(null);
        if (opts?.manageLoading !== false) setGraphLoading(true);
      }
      try {
        const endpoint = `/api/v2/projects/${projectId}/kg/query`;
        const requestParams = { projectId, ...(opts?.queryParams || {}) };
        const requestBody = JSON.stringify({
          cypher: q,
          params: requestParams,
        });
        const payload = await guardedRequest({
          key: `kg:post:${projectId}:${q}:${JSON.stringify(requestParams)}`,
          method: 'POST',
          signal: opts?.signal,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: requestBody,
              signal,
            });
            const { data, text } = await readJsonAndText(res);
            return { res, data, text, endpoint };
          },
        });
        if (!payload.res.ok || !payload.data?.ok) {
          const msg = formatRequestErrorLine(
            payload.endpoint,
            payload.res.status,
            (payload.data &&
              safeText(payload.data?.error || payload.data?.message)) ||
              payload.text,
          );
          throw new Error(msg);
        }
        if (activeProjectLatestRef.current !== projectId) return false;
        if (!isLatestRequestSequence(requestType, requestSeq)) return false;
        const rows = Array.isArray(payload.data.rows) ? payload.data.rows : [];
        const normalizedRows =
          rows.length > 0 ? rows : buildThinkRowsFromMergedGraphPayload(payload.data);
        if (opts?.merge) {
          setGraphResult((prev) => {
            const seen = new Set(
              prev.map((row: any) =>
                typeof row === 'string' ? row : JSON.stringify(row),
              ),
            );
            const merged = [...prev];
            normalizedRows.forEach((row: any) => {
              const key = typeof row === 'string' ? row : JSON.stringify(row);
              if (!seen.has(key)) {
                seen.add(key);
                merged.push(row);
              }
            });
            return merged;
          });
        } else {
          setGraphResult(normalizedRows);
        }
        return true;
      } catch (err: any) {
        if (isAbortLikeError(err)) return false;
        if (activeProjectLatestRef.current !== projectId) return false;
        if (!isLatestRequestSequence(requestType, requestSeq)) return false;
        setGraphError(err?.message || 'Graph error');
        return false;
      } finally {
        if (
          opts?.manageLoading !== false &&
          activeProjectLatestRef.current === projectId &&
          isLatestRequestSequence(requestType, requestSeq)
        ) {
          setGraphLoading(false);
        }
      }
    },
    [activeProject, cypher],
  );

  const buildRecencySinceTs = useCallback((): string | null => {
    if (graphRecencyFilter === 'all') return null;
    const now = Date.now();
    const deltaMs =
      graphRecencyFilter === '24h'
        ? 24 * 60 * 60 * 1000
        : graphRecencyFilter === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
    return new Date(now - deltaMs).toISOString();
  }, [graphRecencyFilter]);

  const runGraphPresetQuery = useCallback(
    async (
      preset: 'SEED' | 'EXPAND',
      opts?: {
        merge?: boolean;
        nodeId?: string;
        limit?: number;
        bypassCache?: boolean;
        signal?: AbortSignal;
        requestType?: string;
        requestSeq?: number;
        allowPostFallback?: boolean;
      },
    ): Promise<boolean> => {
      const projectId = activeProject;
      if (!projectId) return false;
      const requestType = opts?.requestType || 'kg-query';
      const requestSeq = opts?.requestSeq ?? nextRequestSequence(requestType);

      const limit = opts?.limit ?? (preset === 'SEED' ? 220 : 120);
      const sinceTs = buildRecencySinceTs();
      const queryParams: Record<string, unknown> = {
        projectId,
        limit,
        typeFilter: graphTypeFilter !== 'all' ? graphTypeFilter : null,
        sinceTs,
        minConfidence: graphMinConfidence > 0 ? graphMinConfidence : null,
      };
      if (preset === 'EXPAND') {
        queryParams.nodeId = opts?.nodeId ?? null;
      }

      const search = new URLSearchParams();
      search.set('query', preset);
      search.set('limit', String(limit));

      if (preset === 'EXPAND' && opts?.nodeId) {
        search.set('nodeId', opts.nodeId);
      }
      if (graphTypeFilter !== 'all') {
        search.set('type', graphTypeFilter);
      }
      if (sinceTs) {
        search.set('sinceTs', sinceTs);
      }
      if (graphMinConfidence > 0) {
        search.set('minConfidence', String(graphMinConfidence));
      }

      if (isLatestRequestSequence(requestType, requestSeq)) {
        setGraphError(null);
        setGraphLoading(true);
      }
      try {
        const endpoint = `/api/v2/projects/${projectId}/kg/query?${search.toString()}`;
        const payload = await guardedRequest({
          key: `kg:get:${endpoint}`,
          method: 'GET',
          ttlMs: preset === 'SEED' ? KG_CACHE_TTL_MS : 12_000,
          bypassCache: opts?.bypassCache,
          signal: opts?.signal,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, {
              method: 'GET',
              signal,
            });
            const { data, text } = await readJsonAndText(res);
            return { res, data, text, endpoint };
          },
        });
        if (!payload.res.ok || !payload.data?.ok) {
          const msg = formatRequestErrorLine(
            payload.endpoint,
            payload.res.status,
            (payload.data &&
              safeText(payload.data?.error || payload.data?.message)) ||
              payload.text,
          );
          throw new Error(msg);
        }
        if (activeProjectLatestRef.current !== projectId) return false;
        if (!isLatestRequestSequence(requestType, requestSeq)) return false;
        if (typeof payload.data?.cypher === 'string') {
          setCypher(payload.data.cypher);
        }

        const rows = Array.isArray(payload.data.rows) ? payload.data.rows : [];
        const normalizedRows =
          rows.length > 0 ? rows : buildThinkRowsFromMergedGraphPayload(payload.data);
        if (opts?.merge) {
          setGraphResult((prev) => {
            const seen = new Set(
              prev.map((row: any) =>
                typeof row === 'string' ? row : JSON.stringify(row),
              ),
            );
            const merged = [...prev];
            normalizedRows.forEach((row: any) => {
              const key = typeof row === 'string' ? row : JSON.stringify(row);
              if (!seen.has(key)) {
                seen.add(key);
                merged.push(row);
              }
            });
            return merged;
          });
        } else {
          setGraphResult(normalizedRows);
        }
        return true;
      } catch (err: any) {
        const msg = String(err?.message || 'Graph query failed');
        const allowPostFallback = opts?.allowPostFallback !== false;
        if (
          allowPostFallback &&
          (msg.includes('| 404 |') ||
            msg.includes('| 405 |') ||
            msg.includes('HTTP 404') ||
            msg.includes('HTTP 405'))
        ) {
          const fallbackCypher =
            preset === 'SEED' ? KG_SEED_QUERY : KG_EXPAND_QUERY;
          return runGraphQuery(fallbackCypher, {
            merge: opts?.merge,
            queryParams,
            signal: opts?.signal,
            requestType,
            requestSeq,
            manageLoading: false,
          });
        }
        if (isAbortLikeError(err)) return false;
        if (activeProjectLatestRef.current !== projectId) return false;
        if (!isLatestRequestSequence(requestType, requestSeq)) return false;
        setGraphError(msg);
        return false;
      } finally {
        if (
          activeProjectLatestRef.current === projectId &&
          isLatestRequestSequence(requestType, requestSeq)
        ) {
          setGraphLoading(false);
        }
      }
    },
    [
      activeProject,
      graphTypeFilter,
      graphMinConfidence,
      buildRecencySinceTs,
      runGraphQuery,
    ],
  );

  const loadKnowGraphData = useCallback(
    async (opts?: {
      signal?: AbortSignal;
      requestType?: string;
      requestSeq?: number;
      bypassCache?: boolean;
    }): Promise<boolean> => {
      const projectId = activeProject;
      if (!projectId) {
        setKnowGraphData({ nodes: [], relationships: [] });
        return false;
      }
      const requestType = opts?.requestType || 'knowgraph-data';
      const requestSeq = opts?.requestSeq ?? nextRequestSequence(requestType);

      try {
        const endpoint = `/api/knowgraph/graph?projectId=${encodeURIComponent(projectId)}`;
        const payload = await guardedRequest({
          key: `knowgraph:data:${projectId}`,
          method: 'GET',
          ttlMs: KG_CACHE_TTL_MS,
          bypassCache: opts?.bypassCache,
          signal: opts?.signal,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, {
              credentials: 'include',
              signal,
            });
            const { data, text } = await readJsonAndText(res);
            return { res, data, text, endpoint };
          },
        });
        if (!payload.res.ok) {
          throw new Error(
            formatRequestErrorLine(
              payload.endpoint,
              payload.res.status,
              (payload.data &&
                safeText(
                  payload.data?.error?.message || payload.data?.error,
                )) ||
                payload.text,
            ),
          );
        }
        if (activeProjectLatestRef.current !== projectId) return false;
        if (!isLatestRequestSequence(requestType, requestSeq)) return false;
        const rawNodes = Array.isArray(payload.data?.nodes)
          ? payload.data.nodes
          : [];
        const rawRels = Array.isArray(payload.data?.relationships)
          ? payload.data.relationships
          : [];
        setKnowGraphData({ nodes: rawNodes, relationships: rawRels });
        setGraphError((prev) =>
          prev && prev.includes('/api/knowgraph/graph') ? null : prev,
        );
        return true;
      } catch (err: any) {
        if (isAbortLikeError(err)) return false;
        if (activeProjectLatestRef.current !== projectId) return false;
        if (!isLatestRequestSequence(requestType, requestSeq)) return false;
        console.warn('[KnowGraph] graph fetch failed:', err?.message || err);
        setKnowGraphData({ nodes: [], relationships: [] });
        setGraphError(err?.message || 'KnowGraph graph fetch failed');
        return false;
      }
    },
    [activeProject],
  );

  const loadKnowGraphHealth = useCallback(
    async (opts?: {
      signal?: AbortSignal;
      requestType?: string;
      requestSeq?: number;
    }): Promise<boolean> => {
      const endpoint = '/api/knowgraph/health';
      const requestType = opts?.requestType || 'knowgraph-health';
      const requestSeq = opts?.requestSeq ?? nextRequestSequence(requestType);
      try {
        const payload = await guardedRequest({
          key: endpoint,
          method: 'GET',
          ttlMs: 20_000,
          signal: opts?.signal,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, {
              credentials: 'include',
              signal,
            });
            const { data, text } = await readJsonAndText(res);
            return { res, data, text, endpoint };
          },
        });
        if (!payload.res.ok) {
          throw new Error(
            formatRequestErrorLine(
              payload.endpoint,
              payload.res.status,
              (payload.data &&
                safeText(
                  payload.data?.error?.message || payload.data?.error,
                )) ||
                payload.text,
            ),
          );
        }
        if (!isLatestRequestSequence(requestType, requestSeq)) return false;
        setGraphError((prev) =>
          prev && prev.includes(endpoint) ? null : prev,
        );
        return true;
      } catch (err: any) {
        if (isAbortLikeError(err)) return false;
        if (!isLatestRequestSequence(requestType, requestSeq)) return false;
        setGraphError(err?.message || `${endpoint} | 0 | request failed`);
        return false;
      }
    },
    [],
  );

  const expandKnowGraphFromEntity = useCallback(
    async (entity: KnowledgeGraphNode) => {
      const projectId = activeProject;
      if (!projectId) return;
      const requestType = 'kg-expand';
      const requestSeq = nextRequestSequence(requestType);
      const rawId = String(entity.rawId || entity.id || '').trim();
      if (!rawId) return;

      const endpoint = `/api/knowgraph/expand?projectId=${encodeURIComponent(projectId)}&nodeId=${encodeURIComponent(rawId)}&depth=1&limit=50`;
      kgExpandAbortRef.current?.abort();
      const controller = new AbortController();
      kgExpandAbortRef.current = controller;
      kgExpandProjectRef.current = projectId;
      setExpandingNodeId(entity.label || entity.id);
      try {
        const payload = await guardedRequest({
          key: `knowgraph:expand:${projectId}:${rawId}`,
          method: 'GET',
          ttlMs: 12_000,
          signal: controller.signal,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, {
              credentials: 'include',
              signal,
            });
            const { data, text } = await readJsonAndText(res);
            return { res, data, text, endpoint };
          },
        });
        if (!payload.res.ok) {
          throw new Error(
            formatRequestErrorLine(
              payload.endpoint,
              payload.res.status,
              (payload.data &&
                safeText(
                  payload.data?.error?.message || payload.data?.error,
                )) ||
                payload.text,
            ),
          );
        }
        if (
          !isLatestRequestSequence(requestType, requestSeq) ||
          controller.signal.aborted ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }

        const nextNodes = Array.isArray(payload.data?.nodes)
          ? payload.data.nodes
          : [];
        const nextRelationships = Array.isArray(payload.data?.relationships)
          ? payload.data.relationships
          : [];
        const currentNodeIds = new Set(
          (Array.isArray(knowGraphData.nodes) ? knowGraphData.nodes : [])
            .map((entry: any) => String(entry?.id ?? '').trim())
            .filter(Boolean),
        );
        const currentRelationshipIds = new Set(
          (Array.isArray(knowGraphData.relationships)
            ? knowGraphData.relationships
            : []
          )
            .map((entry: any) => String(entry?.id ?? '').trim())
            .filter(Boolean),
        );
        const addedNodeCount = nextNodes.reduce((count: number, entry: any) => {
          const id = String(entry?.id ?? '').trim();
          return id && !currentNodeIds.has(id) ? count + 1 : count;
        }, 0);
        const addedRelationshipCount = nextRelationships.reduce(
          (count: number, entry: any) => {
            const id = String(entry?.id ?? '').trim();
            return id && !currentRelationshipIds.has(id) ? count + 1 : count;
          },
          0,
        );
        setKnowGraphData((prev) => {
          const nodeMap = new Map<string, any>();
          const relationshipMap = new Map<string, any>();
          [
            ...(Array.isArray(prev.nodes) ? prev.nodes : []),
            ...nextNodes,
          ].forEach((n: any) => {
            const id = String(n?.id ?? '').trim();
            if (id && !nodeMap.has(id)) nodeMap.set(id, n);
          });
          [
            ...(Array.isArray(prev.relationships) ? prev.relationships : []),
            ...nextRelationships,
          ].forEach((r: any) => {
            const id = String(r?.id ?? '').trim();
            if (id && !relationshipMap.has(id)) relationshipMap.set(id, r);
          });
          return {
            nodes: Array.from(nodeMap.values()),
            relationships: Array.from(relationshipMap.values()),
          };
        });
        if (addedNodeCount === 0 && addedRelationshipCount === 0) {
          setKnowledgeGraphStatus(
            `No additional graph neighbors found for "${safeText(entity.label || entity.id)}".`,
          );
        } else {
          setKnowledgeGraphStatus(
            `Expanded "${safeText(entity.label || entity.id)}": +${addedNodeCount} node${
              addedNodeCount === 1 ? '' : 's'
            }, +${addedRelationshipCount} edge${addedRelationshipCount === 1 ? '' : 's'}.`,
          );
        }
        setGraphError((prev) =>
          prev && prev.includes('/api/knowgraph/expand') ? null : prev,
        );
      } catch (err: any) {
        if (
          isAbortLikeError(err) ||
          !isLatestRequestSequence(requestType, requestSeq) ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }
        setGraphError(err?.message || 'KnowGraph expand failed');
      } finally {
        if (
          activeProjectLatestRef.current === projectId &&
          isLatestRequestSequence(requestType, requestSeq)
        ) {
          setExpandingNodeId(null);
        }
        if (kgExpandAbortRef.current === controller) {
          kgExpandAbortRef.current = null;
        }
        if (kgExpandProjectRef.current === projectId) {
          kgExpandProjectRef.current = '';
        }
      }
    },
    [activeProject, knowGraphData.nodes, knowGraphData.relationships],
  );

  useEffect(() => {
    return () => {
      deckSaveAbortRef.current?.abort();
      deckExecutionAbortRef.current?.abort();
      kgLoadAbortRef.current?.abort();
      kgExpandAbortRef.current?.abort();
      dashboardPollAbortRef.current?.abort();
      if (dashboardPollTimerRef.current != null) {
        window.clearTimeout(dashboardPollTimerRef.current);
        dashboardPollTimerRef.current = null;
      }
    };
  }, []);

  const loadProjectSubgraph = useCallback(
    (opts?: { force?: boolean }) => {
      const projectId = activeProject;
      if (!projectId) {
        resetKnowledgePanelState();
        return;
      }
      const cacheKey = graphCacheKey;
      const requestType = 'kg-subgraph-load';
      const requestSeq = nextRequestSequence(requestType);
      setKnowledgeGraphStatus('Refreshing knowledge graph...');
      setGraphResetToken((v) => v + 1);
      clearKnowledgeWorkspaceSelection();
      const cached = readCachedGraphPayload(cacheKey);
      if (cached) {
        // Show cached graph immediately while refresh decision is made.
        setCypher(cached.cypher || '');
        setGraphResult(
          Array.isArray(cached.graphResult) ? cached.graphResult : [],
        );
        setKnowGraphData({
          nodes: Array.isArray(cached.knowGraphData?.nodes)
            ? cached.knowGraphData.nodes
            : [],
          relationships: Array.isArray(cached.knowGraphData?.relationships)
            ? cached.knowGraphData.relationships
            : [],
        });
        graphHydrateKeyRef.current = cacheKey;
      }
      const shouldRefresh =
        opts?.force || !isCachedGraphFresh(cached, KG_CACHE_TTL_MS);
      if (!shouldRefresh) {
        setGraphLoading(false);
        setGraphError(null);
        setKnowledgeGraphStatus('Using cached knowledge graph.');
        return;
      }
      kgLoadAbortRef.current?.abort();
      const controller = new AbortController();
      const graphRefreshStartedAt = Date.now();
      kgLoadAbortRef.current = controller;
      kgLoadProjectRef.current = projectId;
      setGraphError(null);
      void (async () => {
        const knowHealthOk = await loadKnowGraphHealth({
          signal: controller.signal,
          requestType,
          requestSeq,
        });
        await runGraphPresetQuery('SEED', {
          limit: 220,
          bypassCache: opts?.force,
          signal: controller.signal,
          requestType,
          requestSeq,
          allowPostFallback: false,
        });
        if (
          controller.signal.aborted ||
          !isLatestRequestSequence(requestType, requestSeq) ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }
        if (!knowHealthOk) {
          setKnowGraphData({ nodes: [], relationships: [] });
          setKnowledgeGraphStatus('KnowGraph health check failed.');
          return;
        }
        const loaded = await loadKnowGraphData({
          bypassCache: opts?.force,
          signal: controller.signal,
          requestType,
          requestSeq,
        });
        if (
          !controller.signal.aborted &&
          isLatestRequestSequence(requestType, requestSeq) &&
          activeProjectLatestRef.current === projectId
        ) {
          setKnowledgeGraphStatus(
            loaded
              ? 'Knowledge graph refresh succeeded.'
              : 'Knowledge graph refresh failed.',
          );
        }
      })().finally(() => {
        if (
          !controller.signal.aborted &&
          isLatestRequestSequence(requestType, requestSeq) &&
          activeProjectLatestRef.current === projectId
        ) {
          const completedAt = Date.now();
          emitWorkspaceTestingEvent({
            event: 'graph_refresh_completed',
            durationMs: Math.max(0, completedAt - graphRefreshStartedAt),
            metadata: {
              graphType: 'knowledge',
              source: opts?.force ? 'forced_refresh' : 'refresh',
            },
          });
          recordPostResponseRefreshIfPending('knowledge_graph', completedAt);
        }
        if (kgLoadAbortRef.current === controller) {
          kgLoadAbortRef.current = null;
        }
        if (kgLoadProjectRef.current === projectId) {
          kgLoadProjectRef.current = '';
        }
      });
    },
    [
      activeProject,
      clearKnowledgeWorkspaceSelection,
      emitWorkspaceTestingEvent,
      graphCacheKey,
      loadKnowGraphData,
      loadKnowGraphHealth,
      recordPostResponseRefreshIfPending,
      resetKnowledgePanelState,
      runGraphPresetQuery,
    ],
  );

  useEffect(() => {
    if (!activeProject) {
      graphHydrateKeyRef.current = '';
      return;
    }
    if (graphHydrateKeyRef.current === graphCacheKey) return;
    const cached = readCachedGraphPayload(graphCacheKey);
    if (!cached) return;
    setCypher(cached.cypher || '');
    setGraphResult(Array.isArray(cached.graphResult) ? cached.graphResult : []);
    setKnowGraphData({
      nodes: Array.isArray(cached.knowGraphData?.nodes)
        ? cached.knowGraphData.nodes
        : [],
      relationships: Array.isArray(cached.knowGraphData?.relationships)
        ? cached.knowGraphData.relationships
        : [],
    });
    graphHydrateKeyRef.current = graphCacheKey;
  }, [activeProject, graphCacheKey]);

  useEffect(() => {
    if (!activeProject) return;
    const hasGraphData =
      graphResult.length > 0 ||
      knowGraphData.nodes.length > 0 ||
      knowGraphData.relationships.length > 0;
    if (!hasGraphData) return;
    writeCachedGraphPayload(graphCacheKey, {
      updatedAt: Date.now(),
      cypher,
      graphResult,
      knowGraphData,
    });
  }, [activeProject, graphCacheKey, cypher, graphResult, knowGraphData]);

  const loadGraphData = useCallback(() => {
    if (!activeProject) return;
    loadProjectSubgraph({ force: true });
  }, [activeProject, loadProjectSubgraph]);

  const expandGraphFromNode = useCallback(
    async (nodeId: string) => {
      const projectId = activeProject;
      const trimmed = String(nodeId || '').trim();
      if (!trimmed || !projectId) return;
      const requestType = 'kg-expand';
      const requestSeq = nextRequestSequence(requestType);
      const beforeCount = graphResultRef.current.length;
      kgExpandAbortRef.current?.abort();
      const controller = new AbortController();
      kgExpandAbortRef.current = controller;
      kgExpandProjectRef.current = projectId;
      setExpandingNodeId(trimmed);
      try {
        await runGraphPresetQuery('EXPAND', {
          merge: true,
          nodeId: trimmed,
          limit: 120,
          signal: controller.signal,
          requestType,
          requestSeq,
        });
        const afterCount = graphResultRef.current.length;
        const delta = Math.max(0, afterCount - beforeCount);
        setKnowledgeGraphStatus(
          delta === 0
            ? `No additional graph neighbors found for "${safeText(trimmed)}".`
            : `Expanded "${safeText(trimmed)}": +${delta} graph row${delta === 1 ? '' : 's'}.`,
        );
      } finally {
        if (
          activeProjectLatestRef.current === projectId &&
          isLatestRequestSequence(requestType, requestSeq)
        ) {
          setExpandingNodeId(null);
        }
        if (kgExpandAbortRef.current === controller) {
          kgExpandAbortRef.current = null;
        }
        if (kgExpandProjectRef.current === projectId) {
          kgExpandProjectRef.current = '';
        }
      }
    },
    [activeProject, runGraphPresetQuery],
  );

  // Auto-load project subgraph when Knowledge tab opens or project changes
  useEffect(() => {
    const isKnowledgeSurfaceOpen =
      workspaceView === 'knowledge' || workspaceView === 'codegraph';
    if (!isKnowledgeSurfaceOpen || !activeProject) {
      kgAutoLoadKeyRef.current = '';
      return;
    }
    const autoLoadKey = graphCacheScope;
    if (kgAutoLoadKeyRef.current === autoLoadKey) return; // StrictMode/effect-cascade guard.
    kgAutoLoadKeyRef.current = autoLoadKey;
    loadProjectSubgraph();
  }, [activeProject, graphCacheScope, loadProjectSubgraph, workspaceView]);

  useEffect(() => {
    const refresh = () => {
      loadGraphData();
    };
    window.addEventListener('knowledge:refresh', refresh);
    return () => window.removeEventListener('knowledge:refresh', refresh);
  }, [loadGraphData]);

  useEffect(() => {
    clearKnowledgeWorkspaceSelection();
  }, [activeProject, clearKnowledgeWorkspaceSelection, tab]);

  useEffect(() => {
    if (
      kgLoadAbortRef.current &&
      kgLoadProjectRef.current &&
      kgLoadProjectRef.current !== activeProject
    ) {
      kgLoadAbortRef.current.abort();
    }
    if (
      kgExpandAbortRef.current &&
      kgExpandProjectRef.current &&
      kgExpandProjectRef.current !== activeProject
    ) {
      kgExpandAbortRef.current.abort();
    }
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
        const endpoint = `${V2_PROJECTS_API}/${projectId}/kg/last-trace`;
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
        if (payload.data?.ok && payload.data.trace) {
          setLastIngestTrace(payload.data.trace);
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
    if (!canvasProjectId) return;
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
        responseMode: 'deck_runtime',
        turnId,
        workspaceView: activeDeckWorkspaceContext.workspaceView,
        objectEditorOpen: activeDeckWorkspaceContext.objectEditor.open,
        objectEditorCardId:
          activeDeckWorkspaceContext.objectEditor.selectedCardId,
        objectEditorTab: activeDeckWorkspaceContext.objectEditor.activeTab,
      },
    });

    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    const activationProposal = detectActivationProposal(trimmed);
    if (activationProposal) {
      setPendingActivationProposal(activationProposal);
    }
    setSending(true);
    setDeckRunBusy(true);
    setLatestCardRun(null);
    setLatestDeckRun(null);
    setLiveDeckEvents([]);
    setDeckStatusMessage('Running deck from chat...');
    const requestProjectId = canvasProjectId;
    deckExecutionAbortRef.current?.abort();
    const controller = new AbortController();
    deckExecutionAbortRef.current = controller;

    void (async () => {
      try {
        const endpoint = `${V3_PROJECTS_API}/${requestProjectId}/decks/run`;
        const data = await streamDeckRunRequest({
          endpoint,
          body: {
            deckId: BUILDER_DECK_ID,
            document: {
              ...deck,
              id: BUILDER_DECK_ID,
            },
            templates: INITIAL_AGENT_TEMPLATES,
            input: trimmed,
            workspaceContext: activeDeckWorkspaceContext,
            workspaceObjectContext: activeWorkspaceObjectContext,
          },
          signal: controller.signal,
          onEvent: (event) => {
            if (
              controller.signal.aborted ||
              activeProjectLatestRef.current !== requestProjectId
            )
              return;
            setLiveDeckEvents((current) => [...current, event]);
            const contract = extractCodeGraphViewContractFromEvent(
              event,
              requestProjectId,
            );
            if (contract) {
              applyCodeGraphViewContract(contract);
            }
          },
        });
        if (
          controller.signal.aborted ||
          activeProjectLatestRef.current !== requestProjectId
        ) {
          return;
        }
        if (!data?.run || typeof data.run !== 'object') {
          const failure = data as { message?: unknown; error?: unknown };
          throw new Error(
            safeText(failure.message || failure.error || 'deck_run_failed'),
          );
        }
        const run = data.run as DeckRun;
        const runDerivedCodeGraphContract = extractCodeGraphViewContractFromRun(
          run,
          requestProjectId,
        );
        if (runDerivedCodeGraphContract) {
          applyCodeGraphViewContract(runDerivedCodeGraphContract);
        }
        const assistantText =
          resolveDeckRunFinalText(run) || 'No response returned.';
        setLatestDeckRun(run);
        setLiveDeckEvents([]);
        setMessages((m) => [...m, { role: 'assistant', text: assistantText }]);
        setDeckStatusMessage('Deck run completed.');
        const responseReceivedAt = Date.now();
        const finalStep =
          [...(run.steps || [])]
            .reverse()
            .find((step) => step.status === 'success') || null;
        chatLoopTelemetryRef.current = {
          interactionId,
          sendStartedAt,
          responseReceivedAt,
          refreshRecorded: false,
        };
        emitWorkspaceTestingEvent({
          event: 'chat_response_received',
          interactionId,
          durationMs: Math.max(0, responseReceivedAt - sendStartedAt),
          surface:
            largeSurface === 'chat' ? 'chat' : normalizeWorkspaceSurface(tab),
          surfaceRole: largeSurface === 'chat' ? 'large' : 'companion',
          metadata: {
            responseMode: 'deck_runtime',
            turnId,
            provider: cleanOptionalText(finalStep?.effectiveAgent?.provider),
            model: cleanOptionalText(finalStep?.effectiveAgent?.model),
            stopReason: cleanOptionalText(run.status),
            turnsUsed: Array.isArray(run.steps) ? run.steps.length : null,
          },
        });

        loadProjectSubgraph({ force: true });
        window.setTimeout(() => {
          if (activeProjectLatestRef.current !== requestProjectId) return;
          loadProjectSubgraph({ force: true });
        }, 1500);
      } catch (err: any) {
        if (
          isAbortLikeError(err) ||
          activeProjectLatestRef.current !== requestProjectId
        ) {
          return;
        }
        const message = formatBuilderStatusMessage(
          err?.message,
          'Deck chat run failed.',
        );
        setLiveDeckEvents([]);
        setLatestDeckRun(null);
        setDeckStatusMessage(message);
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: `Request failed: ${message}`,
          },
        ]);
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
          surface:
            largeSurface === 'chat' ? 'chat' : normalizeWorkspaceSurface(tab),
          surfaceRole: largeSurface === 'chat' ? 'large' : 'companion',
          metadata: {
            responseMode: 'deck_runtime',
            turnId,
            ok: false,
            error: message,
          },
        });
      } finally {
        if (deckExecutionAbortRef.current === controller) {
          deckExecutionAbortRef.current = null;
        }
        setSending(false);
        setDeckRunBusy(false);
      }
    })();
  };

  const planMissionGraphSeed = useMemo(
    () => buildPlanMissionGraph(structuredAssistPlan, planNodeDrafts),
    [structuredAssistPlan, planNodeDrafts],
  );

  const thinkGraphViz = useMemo(() => {
    const ageGraph = prefixThinkGraphIds(ageRowsToGraph(graphResult));
    if (ageGraph.nodes.length > 0 || ageGraph.edges.length > 0) {
      return ageGraph;
    }
    return buildThinkGraphSeedFromPlanMissionGraph(planMissionGraphSeed);
  }, [graphResult, planMissionGraphSeed]);

  const knowGraphViz = useMemo(() => {
    const result = normalizeKnowGraphResponseToGraph(knowGraphData);
    return result;
  }, [knowGraphData]);

  const graphViz = useMemo(() => {
    return knowledgeGraphKind === 'thinkgraph' ? thinkGraphViz : knowGraphViz;
  }, [knowledgeGraphKind, knowGraphViz, thinkGraphViz]);

  const graphVizFiltered = useMemo(() => {
    const sinceTs = buildRecencySinceTs();
    const sinceMs = sinceTs ? Date.parse(sinceTs) : null;
    const nodeById = new Map(graphViz.nodes.map((n) => [n.id, n]));

    const edgePasses = (e: KEdge): boolean => {
      const source = e.source || e.a;
      const target = e.target || e.b;
      const sourceNode = source ? nodeById.get(source) : undefined;
      const targetNode = target ? nodeById.get(target) : undefined;
      const score = Number(e.confidence ?? e.weight ?? 0);
      if (
        graphMinConfidence > 0 &&
        Number.isFinite(score) &&
        score < graphMinConfidence
      ) {
        return false;
      }
      if (sinceMs != null) {
        const edgeTs = parseTimestampMs(e.last_seen_ts);
        if (typeof edgeTs === 'number' && edgeTs < sinceMs) {
          return false;
        }
      }
      if (graphTypeFilter !== 'all') {
        const sourceType = String(sourceNode?.type || 'unknown').toLowerCase();
        const targetType = String(targetNode?.type || 'unknown').toLowerCase();
        if (sourceType !== graphTypeFilter && targetType !== graphTypeFilter) {
          return false;
        }
      }
      return true;
    };

    const keptEdges = graphViz.edges.filter(edgePasses);
    const keptNodeIds = new Set<string>();
    keptEdges.forEach((e) => {
      const source = e.source || e.a;
      const target = e.target || e.b;
      if (source) keptNodeIds.add(source);
      if (target) keptNodeIds.add(target);
    });

    graphViz.nodes.forEach((n) => {
      const nodeType = String(n.type || 'unknown').toLowerCase();
      if (graphTypeFilter !== 'all' && nodeType !== graphTypeFilter) return;
      if (sinceMs != null) {
        const nodeTs = parseTimestampMs(n.last_seen_ts) ?? n.createdAtMs;
        if (typeof nodeTs === 'number' && nodeTs < sinceMs) return;
      }
      keptNodeIds.add(n.id);
    });

    const degreeByNode = new Map<string, number>();
    keptEdges.forEach((e) => {
      const source = e.source || e.a;
      const target = e.target || e.b;
      if (source) degreeByNode.set(source, (degreeByNode.get(source) || 0) + 1);
      if (target) degreeByNode.set(target, (degreeByNode.get(target) || 0) + 1);
    });

    const keptNodes = graphViz.nodes
      .filter((n) => keptNodeIds.has(n.id))
      .map((n) => ({
        ...n,
        degree: degreeByNode.get(n.id) || 0,
      }));

    return { nodes: keptNodes, edges: keptEdges };
  }, [graphViz, graphTypeFilter, graphMinConfidence, buildRecencySinceTs]);

  const graphVizForNVL = useMemo(() => {
    const result = buildGraphVizForNVL(graphVizFiltered);
    return result;
  }, [graphVizFiltered]);
  const thinkGraphViewData = useMemo<GraphViewData>(
    () => ({
      kind: 'thinkgraph',
      nodes: thinkGraphViz.nodes.map((node) => ({
        id: String(node.id),
        label: safeText(node.label || node.id),
        type: safeText(node.type || 'entity'),
        confidence:
          typeof node.confidence === 'number' ? node.confidence : undefined,
      })),
      edges: thinkGraphViz.edges.map((edge, index) => ({
        id:
          safeText(edge.id) ||
          `think:${index}:${safeText(edge.a)}:${safeText(edge.b)}`,
        source: String(edge.source || edge.a),
        target: String(edge.target || edge.b),
        type: safeText(edge.type || 'related_to'),
        weight: typeof edge.weight === 'number' ? edge.weight : undefined,
      })),
    }),
    [thinkGraphViz.edges, thinkGraphViz.nodes],
  );
  const knowGraphViewData = useMemo<GraphViewData>(
    () => ({
      kind: 'knowgraph',
      nodes: knowGraphViz.nodes.map((node) => ({
        id: String(node.id),
        label: safeText(node.label || node.id),
        type: safeText(node.type || 'entity'),
        confidence:
          typeof node.confidence === 'number' ? node.confidence : undefined,
      })),
      edges: knowGraphViz.edges.map((edge, index) => ({
        id:
          safeText(edge.id) ||
          `know:${index}:${safeText(edge.a)}:${safeText(edge.b)}`,
        source: String(edge.source || edge.a),
        target: String(edge.target || edge.b),
        type: safeText(edge.type || 'related_to'),
        weight: typeof edge.weight === 'number' ? edge.weight : undefined,
      })),
    }),
    [knowGraphViz.edges, knowGraphViz.nodes],
  );
  const knowledgeEntityById = useMemo(
    () =>
      new Map(
        graphVizForNVL.entities.map((entity) => [entity.id, entity] as const),
      ),
    [graphVizForNVL.entities],
  );
  const knowledgeRelationshipById = useMemo(
    () =>
      new Map(
        graphVizForNVL.relationships.map(
          (relationship) => [relationship.id, relationship] as const,
        ),
      ),
    [graphVizForNVL.relationships],
  );
  const selectedKnowledgeEntity = useMemo(
    () =>
      selectedKnowledgeEntityId
        ? knowledgeEntityById.get(selectedKnowledgeEntityId) || null
        : null,
    [knowledgeEntityById, selectedKnowledgeEntityId],
  );
  const selectedKnowledgeRelationship = useMemo(
    () =>
      selectedKnowledgeRelationshipId
        ? knowledgeRelationshipById.get(selectedKnowledgeRelationshipId) || null
        : null,
    [knowledgeRelationshipById, selectedKnowledgeRelationshipId],
  );
  const hasKnowledgeWorkspaceSelection = Boolean(
    selectedKnowledgeEntity || selectedKnowledgeRelationship,
  );
  const objectDrawerRole = useMemo<'agent' | 'plan' | null>(() => {
    if (workspaceView === 'canvas' && selectedCard) return 'agent';
    if (workspaceView === 'plan' && planMissionFocus) return 'plan';
    return null;
  }, [planMissionFocus, selectedCard, workspaceView]);
  const isObjectDrawerVisible = objectDrawerOpen && objectDrawerRole !== null;
  const objectDrawerDefaultWidth =
    objectDrawerRole === 'plan' ? 460 : AGENT_EDITOR_DEFAULT_WIDTH;
  const objectDrawerStorageKey =
    objectDrawerRole === 'plan'
      ? 'liquidaity.drawer.object.plan.width'
      : 'liquidaity.drawer.object.agent.width';

  const closeObjectDrawer = useCallback(() => {
    setObjectDrawerOpen(false);
    pendingPanelOpenTelemetryRef.current = null;
    setSelectedCardId(null);
    setSelectedEdgeId(null);
    setPlanMissionFocus(null);
    setBuilderCanvasFocusRequest((current) => ({
      kind: 'deck',
      cardId: null,
      nonce: (current?.nonce || 0) + 1,
    }));
  }, []);

  useEffect(() => {
    if (!selectedKnowledgeEntityId) return;
    if (knowledgeEntityById.has(selectedKnowledgeEntityId)) return;
    setSelectedKnowledgeEntityId(null);
  }, [knowledgeEntityById, selectedKnowledgeEntityId]);

  useEffect(() => {
    if (!selectedKnowledgeRelationshipId) return;
    if (knowledgeRelationshipById.has(selectedKnowledgeRelationshipId)) return;
    setSelectedKnowledgeRelationshipId(null);
  }, [knowledgeRelationshipById, selectedKnowledgeRelationshipId]);
  void handleSelectKnowledgeEntity;
  void handleSelectKnowledgeRelationship;
  void graphError;
  void graphLoading;
  void knowledgeGraphStatus;
  void graphResetToken;
  void expandingNodeId;
  void expandKnowGraphFromEntity;
  void expandGraphFromNode;

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
      const res = await fetch(V2_PROJECTS_API, {
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
      const newId = (data && data.id) || '';

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

  const renderChatSurface = (
    projectId: string,
    compact = false,
    surfaceRole: 'large' | 'companion' = compact ? 'companion' : 'large',
  ) => (
    <div
      data-testid={`${surfaceRole}-surface-chat`}
      style={getSurfaceShellStyle(compact)}
    >
      <div
        style={{
          height: '100%',
        }}
      >
        <BuilderChat
          messages={messages}
          onSend={handleSend}
          knowledgeProjectId={projectId}
          disabled={
            sending ||
            deckRunBusy ||
            cardRunBusy ||
            deckLoadBusy ||
            !canvasProjectId
          }
          colors={C}
        />
      </div>
    </div>
  );

  const renderCanvasSurface = (
    compact = false,
    surfaceRole: 'large' | 'companion' = compact ? 'companion' : 'large',
  ) => {
    return (
      <div
        data-testid={`${surfaceRole}-surface-canvas`}
        style={getSurfaceShellStyle(compact)}
      >
        <div
          style={{
            height: '100%',
          }}
        >
          <BuilderCanvas
            document={deck}
            setDocument={setDeck}
            onPersistGraphMutation={recordDeckWriteReason}
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
          />
        </div>
      </div>
    );
  };

  const renderKnowledgeWorkspacePanel = () => {
    if (!selectedKnowledgeEntity && !selectedKnowledgeRelationship) return null;

    if (selectedKnowledgeEntity) {
      return (
        <div
          data-testid="companion-surface-knowledge-panel"
          style={{ height: '100%', overflow: 'auto' }}
        >
          <div
            data-testid="knowledge-panel-entity"
            style={{
              display: 'grid',
              gap: 12,
              paddingRight: 4,
            }}
          >
            <div
              style={graphDrawerSectionStyle({
                borderRadius: 10,
                padding: '14px 16px',
              })}
            >
              <div
                style={{
                  color: GRAPH_THEME.drawer.inputText,
                  fontSize: 20,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {safeText(selectedKnowledgeEntity.label)}
              </div>
              <div
                className="text-xs"
                style={{ color: GRAPH_THEME.drawer.inputMuted, marginTop: 6 }}
              >
                {safeText(selectedKnowledgeEntity.type)} •{' '}
                {safeText(selectedKnowledgeEntity.source)} •{' '}
                {formatKnowledgeScope(selectedKnowledgeEntity.scope)}
              </div>
            </div>

            <div
              style={graphDrawerSectionStyle({
                borderRadius: 10,
                padding: '12px 14px',
                color: GRAPH_THEME.drawer.inputMuted,
                lineHeight: 1.6,
              })}
            >
              Degree {selectedKnowledgeEntity.degree || 0}
              {selectedKnowledgeEntity.last_seen_ts
                ? ` • ${safeText(selectedKnowledgeEntity.last_seen_ts)}`
                : ''}
            </div>
          </div>
        </div>
      );
    }

    if (!selectedKnowledgeRelationship) return null;
    const fromLabel =
      knowledgeEntityById.get(selectedKnowledgeRelationship.from)?.label ||
      selectedKnowledgeRelationship.from;
    const toLabel =
      knowledgeEntityById.get(selectedKnowledgeRelationship.to)?.label ||
      selectedKnowledgeRelationship.to;

    return (
      <div
        data-testid="companion-surface-knowledge-panel"
        style={{ height: '100%', overflow: 'auto' }}
      >
        <div
          data-testid="knowledge-panel-relationship"
          style={{
            display: 'grid',
            gap: 12,
            paddingRight: 4,
          }}
        >
          <div
            style={graphDrawerSectionStyle({
              borderRadius: 10,
              padding: '14px 16px',
            })}
          >
            <div
              style={{
                color: GRAPH_THEME.drawer.inputText,
                fontSize: 20,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              {safeText(selectedKnowledgeRelationship.type)}
            </div>
            <div
              className="text-xs"
              style={{ color: GRAPH_THEME.drawer.inputMuted, marginTop: 6 }}
            >
              {safeText(fromLabel)} → {safeText(toLabel)}
            </div>
            <div
              className="text-xs"
              style={{ color: GRAPH_THEME.drawer.inputMuted, marginTop: 6 }}
            >
              {safeText(selectedKnowledgeRelationship.source)} •{' '}
              {formatKnowledgeScope(selectedKnowledgeRelationship.scope)}
            </div>
          </div>

          {(selectedKnowledgeRelationship.evidence_doc_id ||
            selectedKnowledgeRelationship.last_seen_ts) && (
            <div
              style={graphDrawerSectionStyle({
                borderRadius: 10,
                padding: '12px 14px',
                color: GRAPH_THEME.drawer.inputMuted,
                lineHeight: 1.6,
              })}
            >
              {selectedKnowledgeRelationship.evidence_doc_id
                ? `Doc ${safeText(selectedKnowledgeRelationship.evidence_doc_id)}`
                : ''}
              {selectedKnowledgeRelationship.evidence_doc_id &&
              selectedKnowledgeRelationship.last_seen_ts
                ? ' • '
                : ''}
              {selectedKnowledgeRelationship.last_seen_ts
                ? safeText(selectedKnowledgeRelationship.last_seen_ts)
                : ''}
            </div>
          )}

          {selectedKnowledgeRelationship.evidence_snippet && (
            <div
              style={graphDrawerSectionStyle({
                borderRadius: 10,
                padding: '12px 14px',
                color: GRAPH_THEME.drawer.inputText,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              })}
            >
              {safeText(selectedKnowledgeRelationship.evidence_snippet)}
            </div>
          )}
        </div>
      </div>
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
              <KnowledgeGraphFramework
                kind={knowledgeGraphKind}
                onKindChange={(nextKind) => {
                  setKnowledgeGraphKind(nextKind);
                  setGraphViewContract((prev) => ({
                    graphKind: nextKind,
                    projectId:
                      nextKind === 'codegraph'
                        ? CODEBASE_MEMORY_PROJECT_NAME
                        : (activeProject ?? null),
                    nodeLabelAllowlist: undefined,
                    edgeTypeAllowlist: undefined,
                    showLabels: prev?.showLabels ?? true,
                    maxNodes: undefined,
                    focusNodeIds: undefined,
                    focusPaths: undefined,
                    focusSymbols: undefined,
                    cameraMode: prev?.cameraMode ?? 'overview',
                    animationMode: prev?.animationMode ?? 'calm',
                    narrativeIntent: prev?.narrativeIntent ?? null,
                  }));
                }}
                contract={
                  graphViewContract ?? {
                    graphKind: knowledgeGraphKind,
                    projectId:
                      knowledgeGraphKind === 'codegraph'
                        ? CODEBASE_MEMORY_PROJECT_NAME
                        : (activeProject ?? null),
                    showLabels: true,
                    cameraMode: 'overview',
                    animationMode: 'calm',
                    narrativeIntent: null,
                  }
                }
                onContractChange={(nextContract) =>
                  setGraphViewContract(nextContract)
                }
                thinkGraphData={thinkGraphViewData}
                knowGraphData={knowGraphViewData}
                codeGraphProjectName={CODEBASE_MEMORY_PROJECT_NAME}
                onRefreshRequest={loadGraphData}
                minHeight={minHeight}
              />
            </Suspense>
          </KnowledgeSurfaceErrorBoundary>
        </div>
      </div>
    </div>
  );

  const renderPlanSurface = (surfaceRole: 'large' | 'companion' = 'large') => (
    <div
      data-testid={`${surfaceRole}-surface-plan`}
      style={getSurfaceShellStyle(surfaceRole === 'companion', {
        overflow: surfaceRole === 'companion' ? 'hidden' : 'auto',
      })}
    >
      <div
        className="h-full min-h-0"
        style={{
          overflow: surfaceRole === 'companion' ? 'hidden' : 'auto',
          paddingRight: surfaceRole === 'companion' ? 0 : 4,
        }}
      >
        {!activeProject ? (
          <div
            style={graphDrawerSectionStyle({
              padding: '16px',
              borderStyle: 'dashed',
              color: GRAPH_THEME.drawer.inputMuted,
            })}
          >
            Select a project to view its plan.
          </div>
        ) : !stateLoaded ? (
          <div
            style={graphDrawerSectionStyle({
              padding: '16px',
              color: GRAPH_THEME.drawer.inputMuted,
            })}
          >
            Loading plan...
          </div>
        ) : (
          <div
            className="h-full min-h-0"
            style={{
              height: '100%',
              padding: 0,
              borderRadius: 0,
              border: 'none',
              background: 'transparent',
              boxShadow: 'none',
            }}
          >
            {pendingActivationProposal ? (
              <div
                style={graphDrawerSectionStyle({
                  margin: '12px 12px 10px',
                  padding: '12px 14px',
                  borderColor:
                    pendingActivationProposal.status === 'approved'
                      ? 'rgba(79,162,173,0.32)'
                      : 'rgba(226,186,84,0.28)',
                  background:
                    pendingActivationProposal.status === 'approved'
                      ? 'rgba(79,162,173,0.12)'
                      : 'rgba(226,186,84,0.10)',
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
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: GRAPH_THEME.text.primary,
                      }}
                    >
                      {pendingActivationProposal.title}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: GRAPH_THEME.drawer.inputMuted,
                      }}
                    >
                      {pendingActivationProposal.status === 'approved'
                        ? 'Approved for manual activation on the canvas.'
                        : 'Pending approval before any graph rewiring.'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingActivationProposal((current) =>
                          current
                            ? { ...current, status: 'approved' }
                            : current,
                        )
                      }
                      className="px-3 py-1 rounded"
                      style={{
                        color: GRAPH_THEME.text.primary,
                        background: 'rgba(79,162,173,0.16)',
                        border: '1px solid rgba(79,162,173,0.28)',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingActivationProposal(null)}
                      className="px-3 py-1 rounded"
                      style={{
                        color: GRAPH_THEME.drawer.inputMuted,
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.12)',
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: GRAPH_THEME.drawer.inputMuted,
                  }}
                >
                  Request: {pendingActivationProposal.sourceText}
                </div>
              </div>
            ) : null}
            <PlanMissionFlow
              structuredPlan={structuredAssistPlan}
              projectId={activeProject ?? null}
              compact={surfaceRole === 'companion'}
              fullHeight
              nodeOverrides={planNodeDrafts}
              selectedNodeId={planMissionFocus?.nodeId || null}
              drawerLinked={Boolean(
                surfaceRole === 'companion' &&
                  workspaceView === 'plan' &&
                  objectDrawerOpen &&
                  planMissionFocus?.nodeId,
              )}
              editMode={Boolean(
                workspaceView === 'plan' &&
                objectDrawerOpen &&
                planMissionFocus?.nodeId,
              )}
              onFocusChange={(focus) => {
                setPlanMissionFocus(focus);
                if (focus) {
                  setSelectedCardId(null);
                  setSelectedEdgeId(null);
                  setObjectDrawerOpen(true);
                  return;
                }
                if (workspaceView === 'plan') {
                  setObjectDrawerOpen(false);
                }
              }}
            />
            {planMissionFocus ? (
              <div
                className="text-xs"
                style={{
                  color: GRAPH_THEME.drawer.inputMuted,
                  marginTop: 8,
                }}
              >
                Focus: {safeText(planMissionFocus.nodeKind)} -{' '}
                {safeText(planMissionFocus.nodeLabel)}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );

  const showCanvasWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('canvas');
  }, [closeObjectDrawer]);

  const showKnowledgeWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('knowledge');
    setKnowledgeGraphKind('knowgraph');
  }, [closeObjectDrawer]);

  const showPlanWorkspace = useCallback(() => {
    closeObjectDrawer();
    setWorkspaceView('plan');
  }, [closeObjectDrawer]);

  const showWorkbenchWorkspace = useCallback((surface: WorkbenchSurfaceId) => {
    closeObjectDrawer();
    setWorkspaceView(surface);
  }, [closeObjectDrawer]);

  const showEnergyWorkspace = useCallback(() => {
    showWorkbenchWorkspace('energy');
  }, [showWorkbenchWorkspace]);

  const showTradingWorkspace = useCallback(() => {
    showWorkbenchWorkspace('trading');
  }, [showWorkbenchWorkspace]);

  const showImageWorkspace = useCallback(() => {
    showWorkbenchWorkspace('image');
  }, [showWorkbenchWorkspace]);

  const showCodeWorkspace = useCallback(() => {
    showWorkbenchWorkspace('code');
  }, [showWorkbenchWorkspace]);

  const showVideoWorkspace = useCallback(() => {
    showWorkbenchWorkspace('video');
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

  const applyCodeGraphViewContract = useCallback(
    (contract: GraphViewContract | null) => {
      if (!contract) return;
      const setter = (window as any).__LIQUIDAITY_SET_CODEGRAPH_VIEW_CONTRACT__;
      if (typeof setter === 'function') {
        setter(contract);
        return;
      }
      setKnowledgeGraphKind(contract.graphKind || 'codegraph');
      setGraphViewContract(contract);
    },
    [],
  );

  useEffect(() => {
    (window as any).__LIQUIDAITY_SET_CODEGRAPH_VIEW_CONTRACT__ = (
      contract: GraphViewContract | null,
    ) => {
      if (!contract) return;
      setKnowledgeGraphKind(contract.graphKind || 'codegraph');
      setGraphViewContract(contract);
    };
    return () => {
      delete (window as any).__LIQUIDAITY_SET_CODEGRAPH_VIEW_CONTRACT__;
    };
  }, [applyCodeGraphViewContract]);

  const handleCompanionTabClick = useCallback((nextTab: string) => {
    setTab(nextTab);
  }, []);

  return (
    <div
      className="h-screen w-full flex overflow-hidden"
      style={{ background: C.bg, color: C.text }}
    >
      <style>{`
        @keyframes builder-orb-float {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-0.5px) scale(1.015); }
        }
      `}</style>
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* LEFT rail */}
        <aside
          className="h-full flex flex-col items-center gap-3 py-3"
          style={{
            width: 54,
            background: C.panel,
            borderRight: `1px solid ${C.border}`,
          }}
        >
          {visibleRailItems.showWorldsignal ? (
            <button
              type="button"
              title="World"
              aria-label="World"
              data-testid="rail-moon-orb-button"
              onClick={showWorldsignalWorkspace}
              className="p-2 rounded"
              style={{ color: workspaceView === 'worldsignal' ? C.primary : C.text }}
            >
              <div
                style={{
                  position: 'relative',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  overflow: 'visible',
                  animation: 'builder-orb-float 21s ease-in-out infinite',
                  boxShadow:
                    'inset 0 1px 1px rgba(255,255,255,0.12), 0 0 14px rgba(79,162,173,0.14), 0 0 26px rgba(125,105,180,0.08)',
                }}
              >
                <BuilderRailMoonOrb phase01={moonPhase01} />
              </div>
            </button>
          ) : null}
          <button
            title="Agents"
            aria-label="Agents"
            data-testid="rail-plus-button"
            onClick={() => {
              if (workspaceView === 'canvas') {
                handleQuickAddDeckNode('assist');
              } else {
                showCanvasWorkspace();
              }
            }}
            className="p-2 rounded"
            style={{ color: workspaceView === 'canvas' ? C.primary : C.text }}
          >
            <HexPlusIcon />
          </button>
          {visibleRailItems.showKnowledge ? (
            <button
              title="Knowledge"
              aria-label="Knowledge"
              data-testid="rail-burst-button"
              onClick={showKnowledgeWorkspace}
              className="p-2 rounded"
              style={{
                color: workspaceView === 'knowledge' ? C.primary : C.text,
              }}
            >
              <Icon d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
            </button>
          ) : null}
          {visibleRailItems.showEnergy ? (
            <button
              title="Energy"
              aria-label="Energy"
              data-testid="rail-energy-button"
              onClick={showEnergyWorkspace}
              className="p-2 rounded"
              style={{
                color:
                  workspaceView === 'energy' ? GRAPH_THEME.accent.solar : C.text,
              }}
            >
              <Icon d="M7.2 4.2 13.2 1.6 19 4.7v8.5l-6 3.2-6-3.1V4.2Z M7.2 4.2 13 7.4l6-2.7 M13 7.4v9 M4 6.7l3.2-2.5 M4 6.7v8.5l6 1.2" />
            </button>
          ) : null}
          {visibleRailItems.showTrading ? (
            <button
              title="Trading"
              aria-label="Trading"
              data-testid="rail-trading-button"
              onClick={showTradingWorkspace}
              className="p-2 rounded"
              style={{
                color:
                  workspaceView === 'trading'
                    ? GRAPH_THEME.accent.solar
                    : C.text,
              }}
            >
              <Icon d="M4 18h16M6 15l3-3 3 2 4-6 2 2" />
            </button>
          ) : null}
          {visibleRailItems.showImage ? (
            <button
              title="Image"
              aria-label="Image"
              data-testid="rail-image-button"
              onClick={showImageWorkspace}
              className="p-2 rounded"
              style={{
                color:
                  workspaceView === 'image' ? GRAPH_THEME.accent.solar : C.text,
              }}
            >
              <Icon d="M5 6h14v12H5z M8 14l2.5-2.5L13 14l2-2 2 2 M9 10h.01" />
            </button>
          ) : null}
          {visibleRailItems.showCode ? (
            <button
              title="Code"
              aria-label="Code"
              data-testid="rail-code-button"
              onClick={showCodeWorkspace}
              className="p-2 rounded"
              style={{
                color:
                  workspaceView === 'code' ? GRAPH_THEME.accent.solar : C.text,
              }}
            >
              <Icon d="M9 7 4 12l5 5 M15 7l5 5-5 5 M13 5l-2 14" />
            </button>
          ) : null}
          {visibleRailItems.showVideo ? (
            <button
              title="Video"
              aria-label="Video"
              data-testid="rail-video-button"
              onClick={showVideoWorkspace}
              className="p-2 rounded"
              style={{
                color:
                  workspaceView === 'video' ? GRAPH_THEME.accent.solar : C.text,
              }}
            >
              <Icon d="M5 7h10v10H5z M15 10l4-2v8l-4-2" />
            </button>
          ) : null}
          {visibleRailItems.uaAgents.map((agent) => (
            <button
              key={agent.id}
              title={agent.name}
              aria-label={agent.name}
              data-testid={`rail-${agent.id}-button`}
              onClick={() => showWorkbenchWorkspace(agent.surfaceId)}
              className="p-2 rounded"
              style={{
                color:
                  workspaceView === agent.surfaceId
                    ? GRAPH_THEME.accent.solar
                    : C.text,
              }}
            >
              <Icon d={agent.railIcon} />
            </button>
          ))}

          <div className="flex-1" />

          {visibleRailItems.showPlan ? (
            <button
              title="Plan"
              aria-label="Plan"
              data-testid="rail-orange-button"
              onClick={showPlanWorkspace}
              className="p-2 rounded mb-1"
              style={{
                color:
                  workspaceView === 'plan' ? GRAPH_THEME.accent.solar : C.text,
              }}
            >
              <Icon d="M3 12l2-2 4 4L21 4" />
            </button>
          ) : null}

          <button
            title="Menu"
            aria-label="Menu"
            data-testid="rail-three-lines-button"
            onClick={() => setOpenDrawer('navigation')}
            className="p-2 rounded"
            style={{
              color: C.text,
              background: 'transparent',
            }}
          >
            <Icon d="M4 7h16M4 12h16M4 17h16" />
          </button>
        </aside>

        <div
          ref={workspaceShellRef}
          className="flex flex-1 overflow-hidden min-h-0"
          style={{ position: 'relative' }}
        >
          <div
            data-testid="workspace-large-region"
            data-surface={largeSurface}
            className="h-full min-w-0 relative"
            style={{
              ...(workspaceView === 'chat'
                ? {
                    width: '100%',
                    minWidth: 0,
                    flex: '1 1 auto',
                  }
                : {
                    width: chatPanelWidth,
                    minWidth: AGENTS_CHAT_MIN_WIDTH,
                    flex: '0 0 auto',
                  }),
            }}
          >
            {renderChatSurface(activeProject, false, 'large')}
          </div>

          {workspaceView !== 'chat' ? (
            <div
              data-testid="workspace-chat-resize-handle"
              aria-label="Resize chat panel"
              title="Drag to resize chat"
              onMouseEnter={() => setChatResizeHandleActive(true)}
              onMouseLeave={() => setChatResizeHandleActive(false)}
              onMouseDown={(e) => {
                setChatResizeHandleActive(true);
                const sx = e.clientX;
                const sw = chatPanelWidth;
                const reservedWidth =
                  workspaceView === 'canvas'
                    ? AGENTS_CANVAS_MIN_WIDTH
                    : WORKSPACE_COMPANION_MIN_WIDTH;
                const mv = (ev: MouseEvent) => {
                  const d = ev.clientX - sx;
                  setChatPanelWidth(
                    clampAgentsChatWidth(sw + d, reservedWidth),
                  );
                };
                const up = () => {
                  setChatResizeHandleActive(false);
                  window.removeEventListener('mousemove', mv);
                  window.removeEventListener('mouseup', up);
                };
                window.addEventListener('mousemove', mv);
                window.addEventListener('mouseup', up);
              }}
              style={{
                width: 10,
                height: '100%',
                cursor: 'col-resize',
                flexShrink: 0,
                position: 'relative',
                overflow: 'hidden',
                borderLeft: `1px solid ${chatResizeHandleActive ? 'rgba(79,162,173,0.34)' : 'rgba(79,162,173,0.18)'}`,
                borderRight: `1px solid ${chatResizeHandleActive ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}`,
                boxShadow: chatResizeHandleActive
                  ? 'inset 0 0 0 1px rgba(79,162,173,0.16), 0 0 10px rgba(79,162,173,0.12)'
                  : 'none',
                background:
                  'linear-gradient(90deg, rgba(79,162,173,0.05), rgba(255,255,255,0.09), rgba(79,162,173,0.05))',
                transition:
                  'border-color 120ms ease, box-shadow 120ms ease, background 120ms ease',
              }}
            >
            </div>
          ) : null}

          {workspaceView === 'canvas' ? (
            <div
              data-testid="workspace-canvas-region"
              className="h-full flex-1 min-w-0 relative"
              style={{ minWidth: AGENTS_CANVAS_MIN_WIDTH }}
            >
              {renderCanvasSurface(false, 'large')}
            </div>
          ) : null}

          {workspaceView !== 'canvas' && workspaceView !== 'chat' ? (
            <aside
              data-testid="workspace-companion-region"
              data-workspace={workspaceView}
              data-open="true"
              className="h-full relative"
              style={graphCompanionPanelStyle({
                minWidth: WORKSPACE_COMPANION_MIN_WIDTH,
                flex: '1 1 0%',
                overflow: 'hidden',
              })}
            >
              <div className="h-full flex flex-col overflow-hidden min-h-0 relative">
                <div
                  className="flex-1 overflow-hidden text-sm min-h-0"
                  style={{
                    color: GRAPH_THEME.drawer.inputMuted,
                    background: 'transparent',
                  }}
                >
                  {workspaceView === 'knowledge' &&
                    hasKnowledgeWorkspaceSelection &&
                    renderKnowledgeWorkspacePanel()}
                  {workspaceView === 'knowledge' &&
                    !hasKnowledgeWorkspaceSelection &&
                    <KnowledgeGraphSurface
                      minHeight={420}
                      surfaceRole="companion"
                    />}
                  {workspaceView === 'codegraph' &&
                    <KnowledgeGraphSurface
                      minHeight={420}
                      surfaceRole="companion"
                    />}
                  {workspaceView === 'energy' && (
                    <EnergySurfaceErrorBoundary key="energy-surface">
                      <Suspense
                        fallback={
                          <div
                            data-testid="energy-facade-loading"
                            style={{
                              height: '100%',
                              padding: 16,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background:
                                GRAPH_THEME.background.knowledgeSurface,
                            }}
                          >
                            <div
                              style={graphDrawerSectionStyle({
                                padding: '12px 14px',
                                color: GRAPH_THEME.drawer.inputMuted,
                              })}
                            >
                              Loading energy canvas...
                            </div>
                          </div>
                        }
                      >
                        <EnergyFacadeSurface
                          inputs={energyInputs}
                          selectedObjectId={selectedWorkspaceObjectId}
                          latestActionSummary={latestWorkspaceActionSummary}
                          onWorkspaceAction={applyWorkspaceAction}
                        />
                      </Suspense>
                    </EnergySurfaceErrorBoundary>
                  )}
                  {workspaceView === 'trading' && (
                    <Suspense
                      fallback={
                        <div
                          data-testid="trading-canvas-loading"
                          style={{
                            height: '100%',
                            padding: 16,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: GRAPH_THEME.background.knowledgeSurface,
                          }}
                        >
                          <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 13 }}>
                            Loading trading canvas...
                          </div>
                        </div>
                      }
                    >
                      <TradingCanvasSurface />
                    </Suspense>
                  )}
                  {workspaceView === 'image' &&
                    renderWorkbenchPlaceholderSurface({
                      testId: 'image-workspace-placeholder',
                      title: 'Image Maker',
                      status: 'Demo / planned integration',
                      accentColor: GRAPH_THEME.drawer.inputText,
                      steps: [
                        'Prompt the image concept and generate variations.',
                        'Place approved art on shirt, hoodie, poster, or canvas layouts.',
                        'Export order-ready files later when the generation bridge exists.',
                      ],
                    })}
                  {workspaceView === 'code' &&
                    renderWorkbenchPlaceholderSurface({
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
                  {workspaceView === 'video' &&
                    renderWorkbenchPlaceholderSurface({
                      testId: 'video-workspace-placeholder',
                      title: 'Video Agent',
                      status: 'Planned',
                      accentColor: GRAPH_THEME.drawer.inputMuted,
                      steps: [
                        'Draft script or storyboard.',
                        'Generate or collect clips.',
                        'Assemble, export, and publish later when the video bridge exists.',
                      ],
                    })}
                  {activeUaAgentDefinition && (
                    <Suspense
                      fallback={
                        <div
                          data-testid="ua-agent-panel-loading"
                          style={{
                            height: '100%',
                            padding: 18,
                            color: GRAPH_THEME.drawer.inputMuted,
                          }}
                        >
                          Loading agent panel...
                        </div>
                      }
                    >
                      <UaAgentPanelHost
                        surfaceId={activeUaAgentDefinition.surfaceId}
                      />
                    </Suspense>
                  )}
                  {workspaceView === 'worldsignal' &&
                    <WorldSignalSurface />}
                  {workspaceView === 'plan' && renderPlanSurface('companion')}
                </div>
              </div>
            </aside>
          ) : null}

          {workspaceView === 'canvas' || workspaceView === 'plan' ? (
            <RightGlassDrawer
              isOpen={isObjectDrawerVisible}
              title={
                objectDrawerRole === 'plan'
                  ? `Plan Node: ${safeText(selectedPlanNodeDraft?.label || planMissionFocus?.nodeLabel || 'Edit')}`
                  : safeText(selectedCard?.title || 'Agent')
              }
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
                {objectDrawerRole === 'plan'
                  ? renderPlanMissionEditorPanel()
                  : renderAgentBuilderPanel()}
              </div>
            </RightGlassDrawer>
          ) : null}
        </div>
      </div>

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
                          `${V2_PROJECTS_API}/${project.id}`,
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
  );
}
