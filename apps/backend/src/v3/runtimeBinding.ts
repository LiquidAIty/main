import type { RuntimeBinding } from './types';

export const RUNTIME_BINDINGS = [
  'main_chat',
  'kg_ingest',
  'research_agent',
  'knowgraph',
  'neo4j',
] as const satisfies RuntimeBinding[];

const SYSTEM_CARD_RUNTIME_BINDINGS: Record<string, RuntimeBinding> = {
  card_main_chat: 'main_chat',
  card_kg_ingest: 'kg_ingest',
  card_research: 'research_agent',
  card_knowgraph: 'knowgraph',
  card_neo4j: 'neo4j',
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
