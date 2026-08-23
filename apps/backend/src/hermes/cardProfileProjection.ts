import { createHash } from 'crypto';

import type { AgentCardInstance, DeckDocument } from '../types';
import { listConfiguredModelOptions } from '../llm/models.config';
import { providerForHermes, requestHermesExtension } from './mainAdapter';

export type HermesCardFieldOwner =
  | 'native-hermes-profile'
  | 'native-hermes-runtime'
  | 'liquidaity-card'
  | 'liquidaity-run';

export type HermesCardFieldClassification = {
  field: string;
  classification: 'mapped' | 'liquidaity-owned' | 'run-only' | 'unsupported';
  owner: HermesCardFieldOwner;
  nativeTarget: string | null;
  note: string;
};

export const HERMES_CARD_FIELD_MAP: readonly HermesCardFieldClassification[] = [
  { field: 'cardId/revision', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Durable Card identity never derives from a profile.' },
  { field: 'title/subtitle', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Presentation only; profile identity is unchanged.' },
  { field: 'runtime.profile', classification: 'mapped', owner: 'native-hermes-profile', nativeTarget: 'profile name', note: 'Binds one existing native profile.' },
  { field: 'runtime.mode', classification: 'mapped', owner: 'native-hermes-runtime', nativeTarget: 'launch path', note: 'Selects main, delegate, or kanban without creating a profile.' },
  { field: 'role', classification: 'mapped', owner: 'native-hermes-profile', nativeTarget: 'description', note: 'Native Kanban-readable capability description.' },
  { field: 'prompt', classification: 'mapped', owner: 'native-hermes-profile', nativeTarget: 'SOUL.md', note: 'Persistent instructions; Hermes still assembles its own prompt.' },
  { field: 'dynamicInput', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'user prompt', note: 'Never persisted into profile instructions or memory.' },
  { field: 'outputContract', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Run validation and presentation contract.' },
  { field: 'provider/model/accessMode', classification: 'mapped', owner: 'native-hermes-profile', nativeTarget: 'model.provider/model.default', note: 'Credentials and Codex account authentication remain Hermes-owned.' },
  { field: 'reasoning/temperature/token/turn limits', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'invocation options', note: 'The verified native profile manager has no persistent keys for these settings.' },
  { field: 'skills', classification: 'mapped', owner: 'native-hermes-profile', nativeTarget: 'skills manager', note: 'Only skill identities are stored on the Card.' },
  { field: 'toolsets', classification: 'mapped', owner: 'native-hermes-profile', nativeTarget: 'enabled toolsets', note: 'Native Hermes resolves toolset contents.' },
  { field: 'nativeTools', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'session enabledTools', note: 'Individual native tools are a session projection, not a profile toolset.' },
  { field: 'mcpConnectionIds', classification: 'mapped', owner: 'native-hermes-profile', nativeTarget: 'MCP server entries', note: 'Native manager owns configuration, discovery, and authentication.' },
  { field: 'tools/Card grants', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Authorization ceiling; native filtering may only reduce it.' },
  { field: 'knowledge/parentGraphId/data anchors', classification: 'run-only', owner: 'liquidaity-run', nativeTarget: 'bounded invocation context', note: 'Never copied into SOUL.md or Hermes memory.' },
  { field: 'Hermes memory', classification: 'mapped', owner: 'native-hermes-profile', nativeTarget: 'native profile memory', note: 'The Card exposes policy/status only; contents remain native.' },
  { field: 'workspace', classification: 'run-only', owner: 'native-hermes-runtime', nativeTarget: 'launch cwd', note: 'The existing Project workspace is supplied at launch; it is not profile identity.' },
  { field: 'wires', classification: 'liquidaity-owned', owner: 'liquidaity-card', nativeTarget: null, note: 'Saved Card invocation authority.' },
  { field: 'Card Run', classification: 'liquidaity-owned', owner: 'liquidaity-run', nativeTarget: 'session/root correlation', note: 'One durable product Run correlated to native execution.' },
  { field: 'Kanban children/workers', classification: 'mapped', owner: 'native-hermes-runtime', nativeTarget: 'native Kanban task graph', note: 'Ephemeral Hermes run detail; never a permanent Card identity.' },
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

export type HermesCardNativeIntent = {
  profile: string;
  mode: 'main' | 'delegate' | 'kanban';
  description: string;
  soul: string;
  model: { provider: string; default: string } | null;
  enabledSkills: string[];
  enabledToolsets: string[];
  enabledMcpServers: string[];
  cardGrants: string[];
  nativeTools: string[];
  workspace: string | null;
};

export type HermesCardProfileProjection = {
  fieldMap: readonly HermesCardFieldClassification[];
  intent: HermesCardNativeIntent;
  native: NativeHermesProfileState;
  fingerprint: string;
  drift: { status: 'in_sync' | 'drifted'; fields: string[] };
  unsupported: Array<{ field: string; values: string[]; reason: string }>;
};

type RequestExtension = typeof requestHermesExtension;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].sort()
    : [];
}

function promptSection(prompt: string, tag: string): string {
  const marker = `[${tag}]`;
  const start = prompt.indexOf(marker);
  if (start < 0) return '';
  const contentStart = start + marker.length;
  const next = prompt.slice(contentStart).search(/\n\[(?:ROLE|GOAL|CONSTRAINTS|IO_SCHEMA|MEMORY_POLICY)\]\s*\n/);
  return prompt.slice(contentStart, next < 0 ? undefined : contentStart + next).trim();
}

function resolveNativeModel(card: AgentCardInstance): { provider: string; default: string } | null {
  const options = card.runtimeOptions || {};
  const provider = String(options.provider || '').trim();
  const modelKey = String(options.modelKey || '').trim();
  if (!provider || !modelKey) return null;
  const configured = listConfiguredModelOptions(
    process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.6-luna',
  ).find((model) => model.provider === provider && model.key === modelKey);
  return {
    provider: providerForHermes(provider, options.accessMode || undefined),
    default: configured?.providerModelId || modelKey,
  };
}

export function projectHermesCardIntent(
  card: AgentCardInstance,
  deck: Pick<DeckDocument, 'workspaceRoot'>,
): HermesCardNativeIntent {
  if (card.runtime.kind !== 'hermes') throw new Error('card_runtime_not_hermes');
  const prompt = String(card.prompt || '');
  return {
    profile: String(card.runtime.profile || '').trim(),
    mode: card.runtime.mode,
    description: String(card.role || '').trim() || promptSection(prompt, 'ROLE'),
    soul: prompt,
    model: resolveNativeModel(card),
    enabledSkills: strings(card.runtimeOptions?.skills),
    enabledToolsets: strings(card.runtimeOptions?.toolsets),
    enabledMcpServers: strings(card.runtimeOptions?.mcpConnectionIds),
    cardGrants: strings(card.runtimeOptions?.tools || card.tools),
    nativeTools: strings(card.runtimeOptions?.nativeTools),
    workspace: String(deck.workspaceRoot || '').trim() || null,
  };
}

function nativeComparable(native: NativeHermesProfileState) {
  return {
    description: native.description,
    soul: native.soul,
    model: native.model,
    enabledSkills: native.skills.filter((skill) => skill.enabled).map((skill) => skill.name).sort(),
    enabledToolsets: native.toolsetsPinned
      ? native.toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name).sort()
      : [],
    enabledMcpServers: native.mcpServers.filter((server) => server.enabled).map((server) => server.name).sort(),
  };
}

function fingerprintNative(native: NativeHermesProfileState): string {
  return createHash('sha256').update(JSON.stringify(nativeComparable(native))).digest('hex');
}

export function findHermesCardDrift(
  intent: HermesCardNativeIntent,
  native: NativeHermesProfileState,
): string[] {
  const actual = nativeComparable(native);
  const fields: string[] = [];
  if (intent.description !== actual.description) fields.push('role');
  if (intent.soul !== actual.soul) fields.push('prompt');
  if (intent.model && (
    intent.model.provider !== actual.model.provider
    || intent.model.default !== actual.model.default
  )) fields.push('provider/model/accessMode');
  if (JSON.stringify(intent.enabledSkills) !== JSON.stringify(actual.enabledSkills)) fields.push('skills');
  if (JSON.stringify(intent.enabledToolsets) !== JSON.stringify(actual.enabledToolsets)) fields.push('toolsets');
  if (JSON.stringify(intent.enabledMcpServers) !== JSON.stringify(actual.enabledMcpServers)) fields.push('mcpConnectionIds');
  return fields;
}

function validateNativeSelections(intent: HermesCardNativeIntent, native: NativeHermesProfileState) {
  const unsupported: HermesCardProfileProjection['unsupported'] = [];
  const checks: Array<[string, string[], string[]]> = [
    ['skills', intent.enabledSkills, native.skills.map((item) => item.name)],
    ['toolsets', intent.enabledToolsets, native.toolsets.map((item) => item.name)],
    ['mcpConnectionIds', intent.enabledMcpServers, native.mcpServers.map((item) => item.name)],
  ];
  for (const [field, wanted, available] of checks) {
    const availableSet = new Set(available);
    const missing = wanted.filter((name) => !availableSet.has(name));
    if (missing.length) {
      unsupported.push({ field, values: missing, reason: 'not present in the bound native Hermes profile' });
    }
  }
  if (!intent.model) {
    unsupported.push({ field: 'provider/model/accessMode', values: [], reason: 'Card provider and model are incomplete' });
  }
  if (intent.nativeTools.length) {
    unsupported.push({ field: 'nativeTools', values: intent.nativeTools, reason: 'Applied per Run because the native profile manager exposes toolsets, not individual native-tool pins' });
  }
  return unsupported;
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
): Promise<HermesCardProfileProjection> {
  const intent = projectHermesCardIntent(card, deck);
  if (!intent.profile) throw new Error('hermes_profile_binding_required');
  const native = normalizeNative(await requestExtension('_profile/read', { name: intent.profile }));
  const driftFields = findHermesCardDrift(intent, native);
  return {
    fieldMap: HERMES_CARD_FIELD_MAP,
    intent,
    native,
    fingerprint: fingerprintNative(native),
    drift: { status: driftFields.length ? 'drifted' : 'in_sync', fields: driftFields },
    unsupported: validateNativeSelections(intent, native),
  };
}

export class HermesNativeProfileDriftError extends Error {
  constructor() { super('hermes_native_profile_drift'); }
}

export async function applyHermesCardProfile(
  card: AgentCardInstance,
  deck: Pick<DeckDocument, 'workspaceRoot'>,
  expectedFingerprint: string,
  requestExtension: RequestExtension = requestHermesExtension,
): Promise<HermesCardProfileProjection & { mutated: boolean; applied: Record<string, boolean> }> {
  const before = await hydrateHermesCardProfile(card, deck, requestExtension);
  if (!expectedFingerprint || before.fingerprint !== expectedFingerprint) {
    throw new HermesNativeProfileDriftError();
  }
  const blocking = before.unsupported.filter((item) => item.field !== 'nativeTools');
  if (blocking.length) throw new Error(`hermes_native_selection_unsupported:${blocking.map((item) => item.field).join(',')}`);
  if (!before.drift.fields.length) return { ...before, mutated: false, applied: {} };

  const params: Record<string, unknown> = { name: before.intent.profile };
  if (before.drift.fields.includes('role')) params.description = before.intent.description;
  if (before.drift.fields.includes('prompt')) params.soul = before.intent.soul;
  if (before.drift.fields.includes('provider/model/accessMode') && before.intent.model) {
    params.provider = before.intent.model.provider;
    params.model = before.intent.model.default;
  }
  if (before.drift.fields.includes('skills')) {
    const enabled = new Set(before.intent.enabledSkills);
    params.disabledSkills = before.native.skills.map((skill) => skill.name).filter((name) => !enabled.has(name));
  }
  if (before.drift.fields.includes('toolsets')) params.enabledToolsets = before.intent.enabledToolsets;
  if (before.drift.fields.includes('mcpConnectionIds')) params.enabledMcpServers = before.intent.enabledMcpServers;

  const applied = await requestExtension('_profile/apply', params) as Record<string, unknown>;
  const after = await hydrateHermesCardProfile(card, deck, requestExtension);
  if (after.drift.fields.length) throw new Error(`hermes_native_profile_readback_mismatch:${after.drift.fields.join(',')}`);
  return {
    ...after,
    mutated: true,
    applied: applied.applied && typeof applied.applied === 'object'
      ? applied.applied as Record<string, boolean>
      : {},
  };
}

export function filterEffectiveHermesTools(discovered: string[], cardGrants: string[]): string[] {
  const granted = new Set(strings(cardGrants));
  return strings(discovered).filter((name) => granted.has(name));
}
