// Shared card/deck normalization primitives for the Agent Builder feature.
// Extracted verbatim from pages/agentbuilder.tsx (decomposition pass
// 2026-07-08). Persisted ids/bindings and behavior are unchanged.
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  DeckEdgeType,
  RuntimeBinding,
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
export const MAGENTIC_ONE_DEFAULT_MODEL_KEY = DEFAULT_CARD_MODEL_KEY;
export const MAGENTIC_ONE_DEFAULT_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openai';
// Seed default ONLY for a fresh Coder card. Once a card has a saved
// provider/model, that saved value remains authoritative.
export const LOCAL_CODER_CONTROLLER_MODEL_KEY = DEFAULT_CARD_MODEL_KEY;
export const LOCAL_CODER_CONTROLLER_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openai';
export const LOCAL_CODER_CONTROLLER_TOOLS = [
  'run_local_coder',
  'cbm.index_repository',
  'cbm.search_graph',
  'cbm.query_graph',
  'cbm.trace_path',
  'cbm.get_code_snippet',
  'cbm.get_graph_schema',
  'cbm.get_architecture',
  'cbm.search_code',
  'cbm.list_projects',
  'cbm.delete_project',
  'cbm.index_status',
  'cbm.detect_changes',
  'cbm.manage_adr',
  'cbm.ingest_traces',
] as const;
export const CODER_CONTROLLER_TOOLS = [
  'cbm.index_repository',
  'cbm.search_graph',
  'cbm.query_graph',
  'cbm.trace_path',
  'cbm.get_code_snippet',
  'cbm.get_graph_schema',
  'cbm.get_architecture',
  'cbm.search_code',
  'cbm.list_projects',
  'cbm.delete_project',
  'cbm.index_status',
  'cbm.detect_changes',
  'cbm.manage_adr',
  'cbm.ingest_traces',
] as const;
export const MAIN_CHAT_CONTROLLER_TOOLS = [
  'engraphis.remember',
  'engraphis.recall',
  'engraphis.recall_context',
  'engraphis.recall_grounded',
  'engraphis.answer',
  'engraphis.why',
  'engraphis.timeline',
  'engraphis.recall_proactive',
  'engraphis.proactive_context',
  'engraphis.forget',
  'engraphis.pin',
  'engraphis.correct',
  'engraphis.promote',
  'engraphis.link',
  'engraphis.record_event',
  'engraphis.index_repo',
  'engraphis.search_code',
  'engraphis.code_path',
  'engraphis.code_impact',
  'engraphis.export_code_graph',
  'engraphis.start_session',
  'engraphis.end_session',
  'engraphis.receipts',
  'engraphis.context_savings',
  'engraphis.verify_receipts',
  'engraphis.export_receipts',
  'engraphis.stats',
  'engraphis.check_update',
  'engraphis.ingest',
  'engraphis.ingest_postgres_schema',
  'engraphis.consolidate',
  'canvas.inspect',
  'agentgraph.inspect',
  'mag_one.describe_connected_agents',
  'run_mag_one',
] as const;
export const HERMES_CARD_TOOLS = [
  'graphiti.search_nodes',
  'graphiti.search_memory_facts',
  'graphiti.get_entity_edge',
  'graphiti.get_episodes',
  'graphiti.summarize_saga',
  'graphiti.build_communities',
  'graphiti.get_episode_entities',
  'graphiti.get_status',
  'graphiti.add_memory',
  'graphiti.add_triplet',
  'agentgraph.inspect',
  'write_mag_one_instructions',
] as const;

export type AgentExecutionMode = NonNullable<AgentCardRuntimeOptions['executionMode']>;

export function normalizeAgentExecutionMode(
  value: unknown,
  runtimeBinding?: unknown,
): AgentExecutionMode {
  const binding = normalizeRuntimeBinding(runtimeBinding);
  if (binding === 'main_chat' || binding === 'coder') return 'single';
  return value === 'auto-kanban' ? 'auto-kanban' : 'single';
}

export function normalizeRuntimeType(value: unknown): AgentCardRuntimeType | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === 'assistant_agent') return 'assistant_agent';
  if (normalized === 'magentic_one') return 'magentic_one';
  return null;
}

export function normalizeRuntimeOptions(
  value: unknown,
): AgentCardRuntimeOptions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return cloneDeckDocument(value as AgentCardRuntimeOptions);
}


/** Recognise ONLY the three real edge types — mirrors the backend contract
 * (decks/store.ts). Anything else is 'invalid': visible on the canvas but
 * authorising nothing. The old default returned 'flow' (invocation authority)
 * for typos and corrupt data, which is how Main→Hermes delegation silently
 * died twice (C-1). */
export function normalizeDeckEdgeType(value: unknown): DeckEdgeType {
  const type = safeText(value).trim().toLowerCase();
  if (type === 'magentic_option') return 'magentic_option';
  if (type === 'magentic_control') return 'magentic_control';
  if (type === 'flow') return 'flow';
  return 'invalid';
}


export const uid = () => Math.random().toString(36).slice(2, 8);

export function cloneDeckDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeRuntimeBinding(value: unknown): RuntimeBinding | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === 'assist') return 'assist';
  if (normalized === 'local_coder') return 'local_coder';
  if (normalized === 'main_chat') return 'main_chat';
  if (normalized === 'coder') return 'coder';
  if (normalized === 'magentic_one') return 'magentic_one';
  if (normalized === 'research_agent') return 'research_agent';
  if (normalized === 'plan_agent') return 'plan_agent';
  if (normalized === 'worldsignals_agent') return 'worldsignals_agent';
  if (normalized === 'trading_agent') return 'trading_agent';
  if (normalized === 'hermes_steward') return 'hermes_steward';
  return null;
}
