import type { DeckCard, DeckDocument } from '../types';
import { exactStrings, objectRecord } from '../services/projectCardAuthority';
import type { ToolCatalogDescriptor } from '../services/mcp/toolCatalogMcpClient';

type HermesRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

export type HermesProfileState = {
  name: string;
  description?: string;
  soul?: string;
  model?: { provider?: string; default?: string; openai_runtime?: string | null };
  skills?: Array<{ name?: string; enabled?: boolean }>;
  toolsets?: Array<{ name?: string; enabled?: boolean }>;
  mcp_servers?: Array<{
    name?: string;
    enabled?: boolean;
    tool_filter?: string[] | null;
    context_headers?: { project_id?: string; profile?: string } | null;
  }>;
  delegation?: {
    provider?: string;
    model?: string;
    max_spawn_depth?: number;
    orchestrator_enabled?: boolean;
    enabled?: boolean;
  };
  task_mode?: 'team' | null;
  bot_mode_roster?: string[] | null;
  ui_meta_revisions?: Record<string, number>;
  ui_meta?: Record<string, unknown> | null;
};

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ESSENTIAL_SKILLS = new Set(['hermes-agent']);
const TEAM_CARD_IDS = new Set(['card_team']);
const CARD_PROFILE_MCP_SERVER = 'liquidaity';

function gatewayErrorCode(error: unknown): number | null {
  const value = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : null;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function cardEnabled(card: DeckCard): boolean {
  return card.enabled !== false;
}

function equalStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function cardProfileMcpUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = String(env.MCP_PUBLIC_RESOURCE_URL || '').trim();
  if (!value) throw new Error('hermes_profile_mcp_public_url_missing');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('hermes_profile_mcp_public_url_invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/mcp') {
    throw new Error('hermes_profile_mcp_public_url_invalid');
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function cardProfileMcpOauth(env: NodeJS.ProcessEnv = process.env): {
  client_id: string;
  scope: string;
} {
  const clientId = String(env.MCP_AUTH0_CLIENT_ID || '').trim();
  const requiredScope = String(env.MCP_AUTH0_REQUIRED_SCOPE || '').trim();
  if (!clientId || !requiredScope) throw new Error('hermes_profile_mcp_oauth_config_missing');
  return {
    client_id: clientId,
    scope: ['openid', 'profile', 'email', 'offline_access', requiredScope].join(' '),
  };
}

function cardProfileMcpTools(
  card: DeckCard,
  toolCatalog: readonly ToolCatalogDescriptor[],
): string[] {
  const options = objectRecord(card.runtimeOptions);
  const catalogById = new Map<string, ToolCatalogDescriptor>();
  for (const definition of toolCatalog) {
    if (catalogById.has(definition.name)) {
      throw new Error(`hermes_profile_tool_catalog_duplicate:${definition.name}`);
    }
    catalogById.set(definition.name, definition);
  }
  return exactStrings(options.tools).flatMap((toolId) => {
    const definition = catalogById.get(toolId);
    if (
      !definition
      || definition.publication !== 'external-mcp'
      || !definition.available
      || !definition.grantEligible
    ) {
      throw new Error(`hermes_profile_tool_unavailable:${card.runtime.profile}:${toolId}`);
    }
    return [definition.name];
  }).sort((left, right) => left.localeCompare(right));
}

async function ensureCardProfileMcpServer(
  request: HermesRequest,
  card: DeckCard,
  projectId: string,
  selectedTools: string[],
): Promise<boolean> {
  if (!selectedTools.length) return false;
  const expectedUrl = cardProfileMcpUrl();
  const oauth = cardProfileMcpOauth();
  const listed = objectRecord(await request('mcp.servers.list', {
    profile: card.runtime.profile,
  }));
  const matches = (Array.isArray(listed.servers) ? listed.servers : [])
    .map(objectRecord)
    .filter((server) => String(server.name || '').trim() === CARD_PROFILE_MCP_SERVER);
  if (matches.length > 1) {
    throw new Error(`hermes_profile_mcp_server_ambiguous:${card.runtime.profile}`);
  }
  if (matches.length === 1) {
    const server = matches[0];
    let normalizedUrl = '';
    try {
      normalizedUrl = new URL(String(server.url || '').trim()).toString();
    } catch {
      throw new Error(`hermes_profile_mcp_server_definition_mismatch:${card.runtime.profile}`);
    }
    if (normalizedUrl !== expectedUrl || String(server.auth || '').trim() !== 'oauth') {
      throw new Error(`hermes_profile_mcp_server_definition_mismatch:${card.runtime.profile}`);
    }
    return false;
  }
  const added = objectRecord(await request('mcp.servers.add', {
    profile: card.runtime.profile,
    name: CARD_PROFILE_MCP_SERVER,
    config: {
      url: expectedUrl,
      auth: 'oauth',
      oauth,
      enabled: true,
      strict_redirect_headers: true,
      headers: {
        'X-LiquidAIty-Project-Id': projectId,
        'X-LiquidAIty-Hermes-Profile': card.runtime.profile,
      },
      tools: { include: selectedTools },
    },
  }));
  if (
    added.ok !== true
    || String(added.name || '').trim() !== CARD_PROFILE_MCP_SERVER
  ) throw new Error(`hermes_profile_mcp_server_add_failed:${card.runtime.profile}`);
  return true;
}

export function hermesProfileModelSelection(options: Record<string, any>): {
  provider: string;
  model: string;
} {
  const provider = String(options.provider || '').trim().toLowerCase();
  const accessMode = String(options.accessMode || '').trim().toLowerCase();
  const model = String(options.providerModelId || options.modelKey || '').trim();
  if (!model) throw new Error('hermes_saved_provider_selection_incomplete');
  if (provider === 'openai' && accessMode === 'chatgpt-account') {
    return { provider: 'openai-codex', model };
  }
  if (provider === 'openai' && accessMode === 'openai-api') {
    return { provider: 'openai', model };
  }
  if (provider === 'openrouter' && accessMode === 'openrouter-api') {
    return { provider: 'openrouter', model };
  }
  if (provider === 'local_openai_compatible' && accessMode === 'openai-api') {
    return { provider, model };
  }
  throw new Error(`hermes_saved_provider_access_mode_mismatch:${provider}:${accessMode}`);
}

function subagentType(value: unknown): 'none' | 'leaf' | 'recursive' | null {
  if (value == null) return null;
  if (value === 'none' || value === 'leaf' || value === 'recursive') return value;
  throw new Error('card_subagent_type_invalid');
}

function delegationSettings(options: Record<string, any>, current: HermesProfileState) {
  const type = subagentType(options.subagentType);
  const selection = objectRecord(options.subagentModel);
  if (!type) return null;
  const resolved = Object.keys(selection).length
    ? hermesProfileModelSelection(selection)
    : {
      provider: String(current.delegation?.provider || '').trim(),
      model: String(current.delegation?.model || '').trim(),
    };
  if (!resolved.provider || !resolved.model) {
    throw new Error(`hermes_subagent_selection_missing:${current.name}`);
  }
  return {
    provider: resolved.provider,
    model: resolved.model,
    max_spawn_depth: type === 'recursive' ? 2 : 1,
    orchestrator_enabled: type === 'recursive',
    enabled: type !== 'none',
  } as const;
}

export function savedCardBotRoster(deck: DeckDocument, card: DeckCard): string[] {
  const options = objectRecord(card.runtimeOptions);
  if (card.runtime.mode !== 'main' && options.orchestrator !== true) return [];
  // Orange flow is Bot Mode authority. Blue magentic_option wiring belongs
  // only to Magnetic worker selection and never broadens this roster.
  const cards = new Map(deck.nodes.flatMap((candidate) => (
    cardEnabled(candidate)
    && candidate.runtime.kind === 'hermes'
    && PROFILE_PATTERN.test(candidate.runtime.profile)
      ? [[candidate.id, candidate] as const]
      : []
  )));
  return [...new Set(deck.edges.flatMap((edge) => {
    if (edge.enabled === false || edge.edgeType !== 'flow' || edge.source !== card.id) return [];
    const target = cards.get(edge.target);
    return target && target.id !== card.id && target.runtime.mode !== 'magentic_one'
      ? [target.runtime.profile]
      : [];
  }))];
}

function configuredProfileParams(
  card: DeckCard,
  current: HermesProfileState,
  projectId: string,
  toolCatalog: readonly ToolCatalogDescriptor[],
): Record<string, unknown> {
  const options = objectRecord(card.runtimeOptions);
  const model = hermesProfileModelSelection(options);
  const installedSkills = (current.skills || [])
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  const selectedSkills = new Set(exactStrings(options.skills).map((name) => name.toLowerCase()));
  for (const skill of selectedSkills) {
    if (!installedSkills.some((name) => name.toLowerCase() === skill)) {
      throw new Error(`hermes_skill_missing:${card.runtime.profile}:${skill}`);
    }
  }
  const disabledSkills = installedSkills.filter((name) => (
    !selectedSkills.has(name.toLowerCase()) && !ESSENTIAL_SKILLS.has(name.toLowerCase())
  ));
  const availableToolsets = new Set((current.toolsets || [])
    .map((item) => String(item.name || '').trim()).filter(Boolean));
  const selectedToolsets = exactStrings(options.toolsets);
  const selectedMcpConnections = exactStrings(options.mcpConnectionIds);
  if (selectedMcpConnections.includes(CARD_PROFILE_MCP_SERVER)) {
    throw new Error(`hermes_profile_mcp_connection_reserved:${CARD_PROFILE_MCP_SERVER}`);
  }
  const selectedCardProfileTools = cardProfileMcpTools(card, toolCatalog);
  const delegation = delegationSettings(options, current);
  if (delegation?.enabled && !selectedToolsets.includes('delegation')) {
    selectedToolsets.push('delegation');
  }
  const unavailableToolset = selectedToolsets.find((name) => !availableToolsets.has(name));
  if (unavailableToolset) {
    throw new Error(`hermes_toolset_missing:${card.runtime.profile}:${unavailableToolset}`);
  }
  const desiredMcp = [...new Set([
    ...selectedMcpConnections,
    ...(selectedCardProfileTools.length ? [CARD_PROFILE_MCP_SERVER] : []),
  ])].sort((left, right) => left.localeCompare(right));
  const desiredMcpToolFilters = selectedCardProfileTools.length
    ? { [CARD_PROFILE_MCP_SERVER]: selectedCardProfileTools }
    : {};
  const desiredMcpContextHeaders = selectedCardProfileTools.length
    ? { [CARD_PROFILE_MCP_SERVER]: {
      project_id: projectId,
      profile: card.runtime.profile,
    } }
    : {};
  const params: Record<string, unknown> = { name: card.runtime.profile };
  if (!Array.isArray(current.bot_mode_roster) || current.bot_mode_roster.length !== 0) {
    params.bot_mode_roster = [];
  }
  const currentUiMeta = objectRecord(current.ui_meta);
  const currentBotMeta = objectRecord(currentUiMeta['hermes-bots']);
  const cardTitle = String(card.title || '').trim();
  if (
    String(currentBotMeta.title || '').trim() !== cardTitle
    || currentBotMeta.project_scoped !== true
  ) {
    params.ui_meta = {
      'hermes-bots': { ...currentBotMeta, title: cardTitle, project_scoped: true },
    };
    const revisions = objectRecord(current.ui_meta_revisions);
    const currentRevision = revisions['hermes-bots'];
    params.ui_meta_expected_revisions = {
      'hermes-bots': Number.isInteger(currentRevision) && currentRevision >= 0
        ? currentRevision
        : 0,
    };
  }
  if (current.soul !== String(card.prompt || '')) params.soul = String(card.prompt || '');
  if (
    current.model?.provider !== model.provider
    || current.model?.default !== model.model
    || current.model?.openai_runtime !== 'auto'
  ) {
    Object.assign(params, {
      provider: model.provider,
      model: model.model,
      openai_runtime: 'auto',
    });
  }
  const enabledSkills = (current.skills || []).filter((item) => item.enabled === true)
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  const expectedSkills = installedSkills.filter((name) => !disabledSkills.includes(name));
  if (!equalStrings(enabledSkills, expectedSkills)) params.disabled_skills = disabledSkills;
  const enabledToolsets = (current.toolsets || []).filter((item) => item.enabled === true)
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  if (!equalStrings(enabledToolsets, selectedToolsets)) params.enabled_toolsets = selectedToolsets;
  const enabledMcp = (current.mcp_servers || []).filter((item) => item.enabled === true)
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  const currentMcpToolFilters = Object.fromEntries((current.mcp_servers || []).flatMap((item) => {
    const name = String(item.name || '').trim();
    return name ? [[name, item.tool_filter === null || item.tool_filter === undefined
      ? null
      : [...item.tool_filter].sort((left, right) => left.localeCompare(right))]] : [];
  }));
  const mcpFiltersMatch = Object.entries(desiredMcpToolFilters).every(([name, tools]) => (
    JSON.stringify(currentMcpToolFilters[name]) === JSON.stringify(tools)
  ));
  const currentMcpContextHeaders = Object.fromEntries((current.mcp_servers || []).flatMap((item) => {
    const name = String(item.name || '').trim();
    const context = item.context_headers;
    return name && context ? [[name, {
      project_id: String(context.project_id || '').trim(),
      profile: String(context.profile || '').trim(),
    }]] : [];
  }));
  const mcpContextMatches = Object.entries(desiredMcpContextHeaders).every(([name, context]) => (
    JSON.stringify(currentMcpContextHeaders[name]) === JSON.stringify(context)
  ));
  if (!equalStrings(enabledMcp, desiredMcp) || !mcpFiltersMatch || !mcpContextMatches) {
    params.enabled_mcp_servers = desiredMcp;
    params.mcp_tool_filters = desiredMcpToolFilters;
    params.mcp_context_headers = desiredMcpContextHeaders;
  }
  if (delegation && JSON.stringify(current.delegation || {}) !== JSON.stringify(delegation)) {
    params.delegation = delegation;
  }
  const taskMode = TEAM_CARD_IDS.has(card.id) ? 'team' : null;
  if ((current.task_mode || null) !== taskMode) params.task_mode = taskMode;
  return params;
}

function assertMaterialized(
  card: DeckCard,
  profile: HermesProfileState,
  projectId: string,
  toolCatalog: readonly ToolCatalogDescriptor[],
): void {
  const pending = configuredProfileParams(card, profile, projectId, toolCatalog);
  if (Object.keys(pending).length !== 1) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
}

export async function ensureSavedCardProfile(
  request: HermesRequest,
  card: DeckCard,
): Promise<HermesProfileState> {
  const describeParams: Record<string, unknown> = { name: card.runtime.profile };
  const describe = async (): Promise<HermesProfileState> => {
    const profile = objectRecord(await request('profiles.describe', describeParams));
    if (String(profile.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()) {
      throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
    }
    return profile as HermesProfileState;
  };
  try {
    return await describe();
  } catch (error) {
    if (gatewayErrorCode(error) !== 4064) throw error;
  }
  try {
    const created = objectRecord(await request('profiles.create', {
      name: card.runtime.profile,
      description: String(card.title || ''),
      soul: String(card.prompt || ''),
      no_alias: true,
      mirror_credentials: false,
    }));
    if (
      created.ok !== true
      || String(created.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()
    ) {
      throw new Error(`hermes_profile_creation_failed:${card.runtime.profile}`);
    }
  } catch (error) {
    if (gatewayErrorCode(error) !== 4062) throw error;
  }
  return describe();
}

export async function materializeSavedCardProfile(
  request: HermesRequest,
  card: DeckCard,
  projectId: string,
  existingProfile?: HermesProfileState,
  toolCatalog: readonly ToolCatalogDescriptor[] = [],
): Promise<HermesProfileState> {
  if (
    card.runtime.kind !== 'hermes'
    || !PROFILE_PATTERN.test(card.runtime.profile)
    || !String(projectId || '').trim()
  ) {
    throw new Error('hermes_profile_card_invalid');
  }
  const describeParams = { name: card.runtime.profile };
  let current = existingProfile
    || await request<HermesProfileState>('profiles.describe', describeParams);
  if (String(current?.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
  const selectedCardProfileTools = cardProfileMcpTools(card, toolCatalog);
  if (await ensureCardProfileMcpServer(request, card, projectId, selectedCardProfileTools)) {
    current = await request<HermesProfileState>('profiles.describe', describeParams);
  }
  const params = configuredProfileParams(card, current, projectId, toolCatalog);
  if (Object.keys(params).length > 1) {
    const configured = objectRecord(await request('profiles.configure', params));
    if (configured.ok !== true || configured.confirm_required === true) {
      throw new Error(`hermes_profile_configuration_failed:${card.runtime.profile}`);
    }
    current = await request<HermesProfileState>('profiles.describe', describeParams);
  }
  assertMaterialized(card, current, projectId, toolCatalog);
  return current;
}
