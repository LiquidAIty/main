import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenClaudeConsoleSessionManager,
  redactConsoleSecrets,
  resolveConsoleProviderEnv,
  type ConsoleChild,
} from './consoleSession';

class FakeChild extends EventEmitter implements ConsoleChild {
  pid: number | null = 4321;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  stdinChunks: string[] = [];
  killedWith: NodeJS.Signals | number | null = null;

  constructor() {
    super();
    this.stdin.on('data', (chunk) => this.stdinChunks.push(String(chunk)));
  }

  kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    this.killedWith = signal;
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
}

/** A PTY-shaped fake: like a pipe child but with resize (node-pty semantics). */
class FakePtyChild extends FakeChild {
  resizeCalls: Array<[number, number]> = [];
  resize(cols: number, rows: number): void {
    this.resizeCalls.push([cols, rows]);
  }
}

const readyRuntime = {
  ready: true as const,
  command: 'node',
  baseArgs: ['localcoder/bin/openclaude'],
  describe: 'node localcoder/bin/openclaude',
  shell: false,
  source: 'vendored_built' as const,
  envMissing: [] as string[],
};

function managerWith(
  child: FakeChild,
  overrides: Partial<{
    runtime: { ready: false; missing: string[] } | typeof readyRuntime;
    env: NodeJS.ProcessEnv;
    maxBufferChars: number;
  }> = {},
) {
  const spawnProcess = vi.fn(() => child as unknown as ConsoleChild);
  const manager = new OpenClaudeConsoleSessionManager({
    workspaceRoot: tmpdir(),
    env: overrides.env || { OPENAI_API_KEY: 'sk-secretkey1234567890', OPENAI_MODEL: 'gpt-5.3-codex' },
    spawnProcess,
    resolveRuntime: () => overrides.runtime || readyRuntime,
    maxBufferChars: overrides.maxBufferChars,
    now: () => '2026-06-13T00:00:00.000Z',
    idFactory: () => 'occ_test',
  });
  return { manager, spawnProcess };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('OpenClaudeConsoleSessionManager', () => {
  it('starts an interactive session for the target root and reports it running', () => {
    const child = new FakeChild();
    const { manager, spawnProcess } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.info.state).toBe('running');
    expect(result.session.info.targetRoot).toBe(tmpdir());
    expect(result.session.info.pid).toBe(4321);
    expect(result.session.info.interactiveSupported).toBe(true);
    // cwd is the target root; stdin is piped for interactive sessions.
    const [, , options] = spawnProcess.mock.calls[0];
    expect(options.cwd).toBe(tmpdir());
    expect(options.interactive).toBe(true);
  });

  it('points the spawned command at the vendored OpenClaude entrypoint', () => {
    const child = new FakeChild();
    const { manager, spawnProcess } = managerWith(child);
    manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    const [command, args] = spawnProcess.mock.calls[0];
    expect(command).toBe('node');
    expect(args[0]).toBe('localcoder/bin/openclaude');
  });

  it('streams stdout through the bridge transcript', async () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    child.stdout.write('OpenClaude help text\n');
    await flush();
    expect(result.session.transcriptText()).toContain('OpenClaude help text');
  });

  it('streams stderr through the bridge transcript', async () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    child.stderr.write('a warning line\n');
    await flush();
    const stderrChunks = result.session.transcript().filter((c) => c.stream === 'stderr');
    expect(stderrChunks.map((c) => c.data).join('')).toContain('a warning line');
  });

  it('forwards input to the child stdin for interactive sessions', () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.write('/help\n')).toBe(true);
    expect(child.stdinChunks.join('')).toBe('/help\n');
  });

  it('refuses input for non-interactive print sessions (stdin not attached)', () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'print', prompt: 'do work' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.info.interactiveSupported).toBe(false);
    expect(result.session.write('input')).toBe(false);
  });

  it('redacts secrets from streamed output', async () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    child.stdout.write('using key sk-abcdefgh12345678 now\n');
    await flush();
    const text = result.session.transcriptText();
    expect(text).not.toContain('sk-abcdefgh12345678');
    expect(text).toContain('<redacted>');
  });

  it('bounds the retained output buffer', async () => {
    const child = new FakeChild();
    const { manager } = managerWith(child, { maxBufferChars: 50 });
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    for (let i = 0; i < 20; i++) child.stdout.write(`line-${i}-xxxxxxxx\n`);
    await flush();
    expect(result.session.transcriptText().length).toBeLessThanOrEqual(80);
    // The most recent output is retained; the oldest is dropped.
    expect(result.session.transcriptText()).toContain('line-19');
    expect(result.session.transcriptText()).not.toContain('line-0-');
  });

  it('stops the session, killing the child and reporting exit', async () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.stop()).toBe(true);
    expect(child.killedWith).toBe('SIGTERM');
    await flush();
    expect(result.session.info.state).toBe('exited');
  });

  it('reports the child exit code and signal honestly', async () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    child.emit('exit', 0, null);
    await flush();
    expect(result.session.info.state).toBe('exited');
    expect(result.session.info.exitCode).toBe(0);
    expect(result.session.info.exitSignal).toBeNull();
  });

  it('replays the bounded transcript to a late subscriber (UI data source)', async () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    child.stdout.write('early output\n');
    await flush();
    const received: string[] = [];
    result.session.subscribe((event) => {
      if (event.kind === 'chunk') received.push(event.chunk.data);
    });
    expect(received.join('')).toContain('early output');
  });

  it('blocks loudly when no OpenClaude runtime is resolvable', () => {
    const child = new FakeChild();
    const { manager } = managerWith(child, {
      runtime: { ready: false, missing: ['localcoder_entrypoint_missing'] },
    });
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected blocked');
    expect(result.error).toBe('console_runtime_unavailable');
    expect(result.missing).toContain('localcoder_entrypoint_missing');
  });

  it('requires a prompt for print/task modes', () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'task' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected blocked');
    expect(result.error).toBe('console_prompt_required_for_task');
  });

  it('blocks print/task when provider credentials are missing but allows interactive', () => {
    const child = new FakeChild();
    const { manager } = managerWith(child, {
      env: {},
      runtime: { ...readyRuntime, envMissing: ['localcoder_env_missing: OPENAI_API_KEY'] },
    });
    const print = manager.start({ targetRoot: tmpdir(), mode: 'print', prompt: 'x' });
    expect(print.ok).toBe(false);
    const interactive = new OpenClaudeConsoleSessionManager({
      workspaceRoot: tmpdir(),
      env: {},
      spawnProcess: () => new FakeChild() as unknown as ConsoleChild,
      resolveRuntime: () => ({ ...readyRuntime, envMissing: ['localcoder_env_missing: OPENAI_API_KEY'] }),
    }).start({ targetRoot: tmpdir(), mode: 'interactive' });
    expect(interactive.ok).toBe(true);
  });

  it('uses --help argv verbatim when explicit args are provided (smoke path)', () => {
    const child = new FakeChild();
    const { manager, spawnProcess } = managerWith(child);
    manager.start({ targetRoot: tmpdir(), mode: 'interactive', args: ['--help'] });
    const [, args] = spawnProcess.mock.calls[0];
    expect(args).toEqual(['localcoder/bin/openclaude', '--help']);
  });

  it('finds a running session to reuse for a target root', () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    expect(manager.findRunningForRoot(tmpdir())?.info.id).toBe(result.session.info.id);
    expect(manager.hasAnySession()).toBe(true);
  });

  it('reports pipe transport when an explicit pipe spawn is injected', () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.info.transportMode).toBe('pipe');
  });

  it('uses the PTY spawn and reports pty transport for interactive sessions', () => {
    const ptyChild = new FakePtyChild();
    const ptySpawn = vi.fn(() => ptyChild as unknown as ConsoleChild);
    const manager = new OpenClaudeConsoleSessionManager({
      workspaceRoot: tmpdir(),
      env: { OPENAI_MODEL: 'gpt-5.3-codex' },
      ptySpawn,
      resolveRuntime: () => readyRuntime,
      now: () => '2026-06-13T00:00:00.000Z',
      idFactory: () => 'occ_pty',
    });
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    expect(ptySpawn).toHaveBeenCalledOnce();
    expect(result.session.info.transportMode).toBe('pty');
    // Resize is forwarded to the PTY.
    expect(result.session.resize(100, 40)).toBe(true);
    expect(ptyChild.resizeCalls).toEqual([[100, 40]]);
  });

  it('does not silently fall back to PTY when pipe is forced (ptySpawn null)', () => {
    const child = new FakeChild();
    const manager = new OpenClaudeConsoleSessionManager({
      workspaceRoot: tmpdir(),
      env: { OPENAI_MODEL: 'gpt-5.3-codex' },
      spawnProcess: () => child as unknown as ConsoleChild,
      ptySpawn: null,
      resolveRuntime: () => readyRuntime,
    });
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.info.transportMode).toBe('pipe');
    // Pipe child exposes no resize.
    expect(result.session.resize(80, 24)).toBe(false);
  });

  it('never leaks the API key into session diagnostics', () => {
    const child = new FakeChild();
    const { manager } = managerWith(child);
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    expect(JSON.stringify(result.session.info)).not.toContain('sk-secretkey1234567890');
  });
});

describe('resolveConsoleProviderEnv', () => {
  it('routes through OpenRouter when LIVE_OPENROUTER=1 and a key is present', () => {
    const r = resolveConsoleProviderEnv({
      LIVE_OPENROUTER: '1',
      OPENROUTER_API_KEY: 'sk-or-abc123def456',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_DEFAULT_MODEL: 'kimi-k2-thinking',
      OPENAI_MODEL: 'gpt-5.1-chat-latest',
    });
    expect(r.label).toBe('openrouter');
    expect(r.defaultModel).toBe('kimi-k2-thinking');
    expect(r.envOverrides.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(r.envOverrides.OPENAI_API_KEY).toBe('sk-or-abc123def456');
    expect(r.envOverrides.CLAUDE_CODE_USE_OPENAI).toBe('1');
  });

  it('stays on direct OpenAI when OpenRouter is not enabled', () => {
    const r = resolveConsoleProviderEnv({ OPENAI_MODEL: 'gpt-5.1-chat-latest' });
    expect(r.label).toBe('openai');
    expect(r.defaultModel).toBe('gpt-5.1-chat-latest');
    expect(r.envOverrides.OPENAI_BASE_URL).toBeUndefined();
  });

  it('does not enable OpenRouter without a key even if the flag is set', () => {
    expect(resolveConsoleProviderEnv({ LIVE_OPENROUTER: '1' }).label).toBe('openai');
  });
});

describe('OpenClaudeConsoleSessionManager OpenRouter routing', () => {
  it('points the child at OpenRouter and reports the resolved provider/model', () => {
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child as unknown as ConsoleChild);
    const manager = new OpenClaudeConsoleSessionManager({
      workspaceRoot: tmpdir(),
      env: {
        LIVE_OPENROUTER: '1',
        OPENROUTER_API_KEY: 'sk-or-secretrouterkey',
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
        OPENROUTER_DEFAULT_MODEL: 'kimi-k2-thinking',
      },
      spawnProcess,
      resolveRuntime: () => readyRuntime,
    });
    const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.session.info.provider).toBe('openrouter');
    expect(result.session.info.model).toBe('kimi-k2-thinking');
    const [, args, options] = spawnProcess.mock.calls[0];
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('kimi-k2-thinking');
    expect(options.env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(options.env.OPENAI_API_KEY).toBe('sk-or-secretrouterkey');
    expect(options.env.OPENAI_MODEL).toBe('kimi-k2-thinking');
  });

  it('submitLine writes the text immediately and Enter as a separate keystroke', () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const manager = new OpenClaudeConsoleSessionManager({
        workspaceRoot: tmpdir(),
        env: { OPENAI_MODEL: 'gpt-4o' },
        spawnProcess: () => child as unknown as ConsoleChild,
        resolveRuntime: () => readyRuntime,
      });
      const result = manager.start({ targetRoot: tmpdir(), mode: 'interactive' });
      if (!result.ok) throw new Error('expected ok');
      expect(result.session.submitLine('do a small task', 1200)).toBe(true);
      // Text delivered immediately; Enter not yet.
      expect(child.stdinChunks.join('')).toBe('do a small task');
      vi.advanceTimersByTime(1200);
      expect(child.stdinChunks.join('')).toBe('do a small task\r');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('redactConsoleSecrets', () => {
  it('masks api key assignments and bearer tokens', () => {
    expect(redactConsoleSecrets('OPENAI_API_KEY=sk-abcdefgh12345678')).not.toContain('sk-abcdefgh');
    expect(redactConsoleSecrets('Authorization: Bearer abcdef1234567890')).toContain('<redacted>');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactConsoleSecrets('compiled 3 files ok')).toBe('compiled 3 files ok');
  });
});
