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

export const DEFAULT_CARD_MODEL_KEY = 'gpt-5.1-chat-latest';
export const DEFAULT_CARD_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openai';
export const MAGENTIC_ONE_DEFAULT_MODEL_KEY = 'openai/gpt-5.1-chat';
export const MAGENTIC_ONE_DEFAULT_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openrouter';
// Seed default ONLY for a fresh Coder card (and the console-config fallback). NOT
// a runtime override: once a card has a saved provider/model, that saved value is
// authoritative. Low-cost OpenRouter default; there is no model blacklist.
export const LOCAL_CODER_CONTROLLER_MODEL_KEY = 'z-ai/glm-5.2';
export const LOCAL_CODER_CONTROLLER_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openrouter';
export const LOCAL_CODER_CONTROLLER_TOOLS = ['run_local_coder'] as const;

export function normalizeRuntimeType(value: unknown): AgentCardRuntimeType | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === 'assistant_agent') return 'assistant_agent';
  if (normalized === 'magentic_one') return 'magentic_one';
  if (normalized === 'graph_flow') return 'graph_flow';
  if (normalized === 'local_coder') return 'local_coder';
  return null;
}
export function isLegacyUaCard(
  card: Pick<AgentCardInstance, 'id' | 'templateId' | 'title'> | null | undefined,
): boolean {
  if (!card) return false;
  const id = safeText(card.id).trim().toLowerCase();
  const templateId = safeText(card.templateId).trim().toLowerCase();
  const title = safeText(card.title).trim().toLowerCase();
  return (
    id.startsWith('card_ua_') ||
    (id.startsWith('card_') && id.includes('anything')) ||
    (templateId.startsWith('template_') && templateId.includes('anything')) ||
    title === 'understand anything'
  );
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
  if (normalized === 'research_agent') return 'research_agent';
  if (normalized === 'plan_agent') return 'plan_agent';
  if (normalized === 'worldsignals_agent') return 'worldsignals_agent';
  if (normalized === 'trading_agent') return 'trading_agent';
  if (normalized === 'hermes_steward') return 'hermes_steward';
  return null;
}
