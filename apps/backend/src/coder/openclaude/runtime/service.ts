import { OpenClaudeAdapter } from '../adapter';
import type {
  OpenClaudeRunRequest,
  OpenClaudeTerminalLaunchResult,
} from '../contracts';
import { resolveOpenClaudeProviderTarget } from '../provider/openai53';

/**
 * Terminal LAUNCH METADATA only — this class does not execute the coder.
 *
 * Removed: `run()` plus its `runOpenClaudeHeadless` / `runOpenClaudeTerminal`
 * wrappers. Both wrappers hardcoded `ok:false` (`coder_packet_required_use_
 * localcoder_run` / `terminal_launch_not_executed_use_localcoder_run`), and
 * `run()` had zero live callers — only its own spec. It was the residue of the
 * collapse to the real Console PTY runtime, and a permanently-failing `run()`
 * with `DEFAULT_MODE='headless'` reads like a headless execution path exists.
 * It does not: `coder/execution/coderConsoleRuntime.ts` is the one runtime, and
 * `coderRouter.runHeadlessCoderReality` is a separate admin inspection socket.
 */
export class OpenClaudeRuntimeService {
  constructor(private readonly adapter = new OpenClaudeAdapter()) {}

  getTerminalLaunch(
    request: Partial<OpenClaudeRunRequest> = {},
  ): OpenClaudeTerminalLaunchResult {
    const install = this.adapter.getInstallInfo();
    if (!install.installed) {
      return {
        ok: false,
        terminalAvailable: false,
        launchCommand: null,
        envOwner: 'backend',
        runtimeOwner: 'backend',
        envPath: this.adapter.getBackendEnvPath(),
        rootPath: install.rootPath,
        provider: null,
        modelKey: '',
        providerModelId: '',
        error: 'openclaude_not_installed',
      };
    }

    let target: ReturnType<typeof resolveOpenClaudeProviderTarget>;
    try {
      target = resolveOpenClaudeProviderTarget({
        task: '',
        mode: 'terminal',
        modelKey: request.modelKey,
        provider: request.provider,
        providerModelId: request.providerModelId,
      });
    } catch (error) {
      return {
        ok: false,
        terminalAvailable: install.terminalEntrypoint !== null,
        launchCommand: null,
        envOwner: 'backend',
        runtimeOwner: 'backend',
        envPath: this.adapter.getBackendEnvPath(),
        rootPath: install.rootPath,
        provider: null,
        modelKey: '',
        providerModelId: '',
        error: error instanceof Error ? error.message : 'openclaude_configuration_invalid',
      };
    }

    const launchCommand = this.adapter.buildBackendOwnedTerminalLaunchCommand({
      modelKey: target.modelKey,
      provider: target.provider,
      providerModelId: target.providerModelId,
    });

    return {
      ok: launchCommand !== null,
      terminalAvailable: install.terminalEntrypoint !== null,
      launchCommand,
      envOwner: 'backend',
      runtimeOwner: 'backend',
      envPath: this.adapter.getBackendEnvPath(),
      rootPath: install.rootPath,
      provider: target.provider,
      modelKey: target.modelKey,
      providerModelId: target.providerModelId,
      ...(launchCommand === null ? { error: 'terminal_launch_wrapper_missing' } : {}),
    };
  }

}

export const openClaudeRuntimeService = new OpenClaudeRuntimeService();
