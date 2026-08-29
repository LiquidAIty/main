import type { AgentCardRuntimeOptions } from '../types';

export type SavedSubagentModel = NonNullable<AgentCardRuntimeOptions['subagentModel']>;

export type NativeSubagentModel = {
  provider: string;
  model: string;
};

export const HERMES_BACKGROUND_REVIEW_MAX_INPUT_TOKENS = 120_000;

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
  return {
    provider,
    accessMode: accessMode as SavedSubagentModel['accessMode'],
    modelKey,
    providerModelId,
  };
}

export function toNativeSubagentModel(saved: SavedSubagentModel): NativeSubagentModel {
  return {
    provider: saved.provider === 'openai' && saved.accessMode === 'chatgpt-account'
      ? 'openai-codex'
      : saved.provider,
    model: saved.providerModelId,
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
