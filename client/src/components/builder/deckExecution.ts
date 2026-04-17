// @graph entity: BuilderDeckExecutionPlan
// @graph role: client-deck-planner
// @graph relates_to: AgentBuilderWorkspace, BuilderCanvas, DeckRuntime
// @graph depends_on: DeckValidation
// @graph feeds_to: AgentBuilderWorkspace
import type { AgentCardInstance, DeckDocument, DeckEdge } from '../../types/agentgraph';
import { validateDeckDocument } from './deckValidation';

export type NextCardRoute = {
  edge: DeckEdge;
  card: AgentCardInstance;
};

export type SimpleDeckOrderResult = {
  ok: boolean;
  orderedCards: AgentCardInstance[];
  orderedCardIds: string[];
  issues: string[];
};

export type ExecutionPlanRoute = {
  edgeId: string;
  cardId: string;
  title: string;
};

export type ExecutionPlanVariant = {
  executionId: string;
  cardId: string;
  title: string;
  templateId: string;
  variantType: 'single' | 'clone';
  variantIndex: number;
  seed?: string;
  next: ExecutionPlanRoute[];
};

export type ExecutionPlanCard = {
  cardId: string;
  title: string;
  templateId: string;
  logicalIndex: number;
  variants: ExecutionPlanVariant[];
};

export type DeckExecutionPlan = {
  startCardIds: string[];
  simpleOrderCardIds: string[];
  cards: ExecutionPlanCard[];
  expandedSteps: ExecutionPlanVariant[];
  hasBranches: boolean;
  issues: string[];
};

function isRunnableNode(node: AgentCardInstance): boolean {
  return !String(node.parentGraphId || '').trim();
}

function getValidEdges(document: DeckDocument): DeckEdge[] {
  const validation = validateDeckDocument(document);
  const invalidEdgeIds = new Set(validation.summary.invalidEdgeIds);
  const duplicateEdgeIds = new Set(validation.summary.duplicateEdgeIds);
  return document.edges.filter(
    (edge) => !invalidEdgeIds.has(edge.id) && !duplicateEdgeIds.has(edge.id),
  );
}

function getNodeMap(document: DeckDocument): Map<string, AgentCardInstance> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}

function getRunnableNodes(document: DeckDocument): AgentCardInstance[] {
  const callableTargets = new Set(
    getValidEdges(document)
      .filter((edge) => edge.edgeType === 'magentic_option')
      .map((edge) => edge.target),
  );
  return document.nodes.filter((node) => isRunnableNode(node) && !callableTargets.has(node.id));
}

function getRunnableEdges(document: DeckDocument): DeckEdge[] {
  const nodeMap = getNodeMap(document);
  return getValidEdges(document).filter((edge) => {
    if (edge.edgeType !== 'flow') return false;
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    return Boolean(source && target && isRunnableNode(source) && isRunnableNode(target));
  });
}

function sortRoutes(routes: NextCardRoute[], edgeOrder: Map<string, number>): NextCardRoute[] {
  return [...routes].sort(
    (left, right) => (edgeOrder.get(left.edge.id) || 0) - (edgeOrder.get(right.edge.id) || 0),
  );
}

export function getStartCards(document: DeckDocument): AgentCardInstance[] {
  const runnableNodes = getRunnableNodes(document);
  const incomingCounts = new Map<string, number>();

  runnableNodes.forEach((node) => incomingCounts.set(node.id, 0));
  getRunnableEdges(document).forEach((edge) => {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) || 0) + 1);
  });

  return runnableNodes.filter((node) => (incomingCounts.get(node.id) || 0) === 0);
}

export function getNextCards(document: DeckDocument, cardId: string): NextCardRoute[] {
  const nodeMap = getNodeMap(document);
  const edgeOrder = new Map(document.edges.map((edge, index) => [edge.id, index]));
  const routes = getRunnableEdges(document)
    .filter((edge) => edge.source === cardId)
    .map((edge) => {
      const nextCard = nodeMap.get(edge.target);
      return nextCard ? { edge, card: nextCard } : null;
    })
    .filter((route): route is NextCardRoute => Boolean(route));

  return sortRoutes(routes, edgeOrder);
}

export function topologicallyOrderSimpleDeck(document: DeckDocument): SimpleDeckOrderResult {
  const runnableNodes = getRunnableNodes(document);
  const runnableEdges = getRunnableEdges(document);
  const nodeMap = getNodeMap(document);
  const documentOrder = new Map(document.nodes.map((node, index) => [node.id, index]));
  const incomingCounts = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const issues: string[] = [];

  runnableNodes.forEach((node) => {
    incomingCounts.set(node.id, 0);
    adjacency.set(node.id, []);
  });

  runnableEdges.forEach((edge) => {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) || 0) + 1);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) || []), edge.target]);
  });

  const queue = runnableNodes
    .filter((node) => (incomingCounts.get(node.id) || 0) === 0)
    .sort((left, right) => (documentOrder.get(left.id) || 0) - (documentOrder.get(right.id) || 0))
    .map((node) => node.id);

  const remainingIncoming = new Map(incomingCounts);
  const orderedIds: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    orderedIds.push(nodeId);

    (adjacency.get(nodeId) || []).forEach((nextNodeId) => {
      const remaining = (remainingIncoming.get(nextNodeId) || 0) - 1;
      remainingIncoming.set(nextNodeId, remaining);
      if (remaining === 0) {
        queue.push(nextNodeId);
        queue.sort(
          (left, right) => (documentOrder.get(left) || 0) - (documentOrder.get(right) || 0),
        );
      }
    });
  }

  if (orderedIds.length !== runnableNodes.length) {
    issues.push('Graph execution order could not resolve all runnable nodes because the graph contains a cycle or unresolved dependency.');
  }

  return {
    ok: issues.length === 0,
    orderedCards: orderedIds.map((nodeId) => nodeMap.get(nodeId)).filter(Boolean) as AgentCardInstance[],
    orderedCardIds: orderedIds,
    issues,
  };
}

export function buildExecutionPlan(document: DeckDocument): DeckExecutionPlan {
  const validation = validateDeckDocument(document, { enforceStartCard: true });
  const graphOrder = topologicallyOrderSimpleDeck(document);
  const orderedCards = graphOrder.orderedCards;
  const runnableEdges = getRunnableEdges(document);

  const cards: ExecutionPlanCard[] = orderedCards.map((card, logicalIndex) => {
    const nextRoutes = getNextCards(document, card.id).map((route) => ({
      edgeId: route.edge.id,
      cardId: route.card.id,
      title: route.card.title,
    }));

    const cloneSeeds =
      card.cloneConfig?.enabled && Array.isArray(card.cloneConfig.seeds)
        ? card.cloneConfig.seeds.filter(Boolean)
        : [];

    const variants: ExecutionPlanVariant[] =
      cloneSeeds.length > 0
        ? cloneSeeds.map((seed, variantIndex) => ({
            executionId: `${card.id}::clone::${variantIndex}`,
            cardId: card.id,
            title: card.title,
            templateId: card.templateId,
            variantType: 'clone',
            variantIndex,
            seed,
            next: nextRoutes,
          }))
        : [
            {
              executionId: `${card.id}::single`,
              cardId: card.id,
              title: card.title,
              templateId: card.templateId,
              variantType: 'single',
              variantIndex: 0,
              next: nextRoutes,
            },
          ];

    return {
      cardId: card.id,
      title: card.title,
      templateId: card.templateId,
      logicalIndex,
      variants,
    };
  });

  const outgoingCounts = new Map<string, number>();
  getRunnableNodes(document).forEach((node) => outgoingCounts.set(node.id, 0));
  runnableEdges.forEach((edge) => {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) || 0) + 1);
  });

  return {
    startCardIds: getStartCards(document).map((card) => card.id),
    simpleOrderCardIds: graphOrder.orderedCardIds,
    cards,
    expandedSteps: cards.flatMap((card) => card.variants),
    hasBranches: Array.from(outgoingCounts.values()).some((count) => count > 1),
    issues: [
      ...validation.errors.map((issue) => issue.message),
      ...validation.warnings.map((issue) => issue.message),
      ...graphOrder.issues,
    ],
  };
}
