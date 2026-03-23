import { randomUUID } from 'crypto';
import { resolveEffectiveAgent, runCardWithContract } from '../cards/runtime';
import { buildExecutionPlan } from '../decks/executionPlan';
import { validateDeckDocument } from '../decks/validation';
import type {
  AgentTemplate,
  DeckDocument,
  DeckRun,
  DeckRunStep,
  PromptTemplate,
} from '../types';

export type ExecuteDeckOptions = {
  input?: string;
  promptTemplates?: PromptTemplate[];
};

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

export async function executeDeck(
  document: DeckDocument,
  templates: AgentTemplate[],
  options: ExecuteDeckOptions = {},
): Promise<DeckRun> {
  const runId = `deck_run_${randomUUID().slice(0, 8)}`;
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
        error: 'Builder v3 currently supports simple default-route decks only.',
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
        userInput: input,
        previousOutput,
        promptTemplates: options.promptTemplates,
        seed: variant.seed,
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
        improvementPromptBit: result.improvementPromptBit,
        inputSummary: result.inputSummary,
        outputSummary: result.outputSummary,
      };

      steps.push(step);

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
