import { runLLM } from '../../llm/client';
import { normalizeV3Blackboard, resolveRuntimeBinding } from '../blackboard';
import type {
  AgentCardInstance,
  AgentTemplate,
  CardRunResult,
  PromptTemplate,
  RuntimeBinding,
  V3Blackboard,
} from '../types';

export type CardRuntimeContext = {
  userInput: string;
  previousOutput?: string;
  promptTemplates?: PromptTemplate[];
  seed?: string;
  blackboard?: V3Blackboard | null;
};

function summarizeText(value: string | null | undefined, maxLength = 220): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function formatCardRuntimeError(err: unknown): string {
  const debugMessage = String((err as any)?.message || err || 'card_run_failed').trim();
  const lower = debugMessage.toLowerCase();

  if (
    lower.includes('insufficient_quota') ||
    lower.includes('quota exceeded') ||
    (lower.includes('quota') && lower.includes('billing'))
  ) {
    return 'The configured model could not run because provider quota or billing is unavailable right now.';
  }

  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'The configured model is rate-limited right now. Try this card again shortly.';
  }

  if (
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key')
  ) {
    return 'The configured model request was rejected by the provider. Check the backend credentials for this card.';
  }

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'The configured model timed out before the card completed.';
  }

  if (lower.includes('model') && (lower.includes('not found') || lower.includes('does not exist'))) {
    return 'The configured model for this card is unavailable.';
  }

  return 'The backend model call failed for this card.';
}

function buildRuntimeInput(input: string, context: CardRuntimeContext): string {
  const primary = String(context.userInput || input || '').trim();
  if (primary) return primary;
  return String(context.previousOutput || '').trim();
}

function buildJsonSchema(cardId: string, schema: Record<string, unknown>) {
  return {
    name: `deck_card_${cardId}_schema`,
    schema,
    strict: true,
  };
}

export function resolveEffectiveAgent(
  card: AgentCardInstance,
  templates: AgentTemplate[],
): AgentTemplate | null {
  const template = templates.find((item) => item.id === card.templateId);
  if (!template) return null;

  const overrides = card.overrides || {};
  return {
    ...template,
    ...overrides,
    tools: Array.isArray(overrides.tools) ? overrides.tools : template.tools,
    skills: Array.isArray(overrides.skills) ? overrides.skills : template.skills,
    personas: Array.isArray(overrides.personas) ? overrides.personas : template.personas,
    knowledgeSources: Array.isArray(overrides.knowledgeSources)
      ? overrides.knowledgeSources
      : template.knowledgeSources,
    ioSchema:
      overrides.ioSchema && typeof overrides.ioSchema === 'object'
        ? overrides.ioSchema
        : template.ioSchema,
  };
}

export async function runCardWithContract(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  input: string,
  context: CardRuntimeContext,
): Promise<CardRunResult> {
  const startedAt = new Date().toISOString();
  const runtimeBinding: RuntimeBinding | null = resolveRuntimeBinding(card.runtimeBinding, card.id);
  const currentBlackboard = normalizeV3Blackboard(context.blackboard);
  const runtimeInput = buildRuntimeInput(input, context);
  const prompt = String(card.prompt || '').trim();

  try {
    const llmResult = await runLLM(runtimeInput, {
      modelKey: effectiveAgent.model || undefined,
      provider: effectiveAgent.provider || undefined,
      temperature: effectiveAgent.temperature ?? undefined,
      maxTokens: effectiveAgent.maxTokens ?? undefined,
      system: prompt || undefined,
      jsonMode: Boolean(effectiveAgent.ioSchema),
      jsonSchema:
        effectiveAgent.ioSchema && typeof effectiveAgent.ioSchema === 'object'
          ? buildJsonSchema(card.id, effectiveAgent.ioSchema)
          : undefined,
      useResponsesApi: effectiveAgent.provider === 'openai',
    });

    return {
      output: llmResult.text,
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      runtimeBinding,
      seed: context.seed,
      inputSummary: summarizeText(runtimeInput),
      outputSummary: summarizeText(llmResult.text),
      blackboardWrite: null,
      blackboard: currentBlackboard,
    };
  } catch (err: any) {
    return {
      output: null,
      status: 'error',
      error: formatCardRuntimeError(err),
      startedAt,
      endedAt: new Date().toISOString(),
      runtimeBinding,
      seed: context.seed,
      inputSummary: summarizeText(runtimeInput),
      outputSummary: summarizeText(String(err?.message || err || 'card_run_failed')),
      blackboardWrite: null,
      blackboard: currentBlackboard,
    };
  }
}
