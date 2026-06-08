import type { CardRunScoreDetail, TaskContract } from '../types';

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function scoreCompleteness(output: string, maxScore: number): number {
  if (!output) return 0;
  if (output.length >= 240) return maxScore;
  if (output.length >= 120) return Math.max(1, maxScore - 1);
  return 1;
}

function scoreClarity(output: string, maxScore: number): number {
  if (!output) return 0;
  const hasStructure = output.includes('\n') || output.includes(':') || output.includes('- ');
  const sentenceCount = output
    .split(/[.!?]+/g)
    .map((part) => part.trim())
    .filter(Boolean).length;
  if (hasStructure && sentenceCount >= 2) return maxScore;
  if (hasStructure || sentenceCount >= 2) return Math.max(1, maxScore - 1);
  return 1;
}

function scoreCoverage(output: string, contract: TaskContract, maxScore: number): number {
  if (!output) return 0;
  const expectedTokens = new Set(tokenize(`${contract.task} ${contract.purpose}`).slice(0, 8));
  if (expectedTokens.size === 0) return maxScore;
  const outputTokens = new Set(tokenize(output));
  let matches = 0;
  expectedTokens.forEach((token) => {
    if (outputTokens.has(token)) matches += 1;
  });
  const ratio = matches / expectedTokens.size;
  if (ratio >= 0.6) return maxScore;
  if (ratio >= 0.3) return Math.max(1, maxScore - 1);
  return 1;
}

export function scoreContractResult(
  result: string | null | undefined,
  contract: TaskContract,
): { score: number; passed: boolean; detail: CardRunScoreDetail } {
  const output = String(result || '').trim();
  const hardChecks = contract.scoring.hardChecks.map((name) => {
    switch (name) {
      case 'non_empty_output':
        return { name, passed: output.length > 0 };
      case 'minimum_length':
        return { name, passed: output.length >= 40 };
      case 'json_if_required':
        if (contract.requiredOutput.format !== 'json') return { name, passed: true };
        try {
          JSON.parse(output);
          return { name, passed: true };
        } catch {
          return { name, passed: false };
        }
      case 'text_if_required':
        return {
          name,
          passed: contract.requiredOutput.format !== 'text' || output.length > 0,
        };
      default:
        return { name, passed: true };
    }
  });

  const rubric = contract.scoring.rubric.map((item) => {
    switch (item.name) {
      case 'completeness':
        return {
          name: item.name,
          score: scoreCompleteness(output, item.maxScore),
          maxScore: item.maxScore,
        };
      case 'clarity':
        return {
          name: item.name,
          score: scoreClarity(output, item.maxScore),
          maxScore: item.maxScore,
        };
      case 'coverage':
        return {
          name: item.name,
          score: scoreCoverage(output, contract, item.maxScore),
          maxScore: item.maxScore,
        };
      default:
        return {
          name: item.name,
          score: 0,
          maxScore: item.maxScore,
        };
    }
  });

  const total = rubric.reduce((sum, item) => sum + item.score, 0);
  const maxScore = rubric.reduce((sum, item) => sum + item.maxScore, 0);
  const passed =
    hardChecks.every((check) => check.passed) && total >= contract.scoring.passThreshold;

  return {
    score: total,
    passed,
    detail: {
      hardChecks,
      rubric,
      total,
      maxScore,
    },
  };
}
