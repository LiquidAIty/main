/**
 * IngestTrace: Single source of truth for KG ingest status
 * In-memory ring buffer per project (NO DB schema changes)
 */

export interface IngestStepState {
  ok: boolean;
  t_ms?: number;
  chunk_count?: number;
  raw_len?: number;
  parse_error?: string;
  vectors_count?: number;
  entity_count?: number;
  relation_count?: number;
  error?: string;
  // Evidence fields for debugging
  model_key?: string;
  prompt_system?: string;
  prompt_user_preview?: string;
  prompt_user_sha1?: string;
  raw_output_preview?: string;
  raw_output_sha1?: string;
}

export interface IngestTrace {
  trace_id: string;
  project_id: string;
  created_at: string;
  model_key: string;
  embed_model: string;
  doc_id: string;
  src: string;
  step_states: {
    start: IngestStepState;
    chunking?: IngestStepState;
    embed?: IngestStepState;
    write?: IngestStepState;
    done?: IngestStepState;
  };
  error?: {
    step: string;
    code: string;
    message: string;
  };
  status_write?: {
    ok: boolean;
    error?: string;
  };
}

// In-memory ring buffer: Map<projectId, IngestTrace[]>
const TRACE_BUFFER = new Map<string, IngestTrace[]>();
const MAX_TRACES_PER_PROJECT = 20;

/**
 * Store a new trace for a project
 */
export function storeTrace(trace: IngestTrace): void {
  const traces = TRACE_BUFFER.get(trace.project_id) || [];
  traces.push(trace);
  
  // Keep only last N traces
  while (traces.length > MAX_TRACES_PER_PROJECT) {
    traces.shift();
  }
  
  TRACE_BUFFER.set(trace.project_id, traces);
}

/**
 * Get last trace for a project
 */
export function getLastTrace(projectId: string): IngestTrace | null {
  const traces = TRACE_BUFFER.get(projectId) || [];
  return traces[traces.length - 1] || null;
}

/**
 * Get last N traces for a project
 */
export function getTraces(projectId: string, limit: number = 20): IngestTrace[] {
  const traces = TRACE_BUFFER.get(projectId) || [];
  return traces.slice(-limit);
}

/**
 * Create a new trace with start step
 */
export function createTrace(params: {
  project_id: string;
  model_key: string;
  embed_model: string;
  doc_id: string;
  src: string;
}): IngestTrace {
  return {
    trace_id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    created_at: new Date().toISOString(),
    ...params,
    step_states: {
      start: { ok: true, t_ms: 0 },
    },
  };
}
