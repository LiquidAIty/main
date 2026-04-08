import type { PlanWikiTaskPacket } from '../../planwiki/types';

import { normalizeClaudeToolEvent, normalizeClaudeToolResult } from './normalize';
import type {
  ClaudeToolAllowedAction,
  ClaudeToolInvocation,
  ClaudeToolResult,
} from './types';

const DEFAULT_ALLOWED_ACTIONS: ClaudeToolAllowedAction[] = [
  'read',
  'search',
  'edit',
  'create',
  'command',
  'test',
  'diff',
];

export function createClaudeToolInvocation(
  packet: PlanWikiTaskPacket,
  options: {
    allowedActions?: ClaudeToolAllowedAction[];
  } = {},
): ClaudeToolInvocation {
  return {
    engine: 'claude_code_style',
    repoPath: packet.repoPath,
    objective: packet.objective,
    selectedFiles: [...packet.selectedFiles],
    constraints: [...packet.constraints],
    allowedActions: options.allowedActions?.length ? [...options.allowedActions] : [...DEFAULT_ALLOWED_ACTIONS],
    planExcerpt: packet.planExcerpt,
    blackboardContext: packet.blackboardContext,
    outputFormat: packet.outputFormat,
    reviewRequired: packet.review.required,
    rawPacket: packet,
  };
}

export function buildClaudeToolPrompt(invocation: ClaudeToolInvocation): string {
  const lines = [
    `Objective: ${invocation.objective}`,
    `Repo path: ${invocation.repoPath}`,
    invocation.selectedFiles.length ? `Selected files: ${invocation.selectedFiles.join(', ')}` : '',
    invocation.constraints.length ? `Constraints: ${invocation.constraints.join(' | ')}` : '',
    `Allowed actions: ${invocation.allowedActions.join(', ')}`,
    `Output format: ${invocation.outputFormat}`,
    invocation.reviewRequired ? 'Review: required before final acceptance.' : 'Review: optional.',
    invocation.planExcerpt ? `Plan excerpt:\n${invocation.planExcerpt}` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

export function createQueuedClaudeToolResult(invocation: ClaudeToolInvocation): ClaudeToolResult {
  return normalizeClaudeToolResult({
    status: 'queued',
    action: 'claude',
    commandSummary: [],
    filesTouched: invocation.selectedFiles,
    diffSummary: [],
    finalResult: '',
    error: null,
    events: [
      normalizeClaudeToolEvent({
        type: 'status',
        status: 'queued',
        summary: `Queued Claude-style execution for ${invocation.objective}`,
      }),
    ],
  });
}
