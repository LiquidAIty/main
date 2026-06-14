import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { LocalCoderCbmScopeGateResult } from '../../../services/graphContext/cbmScopeGate';
import { routeCodingTaskToConsole } from './consoleTaskRouter';
import {
  OpenClaudeConsoleSessionManager,
  type ConsoleChild,
} from './consoleSession';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

class FakeChild extends EventEmitter implements ConsoleChild {
  pid: number | null = 99;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  kill(): boolean {
    queueMicrotask(() => this.emit('exit', 0, null));
    return true;
  }
}

const okGate: LocalCoderCbmScopeGateResult = {
  indexRan: true,
  indexStatus: 'indexed',
  project: 'C-Projects-main',
  sourceRoot: 'C:/Projects/main',
  nodes: 10,
  edges: 20,
  indexedFiles: 414,
  requiredFiles: [],
  missingRequiredFiles: [],
  excludedFilesFound: [],
  scopeStatus: 'ok',
  editAllowed: true,
  blockedReason: '',
};

function sessionManager() {
  return new OpenClaudeConsoleSessionManager({
    workspaceRoot: tmpdir(),
    env: { OPENAI_API_KEY: 'sk-x1234567890abcd', OPENAI_MODEL: 'gpt-5.3-codex' },
    spawnProcess: () => new FakeChild() as unknown as ConsoleChild,
    resolveRuntime: () => ({
      ready: true,
      command: 'node',
      baseArgs: ['bin/openclaude'],
      describe: 'node bin/openclaude',
      shell: false,
      source: 'vendored_built',
      envMissing: [],
    }),
  });
}

describe('routeCodingTaskToConsole', () => {
  it('blocks when Local Coder is not bus-connected', async () => {
    const cbmScopeGate = vi.fn(async () => okGate);
    const result = await routeCodingTaskToConsole(
      {
        repoPath: tmpdir(),
        task: 'fix the bug',
        localCoderBusConnected: false,
        codeGraphBusConnected: true,
      },
      { sessionManager: sessionManager(), cbmScopeGate },
    );
    expect(result.routed).toBe(false);
    expect(result.blocked).toContain('local_coder_not_bus_connected');
    // The gate is not even consulted once the participant gate fails.
    expect(cbmScopeGate).not.toHaveBeenCalled();
  });

  it('blocks when CodeGraph is not bus-connected', async () => {
    const cbmScopeGate = vi.fn(async () => okGate);
    const result = await routeCodingTaskToConsole(
      {
        repoPath: tmpdir(),
        task: 'fix the bug',
        localCoderBusConnected: true,
        codeGraphBusConnected: false,
      },
      { sessionManager: sessionManager(), cbmScopeGate },
    );
    expect(result.routed).toBe(false);
    expect(result.blocked).toContain('codegraph_not_bus_connected');
    expect(cbmScopeGate).not.toHaveBeenCalled();
  });

  it('checks the CBM scoped gate before sending and blocks when it is not ok', async () => {
    const cbmScopeGate = vi.fn(async () => ({
      ...okGate,
      scopeStatus: 'blocked' as const,
      editAllowed: false,
      blockedReason: 'cbm_scope_required_files_missing: PLAN.md',
    }));
    const result = await routeCodingTaskToConsole(
      {
        repoPath: tmpdir(),
        task: 'fix the bug',
        localCoderBusConnected: true,
        codeGraphBusConnected: true,
      },
      { sessionManager: sessionManager(), cbmScopeGate },
    );
    expect(cbmScopeGate).toHaveBeenCalledOnce();
    expect(result.routed).toBe(false);
    expect(result.blocked).toContain('cbm_scope_required_files_missing');
  });

  it('routes a coding task into a new console session once both gates pass', async () => {
    const cbmScopeGate = vi.fn(async () => okGate);
    const manager = sessionManager();
    const result = await routeCodingTaskToConsole(
      {
        repoPath: tmpdir(),
        task: 'add a test',
        localCoderBusConnected: true,
        codeGraphBusConnected: true,
      },
      { sessionManager: manager, cbmScopeGate },
    );
    expect(cbmScopeGate).toHaveBeenCalledOnce();
    expect(result.routed).toBe(true);
    expect(result.blocked).toBeNull();
    expect(result.session?.mode).toBe('task');
    expect(result.reusedSession).toBe(false);
  });

  it('blocks instead of faking success when a running task session cannot accept input', async () => {
    const cbmScopeGate = vi.fn(async () => okGate);
    const manager = sessionManager();
    const started = manager.start({
      targetRoot: tmpdir(),
      mode: 'task',
      prompt: 'first task',
    });
    expect(started.ok).toBe(true);
    const result = await routeCodingTaskToConsole(
      {
        repoPath: tmpdir(),
        task: 'second task',
        localCoderBusConnected: true,
        codeGraphBusConnected: true,
      },
      { sessionManager: manager, cbmScopeGate },
    );
    expect(result.routed).toBe(false);
    expect(result.inputDelivered).toBe(false);
    expect(result.blocked).toBe('console_session_input_not_deliverable');
    expect(result.reusedSession).toBe(true);
  });

  it('blocks an empty task before any gate', async () => {
    const cbmScopeGate = vi.fn(async () => okGate);
    const result = await routeCodingTaskToConsole(
      {
        repoPath: tmpdir(),
        task: '   ',
        localCoderBusConnected: true,
        codeGraphBusConnected: true,
      },
      { sessionManager: sessionManager(), cbmScopeGate },
    );
    expect(result.blocked).toBe('console_task_empty');
    expect(cbmScopeGate).not.toHaveBeenCalled();
  });

  it('blocks edit mode in this read-only SPEC', async () => {
    const cbmScopeGate = vi.fn(async () => okGate);
    const result = await routeCodingTaskToConsole(
      {
        repoPath: tmpdir(),
        task: 'edit the bug',
        localCoderBusConnected: true,
        codeGraphBusConnected: true,
        editMode: 'edit',
      },
      { sessionManager: sessionManager(), cbmScopeGate },
    );
    expect(result.blocked).toBe('console_edit_mode_not_supported_in_this_spec');
    expect(cbmScopeGate).not.toHaveBeenCalled();
  });
});
