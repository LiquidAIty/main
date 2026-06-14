import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  LocalCoderAdapter,
  resolveLocalCoderWorkspaceRoot,
  type ConsoleRuntimeResolution,
} from '../../localcoder/adapter';

/**
 * OpenClaude Console Bridge — the smallest owned backend that runs the real
 * OpenClaude/LocalCoder CLI as a long-lived, streamed process so a terminal
 * view can show what it is doing and (when the transport supports it) feed it
 * input. This is NOT a generic process-manager framework: it only knows how to
 * start, stream, feed, and stop OpenClaude console sessions.
 *
 * Honesty boundaries (see PLAN.md / the SPEC):
 *  - A session is only `running` once the child process actually spawns.
 *  - Terminal output is not a CoderReport. CoderReport validation stays in the
 *    headless adapter; this bridge reports session lifecycle + bounded transcript.
 *  - This is not a sandbox: the child runs with the backend's permissions.
 *  - Secrets are redacted from streamed output and diagnostics; the full
 *    environment is never echoed.
 *  - No gRPC: the bridge spawns the CLI via node:child_process only.
 */

export type ConsoleMode = 'interactive' | 'print' | 'task';

export type ConsoleSessionState =
  | 'starting'
  | 'running'
  | 'exited'
  | 'failed';

export type ConsoleStreamName = 'stdout' | 'stderr' | 'system';

/**
 * Which process backend the session actually used. Reported honestly so a
 * `pipe` fallback is never silently presented as a real PTY.
 *  - `pty`: node-pty pseudo-terminal (real TTY; interactive REPL works)
 *  - `pipe`: child_process stdio pipes (no TTY; one-shot/streamed)
 */
export type ConsoleTransportMode = 'pty' | 'pipe';

export type ConsoleOutputChunk = {
  seq: number;
  stream: ConsoleStreamName;
  data: string;
  at: string;
};

export type ConsoleSessionInfo = {
  id: string;
  targetRoot: string;
  mode: ConsoleMode;
  state: ConsoleSessionState;
  commandPath: string;
  runtimeSource: string;
  transportMode: ConsoleTransportMode;
  provider: string | null;
  model: string | null;
  interactiveSupported: boolean;
  pid: number | null;
  startedAt: string | null;
  exitedAt: string | null;
  exitCode: number | null;
  exitSignal: string | null;
  warnings: string[];
  error: string | null;
};

/** A minimal long-lived child handle the bridge controls. */
export interface ConsoleChild {
  readonly pid: number | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  stdin: NodeJS.WritableStream | { write(data: string): boolean } | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  /** Present only for PTY-backed children. */
  resize?(cols: number, rows: number): void;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

export type ConsoleSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean; interactive: boolean },
) => ConsoleChild;

export type StartConsoleSessionRequest = {
  targetRoot?: string;
  mode?: ConsoleMode;
  model?: string;
  provider?: string;
  /** Prompt delivered via `--print` for `print`/`task` modes. */
  prompt?: string;
  /** Explicit argv override (e.g. ['--help']) — used by the safe smoke. */
  args?: string[];
};

const DEFAULT_MAX_BUFFER_CHARS = 200_000;
const MAX_CHUNK_CHARS = 16_000;
const KILL_FALLBACK_MS = 5_000;

const SECRET_PATTERNS: RegExp[] = [
  // OpenAI / Anthropic / generic provider keys
  /sk-[A-Za-z0-9_-]{12,}/g,
  /\b[A-Za-z0-9_-]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_-]*\b\s*[:=]\s*\S+/gi,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
];

/**
 * Redact obvious secrets from a line of terminal output or a diagnostic value.
 * Conservative: it never removes non-secret content, only masks matched key
 * material. The full process environment is never passed through this — it is
 * simply never printed.
 */
export function redactConsoleSecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const eq = match.search(/[:=]/);
      if (eq >= 0) return `${match.slice(0, eq + 1)} <redacted>`;
      return '<redacted>';
    });
  }
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Resolve which OpenAI-compatible provider the console runs against.
 *
 * OpenClaude treats OpenRouter as an OpenAI-compatible provider (see vendored
 * `providerProfiles.ts`: `case 'openrouter' -> provider:'openai'`), so routing
 * at OpenRouter is purely env: point `OPENAI_BASE_URL` at OpenRouter, use the
 * OpenRouter key, and pick an OpenRouter model slug. OpenRouter is preferred
 * when `LIVE_OPENROUTER=1` and a key is present (proven working: gpt-4o-mini,
 * gpt-4o, kimi-k2-thinking, gpt-5-mini all returned in <10s). Otherwise the
 * direct OpenAI env is used unchanged.
 */
export type ConsoleProviderResolution = {
  label: 'openrouter' | 'openai';
  defaultModel: string;
  envOverrides: NodeJS.ProcessEnv;
};

export function resolveConsoleProviderEnv(env: NodeJS.ProcessEnv): ConsoleProviderResolution {
  const openRouterKey = String(env.OPENROUTER_API_KEY || '').trim();
  const openRouterEnabled =
    String(env.LIVE_OPENROUTER || '').trim() === '1' && openRouterKey.length > 0;
  if (openRouterEnabled) {
    return {
      label: 'openrouter',
      defaultModel: String(env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini').trim(),
      envOverrides: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: String(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').trim(),
        OPENAI_API_KEY: openRouterKey,
        OPENROUTER_API_KEY: openRouterKey,
      },
    };
  }
  return {
    label: 'openai',
    defaultModel: String(env.OPENAI_MODEL || '').trim(),
    envOverrides: { CLAUDE_CODE_USE_OPENAI: '1' },
  };
}

function defaultSpawn(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean; interactive: boolean },
): ConsoleChild {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    windowsHide: true,
    // Interactive sessions get a writable stdin so input can be forwarded.
    // Non-interactive (print/task) sessions ignore stdin like the job adapter.
    stdio: [options.interactive ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  return child as unknown as ConsoleChild;
}

/** Minimal shape we use from node-pty's IPty (loaded only if installed). */
type NodePtyModule = {
  spawn: (
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ) => {
    pid: number;
    onData(cb: (data: string) => void): void;
    onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
  };
};

let nodePtyModule: NodePtyModule | null | undefined;

/** Load node-pty once, lazily. Returns null when it is not installed/loadable. */
function loadNodePty(): NodePtyModule | null {
  if (nodePtyModule !== undefined) return nodePtyModule;
  try {
    // Anchor to cwd so this resolves under both the CJS build and the ESM test
    // runtime; node-pty hoists to the workspace root node_modules.
    const req = createRequire(path.join(process.cwd(), 'index.js'));
    nodePtyModule = req('node-pty') as NodePtyModule;
  } catch {
    nodePtyModule = null;
  }
  return nodePtyModule;
}

/** Wrap a node-pty IPty into the unified ConsoleChild interface. */
function ptyToConsoleChild(proc: ReturnType<NodePtyModule['spawn']>): ConsoleChild {
  const stdout = new EventEmitter();
  const exit = new EventEmitter();
  proc.onData((data) => stdout.emit('data', data));
  proc.onExit((e) =>
    exit.emit('exit', e.exitCode ?? null, e.signal != null ? String(e.signal) : null),
  );
  return {
    pid: proc.pid ?? null,
    // node-pty merges stdout+stderr into one TTY stream.
    stdout: stdout as unknown as NodeJS.ReadableStream,
    stderr: null,
    stdin: {
      write: (data: string) => {
        proc.write(data);
        return true;
      },
    },
    kill: (signal) => {
      try {
        proc.kill(typeof signal === 'string' ? signal : undefined);
      } catch {
        /* already gone */
      }
      return true;
    },
    resize: (cols, rows) => {
      try {
        proc.resize(cols, rows);
      } catch {
        /* window not ready */
      }
    },
    on: (event: 'exit' | 'error', listener: (...args: unknown[]) => void) => {
      // node-pty surfaces failures through onExit; there is no 'error' event.
      if (event === 'exit') exit.on('exit', listener);
    },
  } as ConsoleChild;
}

/** A PTY-backed spawn, or null when node-pty is unavailable. */
function defaultPtySpawn(): ConsoleSpawn | null {
  const pty = loadNodePty();
  if (!pty) return null;
  return (command, args, options) =>
    ptyToConsoleChild(
      pty.spawn(command, args, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: options.cwd,
        env: options.env,
      }),
    );
}

type ManagerOptions = {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: ConsoleSpawn;
  /**
   * PTY-backed spawn for interactive sessions. Defaults to node-pty when it is
   * loadable AND no explicit `spawnProcess` was injected (so tests that inject
   * a pipe spawn stay deterministic and never touch a real PTY). Pass `null`
   * to force pipe mode.
   */
  ptySpawn?: ConsoleSpawn | null;
  /** Override runtime resolution (tests). Defaults to the LocalCoder adapter. */
  resolveRuntime?: (workspaceRoot: string, env: NodeJS.ProcessEnv) => ConsoleRuntimeResolution;
  maxBufferChars?: number;
  now?: () => string;
  idFactory?: () => string;
};

export class OpenClaudeConsoleSession {
  private readonly emitter = new EventEmitter();
  private readonly buffer: ConsoleOutputChunk[] = [];
  private bufferChars = 0;
  private seq = 0;
  private child: ConsoleChild | null = null;
  private killFallback: NodeJS.Timeout | null = null;

  readonly info: ConsoleSessionInfo;

  constructor(
    info: ConsoleSessionInfo,
    private readonly maxBufferChars: number,
    private readonly now: () => string,
  ) {
    this.info = info;
    this.emitter.setMaxListeners(64);
  }

  /** Push a bounded, redacted chunk into the buffer and notify subscribers. */
  emitOutput(stream: ConsoleStreamName, raw: string): void {
    const data = redactConsoleSecrets(String(raw)).slice(0, MAX_CHUNK_CHARS);
    if (!data) return;
    const chunk: ConsoleOutputChunk = {
      seq: ++this.seq,
      stream,
      data,
      at: this.now(),
    };
    this.buffer.push(chunk);
    this.bufferChars += data.length;
    while (this.bufferChars > this.maxBufferChars && this.buffer.length > 1) {
      const dropped = this.buffer.shift();
      if (dropped) this.bufferChars -= dropped.data.length;
    }
    this.emitter.emit('chunk', chunk);
  }

  attachChild(child: ConsoleChild): void {
    this.child = child;
    this.info.pid = child.pid ?? null;
    child.stdout?.on('data', (data) => this.emitOutput('stdout', String(data)));
    child.stderr?.on('data', (data) => this.emitOutput('stderr', String(data)));
    child.on('error', (error: Error) => {
      this.markFailed(`console_process_error: ${error.message}`);
    });
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.markExited(code, signal);
    });
  }

  private markExited(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.killFallback) {
      clearTimeout(this.killFallback);
      this.killFallback = null;
    }
    if (this.info.state === 'exited' || this.info.state === 'failed') return;
    this.info.state = 'exited';
    this.info.exitCode = code;
    this.info.exitSignal = signal;
    this.info.exitedAt = this.now();
    this.emitOutput('system', `process exited (code=${String(code)} signal=${String(signal)})`);
    this.emitter.emit('lifecycle', this.info);
  }

  markFailed(reason: string): void {
    if (this.info.state === 'exited' || this.info.state === 'failed') return;
    this.info.state = 'failed';
    this.info.error = reason;
    this.info.exitedAt = this.now();
    this.emitOutput('system', reason);
    this.emitter.emit('lifecycle', this.info);
  }

  markRunning(): void {
    this.info.state = 'running';
    this.emitter.emit('lifecycle', this.info);
  }

  /** Forward input to the child stdin. Returns false if not writable. */
  write(input: string): boolean {
    if (!this.child?.stdin || !this.info.interactiveSupported) return false;
    if (this.info.state !== 'running' && this.info.state !== 'starting') return false;
    try {
      this.child.stdin.write(input);
      return true;
    } catch {
      return false;
    }
  }

  stop(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (!this.child) return false;
    if (this.info.state === 'exited' || this.info.state === 'failed') return false;
    const killed = this.child.kill(signal);
    // Hard-kill fallback so a stuck child never lingers.
    this.killFallback = setTimeout(() => {
      try {
        this.child?.kill('SIGKILL');
      } catch {
        // best effort
      }
    }, KILL_FALLBACK_MS);
    return killed;
  }

  /**
   * Submit a line programmatically the way a human types it into the REPL:
   * write the text, pause briefly, then send Enter as a SEPARATE keystroke.
   * Sending text and Enter in one chunk leaves the text unsubmitted in the Ink
   * input box (proven). Returns false if input is not deliverable.
   */
  submitLine(text: string, enterDelayMs = 1200): boolean {
    if (!this.write(text)) return false;
    setTimeout(() => {
      this.write('\r');
    }, enterDelayMs);
    return true;
  }

  /** Resize the underlying PTY when one is attached (no-op for pipe mode). */
  resize(cols: number, rows: number): boolean {
    if (!this.child?.resize) return false;
    this.child.resize(cols, rows);
    return true;
  }

  /**
   * Subscribe to live chunks. Replays the bounded buffer first so a late
   * terminal view (the UI data source) still receives the full transcript.
   */
  subscribe(listener: (event: { kind: 'chunk'; chunk: ConsoleOutputChunk } | { kind: 'lifecycle'; info: ConsoleSessionInfo }) => void): () => void {
    for (const chunk of this.buffer) listener({ kind: 'chunk', chunk });
    const onChunk = (chunk: ConsoleOutputChunk) => listener({ kind: 'chunk', chunk });
    const onLifecycle = (info: ConsoleSessionInfo) => listener({ kind: 'lifecycle', info });
    this.emitter.on('chunk', onChunk);
    this.emitter.on('lifecycle', onLifecycle);
    return () => {
      this.emitter.off('chunk', onChunk);
      this.emitter.off('lifecycle', onLifecycle);
    };
  }

  transcript(): ConsoleOutputChunk[] {
    return [...this.buffer];
  }

  transcriptText(): string {
    return this.buffer.map((chunk) => chunk.data).join('');
  }
}

export type StartConsoleSessionResult =
  | { ok: true; session: OpenClaudeConsoleSession }
  | { ok: false; error: string; missing: string[] };

export class OpenClaudeConsoleSessionManager {
  private readonly sessions = new Map<string, OpenClaudeConsoleSession>();
  private readonly workspaceRoot: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly provider: ConsoleProviderResolution;
  private readonly spawnProcess: ConsoleSpawn;
  private readonly ptySpawn: ConsoleSpawn | null;
  private readonly resolveRuntime: (workspaceRoot: string, env: NodeJS.ProcessEnv) => ConsoleRuntimeResolution;
  private readonly maxBufferChars: number;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private counter = 0;

  constructor(options: ManagerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot
      ? path.resolve(options.workspaceRoot)
      : resolveLocalCoderWorkspaceRoot(process.cwd());
    this.env = options.env || process.env;
    this.provider = resolveConsoleProviderEnv(this.env);
    this.spawnProcess = options.spawnProcess || defaultSpawn;
    // node-pty only when not overridden by an injected pipe spawn.
    this.ptySpawn =
      options.ptySpawn !== undefined
        ? options.ptySpawn
        : options.spawnProcess
          ? null
          : defaultPtySpawn();
    this.resolveRuntime =
      options.resolveRuntime ||
      ((workspaceRoot, env) =>
        new LocalCoderAdapter({ workspaceRoot, env }).resolveConsoleRuntime());
    this.maxBufferChars = options.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;
    this.now = options.now || nowIso;
    this.idFactory = options.idFactory || (() => `occ_${Date.now()}_${++this.counter}`);
  }

  private resolveModel(request: StartConsoleSessionRequest): string {
    return String(request.model || this.provider.defaultModel || '').trim();
  }

  private buildArgs(request: StartConsoleSessionRequest, mode: ConsoleMode): string[] {
    if (request.args && request.args.length > 0) return [...request.args];
    // OpenRouter is OpenAI-compatible, so the CLI provider stays "openai".
    const provider = request.provider || 'openai';
    const model = this.resolveModel(request);
    const modelFlags = model ? ['--model', model, '--provider', provider] : [];
    if (mode === 'interactive') {
      // A normal interactive OpenClaude session keeps its full CLI abilities.
      return [...modelFlags];
    }
    // print / task: one-shot, prompt delivered via argv like the job adapter.
    const prompt = String(request.prompt || '').trim();
    return ['--print', prompt, ...modelFlags];
  }

  start(request: StartConsoleSessionRequest): StartConsoleSessionResult {
    const mode: ConsoleMode = request.mode || 'interactive';
    const targetRoot = path.resolve(request.targetRoot || this.workspaceRoot);
    if (!existsSync(targetRoot)) {
      return { ok: false, error: `console_target_root_missing: ${targetRoot}`, missing: [] };
    }
    if ((mode === 'print' || mode === 'task') && !String(request.prompt || '').trim()) {
      return { ok: false, error: `console_prompt_required_for_${mode}`, missing: [] };
    }

    const runtime = this.resolveRuntime(this.workspaceRoot, this.env);
    if (!runtime.ready) {
      return { ok: false, error: 'console_runtime_unavailable', missing: runtime.missing };
    }
    // print/task cannot really run without provider credentials; interactive and
    // help can start and surface the CLI's own prompt/error honestly.
    if ((mode === 'print' || mode === 'task') && runtime.envMissing.length > 0) {
      return { ok: false, error: 'console_env_missing', missing: runtime.envMissing };
    }

    const args = this.buildArgs(request, mode);
    const resolvedModel = this.resolveModel(request);
    const interactive = mode === 'interactive';
    // Interactive sessions use a real PTY when node-pty is available so the
    // OpenClaude REPL gets a TTY; print/task one-shots use stdio pipes (keeps
    // stderr separable and matches the proven headless path).
    const usePty = interactive && this.ptySpawn != null;
    const transportMode: ConsoleTransportMode = usePty ? 'pty' : 'pipe';
    const info: ConsoleSessionInfo = {
      id: this.idFactory(),
      targetRoot,
      mode,
      state: 'starting',
      commandPath: redactConsoleSecrets(runtime.describe),
      runtimeSource: runtime.source,
      transportMode,
      provider: this.provider.label,
      model: resolvedModel || null,
      interactiveSupported: interactive,
      pid: null,
      startedAt: this.now(),
      exitedAt: null,
      exitCode: null,
      exitSignal: null,
      warnings: runtime.envMissing.length > 0 ? [`env_advisory: ${runtime.envMissing.join(', ')}`] : [],
      error: null,
    };

    const session = new OpenClaudeConsoleSession(info, this.maxBufferChars, this.now);
    this.sessions.set(info.id, session);

    const spawnFn = usePty ? this.ptySpawn! : this.spawnProcess;
    let child: ConsoleChild;
    try {
      child = spawnFn(runtime.command, [...runtime.baseArgs, ...args], {
        cwd: targetRoot,
        // Route the OpenAI-compatible provider (OpenRouter when configured).
        env: {
          ...this.env,
          ...this.provider.envOverrides,
          ...(resolvedModel ? { OPENAI_MODEL: resolvedModel } : {}),
        },
        shell: runtime.shell,
        interactive,
      });
    } catch (error) {
      session.markFailed(
        `console_spawn_failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: true, session };
    }
    session.attachChild(child);
    session.markRunning();
    return { ok: true, session };
  }

  get(id: string): OpenClaudeConsoleSession | undefined {
    return this.sessions.get(id);
  }

  list(): ConsoleSessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info);
  }

  /** Reuse a live session for a target root, or undefined if none is running. */
  findRunningForRoot(targetRoot: string): OpenClaudeConsoleSession | undefined {
    const resolved = path.resolve(targetRoot);
    for (const session of this.sessions.values()) {
      if (
        path.resolve(session.info.targetRoot) === resolved &&
        (session.info.state === 'running' || session.info.state === 'starting')
      ) {
        return session;
      }
    }
    return undefined;
  }

  hasAnySession(): boolean {
    return this.sessions.size > 0;
  }

  stopAll(): void {
    for (const session of this.sessions.values()) session.stop();
  }
}

export const openClaudeConsoleSessionManager = new OpenClaudeConsoleSessionManager();
