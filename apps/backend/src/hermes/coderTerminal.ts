import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn as spawnPty, type IPty, type IWindowsPtyForkOptions } from 'node-pty';

import { resolveRepoRoot } from '../coder/workspaceRoot';

export type ConsoleMode = 'interactive';
export type ConsoleSessionState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
export type ConsoleTransportMode = 'pty';

export type ConsoleOutputChunk = {
  seq: number;
  stream: 'pty';
  data: string;
  at: string;
};

export type ConsoleSessionInfo = {
  id: string;
  ownerCardId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  targetRoot: string;
  mode: 'interactive';
  state: ConsoleSessionState;
  runtimeSource: 'saved_hermes_card';
  transportMode: ConsoleTransportMode;
  profile: string;
  provider: string | null;
  model: string | null;
  interactiveSupported: true;
  pid: number | null;
  nativeSessionId: null;
  activeRunId: string | null;
  startedAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  warnings: string[];
  error: string | null;
};

export type StartConsoleSessionRequest = {
  projectId: string;
  deckId: string;
  conversationId: string;
  ownerCardId?: string;
  targetRoot?: string;
  mode?: ConsoleMode;
  profile?: string;
};

export type HermesCoderPtyLaunch = {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  provider: string;
  model: string;
  runId: string;
  cols?: number;
  rows?: number;
  onExit?: (result: { exitCode: number; signal?: number; stopped: boolean }) => void;
};

type PtyLike = Pick<IPty, 'pid' | 'write' | 'resize' | 'kill' | 'onData' | 'onExit'>;
export type PtyFactory = (
  executable: string,
  args: string[],
  options: IWindowsPtyForkOptions,
) => PtyLike;

const DEFAULT_MAX_BUFFER_CHARS = 200_000;
const MAX_CHUNK_CHARS = 16_000;

export function resolveHermesCliInstall(): { root: string; executable: string } {
  const root = path.join(resolveRepoRoot(), 'Hermes');
  const executable = path.join(root, 'venv', 'Scripts', 'hermes.exe');
  if (!existsSync(executable)) throw new Error(`hermes_repo_cli_missing:${executable}`);
  return { root, executable };
}

function terminalIdentity(request: StartConsoleSessionRequest): string {
  return [
    request.projectId,
    request.deckId,
    request.conversationId,
    request.ownerCardId || 'card_local_coder',
  ].join(':');
}

/**
 * One literal Hermes CLI pseudoterminal. The bytes published here come only
 * from node-pty; ACP events, synthetic prompts, and local line editing do not
 * enter this surface.
 */
export class HermesCoderTerminalSession {
  private readonly emitter = new EventEmitter();
  private readonly buffer: ConsoleOutputChunk[] = [];
  private bufferChars = 0;
  private sequence = 0;
  private process: PtyLike | null = null;
  private stopRequested = false;

  constructor(
    readonly info: ConsoleSessionInfo,
    private readonly ptyFactory: PtyFactory = spawnPty,
    private readonly maxBufferChars = DEFAULT_MAX_BUFFER_CHARS,
  ) {
    this.emitter.setMaxListeners(64);
  }

  start(launch: HermesCoderPtyLaunch): void {
    if (this.process && this.isLive()) throw new Error('hermes_coder_terminal_already_running');
    this.stopRequested = false;
    this.info.state = 'starting';
    this.info.provider = launch.provider;
    this.info.model = launch.model;
    this.info.activeRunId = launch.runId;
    this.info.error = null;
    this.info.stoppedAt = null;
    this.touch();

    const child = this.ptyFactory(launch.executable, launch.args, {
      name: 'xterm-256color',
      cols: launch.cols || 120,
      rows: launch.rows || 30,
      cwd: this.info.targetRoot,
      env: launch.env,
      useConpty: true,
    });
    this.process = child;
    this.info.pid = child.pid;
    this.info.state = 'running';
    this.touch();

    child.onData((data) => this.emitPtyOutput(String(data)));
    child.onExit(({ exitCode, signal }) => {
      if (this.process !== child) return;
      this.process = null;
      const stopped = this.stopRequested;
      this.info.pid = null;
      this.info.activeRunId = null;
      this.info.stoppedAt = new Date().toISOString();
      this.info.state = stopped || exitCode === 0 ? 'stopped' : 'failed';
      this.info.error = stopped || exitCode === 0
        ? null
        : `hermes_cli_exited:${exitCode}:${signal ?? 'none'}`;
      this.touch();
      launch.onExit?.({ exitCode, signal, stopped });
    });
  }

  markFailed(reason: string): void {
    this.process = null;
    this.info.pid = null;
    this.info.activeRunId = null;
    this.info.state = 'failed';
    this.info.error = reason;
    this.info.stoppedAt = new Date().toISOString();
    this.touch();
  }

  write(data: string): boolean {
    if (!data || !this.process || !this.isLive()) return false;
    this.process.write(data);
    return true;
  }

  resize(cols: number, rows: number): boolean {
    if (!this.process || !this.isLive()) return false;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return false;
    this.process.resize(Math.min(cols, 500), Math.min(rows, 200));
    return true;
  }

  stop(): boolean {
    if (!this.process || !this.isLive()) return false;
    this.stopRequested = true;
    this.process.kill();
    this.info.state = 'stopping';
    this.touch();
    return true;
  }

  isLive(): boolean {
    return Boolean(this.process) && ['starting', 'running'].includes(this.info.state);
  }

  hasProcess(): boolean {
    return Boolean(this.process);
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

  private emitPtyOutput(raw: string): void {
    for (let offset = 0; offset < raw.length; offset += MAX_CHUNK_CHARS) {
      const data = raw.slice(offset, offset + MAX_CHUNK_CHARS);
      if (!data) continue;
      const chunk: ConsoleOutputChunk = {
        seq: ++this.sequence,
        stream: 'pty',
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
  }

  private touch(): void {
    this.info.updatedAt = new Date().toISOString();
    this.emitter.emit('lifecycle', this.info);
  }
}

export class HermesCoderTerminalManager {
  private readonly sessionsById = new Map<string, HermesCoderTerminalSession>();
  private readonly sessionsByIdentity = new Map<string, HermesCoderTerminalSession>();
  private counter = 0;

  constructor(private readonly ptyFactory: PtyFactory = spawnPty) {}

  acquire(request: StartConsoleSessionRequest):
    | { ok: true; session: HermesCoderTerminalSession; created: boolean }
    | { ok: false; error: string; missing: string[] } {
    const projectId = String(request.projectId || '').trim();
    const deckId = String(request.deckId || '').trim();
    const conversationId = String(request.conversationId || '').trim();
    if (!projectId || !deckId || !conversationId) {
      return { ok: false, error: 'hermes_coder_terminal_identity_required', missing: [] };
    }
    const targetRoot = path.resolve(request.targetRoot || resolveRepoRoot());
    if (!existsSync(targetRoot)) {
      return {
        ok: false,
        error: `hermes_coder_terminal_target_root_missing:${targetRoot}`,
        missing: [],
      };
    }
    const normalizedRequest = { ...request, projectId, deckId, conversationId };
    const identity = terminalIdentity(normalizedRequest);
    const existing = this.sessionsByIdentity.get(identity);
    if (existing?.hasProcess()) return { ok: true, session: existing, created: false };

    const now = new Date().toISOString();
    const info: ConsoleSessionInfo = {
      id: `coder_terminal_${Date.now()}_${++this.counter}`,
      ownerCardId: request.ownerCardId || 'card_local_coder',
      projectId,
      deckId,
      conversationId,
      targetRoot,
      mode: 'interactive',
      state: 'starting',
      runtimeSource: 'saved_hermes_card',
      transportMode: 'pty',
      profile: request.profile || 'coder',
      provider: null,
      model: null,
      interactiveSupported: true,
      pid: null,
      nativeSessionId: null,
      activeRunId: null,
      startedAt: now,
      updatedAt: now,
      stoppedAt: null,
      warnings: [],
      error: null,
    };
    const session = new HermesCoderTerminalSession(info, this.ptyFactory);
    this.sessionsById.set(info.id, session);
    this.sessionsByIdentity.set(identity, session);
    return { ok: true, session, created: true };
  }

  get(id: string): HermesCoderTerminalSession | undefined {
    return this.sessionsById.get(id);
  }

  find(args: {
    projectId: string;
    deckId: string;
    conversationId: string;
    ownerCardId?: string;
  }): HermesCoderTerminalSession | undefined {
    return this.sessionsByIdentity.get(terminalIdentity({ ...args }));
  }

  list(): ConsoleSessionInfo[] {
    return [...this.sessionsById.values()].map((session) => session.info);
  }

  stopAll(): void {
    for (const session of this.sessionsById.values()) session.stop();
  }
}

export const coderTerminalSessionManager = new HermesCoderTerminalManager();
