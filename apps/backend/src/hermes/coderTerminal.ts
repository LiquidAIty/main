import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { resolveRepoRoot } from '../coder/workspaceRoot';
import type {
  HermesPreparedSession,
  HermesSessionEvent,
  HermesTurnHandle,
} from './mainAdapter';

export type ConsoleMode = 'interactive';
export type ConsoleSessionState =
  | 'starting'
  | 'ready'
  | 'working'
  | 'waiting'
  | 'stopped'
  | 'failed'
  | 'auth_required';
export type ConsoleStreamName = 'stdout' | 'stderr' | 'system';
export type ConsoleTransportMode = 'acp-stdio';

export type ConsoleOutputChunk = {
  seq: number;
  stream: ConsoleStreamName;
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
  nativeSessionId: string | null;
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

const DEFAULT_MAX_BUFFER_CHARS = 200_000;
const MAX_CHUNK_CHARS = 16_000;
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /\b[A-Za-z0-9_-]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_-]*\b\s*[:=]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
];

type ActiveTurnControl = Pick<HermesTurnHandle, 'answer' | 'cancel'> & { runId: string };

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

function terminalIdentity(request: StartConsoleSessionRequest): string {
  return [
    request.projectId,
    request.deckId,
    request.conversationId,
    request.ownerCardId || 'card_local_coder',
  ].join(':');
}

export class HermesCoderTerminalSession {
  private readonly emitter = new EventEmitter();
  private readonly buffer: ConsoleOutputChunk[] = [];
  private bufferChars = 0;
  private sequence = 0;
  private active: ActiveTurnControl | null = null;
  private permissionPromptId: string | null = null;

  constructor(
    readonly info: ConsoleSessionInfo,
    private readonly maxBufferChars = DEFAULT_MAX_BUFFER_CHARS,
  ) {
    this.emitter.setMaxListeners(64);
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

  markPreparing(): void {
    this.info.state = 'starting';
    this.info.error = null;
    this.touch();
  }

  markReady(prepared: HermesPreparedSession): void {
    this.info.state = 'ready';
    this.info.provider = prepared.provider;
    this.info.model = prepared.modelKey;
    this.info.pid = prepared.pid;
    this.info.nativeSessionId = prepared.sessionId;
    this.info.activeRunId = null;
    this.info.stoppedAt = null;
    this.info.error = null;
    this.active = null;
    this.permissionPromptId = null;
    this.emitOutput('system', 'Coder ready.\r\n› ');
    this.touch();
  }

  beginTurn(runId: string): boolean {
    if (this.info.state !== 'ready' || this.active) return false;
    this.info.state = 'working';
    this.info.activeRunId = runId;
    this.info.error = null;
    this.permissionPromptId = null;
    this.touch();
    return true;
  }

  attachControl(runId: string, handle: Pick<HermesTurnHandle, 'answer' | 'cancel'>): boolean {
    if (this.info.activeRunId !== runId || this.info.state !== 'working') return false;
    this.active = { runId, ...handle };
    this.touch();
    return true;
  }

  receiveHermesEvent(event: HermesSessionEvent): void {
    if (event.kind === 'text') {
      this.emitOutput('stdout', event.text);
      return;
    }
    if (event.kind === 'reasoning') {
      this.emitOutput('system', event.text);
      return;
    }
    if (event.kind === 'tool_start') {
      this.emitOutput('system', `\r\n[tool] ${event.toolName}\r\n`);
      return;
    }
    if (event.kind === 'tool_result') {
      if (event.isError) this.emitOutput('stderr', `\r\n[tool failed] ${event.toolName}\r\n`);
      return;
    }
    if (event.kind === 'permission') {
      this.permissionPromptId = event.promptId;
      this.info.state = 'waiting';
      this.emitOutput('system', `\r\n${event.question}\r\n› `);
      this.touch();
      return;
    }
    if (event.kind === 'error') {
      this.emitOutput('stderr', `\r\n${event.message}\r\n`);
    }
  }

  answerPermission(reply: string): boolean {
    if (!this.active || this.info.state !== 'waiting' || !this.permissionPromptId) return false;
    this.active.answer(this.permissionPromptId, reply);
    this.permissionPromptId = null;
    this.info.state = 'working';
    this.touch();
    return true;
  }

  completeTurn(runId: string): void {
    if (this.info.activeRunId !== runId || this.info.state === 'stopped') return;
    this.active = null;
    this.permissionPromptId = null;
    this.info.activeRunId = null;
    this.info.state = 'ready';
    this.emitOutput('system', '\r\n› ');
    this.touch();
  }

  markAuthRequired(reason: string): void {
    this.active = null;
    this.permissionPromptId = null;
    this.info.activeRunId = null;
    this.info.state = 'auth_required';
    this.info.error = reason;
    this.emitOutput('system', 'Authentication required. Use the native Hermes login, then restart Coder.\r\n');
    this.touch();
  }

  markFailed(reason: string): void {
    if (this.info.state === 'stopped') return;
    this.active = null;
    this.permissionPromptId = null;
    this.info.activeRunId = null;
    this.info.state = 'failed';
    this.info.error = reason;
    this.emitOutput('stderr', `\r\n${reason}\r\n`);
    this.touch();
  }

  stop(): boolean {
    if (!this.active || !['working', 'waiting'].includes(this.info.state)) return false;
    this.active.cancel();
    this.active = null;
    this.permissionPromptId = null;
    this.info.activeRunId = null;
    this.info.state = 'stopped';
    this.info.stoppedAt = new Date().toISOString();
    this.emitOutput('system', '\r\nStopped.\r\n');
    this.touch();
    return true;
  }

  isStopped(): boolean {
    return this.info.state === 'stopped';
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

  private touch(): void {
    this.info.updatedAt = new Date().toISOString();
    this.emitter.emit('lifecycle', this.info);
  }
}

export class HermesCoderTerminalManager {
  private readonly sessionsById = new Map<string, HermesCoderTerminalSession>();
  private readonly sessionsByIdentity = new Map<string, HermesCoderTerminalSession>();
  private counter = 0;

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
    if (existing) return { ok: true, session: existing, created: false };

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
      transportMode: 'acp-stdio',
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
    const session = new HermesCoderTerminalSession(info);
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
