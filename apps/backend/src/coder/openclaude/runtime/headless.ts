import type { OpenClaudeRunRequest, OpenClaudeRunResult } from '../contracts';

export async function runOpenClaudeHeadless(
  request: OpenClaudeRunRequest,
): Promise<OpenClaudeRunResult> {
  return {
    ok: false,
    mode: 'headless',
    access: request.access || 'patch',
    state: 'error',
    error: 'coder_packet_required_use_localcoder_run',
    provider: request.provider || null,
    model: request.providerModelId || '',
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
