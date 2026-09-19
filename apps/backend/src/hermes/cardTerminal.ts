import type { RuntimeIdentity, RuntimeEvent, RuntimeObservation } from '../contracts/runtimeEvents';
import type { HermesKanbanTaskSnapshot } from '../routes/hermesKanban.routes';

export type CardTerminalEvent = RuntimeEvent;

// Presentation-only credential redaction. Never applied to a runtime request,
// saved result, model prompt, or native session data.
export function terminalText(value: unknown): string {
  const sensitive = new Set(['authorization', 'password', 'secret', 'token', 'access_token',
    'refresh_token', 'api_key', 'apikey', 'bearer', 'env', 'environment', 'headers', 'credentials']);
  const secretValues = Object.entries(process.env)
    .filter(([key, entry]) => /TOKEN|SECRET|PASSWORD|API.?KEY|CREDENTIAL|AUTH/i.test(key) && entry && entry.length >= 6)
    .map(([, entry]) => entry!);
  const redactString = (value: string): string => {
    let result = value.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
      .replace(/\b([A-Z][A-Z0-9_]*=)(?:"[^"]*"|'[^']*'|[^\s]+)/g, '$1[redacted]')
      .replace(/\b(password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
    for (const secret of secretValues) result = result.split(secret).join('[redacted]');
    return result;
  };
  const redact = (item: unknown): unknown => {
    if (typeof item === 'string') return redactString(item);
    if (Array.isArray(item)) return item.map(redact);
    if (item && typeof item === 'object') return Object.fromEntries(
      Object.entries(item).map(([key, entry]) => [key,
        sensitive.has(key.toLowerCase()) || /(?:_token|_secret|_password|_api_key)$/i.test(key)
          ? '[redacted]' : ['blob', 'base64', 'binary', 'image_data'].includes(key.toLowerCase())
            ? '[binary omitted; use artifact reference]' : redact(entry)]),
    );
    return item;
  };
  if (typeof value !== 'string') return JSON.stringify(redact(value)) ?? '';
  try { return JSON.stringify(redact(JSON.parse(value)), null, 2); }
  catch { return String(redact(value)); }
}

export function terminalIdentity(run: any): RuntimeIdentity {
  return {
    projectId: String(run.projectId || ''), deckId: String(run.deckId || ''),
    cardId: String(run.cardId || ''), cardName: String(run.terminal?.cardName || ''),
    runId: String(run.runId || ''), parentRunId: run.terminal?.parentRunIds?.[0] || null,
    nativeChildId: null,
  };
}

export function buildCardTerminal(run: any): RuntimeObservation {
  const identity = terminalIdentity(run);
  const events: CardTerminalEvent[] = [];
  if (run.startedAt) events.push({ ...identity, id: `${identity.runId}:session`, kind: 'session',
    sequence: 0, timestamp: run.startedAt, status: String(run.state) });
  for (const child of run.terminal?.children || []) {
    const childIdentity = { ...identity, runId: child.runId, cardId: child.cardId,
      cardName: child.cardName, parentRunId: child.parentRunId, nativeChildId: child.nativeChildId || null };
    if (child.startedAt) events.push({ ...childIdentity, id: `${child.runId}:start`, kind: 'child_started',
      sequence: 0, timestamp: child.startedAt, status: 'running' });
    if (child.finishedAt) events.push({ ...childIdentity, id: `${child.runId}:finish`, kind: 'child_finished',
      sequence: 0, timestamp: child.finishedAt, status: child.state,
      detail: child.errorCode ? terminalText(child.errorCode) : undefined });
  }
  events.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')) || a.sequence - b.sequence || a.id.localeCompare(b.id));
  const active = run.state === 'running';
  const pending = run.state === 'pending';
  return {
    ...identity, events,
    // The persisted root Run and persisted active child Runs are observable;
    // native stream detail remains on the Gateway/TUI surface that owns it.
    activeAgentCount: active ? 1 + Number(run.terminal?.activeChildren || 0) : 0,
    observation: active || pending ? 'unavailable' : 'finished',
    unavailableReason: active ? (run.runtimeMode === 'magentic_one'
      ? 'magentic_execution_headless' : 'hermes_gateway_stream_only') : null,
    finalText: terminalText(run.result || ''),
    errorCode: run.errorCode || null,
    errorSummary: terminalText(run.errorSummary || ''),
    configuration: run.terminal?.configuration,
  };
}

/** Native task events and attempt records, never inferred worker roles or prose. */
export function projectKanbanTerminal(run: any, snapshots: HermesKanbanTaskSnapshot[]): RuntimeObservation {
  const terminal = buildCardTerminal(run);
  const identity = terminalIdentity(run);
  const events: RuntimeEvent[] = [...terminal.events];
  const timestamp = (value: unknown): string | null => typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString() : null;
  let running = 0;
  for (const snapshot of snapshots) {
    const taskId = String(snapshot.task.id);
    for (const event of snapshot.events) {
      // Native task_events.id is persistent across replay, unlike a UI array index.
      if (typeof event.id !== 'number' && typeof event.id !== 'string') continue;
      const agentId = event.run_id == null ? null : String(event.run_id);
      events.push({ ...identity, taskId, agentId, nativeChildId: agentId,
        id: `${identity.runId}:kanban:${taskId}:event:${event.id}`, kind: 'task',
        sequence: Number(event.id), timestamp: timestamp(event.created_at),
        status: String(event.kind || ''), detail: terminalText(event.payload) });
    }
    for (const attempt of snapshot.runs) {
      if (attempt.id == null) continue;
      const agentId = String(attempt.id);
      if (attempt.ended_at == null && attempt.status === 'running') running++;
      const base = { ...identity, taskId, agentId, nativeChildId: agentId };
      const started = timestamp(attempt.started_at);
      const ended = timestamp(attempt.ended_at);
      if (started) events.push({ ...base, id: `${identity.runId}:kanban:${taskId}:attempt:${agentId}:start`,
        kind: 'child_started', sequence: 0, timestamp: started, status: 'running',
        detail: terminalText({ profile: attempt.profile, step: attempt.step_key }) });
      if (ended) events.push({ ...base, id: `${identity.runId}:kanban:${taskId}:attempt:${agentId}:end`,
        kind: 'child_finished', sequence: 0, timestamp: ended, status: String(attempt.status),
        detail: terminalText({ outcome: attempt.outcome, error: attempt.error, summary: attempt.summary }) });
    }
  }
  events.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')) || a.sequence - b.sequence || a.id.localeCompare(b.id));
  return { ...terminal, events, activeAgentCount: run.state === 'running' ? running : 0,
    observation: ['running', 'pending'].includes(run.state) ? 'live' : 'finished', unavailableReason: null,
    // Exact native structured task fields. Credential redaction does not rewrite task state.
    nativeTasks: snapshots.map(({ task }) => JSON.parse(terminalText(task))),
  };
}
