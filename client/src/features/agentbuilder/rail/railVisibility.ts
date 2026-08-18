// Rail/topology derivation: which product surfaces are visible for the
// current deck (bus connectivity, graph streams, workbench activation).
// Extracted verbatim from pages/agentbuilder.tsx (decomposition pass
// 2026-07-08). Behavior unchanged.
import type {
  AgentCardInstance,
  DeckDocument,
  DeckEdge,
} from '../../../types/agentgraph';
import {
  normalizeDeckEdgeType,
} from '../deck/deckPrimitives';

function isTradingAgentCard(card: AgentCardInstance | null | undefined): boolean {
  return card?.id === 'card_trading_workbench';
}

export function isHermesStewardCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  return Boolean(card?.runtime.kind === 'hermes' && card.runtime.mode === 'kanban');
}

export function isWorldSignalsAgentCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  return card?.id === 'card_worldsignals_agent';
}

type ProgressiveRailVisibility = {
  showKnowledge: boolean;
  showWorldsignal: boolean;
  showTrading: boolean;
  showHermesKanban: boolean;
};

function buildBusConnectedCardIds(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const busIds = nodes
    .filter((node) => node.runtime.kind === 'autogen' && node.runtime.mode === 'magentic_one')
    .map((node) => node.id);
  if (busIds.length === 0) return new Set<string>();

  const adjacency = new Map<string, string[]>();
  const connect = (left: string, right: string) => {
    const neighbors = adjacency.get(left) || [];
    neighbors.push(right);
    adjacency.set(left, neighbors);
  };

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const edgeType = normalizeDeckEdgeType(edge.edgeType);
    if (edgeType !== 'magentic_option' && edgeType !== 'flow') continue;
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }

  const connected = new Set<string>();
  const queue = [...busIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (connected.has(current)) continue;
    connected.add(current);
    for (const neighbor of adjacency.get(current) || []) {
      if (!connected.has(neighbor)) queue.push(neighbor);
    }
  }

  return connected;
}

export function hasDirectedCardConnection(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
  sourcePredicate: (card: AgentCardInstance) => boolean,
  targetPredicate: (card: AgentCardInstance) => boolean,
): boolean {
  const sourceIds = new Set(nodes.filter(sourcePredicate).map((node) => node.id));
  const targetIds = new Set(nodes.filter(targetPredicate).map((node) => node.id));
  if (sourceIds.size === 0 || targetIds.size === 0) return false;
  return edges.some(
    (edge) =>
      normalizeDeckEdgeType(edge.edgeType) === 'flow' &&
      sourceIds.has(edge.source) &&
      targetIds.has(edge.target),
  );
}

/** A card's surface is reachable when the card is bus-connected — bus
 * connectivity is the only activation signal (PLAN.md §4). */
function isBusConnectedCard(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
  predicate: (card: AgentCardInstance) => boolean,
): boolean {
  const busConnected = buildBusConnectedCardIds(nodes, edges);
  return nodes.some((node) => busConnected.has(node.id) && predicate(node));
}

export function deriveVisibleRailItems({
  deck,
  workspaceView,
}: {
  deck: Pick<DeckDocument, 'nodes' | 'edges'>;
  workspaceView: string;
}): ProgressiveRailVisibility {
  return {
    // Project graphs are an owner-visible workbench, not a card-topology capability.
    showKnowledge: true,
    showWorldsignal:
      workspaceView === 'worldsignal' ||
      isBusConnectedCard(deck.nodes, deck.edges, isWorldSignalsAgentCard),
    showTrading:
      workspaceView === 'trading' ||
      isBusConnectedCard(deck.nodes, deck.edges, isTradingAgentCard),
    showHermesKanban:
      workspaceView === 'hermes' ||
      hasDirectedCardConnection(
        deck.nodes,
        deck.edges,
        (card) => card.runtime.kind === 'hermes' && card.runtime.mode === 'main',
        (card) => card.runtime.kind === 'hermes' && card.runtime.mode === 'kanban',
      ),
  };
}

// The old "activation proposal" system (a deterministic keyword classifier
// over user text) was dead plumbing: its detector had zero callers, its state
// was only ever reset to null, and deriveVisibleRailItems ignored it. Removed
// whole — banned pattern (regex intent-routing) with zero live function.
