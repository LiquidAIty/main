import { resolveModel } from '../llm/models.config';

function normalizeProvider(value: unknown): 'openai' | 'openrouter' | null {
  const provider = String(value ?? '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'openrouter') return provider;
  return null;
}

/**
 * Structural lookup used by the existing KnowGraph transport. The saved Card
 * supplies the model key and optional provider assertion; this function does
 * not select, rank, substitute, or execute a model.
 */
export function resolveCardModelStrict(card: any): {
  provider: string;
  providerModelId: string;
} {
  const modelKey = card.runtimeOptions?.modelKey;
  if (!modelKey) {
    throw new Error(
      `card_model_config_missing: cardId=${card.id} runtimeType=${card.runtimeType}`,
    );
  }
  const resolved = resolveModel(modelKey);
  const savedProvider = normalizeProvider(card.runtimeOptions?.provider);
  if (savedProvider && savedProvider !== resolved.provider) {
    throw new Error(
      `card_model_config_mismatch: cardId=${card.id} savedProvider=${savedProvider} registryProvider=${resolved.provider}`,
    );
  }
  return { provider: resolved.provider, providerModelId: resolved.id };
}
