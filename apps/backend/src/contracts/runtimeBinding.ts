import type { RuntimeBinding } from '../types';

export const RUNTIME_BINDINGS = [
  'assist',
  'local_coder',
  'main_chat',
  'kg_ingest',
  'research_agent',
  'thinkgraph_agent',
  'codegraph_agent',
  'knowgraph_agent',
  'knowgraph',
  'neo4j',
  'plan_agent',
  'worldsignals_agent',
  'trading_agent',
  'code_agent',
  'data_formulator_agent',
] as const satisfies RuntimeBinding[];

const SYSTEM_CARD_RUNTIME_BINDINGS: Record<string, RuntimeBinding> = {
  card_assist: 'assist',
  card_local_coder: 'local_coder',
  card_main_chat: 'main_chat',
  card_kg_ingest: 'kg_ingest',
  card_research: 'research_agent',
  card_research_agent: 'research_agent',
  card_thinkgraph_agent: 'thinkgraph_agent',
  card_codegraph_agent: 'codegraph_agent',
  card_knowgraph_agent: 'knowgraph_agent',
  card_knowgraph: 'knowgraph',
  card_neo4j: 'neo4j',
  card_plan_agent: 'plan_agent',
  card_worldsignals_agent: 'worldsignals_agent',
  card_trading_workbench: 'trading_agent',
  card_code_workbench: 'code_agent',
  card_data_formulator_workbench: 'data_formulator_agent',
};

export function normalizeRuntimeBinding(value: unknown): RuntimeBinding | null {
  const normalized = String(value || '').trim().toLowerCase();
  return RUNTIME_BINDINGS.includes(normalized as RuntimeBinding)
    ? (normalized as RuntimeBinding)
    : null;
}

export function resolveRuntimeBinding(value: unknown, cardId?: unknown): RuntimeBinding | null {
  return (
    normalizeRuntimeBinding(value) ||
    SYSTEM_CARD_RUNTIME_BINDINGS[String(cardId || '').trim()] ||
    null
  );
}
