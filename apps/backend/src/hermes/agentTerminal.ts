import {
  createHash,
  randomUUID,
} from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn as spawnPty } from 'node-pty';
import type { AgentCardInstance, DeckDocument } from '../types';
import { BUILDER_CARD_ID } from '../decks/store';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from '../services/workspaceRoot';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { resolvePythonAgentMcpServerSpec } from '../services/mcp/pythonAgentMcpClient';
import {
  CardTurn,
  cardTurnBridge,
  type CardHermesTurnResult,
  type CardTurnRouting,
} from './runtime/cardTurn';
import {
  configureHermesCardInstructions,
  configureHermesCardModelRuntime,
  configureHermesBotProfile,
  configureHermesSubagentModel,
  materializeHermesBotProfiles,
  materializeMagenticTaskProfile,
  materializeHermesProfileSelections,
  readSavedSubagentType,
  type HermesProfileSelection,
} from './profileMaterialization';
import { resolveSavedHermesProvider, type HermesProviderSelection } from './providerSelection';
import { readSavedSubagentModel } from './subagentModel';
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import {
  HERMES_CARD_TOOLS_TOOLSET,
  HermesCardToolAuthority,
  acquireOptionalHermesCardTools,
  materializeHermesApplicationMcpServers,
  materializeHermesExternalMcpTools,
  materializeHermesCardToolsPlugin,
  removeHermesApplicationMcpServers,
  releaseOptionalHermesCardTools,
  requireHermesCardToolsReadback,
  requireLoadedHermesCardToolsPlugin,
  resolveHermesCardTools,
  type AuthenticatedCardToolRequest,
  type HermesCardTools,
  type MagenticCardToolAuthority,
} from './cardToolsPlugin';
import {
  startHermesProcess,
  type HermesProcessHandle,
  type HermesRuntimeClient,
  type HermesRuntimeEvent,
} from './runtime/hermesProcess';
import {
  resolveHermesSession,
} from './runtime/hermesSession';
import {
  CardRuntime,
  type CardRuntimeLaunch,
  type CardRuntimeOwner,
  type CardRuntimeState,
  type CardTerminalListener,
} from './runtime/cardRuntime';
import { CardTerminal } from './runtime/cardTerminal';
import { CardRuntimeRegistry } from './runtime/cardRuntimeRegistry';
import {
  reconcileCardRuntimes,
  type BotRosterProjection,
  type DesiredBotProfile,
  type DesiredCardRuntime,
} from './runtime/cardRuntimeReconciler';
import {
  HermesSessionMaintenance,
  type SessionCompactionIdentity,
  type SessionCompactionReceipt,
} from './runtime/hermesSessionMaintenance';

const TEAM_CARD_ID = 'card_team';

export type AgentTerminalOwner = CardRuntimeOwner;
export type HermesBotRosterProjection = BotRosterProjection;
export type AgentTerminalState = CardRuntimeState;

export type { AuthenticatedCardToolRequest, MagenticCardToolAuthority };

export type AgentTerminalGatewayEvent = HermesRuntimeEvent;


export type AgentTerminalCompactionReceipt = SessionCompactionReceipt;
export type AgentTerminalCompactionIdentity = SessionCompactionIdentity;

export type AgentTerminalVoiceState = {
  enabled: boolean;
  tts: boolean;
  available: boolean | null;
  audioAvailable: boolean | null;
  sttAvailable: boolean | null;
  details: string;
  recordStatus?: 'recording' | 'stopped';
};

type Listener = CardTerminalListener;

export type AgentTerminalLaunch = CardRuntimeLaunch;

type GatewayClient = HermesRuntimeClient;
type GatewayClientFactory = () => Promise<GatewayClient>;
type GatewaySpawner = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; windowsHide: boolean },
) => ChildProcess;

type Session = CardRuntime;

function sameSavedCardToolAuthority(left: HermesCardTools, right: HermesCardTools): boolean {
  const stableAuthority = (value: HermesCardTools) => JSON.stringify({
    projectId: value.projectId,
    deckId: value.deckId,
    cardId: value.cardId,
    cardRevisionId: value.cardRevisionId,
    cardRevisionSha256: value.cardRevisionSha256,
    runtime: value.runtime,
    selectedTools: [...new Set([
      ...value.enabledTools,
      ...value.unavailableTools,
    ])].sort(),
    hermesSuppliedTools: value.hermesSuppliedTools,
    toolsets: value.toolsets,
    pluginTools: value.pluginTools,
  });
  return stableAuthority(left) === stableAuthority(right);
}

export type DesiredAgentTerminal = DesiredCardRuntime;
export type DesiredHermesBotProfile = DesiredBotProfile;

export type AgentTerminalOpenOptions = {
  workingDirectory?: string;
  attachTui?: boolean;
  botRosterProjection?: HermesBotRosterProjection;
  materializeTaskProfile?: boolean;
};

export function agentTerminalPresentationOptions(
  card: AgentCardInstance,
  attachTui: boolean,
): AgentTerminalOpenOptions {
  requireAgentTerminalRuntime(card);
  if (card.runtime.kind === 'hermes' && card.runtime.mode === 'main') {
    return { workingDirectory: resolveProductChatWorkingDirectory(), attachTui: false };
  }
  return card.id === BUILDER_CARD_ID
    ? { workingDirectory: resolveRepoRoot(), attachTui }
    : { attachTui };
}

export function requireAgentTerminalRuntime(
  card: AgentCardInstance,
): 'main' | 'delegate' | 'magentic_one' {
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  if (!['main', 'delegate', 'magentic_one'].includes(card.runtime.mode)) {
    throw new Error('agent_terminal_runtime_mode_unsupported');
  }
  return card.runtime.mode;
}

function ownerKey(owner: AgentTerminalOwner): string {
  return JSON.stringify([
    owner.userId,
    owner.projectId,
    owner.deckId,
    owner.cardId,
  ]);
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
 * workspace. Presentation owners pass an established cwd into the common
 * launcher instead of being identified here by Card or profile name.
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

/** Saved Card/profile authority only. Project working directories and
 * conversation identities deliberately do not participate in this value. */
export function agentTerminalProfileCardFingerprint(card: AgentCardInstance): string {
  return createHash('sha256').update(JSON.stringify({
    id: card.id,
    revisionId: card._cardRevisionId || null,
    revision: card._cardRevision || null,
    revisionSha256: card._cardRevisionSha256 || null,
    runtime: card.runtime,
    options: card.runtimeOptions,
    prompt: card.prompt,
    tools: card.tools,
  })).digest('hex');
}

export function requireAgentTerminalCard(card: AgentCardInstance, deck: DeckDocument): string {
  requireAgentTerminalRuntime(card);
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
  providerSelection: HermesProviderSelection,
): HermesProfileSelection {
  if (card.runtime.kind !== 'hermes') throw new Error('agent_terminal_requires_hermes');
  const options = card.runtimeOptions as Record<string, unknown> | undefined;
  const subagentModel = readSavedSubagentModel(options?.subagentModel);
  const subagentType = readSavedSubagentType(options?.subagentType);
  return {
    runtime: card.runtime,
    provider: providerSelection.savedProvider,
    accessMode: providerSelection.accessMode,
    modelKey: String(options?.modelKey || providerSelection.model).trim(),
    providerModelId: providerSelection.model,
    openaiRuntime: providerSelection.openaiRuntime,
    skills: list(options?.skills),
    toolsets: list(options?.toolsets),
    ...(subagentModel ? { subagentModel } : {}),
    ...(subagentType ? { subagentType } : {}),
    taskMode: card.id === TEAM_CARD_ID ? 'team' as const : null,
  };
}

/** Resolve the exact saved Card into its Gateway owner and optional Builder TUI launch. */
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
  if (!existsSync(file)) throw new Error('agent_terminal_hermes_executable_missing');
  const hermesHome = path.join(hermesRoot, '.hermes');
  const profileHome = path.join(hermesHome, 'profiles', profile);
  if (!existsSync(path.join(profileHome, 'config.yaml'))) throw new Error('agent_terminal_profile_missing');
  const options = card.runtimeOptions as Record<string, unknown> | undefined;
  const openaiRuntime = options?.openaiRuntime ?? (
    card.runtime.mode === 'magentic_one'
      && String(options?.provider || '').trim().toLowerCase() === 'openai'
      && String(options?.accessMode || '').trim().toLowerCase() === 'chatgpt-account'
      ? 'codex_app_server'
      : undefined
  );
  const providerSelection = resolveSavedHermesProvider({
    provider: options?.provider,
    accessMode: options?.accessMode,
    modelKey: options?.modelKey,
    providerModelId: options?.providerModelId,
    openaiRuntime,
  });
  const cwd = resolveAgentCardWorkingDirectory(owner, card, profile, workingDirectory);
  if (typeof card.prompt !== 'string' || !card.prompt.trim()) {
    throw new Error('agent_terminal_saved_prompt_missing');
  }
  const env = cleanEnvironment(process.env);
  delete env.HERMES_EPHEMERAL_SYSTEM_PROMPT;
  if (providerSelection.apiMode === 'codex_app_server' && process.platform === 'win32') {
    const target = process.arch === 'x64'
      ? { packageName: 'codex-win32-x64', triple: 'x86_64-pc-windows-msvc' }
      : process.arch === 'arm64'
        ? { packageName: 'codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' }
        : null;
    if (target) {
      const bin = path.join(root, 'node_modules', '@openai', target.packageName,
        'vendor', target.triple, 'bin');
      if (existsSync(path.join(bin, 'codex.exe'))) {
        const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path';
        env[pathKey] = `${bin}${path.delimiter}${env[pathKey] || ''}`;
      }
    }
  }
  Object.assign(env, {
    HERMES_HOME: hermesHome,
    TERMINAL_CWD: cwd,
    HERMES_TUI_DIR: path.join(hermesRoot, 'ui-tui'),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    TERM: 'xterm-256color',
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
  if (options?.reasoningEffort) {
    tuiArgs.push('--reasoning', String(options.reasoningEffort));
  }
  if (options?.maxTurns != null) {
    tuiArgs.push('--max-turns', String(options.maxTurns));
  }
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

function cardToolsHostUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = Number(env.PORT || 4000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('hermes_card_tools_backend_port_invalid');
  }
  return `http://127.0.0.1:${port}/api/hermes-card-tools`;
}

export class AgentTerminalManager {
  private voiceLeaseSessionId: string | null = null;

  constructor(
    private readonly spawnPtyProcess: typeof spawnPty = spawnPty,
    private readonly prepare: typeof prepareAgentTerminal = prepareAgentTerminal,
    private readonly onExit = (id: string) => cardTurnBridge.abort(id),
    private readonly spawnGateway?: GatewaySpawner,
    private readonly createGatewayClient?: GatewayClientFactory,
    private readonly materializeProfile: typeof materializeHermesProfileSelections = materializeHermesProfileSelections,
    private readonly resolveCardTools: typeof resolveHermesCardTools = resolveHermesCardTools,
    private readonly materializeCardToolsPlugin: typeof materializeHermesCardToolsPlugin = materializeHermesCardToolsPlugin,
    private readonly materializeExternalMcpTools: typeof materializeHermesExternalMcpTools = materializeHermesExternalMcpTools,
    private readonly resolveBotRoster: typeof resolveHermesBotRosterProjection = resolveHermesBotRosterProjection,
    private readonly configureCardInstructions: typeof configureHermesCardInstructions = configureHermesCardInstructions,
    private readonly configureCardModelRuntime: typeof configureHermesCardModelRuntime = configureHermesCardModelRuntime,
    private readonly resolveActiveContext = (sessionId: string) => cardTurnBridge.activeContext(sessionId),
    private readonly resolveMcpServerSpec: typeof resolvePythonAgentMcpServerSpec = resolvePythonAgentMcpServerSpec,
    private readonly materializeApplicationMcpServers: typeof materializeHermesApplicationMcpServers = materializeHermesApplicationMcpServers,
    private readonly removeApplicationMcpServers: typeof removeHermesApplicationMcpServers = removeHermesApplicationMcpServers,
    private readonly verifyMagenticWorkerToolRequest = (envelope: {
      keyId: string;
      payload: string;
      signature: string;
    }): Promise<unknown> => requestPythonRailsJson(
      '/magentic/execution/worker-tool-auth',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      },
      { timeoutMs: 15_000 },
    ),
    private readonly registry = new CardRuntimeRegistry(),
  ) {}

  private async prepareMagenticTaskCard(
    _profile: string,
    card: AgentCardInstance,
  ): Promise<void> {
    await materializeMagenticTaskProfile(card, {
      configureInstructions: this.configureCardInstructions,
      configureModelRuntime: this.configureCardModelRuntime,
    });
  }

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
    const profileCardFingerprint = agentTerminalProfileCardFingerprint(card);
    const attachTui = options.attachTui !== false;
    for (const session of this.registry.list()) {
      if (session.state.status !== 'running') continue;
      if (!sameOwner(session.owner, owner)) continue;
      if (session.state.profile.toLowerCase() !== profile.toLowerCase()) {
        throw new Error('agent_terminal_session_profile_changed');
      }
      if (session.fingerprint !== fingerprint) {
        throw new Error('agent_terminal_configuration_changed_stop_required');
      }
      if (session.cardTools.configurationFingerprint !== cardTools.configurationFingerprint) {
        const optionalCatalogTransition = sameSavedCardToolAuthority(session.cardTools, cardTools)
          && session.cardTools.externalToolCatalogState !== cardTools.externalToolCatalogState;
        if (!optionalCatalogTransition) {
          throw new Error('agent_terminal_tool_configuration_changed_stop_required');
        }
      }
      if (options.materializeTaskProfile) {
        await this.prepareMagenticTaskCard(profile, card);
      }
      if (card.runtime.kind === 'hermes') {
        const botRosterProjection = options.botRosterProjection ?? await this.resolveBotRoster(owner);
        await configureHermesBotProfile(
          (method, params) => session.client.request(method, params),
          { owner, card, projection: botRosterProjection },
        );
      }
      const binding = await session.ensureSession(owner);
      return attachTui ? this.attachTui(session, cols, rows) : {
        ...session.state,
        hermesSessionId: binding.sessionId,
        storedSessionId: binding.storedSessionId,
      };
    }
    for (const session of this.registry.list()) {
      if (session.state.status !== 'running') continue;
      if (session.state.profile.toLowerCase() !== profile.toLowerCase()) continue;
      if (
        session.owner.cardId !== owner.cardId
        || session.profileCardFingerprint !== profileCardFingerprint
      ) throw new Error('agent_terminal_profile_card_identity_mismatch');
    }
    const pending = this.registry.pendingFor(owner);
    if (pending) {
      if (pending.fingerprint !== fingerprint) {
        throw new Error('agent_terminal_configuration_changed_stop_required');
      }
      const state = await pending.promise;
      const session = this.running(owner, state.sessionId);
      if (session.cardTools.configurationFingerprint !== cardTools.configurationFingerprint) {
        const optionalCatalogTransition = sameSavedCardToolAuthority(session.cardTools, cardTools)
          && session.cardTools.externalToolCatalogState !== cardTools.externalToolCatalogState;
        if (!optionalCatalogTransition) {
          throw new Error('agent_terminal_tool_configuration_changed_stop_required');
        }
      }
      const binding = await session.ensureSession(owner);
      return attachTui
        ? this.attachTui(session, cols, rows)
        : { ...state, hermesSessionId: binding.sessionId, storedSessionId: binding.storedSessionId };
    }
    for (const candidate of this.registry.listPending()) {
      if (candidate.profile.toLowerCase() !== profile.toLowerCase()) continue;
      if (
        candidate.cardId !== owner.cardId
        || candidate.profileCardFingerprint !== profileCardFingerprint
      ) throw new Error('agent_terminal_profile_card_identity_mismatch');
    }
    this.registry.deleteExitedFor(owner);
    const promise = this.start(
      owner, card, deck, cols, rows, fingerprint, workingDirectory, cardTools,
      options.botRosterProjection,
    );
    this.registry.setPending(owner, {
      owner: { ...owner }, profile, cardId: card.id, fingerprint, profileCardFingerprint,
      promise,
    });
    try {
      const state = await promise;
      return attachTui
        ? this.attachTui(this.running(owner, state.sessionId), cols, rows)
        : state;
    } finally {
      this.registry.clearPending(owner, promise);
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
    cardTools: HermesCardTools,
    botRosterProjection?: HermesBotRosterProjection,
  ): Promise<AgentTerminalState> {
    const sessionId = randomUUID();
    const profile = requireAgentTerminalCard(card, deck);
    await this.configureCardInstructions(profile, String(card.prompt || ''));
    const launch = this.prepare(owner, card, deck, sessionId, workingDirectory);
    if (launch.providerSelection.apiMode === 'codex_app_server') {
      await this.configureCardModelRuntime(launch.profile, {
        provider: launch.providerSelection.provider,
        model: launch.providerSelection.model,
        openaiRuntime: launch.providerSelection.profileOpenaiRuntime,
      });
    }
    await this.materializeCardToolsPlugin(launch.profileHome, cardTools, { env: launch.env });
    const gatewayEnv = {
      ...launch.env,
      CARD_TOOLS_MANAGED: '1',
      CARD_TOOLS_HOST_URL: cardToolsHostUrl(),
    };
    let sessionRef: Session | undefined;
    let process: HermesProcessHandle | undefined;
    try {
      process = await startHermesProcess(
        {
          executable: launch.file,
          args: launch.gatewayArgs,
          cwd: launch.cwd,
          env: gatewayEnv,
        },
        {
          onExit: (exitCode) => {
            if (sessionRef) sessionRef.processExited(exitCode);
          },
          onTransportClosed: () => {
            if (sessionRef) this.onGatewayTransportClosed(sessionRef);
          },
        },
        {
          ...(this.spawnGateway ? { spawnProcess: this.spawnGateway } : {}),
          ...(this.createGatewayClient ? { createClient: this.createGatewayClient } : {}),
        },
      );
      const client = process.client;
      const gatewayUrl = process.url;
      const request = <T>(method: string, params: Record<string, unknown>) => (
        client.request<T>(method, params)
      );
      const profileMaterialization = await this.materializeProfile(
        {
          ...launch.profileSelection,
          hermesSuppliedTools: cardTools.hermesSuppliedTools,
          toolsets: cardTools.toolsets,
          requiredToolsets: cardTools.pluginTools.length ? [HERMES_CARD_TOOLS_TOOLSET] : [],
          // External MCP credentials are scoped to an active Card Run. Keep
          // those connections disabled while merely opening the persistent
          // Gateway/TUI; refreshOptionalCardTools binds and verifies them
          // immediately before the authorized turn.
          mcpConnectionIds: [],
        },
        (profile) => request('profiles.describe', { name: profile }),
        configureHermesSubagentModel,
        async (profile, selection) => {
          if (selection.apiMode === 'codex_app_server') {
            await this.configureCardModelRuntime(profile, selection);
            return { ok: true, applied: { model: true } };
          }
          const configured = await request('profiles.configure', {
            name: profile,
            provider: selection.provider,
            model: selection.model,
            confirm_expensive_model: true,
          });
          await this.configureCardModelRuntime(profile, selection);
          return configured;
        },
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
      await configureHermesBotProfile(
        request,
        {
          owner,
          card,
          projection: botRosterProjection ?? await this.resolveBotRoster(owner),
        },
      );
      const reasoningEffort = String(
        (card.runtimeOptions as Record<string, unknown> | undefined)?.reasoningEffort || '',
      ).trim();
      const hermes = await resolveHermesSession(client, owner, {
        profile: launch.profile,
        cwd: launch.cwd,
        cols,
        model: launch.providerSelection.model,
        provider: launch.providerSelection.provider,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      });
      // These stock Gateway methods are session/install scoped and their public
      // contracts deliberately do not accept a profile selector.  The live
      // session already identifies the profile for tools.show.
      const plugins = await client.request('plugins.list', {});
      requireLoadedHermesCardToolsPlugin(plugins);
      const unavailableToolReasons = requireHermesCardToolsReadback(
        await client.request('tools.show', { session_id: hermes.sessionId }),
        cardTools,
        profileMaterialization.unavailableHermesToolReasons,
      );

      const session = new CardRuntime({
        owner,
        card,
        deck,
        fingerprint,
        profileCardFingerprint: agentTerminalProfileCardFingerprint(card),
        process,
        gatewayUrl,
        client,
        gatewayToken: process.credential,
        gatewayKeyId: process.credentialId,
        cardTools,
        launch,
        state: {
          sessionId,
          cardId: card.id,
          profile: launch.profile,
          pid: process.pid,
          gatewayPid: process.pid,
          tuiPid: null,
          ptyId: null,
          hermesSessionId: hermes.sessionId,
          storedSessionId: hermes.storedSessionId,
          completedTurnGeneration: 0,
          completedHermesRunId: null,
          hermesHome: launch.profileHome,
          unavailableToolReasons,
          status: 'running',
          cols,
          rows,
        },
        onRunExit: this.onExit,
      });
      sessionRef = session;
      session.detachGatewayEvents = client.onEvent((event) => {
        if (!event.session_id || !session.ownsHermesSession(event.session_id)) return;
        if (event.type === 'message.start') {
          session.hermesTurnSettled = false;
        }
        if (event.type === 'session.info') {
          const stored = String(event.payload?.stored_session_id || '').trim();
          if (stored && event.session_id) session.recordStoredSession(event.session_id, stored);
          if (event.payload?.running === false) {
            session.hermesTurnSettled = true;
            for (const settle of [...session.hermesTurnSettlementWaiters]) settle(true);
          }
        }
        for (const listener of session.gatewayEventListeners) {
          try { listener(event); } catch {}
        }
      });
      this.registry.register(session);
      if (session.state.status !== 'running') {
        throw new Error(session.state.error || 'agent_terminal_gateway_disconnected');
      }
      if (process.exitCode() !== null) {
        session.processExited(process.exitCode());
        throw new Error(`hermes_process_exited_after_ready:${process.exitCode()}`);
      }
      return { ...session.state };
    } catch (error) {
      this.registry.remove(sessionId);
      process?.stop();
      throw error;
    }
  }

  private attachTui(session: Session, cols: number, rows: number): AgentTerminalState {
    new CardTerminal(session, this.spawnPtyProcess).attach(cols, rows);
    return session.snapshot();
  }

  private onGatewayTransportClosed(session: Session): void {
    session.transportClosed();
  }

  private owned(owner: AgentTerminalOwner, id: string): Session {
    return this.registry.get(owner, id);
  }

  private running(owner: AgentTerminalOwner, id: string): Session {
    const session = this.owned(owner, id);
    return session.requireRunning(owner);
  }

  state(owner: AgentTerminalOwner, id: string): AgentTerminalState {
    return this.owned(owner, id).snapshot(owner);
  }

  find(owner: AgentTerminalOwner): AgentTerminalState | null {
    const session = this.registry.find(owner);
    return session ? { ...session.state } : null;
  }

  findCard(projectId: string, deckId: string, cardId: string): {
    owner: AgentTerminalOwner;
    state: AgentTerminalState;
  } | null {
    const session = this.registry.findCard(projectId, deckId, cardId);
    return session ? { owner: { ...session.owner }, state: { ...session.state } } : null;
  }

  listRunning(): Array<{ owner: AgentTerminalOwner; state: AgentTerminalState }> {
    return this.registry.listRunning();
  }

  magenticCardToolAuthority(owner: AgentTerminalOwner): MagenticCardToolAuthority {
    return new HermesCardToolAuthority(
      this.registry,
      this.resolveActiveContext,
      this.verifyMagenticWorkerToolRequest,
    ).magenticAuthority(owner);
  }

  async authenticateCardToolRequest(
    keyId: string,
    payload: string,
    signature: string,
  ): Promise<AuthenticatedCardToolRequest> {
    return new HermesCardToolAuthority(
      this.registry,
      this.resolveActiveContext,
      this.verifyMagenticWorkerToolRequest,
    ).authenticate(keyId, payload, signature);
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
    const matches = this.registry.list().filter((candidate) => (
      candidate.state.status === 'running' && candidate.state.profile.toLowerCase() === normalized
    ));
    if (matches.length === 0) throw new Error('agent_terminal_profile_runtime_not_running');
    // Profile configuration is durable profile authority, not conversation
    // authority. Any live Gateway for the unchanged profile can carry the RPC.
    return matches[0].client.request<T>(method, params);
  }

  async dispatchLearn(profile: string, request: string): Promise<string> {
    const normalized = String(profile || '').trim().toLowerCase();
    const matches = this.registry.list().filter((runtime) => (
      runtime.state.status === 'running'
      && runtime.state.profile.toLowerCase() === normalized
    ));
    if (matches.length !== 1) throw new Error('hermes_session_runtime_unavailable');
    return new HermesSessionMaintenance(matches[0], this.resolveActiveContext)
      .dispatchLearn(request);
  }

  verifyConfiguration(
    owner: AgentTerminalOwner,
    id: string,
    card: AgentCardInstance,
    deck: DeckDocument,
    workingDirectory?: string,
  ): void {
    const session = this.owned(owner, id);
    session.verifyFingerprint(agentTerminalFingerprint(
      owner,
      card,
      deck,
      workingDirectory || session.launch.cwd,
    ));
  }

  resize(owner: AgentTerminalOwner, id: string, cols: number, rows: number): AgentTerminalState {
    const session = this.running(owner, id);
    new CardTerminal(session, this.spawnPtyProcess).resize(cols, rows);
    return session.snapshot();
  }

  input(owner: AgentTerminalOwner, id: string, data: string): void {
    new CardTerminal(this.running(owner, id), this.spawnPtyProcess).input(data);
  }

  stop(owner: AgentTerminalOwner, id: string): void {
    this.stopSession(this.owned(owner, id));
  }

  async interrupt(owner: AgentTerminalOwner, id: string): Promise<void> {
    await this.running(owner, id).interrupt(owner);
  }

  async startVoiceCapture(
    owner: AgentTerminalOwner,
    id: string,
    options: { tts?: boolean } = {},
  ): Promise<AgentTerminalVoiceState> {
    const session = this.running(owner, id);
    if (this.voiceLeaseSessionId && this.voiceLeaseSessionId !== id) {
      throw new Error('agent_terminal_voice_owned_by_another_card');
    }
    this.voiceLeaseSessionId = id;
    try {
      let status = record(await session.client.request('voice.toggle', {
        action: 'status',
        profile: session.state.profile,
      }));
      if (status.available === false || status.stt_available === false) {
        throw new Error(String(status.details || 'agent_terminal_voice_unavailable'));
      }
      if (status.enabled !== true) {
        status = record(await session.client.request('voice.toggle', {
          action: 'on',
          profile: session.state.profile,
        }));
      }
      const wantsTts = options.tts !== false;
      if (Boolean(status.tts) !== wantsTts) {
        status = record(await session.client.request('voice.toggle', {
          action: 'tts',
          profile: session.state.profile,
        }));
      }
      const recording = record(await session.client.request('voice.record', {
        action: 'start',
        session_id: session.state.hermesSessionId,
        profile: session.state.profile,
      }));
      if (recording.status !== 'recording') {
        throw new Error(recording.reason === 'wake_owned'
          ? 'agent_terminal_voice_microphone_busy'
          : 'agent_terminal_voice_recording_not_started');
      }
      return {
        enabled: status.enabled === true,
        tts: status.tts === true,
        available: typeof status.available === 'boolean' ? status.available : null,
        audioAvailable: typeof status.audio_available === 'boolean'
          ? status.audio_available : null,
        sttAvailable: typeof status.stt_available === 'boolean' ? status.stt_available : null,
        details: typeof status.details === 'string' ? status.details : '',
        recordStatus: 'recording',
      };
    } catch (error) {
      if (this.voiceLeaseSessionId === id) this.voiceLeaseSessionId = null;
      await session.client.request('voice.toggle', {
        action: 'off',
        profile: session.state.profile,
      }).catch(() => undefined);
      throw error;
    }
  }

  async stopVoiceCapture(
    owner: AgentTerminalOwner,
    id: string,
    options: { cancel?: boolean } = {},
  ): Promise<AgentTerminalVoiceState> {
    const session = this.running(owner, id);
    if (this.voiceLeaseSessionId && this.voiceLeaseSessionId !== id) {
      throw new Error('agent_terminal_voice_owned_by_another_card');
    }
    if (options.cancel) {
      const status = record(await session.client.request('voice.toggle', {
        action: 'off',
        profile: session.state.profile,
      }));
      if (this.voiceLeaseSessionId === id) this.voiceLeaseSessionId = null;
      return {
        enabled: status.enabled === true,
        tts: status.tts === true,
        available: null,
        audioAvailable: null,
        sttAvailable: null,
        details: '',
        recordStatus: 'stopped',
      };
    }
    const result = record(await session.client.request('voice.record', {
      action: 'stop',
      session_id: session.state.hermesSessionId,
      profile: session.state.profile,
    }));
    if (result.status !== 'stopped') {
      throw new Error('agent_terminal_voice_recording_not_stopped');
    }
    const status = record(await session.client.request('voice.toggle', {
      action: 'status',
      profile: session.state.profile,
    }));
    return {
      enabled: status.enabled === true,
      tts: status.tts === true,
      available: typeof status.available === 'boolean' ? status.available : null,
      audioAvailable: typeof status.audio_available === 'boolean'
        ? status.audio_available : null,
      sttAvailable: typeof status.stt_available === 'boolean' ? status.stt_available : null,
      details: typeof status.details === 'string' ? status.details : '',
      recordStatus: 'stopped',
    };
  }

  private stopSession(session: Session): void {
    if (session.state.status !== 'running') return;
    if (this.voiceLeaseSessionId === session.state.sessionId) {
      this.voiceLeaseSessionId = null;
      void session.client.request('voice.toggle', {
        action: 'off',
        profile: session.state.profile,
      }).catch(() => undefined);
    }
    session.stop();
  }

  async submit(
    owner: AgentTerminalOwner,
    id: string,
    text: string,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onEvent?: (event: AgentTerminalGatewayEvent) => void;
      surface?: 'card-shared-chat';
      routing?: CardTurnRouting;
      images?: unknown[];
    } = {},
  ): Promise<CardHermesTurnResult> {
    const session = this.running(owner, id);
    return new CardTurn(session).submit(text, {
      ...options,
      resolveBinding: () => session.ensureSession(owner),
      prepare: async () => {
        const externalConfiguration = await acquireOptionalHermesCardTools(
          session,
          this.resolveActiveContext,
          {
            resolveTools: this.resolveCardTools,
            materializeProfile: this.materializeProfile,
            materializeExternalTools: this.materializeExternalMcpTools,
            resolveMcpServerSpec: this.resolveMcpServerSpec,
            materializeApplicationServers: this.materializeApplicationMcpServers,
            configureModelRuntime: this.configureCardModelRuntime,
            removeApplicationServers: this.removeApplicationMcpServers,
          },
        );
        return externalConfiguration
          ? () => releaseOptionalHermesCardTools(
            session,
            externalConfiguration,
            this.removeApplicationMcpServers,
          )
          : undefined;
      },
    });
  }

  /**
   * Queue one Hermes post-turn context compaction on the exact running Card
   * session. The receipt deliberately excludes Hermes' generated summary: the
   * shared conversation and graph owners remain the durable/auditable record.
   *
   * Callers may ignore the returned Promise and use onReceipt. This method
   * always resolves an honest bounded receipt; hermes compaction failure never
   * rejects or stops a later Card turn. A later submit observes the updated
   * turnTail and therefore starts only after this maintenance attempt settles.
   */
  queueHermesContextCompaction(
    owner: AgentTerminalOwner,
    expected: AgentTerminalCompactionIdentity,
    onReceipt?: (receipt: AgentTerminalCompactionReceipt) => void,
  ): Promise<AgentTerminalCompactionReceipt> {
    return new HermesSessionMaintenance(
      this.running(owner, expected.sessionId),
      this.resolveActiveContext,
    ).queueCompaction(expected, onReceipt);
  }
  subscribeGatewayEvents(
    owner: AgentTerminalOwner,
    id: string,
    listener: (event: AgentTerminalGatewayEvent) => void,
  ): () => void {
    return new CardTurn(this.running(owner, id)).subscribe(listener);
  }

  subscribe(owner: AgentTerminalOwner, id: string, after: number, listener: Listener): () => void {
    return new CardTerminal(this.owned(owner, id), this.spawnPtyProcess)
      .subscribe(after, listener);
  }

  async reconcile(
    desired: DesiredAgentTerminal[],
    dimensions: { cols: number; rows: number } = { cols: 120, rows: 36 },
    botProfiles?: DesiredHermesBotProfile[],
  ): Promise<AgentTerminalState[]> {
    return reconcileCardRuntimes(
      this.registry,
      desired,
      dimensions,
      botProfiles,
      {
        requireCard: requireAgentTerminalCard,
        fingerprint: agentTerminalFingerprint,
        resolveWorkingDirectory: resolveAgentCardWorkingDirectory,
        open: (target, size, projection) => this.open(
          target.owner,
          target.card,
          target.deck,
          size.cols,
          size.rows,
          {
            workingDirectory: target.workingDirectory,
            attachTui: target.attachTui,
            botRosterProjection: projection,
          },
        ),
        stop: (runtime) => this.stopSession(runtime),
        configureInstructions: this.configureCardInstructions,
        configureBotProfiles: materializeHermesBotProfiles,
      },
    );
  }

  stopAll(): void {
    this.registry.stopAll();
  }
}

export const agentTerminalManager = new AgentTerminalManager();
