// Structural DECK DOCUMENT integrity only. The browser validates the document
// (ids, edge references, duplicates); it never derives execution order, entry
// points, or orchestration — Main is the front door by runtime binding and
// Mag One selects workers off live bus edges. The old start-card/entry-point
// derivation was PlanFlow residue and was removed.
import type {
  DeckDocument,
  DeckEdge,
  DeckEdgeType,
} from '../../types/agentgraph';
import { normalizeDeckEdgeType } from '../../features/agentbuilder/deck/deckPrimitives';

type DeckValidationIssueLevel = 'error' | 'warning';

type DeckValidationIssueCode =
  | 'missing_card_id'
  | 'duplicate_card_id'
  | 'invalid_edge_reference'
  | 'duplicate_edge'
  | 'orphan_card';

type DeckValidationIssue = {
  level: DeckValidationIssueLevel;
  code: DeckValidationIssueCode;
  message: string;
  cardId?: string;
  edgeId?: string;
};

type DeckValidationResult = {
  ok: boolean;
  errors: DeckValidationIssue[];
  warnings: DeckValidationIssue[];
  summary: {
    orphanCardIds: string[];
    invalidEdgeIds: string[];
    duplicateEdgeIds: string[];
  };
};

export function sanitizeDeckEdges(value: unknown): DeckEdge[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (edge): edge is DeckEdge =>
        Boolean(
          edge &&
            typeof edge === 'object' &&
            typeof (edge as DeckEdge).id === 'string' &&
            typeof (edge as DeckEdge).source === 'string' &&
            typeof (edge as DeckEdge).target === 'string',
        ),
    )
    .map((edge) => {
      return {
        id: String(edge.id || '').trim(),
        source: String(edge.source || '').trim(),
        sourceHandle: typeof (edge as DeckEdge).sourceHandle === 'string' ? (edge as DeckEdge).sourceHandle : null,
        target: String(edge.target || '').trim(),
        targetHandle: typeof (edge as DeckEdge).targetHandle === 'string' ? (edge as DeckEdge).targetHandle : null,
        edgeType: normalizeDeckEdgeType((edge as DeckEdge).edgeType),
      };
    })
    .filter((edge) => edge.id && edge.source && edge.target);
}

export function buildDeckEdgeIdentityKey(
  edge: Pick<DeckEdge, 'source' | 'sourceHandle' | 'target' | 'targetHandle' | 'edgeType'>,
): string {
  return [
    String(edge.source || '').trim(),
    String(edge.sourceHandle ?? '').trim(),
    String(edge.target || '').trim(),
    String(edge.targetHandle ?? '').trim(),
    normalizeDeckEdgeType(edge.edgeType),
  ].join('::');
}

export function validateDeckDocument(document: DeckDocument): DeckValidationResult {
  const errors: DeckValidationIssue[] = [];
  const warnings: DeckValidationIssue[] = [];
  const nodeIdSet = new Set<string>();
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
      sourceHandle: edge.sourceHandle,
      target: targetId,
      targetHandle: edge.targetHandle,
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
    connectedCardIds.add(sourceId);
    connectedCardIds.add(targetId);
  });

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

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      orphanCardIds,
      invalidEdgeIds,
      duplicateEdgeIds,
    },
  };
}
