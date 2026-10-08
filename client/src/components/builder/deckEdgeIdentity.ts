// Stable edge identity for Canvas duplicate detection. It does not validate a
// whole deck, derive execution order, or own topology.
import type {
  DeckEdge,
} from '../../types/agentgraph';
import { normalizeDeckEdgeType } from '../../features/agentbuilder/deck/deckPrimitives';

export function buildDeckEdgeIdentityKey(
  edge: Pick<DeckEdge, 'source' | 'sourceHandle' | 'target' | 'targetHandle' | 'edgeType'>,
): string {
  const edgeType = normalizeDeckEdgeType(edge.edgeType);
  const endpoints = [String(edge.source || '').trim(), String(edge.target || '').trim()];
  if (edgeType === 'magentic_option') {
    return JSON.stringify([edgeType, ...endpoints.sort()]);
  }
  return JSON.stringify([edgeType, ...endpoints]);
}
