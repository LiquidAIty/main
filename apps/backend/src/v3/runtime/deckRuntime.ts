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
  DeckDocument,
  DeckEdge,
  DeckEdgeType,
  DeckRun,
  DeckRuntimeEvent,
  DeckRunStep,
  PromptTemplate,
} from '../types';

// Visible graph edges are the execution truth. Higher-level planning must compile into this runtime, not bypass it.
export type ExecuteDeckOptions = {
  input?: string;
  promptTemplates?: PromptTemplate[];
  projectId?: string;
  onRuntimeEvent?: (event: DeckRuntimeEvent) => void;
};

function isRunnableNode(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(node && node.kind === 'agent' && !String(node.parentGraphId || '').trim());
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
): DeckRun {
  return {
    id: runId,
    deckId: document.id,
    startedAt,
    endedAt: extra?.endedAt,
    status,
    input,
    error: extra?.error,
    steps,
    events,
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
  const emitRuntimeEvent = (event: Omit<DeckRuntimeEvent, 'id' | 'at'>) => {
    const nextEvent: DeckRuntimeEvent = {
      id: `evt_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      ...event,
    };
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
        routeInfo: event.routeInfo,
      };

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
        );
      }

      if (step.output) {
        variantOutputs.push(step.output);
      }
    }

    scheduler.markSuccess(card.id, variantOutputs.join('\n\n').trim());
    successfulCardIds.add(card.id);
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
  );
}
