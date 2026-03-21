import type {
  AgentCardInstance,
  AgentTemplate,
  TaskContract,
} from '../../types/agentgraph';

export type CreateContractInput = {
  userInput: string;
  card: AgentCardInstance;
  previousOutput?: string;
  effectiveAgent?: AgentTemplate | null;
};

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function createContract({
  userInput,
  card,
  previousOutput,
  effectiveAgent,
}: CreateContractInput): TaskContract {
  const normalizedUserInput = compactText(String(userInput || ''));
  const normalizedPreviousOutput = compactText(String(previousOutput || ''));
  const purpose =
    compactText(card.subtitle || '') ||
    compactText(effectiveAgent?.name || '') ||
    `Complete the "${card.title}" deck step.`;
  const requiredOutputFormat =
    effectiveAgent?.ioSchema && typeof effectiveAgent.ioSchema === 'object' ? 'json' : 'text';

  return {
    id: `contract_${card.id}_${Math.random().toString(36).slice(2, 10)}`,
    task:
      compactText(
        [
          card.title,
          normalizedUserInput || normalizedPreviousOutput || 'Complete the assigned step.',
        ].join(': '),
      ) || card.title,
    purpose,
    constraints: [
      'Stay focused on the assigned deck step.',
      'Return directly usable output without filler.',
      requiredOutputFormat === 'json'
        ? 'Return valid JSON matching the required schema.'
        : 'Return concise plain text.',
      normalizedPreviousOutput ? 'Use the prior deck output as working context.' : 'Use the incoming user request as the primary context.',
    ],
    requiredOutput: {
      format: requiredOutputFormat,
      schema: requiredOutputFormat === 'json' ? effectiveAgent?.ioSchema : undefined,
    },
    scoring: {
      passThreshold: 6,
      hardChecks: [
        'non_empty_output',
        'minimum_length',
        requiredOutputFormat === 'json' ? 'json_if_required' : 'text_if_required',
      ],
      rubric: [
        { name: 'completeness', maxScore: 3 },
        { name: 'clarity', maxScore: 3 },
        { name: 'coverage', maxScore: 4 },
      ],
    },
    context: {
      userInput: normalizedUserInput || undefined,
      priorOutput: normalizedPreviousOutput || undefined,
    },
  };
}
