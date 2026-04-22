import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type OpenClaudeInstallInfo = {
  rootPath: string;
  installed: boolean;
  headlessEntrypoint: string | null;
  terminalEntrypoint: string | null;
};

export class OpenClaudeAdapter {
  constructor(private readonly rootPath = resolve(process.cwd(), 'localcoder')) {}

  getInstallInfo(): OpenClaudeInstallInfo {
    const packageJson = join(this.rootPath, 'package.json');
    const headlessEntrypoint = join(this.rootPath, 'src', 'entrypoints', 'mcp.ts');
    const terminalEntrypoint = join(this.rootPath, 'bin', 'openclaude');
    const installed = existsSync(packageJson);

    return {
      rootPath: this.rootPath,
      installed,
      headlessEntrypoint: installed && existsSync(headlessEntrypoint) ? headlessEntrypoint : null,
      terminalEntrypoint: installed && existsSync(terminalEntrypoint) ? terminalEntrypoint : null,
    };
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
