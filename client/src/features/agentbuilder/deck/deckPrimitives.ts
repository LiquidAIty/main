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

export const DEFAULT_CARD_MODEL_KEY = 'z-ai/glm-5.2';
export const DEFAULT_CARD_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = 'openrouter';
export const LOCAL_CODER_CONTROLLER_MODEL_KEY = DEFAULT_CARD_MODEL_KEY;
export const LOCAL_CODER_CONTROLLER_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> = DEFAULT_CARD_PROVIDER;
export const LOCAL_CODER_CONTROLLER_TOOLS = ['run_local_coder'] as const;
export const STALE_LOCAL_CODER_MODEL_KEYS = new Set([
  'gpt-5-mini',
  'or-openai-gpt-5-mini',
  'kimi-k2-thinking',
  'moonshotai/kimi-k2-thinking',
  'moonshotai/kimi-k2:free',
  'gpt-5.1-chat-latest',
  'or-openai-gpt-5.1-chat-latest',
  'openai/gpt-5.1-chat',
]);

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

export function isAssistLikeRuntimeType(runtimeType: AgentCardRuntimeType | null): boolean {
  return runtimeType === 'assistant_agent' || runtimeType === 'local_coder';
}

export function normalizeRuntimeOptions(
  value: unknown,
): AgentCardRuntimeOptions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return cloneDeckDocument(value as AgentCardRuntimeOptions);
}


export function normalizeDeckEdgeType(value: unknown): DeckEdgeType {
  return safeText(value).trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'flow';
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
  if (normalized === 'kg_ingest') return 'kg_ingest';
  if (normalized === 'research_agent') return 'research_agent';
  if (normalized === 'knowgraph') return 'knowgraph';
  if (normalized === 'neo4j') return 'neo4j';
  if (normalized === 'thinkgraph_agent') return 'thinkgraph_agent';
  if (normalized === 'codegraph_agent') return 'codegraph_agent';
  if (normalized === 'knowgraph_agent') return 'knowgraph_agent';
  if (normalized === 'plan_agent') return 'plan_agent';
  if (normalized === 'worldsignals_agent') return 'worldsignals_agent';
  if (normalized === 'trading_agent') return 'trading_agent';
  if (normalized === 'code_agent') return 'code_agent';
  if (normalized === 'data_formulator_agent') return 'data_formulator_agent';
  if (normalized === 'hermes_steward') return 'hermes_steward';
  return null;
}


