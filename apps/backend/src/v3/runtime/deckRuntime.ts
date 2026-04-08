import { randomUUID } from 'crypto';
import { resolveEffectiveAgent, runCardWithContract } from '../cards/runtime';
import { createEmptyV3Blackboard, mergeV3Blackboard, normalizeV3Blackboard } from '../blackboard';
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
  DeckRunStep,
  PromptTemplate,
  V3Blackboard,
} from '../types';

// Visible graph edges are the execution truth. Higher-level planning must compile into this runtime, not bypass it.
export type ExecuteDeckOptions = {
  input?: string;
  promptTemplates?: PromptTemplate[];
  blackboard?: V3Blackboard | null;
  projectId?: string;
};

function isBlackboardNode(node: AgentCardInstance | undefined | null): boolean {
  return Boolean(node && node.kind === 'blackboard');
}

function isRunnableNode(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(node && node.kind !== 'blackboard' && !String(node.parentGraphId || '').trim());
}

function normalizeEdgeType(value: unknown): DeckEdgeType {
  return String(value || '').trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'graph_flow';
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
    if (normalizeEdgeType(edge.edgeType) !== 'graph_flow') return false;
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
  validation: ReturnType<typeof validateDeckDocument>,
  executionPlan: ReturnType<typeof buildExecutionPlan>,
  blackboard: V3Blackboard,
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
    blackboard,
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

function buildBlackboardInput(blackboard: V3Blackboard): string {
  const storeEntries = Object.entries(blackboard.store || {}).filter(([, value]) =>
    Boolean(String(value || '').trim()),
  );

  if (storeEntries.length === 0) return '';
  return storeEntries.map(([key, value]) => `${key}:\n${value}`).join('\n\n').trim();
}

function buildNodeInput(
  document: DeckDocument,
  event: {
    card: AgentCardInstance;
    isStart: boolean;
    routeInfo: GraphExecutionRouteInfo;
  },
  baseInput: string,
  blackboard: V3Blackboard,
): string {
  const nodeMap = getNodeMap(document);
  const inboundEdges = getExistingEdges(document)
    .filter((edge) => edge.target === event.card.id && normalizeEdgeType(edge.edgeType) === 'graph_flow');
  const hasBlackboardInput = inboundEdges.some((edge) => isBlackboardNode(nodeMap.get(edge.source)));

  return buildGraphExecutionInputText({
    card: event.card,
    routeInfo: event.routeInfo,
    isStart: event.isStart,
    baseInput,
    blackboardInput: hasBlackboardInput ? buildBlackboardInput(blackboard) : '',
  });
}

function writeCardOutputToBlackboard(
  document: DeckDocument,
  card: AgentCardInstance,
  output: string,
  explicitWrite: V3Blackboard | null | undefined,
  blackboard: V3Blackboard,
): { blackboard: V3Blackboard; blackboardWrite: V3Blackboard | null } {
  const trimmedOutput = String(output || '').trim();
  const explicitBlackboard = normalizeV3Blackboard(explicitWrite);
  const hasExplicitWrite = Boolean(
    explicitBlackboard.current_goal ||
      explicitBlackboard.next_move ||
      explicitBlackboard.what_matters_now.length ||
      explicitBlackboard.open_questions.length ||
      explicitBlackboard.findings.length ||
      explicitBlackboard.suggestions.length ||
      explicitBlackboard.next_options.length ||
      Object.keys(explicitBlackboard.store || {}).length,
  );

  if (!trimmedOutput && !hasExplicitWrite) {
    return { blackboard, blackboardWrite: null };
  }

  const nodeMap = getNodeMap(document);
  const outgoingToBlackboard = getExistingEdges(document).filter((edge) => {
    if (edge.source !== card.id) return false;
    return isBlackboardNode(nodeMap.get(edge.target));
  });

  if (outgoingToBlackboard.length === 0) {
    return { blackboard, blackboardWrite: null };
  }

  let nextBlackboard = normalizeV3Blackboard(blackboard);
  if (hasExplicitWrite) {
    nextBlackboard = mergeV3Blackboard(nextBlackboard, explicitBlackboard);
  }
  let blackboardWrite = hasExplicitWrite ? normalizeV3Blackboard(explicitBlackboard) : createEmptyV3Blackboard();

  if (trimmedOutput) {
    const storeWrite: Record<string, string> = {
      [card.id]: trimmedOutput,
    };
    nextBlackboard.store = {
      ...(nextBlackboard.store || {}),
      ...storeWrite,
    };
    nextBlackboard.updated_at = new Date().toISOString();
    blackboardWrite = normalizeV3Blackboard({
      ...blackboardWrite,
      store: {
        ...(blackboardWrite.store || {}),
        ...storeWrite,
      },
      updated_at: nextBlackboard.updated_at,
    });
  }

  return {
    blackboard: nextBlackboard,
    blackboardWrite,
  };
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
  let currentBlackboard = normalizeV3Blackboard(options.blackboard || createEmptyV3Blackboard());

  if (!validation.ok) {
    return buildRunSnapshot(
      runId,
      document,
      input,
      startedAt,
      steps,
      validation,
      executionPlan,
      currentBlackboard,
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
    return buildRunSnapshot(
      runId,
      document,
      input,
      startedAt,
      steps,
      validation,
      executionPlan,
      currentBlackboard,
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

      steps.push({
        id: `step_${steps.length + 1}`,
        executionId: `${event.card.id}::skipped`,
        cardId: event.card.id,
        templateId: event.card.templateId,
        title: event.card.title,
        input: buildNodeInput(document, event, input, currentBlackboard),
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
        blackboardWrite: null,
        blackboard: currentBlackboard,
        routeInfo: event.routeInfo,
      });
      continue;
    }

    const card = nodeMap.get(event.card.id);
    if (!isRunnableNode(card) || successfulCardIds.has(card.id)) continue;

    const effectiveAgent = resolveEffectiveAgent(card, templates);
    if (!effectiveAgent) {
      return buildRunSnapshot(
        runId,
        document,
        input,
        startedAt,
        steps,
        validation,
        executionPlan,
        currentBlackboard,
        'error',
        {
          endedAt: new Date().toISOString(),
          error: `Template "${card.templateId}" could not be resolved.`,
        },
      );
    }

    const nodeInput = buildNodeInput(document, event, input, currentBlackboard);
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
        blackboard: currentBlackboard,
        projectId: options.projectId,
        deckId: document.id,
        deckName: document.name,
        allCards: document.nodes,
        allEdges: document.edges,
        allTemplates: templates,
      });

      const blackboardUpdate =
        result.status === 'success' && (result.output || result.blackboardWrite)
          ? writeCardOutputToBlackboard(
              document,
              card,
              result.output || '',
              result.blackboardWrite,
              currentBlackboard,
            )
          : { blackboard: currentBlackboard, blackboardWrite: null };
      currentBlackboard = normalizeV3Blackboard(blackboardUpdate.blackboard);

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
        blackboardWrite: blackboardUpdate.blackboardWrite,
        blackboard: currentBlackboard,
        routeInfo: event.routeInfo,
      };

      steps.push(step);

      if (step.status === 'error') {
        return buildRunSnapshot(
          runId,
          document,
          input,
          startedAt,
          steps,
          validation,
          executionPlan,
          currentBlackboard,
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

    scheduler.markSuccess(card.id, variantOutputs.join('\n\n').trim(), currentBlackboard);
    successfulCardIds.add(card.id);
  }

  const unresolvedNodeIds = scheduler.getUnresolvedNodeIds();
  if (unresolvedNodeIds.length > 0) {
    return buildRunSnapshot(
      runId,
      document,
      input,
      startedAt,
      steps,
      validation,
      executionPlan,
      currentBlackboard,
      'error',
      {
        endedAt: new Date().toISOString(),
        error: `Graph execution stalled before all runnable nodes completed: ${unresolvedNodeIds.join(', ')}`,
      },
    );
  }

  return buildRunSnapshot(
    runId,
    document,
    input,
    startedAt,
    steps,
    validation,
    executionPlan,
    currentBlackboard,
    'success',
    {
      endedAt: new Date().toISOString(),
    },
  );
}
