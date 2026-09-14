import type { AgentCardRuntimeOptions } from '../types';
import { resolveSavedHermesSubagent } from './providerSelection';

export type SavedSubagentModel = NonNullable<AgentCardRuntimeOptions['subagentModel']>;

export type NativeSubagentModel = {
  provider: string;
  model: string;
};

export function readSavedSubagentModel(value: unknown): SavedSubagentModel | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('card_subagent_model_invalid');
  }
  const item = value as Record<string, unknown>;
  const fields = ['provider', 'accessMode', 'modelKey', 'providerModelId'];
  if (Object.keys(item).some((key) => !fields.includes(key))) {
    throw new Error('card_subagent_model_invalid');
  }
  const provider = String(item.provider || '').trim();
  const accessMode = String(item.accessMode || '').trim();
  const modelKey = String(item.modelKey || '').trim();
  const providerModelId = String(item.providerModelId || '').trim();
  if (!provider || !modelKey || !providerModelId || ![
    'chatgpt-account', 'openai-api', 'openrouter-api',
  ].includes(accessMode)) {
    throw new Error('card_subagent_model_invalid');
  }
  const saved = {
    provider,
    accessMode: accessMode as SavedSubagentModel['accessMode'],
    modelKey,
    providerModelId,
  };
  resolveSavedHermesSubagent(saved);
  return saved;
}

export function toNativeSubagentModel(saved: SavedSubagentModel): NativeSubagentModel {
  const resolved = resolveSavedHermesSubagent(saved);
  return {
    provider: resolved.provider,
    model: resolved.model,
  };
}

export function sameNativeSubagentModel(
  value: unknown,
  expected: NativeSubagentModel,
): boolean {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return String(item.provider || '').trim() === expected.provider
    && String(item.model || '').trim() === expected.model;
}
