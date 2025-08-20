
export type AgentContext = {
  userId?: string;
  sessionId?: string;
  threadId?: string;          // per-dept memory key
  datasetIds?: string[];
  meta?: Record<string, any>;
};
