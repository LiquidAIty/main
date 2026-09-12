import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn as spawnPty, type IPty, type IWindowsPtyForkOptions } from 'node-pty';

import { resolveRepoRoot } from '../services/workspaceRoot';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { MainCliBridge } from './mainCliBridge';
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { pool } from '../db/pool';

type ConsoleSessionState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
type ConsoleTransportMode = 'pty';

export type ConsoleSessionInfo = {
  id: string;
  ownerCardId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  targetRoot: string;
  mode: 'interactive';
  state: ConsoleSessionState;
  runtimeSource: 'repository_hermes_cli';
  transportMode: ConsoleTransportMode;
  profile: string;
  executable: string | null;
  hermesHome: string | null;
  interactiveSupported: true;
  pid: number | null;
  startedAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  warnings: string[];
  error: string | null;
};

type StartConsoleSessionRequest = {
  projectId: string;
  deckId: string;
  conversationId: string;
  ownerCardId: string;
  targetRoot?: string;
  profile: string;
};

export type BuilderPtyLaunch = {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  profile: string;
  hermesHome: string;
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

function resolveHermesCliInstall(): { root: string; executable: string } {
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
    request.ownerCardId,
  ].join(':');
}

/**
 * Builder's literal Hermes CLI pseudoterminal. The bytes published here come only
 * from node-pty; ACP events, synthetic prompts, and local line editing do not
 * enter this surface.
 */
export class BuilderTerminalSession {
  /** Builder owns a separate instance of the existing native CLI delivery bridge. */
  readonly delivery: { bridge: MainCliBridge; token: string } | null;
  private readonly emitter = new EventEmitter();
  private process: PtyLike | null = null;
  private stopRequested = false;

  constructor(
    readonly info: ConsoleSessionInfo,
    private readonly ptyFactory: PtyFactory = spawnPty,
  ) {
    this.delivery = info.profile === 'builder'
      ? { bridge: new MainCliBridge(), token: randomBytes(32).toString('hex') }
      : null;
    this.emitter.setMaxListeners(64);
  }

  start(launch: BuilderPtyLaunch): void {
    if (this.process && this.isLive()) throw new Error('hermes_builder_terminal_already_running');
    this.stopRequested = false;
    this.info.state = 'starting';
    this.info.profile = launch.profile;
    this.info.executable = launch.executable;
    this.info.hermesHome = launch.hermesHome;
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
    this.info.state = 'stopping';
    this.touch();
    this.process.kill();
    return true;
  }

  isLive(): boolean {
    return Boolean(this.process) && ['starting', 'running'].includes(this.info.state);
  }

  hasProcess(): boolean {
    return Boolean(this.process);
  }

  subscribeOutput(listener: (data: string) => void): () => void {
    this.emitter.on('output', listener);
    return () => {
      this.emitter.off('output', listener);
    };
  }

  subscribeLifecycle(listener: (info: ConsoleSessionInfo) => void): () => void {
    this.emitter.on('lifecycle', listener);
    return () => {
      this.emitter.off('lifecycle', listener);
    };
  }

  private emitPtyOutput(raw: string): void {
    if (raw) this.emitter.emit('output', raw);
  }

  private touch(): void {
    this.info.updatedAt = new Date().toISOString();
    this.emitter.emit('lifecycle', this.info);
  }
}

export class BuilderTerminalManager {
  private readonly sessionsById = new Map<string, BuilderTerminalSession>();
  private readonly sessionsByIdentity = new Map<string, BuilderTerminalSession>();
  private counter = 0;

  constructor(private readonly ptyFactory: PtyFactory = spawnPty) {}

  acquire(request: StartConsoleSessionRequest):
    | { ok: true; session: BuilderTerminalSession; created: boolean }
    | { ok: false; error: string; missing: string[] } {
    const projectId = String(request.projectId || '').trim();
    const deckId = String(request.deckId || '').trim();
    const conversationId = String(request.conversationId || '').trim();
    if (!projectId || !deckId || !conversationId || !request.ownerCardId?.trim() || !request.profile?.trim()) {
      return { ok: false, error: 'hermes_builder_terminal_identity_required', missing: [] };
    }
    if (request.profile !== 'builder' || request.ownerCardId === 'card_main_chat') {
      return { ok: false, error: 'builder_terminal_saved_profile_required', missing: [] };
    }
    const targetRoot = path.resolve(request.targetRoot || resolveRepoRoot());
    if (!existsSync(targetRoot)) {
      return {
        ok: false,
        error: `hermes_builder_terminal_target_root_missing:${targetRoot}`,
        missing: [],
      };
    }
    const normalizedRequest = { ...request, projectId, deckId, conversationId };
    const identity = terminalIdentity(normalizedRequest);
    const existing = this.sessionsByIdentity.get(identity);
    if (existing?.hasProcess()) return { ok: true, session: existing, created: false };

    const now = new Date().toISOString();
    const info: ConsoleSessionInfo = {
      id: `builder_terminal_${Date.now()}_${++this.counter}`,
      ownerCardId: request.ownerCardId,
      projectId,
      deckId,
      conversationId,
      targetRoot,
      mode: 'interactive',
      state: 'starting',
      runtimeSource: 'repository_hermes_cli',
      transportMode: 'pty',
      profile: request.profile,
      executable: null,
      hermesHome: null,
      interactiveSupported: true,
      pid: null,
      startedAt: now,
      updatedAt: now,
      stoppedAt: null,
      warnings: [],
      error: null,
    };
    const session = new BuilderTerminalSession(info, this.ptyFactory);
    this.sessionsById.set(info.id, session);
    this.sessionsByIdentity.set(identity, session);
    return { ok: true, session, created: true };
  }

  get(id: string): BuilderTerminalSession | undefined {
    return this.sessionsById.get(id);
  }

  list(): ConsoleSessionInfo[] {
    return [...this.sessionsById.values()].map((session) => session.info);
  }

  stopAll(): void {
    for (const session of this.sessionsById.values()) session.stop();
  }
}

export const builderTerminalSessionManager = new BuilderTerminalManager();

function startBuilderTerminalSession(session: BuilderTerminalSession): void {
  const install = resolveHermesCliInstall();
  const hermesHome = path.join(install.root, '.hermes');
  const profile = session.info.profile;
  session.start({
    executable: install.executable,
    args: ['-p', profile, 'chat', '--cli', '--in', session.info.targetRoot],
    env: {
      ...withoutInternalMcpSecret(process.env),
      HERMES_HOME: hermesHome,
      ...(session.delivery ? {
        LIQUIDAITY_MAIN_BRIDGE_URL: `http://127.0.0.1:${process.env.PORT || '4000'}/api/internal/builder-cli/${session.info.id}`,
        LIQUIDAITY_MAIN_BRIDGE_TOKEN: session.delivery.token,
      } : {}),
    },
    profile,
    hermesHome,
  });
}

/** Acquire the saved Builder's native CLI through the existing terminal owner. */
export async function ensurePersistentBuilderTerminal(): Promise<ConsoleSessionInfo> {
  const { rows } = await pool.query<{ id: string }>('SELECT id::text AS id FROM ag_catalog.projects');
  const identities: Array<{ projectId: string; deckId: string; cardId: string }> = [];
  for (const project of rows) {
    const { deck } = await getDeckDocument(project.id, BUILDER_DECK_ID);
    for (const card of deck?.nodes || []) {
      if (card.runtime.kind === 'hermes' && card.runtime.mode === 'delegate'
        && card.runtime.profile === 'builder') {
        identities.push({ projectId: project.id, deckId: BUILDER_DECK_ID, cardId: card.id });
      }
    }
  }
  if (identities.length !== 1) throw new Error('builder_terminal_saved_identity_ambiguous_or_missing');
  return ensureSavedBuilderTerminal(identities[0]);
}

export async function ensureSavedBuilderTerminal(
  identity: { projectId: string; deckId: string; cardId: string },
  manager: BuilderTerminalManager = builderTerminalSessionManager,
  readDeck: typeof getDeckDocument = getDeckDocument,
  launch: (session: BuilderTerminalSession) => void = startBuilderTerminalSession,
): Promise<ConsoleSessionInfo> {
  const projectId = String(identity.projectId || '').trim();
  const deckId = String(identity.deckId || '').trim();
  const cardId = String(identity.cardId || '').trim();
  if (!projectId || !deckId || !cardId) throw new Error('builder_terminal_identity_required');
  const { deck } = await readDeck(projectId, deckId);
  const card = deck?.nodes.find((node) => node.id === cardId);
  if (!deck || !card || card.runtime.kind !== 'hermes'
    || card.runtime.mode !== 'delegate'
    || card.runtime.profile !== 'builder'
    || (card as unknown as { enabled?: boolean }).enabled === false
    || (card.runtimeOptions as { enabled?: boolean } | undefined)?.enabled === false
    || deck.nodes.filter((node) => node.runtime.kind === 'hermes'
      && node.runtime.profile.trim().toLowerCase() === 'builder').length !== 1) {
    throw new Error('builder_terminal_saved_card_required');
  }
  const targetRoot = String(deck.workspaceRoot || '').trim();
  if (!targetRoot) throw new Error('builder_terminal_workspace_required');
  const acquired = manager.acquire({
    projectId, deckId, conversationId: 'main', ownerCardId: card.id,
    profile: card.runtime.profile, targetRoot,
  });
  if (!acquired.ok) throw new Error(acquired.error);
  const session = acquired.session;
  if (session.info.profile !== card.runtime.profile
    || session.info.targetRoot !== path.resolve(targetRoot)) {
    throw new Error('builder_terminal_saved_binding_changed');
  }
  if (acquired.created) {
    try {
      launch(session);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'builder_terminal_launch_failed';
      session.markFailed(reason);
      throw new Error(reason);
    }
  }
  if (!session.isLive()) throw new Error(session.info.error || 'builder_terminal_unavailable');
  return session.info;
}
