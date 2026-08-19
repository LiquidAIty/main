import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveRepoRoot } from '../coder/workspaceRoot';

import {
  buildHermesOperatorTerminalLaunch,
  HermesCoderTerminalManager,
  HermesCoderTerminalSession,
  redactTerminalSecrets,
  type ConsoleSessionInfo,
} from './coderTerminal';

function sessionInfo(): ConsoleSessionInfo {
  return {
    id: 'coder_terminal_test',
    ownerCardId: 'card_local_coder',
    targetRoot: process.cwd(),
    mode: 'interactive',
    state: 'starting',
    commandPath: 'hermes chat --cli --toolsets file,terminal,memory',
    runtimeSource: 'hermes_installed',
    transportMode: 'pty',
    provider: null,
    model: null,
    interactiveSupported: true,
    pid: null,
    startedAt: '2026-08-18T00:00:00.000Z',
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
    warnings: [],
    error: null,
  };
}

describe('Hermes Coder terminal boundary', () => {
  it('launches a shell with the repo-owned Hermes CLI first on PATH', () => {
    const launch = buildHermesOperatorTerminalLaunch();
    const repoRoot = resolveRepoRoot();
    const expectedCli = path.join(
      repoRoot,
      'Hermes',
      'venv',
      'Scripts',
      process.platform === 'win32' ? 'hermes.exe' : 'hermes',
    );
    const pathKey = Object.keys(launch.env).find((key) => key.toLowerCase() === 'path');

    expect(launch.hermesCli).toBe(expectedCli);
    expect(launch.hermesHome).toBe(path.join(repoRoot, 'Hermes', '.hermes'));
    expect(pathKey).toBeDefined();
    expect(launch.env[pathKey!]?.split(path.delimiter)[0]).toBe(path.dirname(expectedCli));
    expect(launch.env.HERMES_HOME).toBe(launch.hermesHome);
    expect(launch.commandPath).toContain(`hermes=${expectedCli}`);
    expect(launch.commandPath).not.toMatch(/AppData|Docker/i);
  });

  it('rejects noninteractive execution instead of becoming another task runner', () => {
    const result = new HermesCoderTerminalManager().start({ mode: 'task' });
    expect(result).toEqual({
      ok: false,
      error: 'hermes_coder_terminal_interactive_only',
      missing: [],
    });
  });

  it('fails honestly when the requested workspace root is missing', () => {
    const missing = path.join(process.cwd(), '__missing_coder_terminal_root__');
    const result = new HermesCoderTerminalManager().start({ targetRoot: missing });
    expect(result).toEqual({
      ok: false,
      error: `hermes_coder_terminal_target_root_missing:${missing}`,
      missing: [],
    });
  });

  it('redacts secrets before terminal output is buffered or published', () => {
    expect(redactTerminalSecrets('OPENAI_API_KEY=sk-example_secret_123456789')).toBe(
      'OPENAI_API_KEY= <redacted>',
    );
    expect(redactTerminalSecrets('Authorization: Bearer example_token_123456789')).toBe(
      'Authorization: <redacted>',
    );

    const session = new HermesCoderTerminalSession(sessionInfo());
    session.emitOutput('stdout', 'TOKEN=example_secret_123456789');
    expect(session.transcript()).toHaveLength(1);
    expect(session.transcript()[0]?.data).toBe('TOKEN= <redacted>');
  });

  it('uses the native Windows PTY kill contract when stopping a session', () => {
    let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    const child = {
      pid: 42,
      onData: vi.fn(),
      onExit: vi.fn((callback: (event: { exitCode: number; signal?: number }) => void) => {
        onExit = callback;
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
    const session = new HermesCoderTerminalSession(sessionInfo());
    session.attach(child);
    session.markRunning();

    expect(session.stop()).toBe(true);
    expect(child.kill).toHaveBeenCalledWith(process.platform === 'win32' ? undefined : 'SIGTERM');
    onExit?.({ exitCode: 0 });
  });
});
