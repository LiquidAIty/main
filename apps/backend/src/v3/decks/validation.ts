import type { AgentCardInstance, DeckDocument, DeckEdge, DeckEdgeType } from '../types';

export type DeckValidationIssueLevel = 'error' | 'warning';

export type DeckValidationIssueCode =
  | 'missing_card_id'
  | 'duplicate_card_id'
  | 'invalid_edge_reference'
  | 'duplicate_edge'
  | 'orphan_card'
  | 'missing_start_card';

export type DeckValidationIssue = {
  level: DeckValidationIssueLevel;
  code: DeckValidationIssueCode;
  message: string;
  cardId?: string;
  edgeId?: string;
};

export type DeckValidationOptions = {
  enforceStartCard?: boolean;
};

export type DeckValidationResult = {
  ok: boolean;
  errors: DeckValidationIssue[];
  warnings: DeckValidationIssue[];
  summary: {
    startCardIds: string[];
    orphanCardIds: string[];
    invalidEdgeIds: string[];
    duplicateEdgeIds: string[];
  };
};

function isRunnableNode(node: AgentCardInstance | undefined | null): boolean {
  return Boolean(node && node.kind !== 'blackboard' && !String(node.parentGraphId || '').trim());
}

function normalizeEdgeType(value: unknown): DeckEdgeType {
  return String(value || '').trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'graph_flow';
}

export function buildDeckEdgeIdentityKey(
  edge: Pick<DeckEdge, 'source' | 'target' | 'edgeType'>,
): string {
  return [
    String(edge.source || '').trim(),
    String(edge.target || '').trim(),
    normalizeEdgeType(edge.edgeType),
  ].join('::');
}

export function validateDeckDocument(
  document: DeckDocument,
  options: DeckValidationOptions = {},
): DeckValidationResult {
  const errors: DeckValidationIssue[] = [];
  const warnings: DeckValidationIssue[] = [];
  const nodeIdSet = new Set<string>();
  const validEdges: DeckEdge[] = [];
  const invalidEdgeIds: string[] = [];
  const duplicateEdgeIds: string[] = [];
  const connectedCardIds = new Set<string>();
  const nodeMap = new Map<string, AgentCardInstance>();

  document.nodes.forEach((node) => {
    const nodeId = String(node.id || '').trim();
    if (!nodeId) {
      errors.push({
        level: 'error',
        code: 'missing_card_id',
        message: 'Card is missing a stable id.',
      });
      return;
    }
    if (nodeIdSet.has(nodeId)) {
      errors.push({
        level: 'error',
        code: 'duplicate_card_id',
        message: `Duplicate card id "${nodeId}" detected.`,
        cardId: nodeId,
      });
      return;
    }
    nodeIdSet.add(nodeId);
    nodeMap.set(nodeId, node);
  });

  const edgeIdentityMap = new Map<string, string>();
  const incomingMagenticTargets = new Set<string>();

  document.edges.forEach((edge) => {
    const sourceId = String(edge.source || '').trim();
    const targetId = String(edge.target || '').trim();
    if (!sourceId || !targetId || !nodeIdSet.has(sourceId) || !nodeIdSet.has(targetId)) {
      errors.push({
        level: 'error',
        code: 'invalid_edge_reference',
        message: `Edge "${edge.id}" references a missing source or target card.`,
        edgeId: edge.id,
      });
      invalidEdgeIds.push(edge.id);
      return;
    }

    const edgeKey = buildDeckEdgeIdentityKey({
      source: sourceId,
      target: targetId,
      edgeType: edge.edgeType,
    });

    if (edgeIdentityMap.has(edgeKey)) {
      warnings.push({
        level: 'warning',
        code: 'duplicate_edge',
        message: `Duplicate edge "${edge.id}" matches "${edgeIdentityMap.get(edgeKey)}".`,
        edgeId: edge.id,
      });
      duplicateEdgeIds.push(edge.id);
      return;
    }

    edgeIdentityMap.set(edgeKey, edge.id);
    validEdges.push(edge);
    connectedCardIds.add(sourceId);
    connectedCardIds.add(targetId);
    if (normalizeEdgeType(edge.edgeType) === 'magentic_option') {
      incomingMagenticTargets.add(targetId);
    }
  });

  const incomingCounts = new Map<string, number>();
  document.nodes
    .filter((node) => isRunnableNode(node))
    .forEach((node) => incomingCounts.set(node.id, 0));
  validEdges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!isRunnableNode(sourceNode) || !isRunnableNode(targetNode)) return;
    if (normalizeEdgeType(edge.edgeType) !== 'graph_flow') return;
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) || 0) + 1);
  });

  const startCardIds = document.nodes
    .filter((node) => isRunnableNode(node))
    .map((node) => String(node.id || '').trim())
    .filter(
      (nodeId) =>
        nodeId &&
        (incomingCounts.get(nodeId) || 0) === 0 &&
        !incomingMagenticTargets.has(nodeId),
    );

  const orphanCardIds = document.nodes
    .map((node) => String(node.id || '').trim())
    .filter((nodeId) => nodeId && !connectedCardIds.has(nodeId));

  orphanCardIds.forEach((cardId) => {
    warnings.push({
      level: 'warning',
      code: 'orphan_card',
      message: `Card "${cardId}" is disconnected from the deck.`,
      cardId,
    });
  });

  const runnableNodeCount = document.nodes.filter((node) => isRunnableNode(node)).length;
  if (options.enforceStartCard && runnableNodeCount > 0 && startCardIds.length === 0) {
    errors.push({
      level: 'error',
      code: 'missing_start_card',
      message: 'No entry/start card was found for this deck.',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      startCardIds,
      orphanCardIds,
      invalidEdgeIds,
      duplicateEdgeIds,
    },
  };
}
