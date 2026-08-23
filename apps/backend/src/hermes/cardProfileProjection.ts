import type { AgentCardInstance, DeckDocument } from '../types';
import { requestHermesExtension } from './mainAdapter';

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
    summary: string;
    buckets: Array<{
      label: string;
      date: string;
      nodes: Array<{ id: string; label: string; fullLabel: string; meta: string; body: string }>;
    }>;
  };
};

export type HermesCardProfileBinding = {
  profile: string;
  mode: 'main' | 'delegate' | 'kanban';
};

export type HermesCardProfileReadback = {
  binding: HermesCardProfileBinding;
  native: NativeHermesProfileState;
  nativeApply: 'explicit';
  cardSaveMutatesNative: false;
};

export type HermesNativeApplyOperation =
  | { operation: 'profile.description.set'; value: string }
  | { operation: 'profile.soul.set'; value: string }
  | { operation: 'profile.model.set'; provider: string; model: string }
  | { operation: 'skills.disabled.replace'; values: string[] }
  | { operation: 'toolsets.enabled.replace'; values: string[] }
  | { operation: 'mcp.enabled.replace'; values: string[] }
  | { operation: 'learning.edit'; nodeId: string; content: string };

type RequestExtension = typeof requestHermesExtension;

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

function normalizeNative(value: unknown): NativeHermesProfileState {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const profile = root.profile && typeof root.profile === 'object'
    ? root.profile as Record<string, unknown>
    : null;
  if (!profile || !String(profile.name || '').trim()) throw new Error('hermes_native_profile_read_invalid');
  const model = profile.model && typeof profile.model === 'object'
    ? profile.model as Record<string, unknown>
    : {};
  const learning = profile.learning && typeof profile.learning === 'object'
    ? profile.learning as Record<string, unknown>
    : {};
  return {
    name: String(profile.name),
    description: String(profile.description || ''),
    soul: String(profile.soul || ''),
    model: { provider: String(model.provider || ''), default: String(model.default || '') },
    skills: Array.isArray(profile.skills) ? profile.skills.map((item: any) => ({ name: String(item?.name || ''), enabled: item?.enabled === true })).filter((item) => item.name) : [],
    toolsets: Array.isArray(profile.toolsets) ? profile.toolsets.map((item: any) => ({ name: String(item?.name || ''), label: item?.label == null ? undefined : String(item.label), description: item?.description == null ? undefined : String(item.description), tool_count: typeof item?.tool_count === 'number' ? item.tool_count : undefined, enabled: item?.enabled === true })).filter((item) => item.name) : [],
    toolsetsPinned: profile.toolsetsPinned === true,
    mcpServers: Array.isArray(profile.mcpServers) ? profile.mcpServers.map((item: any) => ({
      name: String(item?.name || ''),
      transport: String(item?.transport || 'unknown'),
      enabled: item?.enabled !== false,
      auth: item?.auth == null ? null : String(item.auth),
      credentialStatus: ['not_required', 'not_configured', 'configured'].includes(item?.credentialStatus) ? item.credentialStatus : 'not_configured',
      toolFilter: strings(item?.toolFilter),
    })).filter((item) => item.name) : [],
    learning: {
      count: Number.isFinite(learning.count) ? Number(learning.count) : 0,
      summary: String(learning.summary || ''),
      buckets: Array.isArray(learning.buckets) ? learning.buckets.map((rawBucket: any) => ({
        label: String(rawBucket?.label || ''),
        date: String(rawBucket?.date || ''),
        nodes: Array.isArray(rawBucket?.nodes) ? rawBucket.nodes.map((rawNode: any) => ({
          id: String(rawNode?.id || ''),
          label: String(rawNode?.label || ''),
          fullLabel: String(rawNode?.fullLabel || ''),
          meta: String(rawNode?.meta || ''),
          body: String(rawNode?.body || ''),
        })).filter((node: any) => node.id) : [],
      })) : [],
    },
  };
}

function readback(
  binding: HermesCardProfileBinding,
  value: unknown,
): HermesCardProfileReadback {
  return {
    binding,
    native: normalizeNative(value),
    nativeApply: 'explicit',
    cardSaveMutatesNative: false,
  };
}

export async function hydrateHermesCardProfile(
  card: AgentCardInstance,
  deck: Pick<DeckDocument, 'workspaceRoot'>,
  requestExtension: RequestExtension = requestHermesExtension,
): Promise<HermesCardProfileReadback> {
  const binding = projectHermesCardBinding(card, deck);
  if (!binding.profile) throw new Error('hermes_profile_binding_required');
  return readback(binding, await requestExtension('_profile/read', { name: binding.profile }));
}

export async function applyHermesNativeOperation(
  card: AgentCardInstance,
  deck: Pick<DeckDocument, 'workspaceRoot'>,
  operation: HermesNativeApplyOperation,
  requestExtension: RequestExtension = requestHermesExtension,
): Promise<HermesCardProfileReadback> {
  const binding = projectHermesCardBinding(card, deck);
  if (!binding.profile) throw new Error('hermes_profile_binding_required');
  const native = await requestExtension('_native/apply', {
    profile: binding.profile,
    ...operation,
  });
  return readback(binding, native);
}
