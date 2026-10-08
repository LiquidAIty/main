import type { AgentCardInstance, DeckDocument } from '../types';

type HermesRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

type ProfileState = {
  name: string;
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
const TEAM_CARD_ID = 'card_team';

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
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

function delegationSettings(options: Record<string, any>, current: ProfileState) {
  const type = subagentType(options.subagentType);
  const selection = record(options.subagentModel);
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

export function savedCardBotRoster(deck: DeckDocument, card: AgentCardInstance): string[] {
  const options = record(card.runtimeOptions);
  const orchestrator = card.runtime.mode === 'main' || options.orchestrator === true;
  if (!orchestrator) return [];
  const profiles = new Map(deck.nodes.flatMap((node) => (
    node.runtime.kind === 'hermes' && PROFILE_PATTERN.test(node.runtime.profile)
      ? [[node.id, node.runtime.profile] as const]
      : []
  )));
  return [...new Set(deck.edges.flatMap((edge) => {
    if (edge.enabled === false || edge.edgeType !== 'flow' || edge.source !== card.id) return [];
    const profile = profiles.get(edge.target);
    return profile ? [profile] : [];
  }))];
}

function configuredProfileParams(
  card: AgentCardInstance,
  current: ProfileState,
): Record<string, unknown> {
  const options = record(card.runtimeOptions);
  const model = providerSelection(options);
  const installedSkills = (current.skills || [])
    .map((item) => String(item.name || '').trim()).filter(Boolean);
  const selectedSkills = new Set(strings(options.skills).map((name) => name.toLowerCase()));
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
  const selectedToolsets = strings(options.toolsets);
  const delegation = delegationSettings(options, current);
  if (delegation?.enabled && !selectedToolsets.includes('delegation')) {
    selectedToolsets.push('delegation');
  }
  const unavailableToolset = selectedToolsets.find((name) => !availableToolsets.has(name));
  if (unavailableToolset) {
    throw new Error(`hermes_toolset_missing:${card.runtime.profile}:${unavailableToolset}`);
  }
  const desiredMcp = strings(options.mcpConnectionIds);
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
  const taskMode = card.id === TEAM_CARD_ID ? 'team' : null;
  if ((current.task_mode || null) !== taskMode) params.task_mode = taskMode;
  return params;
}

function assertMaterialized(
  card: AgentCardInstance,
  profile: ProfileState,
): void {
  const pending = configuredProfileParams(card, profile);
  if (Object.keys(pending).length !== 1) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
}

export async function materializeSavedCardProfile(
  request: HermesRequest,
  card: AgentCardInstance,
): Promise<ProfileState> {
  if (card.runtime.kind !== 'hermes' || !PROFILE_PATTERN.test(card.runtime.profile)) {
    throw new Error('hermes_profile_card_invalid');
  }
  let current = await request<ProfileState>('profiles.describe', { name: card.runtime.profile });
  if (String(current?.name || '').toLowerCase() !== card.runtime.profile.toLowerCase()) {
    throw new Error(`hermes_profile_readback_mismatch:${card.runtime.profile}`);
  }
  const params = configuredProfileParams(card, current);
  if (Object.keys(params).length > 1) {
    const configured = record(await request('profiles.configure', params));
    if (configured.ok !== true || configured.confirm_required === true) {
      throw new Error(`hermes_profile_configuration_failed:${card.runtime.profile}`);
    }
    current = await request<ProfileState>('profiles.describe', { name: card.runtime.profile });
  }
  assertMaterialized(card, current);
  return current;
}
