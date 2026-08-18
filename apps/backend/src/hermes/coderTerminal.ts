import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveRepoRoot } from '../coder/workspaceRoot';
import { ensureHermesHolographicMemoryProfile } from './profileMemory';

export type ConsoleMode = 'interactive' | 'print' | 'task' | 'shell';
export type ConsoleSessionState = 'starting' | 'running' | 'exited' | 'failed';
export type ConsoleStreamName = 'stdout' | 'stderr' | 'system';
export type ConsoleTransportMode = 'pty';

export type ConsoleOutputChunk = {
  seq: number;
  stream: ConsoleStreamName;
  data: string;
  at: string;
};

export type ConsoleSessionInfo = {
  id: string;
  ownerCardId: string;
  targetRoot: string;
  mode: 'interactive';
  state: ConsoleSessionState;
  commandPath: string;
  runtimeSource: 'hermes_installed';
  transportMode: ConsoleTransportMode;
  provider: null;
  model: null;
  interactiveSupported: true;
  pid: number | null;
  startedAt: string;
  exitedAt: string | null;
  exitCode: number | null;
  exitSignal: string | null;
  warnings: string[];
  error: string | null;
};

export type StartConsoleSessionRequest = {
  targetRoot?: string;
  mode?: ConsoleMode;
  /** Optional loose/exact Markdown IDF shown for review; it is never submitted. */
  prompt?: string;
};

type NodePtyModule = {
  spawn: (
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ) => {
    pid: number;
    onData(cb: (data: string) => void): void;
    onExit(cb: (event: { exitCode: number; signal?: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
  };
};

const DEFAULT_MAX_BUFFER_CHARS = 200_000;
const MAX_CHUNK_CHARS = 16_000;
const KILL_FALLBACK_MS = 5_000;
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /\b[A-Za-z0-9_-]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_-]*\b\s*[:=]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
];

let nodePtyModule: NodePtyModule | null | undefined;

export function redactTerminalSecrets(value: string): string {
  let output = value;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => {
      const separator = match.search(/[:=]/);
      return separator >= 0 ? `${match.slice(0, separator + 1)} <redacted>` : '<redacted>';
    });
  }
  return output;
}

function loadNodePty(): NodePtyModule | null {
  if (nodePtyModule !== undefined) return nodePtyModule;
  try {
    const require = createRequire(path.join(process.cwd(), 'index.js'));
    nodePtyModule = require('node-pty') as NodePtyModule;
  } catch {
    nodePtyModule = null;
  }
  return nodePtyModule;
}

function resolveHermesCli(): string {
  return path.join(
    resolveRepoRoot(),
    'Hermes',
    'venv',
    'Scripts',
    process.platform === 'win32' ? 'hermes.exe' : 'hermes',
  );
}

export class HermesCoderTerminalSession {
  private readonly emitter = new EventEmitter();
  private readonly buffer: ConsoleOutputChunk[] = [];
  private bufferChars = 0;
  private sequence = 0;
  private process: ReturnType<NodePtyModule['spawn']> | null = null;
  private killFallback: NodeJS.Timeout | null = null;

  constructor(
    readonly info: ConsoleSessionInfo,
    private readonly maxBufferChars = DEFAULT_MAX_BUFFER_CHARS,
  ) {
    this.emitter.setMaxListeners(64);
  }

  attach(process: ReturnType<NodePtyModule['spawn']>): void {
    this.process = process;
    this.info.pid = process.pid ?? null;
    process.onData((data) => this.emitOutput('stdout', data));
    process.onExit((event) => this.markExited(event.exitCode ?? null, event.signal));
  }

  emitOutput(stream: ConsoleStreamName, raw: string): void {
    const data = redactTerminalSecrets(String(raw)).slice(0, MAX_CHUNK_CHARS);
    if (!data) return;
    const chunk: ConsoleOutputChunk = {
      seq: ++this.sequence,
      stream,
      data,
      at: new Date().toISOString(),
    };
    this.buffer.push(chunk);
    this.bufferChars += data.length;
    while (this.bufferChars > this.maxBufferChars && this.buffer.length > 1) {
      const removed = this.buffer.shift();
      if (removed) this.bufferChars -= removed.data.length;
    }
    this.emitter.emit('chunk', chunk);
  }

  markRunning(): void {
    this.info.state = 'running';
    this.emitter.emit('lifecycle', this.info);
  }

  markFailed(reason: string): void {
    if (this.info.state === 'failed' || this.info.state === 'exited') return;
    this.info.state = 'failed';
    this.info.error = reason;
    this.info.exitedAt = new Date().toISOString();
    this.emitOutput('system', reason);
    this.emitter.emit('lifecycle', this.info);
  }

  private markExited(exitCode: number | null, signal?: number): void {
    if (this.killFallback) clearTimeout(this.killFallback);
    this.killFallback = null;
    if (this.info.state === 'failed' || this.info.state === 'exited') return;
    this.info.state = 'exited';
    this.info.exitCode = exitCode;
    this.info.exitSignal = signal == null ? null : String(signal);
    this.info.exitedAt = new Date().toISOString();
    this.emitOutput(
      'system',
      `process exited (code=${String(exitCode)} signal=${this.info.exitSignal || 'none'})`,
    );
    this.emitter.emit('lifecycle', this.info);
  }

  write(data: string): boolean {
    if (!this.process || this.info.state !== 'running') return false;
    try {
      this.process.write(data);
      return true;
    } catch {
      return false;
    }
  }

  resize(cols: number, rows: number): boolean {
    if (!this.process) return false;
    try {
      this.process.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  stop(): boolean {
    if (!this.process || !['starting', 'running'].includes(this.info.state)) return false;
    try {
      this.process.kill('SIGTERM');
      this.killFallback = setTimeout(() => {
        try { this.process?.kill('SIGKILL'); } catch { /* process already exited */ }
      }, KILL_FALLBACK_MS);
      return true;
    } catch {
      return false;
    }
  }

  subscribe(
    listener: (
      event:
        | { kind: 'chunk'; chunk: ConsoleOutputChunk }
        | { kind: 'lifecycle'; info: ConsoleSessionInfo },
    ) => void,
  ): () => void {
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
}

export class HermesCoderTerminalManager {
  private readonly sessions = new Map<string, HermesCoderTerminalSession>();
  private counter = 0;

  start(request: StartConsoleSessionRequest):
    | { ok: true; session: HermesCoderTerminalSession }
    | { ok: false; error: string; missing: string[] } {
    if ((request.mode || 'interactive') !== 'interactive') {
      return { ok: false, error: 'hermes_coder_terminal_interactive_only', missing: [] };
    }
    const targetRoot = path.resolve(request.targetRoot || resolveRepoRoot());
    if (!existsSync(targetRoot)) {
      return {
        ok: false,
        error: `hermes_coder_terminal_target_root_missing:${targetRoot}`,
        missing: [],
      };
    }
    const command = resolveHermesCli();
    if (!existsSync(command)) {
      return {
        ok: false,
        error: 'hermes_coder_runtime_unavailable',
        missing: [`hermes_repo_cli_entrypoint_missing:${command}`],
      };
    }
    const pty = loadNodePty();
    if (!pty) {
      return { ok: false, error: 'hermes_coder_terminal_pty_unavailable', missing: ['node_pty'] };
    }
    const info: ConsoleSessionInfo = {
      id: `coder_terminal_${Date.now()}_${++this.counter}`,
      ownerCardId: 'card_local_coder',
      targetRoot,
      mode: 'interactive',
      state: 'starting',
      commandPath: `${command} chat --cli --toolsets file,terminal,memory`,
      runtimeSource: 'hermes_installed',
      transportMode: 'pty',
      provider: null,
      model: null,
      interactiveSupported: true,
      pid: null,
      startedAt: new Date().toISOString(),
      exitedAt: null,
      exitCode: null,
      exitSignal: null,
      warnings: [],
      error: null,
    };
    const session = new HermesCoderTerminalSession(info);
    this.sessions.set(info.id, session);
    try {
      const profileHome = ensureHermesHolographicMemoryProfile(
        path.join(resolveRepoRoot(), 'Hermes'),
        'coder',
      );
      const child = pty.spawn(
        command,
        ['chat', '--cli', '--toolsets', 'file,terminal,memory'],
        {
          name: 'xterm-color',
          cols: 120,
          rows: 30,
          cwd: targetRoot,
          env: {
            ...globalThis.process.env,
            HERMES_HOME: profileHome,
            HERMES_SESSION_SOURCE: 'saved-coder-card-terminal',
          },
        },
      );
      session.attach(child);
      if (request.prompt?.trim()) {
        session.emitOutput(
          'system',
          `\r\n--- IDF available for review; it has not been submitted ---\r\n${request.prompt}\r\n--- end IDF ---\r\n`,
        );
      }
      session.markRunning();
    } catch (error) {
      session.markFailed(
        `hermes_coder_terminal_spawn_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { ok: true, session };
  }

  get(id: string): HermesCoderTerminalSession | undefined {
    return this.sessions.get(id);
  }

  list(): ConsoleSessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info);
  }

  stopAll(): void {
    for (const session of this.sessions.values()) session.stop();
  }
}

export const coderTerminalSessionManager = new HermesCoderTerminalManager();
