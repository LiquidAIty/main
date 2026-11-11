/**
 * Entity: Agent Builder
 * Relationship: Identifies saved Cards' associated workspaces and derives optional rail visibility from enabled identities and wires without changing execution authority.
 * Entity: Saved Cards
 * Relationship: Requires a live saved connection for optional surfaces; ThinkGraph alone controls the combined Graphs icon.
 */

import type {
  AgentCardInstance,
  DeckDocument,
} from '../../../types/agentgraph';

function isTradingAgentCard(card: AgentCardInstance | null | undefined): boolean {
  return card?.id === 'card_trading_workbench';
}

export function isWorldViewCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  return card?.runtime.kind === 'hermes' && card.runtime.profile === 'worldview';
}

export function cardWorkspace(card: AgentCardInstance): 'worldview' | 'trading' | 'knowledge' | null {
  if (isWorldViewCard(card)) return 'worldview';
  if (isTradingAgentCard(card)) return 'trading';
  if (card.runtime.kind === 'hermes' && ['thinkgraph', 'knowgraph'].includes(card.runtime.profile)) return 'knowledge';
  return null;
}

type ProgressiveRailVisibility = {
  showKnowledge: boolean;
  showWorldview: boolean;
  showTrading: boolean;
};

function hasConnectedEnabledCard(
  deck: Pick<DeckDocument, 'nodes' | 'edges'>,
  predicate: (card: AgentCardInstance) => boolean,
): boolean {
  return deck.nodes.some((node) => (
    node.enabled !== false
    && predicate(node)
    && deck.edges.some((edge) => (
      edge.enabled !== false
      && edge.edgeType !== 'invalid'
      && (edge.source === node.id || edge.target === node.id)
      && deck.nodes.some(other => other.id !== node.id && other.enabled !== false
        && other.id === (edge.source === node.id ? edge.target : edge.source))
    ))
  ));
}

export function deriveVisibleRailItems({
  deck,
}: {
  deck: Pick<DeckDocument, 'nodes' | 'edges'>;
}): ProgressiveRailVisibility {
  return {
    showKnowledge: hasConnectedEnabledCard(deck,
      card => card.runtime.kind === 'hermes' && card.runtime.profile === 'thinkgraph'),
    showWorldview: hasConnectedEnabledCard(deck, isWorldViewCard),
    showTrading: hasConnectedEnabledCard(deck, isTradingAgentCard),
  };
}
