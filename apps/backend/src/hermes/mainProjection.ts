import type {
  MainProjectionEvent,
  RuntimeEvent,
} from '../contracts/runtimeEvents';
import { terminalText } from './cardTerminal';
import type { MainCliProjection } from './mainCliBridge';

export type MainProjectionIdentity = {
  projectId: string;
  deckId: string;
  cardId: string;
  cardName: string;
  runId: string;
};

function runtimeKind(projection: MainCliProjection): RuntimeEvent['kind'] {
  switch (projection.category) {
    case 'conversation.input': return 'mission';
    case 'conversation.answer': return 'model';
    case 'execution.progress': return 'task';
    case 'execution.tool':
    case 'execution.command':
      return projection.state === 'started' ? 'tool_call' : 'tool_result';
    case 'execution.child':
      return projection.state === 'started' ? 'child_started' : 'child_finished';
    case 'execution.receipt':
      return projection.state === 'completed' ? 'completion' : 'session';
    case 'execution.error':
      return projection.toolName ? 'tool_error' : 'error';
  }
}

/** Add saved-Card/Run identity to one native Hermes semantic projection. */
export function projectMainRuntimeEvent(
  identity: MainProjectionIdentity,
  projection: MainCliProjection,
): MainProjectionEvent {
  const conversational = projection.category === 'conversation.input'
    || projection.category === 'conversation.answer';
  return {
    ...identity,
    parentRunId: null,
    nativeChildId: projection.nativeChildId || null,
    taskId: projection.nativeTaskId || null,
    agentId: projection.agentId || null,
    sessionId: projection.nativeSessionId || null,
    id: projection.id,
    kind: runtimeKind(projection),
    sequence: projection.sequence,
    timestamp: projection.timestamp,
    schemaVersion: 'liquidaity.main.projection.v1',
    category: projection.category,
    nativeTurnId: projection.nativeTurnId || null,
    operationId: projection.operationId || null,
    status: projection.state,
    ...(projection.text !== undefined
      ? { text: conversational ? projection.text : terminalText(projection.text) }
      : {}),
    ...(projection.toolName ? { toolName: projection.toolName } : {}),
    ...(projection.operationId ? { toolUseId: projection.operationId } : {}),
    ...(projection.detail !== undefined ? { detail: terminalText(projection.detail) } : {}),
    ...(projection.provider !== undefined ? { provider: projection.provider || null } : {}),
    ...(projection.model !== undefined ? { model: projection.model || null } : {}),
    ...(projection.fallback !== undefined ? { fallback: terminalText(projection.fallback) } : {}),
  };
}
