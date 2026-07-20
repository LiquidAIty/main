import { existsSync } from 'node:fs';
import path, { join, resolve } from 'node:path';

export type OpenClaudeInstallInfo = {
  rootPath: string;
  installed: boolean;
  terminalEntrypoint: string | null;
};

export type OpenClaudeRuntimeSource =
  | 'explicit_command'
  | 'path_openclaude'
  | 'vendored_built';

export type OpenClaudeConsoleRuntime =
  | {
      ready: true;
      command: string;
      baseArgs: string[];
      describe: string;
      shell: boolean;
      source: OpenClaudeRuntimeSource;
      envMissing: string[];
    }
  | { ready: false; missing: string[] };

const EXPLICIT_COMMAND_ENV = [
  'OPENCLAUDE_COMMAND',
  'OPENCLAUDE_BIN',
] as const;
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function executableExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return [''];
  return [
    '',
    ...String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .map((extension) => extension.trim())
      .filter(Boolean),
  ];
}

function resolveExecutable(name: string, env: NodeJS.ProcessEnv): string | null {
  const candidates =
    path.isAbsolute(name) || name.includes('/') || name.includes('\\')
      ? [name]
      : String(env.PATH || env.Path || '')
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.join(directory, name));
  for (const candidate of candidates) {
    for (const extension of executableExtensions(env)) {
      for (const variant of [`${candidate}${extension.toLowerCase()}`, `${candidate}${extension.toUpperCase()}`]) {
        if (existsSync(variant)) return variant;
      }
    }
  }
  return null;
}

function resolvedCommand(
  executable: string,
  baseArgs: string[],
  source: OpenClaudeRuntimeSource,
  env: NodeJS.ProcessEnv,
): Exclude<OpenClaudeConsoleRuntime, { ready: false }> {
  const extension = path.extname(executable).toLowerCase();
  const needsNode = process.platform === 'win32' && !WINDOWS_EXECUTABLE_EXTENSIONS.includes(extension);
  return {
    ready: true,
    command: needsNode ? process.execPath : executable,
    baseArgs: needsNode ? [executable, ...baseArgs] : baseArgs,
    describe: [executable, ...baseArgs].join(' '),
    shell: extension === '.cmd' || extension === '.bat',
    source,
    envMissing:
      String(env.OPENAI_API_KEY || env.OPENROUTER_API_KEY || '').trim()
        ? []
        : ['openclaude_provider_key_missing'],
  };
}

export class OpenClaudeAdapter {
  constructor(private readonly rootPath = resolve(process.cwd(), 'localcoder')) {}

  getInstallInfo(): OpenClaudeInstallInfo {
    const packageJson = join(this.rootPath, 'package.json');
    const terminalEntrypoint = join(this.rootPath, 'bin', 'openclaude');
    const installed = existsSync(packageJson);

    return {
      rootPath: this.rootPath,
      installed,
      terminalEntrypoint: installed && existsSync(terminalEntrypoint) ? terminalEntrypoint : null,
    };
  }

  resolveConsoleRuntime(env: NodeJS.ProcessEnv = process.env): OpenClaudeConsoleRuntime {
    for (const name of EXPLICIT_COMMAND_ENV) {
      const value = String(env[name] || '').trim();
      if (!value) continue;
      const [head, ...args] = tokenizeCommand(value);
      const executable = head ? resolveExecutable(head, env) : null;
      if (!executable) {
        return { ready: false, missing: [`openclaude_command_not_found: ${name}=${value}`] };
      }
      return resolvedCommand(executable, args, 'explicit_command', env);
    }

    const onPath = resolveExecutable('openclaude', env);
    if (onPath) return resolvedCommand(onPath, [], 'path_openclaude', env);

    const install = this.getInstallInfo();
    const missing = [
      ...(!install.installed ? [`openclaude_package_missing: ${join(this.rootPath, 'package.json')}`] : []),
      ...(!install.terminalEntrypoint ? [`openclaude_entrypoint_missing: ${join(this.rootPath, 'bin', 'openclaude')}`] : []),
      ...(!existsSync(join(this.rootPath, 'dist', 'cli.mjs'))
        ? [`openclaude_build_missing: ${join(this.rootPath, 'dist', 'cli.mjs')}`]
        : []),
      ...(!existsSync(join(this.rootPath, 'node_modules'))
        ? [`openclaude_dependencies_missing: ${join(this.rootPath, 'node_modules')}`]
        : []),
    ];
    if (missing.length > 0 || !install.terminalEntrypoint) return { ready: false, missing };
    return resolvedCommand(install.terminalEntrypoint, [], 'vendored_built', env);
  }

  isRepoConnected(repoRoot = process.cwd()): boolean {
    return existsSync(join(repoRoot, '.git'));
  }

  getTerminalLaunchCommand(): string | null {
    return this.buildBackendOwnedTerminalLaunchCommand();
  }

  private getRepoRootPath(): string {
    return resolve(this.rootPath, '..');
  }

  getBackendEnvPath(): string {
    return join(this.getRepoRootPath(), 'apps', 'backend', '.env');
  }

  getTerminalWrapperScriptPath(): string {
    return join(
      this.getRepoRootPath(),
      'apps',
      'backend',
      'scripts',
      'openclaude-terminal-launch.ps1',
    );
  }

  buildBackendOwnedTerminalLaunchCommand(options?: {
    modelKey?: string;
    provider?: 'openai' | 'openrouter';
    providerModelId?: string;
  }): string | null {
    const install = this.getInstallInfo();
    const scriptPath = this.getTerminalWrapperScriptPath();
    if (!install.terminalEntrypoint || !existsSync(scriptPath)) {
      return null;
    }

    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      `"${scriptPath}"`,
    ];
    if (options?.modelKey) {
      args.push('-ModelKey', `"${options.modelKey}"`);
    }
    if (options?.provider) {
      args.push('-Provider', `"${options.provider}"`);
    }
    if (options?.providerModelId) {
      args.push('-ProviderModelId', `"${options.providerModelId}"`);
    }

    return `powershell ${args.join(' ')}`;
  }
}
