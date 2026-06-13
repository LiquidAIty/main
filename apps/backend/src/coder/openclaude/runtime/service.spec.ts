import { describe, expect, it } from 'vitest';
import { OpenClaudeRuntimeService } from './service';
import { resolveOpenClaudeProviderTarget } from '../provider/openai53';

describe('legacy OpenClaude facade hardening', () => {
  it('does not silently select a provider or model', () => {
    expect(() => resolveOpenClaudeProviderTarget({ task: 'x' })).toThrow(
      'openclaude_model_key_required',
    );
  });

  it('terminal mode never reports used when no launch occurred', async () => {
    const adapter = {
      getInstallInfo: () => ({
        rootPath: 'localcoder',
        installed: true,
        headlessEntrypoint: 'headless',
        terminalEntrypoint: 'terminal',
      }),
      isRepoConnected: () => true,
      getBackendEnvPath: () => '.env',
      buildBackendOwnedTerminalLaunchCommand: () => 'powershell launch.ps1',
    };
    const service = new OpenClaudeRuntimeService(adapter as never);
    const result = await service.run({
      task: 'legacy task',
      mode: 'terminal',
      modelKey: 'gpt-5.3-codex',
      provider: 'openai',
      providerModelId: 'gpt-5.3-codex',
    });
    expect(result.ok).toBe(false);
    expect(result.terminal.used).toBe(false);
    expect(result.error).toBe('terminal_launch_not_executed_use_localcoder_run');
  });
});
