import type {
  AgentCardInstance,
  AgentTemplate,
  AgentHandshake,
  CardRunResult,
  DeckDocument,
  DeckRun,
  DeckRunStep,
  PromptTemplate,
} from '../../types/agentgraph';
import { createContract } from './contractMaker';
import { buildExecutionPlan } from './deckExecution';
import { scoreResult } from './deckScoring';
import { validateDeckDocument } from './deckValidation';

export type DeckRuntimeContext = {
  runId: string;
  stepIndex: number;
  userInput: string;
  previousOutput: string;
  promptTemplates?: PromptTemplate[];
  seed?: string;
  backendInvoker?: (
    card: AgentCardInstance,
    effectiveAgent: AgentTemplate,
    input: string,
    context: DeckRuntimeContext,
  ) => Promise<string>;
};

export type ExecuteSimpleDeckOptions = {
  input?: string;
  promptTemplates?: PromptTemplate[];
  onStep?: (step: DeckRunStep, run: DeckRun) => void;
  backendInvoker?: DeckRuntimeContext['backendInvoker'];
};

function resolvePromptTemplateContent(
  promptTemplateId: string | null | undefined,
  promptTemplates: PromptTemplate[] | undefined,
): string {
  if (!promptTemplateId || !Array.isArray(promptTemplates)) return '';
  return promptTemplates.find((template) => template.id === promptTemplateId)?.content || '';
}

function buildRunSnapshot(
  runId: string,
  document: DeckDocument,
  input: string,
  startedAt: string,
  steps: DeckRunStep[],
  validation: ReturnType<typeof validateDeckDocument>,
  executionPlan: ReturnType<typeof buildExecutionPlan>,
  status: DeckRun['status'],
  extra?: Pick<DeckRun, 'endedAt' | 'error'>,
): DeckRun {
  return {
    id: runId,
    deckId: document.id,
    startedAt,
    endedAt: extra?.endedAt,
    status,
    input,
    error: extra?.error,
    steps,
    validationSummary: {
      ok: validation.ok,
      errors: validation.errors.map((issue) => issue.message),
      warnings: validation.warnings.map((issue) => issue.message),
    },
    executionPlanSummary: {
      startCardIds: executionPlan.startCardIds,
      simpleOrderCardIds: executionPlan.simpleOrderCardIds,
      expandedStepIds: executionPlan.expandedSteps.map((step) => step.executionId),
    },
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
    tools: overrides.tools || template.tools,
    skills: overrides.skills || template.skills,
    personas: overrides.personas || template.personas,
    knowledgeSources: overrides.knowledgeSources || template.knowledgeSources,
    ioSchema: overrides.ioSchema || template.ioSchema,
  };
}

function buildMockHandshake(
  effectiveAgent: AgentTemplate,
  contract: ReturnType<typeof createContract>,
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

async function executeCardOutput(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  input: string,
  context: DeckRuntimeContext,
  contract: ReturnType<typeof createContract>,
): Promise<string> {
  if (context.backendInvoker) {
    return context.backendInvoker(card, effectiveAgent, input, context);
  }

  const promptText = resolvePromptTemplateContent(
    effectiveAgent.promptTemplate,
    context.promptTemplates,
  )
    .trim()
    .slice(0, 400);

  return [
    `[${card.title}] completed local deck step.`,
    `Contract task: ${contract.task}`,
    `Contract purpose: ${contract.purpose}`,
    effectiveAgent.provider || effectiveAgent.model
      ? `Agent: ${effectiveAgent.provider || 'local'} / ${effectiveAgent.model || 'unset'}`
      : '',
    effectiveAgent.tools.length > 0 ? `Tools: ${effectiveAgent.tools.join(', ')}` : '',
    context.seed ? `Seed: ${context.seed}` : '',
    promptText ? `Prompt excerpt: ${promptText}` : '',
    context.previousOutput ? `Previous output: ${context.previousOutput}` : '',
    `Input: ${input}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runCardWithContract(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  input: string,
  context: DeckRuntimeContext,
): Promise<CardRunResult> {
  const startedAt = new Date().toISOString();
  const contract = createContract({
    userInput: context.userInput || input,
    card,
    previousOutput: context.stepIndex > 0 ? context.previousOutput : undefined,
    effectiveAgent,
  });
  const handshake = buildMockHandshake(effectiveAgent, contract);

  try {
    const output = await executeCardOutput(card, effectiveAgent, input, context, contract);
    const scored = scoreResult(output, contract);

    return {
      output,
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      seed: context.seed,
      contract,
      handshake,
      score: scored.score,
      passed: scored.passed,
      scoreDetail: scored.detail,
    };
  } catch (err: any) {
    const scored = scoreResult(null, contract);
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
    };
  }
}

export async function executeSimpleDeck(
  document: DeckDocument,
  templates: AgentTemplate[],
  options: ExecuteSimpleDeckOptions = {},
): Promise<DeckRun> {
  const runId = `deck_run_${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = new Date().toISOString();
  const input = String(options.input || '');
  const validation = validateDeckDocument(document, { enforceStartCard: true });
  const executionPlan = buildExecutionPlan(document);
  const steps: DeckRunStep[] = [];

  if (!validation.ok) {
    return buildRunSnapshot(
      runId,
      document,
      input,
      startedAt,
      steps,
      validation,
      executionPlan,
      'error',
      {
        endedAt: new Date().toISOString(),
        error: 'Deck validation failed.',
      },
    );
  }

  if (
    executionPlan.hasBranches ||
    executionPlan.hasConditionalRoutes ||
    executionPlan.simpleOrderCardIds.length !== document.nodes.length
  ) {
    // TODO: support conditional, success/error, and looped deck runtime paths in Phase 4+.
    return buildRunSnapshot(
      runId,
      document,
      input,
      startedAt,
      steps,
      validation,
      executionPlan,
      'error',
      {
        endedAt: new Date().toISOString(),
        error: 'Phase 3 only supports simple default-route decks.',
      },
    );
  }

  let previousOutput = input;

  for (const planCard of executionPlan.cards) {
    const card = document.nodes.find((node) => node.id === planCard.cardId);
    if (!card) {
      return buildRunSnapshot(
        runId,
        document,
        input,
        startedAt,
        steps,
        validation,
        executionPlan,
        'error',
        {
          endedAt: new Date().toISOString(),
          error: `Card "${planCard.cardId}" is missing from the current deck.`,
        },
      );
    }

    const effectiveAgent = resolveEffectiveAgent(card, templates);
    if (!effectiveAgent) {
      return buildRunSnapshot(
        runId,
        document,
        input,
        startedAt,
        steps,
        validation,
        executionPlan,
        'error',
        {
          endedAt: new Date().toISOString(),
          error: `Template "${card.templateId}" could not be resolved.`,
        },
      );
    }

    const variantOutputs: string[] = [];

    for (const variant of planCard.variants) {
      const result = await runCardWithContract(card, effectiveAgent, previousOutput, {
        runId,
        stepIndex: steps.length,
        userInput: input,
        previousOutput,
        promptTemplates: options.promptTemplates,
        seed: variant.seed,
        backendInvoker: options.backendInvoker,
      });

      const step: DeckRunStep = {
        id: `step_${steps.length + 1}`,
        executionId: variant.executionId,
        cardId: card.id,
        templateId: card.templateId,
        title: card.title,
        input: previousOutput,
        effectiveAgent,
        output: result.output,
        status: result.status,
        error: result.error,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        seed: result.seed,
        contract: result.contract,
        handshake: result.handshake,
        score: result.score,
        passed: result.passed,
        scoreDetail: result.scoreDetail,
      };

      steps.push(step);
      options.onStep?.(
        step,
        buildRunSnapshot(
          runId,
          document,
          input,
          startedAt,
          steps,
          validation,
          executionPlan,
          'running',
        ),
      );

      if (step.status === 'error') {
        return buildRunSnapshot(
          runId,
          document,
          input,
          startedAt,
          steps,
          validation,
          executionPlan,
          'error',
          {
            endedAt: new Date().toISOString(),
            error: step.error || `Card "${card.id}" failed.`,
          },
        );
      }

      if (step.output) {
        variantOutputs.push(step.output);
      }
    }

    if (variantOutputs.length > 0) {
      // TODO: fan clone variants into downstream branches instead of collapsing them.
      previousOutput = variantOutputs.join('\n\n');
    }
  }

  return buildRunSnapshot(
    runId,
    document,
    input,
    startedAt,
    steps,
    validation,
    executionPlan,
    'success',
    {
      endedAt: new Date().toISOString(),
    },
  );
}
