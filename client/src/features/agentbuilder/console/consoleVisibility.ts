/**
 * Pure rules for when the OpenClaude Console terminal rail icon is shown.
 *
 * The terminal icon appears when Local Coder is currently connected to the
 * Magentic bus (an eligible coding participant) OR an OpenClaude console
 * session already exists. It does NOT replace the Local Coder canvas card —
 * Local Coder remains a normal card; this is an additional terminal surface.
 */

import {
  resolveBusConnections,
  type ResolverCardInput,
  type ResolverEdgeInput,
} from '../../../runtime/agentCardRegistryResolver';

function isLocalCoderCard(card: ResolverCardInput): boolean {
  const rt = String(card.runtimeType || '').trim().toLowerCase();
  const rb = String(card.runtimeBinding || '').trim().toLowerCase();
  const id = String(card.id || '').trim().toLowerCase();
  return rt === 'local_coder' || rb === 'local_coder' || id === 'card_local_coder';
}

export function isLocalCoderBusConnected(
  cards: readonly ResolverCardInput[],
  edges: readonly ResolverEdgeInput[],
): boolean {
  const connections = resolveBusConnections(cards, edges);
  return cards.some(
    (card) =>
      isLocalCoderCard(card) && (connections.get(card.id) ?? 'disconnected') !== 'disconnected',
  );
}

export function shouldShowOpenClaudeConsoleRail(args: {
  cards: readonly ResolverCardInput[];
  edges: readonly ResolverEdgeInput[];
  hasSession?: boolean;
}): boolean {
  if (args.hasSession) return true;
  return isLocalCoderBusConnected(args.cards, args.edges);
}
