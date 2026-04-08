import type { OpenClawEvent, OpenClawResult } from './types';

function uniqueStrings(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const output: string[] = [];

  source.forEach((entry) => {
    const text = String(entry || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });

  return output;
}

export function normalizeOpenClawEvent(raw: unknown): OpenClawEvent {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const type = String(input.type || 'status').trim().toLowerCase();

  return {
    type:
      type === 'branch' || type === 'merge' || type === 'error'
        ? (type as OpenClawEvent['type'])
        : 'status',
    summary: String(input.summary || '').trim() || 'OpenClaw event',
    branchId: input.branchId ? String(input.branchId).trim() : null,
    timestamp: String(input.timestamp || new Date().toISOString()),
  };
}

export function normalizeOpenClawResult(raw: unknown): OpenClawResult {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const status = String(input.status || 'queued').trim().toLowerCase();
  const branches = Array.isArray(input.branches) ? input.branches : [];

  return {
    status:
      status === 'running' || status === 'success' || status === 'error'
        ? (status as OpenClawResult['status'])
        : 'queued',
    branches: branches.map((entry, index) => {
      const branch = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return {
        branchId: String(branch.branchId || `branch-${index + 1}`),
        summary: String(branch.summary || '').trim(),
        filesConsidered: uniqueStrings(branch.filesConsidered),
        recommendation: String(branch.recommendation || '').trim(),
      };
    }),
    mergeRequired: Boolean(input.mergeRequired ?? true),
    mergeStrategy:
      input.mergeStrategy === 'select_best' || input.mergeStrategy === 'summarize_all'
        ? (input.mergeStrategy as OpenClawResult['mergeStrategy'])
        : 'manual_review',
    recommendedNextStep:
      String(input.recommendedNextStep || '').trim() || 'Review swarm branches and merge the best path.',
    error: input.error ? String(input.error).trim() : null,
    events: (Array.isArray(input.events) ? input.events : []).map((event) => normalizeOpenClawEvent(event)),
  };
}
