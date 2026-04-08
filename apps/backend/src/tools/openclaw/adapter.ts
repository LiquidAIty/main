import type { PlanWikiTaskPacket } from '../../planwiki/types';

import { normalizeOpenClawEvent, normalizeOpenClawResult } from './normalize';
import type { OpenClawResult, OpenClawSwarmRequest } from './types';

export function createOpenClawSwarmRequest(
  packet: PlanWikiTaskPacket,
  options: {
    nodeId?: string | null;
    workerCount?: number;
    mode?: OpenClawSwarmRequest['mode'];
  } = {},
): OpenClawSwarmRequest {
  return {
    engine: 'openclaw',
    nodeId: options.nodeId || null,
    objective: packet.objective,
    repoPath: packet.repoPath,
    selectedFiles: [...packet.selectedFiles],
    constraints: [...packet.constraints],
    workerCount: Math.max(2, options.workerCount || packet.swarm.workerCount || 3),
    mode: options.mode || packet.swarm.mode || 'explore',
    mergeStrategy:
      packet.review.mergeStrategy === 'select_best' || packet.review.mergeStrategy === 'summarize_all'
        ? packet.review.mergeStrategy
        : 'manual_review',
    rawPacket: packet,
  };
}

export function buildOpenClawMergePrompt(
  request: OpenClawSwarmRequest,
  branchResults: OpenClawResult['branches'] = [],
): string {
  const branchLines = branchResults.map(
    (branch) => `${branch.branchId}: ${branch.summary || branch.recommendation}`.trim(),
  );

  return [
    `Objective: ${request.objective}`,
    `Merge strategy: ${request.mergeStrategy}`,
    branchLines.length ? `Branches:\n${branchLines.join('\n')}` : 'Branches: none returned yet.',
    'Choose the best path, remove duplication, and surface conflicts explicitly.',
  ].join('\n');
}

export function createQueuedOpenClawResult(request: OpenClawSwarmRequest): OpenClawResult {
  return normalizeOpenClawResult({
    status: 'queued',
    branches: [],
    mergeRequired: true,
    mergeStrategy: request.mergeStrategy,
    recommendedNextStep: 'Wait for branch outputs, then run merge or review.',
    error: null,
    events: [
      normalizeOpenClawEvent({
        type: 'status',
        summary: `Queued OpenClaw swarm for ${request.objective}`,
      }),
    ],
  });
}
