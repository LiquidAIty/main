import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from '../services/workspaceRoot';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import {
  sameNativeSubagentModel,
  toNativeSubagentModel,
  type NativeSubagentModel,
  type SavedSubagentModel,
} from './subagentModel';
import { resolveSavedHermesProvider } from './providerSelection';

// Hermes makes this operating-manual skill non-disableable. It is a native
// runtime prerequisite, not an additional saved Card capability.
const NATIVE_ESSENTIAL_SKILL_NAMES = new Set(['hermes-agent']);

export type HermesProfileSelection = {
  runtime: { kind: 'hermes'; mode: 'main' | 'delegate' | 'kanban' | 'magentic_one'; profile: string };
  provider: string;
  accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
  modelKey: string;
  providerModelId: string;
  openaiRuntime: 'codex_app_server' | null;
  skills?: string[];
  nativeTools?: string[];
  toolsets?: string[];
  requiredToolsets?: string[];
  mcpConnectionIds?: string[];
  subagentModel?: SavedSubagentModel;
  effectiveSubagentModel?: {
    desired: SavedSubagentModel;
    provider: string;
    model: string;
    fallbackOccurred: boolean;
    fallbackReason: string | null;
  };
};

export type HermesProfileMaterialization = {
  native: any;
  unavailableNativeToolReasons: Record<string, 'native_exact_filter_unavailable'>;
  unavailableMcpServerReasons: Record<string, 'mcp_server_not_configured'>;
  effectiveSubagentModel?: NonNullable<HermesProfileSelection['effectiveSubagentModel']>;
};

type NativeParentModel = {
  provider: string;
  model: string;
  apiMode: 'codex_app_server' | null;
  openaiRuntime: 'codex_app_server' | 'auto';
};

type ConfigureNativeSkills = (
  profile: string,
  disabledSkills: string[],
) => Promise<any>;

type ConfigureNativeToolsets = (
  profile: string,
  enabledToolsets: string[],
) => Promise<any>;

type ConfigureNativeMcpServers = (
  profile: string,
  enabledMcpServers: string[],
) => Promise<any>;

type ConfigureNativeSubagentModel = (
  profile: string,
  selection: NativeSubagentModel,
) => Promise<unknown>;

const HERMES_SUBAGENT_CONFIG_SCRIPT = [
  'import sys',
  'from hermes_cli.config import load_config, save_config',
  'cfg = load_config() or {}',
  'delegation = cfg.get("delegation")',
  'delegation = dict(delegation) if isinstance(delegation, dict) else {}',
  'provider = sys.argv[1]',
  'model = sys.argv[2]',
  'if delegation.get("provider") != provider or delegation.get("model") != model:',
  '    delegation["provider"] = provider',
  '    delegation["model"] = model',
  '    cfg["delegation"] = delegation',
  '    save_config(cfg)',
].join('\n');

const HERMES_CARD_MODEL_RUNTIME_SCRIPT = [
  'import sys',
  'from hermes_cli.config import load_config, save_config',
  'expected_provider = sys.argv[1]',
  'expected_model = sys.argv[2]',
  'expected_runtime = sys.argv[3]',
  'cfg = load_config() or {}',
  'changed = False',
  'model = cfg.get("model")',
  'model = dict(model) if isinstance(model, dict) else {}',
  'if (model.get("provider"), model.get("default"), model.get("openai_runtime")) != (expected_provider, expected_model, expected_runtime):',
  '    model["provider"] = expected_provider',
  '    model["default"] = expected_model',
  '    model["openai_runtime"] = expected_runtime',
  '    cfg["model"] = model',
  '    changed = True',
  'tools = cfg.get("tools")',
  'tools = dict(tools) if isinstance(tools, dict) else {}',
  'tool_search = tools.get("tool_search")',
  'tool_search = dict(tool_search) if isinstance(tool_search, dict) else {}',
  'if tool_search.get("enabled") != "off":',
  '    tool_search["enabled"] = "off"',
  '    tools["tool_search"] = tool_search',
  '    cfg["tools"] = tools',
  '    changed = True',
  'if changed:',
  '    save_config(cfg)',
  'readback = load_config() or {}',
  'actual = readback.get("model") or {}',
  'if (actual.get("provider"), actual.get("default"), actual.get("openai_runtime")) != (expected_provider, expected_model, expected_runtime):',
  '    raise SystemExit(3)',
  'actual_tool_search = ((readback.get("tools") or {}).get("tool_search") or {})',
  'if actual_tool_search.get("enabled") != "off":',
  '    raise SystemExit(4)',
].join('\n');

const HERMES_CARD_INSTRUCTIONS_SCRIPT = [
  'import sys',
  'from hermes_cli.config import load_config, save_config',
  'instructions = sys.stdin.read()',
  'if not instructions.strip():',
  '    raise SystemExit(2)',
  'cfg = load_config() or {}',
  'agent = cfg.get("agent")',
  'agent = dict(agent) if isinstance(agent, dict) else {}',
  'if agent.get("system_prompt") != instructions:',
  '    agent["system_prompt"] = instructions',
  '    cfg["agent"] = agent',
  '    save_config(cfg)',
  'readback = load_config() or {}',
  'if (readback.get("agent") or {}).get("system_prompt") != instructions:',
  '    raise SystemExit(3)',
].join('\n');

const HERMES_CARD_IDENTITY_SCRIPT = [
  'import sys',
  'from hermes_cli.profiles import create_profile, get_profile_dir, profile_exists, seed_profile_skills',
  'name = sys.argv[1]',
  'if not profile_exists(name):',
  '    profile_dir = create_profile(name=name, no_alias=True)',
  '    if seed_profile_skills(profile_dir) is None:',
  '        raise SystemExit(3)',
  'profile_dir = get_profile_dir(name)',
  'if not (profile_dir / "config.yaml").is_file():',
  '    raise SystemExit(4)',
].join('\n');

export async function configureHermesCardInstructions(
  profile: string,
  instructions: string,
): Promise<void> {
  const normalizedProfile = String(profile || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedProfile)) {
    throw new Error('hermes_runtime_profile_invalid');
  }
  if (!String(instructions || '').trim()) throw new Error('hermes_card_instructions_missing');
  const hermesRoot = path.join(resolveRepoRoot(), 'Hermes');
  const executable = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
  const hermesHome = path.join(hermesRoot, '.hermes');
  const profileHome = path.join(hermesHome, 'profiles', normalizedProfile);
  if (!existsSync(executable)) throw new Error(`hermes_repo_python_missing:${executable}`);
  const childEnv = withoutInternalMcpSecret(process.env);
  if (!existsSync(path.join(profileHome, 'config.yaml'))) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        executable,
        ['-X', 'utf8', '-c', HERMES_CARD_IDENTITY_SCRIPT, normalizedProfile],
        {
          cwd: hermesRoot,
          env: {
            ...childEnv,
            HERMES_HOME: hermesHome,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
          },
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore'],
        },
      );
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0 && signal === null) resolve();
        else reject(new Error('hermes_card_identity_materialization_failed'));
      });
    });
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable,
      ['-X', 'utf8', '-c', HERMES_CARD_INSTRUCTIONS_SCRIPT],
      {
        cwd: hermesRoot,
        env: {
          ...childEnv,
          HERMES_HOME: profileHome,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error('hermes_card_instructions_config_process_failed'));
    });
    child.stdin?.end(instructions, 'utf8');
  });
}

export async function configureHermesNativeSubagentModel(
  profile: string,
  selection: NativeSubagentModel,
): Promise<void> {
  const normalizedProfile = String(profile || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedProfile)) {
    throw new Error('hermes_runtime_profile_invalid');
  }
  const hermesRoot = path.join(resolveRepoRoot(), 'Hermes');
  const executable = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
  const profileHome = path.join(hermesRoot, '.hermes', 'profiles', normalizedProfile);
  if (!existsSync(executable)) throw new Error(`hermes_repo_python_missing:${executable}`);
  if (!existsSync(path.join(profileHome, 'config.yaml'))) {
    throw new Error(`hermes_native_profile_not_found:${normalizedProfile}`);
  }
  const childEnv = withoutInternalMcpSecret(process.env);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable,
      ['-X', 'utf8', '-c', HERMES_SUBAGENT_CONFIG_SCRIPT, selection.provider, selection.model],
      {
        cwd: hermesRoot,
        env: {
          ...childEnv,
          HERMES_HOME: profileHome,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error('hermes_native_subagent_config_process_failed'));
    });
  });
}

export async function configureHermesCardModelRuntime(
  profile: string,
  selection: {
    provider: string;
    model: string;
    openaiRuntime: 'codex_app_server' | 'auto';
  },
): Promise<void> {
  const normalizedProfile = String(profile || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedProfile)) {
    throw new Error('hermes_runtime_profile_invalid');
  }
  const hermesRoot = path.join(resolveRepoRoot(), 'Hermes');
  const executable = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
  const profileHome = path.join(hermesRoot, '.hermes', 'profiles', normalizedProfile);
  if (!existsSync(executable)) throw new Error(`hermes_repo_python_missing:${executable}`);
  if (!existsSync(path.join(profileHome, 'config.yaml'))) {
    throw new Error(`hermes_native_profile_not_found:${normalizedProfile}`);
  }
  const childEnv = withoutInternalMcpSecret(process.env);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        '-X', 'utf8', '-c', HERMES_CARD_MODEL_RUNTIME_SCRIPT,
        selection.provider, selection.model, selection.openaiRuntime,
      ],
      {
        cwd: hermesRoot,
        env: {
          ...childEnv,
          HERMES_HOME: profileHome,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error('hermes_card_model_runtime_config_process_failed'));
    });
  });
}

function toNativeParentModel(args: HermesProfileSelection): NativeParentModel {
  const resolved = resolveSavedHermesProvider({
    provider: args.provider,
    accessMode: args.accessMode,
    modelKey: args.modelKey,
    providerModelId: args.providerModelId,
    openaiRuntime: args.openaiRuntime,
  });
  return {
    provider: resolved.provider,
    model: resolved.model,
    apiMode: resolved.apiMode,
    openaiRuntime: resolved.profileOpenaiRuntime,
  };
}

function sameNativeParentModel(value: unknown, expected: NativeParentModel): boolean {
  const model = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return String(model.provider || '').trim() === expected.provider
    && String(model.default || '').trim() === expected.model;
}

function missingNativeProfile(error: unknown, profile: string): boolean {
  return String(error instanceof Error ? error.message : error)
    .includes(`profile '${profile}' not found`);
}

export async function materializeHermesProfileSelections(
  args: HermesProfileSelection,
  readNativeProfile: (profile: string) => Promise<any>,
  configureNativeSubagentModel: ConfigureNativeSubagentModel,
  configureNativeParentModel: (
    profile: string,
    selection: NativeParentModel,
  ) => Promise<any>,
  configureNativeSkills: ConfigureNativeSkills,
  configureNativeToolsets?: ConfigureNativeToolsets,
  configureNativeMcpServers?: ConfigureNativeMcpServers,
): Promise<HermesProfileMaterialization> {
  const profile = String(args.runtime.profile || '').trim();
  const expectedParent = toNativeParentModel(args);
  let native: any;
  try {
    native = await readNativeProfile(profile);
  } catch (error) {
    if (!missingNativeProfile(error, profile)) throw error;
    throw new Error(`hermes_native_profile_missing:${profile}`);
  }
  if (!native || String(native.name || '').trim().toLowerCase() !== profile.toLowerCase()) {
    throw new Error(`hermes_native_profile_readback_mismatch:${profile}`);
  }
  if (!sameNativeParentModel(native.model, expectedParent)) {
    const configured = await configureNativeParentModel(profile, expectedParent);
    const applied = configured?.applied && typeof configured.applied === 'object'
      ? configured.applied as Record<string, unknown>
      : {};
    if (configured?.ok !== true || applied.model !== true) {
      throw new Error(`hermes_native_parent_model_apply_failed:${profile}`);
    }
    native = await readNativeProfile(profile);
    if (!sameNativeParentModel(native?.model, expectedParent)) {
      throw new Error(`hermes_native_parent_model_readback_mismatch:${profile}`);
    }
  }
  const selectedSkills = Array.isArray(args.skills)
    ? [...new Set(args.skills.map((name) => String(name || '').trim()).filter(Boolean))]
    : [];
  const installedSkills = Array.isArray(native.skills)
    ? native.skills
      .map((skill: any) => String(skill?.name || '').trim())
      .filter(Boolean)
    : [];
  const installedByKey = new Map(installedSkills.map((name: string) => [name.toLowerCase(), name]));
  const missingSkills = selectedSkills.filter((name: string) => !installedByKey.has(name.toLowerCase()));
  if (missingSkills.length > 0) {
    throw new Error(`hermes_native_skill_missing:${profile}:${missingSkills.join(',')}`);
  }
  const selectedKeys = new Set(selectedSkills.map((name) => name.toLowerCase()));
  const expectedEnabledKeys = new Set([
    ...selectedKeys,
    ...[...NATIVE_ESSENTIAL_SKILL_NAMES].filter((name) => installedByKey.has(name)),
  ]);
  const enabledKeys = new Set(
    (Array.isArray(native.skills) ? native.skills : [])
      .filter((skill: any) => skill?.enabled === true)
      .map((skill: any) => String(skill?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const disabledSkills = installedSkills.filter(
    (name: string) => !expectedEnabledKeys.has(name.toLowerCase()),
  );
  const selectionMatches = enabledKeys.size === expectedEnabledKeys.size
    && [...expectedEnabledKeys].every((name) => enabledKeys.has(name));
  if (!selectionMatches) {
    const configured = await configureNativeSkills(profile, disabledSkills);
    const applied = configured?.applied && typeof configured.applied === 'object'
      ? configured.applied as Record<string, unknown>
      : {};
    if (configured?.ok !== true || applied.skills !== true) {
      throw new Error(`hermes_native_skills_apply_failed:${profile}`);
    }
    native = await readNativeProfile(profile);
  }
  const finalEnabledKeys = new Set(
    (Array.isArray(native?.skills) ? native.skills : [])
      .filter((skill: any) => skill?.enabled === true)
      .map((skill: any) => String(skill?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    finalEnabledKeys.size !== expectedEnabledKeys.size
    || ![...expectedEnabledKeys].every((name) => finalEnabledKeys.has(name))
  ) {
    throw new Error(`hermes_native_skills_readback_mismatch:${profile}`);
  }
  const availableToolsets = new Map<string, string>(
    (Array.isArray(native?.toolsets) ? native.toolsets : [])
      .map((toolset: any) => String(toolset?.name || '').trim())
      .filter(Boolean)
      .map((name: string) => [name.toLowerCase(), name]),
  );
  const savedToolsets = [...new Set((args.toolsets || []).map((name) => String(name).trim()).filter(Boolean))];
  const requiredToolsets = [...new Set(
    (args.requiredToolsets || []).map((name) => String(name).trim()).filter(Boolean),
  )];
  const missingToolsets = [...savedToolsets, ...requiredToolsets]
    .filter((name) => !availableToolsets.has(name.toLowerCase()));
  if (missingToolsets.length) {
    throw new Error(`hermes_native_toolset_missing:${profile}:${[...new Set(missingToolsets)].join(',')}`);
  }
  const nativeToolToolsets = (args.nativeTools || [])
    .map((name) => availableToolsets.get(String(name).trim().toLowerCase()))
    .filter((name): name is string => Boolean(name));
  const unavailableNativeToolReasons = Object.fromEntries(
    (args.nativeTools || [])
      .map((name) => String(name).trim())
      .filter((name) => name && !availableToolsets.has(name.toLowerCase()))
      .map((name) => [name, 'native_exact_filter_unavailable' as const]),
  );
  const desiredToolsets: string[] = [...new Set<string>([
    ...savedToolsets.map((name) => availableToolsets.get(name.toLowerCase())!),
    ...nativeToolToolsets,
    ...requiredToolsets.map((name) => availableToolsets.get(name.toLowerCase())!),
  ])].sort();
  const enabledToolsets = (Array.isArray(native?.toolsets) ? native.toolsets : [])
    .filter((toolset: any) => toolset?.enabled === true)
    .map((toolset: any) => String(toolset?.name || '').trim())
    .filter(Boolean)
    .sort();
  if (JSON.stringify(enabledToolsets) !== JSON.stringify(desiredToolsets)) {
    if (!configureNativeToolsets) throw new Error(`hermes_native_toolset_configurator_missing:${profile}`);
    const configured = await configureNativeToolsets(profile, desiredToolsets);
    const applied = configured?.applied && typeof configured.applied === 'object'
      ? configured.applied as Record<string, unknown>
      : {};
    if (configured?.ok !== true || applied.toolsets !== true) {
      throw new Error(`hermes_native_toolsets_apply_failed:${profile}`);
    }
    native = await readNativeProfile(profile);
  }
  const finalEnabledToolsets = (Array.isArray(native?.toolsets) ? native.toolsets : [])
    .filter((toolset: any) => toolset?.enabled === true)
    .map((toolset: any) => String(toolset?.name || '').trim())
    .filter(Boolean)
    .sort();
  if (JSON.stringify(finalEnabledToolsets) !== JSON.stringify(desiredToolsets)) {
    throw new Error(`hermes_native_toolsets_readback_mismatch:${profile}`);
  }
  const desiredMcpServers = [...new Set(
    (args.mcpConnectionIds || []).map((name) => String(name).trim()).filter(Boolean),
  )].sort();
  const enabledMcpServers = (Array.isArray(native?.mcp_servers) ? native.mcp_servers : [])
    .filter((server: any) => server?.enabled === true)
    .map((server: any) => String(server?.name || '').trim())
    .filter(Boolean)
    .sort();
  if (JSON.stringify(enabledMcpServers) !== JSON.stringify(desiredMcpServers)) {
    if (!configureNativeMcpServers) {
      throw new Error(`hermes_native_mcp_server_configurator_missing:${profile}`);
    }
    const configured = await configureNativeMcpServers(profile, desiredMcpServers);
    const applied = configured?.applied && typeof configured.applied === 'object'
      ? configured.applied as Record<string, unknown>
      : {};
    if (configured?.ok !== true || applied.mcp_servers !== true) {
      throw new Error(`hermes_native_mcp_servers_apply_failed:${profile}`);
    }
    native = await readNativeProfile(profile);
  }
  const finalEnabledMcpServers: string[] = (Array.isArray(native?.mcp_servers) ? native.mcp_servers : [])
    .filter((server: any) => server?.enabled === true)
    .map((server: any) => String(server?.name || '').trim())
    .filter(Boolean)
    .sort();
  const desiredMcpServerNames = new Set(desiredMcpServers);
  const extraMcpServers = finalEnabledMcpServers.filter((name) => !desiredMcpServerNames.has(name));
  if (extraMcpServers.length) {
    throw new Error(`hermes_native_mcp_servers_readback_broadened:${profile}:${extraMcpServers.join(',')}`);
  }
  const enabledMcpServerNames = new Set(finalEnabledMcpServers);
  const unavailableMcpServerReasons = Object.fromEntries(
    desiredMcpServers
      .filter((name) => !enabledMcpServerNames.has(name))
      .map((name) => [name, 'mcp_server_not_configured' as const]),
  );
  let effectiveSubagentModel = args.effectiveSubagentModel;
  if (args.subagentModel) {
    const expected = toNativeSubagentModel(args.subagentModel);
    if (!sameNativeSubagentModel(native.subagent_model, expected)) {
      try {
        await configureNativeSubagentModel(profile, expected);
      } catch {
        throw new Error(`hermes_native_subagent_model_apply_failed:${profile}`);
      }
    }
    effectiveSubagentModel = {
      desired: args.subagentModel,
      provider: expected.provider,
      model: expected.model,
      fallbackOccurred: false,
      fallbackReason: null,
    };
  }
  return {
    native,
    unavailableNativeToolReasons,
    unavailableMcpServerReasons,
    ...(effectiveSubagentModel ? { effectiveSubagentModel } : {}),
  };
}
