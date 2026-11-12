/**
 * Entity: Card Profiles
 * Relationship: Reads and configures one Hermes profile through profiles.describe/configure and authenticated Hermes Webapp APIs, initializing new-Card memory defaults and preserving each existing profile's memory and learning choices alongside model, skills, and exact tool-selection readback.
 * Entity: Credentials
 * Relationship: Connects one saved Card to application tools only on explicit user action, using owner-scoped issuance and Hermes credential storage without startup provisioning.
 */

import type {
  McpServerEntry,
  ProfilesDescribeResult,
} from '../../../../HermesLatest/apps/shared/src/gateway-contract.generated';
import { hermesRequest, hermesWebappHost } from './hermesHost';
import { applicationFetch } from '../../lib/applicationApi';

const APPLICATION_MCP_SERVER = 'liquidaity';
const KNOWGRAPH_PROFILE = 'knowgraph';
const KNOWGRAPH_WEB_SEARCH_BACKEND = 'firecrawl';
// Hermes agent.skill_utils.ESSENTIAL_SKILLS cannot be disabled by profiles.configure.
const HERMES_REQUIRED_SKILLS = new Set(['hermes-agent']);
const NEW_CARD_MEMORY_DEFAULTS = {
  provider: 'holographic',
  memoryEnabled: false,
  userProfileEnabled: false,
  backgroundReviewEnabled: false,
  curatorEnabled: false,
} as const;

type McpServerDetails = McpServerEntry & {
  source?: string;
  url?: string;
  auth?: string;
  tools?: { include?: string[] };
};

export type HermesProfileView = {
  name: string;
  description: string;
  soul: string;
  model: { provider: string; default: string };
  reasoningEffort: string;
  subagentType: 'none' | 'leaf' | 'recursive';
  skills: Array<{ name: string; enabled: boolean }>;
  autoLoadSkills: string[];
  toolsets: Array<{
    name: string;
    label?: string;
    description?: string;
    enabled: boolean;
    toolCount?: number;
  }>;
  enabledMcpServers: string[];
  botModeRoster: string[];
  applicationTools: string[];
  applicationConnectionConfigured: boolean;
  cardScript: Record<string, unknown> | null;
  enabledPlugins: string[];
  webSearchBackend: string;
  webExtractBackend: string;
  taskMode: string;
  pluginTaskMode: string;
  subagentModel: {
    provider: string;
    model: string;
    reasoningEffort: string;
  };
  memory: {
    provider: string;
    memoryEnabled: boolean;
    userProfileEnabled: boolean;
    backgroundReviewEnabled: boolean;
    curatorEnabled: boolean;
  };
};

type ProfileConfig = {
  mcp_servers?: Record<string, { url?: string; headers?: Record<string, string>;
    include_execution_context?: boolean; tools?: { include?: string[] } }>;
  agent?: { reasoning_effort?: unknown };
  skills?: { auto_load?: unknown };
  memory?: {
    provider?: unknown;
    memory_enabled?: unknown;
    user_profile_enabled?: unknown;
  };
  auxiliary?: { background_review?: { enabled?: unknown } };
  curator?: { enabled?: unknown };
  web?: { search_backend?: unknown; extract_backend?: unknown };
  kanban?: { task_mode?: unknown };
  delegation?: {
    provider?: unknown;
    model?: unknown;
    reasoning_effort?: unknown;
    max_spawn_depth?: unknown;
    orchestrator_enabled?: unknown;
  };
  plugins?: {
    enabled?: unknown;
    entries?: {
      liquidaity?: {
        mcp_allowlist?: unknown;
        settings?: { card_script?: unknown; task_mode?: unknown };
      };
    };
  };
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim()).filter(Boolean))]
    : [];
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

async function mcpServers(profile: string): Promise<McpServerDetails[]> {
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  const result = await fetchJSON<{ servers?: McpServerDetails[] }>(
    `/api/mcp/servers?profile=${encodeURIComponent(profile)}`,
  );
  return Array.isArray(result?.servers) ? result.servers : [];
}

async function profileConfig(profile: string, includeDefaults = true): Promise<ProfileConfig> {
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  return fetchJSON<ProfileConfig>(
    `/api/config?profile=${encodeURIComponent(profile)}${includeDefaults ? '' : '&include_defaults=false'}`,
  );
}

function projectProfile(
  described: ProfilesDescribeResult,
  servers: McpServerDetails[],
  config: ProfileConfig,
): HermesProfileView {
  const application = servers.find((server) => server.name === APPLICATION_MCP_SERVER);
  const cardScript = objectRecord(
    config.plugins?.entries?.liquidaity?.settings?.card_script,
  );
  return {
    name: described.name,
    description: described.description || '',
    soul: described.soul || '',
    model: {
      provider: typeof described.model?.provider === 'string'
        ? described.model.provider
        : '',
      default: typeof described.model?.default === 'string'
        ? described.model.default
        : '',
    },
    reasoningEffort: typeof config.agent?.reasoning_effort === 'string'
      ? config.agent.reasoning_effort : '',
    subagentType: !described.toolsets?.some((toolset) => toolset.name === 'delegation' && toolset.enabled)
      ? 'none'
      : config.delegation?.orchestrator_enabled !== false
        && Number(config.delegation?.max_spawn_depth || 1) > 1 ? 'recursive' : 'leaf',
    skills: (described.skills || []).map((skill) => ({
      name: skill.name,
      enabled: skill.enabled === true,
    })),
    autoLoadSkills: strings(config.skills?.auto_load),
    toolsets: (described.toolsets || []).map((toolset) => ({
      name: toolset.name,
      label: toolset.label,
      description: toolset.description,
      enabled: toolset.enabled === true,
      toolCount: toolset.tool_count,
    })),
    enabledMcpServers: servers.filter((server) => server.enabled === true).map((server) => server.name),
    botModeRoster: strings(described.bot_mode_roster),
    applicationTools: strings(application?.tools?.include),
    applicationConnectionConfigured: application?.transport === 'http' && Boolean(application.url),
    cardScript: cardScript && Object.keys(cardScript).length ? cardScript : null,
    enabledPlugins: strings(config.plugins?.enabled),
    webSearchBackend: typeof config.web?.search_backend === 'string'
      ? config.web.search_backend
      : '',
    webExtractBackend: typeof config.web?.extract_backend === 'string'
      ? config.web.extract_backend
      : '',
    taskMode: typeof config.kanban?.task_mode === 'string'
      ? config.kanban.task_mode
      : '',
    pluginTaskMode: typeof config.plugins?.entries?.liquidaity?.settings?.task_mode === 'string'
      ? config.plugins.entries.liquidaity.settings.task_mode
      : '',
    subagentModel: {
      provider: typeof config.delegation?.provider === 'string'
        ? config.delegation.provider
        : '',
      model: typeof config.delegation?.model === 'string'
        ? config.delegation.model
        : '',
      reasoningEffort: typeof config.delegation?.reasoning_effort === 'string'
        ? config.delegation.reasoning_effort
        : '',
    },
    memory: {
      provider: typeof config.memory?.provider === 'string' ? config.memory.provider : '',
      memoryEnabled: config.memory?.memory_enabled === true,
      userProfileEnabled: config.memory?.user_profile_enabled === true,
      backgroundReviewEnabled: config.auxiliary?.background_review?.enabled === true,
      curatorEnabled: config.curator?.enabled === true,
    },
  };
}

export async function loadHermesProfile(profile: string): Promise<HermesProfileView> {
  const [described, servers, config] = await Promise.all([
    hermesRequest(profile, 'profiles.describe', { name: profile }),
    mcpServers(profile),
    profileConfig(profile),
  ]);
  return projectProfile(described, servers, config);
}

export async function configureHermesBotRoster(
  profile: string,
  roster: string[],
): Promise<string[]> {
  const name = String(profile || '').trim().toLowerCase();
  if (!name) throw new Error('Hermes profile is required.');
  const expected = strings(roster);
  const configured = await hermesRequest(name, 'profiles.configure', {
    name,
    bot_mode_roster: expected,
  });
  if (configured.ok !== true || configured.applied?.bot_mode_roster !== true) {
    throw new Error(`Hermes Bot roster configuration failed for ${name}.`);
  }
  const described = await hermesRequest(name, 'profiles.describe', { name });
  const actual = strings(described.bot_mode_roster);
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`Hermes Bot roster readback mismatch for ${name}.`);
  }
  return actual;
}

export async function createHermesProfile(input: {
  profile: string;
  description: string;
  soul: string;
  model?: string;
  provider?: string;
}): Promise<HermesProfileView> {
  const created = await hermesRequest('main', 'profiles.create', {
    name: input.profile,
    description: input.description,
    soul: input.soul,
    model: input.model || null,
    provider: input.provider || null,
    mirror_credentials: true,
  });
  if (created.ok !== true || created.name !== input.profile) {
    throw new Error('Hermes profile creation failed.');
  }
  // Initialize defaults only at creation; ordinary edits preserve native choices.
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  await fetchJSON(`/api/config?profile=${encodeURIComponent(input.profile)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: {
      memory: { provider: NEW_CARD_MEMORY_DEFAULTS.provider,
        memory_enabled: NEW_CARD_MEMORY_DEFAULTS.memoryEnabled,
        user_profile_enabled: NEW_CARD_MEMORY_DEFAULTS.userProfileEnabled },
      auxiliary: { background_review: { enabled: NEW_CARD_MEMORY_DEFAULTS.backgroundReviewEnabled } },
      curator: { enabled: NEW_CARD_MEMORY_DEFAULTS.curatorEnabled },
    } }),
  });
  const after = await loadHermesProfile(input.profile);
  if (canonicalJson(after.memory) !== canonicalJson(NEW_CARD_MEMORY_DEFAULTS)) {
    throw new Error('Hermes new-Card memory-default readback mismatch.');
  }
  return after;
}

export async function configureHermesProfile(input: {
  profile: string;
  soul?: string;
  description?: string;
  model?: string;
  provider?: string;
  reasoningEffort?: string;
  subagentType?: 'none' | 'leaf' | 'recursive';
  enabledSkills?: string[];
  autoLoadSkills?: string[];
  enabledToolsets?: string[];
  enabledMcpServers?: string[];
  botModeRoster?: string[];
  applicationTools?: string[];
  cardScript?: Record<string, unknown> | null;
  taskMode?: 'team' | 'magnetic' | '';
  subagentModel?: {
    provider: string;
    model: string;
    reasoningEffort?: string;
  } | null;
}): Promise<HermesProfileView> {
  const before = await loadHermesProfile(input.profile);
  // Saved grants do not create a transport or issue credentials. Explicit
  // Connect app tools owns first setup; ordinary saves only update an existing connection.
  const updateApplicationTools = input.applicationTools !== undefined
    && before.applicationConnectionConfigured;
  const enabledMcpServers = (input.enabledMcpServers === undefined
    ? before.enabledMcpServers : strings(input.enabledMcpServers))
    .filter(name => name !== APPLICATION_MCP_SERVER || before.applicationConnectionConfigured);
  const enabledSkills = input.enabledSkills === undefined
    ? before.skills.filter((skill) => skill.enabled).map((skill) => skill.name)
    : strings(input.enabledSkills);
  const effectiveEnabledSkills = [...new Set([
    ...enabledSkills,
    ...before.skills.filter((skill) => HERMES_REQUIRED_SKILLS.has(skill.name)).map((skill) => skill.name),
  ])];
  const enabledToolsets = new Set(input.enabledToolsets === undefined
    ? before.toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name)
    : strings(input.enabledToolsets));
  if (input.subagentType === 'none') enabledToolsets.delete('delegation');
  else if (input.subagentType !== undefined) enabledToolsets.add('delegation');
  const delegation = {
    ...(input.subagentModel === undefined ? {} : {
      provider: input.subagentModel?.provider || '',
      model: input.subagentModel?.model || '',
      reasoning_effort: input.subagentModel?.reasoningEffort || '',
    }),
    ...(input.subagentType === undefined ? {} : {
      max_spawn_depth: input.subagentType === 'recursive' ? 2 : 1,
      orchestrator_enabled: input.subagentType === 'recursive',
    }),
  };
  const configure = {
    name: input.profile,
    ...(input.soul === undefined ? {} : { soul: input.soul }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    disabled_skills: before.skills
      .map((skill) => skill.name)
      .filter((name) => !effectiveEnabledSkills.includes(name)),
    enabled_toolsets: [...enabledToolsets],
    enabled_mcp_servers: enabledMcpServers,
    ...(input.botModeRoster === undefined ? {} : { bot_mode_roster: strings(input.botModeRoster) }),
  };
  const configured = await hermesRequest(input.profile, 'profiles.configure', configure);
  // Hermes applies profile sections independently. Finish the requested skill/MCP
  // configuration even when another section failed, then report that failure.
  const profileConfigurationFailed = configured.ok !== true;
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  await fetchJSON(`/api/config?profile=${encodeURIComponent(input.profile)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        ...(input.reasoningEffort === undefined ? {} : {
          agent: { reasoning_effort: input.reasoningEffort || null },
        }),
        ...(input.profile === KNOWGRAPH_PROFILE ? {
          web: {
            search_backend: KNOWGRAPH_WEB_SEARCH_BACKEND,
            extract_backend: KNOWGRAPH_WEB_SEARCH_BACKEND,
          },
        } : {}),
        ...(input.taskMode === undefined ? {} : {
          kanban: { task_mode: input.taskMode },
        }),
        ...(Object.keys(delegation).length ? { delegation } : {}),
        ...(!updateApplicationTools ? {} : {
          mcp_servers: {
            [APPLICATION_MCP_SERVER]: {
              include_execution_context: true,
              tools: { include: strings(input.applicationTools) },
            },
          },
        }),
        ...(input.autoLoadSkills === undefined ? {} : {
          skills: { auto_load: strings(input.autoLoadSkills) },
        }),
        ...(input.enabledToolsets === undefined && input.subagentType === undefined ? {} : {
          platform_toolsets: { cli: [...enabledToolsets] },
        }),
        plugins: {
          enabled: [...new Set([...before.enabledPlugins, 'liquidaity'])],
          ...(input.cardScript === undefined && input.taskMode === undefined ? {} : {
            entries: {
              liquidaity: {
                mcp_allowlist: ['liquidaity'],
                settings: {
                  ...(input.cardScript === undefined ? {} : {
                    card_script: input.cardScript || {},
                  }),
                  ...(input.taskMode === undefined ? {} : {
                    task_mode: input.taskMode,
                  }),
                },
              },
            },
          }),
        },
      },
    }),
  });
  const after = await loadHermesProfile(input.profile);
  if (profileConfigurationFailed) {
    const failedSections = Object.entries(objectRecord(configured.applied) || {})
      .filter(([, applied]) => applied === false).map(([section]) => section);
    throw new Error(`Hermes profile configuration failed${failedSections.length ? `: ${failedSections.join(', ')}` : ''}.`);
  }
  if (input.soul !== undefined && after.soul !== input.soul) {
    throw new Error('Hermes SOUL readback mismatch.');
  }
  if (input.description !== undefined && after.description !== input.description) {
    throw new Error('Hermes profile description readback mismatch.');
  }
  if (
    input.model !== undefined
    && (
      after.model.default !== input.model
      || after.model.provider !== String(input.provider || before.model.provider)
    )
  ) {
    throw new Error('Hermes profile model readback mismatch.');
  }
  if (updateApplicationTools && JSON.stringify(
    [...after.applicationTools].sort(),
  ) !== JSON.stringify([...strings(input.applicationTools)].sort())) {
    throw new Error('Hermes MCP tool-selection readback mismatch.');
  }
  if (input.autoLoadSkills !== undefined && JSON.stringify(
    [...after.autoLoadSkills].sort(),
  ) !== JSON.stringify([...strings(input.autoLoadSkills)].sort())) {
    throw new Error('Hermes skill auto-load readback mismatch.');
  }
  if (input.enabledSkills !== undefined && JSON.stringify(
    after.skills.filter((skill) => skill.enabled).map((skill) => skill.name).sort(),
  ) !== JSON.stringify([...effectiveEnabledSkills].sort())) {
    throw new Error('Hermes enabled-skill readback mismatch.');
  }
  if ((input.enabledToolsets !== undefined || input.subagentType !== undefined) && JSON.stringify(
    after.toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name).sort(),
  ) !== JSON.stringify([...enabledToolsets].sort())) {
    throw new Error('Hermes toolset readback mismatch.');
  }
  if (input.reasoningEffort !== undefined && after.reasoningEffort !== input.reasoningEffort) {
    throw new Error('Hermes parent reasoning readback mismatch.');
  }
  if (input.subagentType !== undefined && after.subagentType !== input.subagentType) {
    throw new Error('Hermes subagent-type readback mismatch.');
  }
  if (input.enabledMcpServers !== undefined && JSON.stringify(
    [...after.enabledMcpServers].sort(),
  ) !== JSON.stringify([...enabledMcpServers].sort())) {
    throw new Error('Hermes MCP-server readback mismatch.');
  }
  if (input.botModeRoster !== undefined && JSON.stringify(
    [...after.botModeRoster].sort(),
  ) !== JSON.stringify([...strings(input.botModeRoster)].sort())) {
    throw new Error('Hermes Bot roster readback mismatch.');
  }
  if (input.cardScript !== undefined && canonicalJson(
    after.cardScript || {},
  ) !== canonicalJson(input.cardScript || {})) {
    throw new Error('Hermes Card Script readback mismatch.');
  }
  if (canonicalJson(after.memory) !== canonicalJson(before.memory)) {
    throw new Error('Hermes Card memory settings changed during save.');
  }
  if (!after.enabledPlugins.includes('liquidaity')) {
    throw new Error('Hermes LiquidAIty plugin enablement readback mismatch.');
  }
  if (
    input.profile === KNOWGRAPH_PROFILE
    && (after.webSearchBackend !== KNOWGRAPH_WEB_SEARCH_BACKEND
      || after.webExtractBackend !== KNOWGRAPH_WEB_SEARCH_BACKEND)
  ) {
    throw new Error('Hermes KnowGraph Firecrawl search/extract readback mismatch.');
  }
  if (
    input.taskMode !== undefined
    && (after.taskMode !== input.taskMode || after.pluginTaskMode !== input.taskMode)
  ) {
    throw new Error('Hermes task-mode readback mismatch.');
  }
  if (input.subagentModel !== undefined && canonicalJson(after.subagentModel) !== canonicalJson(
    input.subagentModel
      ? {
          provider: input.subagentModel.provider,
          model: input.subagentModel.model,
          reasoningEffort: input.subagentModel.reasoningEffort || '',
        }
      : { provider: '', model: '', reasoningEffort: '' },
  )) {
    throw new Error('Hermes subagent-model readback mismatch.');
  }
  return after;
}

/** Explicit Card action only: authenticate its saved identity, let Hermes store
 * the credential, configure this one connection, then test it. Never called on mount/save. */
export async function connectHermesApplicationTools(input: {
  projectId: string; deckId: string; cardId: string; profile: string;
}): Promise<HermesProfileView> {
  const path = `/api/projects/${encodeURIComponent(input.projectId)}/decks/${encodeURIComponent(input.deckId)}`;
  const loaded = await applicationFetch(path);
  if (!loaded.ok) throw new Error('Unable to read the owned saved Card.');
  const deck = await loaded.json() as { deck?: { nodes?: Array<{
    id: string; _cardRevisionId?: string; runtime?: { profile?: string };
  }> } };
  const card = deck.deck?.nodes?.find(node => node.id === input.cardId);
  if (!card?._cardRevisionId || card.runtime?.profile !== input.profile) {
    throw new Error('Saved Card identity changed. Reopen it before connecting app tools.');
  }
  const servers = await mcpServers(input.profile);
  const existing = servers.find(server => server.name === APPLICATION_MCP_SERVER);
  if (existing && (existing.source === 'plugin' || existing.transport === 'stdio' || existing.auth === 'oauth')) {
    throw new Error('The existing app connection needs explicit repair in Hermes. It was not replaced.');
  }
  const response = await applicationFetch(`${path}/cards/${encodeURIComponent(input.cardId)}/app-tools`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedCardRevisionId: card._cardRevisionId }),
  });
  if (!response.ok) throw new Error('App-tool setup was refused. Check ownership and reopen the saved Card.');
  const setup = await response.json() as { ok?: boolean; profile?: string; cardId?: string;
    cardRevisionId?: string; serverName?: string; url?: string; bearerToken?: string; tools?: string[] };
  if (!setup.ok || setup.profile !== input.profile || setup.cardId !== input.cardId
    || setup.cardRevisionId !== card._cardRevisionId || setup.serverName !== APPLICATION_MCP_SERVER
    || !setup.bearerToken || !setup.url || !Array.isArray(setup.tools)
    || setup.tools.some(tool => typeof tool !== 'string')) {
    throw new Error('App-tool setup returned a mismatched saved identity. Nothing was connected.');
  }
  const url = new URL(setup.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) {
    throw new Error('App-tool setup returned an invalid internal endpoint. Nothing was connected.');
  }
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  const profileQuery = `?profile=${encodeURIComponent(input.profile)}`;
  const headers = { Authorization: 'Bearer ${MCP_LIQUIDAITY_API_KEY}',
    'X-LiquidAIty-Hermes-Profile': input.profile };
  try {
    // Keep the bearer out of React state, browser storage and config.yaml.
    await fetchJSON(`/api/env${profileQuery}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'MCP_LIQUIDAITY_API_KEY', value: setup.bearerToken }) });
    await fetchJSON(`/api/config${profileQuery}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { mcp_servers: { [APPLICATION_MCP_SERVER]: {
        url: setup.url, enabled: true, headers, include_execution_context: true,
        tools: { include: setup.tools },
      } } } }) });
    const enabled = [...new Set([...servers.filter(server => server.enabled).map(server => server.name), APPLICATION_MCP_SERVER])];
    const configured = await hermesRequest(input.profile, 'profiles.configure', {
      name: input.profile, enabled_mcp_servers: enabled,
    });
    if (configured.ok !== true || configured.applied?.mcp_servers !== true) {
      throw new Error('Hermes did not enable the selected app connection.');
    }
  } catch {
    // Hermes may have saved the credential before a later config failure. Never
    // claim atomic setup or expose an error body containing credential input.
    throw new Error('Hermes app-tool setup did not finish. The credential may be saved; retry this explicit action.');
  }
  // Effective config expands ${ENV} references. Verify the saved reference through
  // Hermes's public raw-values option, then prove the resolved credential by probing.
  const config = await profileConfig(input.profile, false);
  const actual = config.mcp_servers?.[APPLICATION_MCP_SERVER];
  if (actual?.url !== setup.url || actual.include_execution_context !== true
    || Object.entries(headers).some(([key, value]) => actual.headers?.[key] !== value)
    || canonicalJson(strings(actual.tools?.include).sort()) !== canonicalJson([...setup.tools].sort())) {
    throw new Error('Hermes app-tool configuration readback did not match.');
  }
  const probe = await hermesRequest(input.profile, 'mcp.servers.test', { name: APPLICATION_MCP_SERVER });
  if (probe.ok !== true) throw new Error('The app connection was saved but its tool-access test failed.');
  return loadHermesProfile(input.profile);
}

export async function loadHermesSkill(profile: string, name: string): Promise<{
  name: string;
  content: string;
  path?: string;
}> {
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  return fetchJSON(
    `/api/skills/content?name=${encodeURIComponent(name)}&profile=${encodeURIComponent(profile)}`,
  );
}

export async function saveHermesSkill(
  profile: string,
  name: string,
  content: string,
): Promise<void> {
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  const result = await fetchJSON<{ success?: boolean; ok?: boolean; error?: string }>(
    '/api/skills/content',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, profile }),
    },
  );
  if (result?.success !== true && result?.ok !== true) {
    throw new Error(result?.error || 'Hermes skill update failed.');
  }
}

export async function createHermesSkill(
  profile: string,
  name: string,
  content: string,
): Promise<void> {
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  const result = await fetchJSON<{ success?: boolean; ok?: boolean; error?: string }>(
    '/api/skills',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, profile }),
    },
  );
  if (result?.success !== true && result?.ok !== true) {
    throw new Error(result?.error || 'Hermes skill creation failed.');
  }
}
