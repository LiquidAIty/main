/**
 * Entity: Hermes Profiles
 * Relationship: Projects one saved Card onto Hermes' standard profile contract plus the exact wire-derived Bot roster.
 * Entity: MCP Host
 * Relationship: Configures the one saved Card MCP connection with only that Card's granted operations.
 */

import type { DeckCard, DeckDocument } from '../types';
import { exactStrings, objectRecord } from '../services/projectCardAuthority';
import type { ToolCatalogDescriptor } from '../services/mcp/toolCatalogMcpClient';
import { resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';

type HermesRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

export type HermesProfileState = {
  name: string;
  description?: string;
  soul?: string;
  model?: { provider?: string; default?: string };
  skills?: Array<{ name?: string; enabled?: boolean }>;
  toolsets?: Array<{ name?: string; enabled?: boolean }>;
  toolsets_pinned?: boolean;
  mcp_servers?: Array<{ name?: string; enabled?: boolean }>;
  bot_mode_roster?: string[] | null;
  ui_meta?: Record<string, unknown> | null;
  ui_meta_revisions?: Record<string, number>;
};

const ESSENTIAL_SKILLS = new Set(['hermes-agent']);
const CARD_MCP_SERVER = 'liquidaity';
const BOT_META_KEY = 'hermes-bots';

function validProfileName(value: string): boolean {
  if (!value || value.length > 64) return false;
  const first = value[0];
  const firstValid = (first >= 'a' && first <= 'z') || (first >= '0' && first <= '9');
  if (!firstValid) return false;
  return [...value].every((character) => (
    (character >= 'a' && character <= 'z')
    || (character >= '0' && character <= '9')
    || character === '_'
    || character === '-'
  ));
}

function gatewayErrorCode(error: unknown): number | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null;
  return typeof code === 'number' && Number.isInteger(code) ? code : null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function promptSection(prompt: string, heading: string): string {
  const lines = prompt.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[${heading}]`);
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function promptWithoutSection(prompt: string, heading: string): string {
  const lines = prompt.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[${heading}]`);
  if (start < 0) return prompt.trim();
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      end = index;
      break;
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim();
}

function botAddress(card: DeckCard): string {
  const title = String(card.title || '').trim();
  const normalized = title.toLowerCase();
  return validProfileName(normalized) ? title : card.runtime.profile;
}

function cardDescription(card: DeckCard): string {
  return promptSection(String(card.prompt || ''), 'ORCHESTRATOR SKILL')
    || String(card.subtitle || card.title || '').trim();
}

async function profileListRow(
  request: HermesRequest,
  profile: string,
): Promise<Record<string, any>> {
  const listed = objectRecord(await request('profiles.list', { include_sessions: false }));
  const matches = (Array.isArray(listed.profiles) ? listed.profiles : [])
    .map(objectRecord)
    .filter((row) => String(row.name || '').toLowerCase() === profile.toLowerCase());
  if (matches.length !== 1) throw new Error(`hermes_profile_identity_ambiguous:${profile}`);
  return matches[0];
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
  if (provider === 'openai' && accessMode === 'openai-api') return { provider: 'openai', model };
  if (provider === 'openrouter' && accessMode === 'openrouter-api') return { provider, model };
  if (provider === 'local_openai_compatible' && accessMode === 'openai-api') {
    return { provider, model };
  }
  throw new Error(`hermes_saved_provider_access_mode_mismatch:${provider}:${accessMode}`);
}

export function savedCardBotRoster(deck: DeckDocument, card: DeckCard): string[] {
  const cards = new Map(deck.nodes.flatMap((candidate) => (
    candidate.enabled !== false
    && candidate.runtime.kind === 'hermes'
    && validProfileName(candidate.runtime.profile)
      ? [[candidate.id, candidate] as const]
      : []
  )));
  const enabledWires = deck.edges.filter((edge) => (
    edge.enabled !== false && edge.edgeType !== 'invalid'
  ));
  const selectedIds = new Set<string>();
  if (card.runtime.mode === 'main') {
    for (const edge of enabledWires) {
      selectedIds.add(String(edge.source || ''));
      selectedIds.add(String(edge.target || ''));
    }
  } else {
    for (const edge of enabledWires) {
      if (edge.source === card.id) selectedIds.add(String(edge.target || ''));
      if (edge.target === card.id) selectedIds.add(String(edge.source || ''));
    }
  }
  selectedIds.delete(card.id);
  return deck.nodes.flatMap((candidate) => (
    selectedIds.has(candidate.id) && cards.has(candidate.id)
      ? [candidate.runtime.profile]
      : []
  ));
}

export function materializedCardPrompt(deck: DeckDocument, card: DeckCard): string {
  const withoutOwnIntroduction = promptWithoutSection(
    String(card.prompt || ''),
    'ORCHESTRATOR SKILL',
  );
  const withoutOldRoster = promptWithoutSection(
    promptWithoutSection(withoutOwnIntroduction, 'ALL CONNECTED AGENTS'),
    'ALL AGENTS CONNECTED',
  );
  const base = withoutOldRoster;
  const options = objectRecord(card.runtimeOptions);
  if (card.runtime.mode !== 'main' && options.orchestrator !== true) return base;
  const byProfile = new Map(deck.nodes.map((candidate) => [
    candidate.runtime.profile.toLowerCase(), candidate,
  ]));
  const blocks = savedCardBotRoster(deck, card).map((profile) => {
    const target = byProfile.get(profile.toLowerCase());
    if (!target) throw new Error(`hermes_bot_roster_card_missing:${profile}`);
    const skill = promptSection(String(target.prompt || ''), 'ORCHESTRATOR SKILL');
    if (!skill) throw new Error(`hermes_connected_card_introduction_missing:${profile}`);
    const address = botAddress(target);
    return [
      `[BOT @${address}]`,
      `Use this Bot only through message_agent with target "@${address}".`,
      skill,
    ].join('\n');
  });
  return [base, ...blocks].filter(Boolean).join('\n\n');
}

function selectedCardTools(
  card: DeckCard,
  catalog: readonly ToolCatalogDescriptor[],
  unavailableFamilies: readonly string[],
): string[] {
  const unavailable = new Set(unavailableFamilies.map((value) => value.trim().toLowerCase()));
  const byName = new Map<string, ToolCatalogDescriptor>();
  for (const definition of catalog) {
    if (byName.has(definition.name)) {
      throw new Error(`hermes_profile_tool_catalog_duplicate:${definition.name}`);
    }
    byName.set(definition.name, definition);
  }
  return exactStrings(objectRecord(card.runtimeOptions).tools).flatMap((name) => {
    const definition = byName.get(name);
    const separator = name.indexOf('.');
    const family = separator < 0 ? '' : name.slice(0, separator).toLowerCase();
    if (!definition && family && unavailable.has(family)) return [];
    if (
      !definition
      || definition.publication !== 'external-mcp'
      || !definition.available
      || !definition.grantEligible
      || (definition.grantProfiles.length > 0
        && !definition.grantProfiles.includes(card.runtime.profile.toLowerCase()))
    ) throw new Error(`hermes_profile_tool_unavailable:${card.runtime.profile}:${name}`);
    return [definition.name];
  }).sort((left, right) => left.localeCompare(right));
}

async function configureCardMcp(
  request: HermesRequest,
  card: DeckCard,
  tools: readonly string[],
): Promise<void> {
  const listed = objectRecord(await request('mcp.servers.list', { profile: card.runtime.profile }));
  const matches = (Array.isArray(listed.servers) ? listed.servers : [])
    .map(objectRecord)
    .filter((server) => String(server.name || '') === CARD_MCP_SERVER);
  if (matches.length > 1) throw new Error(`hermes_profile_mcp_ambiguous:${card.runtime.profile}`);
  const existing = matches[0];
  const exact = existing && tools.length > 0
    && existing.enabled !== false
    && String(existing.url || '') === resolveInternalMcpUrl()
    && sameStrings(exactStrings(objectRecord(existing.tools).include), tools);
  if (exact) return;
  if (existing) {
    const removed = objectRecord(await request('mcp.servers.remove', {
      profile: card.runtime.profile,
      name: CARD_MCP_SERVER,
    }));
    if (removed.ok !== true || removed.removed !== true) {
      throw new Error(`hermes_profile_mcp_remove_failed:${card.runtime.profile}`);
    }
  }
  if (!tools.length) return;
  const added = objectRecord(await request('mcp.servers.add', {
    profile: card.runtime.profile,
    name: CARD_MCP_SERVER,
    config: {
      url: resolveInternalMcpUrl(),
      enabled: true,
      strict_redirect_headers: true,
      headers: { 'X-LiquidAIty-Hermes-Profile': card.runtime.profile },
      tools: { include: [...tools] },
    },
  }));
  if (added.ok !== true || String(added.name || '') !== CARD_MCP_SERVER) {
    throw new Error(`hermes_profile_mcp_add_failed:${card.runtime.profile}`);
  }
}

function profileChanges(
  deck: DeckDocument,
  card: DeckCard,
  current: HermesProfileState,
  roster: readonly string[],
  cardTools: readonly string[],
): Record<string, unknown> {
  const options = objectRecord(card.runtimeOptions);
  const desiredModel = hermesProfileModelSelection(options);
  const installedSkills = (current.skills || [])
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  const selectedSkills = new Set(exactStrings(options.skills).map((name) => name.toLowerCase()));
  for (const selected of selectedSkills) {
    if (!installedSkills.some((name) => name.toLowerCase() === selected)) {
      throw new Error(`hermes_skill_missing:${card.runtime.profile}:${selected}`);
    }
  }
  const disabledSkills = installedSkills.filter((name) => (
    !selectedSkills.has(name.toLowerCase()) && !ESSENTIAL_SKILLS.has(name.toLowerCase())
  ));
  const selectedToolsets = exactStrings(options.toolsets);
  const availableToolsets = new Set((current.toolsets || [])
    .map((item) => String(item.name || '').trim()).filter(Boolean));
  const missingToolset = selectedToolsets.find((name) => !availableToolsets.has(name));
  if (missingToolset) throw new Error(`hermes_toolset_missing:${card.runtime.profile}:${missingToolset}`);
  const selectedConnections = exactStrings(options.mcpConnectionIds);
  if (selectedConnections.includes(CARD_MCP_SERVER)) {
    throw new Error(`hermes_profile_mcp_connection_reserved:${CARD_MCP_SERVER}`);
  }
  const desiredMcp = [...new Set([
    ...selectedConnections,
    ...(cardTools.length ? [CARD_MCP_SERVER] : []),
  ])].sort((left, right) => left.localeCompare(right));
  const enabledSkills = (current.skills || []).filter((item) => item.enabled === true)
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  const enabledToolsets = (current.toolsets || []).filter((item) => item.enabled === true)
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  const enabledMcp = (current.mcp_servers || []).filter((item) => item.enabled === true)
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  const changes: Record<string, unknown> = { name: card.runtime.profile };
  if (!sameStrings(current.bot_mode_roster || [], roster)) changes.bot_mode_roster = [...roster];
  const soul = materializedCardPrompt(deck, card);
  if (String(current.soul || '') !== soul) changes.soul = soul;
  const description = cardDescription(card);
  if (String(current.description || '') !== description) changes.description = description;
  if (current.model?.provider !== desiredModel.provider || current.model?.default !== desiredModel.model) {
    changes.provider = desiredModel.provider;
    changes.model = desiredModel.model;
  }
  const desiredSkills = installedSkills.filter((name) => !disabledSkills.includes(name));
  if (!sameStrings(enabledSkills, desiredSkills)) changes.disabled_skills = disabledSkills;
  if ((Array.isArray(options.toolsets) && current.toolsets_pinned !== true)
    || !sameStrings(enabledToolsets, selectedToolsets)) changes.enabled_toolsets = selectedToolsets;
  if (!sameStrings(enabledMcp, desiredMcp)) changes.enabled_mcp_servers = desiredMcp;
  return changes;
}

export async function ensureSavedCardProfile(
  request: HermesRequest,
  deck: DeckDocument,
  card: DeckCard,
  ownerUserId: string,
): Promise<HermesProfileState> {
  if (!String(ownerUserId || '').trim()) throw new Error('hermes_profile_owner_required');
  const describe = async () => {
    const profile = objectRecord(await request('profiles.describe', { name: card.runtime.profile }));
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
  const created = objectRecord(await request('profiles.create', {
    name: card.runtime.profile,
    description: cardDescription(card),
    soul: materializedCardPrompt(deck, card),
    no_alias: true,
    mirror_credentials: false,
  }));
  if (created.ok !== true || String(created.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()) {
    throw new Error(`hermes_profile_creation_failed:${card.runtime.profile}`);
  }
  return describe();
}

export async function materializeSavedCardProfile(
  request: HermesRequest,
  deck: DeckDocument,
  card: DeckCard,
  ownerUserId: string,
  existingProfile: HermesProfileState | undefined,
  toolCatalog: readonly ToolCatalogDescriptor[],
  unavailableToolCatalogFamilies: readonly string[],
  roster: readonly string[],
): Promise<HermesProfileState> {
  if (card.runtime.kind !== 'hermes' || !validProfileName(card.runtime.profile)) {
    throw new Error('hermes_profile_card_invalid');
  }
  let current = existingProfile || await ensureSavedCardProfile(request, deck, card, ownerUserId);
  const tools = selectedCardTools(card, toolCatalog, unavailableToolCatalogFamilies);
  await configureCardMcp(request, card, tools);
  current = await request<HermesProfileState>('profiles.describe', { name: card.runtime.profile });
  let profileRow = await profileListRow(request, card.runtime.profile);
  const changes = profileChanges(deck, card, current, roster, tools);
  const botMeta = objectRecord(objectRecord(profileRow.ui_meta)[BOT_META_KEY]);
  if (String(botMeta.title || '') !== String(card.title || '').trim()) {
    const revision = objectRecord(profileRow.ui_meta_revisions)[BOT_META_KEY];
    changes.ui_meta = { [BOT_META_KEY]: { title: String(card.title || '').trim() } };
    changes.ui_meta_expected_revisions = {
      [BOT_META_KEY]: Number.isInteger(revision) && Number(revision) >= 0 ? Number(revision) : 0,
    };
  }
  if (Object.keys(changes).length > 1) {
    const configured = objectRecord(await request('profiles.configure', changes));
    if (configured.ok !== true || configured.confirm_required === true) {
      throw new Error(`hermes_profile_configuration_failed:${card.runtime.profile}`);
    }
  }
  current = await request<HermesProfileState>('profiles.describe', { name: card.runtime.profile });
  profileRow = await profileListRow(request, card.runtime.profile);
  if (Object.keys(profileChanges(deck, card, current, roster, tools)).length !== 1) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
  if (
    String(objectRecord(objectRecord(profileRow.ui_meta)[BOT_META_KEY]).title || '')
      !== String(card.title || '').trim()
  ) throw new Error(`hermes_profile_bot_metadata_mismatch:${card.runtime.profile}`);
  return current;
}
