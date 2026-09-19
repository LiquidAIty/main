import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn as spawnPty, type IPty } from 'node-pty';
import { tsImport } from 'tsx/esm/api';
import type { AgentCardInstance, DeckDocument } from '../types';
import { BUILDER_CARD_ID } from '../decks/store';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from '../services/workspaceRoot';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { agentTerminalExecution } from './agentTerminalExecution';
import {
  configureHermesNativeSubagentModel,
  materializeHermesProfileSelections,
  type HermesProfileSelection,
} from './profileMaterialization';
import { resolveSavedHermesProvider, type NativeHermesProviderSelection } from './providerSelection';
import { readSavedSubagentModel } from './subagentModel';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import {
  HERMES_CARD_TOOLS_TOOLSET,
  materializeHermesExternalMcpTools,
  materializeHermesCardToolsPlugin,
  requireHermesCardToolsReadback,
  requireLoadedHermesCardToolsPlugin,
  resolveHermesCardTools,
  type HermesCardTools,
} from './cardToolsPlugin';

const GATEWAY_READY_TIMEOUT_MS = 120_000;
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60_000;
const MAX_TERMINAL_REPLAY_BYTES = 2 * 1024 * 1024;
const BOT_CHAT_TITLE = 'Bot Chat';
const AUTH_MAX_FUTURE_SECONDS = 10 * 60;
const PRIOR_SESSION_LIMIT = 8;
const CARD_TOOL_NONCE_LIMIT = 512;

export type AgentTerminalOwner = { userId: string; projectId: string; deckId: string; cardId: string };
export type HermesBotRosterProjection = {
  cardId: string;
  cardRevisionId: string;
  profile: string;
  title: string;
  botEnabled: boolean;
  roster: string[];
};
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
  unavailableToolReasons: Record<string, string>;
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
  seq?: number;
  payload?: Record<string, unknown>;
};

export type AuthenticatedCardToolRequest = {
  owner: AgentTerminalOwner;
  state: AgentTerminalState;
  canonicalToolName: string;
  cardTools: {
    cardRevisionId: string;
    configurationFingerprint: string;
    runtimeMode: 'main' | 'delegate' | 'kanban';
  };
  request: {
    version: 1;
    expiresAt: number;
    nonce: string;
    sourceStoredSessionId: string;
    tool: string;
    arguments: Record<string, unknown>;
  };
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
type ProfileRequest = <T>(method: string, params: Record<string, unknown>) => Promise<T>;
type GatewaySpawner = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; windowsHide: boolean },
) => ChildProcess;

type Session = {
  owner: AgentTerminalOwner;
  fingerprint: string;
  state: AgentTerminalState;
  gateway: ChildProcess;
  gatewayUrl: string;
  client: GatewayClient;
  detachGatewayEvents: () => void;
  gatewayToken: string;
  gatewayKeyId: string;
  priorStoredSessionIds: Map<string, number>;
  cardToolNonces: Map<string, number>;
  cardTools: HermesCardTools;
  launch: AgentTerminalLaunch;
  pty: IPty | null;
  output: Output[];
  outputBytes: number;
  sequence: number;
  listeners: Set<Listener>;
  gatewayEventListeners: Set<(event: AgentTerminalGatewayEvent) => void>;
  stopping: boolean;
  turnTail: Promise<void>;
};

type PendingStart = {
  owner: AgentTerminalOwner;
  fingerprint: string;
  cardToolsFingerprint: string;
  promise: Promise<AgentTerminalState>;
};

export type DesiredAgentTerminal = {
  owner: AgentTerminalOwner;
  card: AgentCardInstance;
  deck: DeckDocument;
  workingDirectory?: string;
  attachTui?: boolean;
};

export type DesiredHermesBotProfile = {
  owner: AgentTerminalOwner;
  card: AgentCardInstance;
  projection: HermesBotRosterProjection;
};

export type AgentTerminalOpenOptions = {
  workingDirectory?: string;
  attachTui?: boolean;
  botRosterProjection?: HermesBotRosterProjection;
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
    nativeTools: list(options?.nativeTools),
    toolsets: list(options?.toolsets),
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
  const file = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
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
    HERMES_TUI_DIR: path.join(hermesRoot, 'ui-tui'),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    TERM: 'xterm-256color',
    HERMES_EPHEMERAL_SYSTEM_PROMPT: card.prompt,
  });
  const gatewayArgs = [
    '-m', 'hermes_cli.main',
    '-p', profile, 'serve', '--host', '127.0.0.1', '--port', '0', '--isolated', '--skip-build',
  ];
  const tuiArgs = [
    '-m', 'hermes_cli.main',
    '-p', profile, '--tui', '--in', cwd,
    '--model', providerSelection.model,
    '--provider', providerSelection.provider,
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

export async function createNativeGatewayClient(): Promise<GatewayClient> {
  const source = path.join(
    resolveRepoRoot(), 'Hermes', 'apps', 'shared', 'src', 'json-rpc-gateway.ts',
  );
  if (!existsSync(source)) throw new Error('agent_terminal_gateway_client_missing');
  // Hermes' shared source keeps Node-ESM .js specifiers for emitted/bundled output.
  // Load that source through the workspace's supported TypeScript loader instead
  // of making bare Node resolve those specifiers against an unbuilt source tree.
  const moduleUrl = pathToFileURL(source).href;
  const loaded = await tsImport(moduleUrl, pathToFileURL(__filename).href) as {
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactProfileNames(value: unknown, error: string): string[] {
  if (!Array.isArray(value)) throw new Error(error);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry)) {
      throw new Error(error);
    }
    if (seen.has(entry)) throw new Error(error);
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

export async function resolveHermesBotRosterProjections(
  projectId: string,
  deckId: string,
): Promise<HermesBotRosterProjection[]> {
  const response = record(await requestPythonRailsJson(
    `/domain/hermes-bot-rosters/${encodeURIComponent(projectId)}/${encodeURIComponent(deckId)}`,
    { method: 'GET' },
  ));
  if (response.ok !== true || response.projectId !== projectId || response.deckId !== deckId) {
    throw new Error('hermes_bot_roster_projection_identity_invalid');
  }
  if (!Array.isArray(response.profiles)) throw new Error('hermes_bot_roster_projection_invalid');
  const seenCards = new Set<string>();
  const seenProfiles = new Set<string>();
  return response.profiles.map((value) => {
    const entry = record(value);
    const cardId = String(entry.cardId || '');
    const profile = String(entry.profile || '');
    if (!cardId || seenCards.has(cardId)) {
      throw new Error('hermes_bot_roster_projection_card_invalid');
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile) || seenProfiles.has(profile)) {
      throw new Error('hermes_bot_roster_projection_profile_invalid');
    }
    if (typeof entry.botEnabled !== 'boolean') {
      throw new Error('hermes_bot_roster_projection_enabled_invalid');
    }
    seenCards.add(cardId);
    seenProfiles.add(profile);
    return {
      cardId,
      cardRevisionId: String(entry.cardRevisionId || ''),
      profile,
      title: String(entry.title || cardId),
      botEnabled: entry.botEnabled,
      roster: exactProfileNames(entry.roster, 'hermes_bot_roster_projection_roster_invalid'),
    };
  });
}

export async function resolveHermesBotRosterProjection(
  owner: AgentTerminalOwner,
): Promise<HermesBotRosterProjection> {
  const matches = (await resolveHermesBotRosterProjections(owner.projectId, owner.deckId))
    .filter((entry) => entry.cardId === owner.cardId);
  if (matches.length !== 1) {
    throw new Error('hermes_bot_roster_projection_card_invalid');
  }
  return matches[0];
}

function sessionRows(value: unknown): Array<Record<string, unknown>> {
  const rows = record(value).sessions;
  if (!Array.isArray(rows)) throw new Error('agent_terminal_session_enumeration_invalid');
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('agent_terminal_session_enumeration_invalid');
    }
    return row as Record<string, unknown>;
  });
}

function storedSessionId(row: Record<string, unknown>): string {
  return String(row.resolved_id || row.id || '').trim();
}

function cardToolsHostUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = Number(env.PORT || 4000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('hermes_card_tools_backend_port_invalid');
  }
  return `http://127.0.0.1:${port}/api/hermes-card-tools`;
}

function equalHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function boundedString(value: unknown, max: number): string {
  return typeof value === 'string' && value.length <= max ? value : '';
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
    private readonly resolveCardTools: typeof resolveHermesCardTools = resolveHermesCardTools,
    private readonly materializeCardToolsPlugin: typeof materializeHermesCardToolsPlugin = materializeHermesCardToolsPlugin,
    private readonly materializeExternalMcpTools: typeof materializeHermesExternalMcpTools = materializeHermesExternalMcpTools,
    private readonly resolveBotRoster: typeof resolveHermesBotRosterProjection = resolveHermesBotRosterProjection,
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
    const cardTools = await this.resolveCardTools(owner, card);
    const fingerprint = agentTerminalFingerprint(owner, card, deck, workingDirectory);
    const attachTui = options.attachTui !== false;
    for (const session of this.sessions.values()) {
      if (session.state.status !== 'running') continue;
      if (session.state.profile.toLowerCase() !== profile.toLowerCase()) continue;
      if (!sameOwner(session.owner, owner)) throw new Error('agent_terminal_profile_in_use');
      if (session.fingerprint !== fingerprint) {
        throw new Error('agent_terminal_configuration_changed_stop_required');
      }
      if (session.cardTools.configurationFingerprint !== cardTools.configurationFingerprint) {
        throw new Error('agent_terminal_tool_configuration_changed_stop_required');
      }
      const botRosterProjection = options.botRosterProjection ?? await this.resolveBotRoster(owner);
      await this.configureNativeBotProfile(
        (method, params) => session.client.request(method, {
          ...params,
          profile: session.launch.profile,
        }),
        owner,
        card,
        botRosterProjection,
      );
      return attachTui ? this.attachTui(session, cols, rows) : { ...session.state };
    }
    const pending = this.pendingStarts.get(profile.toLowerCase());
    if (pending) {
      if (!sameOwner(pending.owner, owner)) throw new Error('agent_terminal_profile_in_use');
      if (pending.fingerprint !== fingerprint) {
        throw new Error('agent_terminal_configuration_changed_stop_required');
      }
      if (pending.cardToolsFingerprint !== cardTools.configurationFingerprint) {
        throw new Error('agent_terminal_tool_configuration_changed_stop_required');
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
    const promise = this.start(
      owner, card, deck, cols, rows, fingerprint, workingDirectory, cardTools,
      options.botRosterProjection,
    );
    this.pendingStarts.set(profile.toLowerCase(), {
      owner: { ...owner }, fingerprint,
      cardToolsFingerprint: cardTools.configurationFingerprint,
      promise,
    });
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

  private async configureNativeBotProfile(
    request: ProfileRequest,
    owner: AgentTerminalOwner,
    card: AgentCardInstance,
    projection: HermesBotRosterProjection,
  ): Promise<void> {
    if (card.runtime.kind !== 'hermes') throw new Error('hermes_bot_roster_projection_card_invalid');
    const cardProfile = String(card.runtime.profile || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardProfile)) {
      throw new Error('hermes_bot_roster_projection_profile_invalid');
    }
    if (projection.cardId !== owner.cardId || projection.cardId !== card.id
      || projection.profile !== cardProfile) {
      throw new Error('hermes_bot_roster_projection_identity_mismatch');
    }
    if (card._cardRevisionId && projection.cardRevisionId
      && projection.cardRevisionId !== card._cardRevisionId) {
      throw new Error('hermes_bot_roster_projection_revision_mismatch');
    }
    const findProfile = async (): Promise<Record<string, unknown>> => {
      const listed = record(await request<unknown>('profiles.list', { include_sessions: false }));
      if (!Array.isArray(listed.profiles)) throw new Error('hermes_bot_profile_list_invalid');
      const matches = listed.profiles.filter((value) => (
        record(value).name === projection.profile
      ));
      if (matches.length !== 1) throw new Error('hermes_bot_profile_identity_invalid');
      return record(matches[0]);
    };
    const current = await findProfile();
    const uiMeta = record(current.ui_meta);
    const hasExistingBotMeta = Object.prototype.hasOwnProperty.call(uiMeta, 'hermes-bots');
    const existing = record(uiMeta['hermes-bots']);
    const desired = projection.botEnabled ? {
      ...existing,
      title: String(card.title || card.id).trim() || card.id,
    } : null;
    const described = record(await request<unknown>('profiles.describe', { name: projection.profile }));
    const currentRoster = described.bot_mode_roster == null
      ? null
      : exactProfileNames(
        described.bot_mode_roster,
        'hermes_bot_profile_roster_readback_invalid',
      );
    const metaChanged = projection.botEnabled
      ? JSON.stringify(existing) !== JSON.stringify(desired)
      : hasExistingBotMeta;
    const rosterChanged = currentRoster === null
      || JSON.stringify(currentRoster) !== JSON.stringify(projection.roster);
    if (metaChanged || rosterChanged) {
      const revisions = record(current.ui_meta_revisions);
      const revision = revisions['hermes-bots'];
      if (revision != null && (!Number.isSafeInteger(revision) || Number(revision) < 0)) {
        throw new Error('hermes_bot_profile_revision_invalid');
      }
      const configured = record(await request<unknown>('profiles.configure', {
        name: projection.profile,
        ...(metaChanged ? {
          ui_meta: { 'hermes-bots': desired },
          ui_meta_expected_revisions: { 'hermes-bots': Number(revision || 0) },
        } : {}),
        ...(rosterChanged ? { bot_mode_roster: projection.roster } : {}),
      }));
      const applied = record(configured.applied);
      if (configured.ok !== true
        || (metaChanged && applied.ui_meta !== true)
        || (rosterChanged && applied.bot_mode_roster !== true)) {
        throw new Error('hermes_bot_profile_configuration_failed');
      }
    }
    const readbackRow = await findProfile();
    const readbackMeta = record(record(readbackRow.ui_meta)['hermes-bots']);
    if (projection.botEnabled) {
      if (readbackMeta.title !== desired?.title) throw new Error('hermes_bot_profile_readback_failed');
    } else if (Object.prototype.hasOwnProperty.call(record(readbackRow.ui_meta), 'hermes-bots')) {
      throw new Error('hermes_bot_profile_readback_failed');
    }
    const rosterReadback = record(await request<unknown>(
      'profiles.describe', { name: projection.profile },
    ));
    if (JSON.stringify(exactProfileNames(
      rosterReadback.bot_mode_roster,
      'hermes_bot_profile_roster_readback_invalid',
    )) !== JSON.stringify(projection.roster)) {
      throw new Error('hermes_bot_profile_roster_readback_failed');
    }
  }

  private async resolveCanonicalBotChat(
    request: ProfileRequest,
    card: AgentCardInstance,
    launch: AgentTerminalLaunch,
    cols: number,
  ): Promise<{ sessionId: string; storedSessionId: string }> {
    const exact = sessionRows(await request('session.list', {
      title: BOT_CHAT_TITLE,
      include_hidden: true,
      limit: 200,
    }));
    if (exact.length > 1) throw new Error('agent_terminal_bot_chat_ambiguous');
    let native: { sessionId: string; storedSessionId: string };
    if (exact.length === 1) {
      const stored = storedSessionId(exact[0]);
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
        title: BOT_CHAT_TITLE,
        cwd: launch.cwd,
        cols,
        model: launch.providerSelection.model,
        provider: launch.providerSelection.provider,
        follow_profile_config: true,
        close_on_disconnect: false,
        hidden: true,
      };
      const reasoning = (card.runtimeOptions as Record<string, unknown> | undefined)?.reasoningEffort;
      if (reasoning) createParams.reasoning_effort = String(reasoning);
      native = requireNativeSession(
        await request('session.create', createParams),
        'agent_terminal_session_create_invalid',
      );
      const titled = record(await request('session.title', {
        session_id: native.sessionId,
        title: BOT_CHAT_TITLE,
      }));
      if (titled.title !== BOT_CHAT_TITLE) throw new Error('agent_terminal_bot_chat_title_failed');
    }

    const readback = sessionRows(await request('session.list', {
      title: BOT_CHAT_TITLE,
      include_hidden: true,
      limit: 200,
    }));
    if (readback.length !== 1) throw new Error('agent_terminal_bot_chat_readback_invalid');
    if (storedSessionId(readback[0]) !== native.storedSessionId) {
      throw new Error('agent_terminal_bot_chat_identity_mismatch');
    }
    return native;
  }

  private async start(
    owner: AgentTerminalOwner,
    card: AgentCardInstance,
    deck: DeckDocument,
    cols: number,
    rows: number,
    fingerprint: string,
    workingDirectory: string,
    cardTools: HermesCardTools,
    botRosterProjection?: HermesBotRosterProjection,
  ): Promise<AgentTerminalState> {
    const sessionId = randomUUID();
    const launch = this.prepare(owner, card, deck, sessionId, workingDirectory);
    await this.materializeCardToolsPlugin(launch.profileHome, cardTools, { env: launch.env });
    const gatewayToken = randomBytes(32).toString('hex');
    const gatewayKeyId = createHash('sha256').update(gatewayToken, 'utf8').digest('hex');
    const gatewayEnv = {
      ...launch.env,
      HERMES_DASHBOARD_SESSION_TOKEN: gatewayToken,
      CARD_TOOLS_MANAGED: '1',
      CARD_TOOLS_HOST_URL: cardToolsHostUrl(),
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
      const externalMcpConnectionIds = [...new Set(
        cardTools.externalMcpTools.map((tool) => tool.connectionId),
      )];
      const profileMaterialization = await this.materializeProfile(
        {
          ...launch.profileSelection,
          nativeTools: cardTools.nativeTools,
          toolsets: cardTools.toolsets,
          requiredToolsets: cardTools.pluginTools.length ? [HERMES_CARD_TOOLS_TOOLSET] : [],
          mcpConnectionIds: externalMcpConnectionIds,
        },
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
        (profile, enabledToolsets) => request('profiles.configure', {
          name: profile,
          enabled_toolsets: enabledToolsets,
        }),
        (profile, enabledMcpServers) => request('profiles.configure', {
          name: profile,
          enabled_mcp_servers: enabledMcpServers,
        }),
      );
      const unavailableExternalMcpToolReasons = await this.materializeExternalMcpTools(
        request,
        cardTools,
        profileMaterialization.unavailableMcpServerReasons,
      );
      await this.configureNativeBotProfile(
        request,
        owner,
        card,
        botRosterProjection ?? await this.resolveBotRoster(owner),
      );
      const native = await this.resolveCanonicalBotChat(request, card, launch, cols);
      // These stock Gateway methods are session/install scoped and their public
      // contracts deliberately do not accept a profile selector.  The live
      // session already identifies the profile for tools.show.
      const plugins = await client!.request('plugins.list', {});
      requireLoadedHermesCardToolsPlugin(plugins);
      const unavailableToolReasons = requireHermesCardToolsReadback(
        await client!.request('tools.show', { session_id: native.sessionId }),
        cardTools,
        profileMaterialization.unavailableNativeToolReasons,
        unavailableExternalMcpToolReasons,
      );

      const session: Session = {
        owner: { ...owner },
        fingerprint,
        gateway,
        gatewayUrl,
        client,
        detachGatewayEvents: () => {},
        gatewayToken,
        gatewayKeyId,
        priorStoredSessionIds: new Map(),
        cardToolNonces: new Map(),
        cardTools,
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
          unavailableToolReasons,
          status: 'running',
          cols,
          rows,
        },
        output: [],
        outputBytes: 0,
        sequence: 0,
        listeners: new Set(),
        gatewayEventListeners: new Set(),
        stopping: false,
        turnTail: Promise.resolve(),
      };
      session.detachGatewayEvents = client.onEvent((event) => {
        if (event.session_id !== session.state.nativeSessionId) return;
        if (event.type === 'session.info') {
          const stored = String(event.payload?.stored_session_id || '').trim();
          if (stored) this.recordStoredSessionId(session, stored);
        }
        for (const listener of session.gatewayEventListeners) {
          try { listener(event); } catch {}
        }
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
    session.gatewayEventListeners.clear();
    session.priorStoredSessionIds.clear();
    session.cardToolNonces.clear();
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

  private recordStoredSessionId(
    session: Session,
    storedSessionId: string,
    now = Math.floor(Date.now() / 1000),
  ): void {
    const stored = storedSessionId.trim();
    if (!stored || stored === session.state.storedSessionId) return;
    for (const [prior, expiry] of session.priorStoredSessionIds) {
      if (expiry < now) session.priorStoredSessionIds.delete(prior);
    }
    session.priorStoredSessionIds.delete(stored);
    session.priorStoredSessionIds.set(
      session.state.storedSessionId,
      now + AUTH_MAX_FUTURE_SECONDS,
    );
    while (session.priorStoredSessionIds.size > PRIOR_SESSION_LIMIT) {
      const oldest = session.priorStoredSessionIds.keys().next().value as string | undefined;
      if (!oldest) break;
      session.priorStoredSessionIds.delete(oldest);
    }
    session.state.storedSessionId = stored;
  }

  async authenticateCardToolRequest(
    keyId: string,
    payload: string,
    signature: string,
  ): Promise<AuthenticatedCardToolRequest> {
    if (
      Buffer.byteLength(keyId) > 256
      || Buffer.byteLength(signature) > 256
      || Buffer.byteLength(payload) > 512 * 1024
    ) throw new Error('hermes_card_tool_authentication_failed');
    const candidates = [...this.sessions.values()].filter((session) => (
      session.state.status === 'running' && equalHex(session.gatewayKeyId, keyId)
    ));
    if (candidates.length !== 1) throw new Error('hermes_card_tool_authentication_failed');
    const session = candidates[0];
    const expected = createHmac('sha256', session.gatewayToken).update(payload, 'utf8').digest('hex');
    if (!equalHex(expected, signature)) throw new Error('hermes_card_tool_authentication_failed');

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new Error('hermes_card_tool_authentication_failed');
    }
    const value = record(parsed);
    const expectedKeys = [
      'arguments', 'expiresAt', 'nonce', 'sourceStoredSessionId', 'tool', 'version',
    ];
    if (Object.keys(value).sort().join('\0') !== expectedKeys.join('\0')) {
      throw new Error('hermes_card_tool_authentication_failed');
    }
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = value.expiresAt;
    const nonce = boundedString(value.nonce, 128);
    const sourceStoredSessionId = boundedString(value.sourceStoredSessionId, 512);
    const tool = boundedString(value.tool, 128);
    const args = value.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('hermes_card_tool_authentication_failed');
    }
    const snapshot = record(await session.client.request('session.activate', {
      session_id: session.state.nativeSessionId,
      profile: session.state.profile,
      omit_messages: true,
    }));
    if (String(snapshot.session_id || '').trim() !== session.state.nativeSessionId) {
      throw new Error('hermes_card_tool_authentication_failed');
    }
    const stored = String(snapshot.session_key || '').trim();
    if (!stored) throw new Error('hermes_card_tool_authentication_failed');
    this.recordStoredSessionId(session, stored);
    for (const [prior, expiry] of session.priorStoredSessionIds) {
      if (expiry < now) session.priorStoredSessionIds.delete(prior);
    }
    const sourceSessionKnown = sourceStoredSessionId === session.state.storedSessionId
      || session.priorStoredSessionIds.has(sourceStoredSessionId);
    const registered = session.cardTools.pluginTools.find(
      (candidate) => candidate.hermesName === tool,
    );
    if (
      value.version !== 1
      || !Number.isSafeInteger(expiresAt)
      || Number(expiresAt) < now
      || Number(expiresAt) > now + AUTH_MAX_FUTURE_SECONDS
      || !/^[a-f0-9]{32,128}$/i.test(nonce)
      || !sourceSessionKnown
      || !registered
    ) throw new Error('hermes_card_tool_authentication_failed');
    for (const [usedNonce, expiry] of session.cardToolNonces) {
      if (expiry < now) session.cardToolNonces.delete(usedNonce);
    }
    if (session.cardToolNonces.has(nonce)) throw new Error('hermes_card_tool_authentication_failed');
    session.cardToolNonces.set(nonce, Number(expiresAt));
    while (session.cardToolNonces.size > CARD_TOOL_NONCE_LIMIT) {
      const oldest = session.cardToolNonces.keys().next().value as string | undefined;
      if (!oldest) break;
      session.cardToolNonces.delete(oldest);
    }
    return {
      owner: { ...session.owner },
      state: { ...session.state },
      canonicalToolName: registered.canonicalName,
      cardTools: {
        cardRevisionId: session.cardTools.cardRevisionId,
        configurationFingerprint: session.cardTools.configurationFingerprint,
        runtimeMode: session.cardTools.runtime.mode,
      },
      request: {
        version: 1,
        expiresAt: Number(expiresAt),
        nonce,
        sourceStoredSessionId,
        tool,
        arguments: args as Record<string, unknown>,
      },
    };
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

  async requestProfile<T>(
    profile: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const normalized = String(profile || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
      throw new Error('agent_terminal_profile_missing');
    }
    const matches = [...this.sessions.values()].filter((candidate) => (
      candidate.state.status === 'running' && candidate.state.profile.toLowerCase() === normalized
    ));
    if (matches.length === 0) throw new Error('agent_terminal_profile_runtime_not_running');
    if (matches.length > 1) throw new Error('agent_terminal_profile_runtime_ambiguous');
    return matches[0].client.request<T>(method, { ...params, profile: normalized });
  }

  async dispatchLearn(profile: string, request: string): Promise<string> {
    const result = await this.requestProfile<any>(profile, 'command.dispatch', {
      name: 'learn',
      arg: request,
    });
    const message = result?.type === 'send' ? String(result.message || '').trim() : '';
    if (!message) throw new Error('hermes_learn_command_dispatch_failed');
    return message;
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

  resize(owner: AgentTerminalOwner, id: string, cols: number, rows: number): AgentTerminalState {
    const session = this.running(owner, id);
    if (!session.pty) throw new Error('agent_terminal_tui_not_attached');
    session.pty.resize(cols, rows);
    Object.assign(session.state, { cols, rows });
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

  private stopSession(session: Session): void {
    if (session.state.status !== 'running') return;
    session.stopping = true;
    session.state.status = 'exited';
    session.detachGatewayEvents();
    session.gatewayEventListeners.clear();
    session.priorStoredSessionIds.clear();
    session.cardToolNonces.clear();
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

  subscribeGatewayEvents(
    owner: AgentTerminalOwner,
    id: string,
    listener: (event: AgentTerminalGatewayEvent) => void,
  ): () => void {
    const session = this.running(owner, id);
    session.gatewayEventListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      session.gatewayEventListeners.delete(listener);
    };
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

  private async materializeNativeBotProfiles(
    gatewaySession: Session,
    profiles: DesiredHermesBotProfile[],
  ): Promise<void> {
    const request: ProfileRequest = (method, params) => gatewaySession.client.request(method, {
      ...params,
      profile: gatewaySession.launch.profile,
    });
    for (const target of profiles) {
      await this.configureNativeBotProfile(request, target.owner, target.card, target.projection);
    }
  }

  async reconcile(
    desired: DesiredAgentTerminal[],
    dimensions: { cols: number; rows: number } = { cols: 120, rows: 36 },
    botProfiles?: DesiredHermesBotProfile[],
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
    const projectedByOwner = new Map<string, DesiredHermesBotProfile>();
    const projectedProfiles = new Set<string>();
    for (const target of botProfiles ?? []) {
      const key = ownerKey(target.owner);
      if (projectedByOwner.has(key)) throw new Error('agent_terminal_bot_profile_owner_duplicate');
      if (target.card.id !== target.owner.cardId || target.projection.cardId !== target.owner.cardId) {
        throw new Error('agent_terminal_bot_profile_identity_invalid');
      }
      const profile = target.projection.profile.toLowerCase();
      if (projectedProfiles.has(profile)) {
        throw new Error(`agent_terminal_bot_profile_shared:${profile}`);
      }
      projectedByOwner.set(key, target);
      projectedProfiles.add(profile);
    }
    const existingGateway = [...this.sessions.values()].find((session) => (
      session.state.status === 'running'
    ));
    if (existingGateway && botProfiles !== undefined) {
      const revocations: DesiredHermesBotProfile[] = [];
      for (const session of this.sessions.values()) {
        if (session.state.status !== 'running'
          || projectedProfiles.has(session.launch.profile.toLowerCase())) continue;
        const card = {
          id: session.owner.cardId,
          title: session.launch.profile,
          kind: 'agent',
          runtime: { kind: 'hermes', mode: 'delegate', profile: session.launch.profile },
        } as AgentCardInstance;
        revocations.push({
          owner: session.owner,
          card,
          projection: {
            cardId: session.owner.cardId,
            cardRevisionId: '',
            profile: session.launch.profile,
            title: session.launch.profile,
            botEnabled: false,
            roster: [],
          },
        });
      }
      await this.materializeNativeBotProfiles(existingGateway, [...botProfiles, ...revocations]);
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
    const opened = await Promise.all(desired.map((target) => this.open(
      target.owner,
      target.card,
      target.deck,
      dimensions.cols,
      dimensions.rows,
      {
        workingDirectory: target.workingDirectory,
        attachTui: target.attachTui,
        botRosterProjection: projectedByOwner.get(ownerKey(target.owner))?.projection,
      },
    )));
    if (!existingGateway && botProfiles !== undefined && botProfiles.length) {
      const firstState = opened[0];
      if (!firstState) throw new Error('agent_terminal_bot_profile_gateway_unavailable');
      const gatewaySession = this.running(
        desired[0].owner,
        firstState.sessionId,
      );
      await this.materializeNativeBotProfiles(gatewaySession, botProfiles);
    }
    return opened;
  }

  stopAll(): void {
    for (const session of this.sessions.values()) this.stopSession(session);
  }
}

export const agentTerminalManager = new AgentTerminalManager();
