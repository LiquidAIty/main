import { runLLM } from '../../llm/client';
import { createTaskContract } from '../contracts/contractMaker';
import { scoreContractResult } from '../contracts/scoring';
import type {
  AgentCardInstance,
  AgentHandshake,
  AgentTemplate,
  CardRunResult,
  PromptTemplate,
} from '../types';

export type CardRuntimeContext = {
  userInput: string;
  previousOutput?: string;
  promptTemplates?: PromptTemplate[];
  seed?: string;
};

function resolvePromptTemplateContent(
  promptTemplateId: string | null | undefined,
  promptTemplates: PromptTemplate[] | undefined,
): string {
  if (!promptTemplateId || !Array.isArray(promptTemplates)) return '';
  return promptTemplates.find((template) => template.id === promptTemplateId)?.content || '';
}

function summarizeText(value: string | null | undefined, maxLength = 220): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function buildHandshake(
  effectiveAgent: AgentTemplate,
  contract: ReturnType<typeof createTaskContract>,
): AgentHandshake {
  return {
    accepted: true,
    restatedTask: contract.task,
    confirmedFormat: contract.requiredOutput.format,
    notes: [
      `Output format confirmed as ${contract.requiredOutput.format}.`,
      effectiveAgent.model ? `Execution model: ${effectiveAgent.model}.` : 'Execution model unset.',
    ],
  };
}

function buildImprovementPromptBit(
  passed: boolean,
  output: string | null | undefined,
  requiredFormat: 'text' | 'json',
): string | undefined {
  if (passed) return undefined;
  if (!String(output || '').trim()) {
    return 'Produce a non-empty output that directly satisfies the contract.';
  }
  if (requiredFormat === 'json') {
    return 'Return valid JSON that matches the required schema and stays tightly scoped.';
  }
  return 'Tighten the output, remove filler, and align more directly to the contract.';
}

function buildSystemPrompt(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  contract: ReturnType<typeof createTaskContract>,
  promptText: string,
  context: CardRuntimeContext,
): string {
  return [
    'You are executing one specialist deck card inside LiquidAIty Builder mode.',
    'Follow the contract strictly.',
    'Do not add filler, explanations about the process, or unrelated content.',
    `Card title: ${card.title}`,
    `Card purpose: ${contract.purpose}`,
    'Task contract:',
    JSON.stringify(contract, null, 2),
    promptText ? `Prompt template:\n${promptText}` : '',
    context.previousOutput ? `Previous card output:\n${context.previousOutput}` : '',
    context.seed ? `Clone seed: ${context.seed}` : '',
    effectiveAgent.tools.length > 0 ? `Declared tools: ${effectiveAgent.tools.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildMainChatSystemPrompt(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  contract: ReturnType<typeof createTaskContract>,
  promptText: string,
  context: CardRuntimeContext,
): string {
  return [
    'You are LiquidAIty main chat running as a runtime-bound Builder card.',
    'You are the direct, user-facing control layer.',
    'Respond in normal conversational prose unless the contract explicitly requires JSON.',
    'Be practical, concrete, and honest about uncertainty.',
    'Do not expose internal runtime plumbing, hidden telemetry, or implementation details unless the user asks for them.',
    'If context is missing, say so plainly instead of pretending to know more.',
    `Card title: ${card.title}`,
    `Card purpose: ${contract.purpose}`,
    'Task contract:',
    JSON.stringify(contract, null, 2),
    promptText ? `Prompt template:\n${promptText}` : '',
    context.previousOutput ? `Previous card output:\n${context.previousOutput}` : '',
    context.seed ? `Clone seed: ${context.seed}` : '',
    effectiveAgent.tools.length > 0 ? `Declared tools: ${effectiveAgent.tools.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildSystemPromptForBinding(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  contract: ReturnType<typeof createTaskContract>,
  promptText: string,
  context: CardRuntimeContext,
): string {
  if (card.runtimeBinding === 'main_chat') {
    return buildMainChatSystemPrompt(card, effectiveAgent, contract, promptText, context);
  }
  return buildSystemPrompt(card, effectiveAgent, contract, promptText, context);
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
  const contract = createTaskContract({
    userInput: context.userInput || input,
    card,
    previousOutput: context.previousOutput,
    effectiveAgent,
  });
  const handshake = buildHandshake(effectiveAgent, contract);
  const promptText = resolvePromptTemplateContent(effectiveAgent.promptTemplate, context.promptTemplates)
    .trim()
    .slice(0, 4000);

  try {
    const llmResult = await runLLM(String(input || ''), {
      modelKey: effectiveAgent.model || undefined,
      provider: effectiveAgent.provider || undefined,
      temperature: effectiveAgent.temperature ?? undefined,
      maxTokens: effectiveAgent.maxTokens ?? undefined,
      system: buildSystemPromptForBinding(card, effectiveAgent, contract, promptText, context),
      jsonMode: contract.requiredOutput.format === 'json' && !contract.requiredOutput.schema,
      jsonSchema:
        contract.requiredOutput.format === 'json' && contract.requiredOutput.schema
          ? {
              name: `deck_card_${card.id}_schema`,
              schema: contract.requiredOutput.schema,
              strict: true,
            }
          : undefined,
      useResponsesApi: effectiveAgent.provider === 'openai',
    });

    const scored = scoreContractResult(llmResult.text, contract);
    return {
      output: llmResult.text,
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      seed: context.seed,
      contract,
      handshake,
      score: scored.score,
      passed: scored.passed,
      scoreDetail: scored.detail,
      improvementPromptBit: buildImprovementPromptBit(
        scored.passed,
        llmResult.text,
        contract.requiredOutput.format,
      ),
      inputSummary: summarizeText(input),
      outputSummary: summarizeText(llmResult.text),
    };
  } catch (err: any) {
    const scored = scoreContractResult(null, contract);
    return {
      output: null,
      status: 'error',
      error: err?.message || 'card_run_failed',
      startedAt,
      endedAt: new Date().toISOString(),
      seed: context.seed,
      contract,
      handshake,
      score: scored.score,
      passed: false,
      scoreDetail: scored.detail,
      improvementPromptBit: buildImprovementPromptBit(false, null, contract.requiredOutput.format),
      inputSummary: summarizeText(input),
      outputSummary: summarizeText(err?.message || 'card_run_failed'),
    };
  }
}
