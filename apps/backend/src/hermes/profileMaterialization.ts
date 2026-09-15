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
  runtime: { kind: 'hermes'; mode: 'main' | 'delegate' | 'kanban'; profile: string };
  provider: string;
  accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
  modelKey: string;
  providerModelId: string;
  openaiRuntime: 'codex_app_server' | null;
  skills?: string[];
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
    ...(effectiveSubagentModel ? { effectiveSubagentModel } : {}),
  };
}
