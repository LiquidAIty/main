import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type OpenClaudeInstallInfo = {
  rootPath: string;
  installed: boolean;
  headlessEntrypoint: string | null;
  terminalEntrypoint: string | null;
};

export class OpenClaudeAdapter {
  constructor(private readonly rootPath = resolve(process.cwd(), 'openclaude-main')) {}

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
    const info = this.getInstallInfo();
    return info.terminalEntrypoint ? info.terminalEntrypoint : null;
  }
}
