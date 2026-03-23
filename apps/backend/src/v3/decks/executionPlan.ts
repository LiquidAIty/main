import type { AgentCardInstance, DeckDocument, DeckEdge } from '../types';
import { validateDeckDocument } from './validation';

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
  routeType: DeckEdge['routeType'];
  condition?: string;
  priority: number;
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
  hasConditionalRoutes: boolean;
  issues: string[];
};

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

function edgePriority(edge: DeckEdge): number {
  return typeof edge.priority === 'number' ? edge.priority : 0;
}

function sortRoutes(routes: NextCardRoute[], edgeOrder: Map<string, number>): NextCardRoute[] {
  return [...routes].sort((left, right) => {
    const byPriority = edgePriority(left.edge) - edgePriority(right.edge);
    if (byPriority !== 0) return byPriority;
    return (edgeOrder.get(left.edge.id) || 0) - (edgeOrder.get(right.edge.id) || 0);
  });
}

export function getStartCards(document: DeckDocument): AgentCardInstance[] {
  const validEdges = getValidEdges(document);
  const incomingCounts = new Map<string, number>();

  document.nodes.forEach((node) => incomingCounts.set(node.id, 0));
  validEdges.forEach((edge) => {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) || 0) + 1);
  });

  return document.nodes.filter((node) => (incomingCounts.get(node.id) || 0) === 0);
}

export function getNextCards(document: DeckDocument, cardId: string): NextCardRoute[] {
  const nodeMap = getNodeMap(document);
  const edgeOrder = new Map(document.edges.map((edge, index) => [edge.id, index]));
  const routes = getValidEdges(document)
    .filter((edge) => edge.source === cardId)
    .map((edge) => {
      const nextCard = nodeMap.get(edge.target);
      return nextCard ? { edge, card: nextCard } : null;
    })
    .filter((route): route is NextCardRoute => Boolean(route));

  return sortRoutes(routes, edgeOrder);
}

export function topologicallyOrderSimpleDeck(document: DeckDocument): SimpleDeckOrderResult {
  const issues: string[] = [];
  const validDefaultEdges = getValidEdges(document).filter((edge) => edge.routeType === 'default');
  const nodeMap = getNodeMap(document);
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const documentOrder = new Map(document.nodes.map((node, index) => [node.id, index]));

  document.nodes.forEach((node) => {
    incomingCounts.set(node.id, 0);
    outgoingCounts.set(node.id, 0);
    adjacency.set(node.id, []);
  });

  validDefaultEdges.forEach((edge) => {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) || 0) + 1);
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) || 0) + 1);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) || []), edge.target]);
  });

  document.nodes.forEach((node) => {
    if ((incomingCounts.get(node.id) || 0) > 1) {
      issues.push(`Card "${node.id}" has multiple default inbound routes.`);
    }
    if ((outgoingCounts.get(node.id) || 0) > 1) {
      issues.push(`Card "${node.id}" has multiple default outbound routes.`);
    }
  });

  const queue = document.nodes
    .filter((node) => (incomingCounts.get(node.id) || 0) === 0)
    .sort((left, right) => (documentOrder.get(left.id) || 0) - (documentOrder.get(right.id) || 0))
    .map((node) => node.id);

  const orderedIds: string[] = [];
  const nextIncomingCounts = new Map(incomingCounts);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    orderedIds.push(nodeId);

    (adjacency.get(nodeId) || []).forEach((nextNodeId) => {
      const remaining = (nextIncomingCounts.get(nextNodeId) || 0) - 1;
      nextIncomingCounts.set(nextNodeId, remaining);
      if (remaining === 0) {
        queue.push(nextNodeId);
        queue.sort((left, right) => (documentOrder.get(left) || 0) - (documentOrder.get(right) || 0));
      }
    });
  }

  if (orderedIds.length !== document.nodes.length) {
    issues.push('Simple deck ordering failed because the default-route graph contains a cycle.');
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
  const simpleOrder = topologicallyOrderSimpleDeck(document);
  const orderedCards =
    simpleOrder.orderedCards.length === document.nodes.length ? simpleOrder.orderedCards : document.nodes;

  const cards: ExecutionPlanCard[] = orderedCards.map((card, logicalIndex) => {
    const nextRoutes = getNextCards(document, card.id).map((route) => ({
      edgeId: route.edge.id,
      cardId: route.card.id,
      title: route.card.title,
      routeType: route.edge.routeType,
      condition: route.edge.condition,
      priority: typeof route.edge.priority === 'number' ? route.edge.priority : 0,
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

  return {
    startCardIds: getStartCards(document).map((card) => card.id),
    simpleOrderCardIds: simpleOrder.orderedCardIds,
    cards,
    expandedSteps: cards.flatMap((card) => card.variants),
    hasBranches: cards.some((card) => card.variants.some((variant) => variant.next.length > 1)),
    hasConditionalRoutes: document.edges.some((edge) => edge.routeType === 'conditional'),
    issues: [
      ...validation.errors.map((issue) => issue.message),
      ...validation.warnings.map((issue) => issue.message),
      ...simpleOrder.issues,
    ],
  };
}
