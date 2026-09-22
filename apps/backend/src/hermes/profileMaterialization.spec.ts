import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  materializeHermesProfileSelections,
  toNativeSubagentTypeConfig,
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
    toolsets: [],
    mcp_servers: [],
    subagent_model: { provider: 'openai-codex', model: 'gpt-5.6-luna' },
    background_review: { enabled: false, provider: 'openai', model: 'gpt-5.6-sol' },
    ...overrides,
  };
}

describe('materializeHermesProfileSelections', () => {
  it('compiles the exact saved Card prompt into the sole Hermes SOUL authority', () => {
    const source = readFileSync(resolve(__dirname, 'profileMaterialization.ts'), 'utf8');
    expect(source).toContain('del agent["system_prompt"]');
    expect(source).toContain('del cfg["mcp_servers"]');
    expect(source).toContain('soul_path.write_bytes(instructions.encode("utf-8"))');
    expect(source).toContain('soul_path.read_bytes() != instructions.encode("utf-8")');
    expect(source).not.toContain('agent["system_prompt"] = instructions');
    expect(source).not.toContain('DEFAULT_SOUL_MD');
    expect(source).not.toContain('is_legacy_template_soul');
  });

  it.each([
    ['none', { maxSpawnDepth: 1, orchestratorEnabled: false, delegationDisabled: true }],
    ['leaf', { maxSpawnDepth: 1, orchestratorEnabled: false, delegationDisabled: false }],
    ['recursive', { maxSpawnDepth: 2, orchestratorEnabled: true, delegationDisabled: false }],
  ] as const)('maps %s to the exact native delegation gate', (subagentType, expected) => {
    expect(toNativeSubagentTypeConfig(subagentType)).toEqual(expected);
  });

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

  it('pins saved native toolsets plus the Card plugin toolset and reads them back', async () => {
    const available = [
      { name: 'memory', enabled: true },
      { name: 'file', enabled: true },
      { name: 'terminal', enabled: true },
      { name: 'card-tools', enabled: false },
    ];
    const readNative = vi.fn()
      .mockResolvedValueOnce(nativeProfile({ toolsets: available }))
      .mockResolvedValueOnce(nativeProfile({
        toolsets: available.map((toolset) => ({
          ...toolset,
          enabled: ['card-tools', 'file', 'memory'].includes(toolset.name),
        })),
      }));
    const configureToolsets = vi.fn(async () => ({ ok: true, applied: { toolsets: true } }));

    await materializeHermesProfileSelections(
      selection({
        nativeTools: ['memory'],
        toolsets: ['file'],
        requiredToolsets: ['card-tools'],
      }),
      readNative,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      configureToolsets,
    );

    expect(configureToolsets).toHaveBeenCalledExactlyOnceWith(
      'builder',
      ['card-tools', 'file', 'memory'],
    );
    expect(readNative).toHaveBeenCalledTimes(2);
  });

  it('fails before inference when a saved native toolset is not installed', async () => {
    await expect(materializeHermesProfileSelections(
      selection({ toolsets: ['missing-toolset'] }),
      vi.fn(async () => nativeProfile({ toolsets: [{ name: 'file', enabled: true }] })),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )).rejects.toThrow('hermes_native_toolset_missing:builder:missing-toolset');
  });

  it('enables exactly the saved MCP servers through the public profile contract', async () => {
    const readNative = vi.fn()
      .mockResolvedValueOnce(nativeProfile({
        mcp_servers: [
          { name: 'graphiti', enabled: false },
          { name: 'cbm', enabled: true },
        ],
      }))
      .mockResolvedValueOnce(nativeProfile({
        mcp_servers: [
          { name: 'graphiti', enabled: true },
          { name: 'cbm', enabled: false },
        ],
      }));
    const configureMcpServers = vi.fn(async () => ({
      ok: true,
      applied: { mcp_servers: true },
    }));

    const result = await materializeHermesProfileSelections(
      selection({ mcpConnectionIds: ['graphiti'] }),
      readNative,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      configureMcpServers,
    );

    expect(configureMcpServers).toHaveBeenCalledExactlyOnceWith('builder', ['graphiti']);
    expect(readNative).toHaveBeenCalledTimes(2);
    expect(result.unavailableMcpServerReasons).toEqual({});
  });

  it('reports a required MCP server that stock Hermes could not find without broadening the profile', async () => {
    const readNative = vi.fn()
      .mockResolvedValueOnce(nativeProfile({ mcp_servers: [] }))
      .mockResolvedValueOnce(nativeProfile({ mcp_servers: [] }));
    const configureMcpServers = vi.fn(async () => ({
      ok: true,
      applied: { mcp_servers: true },
    }));

    const result = await materializeHermesProfileSelections(
      selection({ mcpConnectionIds: ['graphiti'] }),
      readNative,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      configureMcpServers,
    );

    expect(result.unavailableMcpServerReasons).toEqual({
      graphiti: 'mcp_server_not_configured',
    });
  });

  it('pins an explicitly empty Card toolset selection and reads it back', async () => {
    const readNative = vi.fn()
      .mockResolvedValueOnce(nativeProfile({
        toolsets: [{ name: 'web', enabled: true }],
      }))
      .mockResolvedValueOnce(nativeProfile({
        toolsets: [{ name: 'web', enabled: false }],
      }));
    const configureToolsets = vi.fn(async () => ({ ok: true, applied: { toolsets: true } }));

    await materializeHermesProfileSelections(
      selection(),
      readNative,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      configureToolsets,
    );

    expect(configureToolsets).toHaveBeenCalledExactlyOnceWith('builder', []);
    expect(readNative).toHaveBeenCalledTimes(2);
  });

  it('leaves delegation config untouched when the saved subagent type is absent', async () => {
    const configureSubagentType = vi.fn(async () => undefined);

    await materializeHermesProfileSelections(
      selection(),
      vi.fn(async () => nativeProfile()),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      configureSubagentType,
    );

    expect(configureSubagentType).not.toHaveBeenCalled();
  });

  it('materializes the structural Team task mode only when the saved Card supplies it', async () => {
    const configureTaskMode = vi.fn(async () => undefined);

    await materializeHermesProfileSelections(
      selection({ taskMode: 'team' }),
      vi.fn(async () => nativeProfile()),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      configureTaskMode,
    );

    expect(configureTaskMode).toHaveBeenCalledExactlyOnceWith('builder', 'team');
  });

  it('removes only the structural Team marker when saved Card authority says ordinary', async () => {
    const configureTaskMode = vi.fn(async () => undefined);

    await materializeHermesProfileSelections(
      selection({ taskMode: null }),
      vi.fn(async () => nativeProfile()),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      configureTaskMode,
    );

    expect(configureTaskMode).toHaveBeenCalledExactlyOnceWith('builder', null);
  });

  it.each(['leaf', 'recursive'] as const)(
    'requires delegation through ordinary toolset materialization before applying %s depth',
    async (subagentType) => {
      const calls: string[] = [];
      const available = [
        { name: 'memory', enabled: true },
        { name: 'delegation', enabled: false },
      ];
      const readNative = vi.fn()
        .mockResolvedValueOnce(nativeProfile({ toolsets: available }))
        .mockResolvedValueOnce(nativeProfile({
          toolsets: available.map((toolset) => ({ ...toolset, enabled: true })),
        }));
      const configureToolsets = vi.fn(async () => {
        calls.push('toolsets');
        return { ok: true, applied: { toolsets: true } };
      });
      const configureSubagentType = vi.fn(async () => {
        calls.push('subagentType');
      });

      await materializeHermesProfileSelections(
        selection({ subagentType, toolsets: ['memory'] }),
        readNative,
        vi.fn(),
        vi.fn(),
        vi.fn(),
        configureToolsets,
        vi.fn(),
        configureSubagentType,
      );

      expect(configureToolsets).toHaveBeenCalledExactlyOnceWith(
        'builder',
        ['delegation', 'memory'],
      );
      expect(configureSubagentType).toHaveBeenCalledExactlyOnceWith('builder', subagentType);
      expect(calls).toEqual(['toolsets', 'subagentType']);
    },
  );

  it('applies explicit none after ordinary toolset materialization without requiring delegation', async () => {
    const calls: string[] = [];
    const available = [
      { name: 'memory', enabled: true },
      { name: 'delegation', enabled: true },
    ];
    const readNative = vi.fn()
      .mockResolvedValueOnce(nativeProfile({ toolsets: available }))
      .mockResolvedValueOnce(nativeProfile({
        toolsets: available.map((toolset) => ({
          ...toolset,
          enabled: toolset.name === 'memory',
        })),
      }));
    const configureToolsets = vi.fn(async () => {
      calls.push('toolsets');
      return { ok: true, applied: { toolsets: true } };
    });
    const configureSubagentType = vi.fn(async () => {
      calls.push('subagentType');
    });

    await materializeHermesProfileSelections(
      selection({ subagentType: 'none', toolsets: ['memory'] }),
      readNative,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      configureToolsets,
      vi.fn(),
      configureSubagentType,
    );

    expect(configureToolsets).toHaveBeenCalledExactlyOnceWith('builder', ['memory']);
    expect(configureSubagentType).toHaveBeenCalledExactlyOnceWith('builder', 'none');
    expect(calls).toEqual(['toolsets', 'subagentType']);
  });
});
