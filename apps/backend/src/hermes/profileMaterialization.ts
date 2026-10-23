/**
 * Entity: Hermes Profiles
 * Relationship: This file materializes one saved Card's prompt, model, skills, toolsets, delegation settings, and stable profile metadata into its Hermes profile.
 * Entity: Saved Cards
 * Relationship: This file treats the saved Card revision as authority for profile configuration and verifies the materialized profile against that exact Card state.
 * Entity: Tool Catalog
 * Relationship: This file intersects each saved tool selection with the canonical published catalog, profile restrictions, and provider availability before configuring the profile.
 * Entity: MCP Host
 * Relationship: This file configures the profile-owned LiquidAIty MCP connection with the fixed public host, OAuth contract, profile header, and exact selected tool filter.
 * Entity: Bot Mode Delegation
 * Relationship: This file derives a Card's direct Bot roster only from its enabled outbound orange flow edges and never from blue Magnetic membership.
 * Entity: AutoTeam
 * Relationship: This file assigns Hermes Team task mode only to the saved Team and KnowGraph Cards and clears that mode from every other profile.
 * Entity: Authentication
 * Relationship: This file claims and verifies one hashed owner reference before any reusable profile mutation can occur.
 * Entity: Credentials
 * Relationship: This file requires the configured MCP OAuth client identity, forbids credential mirroring on profile creation, and keeps Project context request-scoped.
 */

import { createHash } from 'node:crypto';
import type { DeckCard, DeckDocument } from '../types';
import { exactStrings, objectRecord } from '../services/projectCardAuthority';
import type { ToolCatalogDescriptor } from '../services/mcp/toolCatalogMcpClient';
import { resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';

type HermesRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

export type HermesProfileState = {
  name: string;
  description?: string;
  soul?: string;
  model?: { provider?: string; default?: string; openai_runtime?: string | null };
  skills?: Array<{ name?: string; enabled?: boolean }>;
  toolsets?: Array<{ name?: string; enabled?: boolean }>;
  toolsets_pinned?: boolean;
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
const TEAM_CARD_IDS = new Set(['card_team', 'card_knowgraph']);
const CARD_PROFILE_MCP_SERVER = 'liquidaity';
const PROFILE_OWNER_META_KEY = 'hermes-bots';

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

function profileOwnerRef(ownerUserId: string): string {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('hermes_profile_owner_required');
  return createHash('sha256').update(owner, 'utf8').digest('hex');
}

function assertProfileOwner(profile: HermesProfileState, ownerUserId: string): void {
  const meta = objectRecord(profile.ui_meta);
  const cardMeta = objectRecord(meta[PROFILE_OWNER_META_KEY]);
  const existing = String(cardMeta.owner_ref || '').trim();
  if (existing && existing !== profileOwnerRef(ownerUserId)) {
    throw new Error('hermes_profile_owner_conflict');
  }
}

function cardProfileMcpTools(
  card: DeckCard,
  toolCatalog: readonly ToolCatalogDescriptor[],
  unavailableToolCatalogFamilies: readonly string[],
): string[] {
  const options = objectRecord(card.runtimeOptions);
  const unavailableFamilies = new Set(
    unavailableToolCatalogFamilies.map((family) => String(family).trim().toLowerCase()),
  );
  const catalogById = new Map<string, ToolCatalogDescriptor>();
  for (const definition of toolCatalog) {
    if (catalogById.has(definition.name)) {
      throw new Error(`hermes_profile_tool_catalog_duplicate:${definition.name}`);
    }
    catalogById.set(definition.name, definition);
  }
  return exactStrings(options.tools).flatMap((toolId) => {
    const definition = catalogById.get(toolId);
    const family = toolId.includes('.') ? toolId.split('.', 1)[0].toLowerCase() : '';
    if (!definition && family && unavailableFamilies.has(family)) {
      return [];
    }
    if (
      !definition
      || definition.publication !== 'external-mcp'
      || !definition.available
      || !definition.grantEligible
      || (definition.grantProfiles.length > 0
        && !definition.grantProfiles.includes(card.runtime.profile.toLowerCase()))
    ) {
      throw new Error(`hermes_profile_tool_unavailable:${card.runtime.profile}:${toolId}`);
    }
    return [definition.name];
  }).sort((left, right) => left.localeCompare(right));
}

async function ensureCardProfileMcpServer(
  request: HermesRequest,
  card: DeckCard,
  current: HermesProfileState,
  selectedTools: string[],
): Promise<boolean> {
  const expectedUrl = resolveInternalMcpUrl();
  const listed = objectRecord(await request('mcp.servers.list', {
    profile: card.runtime.profile,
  }));
  const matches = (Array.isArray(listed.servers) ? listed.servers : [])
    .map(objectRecord)
    .filter((server) => String(server.name || '').trim() === CARD_PROFILE_MCP_SERVER);
  if (matches.length > 1) {
    throw new Error(`hermes_profile_mcp_server_ambiguous:${card.runtime.profile}`);
  }
  const currentServer = (current.mcp_servers || []).find((server) => (
    String(server.name || '').trim() === CARD_PROFILE_MCP_SERVER
  ));
  const hasPersistedProjectContext = Boolean(
    String(currentServer?.context_headers?.project_id || '').trim(),
  );
  if (matches.length === 1) {
    const server = matches[0];
    let normalizedUrl = '';
    try {
      normalizedUrl = new URL(String(server.url || '').trim()).toString();
    } catch {
      throw new Error(`hermes_profile_mcp_server_definition_mismatch:${card.runtime.profile}`);
    }
    const definitionMatches = (
      normalizedUrl === expectedUrl
      && !String(server.auth || '').trim()
    );
    if (definitionMatches && !hasPersistedProjectContext) return false;
    const removed = objectRecord(await request('mcp.servers.remove', {
      profile: card.runtime.profile,
      name: CARD_PROFILE_MCP_SERVER,
    }));
    if (removed.ok !== true || removed.removed !== true) {
      throw new Error(`hermes_profile_mcp_server_rewrite_failed:${card.runtime.profile}`);
    }
    if (!selectedTools.length) return true;
  }
  if (!selectedTools.length) return false;
  const added = objectRecord(await request('mcp.servers.add', {
    profile: card.runtime.profile,
    name: CARD_PROFILE_MCP_SERVER,
    config: {
      url: expectedUrl,
      enabled: true,
      strict_redirect_headers: true,
      headers: {
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
  const cards = new Map(deck.nodes.flatMap((candidate) => (
    cardEnabled(candidate)
    && candidate.runtime.kind === 'hermes'
    && PROFILE_PATTERN.test(candidate.runtime.profile)
      ? [[candidate.id, candidate] as const]
      : []
  )));
  if (card.runtime.mode === 'main') {
    const connected = new Set(deck.edges.flatMap((edge) => {
      if (edge.enabled === false) return [];
      if (edge.edgeType === 'flow' && edge.source === card.id) return [edge.target];
      if (edge.edgeType === 'magentic_option') return [edge.source, edge.target];
      return [];
    }));
    connected.delete(card.id);
    return [...new Set(deck.nodes.flatMap((candidate) => (
      connected.has(candidate.id) && cards.has(candidate.id)
        ? [candidate.runtime.profile]
        : []
    )))];
  }
  return [...new Set(deck.edges.flatMap((edge) => {
    if (edge.enabled === false || edge.edgeType !== 'flow' || edge.source !== card.id) return [];
    const target = cards.get(edge.target);
    return target && target.id !== card.id
      ? [target.runtime.profile]
      : [];
  }))];
}

function promptSection(prompt: string, heading: string): string {
  const lines = String(prompt || '').split('\n');
  const marker = `[${heading}]`;
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const value = lines[index].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function withPromptSection(prompt: string, heading: string, content: string): string {
  const lines = String(prompt || '').split('\n');
  const marker = `[${heading}]`;
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start >= 0) {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const value = lines[index].trim();
      if (value.startsWith('[') && value.endsWith(']')) {
        end = index;
        break;
      }
    }
    lines.splice(start, end - start);
  }
  const remaining = lines.join('\n').trim();
  return content.trim()
    ? `${marker}\n${content.trim()}\n\n${remaining}`
    : remaining;
}

export function cardWithConnectedAgentSkills(
  deck: DeckDocument,
  card: DeckCard,
): DeckCard {
  const profiles = new Set(savedCardBotRoster(deck, card).map((value) => value.toLowerCase()));
  const blocks = deck.nodes.flatMap((target) => {
    if (!profiles.has(target.runtime.profile.toLowerCase())) return [];
    const skill = promptSection(String(target.prompt || ''), 'ORCHESTRATOR SKILL');
    const title = String(target.title || target.runtime.profile).trim();
    return [`[BOT: @${title}]\n${skill || 'This connected Card has no saved ORCHESTRATOR SKILL. Do not call it until the Card is configured.'}`];
  });
  return {
    ...card,
    prompt: withPromptSection(
      String(card.prompt || ''),
      'ALL CONNECTED AGENTS',
      blocks.join('\n\n'),
    ),
  };
}

function configuredProfileParams(
  card: DeckCard,
  current: HermesProfileState,
  ownerUserId: string,
  toolCatalog: readonly ToolCatalogDescriptor[],
  unavailableToolCatalogFamilies: readonly string[],
): Record<string, unknown> {
  assertProfileOwner(current, ownerUserId);
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
  const selectedCardProfileTools = cardProfileMcpTools(
    card,
    toolCatalog,
    unavailableToolCatalogFamilies,
  );
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
  const params: Record<string, unknown> = { name: card.runtime.profile };
  if (!Array.isArray(current.bot_mode_roster) || current.bot_mode_roster.length !== 0) {
    params.bot_mode_roster = [];
  }
  const currentUiMeta = objectRecord(current.ui_meta);
  const currentBotMeta = objectRecord(currentUiMeta[PROFILE_OWNER_META_KEY]);
  const cardTitle = String(card.title || '').trim();
  const ownerRef = profileOwnerRef(ownerUserId);
  if (
    String(currentBotMeta.title || '').trim() !== cardTitle
    || String(currentBotMeta.owner_ref || '').trim() !== ownerRef
    || currentBotMeta.owner_scoped !== true
  ) {
    params.ui_meta = {
      [PROFILE_OWNER_META_KEY]: {
        title: cardTitle,
        owner_ref: ownerRef,
        owner_scoped: true,
      },
    };
    const revisions = objectRecord(current.ui_meta_revisions);
    const currentRevision = revisions[PROFILE_OWNER_META_KEY];
    params.ui_meta_expected_revisions = {
      [PROFILE_OWNER_META_KEY]: Number.isInteger(currentRevision) && currentRevision >= 0
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
  // Missing is not an explicit empty selection. Hermes otherwise applies its
  // surface defaults rather than the saved Card's ordinary-toolset ceiling.
  if ((Array.isArray(options.toolsets) && current.toolsets_pinned !== true)
    || !equalStrings(enabledToolsets, selectedToolsets)) params.enabled_toolsets = selectedToolsets;
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
  if (!equalStrings(enabledMcp, desiredMcp) || !mcpFiltersMatch) {
    params.enabled_mcp_servers = desiredMcp;
    params.mcp_tool_filters = desiredMcpToolFilters;
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
  ownerUserId: string,
  toolCatalog: readonly ToolCatalogDescriptor[],
  unavailableToolCatalogFamilies: readonly string[],
): void {
  const pending = configuredProfileParams(
    card,
    profile,
    ownerUserId,
    toolCatalog,
    unavailableToolCatalogFamilies,
  );
  if (Object.keys(pending).length !== 1) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
}

export async function ensureSavedCardProfile(
  request: HermesRequest,
  card: DeckCard,
  ownerUserId: string,
): Promise<HermesProfileState> {
  const describeParams: Record<string, unknown> = { name: card.runtime.profile };
  const describe = async (): Promise<HermesProfileState> => {
    const profile = objectRecord(await request('profiles.describe', describeParams));
    if (String(profile.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()) {
      throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
    }
    const state = profile as HermesProfileState;
    assertProfileOwner(state, ownerUserId);
    return state;
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
  ownerUserId: string,
  existingProfile?: HermesProfileState,
  toolCatalog: readonly ToolCatalogDescriptor[] = [],
  unavailableToolCatalogFamilies: readonly string[] = [],
): Promise<HermesProfileState> {
  if (
    card.runtime.kind !== 'hermes'
    || !PROFILE_PATTERN.test(card.runtime.profile)
    || !String(ownerUserId || '').trim()
  ) {
    throw new Error('hermes_profile_card_invalid');
  }
  const describeParams = { name: card.runtime.profile };
  let current = existingProfile
    || await request<HermesProfileState>('profiles.describe', describeParams);
  if (String(current?.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
  assertProfileOwner(current, ownerUserId);
  const selectedCardProfileTools = cardProfileMcpTools(
    card,
    toolCatalog,
    unavailableToolCatalogFamilies,
  );
  if (await ensureCardProfileMcpServer(request, card, current, selectedCardProfileTools)) {
    current = await request<HermesProfileState>('profiles.describe', describeParams);
  }
  const params = configuredProfileParams(
    card,
    current,
    ownerUserId,
    toolCatalog,
    unavailableToolCatalogFamilies,
  );
  if (Object.keys(params).length > 1) {
    const configured = objectRecord(await request('profiles.configure', params));
    if (configured.ok !== true || configured.confirm_required === true) {
      throw new Error(`hermes_profile_configuration_failed:${card.runtime.profile}`);
    }
    current = await request<HermesProfileState>('profiles.describe', describeParams);
  }
  assertMaterialized(
    card,
    current,
    ownerUserId,
    toolCatalog,
    unavailableToolCatalogFamilies,
  );
  return current;
}
