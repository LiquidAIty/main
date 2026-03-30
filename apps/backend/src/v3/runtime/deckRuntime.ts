import { randomUUID } from 'crypto';
import { resolveEffectiveAgent, runCardWithContract } from '../cards/runtime';
import { createEmptyV3Blackboard, normalizeV3Blackboard } from '../blackboard';
import { buildExecutionPlan } from '../decks/executionPlan';
import { validateDeckDocument } from '../decks/validation';
import type {
  AgentCardInstance,
  AgentTemplate,
  DeckDocument,
  DeckEdge,
  DeckRun,
  DeckRunStep,
  PromptTemplate,
  V3Blackboard,
} from '../types';

export type ExecuteDeckOptions = {
  input?: string;
  promptTemplates?: PromptTemplate[];
  blackboard?: V3Blackboard | null;
};

function isBlackboardNode(node: AgentCardInstance | undefined | null): boolean {
  return Boolean(node && node.kind === 'blackboard');
}

function isRunnableNode(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(node && node.kind !== 'blackboard');
}

function createBlackboardWrite(storeWrite: Record<string, string>): V3Blackboard {
  const next = createEmptyV3Blackboard();
  next.store = storeWrite;
  next.updated_at = new Date().toISOString();
  return next;
}

function getNodeMap(document: DeckDocument): Map<string, AgentCardInstance> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}

function getExistingEdges(document: DeckDocument): DeckEdge[] {
  const nodeMap = getNodeMap(document);
  return document.edges.filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target));
}

function getRunnableNodes(document: DeckDocument): AgentCardInstance[] {
  return document.nodes.filter((node) => isRunnableNode(node));
}

function getAgentEdges(document: DeckDocument): DeckEdge[] {
  const nodeMap = getNodeMap(document);
  const directAgentEdges = getExistingEdges(document).filter((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    return isRunnableNode(source) && isRunnableNode(target);
  });

  const derivedEdges: DeckEdge[] = [];
  const seenEdgeKeys = new Set(
    directAgentEdges.map((edge) => `${edge.source}::${edge.target}`),
  );

  document.nodes
    .filter((node) => node.kind === 'blackboard')
    .forEach((blackboardNode) => {
      const inboundWriters = getExistingEdges(document)
        .filter((edge) => edge.target === blackboardNode.id)
        .map((edge) => nodeMap.get(edge.source))
        .filter((node): node is AgentCardInstance => Boolean(node && isRunnableNode(node)));
      const outboundReaders = getExistingEdges(document)
        .filter((edge) => edge.source === blackboardNode.id)
        .map((edge) => nodeMap.get(edge.target))
        .filter((node): node is AgentCardInstance => Boolean(node && isRunnableNode(node)));

      inboundWriters.forEach((writer) => {
        outboundReaders.forEach((reader) => {
          if (writer.id === reader.id) return;
          const edgeKey = `${writer.id}::${reader.id}`;
          if (seenEdgeKeys.has(edgeKey)) return;
          seenEdgeKeys.add(edgeKey);
          derivedEdges.push({
            id: `derived_blackboard_${blackboardNode.id}_${writer.id}_${reader.id}`,
            source: writer.id,
            target: reader.id,
          });
        });
      });
    });

  return [...directAgentEdges, ...derivedEdges];
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

function buildAgentInput(upstreamOutput: string | undefined): string {
  const fullOutput = String(upstreamOutput || '').trim();
  if (!fullOutput) return '';
  return fullOutput;
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
  card: AgentCardInstance,
  baseInput: string,
  cardOutputMap: Map<string, string>,
  blackboard: V3Blackboard,
  startCardIds: Set<string>,
): string {
  const nodeMap = getNodeMap(document);
  const edgeOrder = new Map(document.edges.map((edge, index) => [edge.id, index]));
  const inboundEdges = getExistingEdges(document)
    .filter((edge) => edge.target === card.id)
    .sort((left, right) => (edgeOrder.get(left.id) || 0) - (edgeOrder.get(right.id) || 0));
  const sections: string[] = [];

  if (startCardIds.has(card.id) && baseInput.trim()) {
    sections.push(baseInput.trim());
  }

  inboundEdges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    if (isBlackboardNode(sourceNode)) {
      const blackboardText = buildBlackboardInput(blackboard);
      if (blackboardText) sections.push(blackboardText);
      return;
    }

    const upstreamOutput = cardOutputMap.get(edge.source);
    const upstreamText = buildAgentInput(upstreamOutput);
    if (upstreamText) sections.push(upstreamText);
  });

  return sections.join('\n\n').trim() || baseInput.trim();
}

function writeCardOutputToBlackboard(
  document: DeckDocument,
  card: AgentCardInstance,
  output: string,
  blackboard: V3Blackboard,
): { blackboard: V3Blackboard; blackboardWrite: V3Blackboard | null } {
  const trimmedOutput = String(output || '').trim();
  if (!trimmedOutput) {
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

  const nextBlackboard = normalizeV3Blackboard(blackboard);
  const storeWrite: Record<string, string> = {
    [card.id]: trimmedOutput,
  };

  nextBlackboard.store = {
    ...(nextBlackboard.store || {}),
    ...storeWrite,
  };
  nextBlackboard.updated_at = new Date().toISOString();

  return {
    blackboard: nextBlackboard,
    blackboardWrite: createBlackboardWrite(storeWrite),
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
  const cardOutputMap = new Map<string, string>();
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
  const documentOrder = new Map(document.nodes.map((node, index) => [node.id, index]));
  const startCardIds = new Set(executionPlan.startCardIds);
  const inboundCounts = new Map<string, number>();
  const outgoingTargets = new Map<string, string[]>();

  runnableNodes.forEach((node) => {
    inboundCounts.set(node.id, 0);
    outgoingTargets.set(node.id, []);
  });

  agentEdges.forEach((edge) => {
    inboundCounts.set(edge.target, (inboundCounts.get(edge.target) || 0) + 1);
    outgoingTargets.set(edge.source, [...(outgoingTargets.get(edge.source) || []), edge.target]);
  });

  const queue = executionPlan.startCardIds
    .filter((cardId) => nodeMap.has(cardId))
    .sort((left, right) => (documentOrder.get(left) || 0) - (documentOrder.get(right) || 0));

  if (runnableNodes.length > 0 && queue.length === 0) {
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

  const executedCardIds = new Set<string>();

  while (queue.length > 0) {
    const cardId = queue.shift();
    const card = cardId ? nodeMap.get(cardId) : null;
    if (!isRunnableNode(card) || executedCardIds.has(card.id)) continue;

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

    const nodeInput = buildNodeInput(
      document,
      card,
      input,
      cardOutputMap,
      currentBlackboard,
      startCardIds,
    );
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
      });

      const blackboardUpdate =
        result.status === 'success' && result.output
          ? writeCardOutputToBlackboard(document, card, result.output, currentBlackboard)
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

    cardOutputMap.set(card.id, variantOutputs.join('\n\n').trim());
    executedCardIds.add(card.id);

    (outgoingTargets.get(card.id) || []).forEach((targetId) => {
      const remaining = (inboundCounts.get(targetId) || 0) - 1;
      inboundCounts.set(targetId, remaining);
      if (remaining === 0) {
        queue.push(targetId);
        queue.sort((left, right) => (documentOrder.get(left) || 0) - (documentOrder.get(right) || 0));
      }
    });
  }

  if (executedCardIds.size !== runnableNodes.length) {
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
        error: 'Graph execution stalled before all runnable nodes completed.',
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
