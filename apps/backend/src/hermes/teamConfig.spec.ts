import { describe, expect, it } from 'vitest';

import { readSavedTeamConfig, toNativeTeamPolicy } from './teamConfig';

const model = (providerModelId: string) => ({
  provider: 'openai',
  accessMode: 'chatgpt-account' as const,
  modelKey: providerModelId,
  providerModelId,
});

describe('saved Card Team configuration', () => {
  it('validates the exact Card contract and projects native provider identities', () => {
    const saved = readSavedTeamConfig({
      mode: 'auto', maxWorkers: 3, retryLimit: 2,
      workerModel: model('gpt-5.6-luna'),
      leadModel: model('gpt-5.6-terra'),
    });
    expect(saved).not.toBeNull();
    expect(toNativeTeamPolicy(saved!)).toEqual({
      mode: 'auto', maxWorkers: 3, retryLimit: 2,
      worker: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
      lead: { provider: 'openai-codex', model: 'gpt-5.6-terra' },
    });
  });

  it('keeps Off durable without projecting native Team authority', () => {
    const saved = readSavedTeamConfig({
      mode: 'off', maxWorkers: 2, retryLimit: 0,
      workerModel: model('worker'), leadModel: model('lead'),
    });
    expect(toNativeTeamPolicy(saved!)).toBeNull();
  });

  it.each([
    { mode: 'saved-profile', maxWorkers: 2, retryLimit: 0 },
    { mode: 'auto', maxWorkers: 5, retryLimit: 0 },
    { mode: 'auto', maxWorkers: 2, retryLimit: 5 },
  ])('rejects an unsupported or unreceipted field value', (bad) => {
    expect(() => readSavedTeamConfig({
      ...bad, workerModel: model('worker'), leadModel: model('lead'),
    })).toThrow('card_team_config_invalid');
  });
});
