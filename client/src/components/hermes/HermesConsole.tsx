/**
 * The hidden under-chat terminal for Main's one native Hermes Agent child.
 * It consumes the current Harness SSE stream only: no polling, second session,
 * report artifact, or inferred agent identity.
 */

export type HermesTerminalStatus = 'idle' | 'running' | 'completed' | 'error';

export type HermesTerminalActivity = {
  id: string;
  text: string;
  failed: boolean;
};

export type HermesTerminalState = {
  invocationId: string | null;
  objective: string;
  status: HermesTerminalStatus;
  responseText: string;
  error: string | null;
  childToolUseIds: string[];
  activity: HermesTerminalActivity[];
};

export type HermesStreamEvent = {
  kind: string;
  toolName?: unknown;
  toolUseId?: unknown;
  invokingCardId?: unknown;
  argsJson?: unknown;
  output?: unknown;
  isError?: unknown;
  parentToolUseId?: unknown;
  data?: unknown;
  message?: unknown;
  code?: unknown;
};

export const EMPTY_HERMES_TERMINAL_STATE: HermesTerminalState = {
  invocationId: null,
  objective: '',
  status: 'idle',
  responseText: '',
  error: null,
  childToolUseIds: [],
  activity: [],
};

const HERMES_CARD_ID = 'card_hermes_steward';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseHermesObjective(argsJson: unknown): string | null {
  try {
    const input = JSON.parse(text(argsJson) || '{}') as Record<string, unknown>;
    if (input.subagent_type !== HERMES_CARD_ID) return null;
    return text(input.prompt).trim() || text(input.description).trim() || 'Inherited Main conversation';
  } catch {
    return null;
  }
}

function appendActivity(
  state: HermesTerminalState,
  entry: HermesTerminalActivity,
): HermesTerminalState {
  if (state.activity.some((candidate) => candidate.id === entry.id)) return state;
  return { ...state, activity: [...state.activity, entry] };
}

/** Pure event reducer. The active Agent tool-use id and engine-supplied card
 * identity are the only routing signals; prose and tool names never select an
 * agent. The final Agent result replaces the accumulated deltas, reconciling
 * the authoritative terminal value without rendering the prose twice. */
export function reduceHermesTerminalEvent(
  state: HermesTerminalState,
  event: HermesStreamEvent,
): HermesTerminalState {
  if (event.kind === 'tool_start' && event.toolName === 'Agent') {
    const objective = parseHermesObjective(event.argsJson);
    if (objective === null) return state;
    return {
      invocationId: text(event.toolUseId),
      objective,
      status: 'running',
      responseText: '',
      error: null,
      childToolUseIds: [],
      activity: [],
    };
  }

  if (!state.invocationId) return state;

  if (event.kind === 'tool_start' && event.invokingCardId === HERMES_CARD_ID) {
    const toolUseId = text(event.toolUseId);
    const toolName = text(event.toolName) || 'tool';
    const next = appendActivity(state, {
      id: `start:${toolUseId}`,
      text: `${toolName} started`,
      failed: false,
    });
    return next.childToolUseIds.includes(toolUseId)
      ? next
      : { ...next, childToolUseIds: [...next.childToolUseIds, toolUseId] };
  }

  if (event.kind === 'progress' && event.parentToolUseId === state.invocationId) {
    const data = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown>
      : null;
    if (data?.type !== 'agent_text_delta' || data.agentType !== HERMES_CARD_ID) return state;
    const delta = text(data.text);
    return delta ? { ...state, responseText: state.responseText + delta } : state;
  }

  if (event.kind === 'tool_result') {
    const toolUseId = text(event.toolUseId);
    if (toolUseId === state.invocationId) {
      const output = text(event.output);
      const failed = Boolean(event.isError);
      return {
        ...state,
        status: failed ? 'error' : 'completed',
        responseText: output || state.responseText,
        error: failed ? output || 'Hermes child failed.' : null,
      };
    }
    if (state.childToolUseIds.includes(toolUseId)) {
      const failed = Boolean(event.isError);
      return appendActivity(state, {
        id: `result:${toolUseId}`,
        text: `${text(event.toolName) || 'tool'} ${failed ? 'failed' : 'completed'}`,
        failed,
      });
    }
  }

  if (event.kind === 'error' && state.status === 'running') {
    const reason = text(event.message) || text(event.code) || 'Hermes stream failed.';
    return { ...state, status: 'error', error: reason };
  }

  return state;
}

export type HermesConsoleProps = {
  terminal: HermesTerminalState;
};

export default function HermesConsole({ terminal }: HermesConsoleProps) {
  const statusLabel = terminal.status === 'running'
    ? 'running'
    : terminal.status === 'completed'
      ? 'complete'
      : terminal.status;

  return (
    <div
      data-testid="hermes-console"
      data-status={terminal.status}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        color: 'rgba(214,222,235,0.86)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span style={{ color: 'rgba(77,211,210,0.92)', fontWeight: 700 }}>Hermes</span>
        <span data-testid="hermes-terminal-status" style={{ opacity: 0.55 }}>{statusLabel}</span>
        {terminal.status === 'running' ? (
          <span aria-hidden="true" style={{ marginLeft: 'auto', color: 'rgba(77,211,210,0.8)' }}>●</span>
        ) : null}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '9px 12px 12px' }}>
        {terminal.status === 'idle' ? (
          <div data-testid="hermes-terminal-empty" style={{ opacity: 0.5 }}>
            Hermes is ready beneath Main Chat.
          </div>
        ) : (
          <>
            <div data-testid="hermes-terminal-objective" style={{ opacity: 0.62, marginBottom: 8 }}>
              objective: {terminal.objective}
            </div>
            {terminal.activity.map((entry) => (
              <div
                key={entry.id}
                data-testid="hermes-terminal-activity"
                data-failed={entry.failed ? 'true' : 'false'}
                style={{ color: entry.failed ? 'rgba(248,113,113,0.9)' : 'rgba(148,163,184,0.75)' }}
              >
                {entry.failed ? '×' : '·'} {entry.text}
              </div>
            ))}
            {terminal.responseText ? (
              <div
                data-testid="hermes-terminal-response"
                style={{ whiteSpace: 'pre-wrap', lineHeight: 1.48, marginTop: 9 }}
              >
                {terminal.responseText}
              </div>
            ) : null}
            {terminal.error ? (
              <div data-testid="hermes-terminal-error" style={{ color: 'rgba(248,113,113,0.9)', marginTop: 8 }}>
                {terminal.error}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
