export type StreamEvent = {
  type: string;
  data?: any;
};

export type ToolStatus =
  | 'ok'
  | 'error'
  | 'completed'
  | 'queued'
  | 'not_implemented'
  | 'not_found'
  | 'expired';

export type ToolArtifact = {
  type: string;
  data?: any;
  content?: any;
};

export type ToolEvent = {
  type: string;
  data: any;
};

export type ToolResult = {
  jobId: string;
  status: ToolStatus;
  events: ToolEvent[];
  artifacts: ToolArtifact[];
  metrics?: Record<string, any>;
};

export type TaskEnvelope = {
  userId: string;
  task: string;
  tool?: string;
  params?: any;
  input?: any; // Keep existing field for backward compatibility
};

export interface MemoryRecord {
  kind: 'user' | 'system';
  scope: string;
  key: string;
  value: any;
  ttl?: number;
}
