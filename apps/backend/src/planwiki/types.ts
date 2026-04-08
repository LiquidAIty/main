import type { V3BlackboardField } from '../v3/types';

export type PlanWikiAllowedTool =
  | 'repo_graph'
  | 'claude'
  | 'openclaw'
  | 'blackboard'
  | 'thinkgraph'
  | 'knowgraph';

export type PlanWikiOutputFormat = 'text' | 'json' | 'patch' | 'review';

export type PlanWikiMergeStrategy = 'none' | 'select_best' | 'summarize_all' | 'manual_review';

export type PlanWikiHumanSection = {
  intent: string;
  why: string;
  steps: string[];
  risks: string[];
  notes: string[];
};

export type PlanWikiMachineSection = {
  currentObjective: string;
  repoPath: string;
  repoScope: string[];
  selectedFiles: string[];
  constraints: string[];
  allowedTools: PlanWikiAllowedTool[];
  outputFormat: PlanWikiOutputFormat;
  outputSchema?: Record<string, unknown> | null;
  blackboardReads: V3BlackboardField[];
  blackboardWrites: V3BlackboardField[];
  repoGraphQueries: string[];
  thinkGraphQueries: string[];
  knowGraphQueries: string[];
  mergeStrategy: PlanWikiMergeStrategy;
  swarm: {
    enabled: boolean;
    workerCount?: number | null;
    mode?: 'explore' | 'compare' | 'generate' | 'review' | null;
  };
};

export type PlanWikiDocument = {
  projectId?: string | null;
  human: PlanWikiHumanSection;
  machine: PlanWikiMachineSection;
};

export type PlanWikiTaskPacket = {
  packetVersion: 'planwiki.task.v1';
  projectId: string | null;
  objective: string;
  repoPath: string;
  repoScope: string[];
  selectedFiles: string[];
  constraints: string[];
  allowedTools: PlanWikiAllowedTool[];
  outputFormat: PlanWikiOutputFormat;
  outputSchema: Record<string, unknown> | null;
  planExcerpt: string;
  blackboardContext: {
    currentGoal: string | null;
    nextMove: string | null;
    findings: string[];
    openQuestions: string[];
  };
  graphContext: {
    repoGraphQueries: string[];
    thinkGraphQueries: string[];
    knowGraphQueries: string[];
  };
  review: {
    required: boolean;
    mergeStrategy: PlanWikiMergeStrategy;
  };
  swarm: {
    enabled: boolean;
    workerCount: number;
    mode: 'explore' | 'compare' | 'generate' | 'review' | null;
  };
};

export type PlanWikiCompileInput = {
  projectId?: string | null;
  repoPath?: string | null;
  blackboard?: {
    current_goal?: string | null;
    next_move?: string | null;
    findings?: string[];
    open_questions?: string[];
  } | null;
};

export type PlanWikiCompileResult = {
  packet: PlanWikiTaskPacket;
  downstreamPrompt: string;
};
