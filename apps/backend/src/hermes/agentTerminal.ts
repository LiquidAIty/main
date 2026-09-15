import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn as spawnPty, type IPty } from 'node-pty';
import type { AgentCardInstance, DeckDocument } from '../types';
import { BUILDER_CARD_ID } from '../decks/store';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from '../services/workspaceRoot';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { agentTerminalExecution } from './agentTerminalExecution';
import type { HermesTeamResultDelivery } from './hostExecutionLifecycle';
import type { RecoveredHermesTeamResult } from './kanbanRunRecovery';
import {
  configureHermesNativeSubagentModel,
  materializeHermesProfileSelections,
  type HermesProfileSelection,
} from './mainAdapter';
import { resolveSavedHermesProvider, type NativeHermesProviderSelection } from './providerSelection';
import { readSavedSubagentModel } from './subagentModel';

const GATEWAY_READY_TIMEOUT_MS = 120_000;
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60_000;
const MAX_TERMINAL_REPLAY_BYTES = 2 * 1024 * 1024;

export type AgentTerminalOwner = { userId: string; projectId: string; deckId: string; cardId: string };
export type AgentTerminalState = {
  sessionId: string;
  cardId: string;
  profile: string;
  /** PID of the Gateway process that owns the Card's AIAgent. */
  pid: number;
  gatewayPid: number;
  /** PID of the attached native Ink TUI frontend, when this presentation uses one. */
  tuiPid: number | null;
  ptyId: string | null;
  nativeSessionId: string;
  storedSessionId: string;
  hermesHome: string;
  status: 'running' | 'exited' | 'failed';
  cols: number;
  rows: number;
  exitCode?: number;
  error?: string;
  replayTruncated?: boolean;
};

export type AgentTerminalGatewayEvent = {
  type: string;
  session_id?: string;
  payload?: Record<string, unknown>;
};

export type AgentTerminalTurnResult = {
  text: string;
  status: string;
  event: AgentTerminalGatewayEvent;
};

type Output = { sequence: number; data: string };
type Listener = (event: 'output' | 'state', value: Output | AgentTerminalState) => void;

export type AgentTerminalLaunch = {
  file: string;
  gatewayArgs: string[];
  tuiArgs: string[];
  cwd: string;
  env: Record<string, string>;
  profile: string;
  profileHome: string;
  profileSelection: HermesProfileSelection;
  providerSelection: NativeHermesProviderSelection;
};

type GatewayClient = {
  readonly connectionState: string;
  connect(url: string): Promise<void>;
  close(): void;
  request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal): Promise<T>;
  onEvent(handler: (event: AgentTerminalGatewayEvent) => void): () => void;
};

type GatewayClientFactory = () => Promise<GatewayClient>;
type GatewaySpawner = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; windowsHide: boolean },
) => ChildProcess;

type Session = {
  owner: AgentTerminalOwner;
  fingerprint: string;
  state: AgentTerminalState;
  bearer: string;
  gateway: ChildProcess;
  gatewayUrl: string;
  client: GatewayClient;
  detachGatewayEvents: () => void;
  launch: AgentTerminalLaunch;
  pty: IPty | null;
  output: Output[];
  outputBytes: number;
  sequence: number;
  listeners: Set<Listener>;
  stopping: boolean;
  turnTail: Promise<void>;
};

type PendingStart = {
  owner: AgentTerminalOwner;
  fingerprint: string;
  promise: Promise<AgentTerminalState>;
};

export type DesiredAgentTerminal = {
  owner: AgentTerminalOwner;
  card: AgentCardInstance;
  deck: DeckDocument;
  workingDirectory?: string;
  attachTui?: boolean;
};

export type AgentTerminalOpenOptions = {
  workingDirectory?: string;
  attachTui?: boolean;
};

export function agentTerminalPresentationOptions(
  card: AgentCardInstance,
  attachTui: boolean,
): AgentTerminalOpenOptions {
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  if (card.runtime.mode === 'main') {
    return { workingDirectory: resolveProductChatWorkingDirectory(), attachTui: false };
  }
  if (card.id === BUILDER_CARD_ID) {
    return { workingDirectory: resolveRepoRoot(), attachTui };
  }
  return { attachTui };
}

function ownerKey(owner: AgentTerminalOwner): string {
  return JSON.stringify([owner.userId, owner.projectId, owner.deckId, owner.cardId]);
}

function sameOwner(left: AgentTerminalOwner, right: AgentTerminalOwner): boolean {
  return ownerKey(left) === ownerKey(right);
}

function cleanEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(withoutInternalMcpSecret(env))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function list(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('agent_terminal_saved_selection_invalid');
  }
  return [...new Set(value.map((item) => item.trim()))];
}

/**
 * Ordinary Card fallback used when no established presentation supplies a
 * workspace. Main and Builder pass their existing presentation-owned cwd into
 * the common launcher instead of being identified here by Card or profile name.
 */
export function resolveAgentCardWorkingDirectory(
  owner: AgentTerminalOwner,
  card: AgentCardInstance,
  profile: string,
  requested?: string,
): string {
  const selected = String(requested || '').trim();
  if (!selected) {
    return resolveProductChatWorkingDirectory(JSON.stringify([
      owner.projectId, owner.deckId, card.id, profile,
    ]));
  }
  if (!path.isAbsolute(selected)) throw new Error('agent_terminal_saved_workspace_must_be_absolute');
  if (!existsSync(selected) || !statSync(selected).isDirectory()) {
    throw new Error(`agent_terminal_saved_workspace_missing:${selected}`);
  }
  return realpathSync(selected);
}

export function agentTerminalFingerprint(
  owner: AgentTerminalOwner,
  card: AgentCardInstance,
  deck: DeckDocument,
  workingDirectory?: string,
): string {
  const profile = requireAgentTerminalCard(card, deck);
  const cwd = resolveAgentCardWorkingDirectory(owner, card, profile, workingDirectory);
  return createHash('sha256').update(JSON.stringify({
    id: card.id,
    revisionId: card._cardRevisionId || null,
    revision: card._cardRevision || null,
    revisionSha256: card._cardRevisionSha256 || null,
    runtime: card.runtime,
    options: card.runtimeOptions,
    prompt: card.prompt,
    tools: card.tools,
    workingDirectory: cwd,
  })).digest('hex');
}

export function requireAgentTerminalCard(card: AgentCardInstance, deck: DeckDocument): string {
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  const profile = String(card.runtime.profile || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) throw new Error('agent_terminal_profile_missing');
  if (deck.nodes.some((other) => other.id !== card.id && other.runtime.kind === 'hermes'
    && other.runtime.profile.trim().toLowerCase() === profile.toLowerCase())) {
    throw new Error('agent_terminal_profile_shared');
  }
  const options = card.runtimeOptions as Record<string, unknown> | undefined;
  if ((card as AgentCardInstance & { enabled?: boolean }).enabled === false || options?.enabled === false) {
    throw new Error('agent_terminal_card_disabled');
  }
  return profile;
}

function savedProfileSelection(
  card: AgentCardInstance,
  providerSelection: NativeHermesProviderSelection,
): HermesProfileSelection {
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  const options = card.runtimeOptions as Record<string, unknown> | undefined;
  const subagentModel = readSavedSubagentModel(options?.subagentModel);
  return {
    runtime: card.runtime,
    provider: providerSelection.savedProvider,
    accessMode: providerSelection.accessMode,
    modelKey: String(options?.modelKey || providerSelection.model).trim(),
    providerModelId: providerSelection.model,
    openaiRuntime: providerSelection.openaiRuntime,
    skills: list(options?.skills),
    ...(subagentModel ? { subagentModel } : {}),
  };
}

/** Resolve the exact saved Card into its Gateway owner and attached native TUI launch. */
export function prepareAgentTerminal(
  owner: AgentTerminalOwner,
  card: AgentCardInstance,
  deck: DeckDocument,
  _sessionId: string,
  workingDirectory?: string,
): AgentTerminalLaunch {
  const profile = requireAgentTerminalCard(card, deck);
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  const root = resolveRepoRoot();
  const hermesRoot = path.join(root, 'Hermes');
  const file = path.join(hermesRoot, 'venv', 'Scripts', 'hermes.exe');
  if (!existsSync(file)) throw new Error('agent_terminal_native_executable_missing');
  const hermesHome = path.join(hermesRoot, '.hermes');
  const profileHome = path.join(hermesHome, 'profiles', profile);
  if (!existsSync(path.join(profileHome, 'config.yaml'))) throw new Error('agent_terminal_profile_missing');
  const options = card.runtimeOptions as Record<string, unknown> | undefined;
  const providerSelection = resolveSavedHermesProvider({
    provider: options?.provider,
    accessMode: options?.accessMode,
    modelKey: options?.modelKey,
    providerModelId: options?.providerModelId,
    openaiRuntime: options?.openaiRuntime,
  });
  const cwd = resolveAgentCardWorkingDirectory(owner, card, profile, workingDirectory);
  if (typeof card.prompt !== 'string' || !card.prompt.trim()) {
    throw new Error('agent_terminal_saved_prompt_missing');
  }
  const env = cleanEnvironment(process.env);
  Object.assign(env, {
    HERMES_HOME: hermesHome,
    TERMINAL_CWD: cwd,
    HERMES_REQUIRE_CLI_HOST: 'liquidaity-card-mcp',
    HERMES_TUI_TOOLSETS: 'agent-terminal',
    HERMES_TUI_DIR: path.join(hermesRoot, 'ui-tui'),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    TERM: 'xterm-256color',
    HERMES_EPHEMERAL_SYSTEM_PROMPT: card.prompt,
    HERMES_AGENT_TERMINAL_CONFIG: JSON.stringify({
      cardId: card.id,
      profile,
      profileHome,
      toolsets: [],
      nativeTools: [],
      mcpTools: [],
    }),
  });
  const gatewayArgs = [
    '-p', profile, 'serve', '--host', '127.0.0.1', '--port', '0', '--isolated', '--skip-build',
  ];
  const tuiArgs = [
    '-p', profile, '--tui', '--in', cwd,
    '--model', providerSelection.model,
    '--provider', providerSelection.provider,
    '--toolsets', 'agent-terminal',
  ];
  if (options?.reasoningEffort) tuiArgs.push('--reasoning', String(options.reasoningEffort));
  if (options?.maxTurns != null) tuiArgs.push('--max-turns', String(options.maxTurns));
  const skills = list(options?.skills);
  if (skills.length) tuiArgs.push('--skills', skills.join(','));
  return {
    file,
    gatewayArgs,
    tuiArgs,
    cwd,
    env,
    profile,
    profileHome,
    profileSelection: savedProfileSelection(card, providerSelection),
    providerSelection,
  };
}

async function createNativeGatewayClient(): Promise<GatewayClient> {
  const source = path.join(
    resolveRepoRoot(), 'Hermes', 'apps', 'shared', 'src', 'json-rpc-gateway.ts',
  );
  if (!existsSync(source)) throw new Error('agent_terminal_gateway_client_missing');
  // Node 22 executes this erasable TypeScript source directly. Keeping the
  // computed URL avoids copying the protocol client into LiquidAIty or making
  // the backend compiler own Hermes' package tree.
  const moduleUrl = pathToFileURL(source).href;
  const loaded = await import(moduleUrl) as {
    JsonRpcGatewayClient?: new (options?: Record<string, unknown>) => GatewayClient;
  };
  if (typeof loaded.JsonRpcGatewayClient !== 'function') {
    throw new Error('agent_terminal_gateway_client_invalid');
  }
  return new loaded.JsonRpcGatewayClient({
    requestIdPrefix: 'card',
    requestTimeoutMs: DEFAULT_TURN_TIMEOUT_MS,
  });
}

function gatewayReadyPort(gateway: ChildProcess, timeoutMs = GATEWAY_READY_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffered = '';
    const timer = setTimeout(() => finish(new Error('agent_terminal_gateway_start_timeout')), timeoutMs);
    timer.unref?.();
    const finish = (error?: Error, port?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      gateway.off('error', onError);
      gateway.off('exit', onExit);
      gateway.stdout?.off('data', onData);
      gateway.stderr?.off('data', onData);
      if (error) reject(error);
      else resolve(port!);
    };
    const onError = () => finish(new Error('agent_terminal_gateway_start_failed'));
    const onExit = (code: number | null) => finish(
      new Error(`agent_terminal_gateway_exited_before_ready:${code ?? 'null'}`),
    );
    const onData = (value: Buffer | string) => {
      buffered = `${buffered}${String(value)}`.slice(-16_384);
      const match = /HERMES_BACKEND_READY\s+port=(\d+)/.exec(buffered);
      if (!match) return;
      const port = Number(match[1]);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        finish(new Error('agent_terminal_gateway_ready_invalid'));
        return;
      }
      finish(undefined, port);
    };
    gateway.once('error', onError);
    gateway.once('exit', onExit);
    gateway.stdout?.on('data', onData);
    gateway.stderr?.on('data', onData);
  });
}

function sessionTitle(card: AgentCardInstance, fingerprint: string): string {
  return `Card runtime: ${card.id} @ ${fingerprint}`;
}

function requireNativeSession(
  value: unknown,
  error: string,
): { sessionId: string; storedSessionId: string } {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sessionId = String(record.session_id || '').trim();
  const storedSessionId = String(record.stored_session_id || '').trim();
  if (!sessionId || !storedSessionId) throw new Error(error);
  return { sessionId, storedSessionId };
}

export class AgentTerminalManager {
  private readonly sessions = new Map<string, Session>();
  private readonly pendingStarts = new Map<string, PendingStart>();

  constructor(
    private readonly spawnPtyProcess: typeof spawnPty = spawnPty,
    private readonly prepare: typeof prepareAgentTerminal = prepareAgentTerminal,
    private readonly onExit = (id: string) => agentTerminalExecution.abort(id),
    private readonly spawnGateway: GatewaySpawner = (file, args, options) => spawnChild(
      file,
      args,
      { ...options, stdio: ['ignore', 'pipe', 'pipe'] },
    ),
    private readonly createGatewayClient: GatewayClientFactory = createNativeGatewayClient,
    private readonly materializeProfile: typeof materializeHermesProfileSelections = materializeHermesProfileSelections,
  ) {}

  async open(
    owner: AgentTerminalOwner,
    card: AgentCardInstance,
    deck: DeckDocument,
    cols: number,
    rows: number,
    options: AgentTerminalOpenOptions = {},
  ): Promise<AgentTerminalState> {
    const profile = requireAgentTerminalCard(card, deck);
    const workingDirectory = resolveAgentCardWorkingDirectory(
      owner,
      card,
      profile,
      options.workingDirectory,
    );
    const fingerprint = agentTerminalFingerprint(owner, card, deck, workingDirectory);
    const attachTui = options.attachTui !== false;
    for (const session of this.sessions.values()) {
      if (session.state.status !== 'running') continue;
      if (session.state.profile.toLowerCase() !== profile.toLowerCase()) continue;
      if (!sameOwner(session.owner, owner)) throw new Error('agent_terminal_profile_in_use');
      if (session.fingerprint !== fingerprint) {
        throw new Error('agent_terminal_configuration_changed_stop_required');
      }
      return attachTui ? this.attachTui(session, cols, rows) : { ...session.state };
    }
    const pending = this.pendingStarts.get(profile.toLowerCase());
    if (pending) {
      if (!sameOwner(pending.owner, owner)) throw new Error('agent_terminal_profile_in_use');
      if (pending.fingerprint !== fingerprint) {
        throw new Error('agent_terminal_configuration_changed_stop_required');
      }
      const state = await pending.promise;
      return attachTui
        ? this.attachTui(this.running(owner, state.sessionId), cols, rows)
        : state;
    }
    for (const [id, session] of this.sessions) {
      if (sameOwner(session.owner, owner) && session.state.status !== 'running' && !session.listeners.size) {
        this.sessions.delete(id);
      }
    }
    const promise = this.start(owner, card, deck, cols, rows, fingerprint, workingDirectory);
    this.pendingStarts.set(profile.toLowerCase(), { owner: { ...owner }, fingerprint, promise });
    try {
      const state = await promise;
      return attachTui
        ? this.attachTui(this.running(owner, state.sessionId), cols, rows)
        : state;
    } finally {
      if (this.pendingStarts.get(profile.toLowerCase())?.promise === promise) {
        this.pendingStarts.delete(profile.toLowerCase());
      }
    }
  }

  private async start(
    owner: AgentTerminalOwner,
    card: AgentCardInstance,
    deck: DeckDocument,
    cols: number,
    rows: number,
    fingerprint: string,
    workingDirectory: string,
  ): Promise<AgentTerminalState> {
    const sessionId = randomUUID();
    const launch = this.prepare(owner, card, deck, sessionId, workingDirectory);
    const bearer = randomBytes(32).toString('hex');
    const gatewayToken = randomBytes(32).toString('hex');
    const gatewayEnv = {
      ...launch.env,
      HERMES_DASHBOARD_SESSION_TOKEN: gatewayToken,
      HERMES_AGENT_TERMINAL_URL: `http://127.0.0.1:${process.env.PORT || '4000'}/api/agent-terminals/internal/${sessionId}`,
      HERMES_AGENT_TERMINAL_TOKEN: bearer,
    };
    const gateway = this.spawnGateway(launch.file, launch.gatewayArgs, {
      cwd: launch.cwd,
      env: gatewayEnv,
      windowsHide: true,
    });
    let client: GatewayClient | undefined;
    try {
      if (!gateway.pid) throw new Error('agent_terminal_gateway_pid_missing');
      const port = await gatewayReadyPort(gateway);
      client = await this.createGatewayClient();
      const gatewayUrl = `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(gatewayToken)}`;
      await client.connect(gatewayUrl);
      const request = <T>(method: string, params: Record<string, unknown>) => (
        client!.request<T>(method, { ...params, profile: launch.profile })
      );
      await this.materializeProfile(
        launch.profileSelection,
        (profile) => request('profiles.describe', { name: profile }),
        configureHermesNativeSubagentModel,
        (profile, selection) => request('profiles.configure', {
          name: profile,
          provider: selection.provider,
          model: selection.model,
          openai_runtime: selection.openaiRuntime,
        }),
        (profile, disabledSkills) => request('profiles.configure', {
          name: profile,
          disabled_skills: disabledSkills,
        }),
      );

      const title = sessionTitle(card, fingerprint);
      const listed = await request<{ sessions?: unknown }>('session.list', {
        title,
        include_hidden: true,
      });
      if (!Array.isArray(listed?.sessions)) throw new Error('agent_terminal_session_enumeration_invalid');
      if (listed.sessions.length > 1) throw new Error('agent_terminal_session_ambiguous');
      let native: { sessionId: string; storedSessionId: string };
      if (listed.sessions.length === 1) {
        const row = listed.sessions[0] && typeof listed.sessions[0] === 'object'
          ? listed.sessions[0] as Record<string, unknown>
          : {};
        const stored = String(row.resolved_id || row.id || '').trim();
        if (!stored) throw new Error('agent_terminal_session_enumeration_invalid');
        const resumed = await request<Record<string, unknown>>('session.resume', { session_id: stored });
        native = requireNativeSession(
          resumed && typeof resumed === 'object'
            ? { ...resumed, stored_session_id: stored }
            : resumed,
          'agent_terminal_session_resume_invalid',
        );
      } else {
        const createParams: Record<string, unknown> = {
          title,
          cwd: launch.cwd,
          cols,
          model: launch.providerSelection.model,
          provider: launch.providerSelection.provider,
          follow_profile_config: true,
          close_on_disconnect: false,
        };
        const reasoning = (card.runtimeOptions as Record<string, unknown> | undefined)?.reasoningEffort;
        if (reasoning) createParams.reasoning_effort = String(reasoning);
        native = requireNativeSession(
          await request('session.create', createParams),
          'agent_terminal_session_create_invalid',
        );
      }

      const session: Session = {
        owner: { ...owner },
        fingerprint,
        bearer,
        gateway,
        gatewayUrl,
        client,
        detachGatewayEvents: () => {},
        launch,
        pty: null,
        state: {
          sessionId,
          cardId: card.id,
          profile: launch.profile,
          pid: gateway.pid,
          gatewayPid: gateway.pid,
          tuiPid: null,
          ptyId: null,
          nativeSessionId: native.sessionId,
          storedSessionId: native.storedSessionId,
          hermesHome: launch.profileHome,
          status: 'running',
          cols,
          rows,
        },
        output: [],
        outputBytes: 0,
        sequence: 0,
        listeners: new Set(),
        stopping: false,
        turnTail: Promise.resolve(),
      };
      session.detachGatewayEvents = client.onEvent((event) => {
        if (event.session_id !== session.state.nativeSessionId || event.type !== 'session.info') return;
        const stored = String(event.payload?.stored_session_id || '').trim();
        if (stored) session.state.storedSessionId = stored;
      });
      this.sessions.set(sessionId, session);
      gateway.once('exit', (exitCode) => this.onProcessExit(session, 'gateway', exitCode));
      gateway.once('error', () => this.onProcessExit(session, 'gateway', null));
      if (gateway.exitCode !== null) {
        this.onProcessExit(session, 'gateway', gateway.exitCode);
        throw new Error(`agent_terminal_gateway_exited_after_ready:${gateway.exitCode}`);
      }
      return { ...session.state };
    } catch (error) {
      this.sessions.delete(sessionId);
      try { client?.close(); } catch {}
      if (gateway.exitCode === null && !gateway.killed) gateway.kill();
      throw error;
    }
  }

  private attachTui(session: Session, cols: number, rows: number): AgentTerminalState {
    if (session.state.status !== 'running') throw new Error('agent_terminal_not_running');
    if (session.pty) {
      if (session.state.cols !== cols || session.state.rows !== rows) {
        session.pty.resize(cols, rows);
        Object.assign(session.state, { cols, rows });
      }
      return { ...session.state };
    }
    const tui = this.spawnPtyProcess(session.launch.file, session.launch.tuiArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: session.launch.cwd,
      env: {
        ...session.launch.env,
        HERMES_TUI_GATEWAY_URL: session.gatewayUrl,
        HERMES_TUI_RESUME: session.state.storedSessionId,
      },
      useConpty: true,
    });
    if (!tui.pid) {
      try { tui.kill(); } catch {}
      throw new Error('agent_terminal_tui_pid_missing');
    }
    session.pty = tui;
    Object.assign(session.state, {
      tuiPid: tui.pid,
      ptyId: session.state.sessionId,
      cols,
      rows,
      exitCode: undefined,
    });
    if (session.state.error?.startsWith('agent_terminal_tui_exited:')) {
      session.state.error = undefined;
    }
    tui.onData((data) => this.onPtyData(session, data));
    tui.onExit(({ exitCode }) => this.onProcessExit(session, 'tui', exitCode, tui));
    for (const listener of session.listeners) listener('state', { ...session.state });
    return { ...session.state };
  }

  private onPtyData(session: Session, data: string): void {
    const output = { sequence: ++session.sequence, data };
    session.output.push(output);
    session.outputBytes += Buffer.byteLength(data);
    while (session.outputBytes > MAX_TERMINAL_REPLAY_BYTES && session.output.length) {
      session.outputBytes -= Buffer.byteLength(session.output.shift()!.data);
      session.state.replayTruncated = true;
    }
    for (const listener of session.listeners) listener('output', output);
  }

  private onProcessExit(
    session: Session,
    source: 'gateway' | 'tui',
    exitCode: number | null,
    tui?: IPty,
  ): void {
    if (session.state.status !== 'running') return;
    if (source === 'tui') {
      if (tui && session.pty !== tui) return;
      session.pty = null;
      session.state.tuiPid = null;
      session.state.ptyId = null;
      session.state.exitCode = exitCode ?? undefined;
      if (!session.stopping && exitCode !== 0 && exitCode !== null) {
        session.state.error = `agent_terminal_tui_exited:${exitCode}`;
      }
      for (const listener of session.listeners) listener('state', { ...session.state });
      return;
    }
    session.state.status = session.stopping && (exitCode === 0 || exitCode === null)
      ? 'exited'
      : 'failed';
    session.state.exitCode = exitCode ?? undefined;
    if (!session.stopping) session.state.error = `agent_terminal_${source}_exited:${exitCode ?? 'null'}`;
    session.detachGatewayEvents();
    session.client.close();
    try { session.pty?.kill(); } catch {}
    session.pty = null;
    session.state.tuiPid = null;
    session.state.ptyId = null;
    void this.onExit(session.state.sessionId).catch((error) => {
      session.state.error = String(error);
      for (const listener of session.listeners) listener('state', { ...session.state });
    });
    for (const listener of session.listeners) listener('state', { ...session.state });
  }

  authorizeNative(id: string, authorization: string): AgentTerminalOwner {
    const session = this.sessions.get(id);
    const supplied = Buffer.from(authorization.replace(/^Bearer /, ''));
    const expected = Buffer.from(session?.bearer || '');
    if (!session || session.state.status !== 'running' || !expected.length
      || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error('agent_terminal_native_unauthorized');
    }
    return { ...session.owner };
  }

  private owned(owner: AgentTerminalOwner, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || !sameOwner(session.owner, owner)) throw new Error('agent_terminal_session_not_found');
    return session;
  }

  private running(owner: AgentTerminalOwner, id: string): Session {
    const session = this.owned(owner, id);
    if (session.state.status !== 'running') throw new Error('agent_terminal_not_running');
    return session;
  }

  state(owner: AgentTerminalOwner, id: string): AgentTerminalState {
    return { ...this.owned(owner, id).state };
  }

  find(owner: AgentTerminalOwner): AgentTerminalState | null {
    const session = [...this.sessions.values()].find((candidate) => (
      sameOwner(candidate.owner, owner) && candidate.state.status === 'running'
    ));
    return session ? { ...session.state } : null;
  }

  findCard(projectId: string, deckId: string, cardId: string): {
    owner: AgentTerminalOwner;
    state: AgentTerminalState;
  } | null {
    const matches = [...this.sessions.values()].filter((candidate) => (
      candidate.owner.projectId === projectId
      && candidate.owner.deckId === deckId
      && candidate.owner.cardId === cardId
      && candidate.state.status === 'running'
    ));
    if (matches.length > 1) throw new Error('agent_terminal_card_runtime_ambiguous');
    const session = matches[0];
    return session ? { owner: { ...session.owner }, state: { ...session.state } } : null;
  }

  listRunning(): Array<{ owner: AgentTerminalOwner; state: AgentTerminalState }> {
    return [...this.sessions.values()]
      .filter((session) => session.state.status === 'running')
      .map((session) => ({ owner: { ...session.owner }, state: { ...session.state } }));
  }

  async history(owner: AgentTerminalOwner, id: string): Promise<{
    count: number;
    messages: Array<Record<string, unknown>>;
  }> {
    const session = this.running(owner, id);
    const history = await session.client.request<{
      count?: unknown;
      messages?: unknown;
    }>('session.history', {
      session_id: session.state.nativeSessionId,
      profile: session.state.profile,
    });
    if (!Number.isSafeInteger(history?.count) || !Array.isArray(history?.messages)) {
      throw new Error('agent_terminal_history_invalid');
    }
    return { count: Number(history.count), messages: history.messages as Array<Record<string, unknown>> };
  }

  verifyConfiguration(
    owner: AgentTerminalOwner,
    id: string,
    card: AgentCardInstance,
    deck: DeckDocument,
    workingDirectory?: string,
  ): void {
    const session = this.owned(owner, id);
    if (session.fingerprint !== agentTerminalFingerprint(
      owner,
      card,
      deck,
      workingDirectory || session.launch.cwd,
    )) {
      throw new Error('agent_terminal_configuration_changed_stop_required');
    }
  }

  input(owner: AgentTerminalOwner, id: string, data: string): void {
    const session = this.running(owner, id);
    if (!session.pty) throw new Error('agent_terminal_tui_not_attached');
    session.pty.write(data);
  }

  resize(owner: AgentTerminalOwner, id: string, cols: number, rows: number): AgentTerminalState {
    const session = this.running(owner, id);
    if (!session.pty) throw new Error('agent_terminal_tui_not_attached');
    session.pty.resize(cols, rows);
    Object.assign(session.state, { cols, rows });
    return { ...session.state };
  }

  detachTui(owner: AgentTerminalOwner, id: string): AgentTerminalState {
    const session = this.running(owner, id);
    const tui = session.pty;
    if (!tui) return { ...session.state };
    session.pty = null;
    session.state.tuiPid = null;
    session.state.ptyId = null;
    session.state.exitCode = undefined;
    try {
      tui.kill();
    } catch (error) {
      session.pty = tui;
      session.state.tuiPid = tui.pid;
      session.state.ptyId = session.state.sessionId;
      throw error;
    }
    for (const listener of session.listeners) listener('state', { ...session.state });
    return { ...session.state };
  }

  stop(owner: AgentTerminalOwner, id: string): void {
    this.stopSession(this.owned(owner, id));
  }

  async interrupt(owner: AgentTerminalOwner, id: string): Promise<void> {
    const session = this.running(owner, id);
    await session.client.request('session.interrupt', {
      session_id: session.state.nativeSessionId,
      profile: session.state.profile,
    });
  }

  async appendNativeTeamResult(
    owner: AgentTerminalOwner,
    id: string,
    delivery: HermesTeamResultDelivery,
  ): Promise<void> {
    const session = this.running(owner, id);
    const result = await session.client.request<{ appended?: unknown }>(
      'session.append_native_team_result',
      {
        session_id: session.state.nativeSessionId,
        stored_session_id: delivery.sessionId,
        profile: session.state.profile,
        task_id: delivery.taskId,
        result: delivery.result,
        terminal_state: delivery.state,
      },
    );
    if (typeof result?.appended !== 'boolean') {
      throw new Error('agent_terminal_team_result_response_invalid');
    }
  }

  async appendRecoveredNativeTeamResult(delivery: RecoveredHermesTeamResult): Promise<void> {
    const runtime = this.findCard(delivery.projectId, delivery.deckId, delivery.cardId);
    if (!runtime) throw new Error('agent_terminal_card_runtime_not_running');
    if (runtime.state.profile !== delivery.profile) {
      throw new Error('agent_terminal_team_result_profile_mismatch');
    }
    await this.appendNativeTeamResult(runtime.owner, runtime.state.sessionId, delivery);
  }

  private stopSession(session: Session): void {
    if (session.state.status !== 'running') return;
    session.stopping = true;
    session.state.status = 'exited';
    session.detachGatewayEvents();
    session.client.close();
    try { session.pty?.kill(); } catch {}
    session.pty = null;
    session.state.tuiPid = null;
    session.state.ptyId = null;
    if (session.gateway.exitCode === null && !session.gateway.killed) session.gateway.kill();
    void this.onExit(session.state.sessionId).catch((error) => {
      session.state.error = String(error);
      for (const listener of session.listeners) listener('state', { ...session.state });
    });
    for (const listener of session.listeners) listener('state', { ...session.state });
  }

  async submit(
    owner: AgentTerminalOwner,
    id: string,
    text: string,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onEvent?: (event: AgentTerminalGatewayEvent) => void;
    } = {},
  ): Promise<AgentTerminalTurnResult> {
    if (!text.trim()) throw new Error('agent_terminal_turn_input_required');
    const session = this.running(owner, id);
    const execute = () => this.submitNow(session, text, options);
    const result = session.turnTail.then(execute, execute);
    session.turnTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async submitNow(
    session: Session,
    text: string,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onEvent?: (event: AgentTerminalGatewayEvent) => void;
    },
  ): Promise<AgentTerminalTurnResult> {
    if (session.state.status !== 'running') throw new Error('agent_terminal_not_running');
    if (options.signal?.aborted) throw new Error('agent_terminal_turn_cancelled');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detach: (() => void) | undefined;
    let abortListener: (() => void) | undefined;
    let finish!: (error?: Error, result?: AgentTerminalTurnResult) => void;
    const completion = new Promise<AgentTerminalTurnResult>((resolve, reject) => {
      finish = (error?: Error, result?: AgentTerminalTurnResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        detach?.();
        if (abortListener && options.signal) options.signal.removeEventListener('abort', abortListener);
        if (error) reject(error);
        else resolve(result!);
      };
      detach = session.client.onEvent((event) => {
        if (event.session_id !== session.state.nativeSessionId) return;
        options.onEvent?.(event);
        if (event.type === 'message.complete') {
          const status = String(event.payload?.status || 'completed');
          const textValue = String(event.payload?.text || '');
          if (status === 'error' || status === 'failed') {
            finish(new Error(String(event.payload?.error || textValue || 'agent_terminal_turn_failed')));
          } else {
            finish(undefined, { text: textValue, status, event });
          }
        } else if (event.type === 'error') {
          finish(new Error(String(event.payload?.message || 'agent_terminal_turn_failed')));
        }
      });
      const interrupt = (reason: string) => {
        void session.client.request('session.interrupt', {
          session_id: session.state.nativeSessionId,
          profile: session.state.profile,
        }).catch(() => undefined);
        finish(new Error(reason));
      };
      if (options.signal) {
        abortListener = () => interrupt('agent_terminal_turn_cancelled');
        options.signal.addEventListener('abort', abortListener, { once: true });
      }
      if (!settled) {
        timer = setTimeout(() => interrupt('agent_terminal_turn_timeout'), timeoutMs);
        timer.unref?.();
      }
    });
    try {
      await session.client.request(
        'prompt.submit',
        { session_id: session.state.nativeSessionId, text, profile: session.state.profile },
        timeoutMs,
        options.signal,
      );
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
    return completion;
  }

  subscribe(owner: AgentTerminalOwner, id: string, after: number, listener: Listener): () => void {
    const session = this.owned(owner, id);
    for (const output of session.output) if (output.sequence > after) listener('output', output);
    listener('state', { ...session.state });
    if (session.listeners.size >= 8) throw new Error('agent_terminal_connection_limit');
    session.listeners.add(listener);
    return () => { session.listeners.delete(listener); };
  }

  async reconcile(
    desired: DesiredAgentTerminal[],
    dimensions: { cols: number; rows: number } = { cols: 120, rows: 36 },
  ): Promise<AgentTerminalState[]> {
    const wantedOwners = new Map<string, DesiredAgentTerminal>();
    const wantedProfiles = new Map<string, string>();
    for (const target of desired) {
      const profile = requireAgentTerminalCard(target.card, target.deck).toLowerCase();
      const key = ownerKey(target.owner);
      if (wantedOwners.has(key)) throw new Error('agent_terminal_topology_owner_duplicate');
      wantedOwners.set(key, target);
      const other = wantedProfiles.get(profile);
      if (other && other !== key) throw new Error(`agent_terminal_topology_profile_shared:${profile}`);
      wantedProfiles.set(profile, key);
    }
    for (const session of this.sessions.values()) {
      if (session.state.status !== 'running') continue;
      const target = wantedOwners.get(ownerKey(session.owner));
      const targetProfile = target ? requireAgentTerminalCard(target.card, target.deck) : null;
      const targetWorkingDirectory = target && targetProfile
        ? resolveAgentCardWorkingDirectory(
          target.owner,
          target.card,
          targetProfile,
          target.workingDirectory,
        )
        : undefined;
      if (!target || session.fingerprint !== agentTerminalFingerprint(
        target.owner,
        target.card,
        target.deck,
        targetWorkingDirectory,
      )) {
        this.stopSession(session);
      }
    }
    return Promise.all(desired.map((target) => this.open(
      target.owner,
      target.card,
      target.deck,
      dimensions.cols,
      dimensions.rows,
      {
        workingDirectory: target.workingDirectory,
        attachTui: target.attachTui,
      },
    )));
  }

  stopAll(): void {
    for (const session of this.sessions.values()) this.stopSession(session);
  }
}

export const agentTerminalManager = new AgentTerminalManager();
