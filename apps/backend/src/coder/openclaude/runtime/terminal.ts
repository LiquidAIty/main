import type { OpenClaudeAdapter } from '../adapter';
import type { OpenClaudeRunRequest, OpenClaudeRunResult } from '../contracts';

export async function runOpenClaudeTerminal(
  adapter: OpenClaudeAdapter,
  request: OpenClaudeRunRequest,
): Promise<OpenClaudeRunResult> {
  const launchCommand = adapter.buildBackendOwnedTerminalLaunchCommand();
  const terminalAvailable = Boolean(launchCommand);

  return {
    ok: false,
    mode: 'terminal',
    access: request.access || 'patch',
    state: 'error',
    error: 'terminal_launch_not_executed_use_localcoder_run',
    provider: request.provider || null,
    model: request.providerModelId || '',
    responseId: null,
    terminal: {
      available: terminalAvailable,
      used: false,
      envOwner: 'backend',
      runtimeOwner: 'backend',
      launchCommand,
    },
  };
}
