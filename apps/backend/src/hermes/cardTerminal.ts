import type { HermesRunSnapshot, HermesSessionEvent } from './mainAdapter';
import type { RuntimeIdentity, RuntimeEvent, RuntimeObservation } from '../contracts/runtimeEvents';
import type { HermesKanbanTaskSnapshot } from '../routes/hermesKanban.routes';

export type CardTerminalEvent = RuntimeEvent;

// Presentation-only credential redaction. Never applied to a runtime request,
// saved result, model prompt, or native transcript.
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

export function buildCardTerminal(run: any, snapshot: HermesRunSnapshot | null): RuntimeObservation {
  const identity = terminalIdentity(run);
  if (snapshot && (snapshot.runId !== identity.runId || snapshot.cardId !== identity.cardId
    || snapshot.projectId !== identity.projectId || snapshot.deckId !== identity.deckId)) {
    throw new Error('card_terminal_snapshot_identity_mismatch');
  }
  const events: CardTerminalEvent[] = [];
  if (run.startedAt) events.push({ ...identity, id: `${identity.runId}:session`, kind: 'session',
    sequence: 0, timestamp: run.startedAt, status: String(run.state) });
  if (snapshot?.modelBlocks?.length) {
    for (const block of snapshot.modelBlocks) events.push({ ...identity,
      id: `${identity.runId}:model:${block.sequence}`, kind: 'model', sequence: block.sequence,
      timestamp: block.timestamp, text: terminalText(block.text) });
  } else if (snapshot?.fullText) events.push({ ...identity, id: `${identity.runId}:model`, kind: 'model',
    sequence: snapshot.textSequence, timestamp: snapshot.textTimestamp, text: terminalText(snapshot.fullText) });
  for (const tool of snapshot?.tools || []) {
    events.push(projectHermesEvent(identity, { ...tool, kind: 'tool_start' }, tool.sequence, tool.timestamp)!);
    if (tool.partialOutput) events.push(projectHermesEvent(identity,
      { ...tool, kind: 'tool_progress', output: tool.partialOutput },
      tool.partialSequence ?? tool.sequence, tool.partialTimestamp || null)!);
    if (typeof tool.isError === 'boolean') events.push(projectHermesEvent(identity,
      { ...tool, kind: 'tool_result', output: tool.output || '' },
      tool.completedSequence ?? tool.sequence, tool.completedAt || null)!);
  }
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
    // One executing owner plus only observed executing child Runs, never capacity.
    activeAgentCount: active ? (snapshot ? 1 + Number(run.terminal?.activeChildren || 0) : null) : 0,
    observation: snapshot ? 'live' : active || pending ? 'unavailable' : 'finished',
    unavailableReason: active && !snapshot ? (run.runtimeKind === 'autogen'
      ? 'autogen_adapter_completion_only' : 'hermes_active_turn_unavailable') : null,
    transcript: run.terminal?.transcript || { sessionId: null, unavailableReason: 'native_session_identity_unavailable' },
    finalText: terminalText(run.result || ''),
    errorCode: run.errorCode || null,
    errorSummary: terminalText(run.errorSummary || ''),
    configuration: snapshot?.configuration || run.terminal?.configuration,
  };
}

/** One public adapter for native ACP live events and native transcript replay. */
export function projectHermesEvent(identity: RuntimeIdentity, event: Record<string, any>,
  sequence: number, timestamp: string | null, eventId = `${identity.runId}:event:${sequence}`): RuntimeEvent | null {
  const toolPhase = event.kind === 'tool_start' ? 'start' : event.kind === 'tool_progress' ? 'partial'
    : event.kind === 'tool_result' ? 'result' : null;
  const id = toolPhase && event.toolUseId ? `${identity.runId}:tool:${event.toolUseId}:${toolPhase}` : eventId;
  const base = { ...identity, id, sequence, timestamp };
  if (event.kind === 'text') return { ...base, kind: 'model', text: terminalText(event.text) };
  if (event.kind === 'tool_start') return { ...base, kind: 'tool_call', toolName: event.toolName,
    toolUseId: event.toolUseId, detail: terminalText(event.argsJson) };
  if (event.kind === 'tool_result') return { ...base, kind: event.isError ? 'tool_error' : 'tool_result',
    toolName: event.toolName, toolUseId: event.toolUseId,
    status: event.isError ? 'failed' : 'completed', detail: terminalText(event.output) };
  if (event.kind === 'tool_progress') return { ...base, kind: 'tool_result', status: 'running',
    toolName: event.toolName, toolUseId: event.toolUseId, detail: terminalText(event.output) };
  if (event.kind === 'session') return { ...base, kind: 'session', status: 'running',
    sessionId: typeof event.sessionId === 'string' ? event.sessionId : null,
    detail: terminalText(event.configuration || {}) };
  if (event.kind === 'done') return { ...base, kind: 'completion', status: 'completed', text: terminalText(event.fullText) };
  if (event.kind === 'error') return { ...base, kind: 'error', status: 'failed',
    text: terminalText(event.message), detail: terminalText({ code: event.code }) };
  if (event.kind === 'permission') return { ...base, kind: 'permission', status: 'waiting', text: terminalText(event.question) };
  // Thoughts, prompts, raw IDFs and unrecognized vendor notifications are not public output.
  return null;
}

/** Native task events and attempt records, never inferred worker roles or prose. */
export function projectKanbanTerminal(run: any, snapshots: HermesKanbanTaskSnapshot[]): RuntimeObservation {
  const terminal = buildCardTerminal(run, null);
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

/** Native #2 replay, including #5 tool status. No user/IDF or reasoning replay. */
export function terminalHistoryEvents(run: any, native: HermesSessionEvent[]): CardTerminalEvent[] {
  const identity = terminalIdentity(run);
  return native.flatMap((event, index): CardTerminalEvent[] => {
    const projected = projectHermesEvent(identity, event, index, null, `${identity.runId}:history:${index}`);
    return projected ? [projected] : [];
  });
}
