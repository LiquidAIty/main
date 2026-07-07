import type { AgentCardInstance, AgentCardRuntimeOptions } from '../types';

export const LOCAL_CODER_CONTROLLER_MODEL_KEY = 'gpt-5.1-chat-latest';
export const LOCAL_CODER_CONTROLLER_PROVIDER: NonNullable<AgentCardRuntimeOptions['provider']> =
  'openai';
export const LOCAL_CODER_CONTROLLER_TOOLS = ['run_local_coder'] as const;

const STALE_LOCAL_CODER_MODEL_KEYS = new Set([
  'gpt-5-mini',
  'or-openai-gpt-5-mini',
  'kimi-k2-thinking',
  'moonshotai/kimi-k2-thinking',
  'moonshotai/kimi-k2:free',
]);

type CardLike = Partial<
  Pick<
    AgentCardInstance,
    'id' | 'templateId' | 'runtimeBinding' | 'runtimeType' | 'runtimeOptions'
  >
> &
  Record<string, unknown>;

function cleanOptionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return text || null;
}

export function isLocalCoderControllerCard(card: CardLike | null | undefined): boolean {
  if (!card) return false;
  return (
    cleanOptionalText(card.id)?.toLowerCase() === 'card_local_coder' ||
    cleanOptionalText(card.runtimeBinding)?.toLowerCase() === 'local_coder' ||
    cleanOptionalText(card.runtimeType)?.toLowerCase() === 'local_coder' ||
    cleanOptionalText(card.templateId)?.toLowerCase() === 'template_local_coder'
  );
}

function isStaleLocalCoderModel(modelKey: string | null): boolean {
  return Boolean(modelKey && STALE_LOCAL_CODER_MODEL_KEYS.has(modelKey));
}

export function normalizeLocalCoderControllerCard<T extends CardLike>(card: T): T {
  if (!isLocalCoderControllerCard(card)) return card;
  const runtimeOptions =
    card.runtimeOptions && typeof card.runtimeOptions === 'object' && !Array.isArray(card.runtimeOptions)
      ? { ...(card.runtimeOptions as Record<string, unknown>) }
      : {};
  const modelKey = cleanOptionalText(runtimeOptions.modelKey);
  const provider = cleanOptionalText(runtimeOptions.provider);
  const shouldUseControllerDefault = !modelKey || isStaleLocalCoderModel(modelKey);
  const rawTools = Array.isArray(runtimeOptions.tools)
    ? runtimeOptions.tools
        .map((tool) => cleanOptionalText(tool))
        .filter((tool): tool is string => Boolean(tool))
    : [];

  return {
    ...card,
    runtimeBinding: 'local_coder',
    runtimeType: 'local_coder',
    runtimeOptions: {
      ...runtimeOptions,
      provider:
        shouldUseControllerDefault || !provider
          ? LOCAL_CODER_CONTROLLER_PROVIDER
          : runtimeOptions.provider,
      modelKey: shouldUseControllerDefault
        ? LOCAL_CODER_CONTROLLER_MODEL_KEY
        : runtimeOptions.modelKey,
      tools: Array.from(new Set([...LOCAL_CODER_CONTROLLER_TOOLS, ...rawTools])),
    },
  };
}
