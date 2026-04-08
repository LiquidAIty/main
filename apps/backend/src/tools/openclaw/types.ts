import type { PlanWikiMergeStrategy, PlanWikiTaskPacket } from '../../planwiki/types';

export const OPENCLAW_THIRD_PARTY_PREFIX = 'third_party/openclaw';

export type OpenClawSwarmMode = 'explore' | 'compare' | 'generate' | 'review';

export type OpenClawBranchResult = {
  branchId: string;
  summary: string;
  filesConsidered: string[];
  recommendation: string;
};

export type OpenClawSwarmRequest = {
  engine: 'openclaw';
  nodeId: string | null;
  objective: string;
  repoPath: string;
  selectedFiles: string[];
  constraints: string[];
  workerCount: number;
  mode: OpenClawSwarmMode;
  mergeStrategy: Exclude<PlanWikiMergeStrategy, 'none'>;
  rawPacket: PlanWikiTaskPacket;
};

export type OpenClawEvent = {
  type: 'status' | 'branch' | 'merge' | 'error';
  summary: string;
  branchId?: string | null;
  timestamp: string;
};

export type OpenClawResult = {
  status: 'queued' | 'running' | 'success' | 'error';
  branches: OpenClawBranchResult[];
  mergeRequired: boolean;
  mergeStrategy: Exclude<PlanWikiMergeStrategy, 'none'>;
  recommendedNextStep: string;
  error: string | null;
  events: OpenClawEvent[];
};
