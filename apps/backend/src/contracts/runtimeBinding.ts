import type { RuntimeBinding } from '../types';

const RUNTIME_BINDINGS = [
  'assist',
  'local_coder',
  'openai_coder',
  'main_chat',
  'research_agent',
  'plan_agent',
  'worldsignals_agent',
  'trading_agent',
  'hermes_steward',
] as const satisfies RuntimeBinding[];

function normalizeRuntimeBinding(value: unknown): RuntimeBinding | null {
  const normalized = String(value || '').trim().toLowerCase();
  return RUNTIME_BINDINGS.includes(normalized as RuntimeBinding)
    ? (normalized as RuntimeBinding)
    : null;
}

export function resolveRuntimeBinding(value: unknown): RuntimeBinding | null {
  return normalizeRuntimeBinding(value);
}
