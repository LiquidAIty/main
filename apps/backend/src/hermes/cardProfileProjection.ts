import type { AgentCardInstance, DeckDocument } from '../types';
import { requestHermesNative } from './mainAdapter';
import {
  readSavedSubagentModel,
  sameNativeSubagentModel,
  toNativeSubagentModel,
  type SavedSubagentModel,
} from './subagentModel';

function nativeMemoryProvider(value: unknown): string {
  return String(value || '').trim() || 'builtin';
}

export type NativeHermesMemoryState = {
  selected: string;
  installedProviders: string[];
  installed: boolean;
  available: boolean;
  availabilityReason: string | null;
  target: string;
  credentialStatus: 'not_required' | 'not_configured' | 'configured' | 'unknown';
  credentialSource: string | null;
  setupAction: string | null;
  historyDatabasePath: string;
  curatedMemoryEnabled: boolean;
  userProfileEnabled: boolean;
  database: null | { kind: 'sqlite'; path: string; exists: boolean; factCount: number };
};

export type NativeMainHonchoStatus = {
  selected: boolean;
  configurationStatus: 'not_configured' | 'configured';
  connectionStatus: 'not_configured' | 'not_checked' | 'configured_unreachable' | 'connected';
  availabilityReason: string | null;
  target: 'honcho_cloud' | 'honcho_self_hosted' | 'honcho_cloud_or_self_hosted_unresolved';
  credentialStatus: 'not_configured' | 'configured' | 'unknown';
  credentialSource: string | null;
  setupAction: string;
  statusAction: string;
};

export type NativeHermesMcpServer = {
  name: string;
  transport: string;
  enabled: boolean;
  auth: string | null;
  credentialStatus: 'not_required' | 'not_configured' | 'configured';
  toolFilter: string[];
};

export type NativeHermesProfileState = {
  name: string;
  description: string;
  soul: string;
  model: { provider: string; default: string };
  backgroundReview: {
    enabled: boolean;
    provider: string;
    model: string;
    maxInputTokens: number | null;
  };
  subagentModel: { provider: string; model: string };
  memory: NativeHermesMemoryState;
  honcho: NativeMainHonchoStatus | null;
  skills: Array<{ name: string; enabled: boolean }>;
  toolsets: Array<{ name: string; label?: string; description?: string; tool_count?: number; enabled: boolean }>;
  toolsetsPinned: boolean;
  mcpServers: NativeHermesMcpServer[];
  learning: {
    count: number;
    summary: string;
    buckets: Array<{
      label: string;
      date: string;
      nodes: Array<{ id: string; label: string; fullLabel: string; meta: string }>;
    }>;
    graph: {
      nodes: Array<Record<string, unknown>>;
      edges: Array<{ source: string; target: string }>;
      clusters: Array<Record<string, unknown>>;
      memory: Array<Record<string, unknown>>;
      stats: Record<string, unknown>;
    };
  };
};

export type HermesCardProfileBinding = {
  profile: string;
  mode: 'main' | 'delegate' | 'kanban';
};

export type HermesCardProfileReadback = {
  binding: HermesCardProfileBinding;
  desired: { subagentModel: SavedSubagentModel | null };
  native: NativeHermesProfileState;
  subagentModelMaterialization: 'not_saved' | 'materialized' | 'diverged';
  nativeApply: 'run_start';
  cardSaveMutatesNative: false;
};

export type HermesNativeCardOperation =
  | { method: 'profiles.configure'; params: Record<string, unknown> }
  | { method: 'learning.detail'; params: { id: string } }
  | { method: 'learning.edit'; params: { id: string; content: string } }
  | { method: 'skills.manage'; params: Record<string, unknown> }
  | { method: 'tools.configure'; params: Record<string, unknown> }
  | { method: 'toolsets.list'; params?: Record<string, unknown> }
  | { method: 'mcp.servers.list'; params?: Record<string, unknown> }
  | { method: 'mcp.servers.test'; params: { name: string } };

type RequestNative = typeof requestHermesNative;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].sort()
    : [];
}

export function projectHermesCardBinding(
  card: AgentCardInstance,
  _deck: Pick<DeckDocument, 'workspaceRoot'>,
): HermesCardProfileBinding {
  if (card.runtime.kind !== 'hermes') throw new Error('card_runtime_not_hermes');
  return {
    profile: String(card.runtime.profile || '').trim(),
    mode: card.runtime.mode,
  };
}

function safeMcpServer(value: unknown, enabledByName: Map<string, boolean>): NativeHermesMcpServer | null {
  const server = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const name = String(server.name || '').trim();
  if (!name) return null;
  const auth = String(server.auth || '').trim() || null;
  const tools = server.tools && typeof server.tools === 'object'
    ? server.tools as Record<string, unknown>
    : {};
  return {
    name,
    transport: String(server.transport || 'unknown'),
    enabled: enabledByName.get(name) ?? server.enabled !== false,
    auth,
    credentialStatus: auth === 'oauth'
      ? server.oauth_tokens_present === true ? 'configured' : 'not_configured'
      : auth ? 'configured' : 'not_required',
    toolFilter: strings(tools.include),
  };
}

function normalizeNative(
  profileValue: unknown,
  mcpValue: unknown,
  learningValue: unknown,
  learningGraphValue: unknown,
): NativeHermesProfileState {
  const profile = profileValue && typeof profileValue === 'object'
    ? profileValue as Record<string, unknown>
    : null;
  if (!profile || !String(profile.name || '').trim()) throw new Error('hermes_native_profile_read_invalid');
  const model = profile.model && typeof profile.model === 'object'
    ? profile.model as Record<string, unknown>
    : {};
  const backgroundReview = profile.background_review && typeof profile.background_review === 'object'
    ? profile.background_review as Record<string, unknown>
    : {};
  const subagentModel = profile.subagent_model && typeof profile.subagent_model === 'object'
    ? profile.subagent_model as Record<string, unknown>
    : {};
  const memory = profile.memory && typeof profile.memory === 'object'
    ? profile.memory as Record<string, unknown>
    : {};
  const selectedMemory = nativeMemoryProvider(memory.selected);
  const honcho = profile.honcho && typeof profile.honcho === 'object'
    ? profile.honcho as Record<string, unknown>
    : null;
  const database = memory.database && typeof memory.database === 'object'
    ? memory.database as Record<string, unknown>
    : null;
  const learning = learningValue && typeof learningValue === 'object'
    ? learningValue as Record<string, unknown>
    : {};
  const learningGraph = learningGraphValue && typeof learningGraphValue === 'object'
    ? learningGraphValue as Record<string, unknown>
    : {};
  const mcp = mcpValue && typeof mcpValue === 'object'
    ? mcpValue as Record<string, unknown>
    : {};
  const enabledByName = new Map<string, boolean>(
    (Array.isArray(profile.mcp_servers) ? profile.mcp_servers : [])
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => [String(item.name || ''), item.enabled !== false]),
  );
  return {
    name: String(profile.name),
    description: String(profile.description || ''),
    soul: String(profile.soul || ''),
    model: { provider: String(model.provider || ''), default: String(model.default || '') },
    backgroundReview: {
      enabled: backgroundReview.enabled !== false,
      provider: String(backgroundReview.provider || 'auto'),
      model: String(backgroundReview.model || ''),
      maxInputTokens: typeof backgroundReview.max_input_tokens === 'number'
        ? backgroundReview.max_input_tokens
        : null,
    },
    subagentModel: {
      provider: String(subagentModel.provider || ''),
      model: String(subagentModel.model || ''),
    },
    memory: {
      selected: selectedMemory,
      installedProviders: strings(memory.installed_providers),
      installed: selectedMemory === 'builtin' || memory.installed === true,
      available: selectedMemory === 'builtin' || memory.available === true,
      availabilityReason: String(memory.availability_reason || '').trim() || null,
      target: String(memory.target || 'unknown'),
      credentialStatus: ['not_required', 'not_configured', 'configured'].includes(
        String(memory.credential_status || ''),
      ) ? memory.credential_status as NativeHermesMemoryState['credentialStatus'] : 'unknown',
      credentialSource: String(memory.credential_source || '').trim() || null,
      setupAction: String(memory.setup_action || '').trim() || null,
      historyDatabasePath: String(memory.history_database_path || ''),
      curatedMemoryEnabled: memory.curated_memory_enabled !== false,
      userProfileEnabled: memory.user_profile_enabled !== false,
      database: database && String(database.kind || '') === 'sqlite'
        ? {
            kind: 'sqlite',
            path: String(database.path || ''),
            exists: database.exists === true,
            factCount: Number.isFinite(database.fact_count) ? Number(database.fact_count) : 0,
          }
        : null,
    },
    honcho: honcho ? {
      selected: honcho.selected === true,
      configurationStatus: honcho.configuration_status === 'configured'
        ? 'configured' : 'not_configured',
      connectionStatus: [
        'not_configured', 'not_checked', 'configured_unreachable', 'connected',
      ].includes(String(honcho.connection_status || ''))
        ? honcho.connection_status as NativeMainHonchoStatus['connectionStatus']
        : 'not_checked',
      availabilityReason: String(honcho.availability_reason || '').trim() || null,
      target: [
        'honcho_cloud', 'honcho_self_hosted', 'honcho_cloud_or_self_hosted_unresolved',
      ].includes(String(honcho.target || ''))
        ? honcho.target as NativeMainHonchoStatus['target']
        : 'honcho_cloud_or_self_hosted_unresolved',
      credentialStatus: ['not_configured', 'configured'].includes(
        String(honcho.credential_status || ''),
      ) ? honcho.credential_status as NativeMainHonchoStatus['credentialStatus'] : 'unknown',
      credentialSource: String(honcho.credential_source || '').trim() || null,
      setupAction: String(honcho.setup_action || ''),
      statusAction: String(honcho.status_action || ''),
    } : null,
    skills: Array.isArray(profile.skills)
      ? profile.skills.map((item: any) => ({ name: String(item?.name || ''), enabled: item?.enabled === true })).filter((item) => item.name)
      : [],
    toolsets: Array.isArray(profile.toolsets)
      ? profile.toolsets.map((item: any) => ({
        name: String(item?.name || ''),
        label: item?.label == null ? undefined : String(item.label),
        description: item?.description == null ? undefined : String(item.description),
        tool_count: typeof item?.tool_count === 'number' ? item.tool_count : undefined,
        enabled: item?.enabled === true,
      })).filter((item) => item.name)
      : [],
    toolsetsPinned: profile.toolsets_pinned === true,
    mcpServers: (Array.isArray(mcp.servers) ? mcp.servers : [])
      .map((item) => safeMcpServer(item, enabledByName))
      .filter((item): item is NativeHermesMcpServer => item !== null),
    learning: {
      count: Number.isFinite(learning.count) ? Number(learning.count) : 0,
      summary: String(learning.summary || ''),
      buckets: Array.isArray(learning.buckets) ? learning.buckets.map((bucket: any) => ({
        label: String(bucket?.label || ''),
        date: String(bucket?.date || ''),
        nodes: Array.isArray(bucket?.nodes) ? bucket.nodes.map((node: any) => ({
          id: String(node?.id || ''),
          label: String(node?.label || ''),
          fullLabel: String(node?.fullLabel || ''),
          meta: String(node?.meta || ''),
        })).filter((node: any) => node.id) : [],
      })) : [],
      graph: {
        nodes: Array.isArray(learningGraph.nodes)
          ? learningGraph.nodes.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          : [],
        edges: Array.isArray(learningGraph.edges)
          ? learningGraph.edges.map((item: any) => ({
            source: String(item?.source || ''), target: String(item?.target || ''),
          })).filter((item) => item.source && item.target)
          : [],
        clusters: Array.isArray(learningGraph.clusters)
          ? learningGraph.clusters.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          : [],
        memory: Array.isArray(learningGraph.memory)
          ? learningGraph.memory.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          : [],
        stats: learningGraph.stats && typeof learningGraph.stats === 'object'
          ? learningGraph.stats as Record<string, unknown>
          : {},
      },
    },
  };
}

async function readNativeProfile(
  binding: HermesCardProfileBinding,
  desiredSubagentModel: SavedSubagentModel | null,
  requestNative: RequestNative,
): Promise<HermesCardProfileReadback> {
  const profile = await requestNative('profiles.describe', {
    name: binding.profile,
    ...(binding.mode === 'main' ? { probe_honcho: true } : {}),
  });
  const mcp = await requestNative('mcp.servers.list', { profile: binding.profile });
  const [learning, learningGraph] = await Promise.all([
    requestNative('learning.frames', { cols: 60, rows: 18, frames: 2 }, binding.profile),
    requestNative('learning.graph', {}, binding.profile),
  ]);
  const native = normalizeNative(profile, mcp, learning, learningGraph);
  return {
    binding,
    desired: { subagentModel: desiredSubagentModel },
    native,
    subagentModelMaterialization: desiredSubagentModel === null
      ? 'not_saved'
      : sameNativeSubagentModel(
        profile?.subagent_model,
        toNativeSubagentModel(desiredSubagentModel),
      ) ? 'materialized' : 'diverged',
    nativeApply: 'run_start',
    cardSaveMutatesNative: false,
  };
}

export async function hydrateHermesCardProfile(
  card: AgentCardInstance,
  deck: Pick<DeckDocument, 'workspaceRoot'>,
  requestNative: RequestNative = requestHermesNative,
): Promise<HermesCardProfileReadback> {
  const binding = projectHermesCardBinding(card, deck);
  if (!binding.profile) throw new Error('hermes_profile_binding_required');
  const desiredSubagentModel = readSavedSubagentModel(card.runtimeOptions?.subagentModel);
  return readNativeProfile(binding, desiredSubagentModel, requestNative);
}

async function callBoundNativeOperation(
  binding: HermesCardProfileBinding,
  operation: HermesNativeCardOperation,
  requestNative: RequestNative,
): Promise<unknown> {
  const params = { ...(operation.params || {}) };
  if ('name' in params && operation.method !== 'mcp.servers.test') {
    throw new Error('hermes_native_profile_override_forbidden');
  }
  if (operation.method === 'profiles.configure') {
    return requestNative(operation.method, { ...params, name: binding.profile });
  }
  if (operation.method === 'skills.manage' || operation.method.startsWith('mcp.servers.')) {
    return requestNative(operation.method, { ...params, profile: binding.profile });
  }
  return requestNative(operation.method, params, binding.profile);
}

function assertNativeOperationResult(
  operation: HermesNativeCardOperation,
  value: unknown,
): void {
  if (!['profiles.configure', 'learning.detail', 'learning.edit'].includes(operation.method)) return;
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (result.ok === true) return;
  throw new Error(
    `hermes_native_${operation.method.replaceAll('.', '_')}_failed:${String(result.message || 'native operation rejected')}`,
  );
}

export async function invokeHermesNativeOperation(
  card: AgentCardInstance,
  deck: Pick<DeckDocument, 'workspaceRoot'>,
  operation: HermesNativeCardOperation,
  requestNative: RequestNative = requestHermesNative,
): Promise<{ result: unknown; readback: HermesCardProfileReadback }> {
  const binding = projectHermesCardBinding(card, deck);
  if (!binding.profile) throw new Error('hermes_profile_binding_required');
  const result = await callBoundNativeOperation(binding, operation, requestNative);
  const readback = await readNativeProfile(
    binding,
    readSavedSubagentModel(card.runtimeOptions?.subagentModel),
    requestNative,
  );
  assertNativeOperationResult(operation, result);
  return { result, readback };
}
