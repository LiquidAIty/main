import type { PlanWikiOutputFormat, PlanWikiTaskPacket } from '../../planwiki/types';

export const OPENCLAUDE_THIRD_PARTY_PREFIX = 'third_party/openclaude';

export type ClaudeToolAllowedAction =
  | 'read'
  | 'search'
  | 'edit'
  | 'create'
  | 'move'
  | 'delete'
  | 'command'
  | 'test'
  | 'diff';

export type ClaudeToolInvocation = {
  engine: 'claude_code_style';
  repoPath: string;
  objective: string;
  selectedFiles: string[];
  constraints: string[];
  allowedActions: ClaudeToolAllowedAction[];
  planExcerpt: string;
  blackboardContext: PlanWikiTaskPacket['blackboardContext'];
  outputFormat: PlanWikiOutputFormat;
  reviewRequired: boolean;
  rawPacket: PlanWikiTaskPacket;
};

export type ClaudeToolEvent = {
  type: 'status' | 'command' | 'file' | 'diff' | 'result' | 'error';
  status?: 'queued' | 'running' | 'success' | 'error';
  toolName: 'claude';
  summary: string;
  command?: string | null;
  filesTouched?: string[];
  diffSummary?: string | null;
  timestamp: string;
};

export type ClaudeToolResult = {
  status: 'queued' | 'running' | 'success' | 'error';
  action: 'claude';
  commandSummary: string[];
  filesTouched: string[];
  diffSummary: string[];
  finalResult: string;
  error: string | null;
  events: ClaudeToolEvent[];
};
