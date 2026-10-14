import type { DeckCard, DeckDocument } from '../types';
import { exactStrings, objectRecord } from '../services/projectCardAuthority';

type HermesRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

export type HermesProfileState = {
  name: string;
  capability_fingerprint?: string;
  description?: string;
  soul?: string;
  model?: { provider?: string; default?: string; openai_runtime?: string | null };
  skills?: Array<{ name?: string; enabled?: boolean }>;
  toolsets?: Array<{ name?: string; enabled?: boolean }>;
  mcp_servers?: Array<{ name?: string; enabled?: boolean }>;
  delegation?: {
    provider?: string;
    model?: string;
    max_spawn_depth?: number;
    orchestrator_enabled?: boolean;
    enabled?: boolean;
  };
  task_mode?: 'team' | null;
};

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ESSENTIAL_SKILLS = new Set(['hermes-agent']);
const TEAM_CARD_IDS = new Set(['card_team']);

function gatewayErrorCode(error: unknown): number | null {
  const value = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : null;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function cardEnabled(card: DeckCard): boolean {
  return card.enabled !== false && card.runtimeOptions?.enabled !== false;
}

function equalStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function providerSelection(options: Record<string, any>): {
  provider: string;
  model: string;
  openaiRuntime: 'auto' | 'codex_app_server';
} {
  const provider = String(options.provider || '').trim().toLowerCase();
  const accessMode = String(options.accessMode || '').trim().toLowerCase();
  const model = String(options.providerModelId || options.modelKey || '').trim();
  const requestedRuntime = String(options.openaiRuntime || '').trim().toLowerCase();
  if (!model) throw new Error('hermes_saved_provider_selection_incomplete');
  if (provider === 'openai' && accessMode === 'chatgpt-account') {
    if (requestedRuntime && requestedRuntime !== 'codex_app_server') {
      throw new Error(`hermes_saved_openai_runtime_invalid:${requestedRuntime}`);
    }
    return {
      provider: 'openai-codex',
      model,
      openaiRuntime: requestedRuntime === 'codex_app_server' ? 'codex_app_server' : 'auto',
    };
  }
  if (provider === 'openai' && accessMode === 'openai-api') {
    if (requestedRuntime) throw new Error('hermes_saved_provider_transport_unsupported');
    return { provider: 'openai', model, openaiRuntime: 'auto' };
  }
  if (provider === 'openrouter' && accessMode === 'openrouter-api') {
    if (requestedRuntime) throw new Error('hermes_saved_provider_transport_unsupported');
    return { provider: 'openrouter', model, openaiRuntime: 'auto' };
  }
  if (provider === 'local_openai_compatible' && accessMode === 'openai-api') {
    if (requestedRuntime) throw new Error('hermes_saved_provider_transport_unsupported');
    return { provider, model, openaiRuntime: 'auto' };
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
    ? providerSelection(selection)
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
): Record<string, unknown> {
  const options = objectRecord(card.runtimeOptions);
  const model = providerSelection(options);
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
  const delegation = delegationSettings(options, current);
  if (delegation?.enabled && !selectedToolsets.includes('delegation')) {
    selectedToolsets.push('delegation');
  }
  const unavailableToolset = selectedToolsets.find((name) => !availableToolsets.has(name));
  if (unavailableToolset) {
    throw new Error(`hermes_toolset_missing:${card.runtime.profile}:${unavailableToolset}`);
  }
  const desiredMcp = exactStrings(options.mcpConnectionIds);
  const params: Record<string, unknown> = { name: card.runtime.profile };
  if (current.soul !== String(card.prompt || '')) params.soul = String(card.prompt || '');
  if (
    current.model?.provider !== model.provider
    || current.model?.default !== model.model
    || current.model?.openai_runtime !== model.openaiRuntime
  ) {
    Object.assign(params, {
      provider: model.provider,
      model: model.model,
      openai_runtime: model.openaiRuntime,
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
  if (!equalStrings(enabledMcp, desiredMcp)) params.enabled_mcp_servers = desiredMcp;
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
): void {
  const pending = configuredProfileParams(card, profile);
  if (Object.keys(pending).length !== 1) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
}

export async function ensureSavedCardProfile(
  request: HermesRequest,
  card: DeckCard,
  botModeRoster?: string[],
): Promise<HermesProfileState> {
  const describeParams: Record<string, unknown> = { name: card.runtime.profile };
  if (botModeRoster !== undefined) describeParams.bot_mode_roster = botModeRoster;
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
  botModeRoster: string[],
  existingProfile?: HermesProfileState,
): Promise<HermesProfileState> {
  if (card.runtime.kind !== 'hermes' || !PROFILE_PATTERN.test(card.runtime.profile)) {
    throw new Error('hermes_profile_card_invalid');
  }
  const describeParams = {
    name: card.runtime.profile,
    bot_mode_roster: botModeRoster,
  };
  let current = existingProfile
    || await request<HermesProfileState>('profiles.describe', describeParams);
  if (String(current?.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
  const params = configuredProfileParams(card, current);
  if (Object.keys(params).length > 1) {
    const configured = objectRecord(await request('profiles.configure', params));
    if (configured.ok !== true || configured.confirm_required === true) {
      throw new Error(`hermes_profile_configuration_failed:${card.runtime.profile}`);
    }
    current = await request<HermesProfileState>('profiles.describe', describeParams);
  }
  assertMaterialized(card, current);
  if (!/^[0-9a-f]{12}$/.test(String(current.capability_fingerprint || ''))) {
    throw new Error(`hermes_profile_capability_fingerprint_invalid:${card.runtime.profile}`);
  }
  return current;
}
