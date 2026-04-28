/**
 * Agent Card Registry v0 — Phase 1A
 *
 * Static definitions for the 9 real LiquidAIty agent capabilities.
 * This is a UI-only registry. It does NOT modify AgentCardInstance,
 * DeckDocument, DeckEdge, INITIAL_DECK, or any runtime/backend type.
 *
 * Nothing imports this file in production yet.
 */

/**
 * Agent kind in the bus architecture.
 *
 * - bus:       Central orchestrator (Sol / Magentic-One). Not a normal card.
 * - workbench: Owns a specialist canvas/surface. User opts in via Add Agent.
 * - core:      Headless capability. Always or often connected.
 * - signal:    Reads external data, feeds context to the bus.
 */
export type AgentCardKind = 'bus' | 'workbench' | 'core' | 'signal';

/**
 * Static definition for a known agent capability.
 * Computed at read time, never persisted in DeckDocument.
 */
export type AgentCardDef = {
  /** Unique registry key. */
  id: string;

  /** Display name (user-facing). */
  name: string;

  /** One-line description for Add Agent palette and tooltips. */
  description: string;

  /** Classification. */
  kind: AgentCardKind;

  /**
   * Workspace surface this card owns, if any.
   * Must match a real workspaceView value or null for headless cards.
   * Cards with a surface can project a rail icon when connected.
   */
  ownedSurface: string | null;

  /** Whether this card can project a rail icon when connected to the bus. */
  railEligible: boolean;

  /** Whether execution requires plan/checkmark approval. */
  requiresPlanApproval: boolean;

  /** Whether this card is connected to the bus by default in a new project. */
  defaultConnected: boolean;

  /**
   * The runtimeType value this maps to in AgentCardRuntimeType.
   * Used to identify the card kind in existing deck logic.
   */
  runtimeType: string;
};

export const AGENT_CARD_REGISTRY: readonly AgentCardDef[] = [
  // ── Bus ──────────────────────────────────────────────────────────
  {
    id: 'sol',
    name: 'Sol',
    description: 'Central orchestrator and control spine (Magentic-One).',
    kind: 'bus',
    ownedSurface: null,
    railEligible: false,
    requiresPlanApproval: false,
    defaultConnected: true,
    runtimeType: 'magentic_one',
  },

  // ── Workbench agents (own a canvas) ──────────────────────────────
  {
    id: 'code',
    name: 'Code Agent',
    description: 'Local coder, Claude Code, browser coding workbench.',
    kind: 'workbench',
    ownedSurface: 'code',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    runtimeType: 'local_coder',
  },
  {
    id: 'trading',
    name: 'Trading Agent',
    description: 'Trading UI and market analysis workbench.',
    kind: 'workbench',
    ownedSurface: 'trading',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'telescope',
    name: 'Telescope Agent',
    description: 'SkyView data pulling and deep-zoom tiling workbench.',
    kind: 'workbench',
    ownedSurface: 'telescope',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'energy',
    name: 'Energy Agent',
    description: 'NRGSim, 3D building, Pascal merge, EnergyPlus workbench.',
    kind: 'workbench',
    ownedSurface: 'energy',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    runtimeType: 'assistant_agent',
  },

  // ── Signal agent ─────────────────────────────────────────────────
  {
    id: 'worldsignals',
    name: 'WorldSignals Agent',
    description: 'Signal ingestion and outside-world context behind the orb.',
    kind: 'signal',
    ownedSurface: 'worldsignal',
    railEligible: true,
    requiresPlanApproval: false,
    defaultConnected: true,
    runtimeType: 'assistant_agent',
  },

  // ── Core / headless agents ───────────────────────────────────────
  {
    id: 'plan',
    name: 'Plan Agent',
    description: 'Creates plan, drives checkmark approval flow.',
    kind: 'core',
    ownedSurface: 'plan',
    railEligible: true,
    requiresPlanApproval: false,
    defaultConnected: true,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'knowledge',
    name: 'Knowledge Agent',
    description: 'ThinkGraph, KnowGraph, and CodeGraph memory updates.',
    kind: 'core',
    ownedSurface: 'knowledge',
    railEligible: true,
    requiresPlanApproval: false,
    defaultConnected: true,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'validator',
    name: 'Validator Agent',
    description: 'Validates code and agent outputs, scores results.',
    kind: 'core',
    ownedSurface: null,
    railEligible: false,
    requiresPlanApproval: false,
    defaultConnected: true,
    runtimeType: 'assistant_agent',
  },
] as const;

/** Look up a card definition by registry id. */
export function getCardDef(id: string): AgentCardDef | undefined {
  return AGENT_CARD_REGISTRY.find((def) => def.id === id);
}

/** Return all card definitions matching a given kind. */
export function getCardDefsByKind(kind: AgentCardKind): AgentCardDef[] {
  return AGENT_CARD_REGISTRY.filter((def) => def.kind === kind);
}

/** Return all card definitions that are default-connected. */
export function getDefaultConnectedDefs(): AgentCardDef[] {
  return AGENT_CARD_REGISTRY.filter((def) => def.defaultConnected);
}

/** Return all card definitions that are rail-eligible. */
export function getRailEligibleDefs(): AgentCardDef[] {
  return AGENT_CARD_REGISTRY.filter((def) => def.railEligible);
}

/** Return all card definitions that require plan approval. */
export function getApprovalRequiredDefs(): AgentCardDef[] {
  return AGENT_CARD_REGISTRY.filter((def) => def.requiresPlanApproval);
}
