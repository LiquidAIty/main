import type { AgentCardInstance } from '../types';

export const LOCAL_CODER_CONTROLLER_TOOLS = ['run_local_coder'] as const;

export type CardLike = Partial<
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

/**
 * Normalize ONLY the coder controller card's identity: its runtime binding/type
 * and the presence of its run_local_coder tool. Provider and model are the saved
 * card's authority — there is no hardcoded default and no model blacklist here.
 * The card selects its own engine (an OpenRouter/OpenAI model, or a BYOC coder
 * CLI); this normalizer never overrides that choice.
 */
export function normalizeLocalCoderControllerCard<T extends CardLike>(card: T): T {
  if (!isLocalCoderControllerCard(card)) return card;
  const runtimeOptions =
    card.runtimeOptions && typeof card.runtimeOptions === 'object' && !Array.isArray(card.runtimeOptions)
      ? { ...(card.runtimeOptions as Record<string, unknown>) }
      : {};
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
      tools: Array.from(new Set([...LOCAL_CODER_CONTROLLER_TOOLS, ...rawTools])),
    },
  };
}
