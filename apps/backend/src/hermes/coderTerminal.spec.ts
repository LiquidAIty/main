import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { resolveRepoRoot } from '../coder/workspaceRoot';
import {
  HermesCoderTerminalManager,
  HermesCoderTerminalSession,
  ensurePersistentCoderTerminal,
  ensurePersistentMainTerminal,
  ensureSavedBuilderTerminal,
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
  it('keeps normal workspace terminals separate from the Hermes runtime', () => {
    const settings = JSON.parse(
      readFileSync(path.join(resolveRepoRoot(), '.vscode', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(settings).toMatchObject({
      'python.defaultInterpreterPath':
        '${workspaceFolder}\\apps\\python-models\\.venv\\Scripts\\python.exe',
      'python.useEnvironmentsExtension': false,
      'python.terminal.activateEnvironment': false,
      'python.terminal.activateEnvInCurrentTerminal': false,
    });
    expect(String(settings['python.defaultInterpreterPath'])).not.toMatch(/Hermes[\\/]/i);
  });

  it('starts one idle persistent Coder terminal from the backend startup owner', () => {
    const child = new FakePty();
    const manager = new HermesCoderTerminalManager((() => child) as unknown as PtyFactory);
    const launchPersistent = vi.fn((session: HermesCoderTerminalSession) => session.start(launch()));

    const first = ensurePersistentCoderTerminal(manager, launchPersistent);
    const second = ensurePersistentCoderTerminal(manager, launchPersistent);

    expect(first).toMatchObject({
      ownerCardId: 'card_local_coder',
      profile: 'coder',
      state: 'running',
      pid: 42,
    });
    expect(second.id).toBe(first.id);
    expect(launchPersistent).toHaveBeenCalledOnce();
  });

  it('keeps one persistent Main CLI process distinct from the Local Coder CLI', () => {
    const children = [new FakePty(), new FakePty()];
    const manager = new HermesCoderTerminalManager(
      vi.fn(() => children.shift()!) as unknown as PtyFactory,
    );
    const launchCoder = vi.fn((session: HermesCoderTerminalSession) => session.start(launch()));
    const launchMain = vi.fn((session: HermesCoderTerminalSession) => session.start({
      ...launch(),
      args: ['-p', 'liquidaity-main', 'chat', '--cli', '--in', 'C:/repo'],
      profile: 'liquidaity-main',
    }));

    const coder = ensurePersistentCoderTerminal(manager, launchCoder);
    const main = ensurePersistentMainTerminal(manager, launchMain);
    const sameMain = ensurePersistentMainTerminal(manager, launchMain);

    expect(coder).toMatchObject({ ownerCardId: 'card_local_coder', profile: 'coder' });
    expect(main).toMatchObject({ ownerCardId: 'card_main_chat', profile: 'liquidaity-main' });
    expect(main.id).not.toBe(coder.id);
    expect(sameMain.id).toBe(main.id);
    expect(launchCoder).toHaveBeenCalledOnce();
    expect(launchMain).toHaveBeenCalledOnce();
  });

  it('reuses one saved Builder CLI across attachments without crossing into Coder', async () => {
    const child = new FakePty();
    const factory = vi.fn(() => child) as unknown as PtyFactory;
    const manager = new HermesCoderTerminalManager(factory);
    const deck = { workspaceRoot: process.cwd(), nodes: [{
      id: 'saved-builder', runtime: { kind: 'hermes', mode: 'delegate', profile: 'liquidaity-agent-builder' },
      runtimeOptions: { tools: ['canvas.inspect'], modelKey: 'saved-model' }, prompt: 'Saved prompt',
    }] } as any;
    const before = JSON.stringify(deck);
    const readDeck = vi.fn(async () => ({ deck, meta: { deckRevision: 'revision', deckSavedAt: null } }));
    const launchBuilder = vi.fn((target: HermesCoderTerminalSession) => target.start({
      ...launch(), profile: target.info.profile,
      args: ['-p', target.info.profile, 'chat', '--cli', '--in', target.info.targetRoot],
    }));
    const request = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'saved-builder' };
    const [first, second] = await Promise.all([
      ensureSavedBuilderTerminal(request, manager, readDeck, launchBuilder),
      ensureSavedBuilderTerminal(request, manager, readDeck, launchBuilder),
    ]);
    expect(first).toMatchObject({ ownerCardId: 'saved-builder', profile: 'liquidaity-agent-builder',
      projectId: 'project-1', deckId: 'deck_builder', runtimeSource: 'repository_hermes_cli', state: 'running' });
    expect(first.id).toBe(second.id);
    expect(launchBuilder).toHaveBeenCalledOnce();
    expect(manager.list()).toHaveLength(1);
    expect(child.write).not.toHaveBeenCalled();
    expect(JSON.stringify(deck)).toBe(before);

    deck.nodes[0].runtimeOptions.enabled = false;
    await expect(ensureSavedBuilderTerminal(request, manager, readDeck, launchBuilder))
      .rejects.toThrow('builder_terminal_saved_card_required');
    expect(child.kill).not.toHaveBeenCalled();
    expect(launchBuilder).toHaveBeenCalledOnce();
  });

  it('rejects missing, foreign, and shared Builder profiles before acquiring a process', async () => {
    const launchBuilder = vi.fn();
    const manager = new HermesCoderTerminalManager();
    for (const nodes of [[],
      [{ id: 'builder', runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' } }],
      ['builder', 'other'].map((id) => ({ id, runtime: {
        kind: 'hermes', mode: 'delegate', profile: 'liquidaity-agent-builder',
      } })),
    ]) {
      const readDeck = vi.fn(async () => ({ deck: { nodes, workspaceRoot: process.cwd() } as any,
        meta: { deckRevision: 'revision', deckSavedAt: null } }));
      await expect(ensureSavedBuilderTerminal({ projectId: 'project-1', deckId: 'deck_builder', cardId: 'builder' },
        manager, readDeck, launchBuilder)).rejects.toThrow('builder_terminal_saved_card_required');
    }
    expect(launchBuilder).not.toHaveBeenCalled();
    expect(manager.list()).toHaveLength(0);
  });

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
