import type { AgentCardRuntimeOptions } from '../types';
import {
  readSavedSubagentModel,
  toNativeSubagentModel,
  type NativeSubagentModel,
  type SavedSubagentModel,
} from './subagentModel';

export type SavedTeamConfig = NonNullable<AgentCardRuntimeOptions['team']>;

export type NativeTeamPolicy = {
  mode: 'auto';
  maxWorkers: 2 | 3 | 4;
  retryLimit: number;
  worker: NativeSubagentModel;
  lead: NativeSubagentModel;
};

const FIELDS = [
  'mode', 'maxWorkers', 'retryLimit', 'workerModel', 'leadModel',
] as const;
export function readSavedTeamConfig(value: unknown): SavedTeamConfig | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('card_team_config_invalid');
  }
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !FIELDS.includes(key as typeof FIELDS[number]))) {
    throw new Error('card_team_config_invalid');
  }
  const mode = String(item.mode || '').trim();
  const maxWorkers = Number(item.maxWorkers);
  const retryLimit = Number(item.retryLimit);
  if (
    !['off', 'auto'].includes(mode)
    || ![2, 3, 4].includes(maxWorkers)
    || !Number.isSafeInteger(retryLimit)
    || retryLimit < 0
    || retryLimit > 4
  ) {
    throw new Error('card_team_config_invalid');
  }
  const workerModel = readSavedSubagentModel(item.workerModel);
  const leadModel = readSavedSubagentModel(item.leadModel);
  if (!workerModel || !leadModel) {
    throw new Error('card_team_config_invalid');
  }
  return {
    mode: mode as SavedTeamConfig['mode'],
    maxWorkers: maxWorkers as SavedTeamConfig['maxWorkers'],
    retryLimit,
    workerModel,
    leadModel,
  };
}

export function toNativeTeamPolicy(saved: SavedTeamConfig): NativeTeamPolicy | null {
  if (saved.mode === 'off') return null;
  const native = (selection: SavedSubagentModel): NativeSubagentModel => (
    toNativeSubagentModel(selection)
  );
  return {
    mode: 'auto',
    maxWorkers: saved.maxWorkers,
    retryLimit: saved.retryLimit,
    worker: native(saved.workerModel),
    lead: native(saved.leadModel),
  };
}
