/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Saved Cards
 * Relationship: This file normalizes Card runtime configuration, optional editor text, default new-Card model authority, identifiers, and detached deck copies for Project editing.
 *
 * Entity: Card Topology
 * Relationship: This file recognizes saved orange orchestrator authority and canonical orange or blue edge types used by Card nodes, rails, and topology editing.
 */
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  CardRuntime,
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
export const uid = () => Math.random().toString(36).slice(2, 8);

export function cloneDeckDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
