import { describe, expect, it, vi } from 'vitest';
import {
  materializeHermesProfileSelections,
  type HermesProfileSelection,
} from './profileMaterialization';

const savedSubagent = {
  provider: 'openai',
  accessMode: 'chatgpt-account' as const,
  modelKey: 'gpt-5.6-luna',
  providerModelId: 'gpt-5.6-luna',
};

function selection(overrides: Partial<HermesProfileSelection> = {}): HermesProfileSelection {
  return {
    runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
    provider: 'openai',
    accessMode: 'chatgpt-account',
    modelKey: 'gpt-5.6-sol',
    providerModelId: 'gpt-5.6-sol',
    openaiRuntime: 'codex_app_server',
    skills: [],
    ...overrides,
  };
}

function nativeProfile(overrides: Record<string, unknown> = {}) {
  return {
    name: 'builder',
    model: { provider: 'openai-codex', default: 'gpt-5.6-sol' },
    skills: [{ name: 'hermes-agent', enabled: true }],
    subagent_model: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
    background_review: { enabled: false, provider: 'openai', model: 'gpt-5.6-sol' },
    ...overrides,
  };
}

describe('materializeHermesProfileSelections', () => {
  it('preserves native background review while applying the saved subagent selection', async () => {
    const profile = nativeProfile({
      subagent_model: { provider: '', model: '' },
      background_review: { enabled: true, provider: 'openai', model: 'gpt-5.6-sol' },
    });
    const configureSubagent = vi.fn(async () => undefined);
    const configureParent = vi.fn(async () => ({ ok: true, applied: { model: true } }));
    const configureSkills = vi.fn(async () => ({ ok: true, applied: { skills: true } }));

    const result = await materializeHermesProfileSelections(
      selection({ subagentModel: savedSubagent }),
      vi.fn(async () => profile),
      configureSubagent,
      configureParent,
      configureSkills,
    );

    expect(configureSubagent).toHaveBeenCalledExactlyOnceWith('builder', {
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
    });
    expect(configureParent).not.toHaveBeenCalled();
    expect(configureSkills).not.toHaveBeenCalled();
    expect(result.native.background_review).toEqual(profile.background_review);
    expect(result.effectiveSubagentModel).toEqual({
      desired: savedSubagent,
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      fallbackOccurred: false,
      fallbackReason: null,
    });
  });

  it('applies and rereads a mismatched saved parent model before returning', async () => {
    const readNative = vi.fn()
      .mockResolvedValueOnce(nativeProfile({ model: { provider: '', default: '' } }))
      .mockResolvedValueOnce(nativeProfile());
    const configureParent = vi.fn(async () => ({ ok: true, applied: { model: true } }));

    await materializeHermesProfileSelections(
      selection(),
      readNative,
      vi.fn(),
      configureParent,
      vi.fn(),
    );

    expect(configureParent).toHaveBeenCalledExactlyOnceWith('builder', {
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      apiMode: 'codex_app_server',
      openaiRuntime: 'codex_app_server',
    });
    expect(readNative).toHaveBeenCalledTimes(2);
  });

  it('enables only selected installed skills plus the native essential skill', async () => {
    const readNative = vi.fn()
      .mockResolvedValueOnce(nativeProfile({
        skills: [
          { name: 'hermes-agent', enabled: true },
          { name: 'grounded-citations', enabled: true },
          { name: 'browser', enabled: true },
        ],
      }))
      .mockResolvedValueOnce(nativeProfile({
        skills: [
          { name: 'hermes-agent', enabled: true },
          { name: 'grounded-citations', enabled: true },
          { name: 'browser', enabled: false },
        ],
      }));
    const configureSkills = vi.fn(async () => ({ ok: true, applied: { skills: true } }));

    await materializeHermesProfileSelections(
      selection({ skills: ['grounded-citations'] }),
      readNative,
      vi.fn(),
      vi.fn(),
      configureSkills,
    );

    expect(configureSkills).toHaveBeenCalledExactlyOnceWith('builder', ['browser']);
    expect(readNative).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the saved native profile is missing', async () => {
    const readNative = vi.fn(async () => {
      throw new Error("native profile 'builder' not found");
    });

    await expect(materializeHermesProfileSelections(
      selection(),
      readNative,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )).rejects.toThrow('hermes_native_profile_missing:builder');
  });

  it('fails closed when a selected saved skill is absent from the native profile', async () => {
    await expect(materializeHermesProfileSelections(
      selection({ skills: ['grounded-citations'] }),
      vi.fn(async () => nativeProfile()),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )).rejects.toThrow('hermes_native_skill_missing:builder:grounded-citations');
  });
});
