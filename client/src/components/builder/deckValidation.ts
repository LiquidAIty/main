// Structural DECK DOCUMENT integrity only. The browser validates the document
// (ids, edge references, duplicates); it never derives execution order, entry
// points, or orchestration — Main is the front door by runtime binding and
// Mag One selects workers off live bus edges. The old start-card/entry-point
// derivation was PlanFlow residue and was removed.
import type {
  DeckDocument,
  DeckEdge,
  DeckEdgeExecutionMode,
  DeckEdgeMergeIntent,
  DeckEdgeMetadata,
  DeckEdgeRole,
  DeckEdgeType,
} from '../../types/agentgraph';
import { normalizeDeckEdgeType } from '../../features/agentbuilder/deck/deckPrimitives';

export type DeckValidationIssueLevel = 'error' | 'warning';

export type DeckValidationIssueCode =
  | 'missing_card_id'
  | 'duplicate_card_id'
  | 'invalid_edge_reference'
  | 'duplicate_edge'
  | 'orphan_card';

export type DeckValidationIssue = {
  level: DeckValidationIssueLevel;
  code: DeckValidationIssueCode;
  message: string;
  cardId?: string;
  edgeId?: string;
};

export type DeckValidationResult = {
  ok: boolean;
  errors: DeckValidationIssue[];
  warnings: DeckValidationIssue[];
  summary: {
    orphanCardIds: string[];
    invalidEdgeIds: string[];
    duplicateEdgeIds: string[];
  };
};

const EDGE_ROLE_VALUES = new Set<DeckEdgeRole>([
  'graph_execution',
  'callable_route',
  'reconcile_input',
  'compatibility_legacy',
]);

const EDGE_EXECUTION_MODE_VALUES = new Set<DeckEdgeExecutionMode>([
  'required',
  'optional',
  'conditional',
]);

const EDGE_MERGE_INTENT_VALUES = new Set<DeckEdgeMergeIntent>([
  'all_inputs',
  'any_input',
  'first_success',
  'summarize_all',
  'select_best',
  'manual_review',
]);

function cleanOptionalText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function cleanOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function cleanOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function normalizeDeckEdgeMetadata(value: unknown): DeckEdgeMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const normalized: DeckEdgeMetadata = {
    role: EDGE_ROLE_VALUES.has(raw.role as DeckEdgeRole) ? (raw.role as DeckEdgeRole) : null,
    executionMode: EDGE_EXECUTION_MODE_VALUES.has(raw.executionMode as DeckEdgeExecutionMode)
      ? (raw.executionMode as DeckEdgeExecutionMode)
      : null,
    conditionType: cleanOptionalText(raw.conditionType),
    conditionExpression: cleanOptionalText(raw.conditionExpression),
    conditionLabel: cleanOptionalText(raw.conditionLabel),
    priority: cleanOptionalNumber(raw.priority),
    order: cleanOptionalNumber(raw.order),
    weight: cleanOptionalNumber(raw.weight),
    mergeIntent: EDGE_MERGE_INTENT_VALUES.has(raw.mergeIntent as DeckEdgeMergeIntent)
      ? (raw.mergeIntent as DeckEdgeMergeIntent)
      : null,
    legacyCompatibility: cleanOptionalBoolean(raw.legacyCompatibility),
  };
  const hasAnyValue = Object.values(normalized).some((entry) => entry !== null);
  return hasAnyValue ? normalized : null;
}

export function buildDefaultDeckEdgeMetadata(
  edgeType: DeckEdgeType,
  options: { legacyCompatibility?: boolean } = {},
): DeckEdgeMetadata | null {
  return normalizeDeckEdgeMetadata({
    role: edgeType === 'magentic_option' ? 'callable_route' : 'graph_execution',
    executionMode: edgeType === 'flow' ? 'required' : null,
    legacyCompatibility: options.legacyCompatibility === true ? true : null,
  });
}

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
      const metadata = normalizeDeckEdgeMetadata((edge as DeckEdge).metadata);
      return {
        id: String(edge.id || '').trim(),
        source: String(edge.source || '').trim(),
        sourceHandle: typeof (edge as DeckEdge).sourceHandle === 'string' ? (edge as DeckEdge).sourceHandle : null,
        target: String(edge.target || '').trim(),
        targetHandle: typeof (edge as DeckEdge).targetHandle === 'string' ? (edge as DeckEdge).targetHandle : null,
        edgeType: normalizeDeckEdgeType((edge as DeckEdge).edgeType),
        ...(metadata ? { metadata } : {}),
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
