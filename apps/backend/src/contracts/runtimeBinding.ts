import type { RuntimeBinding } from '../types';

export const RUNTIME_BINDINGS = [
  'assist',
  'local_coder',
  'main_chat',
  'research_agent',
  'plan_agent',
  'worldsignals_agent',
  'trading_agent',
  'hermes_steward',
] as const satisfies RuntimeBinding[];

const SYSTEM_CARD_RUNTIME_BINDINGS: Record<string, RuntimeBinding> = {
  card_assist: 'assist',
  card_local_coder: 'local_coder',
  card_main_chat: 'main_chat',
  card_research: 'research_agent',
  card_research_agent: 'research_agent',
  card_plan_agent: 'plan_agent',
  card_worldsignals_agent: 'worldsignals_agent',
  card_trading_workbench: 'trading_agent',
  card_hermes_steward: 'hermes_steward',
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
