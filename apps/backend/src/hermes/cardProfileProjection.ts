import type { AgentCardInstance, DeckDocument } from '../types';
import { requestHermesExtension } from './mainAdapter';

export type HermesCardFieldOwner =
  | 'native-hermes-profile'
  | 'native-hermes-runtime'
  | 'liquidaity-card'
  | 'liquidaity-run';

export type HermesCardFieldClassification = {
  field: string;
  classification: 'binding' | 'liquidaity-owned' | 'native-editable' | 'native-read-only' | 'run-only';
  owner: HermesCardFieldOwner;
  nativeTarget: string | null;
  note: string;
};

export const HERMES_CARD_FIELD_MAP: readonly HermesCardFieldClassification[] = [
  { field: 'cardId/revision', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Durable Card identity never derives from a profile.' },
  { field: 'title/subtitle', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'LiquidAIty presentation only.' },
  { field: 'runtime.profile', classification: 'binding', owner: 'liquidaity-card', nativeTarget: 'existing profile name', note: 'Binds the Card to one existing profile without configuring it.' },
  { field: 'runtime.mode', classification: 'binding', owner: 'liquidaity-card', nativeTarget: 'native invocation entrance', note: 'Selects main, delegate, or kanban for this Card.' },
  { field: 'Card Prompt', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Reusable Card-to-Card contract only; never SOUL.md.' },
  { field: 'profile Role/description', classification: 'native-editable', owner: 'native-hermes-profile', nativeTarget: 'profiles.configure(description)', note: 'Explicit native Apply only; never saved in the Card.' },
  { field: 'Soul', classification: 'native-editable', owner: 'native-hermes-profile', nativeTarget: 'profiles.configure(soul)', note: 'Explicit native Apply replaces the profile SOUL.md through Hermes.' },
  { field: 'dynamicInput', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'ACP prompt', note: 'One transient Task; never persisted into native profile state.' },
  { field: 'outputContract', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'LiquidAIty result and presentation contract.' },
  { field: 'profile provider/model', classification: 'native-editable', owner: 'native-hermes-profile', nativeTarget: 'profiles.configure(provider, model)', note: 'Explicit native Apply only; Card save never writes native model state.' },
  { field: 'provider authentication', classification: 'native-read-only', owner: 'native-hermes-profile', nativeTarget: 'native credential managers', note: 'Status only; credentials never enter Card JSON.' },
  { field: 'reasoning/temperature/token/turn limits', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'transient invocation options', note: 'Never written to profile files.' },
  { field: 'skills', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card invocation grant IDs only; native skill state remains read-only.' },
  { field: 'toolsets', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card invocation grant IDs only; native toolsets remain read-only.' },
  { field: 'nativeTools', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card grant ceiling only.' },
  { field: 'mcpConnectionIds', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card authorization references only; native MCP configuration remains read-only.' },
  { field: 'tools/Card grants', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Authorization ceiling; native discovery may only reduce it.' },
  { field: 'knowledge/parentGraphId/data anchors', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'bounded invocation context', note: 'Native IDs are resolved for one Task and never copied into Hermes memory.' },
  { field: 'native memory/learned skill content', classification: 'native-editable', owner: 'native-hermes-profile', nativeTarget: 'learning.detail/edit', note: 'Explicit native node edit through Hermes; never copied into Card state.' },
  { field: 'native skill enablement', classification: 'native-editable', owner: 'native-hermes-profile', nativeTarget: 'profiles.configure(disabled_skills)', note: 'Replace the native disabled set through one explicit Apply.' },
  { field: 'native toolset enablement', classification: 'native-editable', owner: 'native-hermes-profile', nativeTarget: 'profiles.configure(enabled_toolsets)', note: 'Replace the native enabled set through one explicit Apply.' },
  { field: 'native MCP enablement', classification: 'native-editable', owner: 'native-hermes-profile', nativeTarget: 'profiles.configure(enabled_mcp_servers)', note: 'Replace native connection enablement through one explicit Apply; filters and secrets remain native read-only.' },
  { field: 'workspace', classification: 'run-only', owner: 'native-hermes-runtime', nativeTarget: 'launch cwd', note: 'Supplied at launch; not profile identity.' },
  { field: 'wires', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Saved Card invocation authority.' },
  { field: 'Card Run', classification: 'liquidaity-owned', owner: 'liquidaity-run', nativeTarget: 'native execution correlation', note: 'One durable product Run correlated to one native execution.' },
  { field: 'Kanban children/workers', classification: 'native-read-only', owner: 'native-hermes-runtime', nativeTarget: 'native Kanban task graph', note: 'Native runtime state; never permanent Card identity.' },
] as const;

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
  cardGrants: string[];
  nativeTools: string[];
  workspace: string | null;
};

export type HermesCardProfileReadback = {
  fieldMap: readonly HermesCardFieldClassification[];
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
  deck: Pick<DeckDocument, 'workspaceRoot'>,
): HermesCardProfileBinding {
  if (card.runtime.kind !== 'hermes') throw new Error('card_runtime_not_hermes');
  return {
    profile: String(card.runtime.profile || '').trim(),
    mode: card.runtime.mode,
    cardGrants: strings(card.runtimeOptions?.tools || card.tools),
    nativeTools: strings(card.runtimeOptions?.nativeTools),
    workspace: String(deck.workspaceRoot || '').trim() || null,
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
    fieldMap: HERMES_CARD_FIELD_MAP,
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

export function filterEffectiveHermesTools(discovered: string[], cardGrants: string[]): string[] {
  const granted = new Set(strings(cardGrants));
  return strings(discovered).filter((name) => granted.has(name));
}
