/**
 * Entity: Saved Cards
 * Relationship: This file normalizes Card runtime configuration, optional editor text, default new-Card model authority, identifiers, and detached deck copies for Project editing.
 *
 * Entity: Card Topology
 * Relationship: This file recognizes saved orchestrator authority, canonical orange or blue edge types, and the exact enabled wired Card roster projected into Hermes Bot Mode.
 */
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  CardRuntime,
  DeckDocument,
  DeckEdgeType,
} from '../../../types/agentgraph';

export function safeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    // fallback below
  }
  return String(value);
}

export function cleanOptionalText(value: unknown): string | null {
  const text = safeText(value).trim();
  return text || null;
}

// Cards use the ordinary provider/model selector. This is only the valid seed
// for a new card; it is not a role-to-model preset or a hidden runtime choice.
export const DEFAULT_CARD_MODEL_KEY = 'gpt-5.6-luna';
export const DEFAULT_CARD_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openai';
export function normalizeCardRuntime(value: unknown): CardRuntime | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const kind = safeText(candidate.kind).trim().toLowerCase();
  const mode = safeText(candidate.mode).trim().toLowerCase();
  if (kind === 'hermes') {
    const profile = safeText(candidate.profile).trim();
    if (!profile || !['main', 'delegate', 'magentic_one'].includes(mode)) return null;
    return { kind, mode: mode as 'main' | 'delegate' | 'magentic_one', profile };
  }
  return null;
}

export function normalizeRuntimeOptions(
  value: unknown,
): AgentCardRuntimeOptions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return cloneDeckDocument(value as AgentCardRuntimeOptions);
}

/** Orange flow authority belongs to Main or an explicitly enabled saved
 * non-Magnetic orchestrator Card. */
export function hasAgentOrchestratorAuthority(card: AgentCardInstance): boolean {
  const options = card.runtimeOptions;
  return card.kind === 'agent'
    && card.runtime.kind === 'hermes'
    && card.runtime.mode !== 'magentic_one'
    && (card.runtime.mode === 'main' || options?.orchestrator === true)
    && Boolean(card.runtime.profile.trim())
    && card.enabled !== false;
}
/** Recognise ONLY the two real edge types — mirrors the backend contract
 * (decks/store.ts). Anything else is 'invalid': visible on the canvas but
 * authorising nothing. The old default returned 'flow' (invocation authority)
 * for typos and corrupt data, which is how Main-to-agent messaging silently
 * died twice (C-1). */
export function normalizeDeckEdgeType(value: unknown): DeckEdgeType {
  const type = safeText(value).trim().toLowerCase();
  if (type === 'magentic_option') return 'magentic_option';
  if (type === 'flow') return 'flow';
  return 'invalid';
}

export type WiredBotTarget = {
  cardId: string;
  cardRevisionId: string;
  title: string;
  profile: string;
  direction: 'outgoing';
  edgeType: 'flow' | 'magentic_option';
  prompt: string;
};

/** Project wires are the only application authority projected into Hermes's
 * native Bot Mode roster. Main sees every enabled Card participating in the
 * enabled topology; another Card sees only Cards on its own enabled incident
 * wires. Both orange flow and blue Magnetic membership carry Bot reachability. */
export function wiredBotTargets(deck: DeckDocument, cardId: string): WiredBotTarget[] {
  const selected = deck.nodes.find((node) => node.id === cardId);
  if (!selected || selected.enabled === false || selected.runtime.kind !== 'hermes') return [];
  const nodeById = new Map(deck.nodes.map((node) => [node.id, node] as const));
  const targetEdgeTypes = new Map<string, 'flow' | 'magentic_option'>();
  const include = (targetId: string, edgeType: 'flow' | 'magentic_option'): void => {
    const previous = targetEdgeTypes.get(targetId);
    if (!previous || edgeType === 'magentic_option') {
      targetEdgeTypes.set(targetId, edgeType);
    }
  };
  for (const edge of deck.edges) {
    const edgeType = normalizeDeckEdgeType(edge.edgeType);
    if (edge.enabled === false || edgeType === 'invalid') continue;
    if (selected.runtime.mode === 'main') {
      include(edge.source, edgeType);
      include(edge.target, edgeType);
    } else if (edge.source === cardId) {
      include(edge.target, edgeType);
    } else if (edge.target === cardId) {
      include(edge.source, edgeType);
    }
  }
  targetEdgeTypes.delete(cardId);
  return [...targetEdgeTypes].flatMap(([targetId, edgeType]) => {
    const target = nodeById.get(targetId);
    if (
      !target
      || target.enabled === false
      || target.runtime.kind !== 'hermes'
      || !target.runtime.profile.trim()
    ) return [];
    return [{
      cardId: target.id,
      cardRevisionId: String(target._cardRevisionId || ''),
      title: safeText(target.title || target.id),
      profile: target.runtime.profile,
      direction: 'outgoing' as const,
      edgeType,
      prompt: String(target.prompt || ''),
    }];
  });
}
export const uid = () => Math.random().toString(36).slice(2, 8);

export function cloneDeckDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
