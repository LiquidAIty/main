import type { ClaudeToolEvent, ClaudeToolResult } from './types';

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

export function normalizeClaudeToolEvent(raw: unknown): ClaudeToolEvent {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const type = String(input.type || 'status').trim().toLowerCase();
  const status = String(input.status || '').trim().toLowerCase();

  return {
    type:
      type === 'command' || type === 'file' || type === 'diff' || type === 'result' || type === 'error'
        ? (type as ClaudeToolEvent['type'])
        : 'status',
    status:
      status === 'queued' || status === 'running' || status === 'success' || status === 'error'
        ? (status as NonNullable<ClaudeToolEvent['status']>)
        : undefined,
    toolName: 'claude',
    summary: String(input.summary || '').trim() || 'Claude tool event',
    command: input.command ? String(input.command).trim() : null,
    filesTouched: uniqueStrings(input.filesTouched),
    diffSummary: input.diffSummary ? String(input.diffSummary).trim() : null,
    timestamp: String(input.timestamp || new Date().toISOString()),
  };
}

export function normalizeClaudeToolResult(raw: unknown): ClaudeToolResult {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const status = String(input.status || 'queued').trim().toLowerCase();
  const eventSource = Array.isArray(input.events) ? input.events : [];

  return {
    status:
      status === 'running' || status === 'success' || status === 'error'
        ? (status as ClaudeToolResult['status'])
        : 'queued',
    action: 'claude',
    commandSummary: uniqueStrings(input.commandSummary),
    filesTouched: uniqueStrings(input.filesTouched),
    diffSummary: uniqueStrings(input.diffSummary),
    finalResult: String(input.finalResult || '').trim(),
    error: input.error ? String(input.error).trim() : null,
    events: eventSource.map((event) => normalizeClaudeToolEvent(event)),
  };
}
