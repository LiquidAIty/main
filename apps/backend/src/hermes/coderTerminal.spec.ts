import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  HermesCoderTerminalManager,
  HermesCoderTerminalSession,
  type ConsoleSessionInfo,
  type HermesCoderPtyLaunch,
  type PtyFactory,
} from './coderTerminal';

class FakePty {
  readonly pid = 42;
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];

  onData = (listener: (data: string) => void) => {
    this.dataListeners.push(listener);
    return { dispose: () => undefined };
  };

  onExit = (listener: (event: { exitCode: number; signal?: number }) => void) => {
    this.exitListeners.push(listener);
    return { dispose: () => undefined };
  };

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(exitCode: number, signal?: number): void {
    for (const listener of this.exitListeners) listener({ exitCode, signal });
  }
}

function sessionInfo(): ConsoleSessionInfo {
  return {
    id: 'coder_terminal_test',
    ownerCardId: 'card_local_coder',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'main',
    targetRoot: process.cwd(),
    mode: 'interactive',
    state: 'starting',
    runtimeSource: 'repository_hermes_cli',
    transportMode: 'pty',
    profile: 'coder',
    executable: null,
    hermesHome: null,
    interactiveSupported: true,
    pid: null,
    startedAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    stoppedAt: null,
    warnings: [],
    error: null,
  };
}

function launch(onExit?: HermesCoderPtyLaunch['onExit']): HermesCoderPtyLaunch {
  return {
    executable: 'C:/repo/Hermes/venv/Scripts/hermes.exe',
    args: ['-p', 'coder', 'chat', '--cli', '--in', 'C:/repo'],
    env: { HERMES_HOME: 'C:/repo/Hermes/.hermes' },
    profile: 'coder',
    hermesHome: 'C:/repo/Hermes/.hermes',
    onExit,
  };
}

const identity = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  conversationId: 'main',
};

describe('Hermes Coder real PTY boundary', () => {
  it('requires server-owned project, deck, and conversation identity', () => {
    const result = new HermesCoderTerminalManager().acquire({
      projectId: '',
      deckId: '',
      conversationId: '',
    });
    expect(result).toEqual({
      ok: false,
      error: 'hermes_coder_terminal_identity_required',
      missing: [],
    });
  });

  it('fails honestly when the requested workspace root is missing', () => {
    const missing = path.join(process.cwd(), '__missing_coder_terminal_root__');
    const result = new HermesCoderTerminalManager().acquire({ ...identity, targetRoot: missing });
    expect(result).toEqual({
      ok: false,
      error: `hermes_coder_terminal_target_root_missing:${missing}`,
      missing: [],
    });
  });

  it('spawns Hermes in ConPTY with the exact executable, arguments, cwd, and environment', () => {
    const child = new FakePty();
    const factory = vi.fn(() => child) as unknown as PtyFactory;
    const session = new HermesCoderTerminalSession(sessionInfo(), factory);
    session.start(launch());

    expect(factory).toHaveBeenCalledWith(
      'C:/repo/Hermes/venv/Scripts/hermes.exe',
      ['-p', 'coder', 'chat', '--cli', '--in', 'C:/repo'],
      expect.objectContaining({
        cwd: process.cwd(),
        env: { HERMES_HOME: 'C:/repo/Hermes/.hermes' },
        useConpty: true,
      }),
    );
    expect(session.info).toMatchObject({
      state: 'running',
      transportMode: 'pty',
      pid: 42,
      executable: 'C:/repo/Hermes/venv/Scripts/hermes.exe',
      hermesHome: 'C:/repo/Hermes/.hermes',
      profile: 'coder',
    });
  });

  it('forwards PTY input and output byte-for-byte exactly once', () => {
    const child = new FakePty();
    const session = new HermesCoderTerminalSession(
      sessionInfo(),
      (() => child) as unknown as PtyFactory,
    );
    session.start(launch());
    const output: string[] = [];
    const unsubscribe = session.subscribeOutput((data) => output.push(data));

    expect(session.write('inspect symbol\r')).toBe(true);
    expect(child.write).toHaveBeenCalledOnce();
    expect(child.write).toHaveBeenCalledWith('inspect symbol\r');
    child.emitData('\u001b[32mHermes native output\u001b[0m\r\n');
    expect(output).toEqual(['\u001b[32mHermes native output\u001b[0m\r\n']);
    unsubscribe();
    child.emitData('not replayed');
    expect(output).toHaveLength(1);
  });

  it('resizes and stops the real child process', () => {
    const child = new FakePty();
    const session = new HermesCoderTerminalSession(
      sessionInfo(),
      (() => child) as unknown as PtyFactory,
    );
    session.start(launch());

    expect(session.resize(180, 55)).toBe(true);
    expect(child.resize).toHaveBeenCalledWith(180, 55);
    expect(session.stop()).toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(session.info.state).toBe('stopping');
    expect(session.write('no')).toBe(false);
    child.emitExit(0);
    expect(session.info.state).toBe('stopped');
    expect(session.resize(180, 55)).toBe(false);
    expect(child.resize).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid dimensions before they reach ConPTY', () => {
    const child = new FakePty();
    const session = new HermesCoderTerminalSession(
      sessionInfo(),
      (() => child) as unknown as PtyFactory,
    );
    session.start(launch());

    expect(session.resize(0, 20)).toBe(false);
    expect(session.resize(80, 0)).toBe(false);
    expect(session.resize(80.5, 20)).toBe(false);
    expect(child.resize).not.toHaveBeenCalled();
  });

  it('reuses only a live Card-bound PTY and replaces an exited process', () => {
    const children: FakePty[] = [];
    const factory = vi.fn(() => {
      const child = new FakePty();
      children.push(child);
      return child;
    }) as unknown as PtyFactory;
    const manager = new HermesCoderTerminalManager(factory);
    const first = manager.acquire(identity);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    first.session.start(launch());

    const same = manager.acquire(identity);
    expect(same.ok && same.created).toBe(false);
    children[0]?.emitExit(0);
    const replacement = manager.acquire(identity);
    expect(replacement.ok && replacement.created).toBe(true);
    expect(replacement.ok && replacement.session).not.toBe(first.session);
    if (!replacement.ok) return;
    replacement.session.start(launch());
    expect(factory).toHaveBeenCalledTimes(2);
    expect(replacement.session.info.pid).toBe(42);
    expect(replacement.session.info.executable).toBe(
      'C:/repo/Hermes/venv/Scripts/hermes.exe',
    );
  });

  it('publishes the native exit result once and preserves truthful failure state', () => {
    const child = new FakePty();
    const onExit = vi.fn();
    const session = new HermesCoderTerminalSession(
      sessionInfo(),
      (() => child) as unknown as PtyFactory,
    );
    session.start(launch(onExit));
    child.emitExit(17, 9);

    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith({ exitCode: 17, signal: 9, stopped: false });
    expect(session.info).toMatchObject({
      state: 'failed',
      error: 'hermes_cli_exited:17:9',
      pid: null,
    });
  });
});
