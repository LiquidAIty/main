import type { OpenClaudeAdapter } from '../adapter';
import type { OpenClaudeRunRequest, OpenClaudeRunResult } from '../contracts';
import { runOpenClaudeWithCanonicalRuntime } from '../provider/openai53';

export async function runOpenClaudeTerminal(
  adapter: OpenClaudeAdapter,
  request: OpenClaudeRunRequest,
): Promise<OpenClaudeRunResult> {
  const response = await runOpenClaudeWithCanonicalRuntime(request);
  const launchCommand = adapter.getTerminalLaunchCommand();
  const terminalAvailable = Boolean(launchCommand);
  const terminalSteering = request.terminalSteering !== false;

  return {
    ok: true,
    mode: 'terminal',
    access: request.access || 'patch',
    state: 'idle',
    output: response.text,
    provider: response.provider,
    model: response.model,
    responseId: response.responseId,
    terminal: {
      available: terminalAvailable,
      used: terminalAvailable && terminalSteering,
      launchCommand,
    },
  };
}
