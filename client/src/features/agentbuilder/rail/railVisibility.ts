/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Agent Builder
 * Relationship: Derives optional rail visibility from enabled saved Card identities and their enabled wires without changing execution authority.
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

export function isWorldSignalsAgentCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  return card?.id === 'card_worldsignals_agent';
}

export function isWorldViewCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  return card?.runtime.kind === 'hermes' && card.runtime.profile === 'worldview';
}

type ProgressiveRailVisibility = {
  showKnowledge: boolean;
  showWorldsignal: boolean;
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
    showWorldsignal: hasConnectedEnabledCard(deck, isWorldSignalsAgentCard),
    showWorldview: hasConnectedEnabledCard(deck, isWorldViewCard),
    showTrading: hasConnectedEnabledCard(deck, isTradingAgentCard),
  };
}
