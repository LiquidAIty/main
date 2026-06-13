import { OpenClaudeAdapter } from '../adapter';
import type {
  OpenClaudeAccess,
  OpenClaudeMode,
  OpenClaudeRunRequest,
  OpenClaudeRunResult,
  OpenClaudeState,
  OpenClaudeStatus,
  OpenClaudeTerminalLaunchResult,
} from '../contracts';
import { resolveOpenClaudeProviderTarget } from '../provider/openai53';
import { runOpenClaudeHeadless } from './headless';
import { runOpenClaudeTerminal } from './terminal';

const DEFAULT_MODE: OpenClaudeMode = 'headless';
const DEFAULT_ACCESS: OpenClaudeAccess = 'patch';

export class OpenClaudeRuntimeService {
  private state: OpenClaudeState = 'idle';

  constructor(private readonly adapter = new OpenClaudeAdapter()) {}

  getStatus(request: Partial<OpenClaudeRunRequest> = {}): OpenClaudeStatus {
    const install = this.adapter.getInstallInfo();
    let target: ReturnType<typeof resolveOpenClaudeProviderTarget> | null = null;
    let configurationError: string | undefined;
    try {
      target = resolveOpenClaudeProviderTarget({
        task: '',
        mode: request.mode,
        access: request.access,
        modelKey: request.modelKey,
        provider: request.provider,
        providerModelId: request.providerModelId,
      });
    } catch (error) {
      configurationError =
        error instanceof Error ? error.message : 'openclaude_configuration_invalid';
    }

    return {
      installed: install.installed,
      headlessAvailable: install.headlessEntrypoint !== null,
      terminalAvailable: install.terminalEntrypoint !== null,
      repoConnected: this.adapter.isRepoConnected(),
      mode: request.mode || DEFAULT_MODE,
      access: request.access || DEFAULT_ACCESS,
      state: this.state,
      modelKey: target?.modelKey || '',
      provider: target?.provider || null,
      providerModelId: target?.providerModelId || '',
      ...(configurationError ? { configurationError } : {}),
    };
  }

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

  async run(request: OpenClaudeRunRequest): Promise<OpenClaudeRunResult> {
    const task = String(request.task || '').trim();
    if (!task) {
      return {
        ok: false,
        mode: request.mode || DEFAULT_MODE,
        access: request.access || DEFAULT_ACCESS,
        state: 'error',
        error: 'task_required',
        provider: null,
        model: '',
        responseId: null,
        terminal: {
          available: false,
          used: false,
          envOwner: 'backend',
          runtimeOwner: 'backend',
          launchCommand: null,
        },
      };
    }

    const install = this.adapter.getInstallInfo();
    if (!install.installed) {
      return {
        ok: false,
        mode: request.mode || DEFAULT_MODE,
        access: request.access || DEFAULT_ACCESS,
        state: 'error',
        error: 'openclaude_not_installed',
        provider: null,
        model: '',
        responseId: null,
        terminal: {
          available: false,
          used: false,
          envOwner: 'backend',
          runtimeOwner: 'backend',
          launchCommand: null,
        },
      };
    }

    this.state = 'running';
    try {
      const mode = request.mode || DEFAULT_MODE;
      const result =
        mode === 'terminal'
          ? await runOpenClaudeTerminal(this.adapter, request)
          : await runOpenClaudeHeadless(request);
      this.state = 'idle';
      return result;
    } catch (err: unknown) {
      this.state = 'error';
      return {
        ok: false,
        mode: request.mode || DEFAULT_MODE,
        access: request.access || DEFAULT_ACCESS,
        state: 'error',
        error: err instanceof Error ? err.message : 'openclaude_runtime_failed',
        provider: request.provider || null,
        model: request.providerModelId || '',
        responseId: null,
        terminal: {
          available: install.terminalEntrypoint !== null,
          used: false,
          envOwner: 'backend',
          runtimeOwner: 'backend',
          launchCommand: null,
        },
      };
    }
  }
}

export const openClaudeRuntimeService = new OpenClaudeRuntimeService();
