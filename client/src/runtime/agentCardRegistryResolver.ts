/**
 * Agent Card Registry Resolver — Phase 1B
 *
 * Read-only functions that classify existing AgentCardInstance objects
 * against the Agent Card Registry. Also interprets existing DeckEdge
 * edgeType values as bus connection semantics — a UI-only lens.
 *
 * Rules:
 * - Never mutates cards or edges.
 * - Never creates new DeckEdgeType values.
 * - Returns undefined when a card cannot be confidently mapped.
 * - Nothing imports this file in production yet.
 */

import { AGENT_CARD_REGISTRY, type AgentCardDef } from './agentCardRegistry';

// ── Minimal shape contracts ────────────────────────────────────────
// We use Pick-style types instead of importing from agentgraph.ts so
// this file has zero coupling to production types. Any object with the
// right shape works, including test mocks.

/** Minimal card shape the resolver reads from. */
export type ResolverCardInput = {
  id: string;
  runtimeType?: string | null;
  runtimeBinding?: string | null;
  templateId?: string;
  title?: string;
};

/** Minimal edge shape the resolver reads from. */
export type ResolverEdgeInput = {
  id: string;
  source: string;
  target: string;
  edgeType?: string | null;
};

// ── Bus connection semantic ────────────────────────────────────────

/**
 * How a card relates to the bus in the UI.
 * Derived from existing edgeType values — no new DeckEdgeType created.
 */
export type BusConnection =
  | 'orchestrator'  // IS the bus (Sol / Magentic-One)
  | 'orchestrated'  // Direct magentic_option edge target from Sol
  | 'delegated'     // Flow edge downstream from an orchestrated card
  | 'disconnected'; // No bus edge path

// ── Resolution result ──────────────────────────────────────────────

export type ResolvedCard = {
  /** Registry definition, or undefined if no confident match. */
  def: AgentCardDef | undefined;
  /** Bus connection semantic. */
  busConnection: BusConnection;
};

// ── Card → Registry resolution ────────────────────────────────────

/**
 * Resolve a deck card to its registry definition.
 *
 * Resolution strategy (first match wins):
 * 1. runtimeType === 'magentic_one' → sol
 * 2. runtimeType === 'local_coder'  → code
 * 3. runtimeBinding match against known binding→id map
 * 4. Otherwise → undefined (unknown card, no guessing)
 */
export function resolveCardDef(card: ResolverCardInput): AgentCardDef | undefined {
  const rt = normalize(card.runtimeType);
  const rb = normalize(card.runtimeBinding);

  // 1. Unique runtimeType matches
  if (rt === 'magentic_one') return findDef('sol');
  if (rt === 'local_coder') return findDef('code');

  // 2. runtimeBinding discrimination for assistant_agent cards
  if (rb) {
    const defId = BINDING_TO_REGISTRY_ID[rb];
    if (defId) return findDef(defId);
  }

  const stagedDefId = resolveStagedCardDefId(card);
  if (stagedDefId) {
    return findDef(stagedDefId);
  }

  // 3. No confident match
  return undefined;
}

function resolveStagedCardDefId(
  card: ResolverCardInput,
): string | undefined {
  const templateId = normalize(card.templateId);
  const id = normalize(card.id);
  const title = normalize(card.title);

  if (
    templateId === 'template_plan_agent' ||
    id === 'card_plan_agent' ||
    title === 'plan agent'
  ) {
    return 'plan';
  }

  if (
    templateId === 'template_worldsignals_agent' ||
    id === 'card_worldsignals_agent' ||
    title === 'worldsignals agent'
  ) {
    return 'worldsignals';
  }

  if (
    templateId === 'template_energy_workbench' ||
    id === 'card_energy_workbench' ||
    title === 'nrgsim / energy'
  ) {
    return 'energy';
  }

  if (
    templateId === 'template_trading_workbench' ||
    id === 'card_trading_workbench' ||
    title === 'trading agent'
  ) {
    return 'trading';
  }

  if (
    templateId === 'template_image_workbench' ||
    id === 'card_image_workbench' ||
    title === 'image maker agent'
  ) {
    return 'image';
  }

  if (
    templateId === 'template_code_workbench' ||
    id === 'card_code_workbench' ||
    title === 'code agent'
  ) {
    return 'code';
  }

  if (
    templateId === 'template_video_workbench' ||
    id === 'card_video_workbench' ||
    title === 'video agent'
  ) {
    return 'video';
  }

  return undefined;
}

/**
 * Known runtimeBinding → registry id mapping.
 *
 * Covers both current and legacy card bindings.
 * Cards whose runtimeBinding maps to the same registry agent are
 * grouped together (e.g. thinkgraph_agent and kg_ingest both map
 * to plan, because ThinkGraph is the planning memory agent).
 *
 * Cards like main_chat, neo4j have no registry equivalent — they
 * are internal runtime workers, not user-facing capabilities.
 */
const BINDING_TO_REGISTRY_ID: Record<string, string> = {
  assist: 'assist',
  plan_agent: 'plan',
  worldsignals_agent: 'worldsignals',
  telescope_agent: 'telescope',
  energy_agent: 'energy',
  trading_agent: 'trading',
  image_agent: 'image',
  code_agent: 'code',
  video_agent: 'video',

  // Plan Agent — ThinkGraph is the planning memory
  thinkgraph_agent: 'plan',
  kg_ingest: 'plan',

  // Knowledge Agent — KnowGraph + CodeGraph + Research
  knowgraph_agent: 'knowledge',
  knowgraph: 'knowledge',
  codegraph_agent: 'knowledge',
  research_agent: 'knowledge',
};

// ── Bus connection resolution ──────────────────────────────────────

/**
 * Resolve bus connections for all cards given a set of edges.
 * Returns a Map from card id to BusConnection.
 *
 * Rules:
 * - Card with runtimeType 'magentic_one' → 'orchestrator'
 * - Card that is the target of a magentic_option edge from Sol → 'orchestrated'
 * - Card that is the target of a flow edge from an orchestrated card → 'delegated'
 * - Everything else → 'disconnected'
 *
 * Delegation propagates: if A is orchestrated and A→B is flow, B is
 * delegated. If B→C is also flow, C is also delegated.
 */
export function resolveBusConnections(
  cards: readonly ResolverCardInput[],
  edges: readonly ResolverEdgeInput[],
): Map<string, BusConnection> {
  const result = new Map<string, BusConnection>();

  // Initialize all cards as disconnected
  for (const card of cards) {
    result.set(card.id, 'disconnected');
  }

  // Find Sol (the orchestrator)
  const solIds = new Set<string>();
  for (const card of cards) {
    if (normalize(card.runtimeType) === 'magentic_one') {
      result.set(card.id, 'orchestrator');
      solIds.add(card.id);
    }
  }

  // Mark orchestrated cards (magentic_option targets from Sol)
  const orchestratedIds = new Set<string>();
  for (const edge of edges) {
    if (
      normalize(edge.edgeType) === 'magentic_option' &&
      solIds.has(edge.source) &&
      result.has(edge.target)
    ) {
      result.set(edge.target, 'orchestrated');
      orchestratedIds.add(edge.target);
    }
  }

  // Build flow adjacency for delegation propagation
  const flowTargets = new Map<string, string[]>();
  for (const edge of edges) {
    if (normalize(edge.edgeType) === 'flow') {
      const targets = flowTargets.get(edge.source) || [];
      targets.push(edge.target);
      flowTargets.set(edge.source, targets);
    }
  }

  // BFS: propagate delegation from orchestrated cards via flow edges
  const queue = [...orchestratedIds];
  const visited = new Set(orchestratedIds);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const target of flowTargets.get(current) || []) {
      if (visited.has(target)) continue;
      if (!result.has(target)) continue;
      // Only mark as delegated if not already orchestrated or orchestrator
      const existing = result.get(target);
      if (existing === 'disconnected') {
        result.set(target, 'delegated');
      }
      visited.add(target);
      queue.push(target);
    }
  }

  return result;
}

// ── Combined resolution ────────────────────────────────────────────

/**
 * Resolve all cards in a deck to registry definitions + bus connections.
 * Returns a Map from card id to ResolvedCard.
 */
export function resolveAllCards(
  cards: readonly ResolverCardInput[],
  edges: readonly ResolverEdgeInput[],
): Map<string, ResolvedCard> {
  const busConnections = resolveBusConnections(cards, edges);
  const result = new Map<string, ResolvedCard>();

  for (const card of cards) {
    result.set(card.id, {
      def: resolveCardDef(card),
      busConnection: busConnections.get(card.id) || 'disconnected',
    });
  }

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────

function normalize(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function findDef(id: string): AgentCardDef | undefined {
  return AGENT_CARD_REGISTRY.find((def) => def.id === id);
}
