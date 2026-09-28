import type { RuntimeIdentity, RuntimeEvent, RuntimeObservation } from '../contracts/runtimeEvents';

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
