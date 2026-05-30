// @graph entity: DeckRuntime
// @graph role: visible-graph-executor
// @graph relates_to: BuilderCanvas, CardRuntime, Magentic-One Runtime
// @graph depends_on: CardRuntime
// @graph feeds_to: CardRuntime
import { randomUUID } from 'crypto';
import { resolveEffectiveAgent, runCardWithContract } from '../cards/runtime';
import { buildExecutionPlan } from '../decks/executionPlan';
import { validateDeckDocument } from '../decks/validation';
import {
  buildGraphExecutionInputText,
  createGraphExecutionScheduler,
  type GraphExecutionRouteInfo,
} from './graphExecution';
import type {
  AgentCardInstance,
  AgentTemplate,
  CodeGraphViewContract,
  DeckDocument,
  DeckEdge,
  DeckEdgeType,
  DeckRun,
  DeckRuntimeEvent,
  DeckRunStep,
  DeckWorkspaceContext,
  GraphViewContract,
  MissionAgentRunStatus,
  MissionRunStatus,
  MissionSpec,
  PromptTemplate,
  WorkspaceObjectContext,
} from '../types';

// Visible graph edges are the execution truth. Higher-level planning must compile into this runtime, not bypass it.
export type ExecuteDeckOptions = {
  input?: string;
  promptTemplates?: PromptTemplate[];
  projectId?: string;
  workspaceContext?: DeckWorkspaceContext | null;
  workspaceObjectContext?: WorkspaceObjectContext | null;
  onRuntimeEvent?: (event: DeckRuntimeEvent) => void;
  missionSpec?: MissionSpec;
  missionRunId?: string;
  missionAgentRunId?: string;
};

const WORKSPACE_OBJECT_CONTEXT_LIST_LIMIT = 12;
const WORKSPACE_OBJECT_SELECTED_TEXT_LIMIT = 240;
const WORKSPACE_OBJECT_SUMMARY_LIMIT = 400;

function cleanOptionalText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function cleanLimitedText(value: unknown, limit: number): string | null {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function cleanLimitedList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = cleanLimitedText(item, 96);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= WORKSPACE_OBJECT_CONTEXT_LIST_LIMIT) break;
  }
  return out;
}

function normalizeWorkspaceRuntimeType(
  value: unknown,
): DeckWorkspaceContext['objectEditor']['selectedCardRuntimeType'] {
  const runtimeType = cleanOptionalText(value);
  if (runtimeType === 'assistant_agent') return 'assistant_agent';
  if (runtimeType === 'magentic_one') return 'magentic_one';
  if (runtimeType === 'graph_flow') return 'graph_flow';
  if (runtimeType === 'local_coder') return 'local_coder';
  return null;
}

function normalizeWorkspaceContext(value: unknown): DeckWorkspaceContext | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const rawEditor =
    raw.objectEditor && typeof raw.objectEditor === 'object'
      ? (raw.objectEditor as Record<string, unknown>)
      : {};
  const context: DeckWorkspaceContext = {
    workspaceView: cleanOptionalText(raw.workspaceView) || 'chat',
    largeSurface: cleanOptionalText(raw.largeSurface) || 'chat',
    activeTab: cleanOptionalText(raw.activeTab),
    objectEditor: {
      open: rawEditor.open === true,
      activeTab: cleanOptionalText(rawEditor.activeTab),
      selectedCardId: cleanOptionalText(rawEditor.selectedCardId),
      selectedCardTitle: cleanOptionalText(rawEditor.selectedCardTitle),
      selectedCardRuntimeType: normalizeWorkspaceRuntimeType(rawEditor.selectedCardRuntimeType),
      editable: rawEditor.editable === true,
      runnable: rawEditor.runnable === true,
    },
  };
  return context;
}

function normalizeWorkspaceObjectContext(value: unknown): WorkspaceObjectContext | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const context: WorkspaceObjectContext = {
    activeSurface: cleanLimitedText(raw.activeSurface, 64),
    workspaceView: cleanLimitedText(raw.workspaceView, 64),
    selectedObjectId: cleanLimitedText(raw.selectedObjectId, 96),
    selectedObjectType: cleanLimitedText(raw.selectedObjectType, 64),
    selectedObjectTitle: cleanLimitedText(raw.selectedObjectTitle, 120),
    selectedText: cleanLimitedText(raw.selectedText, WORKSPACE_OBJECT_SELECTED_TEXT_LIMIT),
    openObjectSummary: cleanLimitedText(raw.openObjectSummary, WORKSPACE_OBJECT_SUMMARY_LIMIT),
    activeMagenticParticipants: cleanLimitedList(raw.activeMagenticParticipants),
    availableCanvasAgents: cleanLimitedList(raw.availableCanvasAgents),
    excludedAgents: cleanLimitedList(raw.excludedAgents),
  };
  return Object.values(context).some((entry) =>
    Array.isArray(entry) ? entry.length > 0 : Boolean(entry),
  )
    ? context
    : null;
}

function isRunnableNode(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(node && node.kind === 'agent' && !String(node.parentGraphId || '').trim());
}

function isPythonAutoGenMagenticCard(card: AgentCardInstance): boolean {
  const runtimeOptions =
    card.runtimeOptions && typeof card.runtimeOptions === 'object'
      ? (card.runtimeOptions as Record<string, unknown>)
      : {};
  return (
    card.runtimeType === 'magentic_one' &&
    String(runtimeOptions.executionBackend || '').trim() === 'python_autogen'
  );
}

function normalizeEdgeType(value: unknown): DeckEdgeType {
  return String(value || '').trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'flow';
}

function getNodeMap(document: DeckDocument): Map<string, AgentCardInstance> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}

function getExistingEdges(document: DeckDocument): DeckEdge[] {
  const nodeMap = getNodeMap(document);
  return document.edges.filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target));
}

function getRunnableNodes(document: DeckDocument): AgentCardInstance[] {
  const callableTargets = new Set(
    getExistingEdges(document)
      .filter((edge) => normalizeEdgeType(edge.edgeType) === 'magentic_option')
      .map((edge) => edge.target),
  );
  return document.nodes.filter((node) => isRunnableNode(node) && !callableTargets.has(node.id));
}

function getAgentEdges(document: DeckDocument): DeckEdge[] {
  const nodeMap = getNodeMap(document);
  return getExistingEdges(document).filter((edge) => {
    if (normalizeEdgeType(edge.edgeType) !== 'flow') return false;
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    return isRunnableNode(source) && isRunnableNode(target);
  });
}

function buildRunSnapshot(
  runId: string,
  document: DeckDocument,
  input: string,
  startedAt: string,
  steps: DeckRunStep[],
  events: DeckRuntimeEvent[],
  validation: ReturnType<typeof validateDeckDocument>,
  executionPlan: ReturnType<typeof buildExecutionPlan>,
  status: DeckRun['status'],
  extra?: Pick<DeckRun, 'endedAt' | 'error'>,
  workspaceContext?: DeckWorkspaceContext | null,
  workspaceObjectContext?: WorkspaceObjectContext | null,
  mission?: DeckRun['mission'] | null,
): DeckRun {
  const graphViewContract =
    [...steps]
      .reverse()
      .map((step) => toGraphViewContract(step.graphViewContract || step.codegraphViewContract))
      .find((value) => value != null) ||
    [...events]
      .reverse()
      .map((event) => toGraphViewContract(event.graphViewContract || event.codegraphViewContract))
      .find((value) => value != null) ||
    null;
  return {
    id: runId,
    deckId: document.id,
    startedAt,
    endedAt: extra?.endedAt,
    status,
    input,
    error: extra?.error,
    workspaceContext: workspaceContext || null,
    workspaceObjectContext: workspaceObjectContext || null,
    steps,
    events,
    graphViewContract,
    codegraphViewContract: graphViewContract,
    validationSummary: {
      ok: validation.ok,
      errors: validation.errors.map((issue) => issue.message),
      warnings: validation.warnings.map((issue) => issue.message),
    },
    executionPlanSummary: {
      startCardIds: executionPlan.startCardIds,
      simpleOrderCardIds: executionPlan.simpleOrderCardIds,
      expandedStepIds: executionPlan.expandedSteps.map((step) => step.executionId),
    },
    mission: mission || null,
  };
}

function toGraphViewContract(
  value: GraphViewContract | CodeGraphViewContract | null | undefined,
): GraphViewContract | null {
  if (!value) return null;
  const record = value as Record<string, unknown>;
  const graphKindRaw = String(record.graphKind || 'codegraph').trim().toLowerCase();
  const graphKind =
    graphKindRaw === 'thinkgraph' || graphKindRaw === 'knowgraph' || graphKindRaw === 'codegraph'
      ? graphKindRaw
      : 'codegraph';
  const toStringArray = (input: unknown): string[] | undefined => {
    if (!Array.isArray(input)) return undefined;
    const normalized = input.map((entry) => String(entry || '').trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  };
  return {
    graphKind: graphKind as GraphViewContract['graphKind'],
    projectId: String(record.projectId || '').trim() || undefined,
    focusNodeIds: toStringArray(record.focusNodeIds),
    focusPaths: toStringArray(record.focusPaths),
    focusSymbols: toStringArray(record.focusSymbols),
    nodeLabelAllowlist: toStringArray(record.nodeLabelAllowlist),
    edgeTypeAllowlist: toStringArray(record.edgeTypeAllowlist),
    showLabels: typeof record.showLabels === 'boolean' ? record.showLabels : undefined,
    maxNodes: Number.isFinite(Number(record.maxNodes)) ? Number(record.maxNodes) : undefined,
    cameraMode:
      record.cameraMode === 'overview' ||
      record.cameraMode === 'focus' ||
      record.cameraMode === 'trace' ||
      record.cameraMode === 'cluster'
        ? (record.cameraMode as GraphViewContract['cameraMode'])
        : undefined,
    animationMode:
      record.animationMode === 'calm' ||
      record.animationMode === 'guided' ||
      record.animationMode === 'active'
        ? (record.animationMode as GraphViewContract['animationMode'])
        : undefined,
    narrativeIntent: String(record.narrativeIntent || '').trim() || null,
  };
}

function buildNodeInput(
  document: DeckDocument,
  event: {
    card: AgentCardInstance;
    isStart: boolean;
    routeInfo: GraphExecutionRouteInfo;
  },
  baseInput: string,
): string {
  return buildGraphExecutionInputText({
    card: event.card,
    routeInfo: event.routeInfo,
    isStart: event.isStart,
    baseInput,
  });
}

export async function executeDeck(
  document: DeckDocument,
  templates: AgentTemplate[],
  options: ExecuteDeckOptions = {},
): Promise<DeckRun> {
  const runId = `deck_run_${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const input = String(options.input || '');
  const validation = validateDeckDocument(document, { enforceStartCard: true });
  const executionPlan = buildExecutionPlan(document);
  const steps: DeckRunStep[] = [];
  const events: DeckRuntimeEvent[] = [];
  const workspaceContext = normalizeWorkspaceContext(options.workspaceContext);
  const workspaceObjectContext = normalizeWorkspaceObjectContext(options.workspaceObjectContext);
  const missionBase = {
    missionRunId: options.missionRunId || null,
    missionAgentRunId: options.missionAgentRunId || null,
  };
  const resolveMissionMeta = (
    runStatus: DeckRun['status'],
    errorText?: string | null,
  ): DeckRun['mission'] => {
    const agentRunStatus: MissionAgentRunStatus | null =
      runStatus === 'success'
        ? 'complete'
        : runStatus === 'running'
          ? 'running'
          : runStatus === 'skipped'
            ? 'skipped'
            : 'failed';
    const missionStatusFromSpecRaw = options.missionSpec?.runState || null;
    const missionStatusFromSpec: MissionRunStatus | null =
      missionStatusFromSpecRaw === 'approved' ||
      missionStatusFromSpecRaw === 'wiring' ||
      missionStatusFromSpecRaw === 'running' ||
      missionStatusFromSpecRaw === 'complete' ||
      missionStatusFromSpecRaw === 'failed' ||
      missionStatusFromSpecRaw === 'cancelled' ||
      missionStatusFromSpecRaw === 'needs_user_input'
        ? missionStatusFromSpecRaw
        : null;
    const missionStatus: MissionRunStatus | null =
      runStatus === 'success'
        ? 'running'
        : runStatus === 'running'
          ? 'running'
          : runStatus === 'skipped'
            ? missionStatusFromSpec
            : 'failed';
    return {
      ...missionBase,
      missionStatus,
      agentRunStatus,
      resultSummary: null,
      needsUserInputReason: null,
      errorReason: errorText || null,
    };
  };
  let latestGraphViewContract: GraphViewContract | null = null;
  const emitRuntimeEvent = (event: Omit<DeckRuntimeEvent, 'id' | 'at'>) => {
    const resolvedGraphViewContract =
      toGraphViewContract(event.graphViewContract || event.codegraphViewContract) ||
      (event.kind === 'run_completed' ? latestGraphViewContract : null);
    const nextEvent: DeckRuntimeEvent = {
      id: `evt_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      ...event,
      ...(resolvedGraphViewContract
        ? {
            graphViewContract: resolvedGraphViewContract,
            codegraphViewContract: resolvedGraphViewContract,
          }
        : {}),
    };
    if (nextEvent.graphViewContract) {
      latestGraphViewContract = nextEvent.graphViewContract;
    }
    events.push(nextEvent);
    options.onRuntimeEvent?.(nextEvent);
  };

  emitRuntimeEvent({
    kind: 'run_started',
    text: `Deck ${document.name} started.`,
    status: 'running',
  });

  if (!validation.ok) {
    emitRuntimeEvent({
      kind: 'run_completed',
      text: 'Deck run failed validation.',
      status: 'error',
    });
    return buildRunSnapshot(
      runId,
      document,
      input,
      startedAt,
      steps,
      events,
      validation,
      executionPlan,
      'error',
      {
        endedAt: new Date().toISOString(),
        error: 'Deck validation failed.',
      },
      workspaceContext,
      workspaceObjectContext,
      resolveMissionMeta('error', 'deck_validation_failed'),
    );
  }

  const nodeMap = getNodeMap(document);
  const runnableNodes = getRunnableNodes(document);
  const agentEdges = getAgentEdges(document);
  const queueStartIds = executionPlan.startCardIds.filter((cardId) => nodeMap.has(cardId));
  const scheduler = createGraphExecutionScheduler({
    nodes: runnableNodes,
    edges: agentEdges,
    startCardIds: queueStartIds,
  });

  if (runnableNodes.length > 0 && queueStartIds.length === 0) {
    emitRuntimeEvent({
      kind: 'run_completed',
      text: 'Deck run failed because no runnable start node was found.',
      status: 'error',
    });
    return buildRunSnapshot(
      runId,
      document,
      input,
      startedAt,
      steps,
      events,
      validation,
      executionPlan,
      'error',
      {
        endedAt: new Date().toISOString(),
        error: 'Graph execution could not find a runnable start node.',
      },
      workspaceContext,
      workspaceObjectContext,
      resolveMissionMeta('error', 'deck_missing_start_node'),
    );
  }

  const successfulCardIds = new Set<string>();

  while (true) {
    const event = scheduler.next();
    if (!event) break;

    if (event.type === 'skipped') {
      const skippedEffectiveAgent =
        resolveEffectiveAgent(event.card, templates) || {
          id: event.card.templateId,
          name: event.card.title,
          tools: [],
        };

      emitRuntimeEvent({
        kind: 'step_skipped',
        cardId: event.card.id,
        cardTitle: event.card.title,
        runtimeType: event.card.runtimeType ?? 'assistant_agent',
        edgeIds: (event.routeInfo.inputSources || []).map((source) => source.edgeId),
        notes: [...(event.routeInfo.notes || [])],
        text: event.reason,
        status: 'skipped',
      });

      steps.push({
        id: `step_${steps.length + 1}`,
        executionId: `${event.card.id}::skipped`,
        cardId: event.card.id,
        templateId: event.card.templateId,
        title: event.card.title,
        input: buildNodeInput(document, event, input),
        runtimeBinding: event.card.runtimeBinding ?? null,
        runtimeType: event.card.runtimeType ?? 'assistant_agent',
        effectiveAgent: skippedEffectiveAgent,
        output: null,
        status: 'skipped',
        error: event.reason,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        inputSummary: event.reason,
        outputSummary: event.reason,
        routeInfo: event.routeInfo,
      });
      continue;
    }

    const card = nodeMap.get(event.card.id);
    if (!isRunnableNode(card) || successfulCardIds.has(card.id)) continue;

    const effectiveAgent = resolveEffectiveAgent(card, templates);
    if (!effectiveAgent) {
      emitRuntimeEvent({
        kind: 'run_completed',
        text: `Deck run failed because template ${card.templateId} could not be resolved.`,
        status: 'error',
      });
      return buildRunSnapshot(
        runId,
        document,
        input,
        startedAt,
        steps,
        events,
        validation,
        executionPlan,
        'error',
        {
          endedAt: new Date().toISOString(),
          error: `Template "${card.templateId}" could not be resolved.`,
        },
        workspaceContext,
        workspaceObjectContext,
        resolveMissionMeta('error', `template_not_resolved:${card.templateId}`),
      );
    }

    const nodeInput = buildNodeInput(document, event, input);
    const activeEdgeIds = (event.routeInfo.inputSources || []).map((source) => source.edgeId);
    emitRuntimeEvent({
      kind: 'step_started',
      cardId: card.id,
      cardTitle: card.title,
      runtimeType: card.runtimeType ?? 'assistant_agent',
      edgeIds: activeEdgeIds,
      notes: [...(event.routeInfo.notes || [])],
      text: `${card.title} started.`,
      status: 'running',
    });
    const cloneSeeds =
      card.cloneConfig?.enabled && Array.isArray(card.cloneConfig.seeds)
        ? card.cloneConfig.seeds.filter(Boolean)
        : [];
    const seeds = cloneSeeds.length > 0 ? cloneSeeds : [undefined];
    const variantOutputs: string[] = [];

    for (let index = 0; index < seeds.length; index += 1) {
      const seed = seeds[index];
      const result = await runCardWithContract(card, effectiveAgent, nodeInput, {
        userInput: nodeInput,
        previousOutput: '',
        promptTemplates: options.promptTemplates,
        seed,
        projectId: options.projectId,
        workspaceContext,
        workspaceObjectContext,
        missionSpec: options.missionSpec,
        missionRunId: options.missionRunId,
        missionAgentRunId: options.missionAgentRunId,
        deckId: document.id,
        deckName: document.name,
        allCards: document.nodes,
        allEdges: document.edges,
        allTemplates: templates,
        onRuntimeEvent: emitRuntimeEvent,
      });

      const step: DeckRunStep = {
        id: `step_${steps.length + 1}`,
        executionId:
          seed != null ? `${card.id}::clone::${index}` : `${card.id}::single`,
        cardId: card.id,
        templateId: card.templateId,
        title: card.title,
        input: nodeInput,
        runtimeBinding: result.runtimeBinding,
        runtimeType: result.runtimeType,
        effectiveAgent,
        output: result.output,
        status: result.status,
        error: result.error,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        seed: result.seed,
        contract: result.contract,
        handshake: result.handshake,
        score: result.score,
        passed: result.passed,
        scoreDetail: result.scoreDetail,
        improvementPromptBit: result.improvementPromptBit,
        inputSummary: result.inputSummary,
        outputSummary: result.outputSummary,
        graphViewContract: toGraphViewContract(result.graphViewContract ?? result.codegraphViewContract),
        codegraphViewContract: toGraphViewContract(result.graphViewContract ?? result.codegraphViewContract),
        structuredPlan: result.structuredPlan ?? null,
        routeInfo: event.routeInfo,
      };
      if (step.graphViewContract) {
        latestGraphViewContract = step.graphViewContract;
      }

      steps.push(step);

      emitRuntimeEvent({
        kind: 'step_completed',
        cardId: card.id,
        cardTitle: card.title,
        runtimeType: result.runtimeType ?? card.runtimeType ?? 'assistant_agent',
        edgeIds: activeEdgeIds,
        text:
          step.status === 'error'
            ? step.error || `${card.title} failed.`
            : `${card.title} completed.`,
        outputSummary: step.outputSummary || null,
        status: step.status,
        graphViewContract: step.graphViewContract ?? null,
        codegraphViewContract: step.graphViewContract ?? null,
      });

      if (step.status === 'error') {
        emitRuntimeEvent({
          kind: 'run_completed',
          text: step.error || `Deck run failed because ${card.title} failed.`,
          status: 'error',
        });
        return buildRunSnapshot(
          runId,
          document,
          input,
          startedAt,
          steps,
          events,
          validation,
          executionPlan,
          'error',
          {
            endedAt: new Date().toISOString(),
            error: step.error || `Card "${card.id}" failed.`,
          },
          workspaceContext,
          workspaceObjectContext,
          resolveMissionMeta('error', step.error || `card_failed:${card.id}`),
        );
      }

      if (step.output) {
        variantOutputs.push(step.output);
      }
    }

    scheduler.markSuccess(card.id, variantOutputs.join('\n\n').trim());
    successfulCardIds.add(card.id);

    if (isPythonAutoGenMagenticCard(card)) {
      emitRuntimeEvent({
        kind: 'run_completed',
        text: `Deck ${document.name} completed.`,
        status: 'success',
      });
      return buildRunSnapshot(
        runId,
        document,
        input,
        startedAt,
        steps,
        events,
        validation,
        executionPlan,
        'success',
        {
          endedAt: new Date().toISOString(),
        },
        workspaceContext,
        workspaceObjectContext,
        resolveMissionMeta('success'),
      );
    }
  }

  const unresolvedNodeIds = scheduler.getUnresolvedNodeIds();
  if (unresolvedNodeIds.length > 0) {
    emitRuntimeEvent({
      kind: 'run_completed',
      text: `Deck run stalled before all runnable nodes completed: ${unresolvedNodeIds.join(', ')}`,
      status: 'error',
    });
    return buildRunSnapshot(
      runId,
      document,
      input,
      startedAt,
      steps,
      events,
      validation,
      executionPlan,
      'error',
      {
        endedAt: new Date().toISOString(),
        error: `Graph execution stalled before all runnable nodes completed: ${unresolvedNodeIds.join(', ')}`,
      },
      workspaceContext,
      workspaceObjectContext,
      resolveMissionMeta('error', 'deck_graph_execution_stalled'),
    );
  }

  emitRuntimeEvent({
    kind: 'run_completed',
    text: `Deck ${document.name} completed.`,
    status: 'success',
  });
  return buildRunSnapshot(
    runId,
    document,
    input,
    startedAt,
    steps,
    events,
    validation,
    executionPlan,
    'success',
    {
      endedAt: new Date().toISOString(),
    },
    workspaceContext,
    workspaceObjectContext,
    resolveMissionMeta('success'),
  );
}
