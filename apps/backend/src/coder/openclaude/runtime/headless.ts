import type { OpenClaudeRunRequest, OpenClaudeRunResult } from '../contracts';
import { runOpenClaudeWithCanonicalRuntime } from '../provider/openai53';

export async function runOpenClaudeHeadless(
  request: OpenClaudeRunRequest,
): Promise<OpenClaudeRunResult> {
  const response = await runOpenClaudeWithCanonicalRuntime(request);
  return {
    ok: true,
    mode: 'headless',
    access: request.access || 'patch',
    state: 'idle',
    output: response.text,
    provider: response.provider,
    model: response.model,
    responseId: response.responseId,
    terminal: {
      available: false,
      used: false,
      envOwner: 'backend',
      runtimeOwner: 'backend',
      launchCommand: null,
    },
  };
}
