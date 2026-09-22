import type { AgentCardInstance, DeckDocument } from '../types';
import { readSavedSubagentModel, type SavedSubagentModel } from './subagentModel';

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
  skills: Array<{ name: string; enabled: boolean }>;
  toolsets: Array<{ name: string; label?: string; description?: string; tool_count?: number; enabled: boolean }>;
  toolsetsPinned: boolean;
  mcpServers: NativeHermesMcpServer[];
  learning: {
    count: number;
    summary: string[];
    buckets: Array<{
      index: number;
      label: string;
      date: string;
      skills: number;
      memories: number;
      total: number;
      category: string | null;
      color: string | null;
      nodes: Array<{
        id: string;
        glyph: string;
        label: string;
        fullLabel: string;
        meta: string;
        body: string;
        style: string;
      }>;
    }>;
  };
};

export type HermesCardProfileBinding = {
  profile: string;
  mode: 'main' | 'delegate' | 'kanban' | 'magentic_one';
};

export type HermesCardProfileReadback = {
  binding: HermesCardProfileBinding;
  desired: { subagentModel: SavedSubagentModel | null };
  native: NativeHermesProfileState;
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

export type RequestHermesNative = (
  method: string,
  params?: Record<string, unknown>,
  profile?: string,
) => Promise<any>;

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
): NativeHermesProfileState {
  const profile = profileValue && typeof profileValue === 'object'
    ? profileValue as Record<string, unknown>
    : null;
  if (!profile || !String(profile.name || '').trim()) throw new Error('hermes_native_profile_read_invalid');
  const model = profile.model && typeof profile.model === 'object'
    ? profile.model as Record<string, unknown>
    : {};
  const learning = learningValue && typeof learningValue === 'object'
    ? learningValue as Record<string, unknown>
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
      summary: Array.isArray(learning.summary)
        ? learning.summary.map((item) => String(item || '')).filter(Boolean)
        : [],
      buckets: Array.isArray(learning.buckets) ? learning.buckets.map((bucket: any) => ({
        index: Number.isFinite(bucket?.index) ? Number(bucket.index) : 0,
        label: String(bucket?.label || ''),
        date: String(bucket?.date || ''),
        skills: Number.isFinite(bucket?.skills) ? Number(bucket.skills) : 0,
        memories: Number.isFinite(bucket?.memories) ? Number(bucket.memories) : 0,
        total: Number.isFinite(bucket?.total) ? Number(bucket.total) : 0,
        category: bucket?.category == null ? null : String(bucket.category),
        color: bucket?.color == null ? null : String(bucket.color),
        nodes: Array.isArray(bucket?.nodes) ? bucket.nodes.map((node: any) => ({
          id: String(node?.id || ''),
          glyph: String(node?.glyph || ''),
          label: String(node?.label || ''),
          fullLabel: String(node?.fullLabel || ''),
          meta: String(node?.meta || ''),
          body: String(node?.body || ''),
          style: String(node?.style || ''),
        })).filter((node: any) => node.id) : [],
      })) : [],
    },
  };
}

async function readNativeProfile(
  binding: HermesCardProfileBinding,
  desiredSubagentModel: SavedSubagentModel | null,
  requestNative: RequestHermesNative,
): Promise<HermesCardProfileReadback> {
  const profile = await requestNative('profiles.describe', { name: binding.profile });
  const mcp = await requestNative('mcp.servers.list', { profile: binding.profile });
  const learning = await requestNative(
    'learning.frames',
    { cols: 60, rows: 18, frames: 2 },
    binding.profile,
  );
  const native = normalizeNative(profile, mcp, learning);
  return {
    binding,
    desired: { subagentModel: desiredSubagentModel },
    native,
    nativeApply: 'run_start',
    cardSaveMutatesNative: false,
  };
}

export async function hydrateHermesCardProfile(
  card: AgentCardInstance,
  deck: Pick<DeckDocument, 'workspaceRoot'>,
  requestNative: RequestHermesNative,
): Promise<HermesCardProfileReadback> {
  const binding = projectHermesCardBinding(card, deck);
  if (!binding.profile) throw new Error('hermes_profile_binding_required');
  const desiredSubagentModel = readSavedSubagentModel(card.runtimeOptions?.subagentModel);
  return readNativeProfile(binding, desiredSubagentModel, requestNative);
}

async function callBoundNativeOperation(
  binding: HermesCardProfileBinding,
  operation: HermesNativeCardOperation,
  requestNative: RequestHermesNative,
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
  requestNative: RequestHermesNative,
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
