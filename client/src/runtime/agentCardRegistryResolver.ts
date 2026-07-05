/**
 * Bus connection projection — read-only Agent Canvas UI mechanic.
 *
 * Computes how each deck card relates to the Magentic bus
 * (orchestrator / orchestrated / delegated / disconnected) from the persisted
 * ReactFlow edges, for canvas visibility only (e.g. whether to show the
 * OpenClaude console rail). Never mutates cards or edges; never decides
 * execution or eligibility.
 *
 * The former card→registry classification half (resolveCardDef /
 * resolveStagedCardDefId / BINDING_TO_REGISTRY_ID / resolveAllCards) was
 * removed: it was hardcoded semantic classification (title/binding→id maps)
 * with no production consumer — the "what a card is" decision belongs to saved
 * card configuration + the model, not to a TypeScript classifier.
 */

/** Minimal card shape this projection reads from. `runtimeBinding` is carried
 * for consumers that key cards by binding (e.g. console-rail visibility);
 * resolveBusConnections itself only reads id + runtimeType. */
export type ResolverCardInput = {
  id: string;
  runtimeType?: string | null;
  runtimeBinding?: string | null;
};

/** Minimal edge shape this projection reads from. */
export type ResolverEdgeInput = {
  id: string;
  source: string;
  target: string;
  edgeType?: string | null;
};

/**
 * How a card relates to the bus in the UI.
 * Derived from existing edgeType values — no new DeckEdgeType created.
 */
export type BusConnection =
  | 'orchestrator'  // IS the bus (Sol / Magentic-One)
  | 'orchestrated'  // Direct magentic_option edge peer of Sol
  | 'delegated'     // Flow edge downstream from an orchestrated card
  | 'disconnected'; // No bus edge path

/**
 * Resolve bus connections for all cards given a set of edges.
 * Returns a Map from card id to BusConnection. Read-only projection of the
 * saved cards + saved canvas edges — no classification, no execution routing.
 *
 * - Card with runtimeType 'magentic_one' → 'orchestrator'
 * - Card joined to Sol by a direct magentic_option edge → 'orchestrated'
 * - Card that is a flow-edge descendant of an orchestrated card → 'delegated'
 * - Everything else → 'disconnected'
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

  // Mark direct bus peers. Persisted ReactFlow edges may point toward or away
  // from the Magentic card; direction does not change bus eligibility.
  const orchestratedIds = new Set<string>();
  for (const edge of edges) {
    if (normalize(edge.edgeType) !== 'magentic_option') continue;
    const peerId = solIds.has(edge.source)
      ? edge.target
      : solIds.has(edge.target)
        ? edge.source
        : null;
    if (!peerId || !result.has(peerId) || solIds.has(peerId)) continue;
    result.set(peerId, 'orchestrated');
    orchestratedIds.add(peerId);
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

function normalize(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}
