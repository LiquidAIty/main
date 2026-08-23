import type { AgentCardInstance, DeckDocument } from '../types';
import { requestHermesExtension } from './mainAdapter';

export type HermesCardFieldOwner =
  | 'native-hermes-profile'
  | 'native-hermes-runtime'
  | 'liquidaity-card'
  | 'liquidaity-run';

export type HermesCardFieldClassification = {
  field: string;
  classification: 'binding' | 'liquidaity-owned' | 'native-read-only' | 'run-only';
  owner: HermesCardFieldOwner;
  nativeTarget: string | null;
  note: string;
};

export const HERMES_CARD_FIELD_MAP: readonly HermesCardFieldClassification[] = [
  { field: 'cardId/revision', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Durable Card identity never derives from a profile.' },
  { field: 'title/subtitle', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'LiquidAIty presentation only.' },
  { field: 'runtime.profile', classification: 'binding', owner: 'liquidaity-card', nativeTarget: 'existing profile name', note: 'Binds the Card to one existing profile without configuring it.' },
  { field: 'runtime.mode', classification: 'binding', owner: 'liquidaity-card', nativeTarget: 'native invocation entrance', note: 'Selects main, delegate, or kanban for this Card.' },
  { field: 'role', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card-to-Card contract only; never profile description.' },
  { field: 'prompt', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card-to-Card contract only; never SOUL.md.' },
  { field: 'dynamicInput', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'ACP prompt', note: 'One transient Task; never persisted into native profile state.' },
  { field: 'outputContract', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'LiquidAIty result and presentation contract.' },
  { field: 'provider/model/accessMode', classification: 'native-read-only', owner: 'native-hermes-profile', nativeTarget: 'native model/provider/auth state', note: 'Read from the bound profile; Card save never writes it.' },
  { field: 'reasoning/temperature/token/turn limits', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'transient invocation options', note: 'Never written to profile files.' },
  { field: 'skills', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card invocation grant IDs only; native skill state remains read-only.' },
  { field: 'toolsets', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card invocation grant IDs only; native toolsets remain read-only.' },
  { field: 'nativeTools', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card grant ceiling only.' },
  { field: 'mcpConnectionIds', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Card authorization references only; native MCP configuration remains read-only.' },
  { field: 'tools/Card grants', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Authorization ceiling; native discovery may only reduce it.' },
  { field: 'knowledge/parentGraphId/data anchors', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'bounded invocation context', note: 'Native IDs are resolved for one Task and never copied into Hermes memory.' },
  { field: 'Hermes SOUL/memory/skills', classification: 'native-read-only', owner: 'native-hermes-profile', nativeTarget: 'native managers', note: 'Visible as native state only; never synchronized from a Card.' },
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
  readOnly: true;
};

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
  };
}

export async function hydrateHermesCardProfile(
  card: AgentCardInstance,
  deck: Pick<DeckDocument, 'workspaceRoot'>,
  requestExtension: RequestExtension = requestHermesExtension,
): Promise<HermesCardProfileReadback> {
  const binding = projectHermesCardBinding(card, deck);
  if (!binding.profile) throw new Error('hermes_profile_binding_required');
  const native = normalizeNative(await requestExtension('_profile/read', { name: binding.profile }));
  return {
    fieldMap: HERMES_CARD_FIELD_MAP,
    binding,
    native,
    readOnly: true,
  };
}

export function filterEffectiveHermesTools(discovered: string[], cardGrants: string[]): string[] {
  const granted = new Set(strings(cardGrants));
  return strings(discovered).filter((name) => granted.has(name));
}
