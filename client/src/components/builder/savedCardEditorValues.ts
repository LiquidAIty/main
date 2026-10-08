import type {
  DeckCard,
} from '../../types/agentgraph';

export type SavedCardEditorValues = {
  provider: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  tools: string[];
};

export function readSavedCardEditorValues(card: DeckCard): SavedCardEditorValues {
  // Templates are construction data, not an alternate saved Card definition.
  // Older saved override values remain readable when the Card has no current
  // field for that value.
  const overrides = card.overrides || {};
  const selectedTools = Array.isArray(card.runtimeOptions?.tools)
    ? card.runtimeOptions.tools
    : Array.isArray(card.tools)
      ? card.tools
      : [];
  return {
    provider: card.runtimeOptions?.provider ?? overrides.provider ?? null,
    model: card.runtimeOptions?.modelKey ?? overrides.model ?? null,
    temperature: card.runtimeOptions?.temperature ?? overrides.temperature ?? null,
    maxTokens: card.runtimeOptions?.maxTokens ?? overrides.maxTokens ?? null,
    tools: selectedTools,
  };
}
