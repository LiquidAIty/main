// Shared card/deck normalization primitives for the Agent Builder feature.
// Extracted verbatim from pages/agentbuilder.tsx (decomposition pass
// 2026-07-08). Persisted ids/bindings and behavior are unchanged.
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  CardRuntime,
  DeckEdgeType,
} from '../../../types/agentgraph';

export const DEFAULT_WORKSPACE_ROOT = 'C:\\Projects\\main';

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
export const MAIN_CHAT_MODEL_KEY = 'gpt-5.6-sol';
export const AGENT_BUILDER_MODEL_KEY = 'gpt-5.6-sol';
export const MAGENTIC_ONE_DEFAULT_MODEL_KEY = 'gpt-5.6-sol';
export const MAGENTIC_ONE_DEFAULT_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openai';
// Shared non-administrative CodeGraph corridor for repository-owning Cards.
// Indexing, trace ingestion, ADR mutation, and project deletion stay outside
// ordinary Card grants.
export const CODEBASE_MEMORY_TOOLS = [
  'cbm.search_graph',
  'cbm.trace_path',
  'cbm.get_code_snippet',
  'cbm.check_index_coverage',
  'cbm.detect_changes',
] as const;
// Builder seed selections. Runtime availability and saved grants remain authoritative.
export const AGENT_BUILDER_CONTROLLER_TOOLS = [
  'canvas.inspect',
  'card.create',
  'card.update_configuration',
  ...CODEBASE_MEMORY_TOOLS,
  'cbm.search_code',
  'cbm.query_graph',
] as const;
export const MAIN_CHAT_CONTROLLER_TOOLS = [
  'canvas.inspect',
  'engraphis_recall_context',
  'engraphis_get_memory',
  'engraphis_remember',
  'run_mag_one',
] as const;
export const THINKGRAPH_CARD_TOOLS = [
  'engraphis_recall_context',
  'engraphis_get_memory',
  'engraphis_remember',
  'engraphis_update_memory',
  'engraphis_correct',
  'engraphis_link',
  'engraphis_ingest',
] as const;
export const HERMES_CARD_TOOLS = [
  'canvas.inspect',
  'engraphis_get_memory',
  'graphiti.get_entity_edge',
  'graphiti.get_episode_entities',
  'graphiti.get_episodes',
  'graphiti.get_status',
  'graphiti.search_memory_facts',
  'graphiti.search_nodes',
  'graphiti.add_memory',
  'graphiti.add_triplet',
  'write_mag_one_instructions',
  'card.load_graph_references',
] as const;

export function normalizeCardRuntime(value: unknown): CardRuntime | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const kind = safeText(candidate.kind).trim().toLowerCase();
  const mode = safeText(candidate.mode).trim().toLowerCase();
  if (kind === 'hermes') {
    const profile = safeText(candidate.profile).trim();
    if (!profile || !['main', 'delegate', 'kanban', 'magentic_one'].includes(mode)) return null;
    return { kind, mode: mode as 'main' | 'delegate' | 'kanban' | 'magentic_one', profile };
  }
  return null;
}

export function normalizeRuntimeOptions(
  value: unknown,
): AgentCardRuntimeOptions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return cloneDeckDocument(value as AgentCardRuntimeOptions);
}

/** Orange flow authority belongs only to the fixed Main runtime. */
export function hasMainBotAuthority(card: AgentCardInstance): boolean {
  const record = card as AgentCardInstance & { enabled?: boolean };
  const options = card.runtimeOptions as (AgentCardRuntimeOptions & { enabled?: boolean }) | null;
  return card.kind === 'agent'
    && card.runtime.kind === 'hermes'
    && card.runtime.mode === 'main'
    && Boolean(card.runtime.profile.trim())
    && record.enabled !== false
    && options?.enabled !== false;
}


/** Recognise ONLY the two real edge types — mirrors the backend contract
 * (decks/store.ts). Anything else is 'invalid': visible on the canvas but
 * authorising nothing. The old default returned 'flow' (invocation authority)
 * for typos and corrupt data, which is how Main→Hermes delegation silently
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
