/**
 * Concise backend dev-terminal trace for real model-runtime events.
 *
 * The only source is the events the runtime ACTUALLY emits through the existing
 * Main Hermes ACP and configured-card callbacks: text / tool_start /
 * tool_result / progress / permission / done / error. This never fabricates a lifecycle line
 * for something that did not happen, never prints raw prompts / full model output /
 * secrets, and never adds a second event bus or route — it only formats an event
 * that already flowed to the browser SSE, so the same event is now also legible in
 * the backend terminal.
 *
 * Deeper subsystem families are NOT emitted at
 * this boundary today — they occur inside the Python card run and are not relayed
 * through the chat event stream — so they are intentionally absent, not faked.
 */

export type TraceableEvent = { kind: string; [key: string]: unknown };

/** Runtime/provider error text is untrusted and may contain credentials in an
 * unknown format. Never echo it to logs; correlation and the typed failure code
 * carry the safe operational signal. */
export function redactTrace(value: string): string {
  return String(value ?? '').trim() ? '<redacted>' : '';
}

function isCardDoorway(toolName: string): boolean {
  return toolName === 'card.run_assistant_agent'
    || toolName.endsWith('__card_run_assistant_agent');
}

/**
 * Format ONE real Hermes ACP chat event into a concise trace line, or null when it
 * carries no lifecycle signal worth a line (streamed text chunks, the final `done`
 * text, the session id). Those are not fabricated away — they simply are not a
 * per-event lifecycle line; the request start/end are logged by the route itself.
 */
export function formatHarnessTrace(event: TraceableEvent, correlationId: string): string | null {
  const corr = `corr=${correlationId}`;
  switch (event.kind) {
    case 'tool_start': {
      const name = String(event.toolName || 'tool');
      return isCardDoorway(name) ? `[agent] card doorway started ${corr}` : `[tool] ${name} started ${corr}`;
    }
    case 'tool_result': {
      const name = String(event.toolName || 'tool');
      const label = isCardDoorway(name) ? '[agent] card doorway' : `[tool] ${name}`;
      return `${label} ${event.isError ? 'failed' : 'completed'} ${corr}`;
    }
    case 'permission':
      return `[harness] permission requested ${corr}`;
    case 'error':
      return `[result] failed ${corr} reason=${redactTrace(String(event.message || 'error'))}`;
    default:
      return null;
  }
}

/** The backend dev terminal sink. `console.log` IS the [backend] concurrently pane
 * for this app (matches the existing [BOOT] startup logging). */
export function logHarnessTrace(line: string): void {
  console.log(line);
}
