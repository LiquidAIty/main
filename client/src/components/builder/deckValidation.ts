import type { DeckDocument, DeckEdge } from '../../types/agentgraph';

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

function normalizeEdgeCondition(condition: string | undefined): string {
  return String(condition || '').trim().toLowerCase();
}

export function buildDeckEdgeIdentityKey(
  edge: Pick<DeckEdge, 'source' | 'target' | 'routeType' | 'condition'>,
): string {
  return [
    String(edge.source || '').trim(),
    String(edge.target || '').trim(),
    String(edge.routeType || 'default').trim(),
    normalizeEdgeCondition(edge.condition),
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
  });

  const edgeIdentityMap = new Map<string, string>();

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
      routeType: edge.routeType || 'default',
      condition: edge.condition,
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
  });

  const incomingCounts = new Map<string, number>();
  nodeIdSet.forEach((nodeId) => incomingCounts.set(nodeId, 0));
  validEdges.forEach((edge) => {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) || 0) + 1);
  });

  const startCardIds = document.nodes
    .map((node) => String(node.id || '').trim())
    .filter((nodeId) => nodeId && (incomingCounts.get(nodeId) || 0) === 0);

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

  if (options.enforceStartCard && document.nodes.length > 0 && startCardIds.length === 0) {
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
