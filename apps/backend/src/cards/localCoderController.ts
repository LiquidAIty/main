import type { AgentCardInstance } from '../types';

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
 * Normalize ONLY the coder controller card's identity. Provider, model, and
 * tools are saved-card authority; hydration never adds hidden grants.
 */
export function normalizeLocalCoderControllerCard<T extends CardLike>(card: T): T {
  if (!isLocalCoderControllerCard(card)) return card;
  const runtimeOptions =
    card.runtimeOptions && typeof card.runtimeOptions === 'object' && !Array.isArray(card.runtimeOptions)
      ? { ...(card.runtimeOptions as Record<string, unknown>) }
      : {};
  return {
    ...card,
    runtimeBinding: 'local_coder',
    runtimeType: 'local_coder',
    runtimeOptions: {
      ...runtimeOptions,
    },
  };
}
