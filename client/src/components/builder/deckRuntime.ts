import type {
  AgentCardInstance,
  AgentTemplate,
} from '../../types/agentgraph';

export function resolveEffectiveAgent(
  card: AgentCardInstance,
  _templates?: AgentTemplate[],
): AgentTemplate | null {
  // Templates are construction data, not an alternate saved runtime definition.
  // Retain only the one-way legacy read of already-saved override values.
  const overrides = card.overrides || {};
  const selectedTools = Array.isArray(card.runtimeOptions?.tools)
    ? card.runtimeOptions.tools
    : Array.isArray(card.tools)
      ? card.tools
      : [];
  return {
    ...overrides,
    id: card.templateId,
    name: card.title,
    provider: card.runtimeOptions?.provider ?? overrides.provider,
    model: card.runtimeOptions?.modelKey ?? overrides.model,
    temperature: card.runtimeOptions?.temperature ?? overrides.temperature,
    maxTokens: card.runtimeOptions?.maxTokens ?? overrides.maxTokens,
    tools: selectedTools,
  };
}
