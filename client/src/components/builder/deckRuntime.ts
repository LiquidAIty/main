import type {
  AgentCardInstance,
  AgentTemplate,
} from '../../types/agentgraph';

export function resolveEffectiveAgent(
  card: AgentCardInstance,
  templates: AgentTemplate[],
): AgentTemplate | null {
  const template = templates.find((item) => item.id === card.templateId);
  if (!template) return null;

  const overrides = card.overrides || {};
  const selectedTools = Array.isArray(card.runtimeOptions?.tools)
    ? card.runtimeOptions.tools
    : Array.isArray(card.tools)
      ? card.tools
      : [];
  return {
    ...template,
    ...overrides,
    tools: selectedTools,
  };
}
