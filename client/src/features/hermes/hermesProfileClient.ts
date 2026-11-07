/**
 * Entity: Card Profiles
 * Relationship: Reads and configures one Hermes profile through profiles.describe/configure and authenticated Hermes Webapp APIs, including profile-scoped skill files, Holographic-only memory policy, skill auto-load, and exact MCP tool-selection readback.
 */

import type {
  McpServerEntry,
  ProfilesDescribeResult,
} from '../../../../HermesLatest/apps/shared/src/gateway-contract.generated';
import { hermesRequest, hermesWebappHost } from './hermesHost';

const APPLICATION_MCP_SERVER = 'liquidaity';
const KNOWGRAPH_PROFILE = 'knowgraph';
const KNOWGRAPH_WEB_SEARCH_BACKEND = 'firecrawl';
// Hermes agent.skill_utils.ESSENTIAL_SKILLS cannot be disabled by profiles.configure.
const HERMES_REQUIRED_SKILLS = new Set(['hermes-agent']);
const CARD_MEMORY_POLICY = {
  provider: 'holographic',
  memoryEnabled: false,
  userProfileEnabled: false,
  backgroundReviewEnabled: false,
  curatorEnabled: false,
} as const;

type McpServerDetails = McpServerEntry & {
  source?: string;
  tools?: { include?: string[] };
};

export type HermesProfileView = {
  name: string;
  description: string;
  soul: string;
  model: { provider: string; default: string };
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
  mcp_servers?: Record<string, { headers?: Record<string, string> }>;
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
  };
  plugins?: {
    enabled?: unknown;
    isolation?: unknown;
    entries?: {
      liquidaity?: {
        mcp_allowlist?: unknown;
        settings?: { card_script?: unknown; task_mode?: unknown; project_id?: unknown };
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

async function profileConfig(profile: string): Promise<ProfileConfig> {
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  return fetchJSON<ProfileConfig>(
    `/api/config?profile=${encodeURIComponent(profile)}`,
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
  return loadHermesProfile(input.profile);
}

export async function configureHermesProfile(input: {
  profile: string;
  soul?: string;
  description?: string;
  model?: string;
  provider?: string;
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
  const enabledSkills = input.enabledSkills === undefined
    ? before.skills.filter((skill) => skill.enabled).map((skill) => skill.name)
    : strings(input.enabledSkills);
  const effectiveEnabledSkills = [...new Set([
    ...enabledSkills,
    ...before.skills.filter((skill) => HERMES_REQUIRED_SKILLS.has(skill.name)).map((skill) => skill.name),
  ])];
  const configure = {
    name: input.profile,
    ...(input.soul === undefined ? {} : { soul: input.soul }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    disabled_skills: before.skills
      .map((skill) => skill.name)
      .filter((name) => !effectiveEnabledSkills.includes(name)),
    enabled_toolsets: input.enabledToolsets === undefined
      ? before.toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name)
      : strings(input.enabledToolsets),
    enabled_mcp_servers: input.enabledMcpServers === undefined
      ? before.enabledMcpServers
      : strings(input.enabledMcpServers),
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
        memory: {
          provider: CARD_MEMORY_POLICY.provider,
          memory_enabled: CARD_MEMORY_POLICY.memoryEnabled,
          user_profile_enabled: CARD_MEMORY_POLICY.userProfileEnabled,
        },
        auxiliary: {
          background_review: { enabled: CARD_MEMORY_POLICY.backgroundReviewEnabled },
        },
        curator: { enabled: CARD_MEMORY_POLICY.curatorEnabled },
        ...(input.profile === KNOWGRAPH_PROFILE ? {
          web: {
            search_backend: KNOWGRAPH_WEB_SEARCH_BACKEND,
            extract_backend: KNOWGRAPH_WEB_SEARCH_BACKEND,
          },
        } : {}),
        ...(input.taskMode === undefined ? {} : {
          kanban: { task_mode: input.taskMode },
        }),
        ...(input.subagentModel === undefined ? {} : {
          delegation: input.subagentModel
            ? {
                provider: input.subagentModel.provider,
                model: input.subagentModel.model,
                reasoning_effort: input.subagentModel.reasoningEffort || '',
              }
            : {},
        }),
        ...(input.applicationTools === undefined ? {} : {
          mcp_servers: {
            [APPLICATION_MCP_SERVER]: {
              tools: { include: strings(input.applicationTools) },
            },
          },
        }),
        ...(input.autoLoadSkills === undefined ? {} : {
          skills: { auto_load: strings(input.autoLoadSkills) },
        }),
        ...(input.enabledToolsets === undefined ? {} : {
          platform_toolsets: { cli: strings(input.enabledToolsets) },
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
  if (input.applicationTools !== undefined && JSON.stringify(
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
  if (input.enabledToolsets !== undefined && JSON.stringify(
    after.toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name).sort(),
  ) !== JSON.stringify([...strings(input.enabledToolsets)].sort())) {
    throw new Error('Hermes toolset readback mismatch.');
  }
  if (input.enabledMcpServers !== undefined && JSON.stringify(
    [...after.enabledMcpServers].sort(),
  ) !== JSON.stringify([...strings(input.enabledMcpServers)].sort())) {
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
  if (canonicalJson(after.memory) !== canonicalJson(CARD_MEMORY_POLICY)) {
    throw new Error('Hermes Card memory-policy readback mismatch.');
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
