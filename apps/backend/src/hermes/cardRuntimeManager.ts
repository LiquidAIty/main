import {
  createHash,
  randomUUID,
} from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AgentCardInstance, DeckDocument } from '../types';
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
} from './runtime/cardRuntime';
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

export type HermesBotRosterProjection = BotRosterProjection;

export type { AuthenticatedCardToolRequest, MagenticCardToolAuthority };
export type CardRuntimeGatewayEvent = HermesRuntimeEvent;

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

export type DesiredHermesBotProfile = DesiredBotProfile;

export type CardRuntimeOpenOptions = {
  workingDirectory?: string;
  materializeTaskProfile?: boolean;
};

export function cardRuntimeWorkingDirectory(card: AgentCardInstance): string | undefined {
  requireCardRuntimeKind(card);
  if (card.runtime.kind === 'hermes' && card.runtime.mode === 'main') {
    return resolveProductChatWorkingDirectory();
  }
  return card.id === 'builder' ? resolveRepoRoot() : undefined;
}

export function requireCardRuntimeKind(
  card: AgentCardInstance,
): 'main' | 'delegate' | 'magentic_one' {
  if (card.runtime.kind !== 'hermes') throw new Error('card_runtime_requires_hermes');
  if (!['main', 'delegate', 'magentic_one'].includes(card.runtime.mode)) {
    throw new Error('card_runtime_mode_unsupported');
  }
  return card.runtime.mode;
}

function ownerKey(owner: CardRuntimeOwner): string {
  return JSON.stringify([
    owner.userId,
    owner.projectId,
    owner.deckId,
    owner.cardId,
  ]);
}

function sameOwner(left: CardRuntimeOwner, right: CardRuntimeOwner): boolean {
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
    throw new Error('card_runtime_saved_selection_invalid');
  }
  return [...new Set(value.map((item) => item.trim()))];
}

/**
 * Ordinary Card fallback used when no established presentation supplies a
 * workspace. Presentation owners pass an established cwd into the common
 * launcher instead of being identified here by Card or profile name.
 */
export function resolveAgentCardWorkingDirectory(
  owner: CardRuntimeOwner,
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
  if (!path.isAbsolute(selected)) throw new Error('card_runtime_saved_workspace_must_be_absolute');
  if (!existsSync(selected) || !statSync(selected).isDirectory()) {
    throw new Error(`card_runtime_saved_workspace_missing:${selected}`);
  }
  return realpathSync(selected);
}

export function cardRuntimeFingerprint(
  owner: CardRuntimeOwner,
  card: AgentCardInstance,
  deck: DeckDocument,
  workingDirectory?: string,
): string {
  const profile = requireCardRuntimeCard(card, deck);
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
export function cardRuntimeProfileCardFingerprint(card: AgentCardInstance): string {
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

export function requireCardRuntimeCard(card: AgentCardInstance, deck: DeckDocument): string {
  requireCardRuntimeKind(card);
  const profile = String(card.runtime.profile || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) throw new Error('card_runtime_profile_missing');
  if (deck.nodes.some((other) => other.id !== card.id && other.runtime.kind === 'hermes'
    && other.runtime.profile.trim().toLowerCase() === profile.toLowerCase())) {
    throw new Error('card_runtime_profile_shared');
  }
  const options = card.runtimeOptions as Record<string, unknown> | undefined;
  if ((card as AgentCardInstance & { enabled?: boolean }).enabled === false || options?.enabled === false) {
    throw new Error('card_runtime_card_disabled');
  }
  return profile;
}

function savedProfileSelection(
  card: AgentCardInstance,
  providerSelection: HermesProviderSelection,
): HermesProfileSelection {
  if (card.runtime.kind !== 'hermes') throw new Error('card_runtime_requires_hermes');
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

/** Resolve the exact saved Card into its headless Gateway process. */
export function prepareCardRuntime(
  owner: CardRuntimeOwner,
  card: AgentCardInstance,
  deck: DeckDocument,
  _sessionId: string,
  workingDirectory?: string,
): CardRuntimeLaunch {
  const profile = requireCardRuntimeCard(card, deck);
  if (card.runtime.kind !== 'hermes') throw new Error('card_runtime_requires_hermes');
  const root = resolveRepoRoot();
  const hermesRoot = path.join(root, 'Hermes');
  const file = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
  if (!existsSync(file)) throw new Error('card_runtime_hermes_executable_missing');
  const hermesHome = path.join(hermesRoot, '.hermes');
  const profileHome = path.join(hermesHome, 'profiles', profile);
  if (!existsSync(path.join(profileHome, 'config.yaml'))) throw new Error('card_runtime_profile_missing');
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
    throw new Error('card_runtime_saved_prompt_missing');
  }
  const env = cleanEnvironment(process.env);
  delete env.HERMES_EPHEMERAL_SYSTEM_PROMPT;
  delete env.HERMES_TUI_DIR;
  delete env.TERMINAL_CWD;
  delete env.TERM;
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
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  });
  const gatewayArgs = [
    '-m', 'hermes_cli.main',
    '-p', profile, 'serve', '--host', '127.0.0.1', '--port', '0', '--isolated', '--skip-build',
  ];
  return {
    file,
    gatewayArgs,
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

function desiredHermesBotProfiles(
  owner: CardRuntimeOwner,
  deck: DeckDocument,
  projections: HermesBotRosterProjection[],
): DesiredHermesBotProfile[] {
  const cards = new Map(deck.nodes.map((card) => [card.id, card] as const));
  const selected = projections.filter((projection) => cards.has(projection.cardId));
  const hermesCardIds = deck.nodes
    .filter((card) => card.runtime.kind === 'hermes')
    .map((card) => card.id);
  if (selected.length !== hermesCardIds.length
    || new Set(selected.map((projection) => projection.cardId)).size !== selected.length) {
    throw new Error('hermes_bot_roster_projection_card_invalid');
  }
  return selected.map((projection) => {
    const card = cards.get(projection.cardId);
    if (!card || card.runtime.kind !== 'hermes'
      || card.runtime.profile !== projection.profile
      || (card._cardRevisionId && projection.cardRevisionId
        && card._cardRevisionId !== projection.cardRevisionId)) {
      throw new Error('hermes_bot_roster_projection_card_invalid');
    }
    return {
      owner: {
        userId: owner.userId,
        projectId: owner.projectId,
        deckId: owner.deckId,
        cardId: card.id,
      },
      card,
      projection,
    };
  });
}

function cardToolsHostUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = Number(env.PORT || 4000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('hermes_card_tools_backend_port_invalid');
  }
  return `http://127.0.0.1:${port}/api/hermes-card-tools`;
}

export class CardRuntimeManager {
  constructor(
    private readonly prepare: typeof prepareCardRuntime = prepareCardRuntime,
    private readonly onExit = (id: string) => cardTurnBridge.abort(id),
    private readonly spawnGateway?: GatewaySpawner,
    private readonly createGatewayClient?: GatewayClientFactory,
    private readonly materializeProfile: typeof materializeHermesProfileSelections = materializeHermesProfileSelections,
    private readonly resolveCardTools: typeof resolveHermesCardTools = resolveHermesCardTools,
    private readonly materializeCardToolsPlugin: typeof materializeHermesCardToolsPlugin = materializeHermesCardToolsPlugin,
    private readonly materializeExternalMcpTools: typeof materializeHermesExternalMcpTools = materializeHermesExternalMcpTools,
    private readonly resolveBotProfiles: typeof resolveHermesBotRosterProjections = resolveHermesBotRosterProjections,
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
    owner: CardRuntimeOwner,
    card: AgentCardInstance,
    deck: DeckDocument,
    cols: number,
    rows: number,
    options: CardRuntimeOpenOptions = {},
  ): Promise<CardRuntimeState> {
    const profile = requireCardRuntimeCard(card, deck);
    const workingDirectory = resolveAgentCardWorkingDirectory(
      owner,
      card,
      profile,
      options.workingDirectory,
    );
    const cardTools = await this.resolveCardTools(owner, card);
    const fingerprint = cardRuntimeFingerprint(owner, card, deck, workingDirectory);
    const profileCardFingerprint = cardRuntimeProfileCardFingerprint(card);
    for (const session of this.registry.list()) {
      if (session.state.status !== 'running') continue;
      if (!sameOwner(session.owner, owner)) continue;
      if (session.state.profile.toLowerCase() !== profile.toLowerCase()) {
        throw new Error('card_runtime_session_profile_changed');
      }
      if (session.fingerprint !== fingerprint) {
        throw new Error('card_runtime_configuration_changed_stop_required');
      }
      if (session.cardTools.configurationFingerprint !== cardTools.configurationFingerprint) {
        const optionalCatalogTransition = sameSavedCardToolAuthority(session.cardTools, cardTools)
          && session.cardTools.externalToolCatalogState !== cardTools.externalToolCatalogState;
        if (!optionalCatalogTransition) {
          throw new Error('card_runtime_tool_configuration_changed_stop_required');
        }
      }
      if (options.materializeTaskProfile) {
        await this.prepareMagenticTaskCard(profile, card);
      }
      const binding = await session.ensureSession(owner);
      return {
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
      ) throw new Error('card_runtime_profile_card_identity_mismatch');
    }
    const pending = this.registry.pendingFor(owner);
    if (pending) {
      if (pending.fingerprint !== fingerprint) {
        throw new Error('card_runtime_configuration_changed_stop_required');
      }
      const state = await pending.promise;
      const session = this.running(owner, state.sessionId);
      if (session.cardTools.configurationFingerprint !== cardTools.configurationFingerprint) {
        const optionalCatalogTransition = sameSavedCardToolAuthority(session.cardTools, cardTools)
          && session.cardTools.externalToolCatalogState !== cardTools.externalToolCatalogState;
        if (!optionalCatalogTransition) {
          throw new Error('card_runtime_tool_configuration_changed_stop_required');
        }
      }
      const binding = await session.ensureSession(owner);
      return { ...state, hermesSessionId: binding.sessionId, storedSessionId: binding.storedSessionId };
    }
    for (const candidate of this.registry.listPending()) {
      if (candidate.profile.toLowerCase() !== profile.toLowerCase()) continue;
      if (
        candidate.cardId !== owner.cardId
        || candidate.profileCardFingerprint !== profileCardFingerprint
      ) throw new Error('card_runtime_profile_card_identity_mismatch');
    }
    this.registry.deleteExitedFor(owner);
    const promise = this.start(
      owner, card, deck, cols, rows, fingerprint, workingDirectory, cardTools,
    );
    this.registry.setPending(owner, {
      owner: { ...owner }, profile, cardId: card.id, fingerprint, profileCardFingerprint,
      promise,
    });
    try {
      const state = await promise;
      return state;
    } finally {
      this.registry.clearPending(owner, promise);
    }
  }

  private async start(
    owner: CardRuntimeOwner,
    card: AgentCardInstance,
    deck: DeckDocument,
    cols: number,
    rows: number,
    fingerprint: string,
    workingDirectory: string,
    cardTools: HermesCardTools,
  ): Promise<CardRuntimeState> {
    const sessionId = randomUUID();
    const profile = requireCardRuntimeCard(card, deck);
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
          // Gateway process; refreshOptionalCardTools binds and verifies them
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
      const botProfiles = desiredHermesBotProfiles(
        owner,
        deck,
        await this.resolveBotProfiles(owner.projectId, owner.deckId),
      );
      for (const target of botProfiles) await configureHermesBotProfile(request, target);
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
        profileCardFingerprint: cardRuntimeProfileCardFingerprint(card),
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
        throw new Error(session.state.error || 'card_runtime_gateway_disconnected');
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

  private onGatewayTransportClosed(session: Session): void {
    session.transportClosed();
  }

  runtime(owner: CardRuntimeOwner, id: string): CardRuntime {
    return this.registry.get(owner, id);
  }

  private running(owner: CardRuntimeOwner, id: string): Session {
    const session = this.runtime(owner, id);
    return session.requireRunning(owner);
  }

  state(owner: CardRuntimeOwner, id: string): CardRuntimeState {
    return this.runtime(owner, id).snapshot(owner);
  }

  find(owner: CardRuntimeOwner): CardRuntimeState | null {
    const session = this.registry.find(owner);
    return session ? { ...session.state } : null;
  }

  findCard(projectId: string, deckId: string, cardId: string): {
    owner: CardRuntimeOwner;
    state: CardRuntimeState;
  } | null {
    const session = this.registry.findCard(projectId, deckId, cardId);
    return session ? { owner: { ...session.owner }, state: { ...session.state } } : null;
  }

  listRunning(): Array<{ owner: CardRuntimeOwner; state: CardRuntimeState }> {
    return this.registry.listRunning();
  }

  magenticCardToolAuthority(owner: CardRuntimeOwner): MagenticCardToolAuthority {
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
      throw new Error('card_runtime_profile_missing');
    }
    const matches = this.registry.list().filter((candidate) => (
      candidate.state.status === 'running' && candidate.state.profile.toLowerCase() === normalized
    ));
    if (matches.length === 0) throw new Error('card_runtime_profile_not_running');
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
    owner: CardRuntimeOwner,
    id: string,
    card: AgentCardInstance,
    deck: DeckDocument,
    workingDirectory?: string,
  ): void {
    const session = this.runtime(owner, id);
    session.verifyFingerprint(cardRuntimeFingerprint(
      owner,
      card,
      deck,
      workingDirectory || session.launch.cwd,
    ));
  }

  stop(owner: CardRuntimeOwner, id: string): void {
    this.stopRuntime(this.runtime(owner, id));
  }

  async interrupt(owner: CardRuntimeOwner, id: string): Promise<void> {
    await this.running(owner, id).interrupt(owner);
  }

  private stopRuntime(runtime: CardRuntime): void {
    runtime.stop();
  }

  async submit(
    owner: CardRuntimeOwner,
    id: string,
    text: string,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      onEvent?: (event: CardRuntimeGatewayEvent) => void;
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
    owner: CardRuntimeOwner,
    expected: SessionCompactionIdentity,
    onReceipt?: (receipt: SessionCompactionReceipt) => void,
  ): Promise<SessionCompactionReceipt> {
    return new HermesSessionMaintenance(
      this.running(owner, expected.sessionId),
      this.resolveActiveContext,
    ).queueCompaction(expected, onReceipt);
  }
  subscribeGatewayEvents(
    owner: CardRuntimeOwner,
    id: string,
    listener: (event: CardRuntimeGatewayEvent) => void,
  ): () => void {
    return new CardTurn(this.running(owner, id)).subscribe(listener);
  }

  async reconcile(
    desired: DesiredCardRuntime[],
    dimensions: { cols: number; rows: number } = { cols: 120, rows: 36 },
    botProfiles?: DesiredHermesBotProfile[],
  ): Promise<CardRuntimeState[]> {
    return reconcileCardRuntimes(
      this.registry,
      desired,
      dimensions,
      botProfiles,
      {
        requireCard: requireCardRuntimeCard,
        fingerprint: cardRuntimeFingerprint,
        resolveWorkingDirectory: resolveAgentCardWorkingDirectory,
        open: (target, size) => this.open(
          target.owner,
          target.card,
          target.deck,
          size.cols,
          size.rows,
          {
            workingDirectory: target.workingDirectory,
          },
        ),
        stop: (runtime) => this.stopRuntime(runtime),
        configureInstructions: this.configureCardInstructions,
        configureBotProfiles: materializeHermesBotProfiles,
      },
    );
  }

  stopAll(): void {
    this.registry.stopAll();
  }
}

export const cardRuntimeManager = new CardRuntimeManager();
