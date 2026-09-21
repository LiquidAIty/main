import type { RuntimeEvent } from '../../../../../apps/backend/src/contracts/runtimeEvents';

export type CardTerminalEvent = RuntimeEvent;

const PUBLIC_KINDS = new Set([
  'session',
  'mission',
  'model',
  'tool_call',
  'tool_result',
  'tool_error',
  'child_started',
  'child_finished',
  'task',
  'error',
  'permission',
  'skill',
  'autoskill',
  'artifact',
  'completion',
]);

export function reconcileTerminalEvents(events: CardTerminalEvent[]): CardTerminalEvent[] {
  const byId = new Map<string, CardTerminalEvent>();
  for (const event of events) {
    if (event.id && PUBLIC_KINDS.has(event.kind)) {
      const key = [
        event.projectId,
        event.deckId,
        event.cardId,
        event.runId,
        event.taskId || '',
        event.agentId || '',
        event.id,
      ].join('\u0000');
      byId.set(key, event);
    }
  }
  // The adapter supplies source order. Replacing by stable ID updates partial
  // model text/tool state without appending a second copy on every status read.
  return [...byId.values()].sort((a, b) => {
    if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) {
      return a.timestamp.localeCompare(b.timestamp);
    }
    return a.sequence - b.sequence || a.id.localeCompare(b.id);
  });
}
