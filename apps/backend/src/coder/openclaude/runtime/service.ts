import { OpenClaudeAdapter } from '../adapter';
import type {
  OpenClaudeAccess,
  OpenClaudeMode,
  OpenClaudeRunRequest,
  OpenClaudeRunResult,
  OpenClaudeState,
  OpenClaudeStatus,
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
    const target = resolveOpenClaudeProviderTarget({
      task: '',
      mode: request.mode,
      access: request.access,
      modelKey: request.modelKey,
      provider: request.provider,
      providerModelId: request.providerModelId,
    });

    return {
      installed: install.installed,
      headlessAvailable: install.headlessEntrypoint !== null,
      terminalAvailable: install.terminalEntrypoint !== null,
      repoConnected: this.adapter.isRepoConnected(),
      mode: request.mode || DEFAULT_MODE,
      access: request.access || DEFAULT_ACCESS,
      state: this.state,
      modelKey: target.modelKey,
      provider: target.provider,
      providerModelId: target.providerModelId,
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
        provider: 'openai',
        model: '',
        responseId: null,
        terminal: {
          available: false,
          used: false,
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
        provider: 'openai',
        model: '',
        responseId: null,
        terminal: {
          available: false,
          used: false,
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
      const target = resolveOpenClaudeProviderTarget(request);
      return {
        ok: false,
        mode: request.mode || DEFAULT_MODE,
        access: request.access || DEFAULT_ACCESS,
        state: 'error',
        error: err instanceof Error ? err.message : 'openclaude_runtime_failed',
        provider: target.provider,
        model: target.providerModelId,
        responseId: null,
        terminal: {
          available: install.terminalEntrypoint !== null,
          used: false,
          launchCommand: this.adapter.getTerminalLaunchCommand(),
        },
      };
    }
  }
}

export const openClaudeRuntimeService = new OpenClaudeRuntimeService();
