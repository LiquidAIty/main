import { OpenClaudeAdapter } from '../adapter';
import type {
  OpenClaudeProviderTargetInput,
  OpenClaudeTerminalLaunchResult,
} from '../contracts';
import { resolveOpenClaudeProviderTarget } from '../provider/providerTarget';

/** Interactive OpenClaude terminal launch metadata; never a Coder executor. */
export class OpenClaudeRuntimeService {
  constructor(private readonly adapter = new OpenClaudeAdapter()) {}

  getTerminalLaunch(
    request: OpenClaudeProviderTargetInput = {},
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
