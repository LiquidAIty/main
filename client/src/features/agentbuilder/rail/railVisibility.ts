// Rail/topology derivation: which product surfaces are visible for the
// current deck (bus connectivity, graph streams, workbench activation).
// Extracted verbatim from pages/agentbuilder.tsx (decomposition pass
// 2026-07-08). Behavior unchanged.
import type {
  AgentCardInstance,
  DeckDocument,
  DeckEdge,
  KnowledgeGraphKind,
} from '../../../types/agentgraph';
import { shouldShowOpenClaudeConsoleRail } from '../console/consoleVisibility';
import {
  normalizeDeckEdgeType,
  normalizeRuntimeType,
  safeText,
} from '../deck/deckPrimitives';

export function isTradingWorkbenchCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim() === 'card_trading_workbench' ||
    safeText(card.templateId).trim() === 'template_trading_workbench'
  );
}

export type WorkbenchSurfaceId = 'trading';

export type WorkbenchCardDescriptor = {
  id: WorkbenchSurfaceId;
  title: string;
  openLabel: string;
  disabledCopy: string;
  matches: (card: AgentCardInstance | null | undefined) => boolean;
};

export const WORKBENCH_CARD_DESCRIPTORS: readonly WorkbenchCardDescriptor[] = [
  {
    id: 'trading',
    title: 'Trading Agent',
    openLabel: 'Open Trading Workspace',
    disabledCopy:
      'Trading is staged as a selectable workbench card. Runtime is disabled until the dedicated trading bridge exists.',
    matches: isTradingWorkbenchCard,
  },
] as const;

export function resolveWorkbenchDescriptor(
  card: AgentCardInstance | null | undefined,
): WorkbenchCardDescriptor | null {
  if (!card) return null;
  return (
    WORKBENCH_CARD_DESCRIPTORS.find((descriptor) => descriptor.matches(card)) ??
    null
  );
}

export function isWorldSignalsAgentCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  const id = safeText(card.id).trim().toLowerCase();
  const templateId = safeText(card.templateId).trim().toLowerCase();
  const title = safeText(card.title).trim().toLowerCase();
  return (
    id === 'card_worldsignals_agent' ||
    templateId === 'template_worldsignals_agent' ||
    title === 'worldsignals agent'
  );
}

export function isThinkGraphSystemCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim().toLowerCase() === 'card_thinkgraph_agent' ||
    safeText(card.runtimeBinding).trim().toLowerCase() === 'thinkgraph_agent'
  );
}

export function isKnowGraphSystemCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  const binding = safeText(card.runtimeBinding).trim().toLowerCase();
  return (
    safeText(card.id).trim().toLowerCase() === 'card_knowgraph_agent' ||
    binding === 'knowgraph_agent' ||
    binding === 'knowgraph'
  );
}

export function isCodeGraphSystemCard(
  card: AgentCardInstance | null | undefined,
): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim().toLowerCase() === 'card_codegraph_agent' ||
    safeText(card.runtimeBinding).trim().toLowerCase() === 'codegraph_agent'
  );
}

export type ProgressiveRailVisibility = {
  showKnowledge: boolean;
  showWorldsignal: boolean;
  showTrading: boolean;
  showOpenClaudeConsole: boolean;
};

export type ConnectedGraphStreams = {
  thinkGraph: boolean;
  knowGraph: boolean;
  codeGraph: boolean;
  anyGraph: boolean;
};

export function buildBusConnectedCardIds(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const busIds = nodes
    .filter((node) => normalizeRuntimeType(node.runtimeType) === 'magentic_one')
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

export function buildFlowAdjacency(edges: readonly DeckEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const connect = (left: string, right: string) => {
    const neighbors = adjacency.get(left) || [];
    neighbors.push(right);
    adjacency.set(left, neighbors);
  };

  for (const edge of edges) {
    if (normalizeDeckEdgeType(edge.edgeType) !== 'flow') continue;
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }

  return adjacency;
}

export function areCardsInSameFlowComponent(
  adjacency: Map<string, string[]>,
  cardIds: readonly string[],
): boolean {
  const [head, ...tail] = cardIds.filter(Boolean);
  if (!head || tail.length === 0) return false;
  const visited = new Set<string>();
  const queue = [head];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) || []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return tail.every((cardId) => visited.has(cardId));
}

export function resolveFirstMatchingCardId(
  nodes: readonly AgentCardInstance[],
  predicate: (card: AgentCardInstance) => boolean,
): string | null {
  return nodes.find(predicate)?.id ?? null;
}

export function isKnowledgeChainActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return deriveConnectedGraphStreams({ nodes: nodes as any, edges: edges as any }).anyGraph;
}

export function deriveConnectedGraphStreams(deck: Pick<DeckDocument, 'nodes' | 'edges'>): ConnectedGraphStreams {
  const busConnected = buildBusConnectedCardIds(deck.nodes, deck.edges);
  const thinkGraph = deck.nodes.some(
    (node) => busConnected.has(node.id) && isThinkGraphSystemCard(node),
  );
  const knowGraph = deck.nodes.some(
    (node) => busConnected.has(node.id) && isKnowGraphSystemCard(node),
  );
  const codeGraph = deck.nodes.some(
    (node) => busConnected.has(node.id) && isCodeGraphSystemCard(node),
  );
  return {
    thinkGraph,
    knowGraph,
    codeGraph,
    anyGraph: thinkGraph || knowGraph || codeGraph,
  };
}

export function isHermesConnectedToMainChat(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  const mainChatIds = new Set(
    nodes
      .filter((node) => safeText(node.runtimeBinding).trim().toLowerCase() === 'main_chat')
      .map((node) => node.id),
  );
  const hermesIds = new Set(
    nodes
      .filter((node) => safeText(node.runtimeBinding).trim().toLowerCase() === 'hermes_steward')
      .map((node) => node.id),
  );
  if (mainChatIds.size === 0 || hermesIds.size === 0) return false;
  return edges.some(
    (edge) =>
      normalizeDeckEdgeType(edge.edgeType) === 'flow' &&
      ((mainChatIds.has(edge.source) && hermesIds.has(edge.target)) ||
        (hermesIds.has(edge.source) && mainChatIds.has(edge.target))),
  );
}

export function getDefaultConnectedKnowledgeGraphKind(
  streams: ConnectedGraphStreams,
): KnowledgeGraphKind {
  if (streams.thinkGraph) return 'thinkgraph';
  return 'codegraph';
}

export function getConnectedKnowledgeGraphKinds(
  streams: ConnectedGraphStreams,
): KnowledgeGraphKind[] {
  const kinds: KnowledgeGraphKind[] = [];
  if (streams.thinkGraph) kinds.push('thinkgraph');
  if (streams.knowGraph) kinds.push('knowgraph');
  if (streams.codeGraph) kinds.push('codegraph');
  return kinds;
}

export function isLegacyKnowledgeChainFullyConnected(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  const thinkGraphId = resolveFirstMatchingCardId(nodes, isThinkGraphSystemCard);
  const knowGraphId = resolveFirstMatchingCardId(nodes, isKnowGraphSystemCard);
  const codeGraphId = resolveFirstMatchingCardId(nodes, isCodeGraphSystemCard);
  if (!thinkGraphId || !knowGraphId || !codeGraphId) return false;

  const busConnected = buildBusConnectedCardIds(nodes, edges);
  if (
    !busConnected.has(thinkGraphId) ||
    !busConnected.has(knowGraphId) ||
    !busConnected.has(codeGraphId)
  ) {
    return false;
  }

  return areCardsInSameFlowComponent(buildFlowAdjacency(edges), [
    thinkGraphId,
    knowGraphId,
    codeGraphId,
  ]);
}

export function isWorldSignalsAgentActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  const busConnected = buildBusConnectedCardIds(nodes, edges);
  return nodes.some(
    (node) => busConnected.has(node.id) && isWorldSignalsAgentCard(node),
  );
}

export function isTradingWorkbenchActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
): boolean {
  return isWorkbenchSurfaceActive(nodes, edges, isTradingWorkbenchCard);
}

export function isWorkbenchSurfaceActive(
  nodes: readonly AgentCardInstance[],
  edges: readonly DeckEdge[],
  predicate: (card: AgentCardInstance | null | undefined) => boolean,
): boolean {
  const busConnected = buildBusConnectedCardIds(nodes, edges);
  return nodes.some(
    (node) => busConnected.has(node.id) && predicate(node),
  );
}

export function deriveVisibleRailItems({
  deck,
  workspaceView,
}: {
  deck: Pick<DeckDocument, 'nodes' | 'edges'>;
  workspaceView: string;
}): ProgressiveRailVisibility {
  const hermesConnectedToMainChat = isHermesConnectedToMainChat(deck.nodes, deck.edges);
  return {
    // Graphs are Hermes's canvas. The launcher is present only while Hermes is
    // actually connected to Main Chat; graph data may still be empty/unseeded.
    showKnowledge: hermesConnectedToMainChat,
    showWorldsignal:
      workspaceView === 'worldsignal' ||
      isWorldSignalsAgentActive(deck.nodes, deck.edges),
    showTrading:
      workspaceView === 'trading' ||
      isTradingWorkbenchActive(deck.nodes, deck.edges),
    showOpenClaudeConsole: shouldShowOpenClaudeConsoleRail({
      cards: deck.nodes,
      edges: deck.edges,
    }),
  };
}

// The old "activation proposal" system (a deterministic keyword classifier
// over user text) was dead plumbing: its detector had zero callers, its state
// was only ever reset to null, and deriveVisibleRailItems ignored it. Removed
// whole — banned pattern (regex intent-routing) with zero live function.
