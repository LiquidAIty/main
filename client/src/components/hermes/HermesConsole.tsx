import OpenClaudeConsolePanel from '../../features/agentbuilder/console/OpenClaudeConsolePanel';
import {
  hermesConsoleClient,
  type OpenClaudeConsoleClient,
} from '../../features/agentbuilder/console/openClaudeConsoleClient';

/** Harness child-event state remains a pre-integration observation seam. The
 * visible Hermes terminal below is different: it owns the actual installed
 * Hermes CLI session through `/api/coder/hermes/console/*`. */

type HermesTerminalStatus = 'idle' | 'running' | 'completed' | 'error';

type HermesTerminalActivity = {
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

type HermesConsoleProps = {
  open: boolean;
  targetRoot: string;
  projectId?: string;
  onClose?: () => void;
  client?: OpenClaudeConsoleClient;
};

export default function HermesConsole({
  open,
  targetRoot,
  projectId,
  onClose,
  client = hermesConsoleClient,
}: HermesConsoleProps) {
  return (
    <OpenClaudeConsolePanel
      open={open}
      targetRoot={targetRoot}
      projectId={projectId}
      title="Hermes Terminal"
      testIdPrefix="hermes-console"
      client={client}
      attachExisting
      idleLabel="Stopped"
      completeLabel="Stopped"
      onClose={onClose}
    />
  );
}
