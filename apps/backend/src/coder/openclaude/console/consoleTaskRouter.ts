import {
  runLocalCoderCbmScopeGate,
  type LocalCoderCbmScopeGateResult,
} from '../../../services/graphContext/cbmScopeGate';
import {
  openClaudeConsoleSessionManager,
  type ConsoleSessionInfo,
  type OpenClaudeConsoleSessionManager,
} from './consoleSession';

/**
 * Mag One control on top of the Console Bridge.
 *
 * Mag One stays the planner/router: a coding task only reaches OpenClaude when
 * (1) Local Coder is currently connected to the Magentic bus and (2) the
 * root-bound CodeGraph/CBM scoped gate passes. This does not bypass canvas
 * participant routing and never silently falls back — a disconnected Local
 * Coder or a stale/blocked CBM gate blocks loudly.
 */

export type ConsoleTaskRoutingInput = {
  repoPath: string;
  task: string;
  /** Whether Local Coder is currently a bus-connected canvas participant. */
  localCoderBusConnected: boolean;
  /** Whether CodeGraph is currently a bus-connected canvas participant. */
  codeGraphBusConnected: boolean;
  editMode?: string;
  sessionId?: string;
  model?: string;
  provider?: string;
};

export type ConsoleTaskRoutingResult = {
  routed: boolean;
  blocked: string | null;
  targetRoot: string;
  cbmScopeGate: LocalCoderCbmScopeGateResult | null;
  reusedSession: boolean;
  session: ConsoleSessionInfo | null;
  inputDelivered: boolean;
};

export type ConsoleTaskRoutingDeps = {
  sessionManager?: OpenClaudeConsoleSessionManager;
  cbmScopeGate?: (repoPath: string) => Promise<LocalCoderCbmScopeGateResult>;
};

export async function routeCodingTaskToConsole(
  input: ConsoleTaskRoutingInput,
  deps: ConsoleTaskRoutingDeps = {},
): Promise<ConsoleTaskRoutingResult> {
  const sessionManager = deps.sessionManager || openClaudeConsoleSessionManager;
  const cbmScopeGate = deps.cbmScopeGate || runLocalCoderCbmScopeGate;
  const targetRoot = input.repoPath;

  const base: ConsoleTaskRoutingResult = {
    routed: false,
    blocked: null,
    targetRoot,
    cbmScopeGate: null,
    reusedSession: false,
    session: null,
    inputDelivered: false,
  };

  const task = String(input.task || '').trim();
  if (!task) {
    return { ...base, blocked: 'console_task_empty' };
  }

  // 1. Canvas participant gate — never call a disconnected Local Coder.
  if (!input.localCoderBusConnected) {
    return {
      ...base,
      blocked: 'MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: local_coder_not_bus_connected',
    };
  }
  if (!input.codeGraphBusConnected) {
    return {
      ...base,
      blocked: 'MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: codegraph_not_bus_connected',
    };
  }
  if (String(input.editMode || 'read_only').trim().toLowerCase() !== 'read_only') {
    return { ...base, blocked: 'console_edit_mode_not_supported_in_this_spec' };
  }

  // 2. Root-bound CBM/CodeGraph scoped gate — checked before any task is sent.
  const gate = await cbmScopeGate(targetRoot);
  if (gate.scopeStatus !== 'ok') {
    return { ...base, blocked: gate.blockedReason || 'cbm_scope_gate_blocked', cbmScopeGate: gate };
  }

  // 3. Reuse a live session for the target root, otherwise start a task session.
  const requested = input.sessionId ? sessionManager.get(input.sessionId) : undefined;
  if (
    requested &&
    (requested.info.state !== 'running' || requested.info.targetRoot !== targetRoot)
  ) {
    return { ...base, blocked: 'console_requested_session_not_running_for_target_root' };
  }
  const existing = requested || sessionManager.findRunningForRoot(targetRoot);
  if (existing) {
    // Submit like a human types: text, pause, then Enter as a separate
    // keystroke (a single text+Enter chunk does not submit in the REPL).
    const delivered = existing.submitLine(task);
    return {
      ...base,
      routed: delivered,
      blocked: delivered ? null : 'console_session_input_not_deliverable',
      cbmScopeGate: gate,
      reusedSession: true,
      session: existing.info,
      inputDelivered: delivered,
    };
  }

  const started = sessionManager.start({
    targetRoot,
    mode: 'task',
    prompt: task,
    model: input.model,
    provider: input.provider,
  });
  if (!started.ok) {
    return { ...base, blocked: started.error, cbmScopeGate: gate };
  }
  return {
    ...base,
    routed: started.session.info.state !== 'failed',
    blocked: started.session.info.state === 'failed' ? started.session.info.error : null,
    cbmScopeGate: gate,
    reusedSession: false,
    session: started.session.info,
    inputDelivered: true,
  };
}
