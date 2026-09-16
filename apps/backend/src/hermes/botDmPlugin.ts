import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { resolveRepoRoot } from '../services/workspaceRoot';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';

export const HERMES_BOT_DM_PLUGIN_KEY = 'card-bot-dm';

const REQUIRED_PLUGIN_FILES = ['__init__.py', 'plugin.yaml'] as const;
const MAX_CLI_OUTPUT_BYTES = 16_384;

export type HermesBotDmPluginFile = {
  relativePath: string;
  sha256: string;
};

export type HermesBotDmPluginMaterialization = {
  key: typeof HERMES_BOT_DM_PLUGIN_KEY;
  sourceDir: string;
  destinationDir: string;
  files: HermesBotDmPluginFile[];
};

export type HermesBotDmPluginRuntime = {
  name: typeof HERMES_BOT_DM_PLUGIN_KEY;
  version: string;
  enabled: true;
};

export type HermesCliRunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
};

export type HermesCliRunner = (
  executable: string,
  args: string[],
  options: HermesCliRunOptions,
) => Promise<void>;

export type MaterializeHermesBotDmPluginOptions = {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  runCli?: HermesCliRunner;
};

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function requireDirectory(target: string, error: string): Promise<string> {
  let info;
  try {
    info = await lstat(target);
  } catch {
    throw new Error(error);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(error);
  return realpath(target);
}

async function readRuntimeFiles(sourceRoot: string): Promise<HermesBotDmPluginFile[]> {
  const files: HermesBotDmPluginFile[] = [];
  for (const required of REQUIRED_PLUGIN_FILES) {
    const absolute = path.join(sourceRoot, required);
    let info;
    try {
      info = await lstat(absolute);
    } catch {
      throw new Error(`hermes_bot_dm_plugin_source_file_missing:${required}`);
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`hermes_bot_dm_plugin_source_file_invalid:${required}`);
    }
    files.push({ relativePath: required, sha256: sha256(await readFile(absolute)) });
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

async function verifyReadback(
  destinationRoot: string,
  expected: HermesBotDmPluginFile[],
): Promise<void> {
  const actual = await readRuntimeFiles(destinationRoot);
  if (actual.length !== expected.length) throw new Error('hermes_bot_dm_plugin_readback_mismatch');
  for (let index = 0; index < expected.length; index += 1) {
    if (
      actual[index].relativePath !== expected[index].relativePath
      || actual[index].sha256 !== expected[index].sha256
    ) {
      throw new Error(`hermes_bot_dm_plugin_readback_mismatch:${expected[index].relativePath}`);
    }
  }
}

async function copySource(
  sourceRoot: string,
  destinationRoot: string,
  files: HermesBotDmPluginFile[],
): Promise<void> {
  await mkdir(destinationRoot, { recursive: false });
  for (const file of files) {
    const source = path.join(sourceRoot, file.relativePath);
    const destination = path.join(destinationRoot, file.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await verifyReadback(destinationRoot, files);
}

export const runHermesCli: HermesCliRunner = async (executable, args, options) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: options.windowsHide,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-MAX_CLI_OUTPUT_BYTES);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.once('error', () => reject(new Error('hermes_bot_dm_plugin_enable_spawn_failed')));
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`hermes_bot_dm_plugin_enable_failed:${code ?? 'signal'}:${output.trim()}`));
    });
  });
};

/**
 * Copy the repo-owned Bot-DM plugin into one already-prepared native profile
 * and enable it in that profile before its Gateway is started.
 */
export async function materializeHermesBotDmPlugin(
  profileHome: string,
  options: MaterializeHermesBotDmPluginOptions = {},
): Promise<HermesBotDmPluginMaterialization> {
  const repoRoot = await requireDirectory(
    path.resolve(options.repoRoot ?? resolveRepoRoot()),
    'hermes_bot_dm_plugin_repo_root_invalid',
  );
  const sourceDir = path.join(repoRoot, 'packages', 'hermes-card-bot-dm');
  const hermesRoot = path.join(repoRoot, 'Hermes');
  const executable = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
  const resolvedProfileHome = await requireDirectory(
    path.resolve(profileHome),
    'hermes_bot_dm_plugin_profile_home_invalid',
  );
  try {
    const config = await stat(path.join(resolvedProfileHome, 'config.yaml'));
    if (!config.isFile()) throw new Error('invalid');
  } catch {
    throw new Error('hermes_bot_dm_plugin_profile_not_prepared');
  }
  const resolvedSource = await requireDirectory(
    sourceDir,
    'hermes_bot_dm_plugin_source_missing',
  );
  if (!inside(repoRoot, resolvedSource)) {
    throw new Error('hermes_bot_dm_plugin_source_invalid');
  }
  try {
    await access(executable);
  } catch {
    throw new Error('hermes_bot_dm_plugin_cli_missing');
  }
  const sourceFiles = await readRuntimeFiles(resolvedSource);

  const pluginsRoot = path.join(resolvedProfileHome, 'plugins');
  await mkdir(pluginsRoot, { recursive: true });
  const resolvedPluginsRoot = await realpath(pluginsRoot);
  if (!inside(resolvedProfileHome, resolvedPluginsRoot)) {
    throw new Error('hermes_bot_dm_plugin_destination_outside_profile');
  }
  const destinationDir = path.join(resolvedPluginsRoot, HERMES_BOT_DM_PLUGIN_KEY);
  if (!inside(resolvedPluginsRoot, destinationDir)) {
    throw new Error('hermes_bot_dm_plugin_destination_outside_profile');
  }
  try {
    const destinationInfo = await lstat(destinationDir);
    if (destinationInfo.isSymbolicLink() || !destinationInfo.isDirectory()) {
      throw new Error('hermes_bot_dm_plugin_destination_invalid');
    }
    if (!inside(resolvedPluginsRoot, await realpath(destinationDir))) {
      throw new Error('hermes_bot_dm_plugin_destination_outside_profile');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('hermes_bot_dm_plugin_')) throw error;
  }

  const stageDir = path.join(
    resolvedPluginsRoot,
    `.${HERMES_BOT_DM_PLUGIN_KEY}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    await copySource(resolvedSource, stageDir, sourceFiles);
    await rm(destinationDir, { recursive: true, force: true });
    await rename(stageDir, destinationDir);
    await verifyReadback(destinationDir, sourceFiles);
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }

  const cliEnv = withoutInternalMcpSecret(options.env ?? process.env);
  await (options.runCli ?? runHermesCli)(
    executable,
    [
      '-m', 'hermes_cli.main',
      'plugins', 'enable', HERMES_BOT_DM_PLUGIN_KEY, '--no-allow-tool-override',
    ],
    {
      cwd: hermesRoot,
      env: {
        ...cliEnv,
        HERMES_HOME: resolvedProfileHome,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      windowsHide: true,
    },
  );

  return {
    key: HERMES_BOT_DM_PLUGIN_KEY,
    sourceDir: resolvedSource,
    destinationDir,
    files: sourceFiles,
  };
}

/** Require public `plugins.list` readback to prove one loaded enabled plugin. */
export function requireLoadedHermesBotDmPlugin(value: unknown): HermesBotDmPluginRuntime {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (!Array.isArray(record.plugins)) throw new Error('hermes_bot_dm_plugin_runtime_list_invalid');
  const matches = record.plugins.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return String((entry as Record<string, unknown>).name || '').trim() === HERMES_BOT_DM_PLUGIN_KEY;
  });
  if (!matches.length) throw new Error('hermes_bot_dm_plugin_runtime_missing');
  if (matches.length !== 1) throw new Error('hermes_bot_dm_plugin_runtime_ambiguous');
  const row = matches[0] as Record<string, unknown>;
  if (row.enabled !== true) throw new Error('hermes_bot_dm_plugin_runtime_disabled');
  return {
    name: HERMES_BOT_DM_PLUGIN_KEY,
    version: String(row.version || '').trim(),
    enabled: true,
  };
}
