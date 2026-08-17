import { describe, expect, it } from 'vitest';
import { OpenClaudeRuntimeService } from './service';
import { resolveOpenClaudeProviderTarget } from '../provider/providerTarget';

describe('OpenClaude terminal launch metadata', () => {
  const adapter = {
    getInstallInfo: () => ({
      rootPath: 'localcoder',
      installed: true,
      terminalEntrypoint: 'terminal',
    }),
    getBackendEnvPath: () => '.env',
    buildBackendOwnedTerminalLaunchCommand: () => 'powershell launch.ps1',
  };

  it('does not silently select a provider or model', () => {
    expect(() => resolveOpenClaudeProviderTarget({})).toThrow(
      'openclaude_model_key_required',
    );
  });

  // The live route (coder.routes.ts) must supply the full triple; each part is
  // cross-checked against the model registry, so nothing is ever inferred.
  it('resolves a real launch command for the live terminal route', () => {
    const service = new OpenClaudeRuntimeService(adapter as never);
    const launch = service.getTerminalLaunch({
      modelKey: 'gpt-5.6-luna',
      provider: 'openai',
      providerModelId: 'gpt-5.6-luna',
    });
    expect(launch.ok).toBe(true);
    expect(launch.launchCommand).toBe('powershell launch.ps1');
    expect(launch.providerModelId).toBe('gpt-5.6-luna');
    expect(launch.terminalAvailable).toBe(true);
  });

  it('reports an honest configuration error instead of guessing a model', () => {
    const service = new OpenClaudeRuntimeService(adapter as never);
    const launch = service.getTerminalLaunch({});
    expect(launch.ok).toBe(false);
    expect(launch.launchCommand).toBeNull();
    expect(launch.error).toBe('openclaude_model_key_required');
  });

  it('refuses a provider that disagrees with the registry', () => {
    const service = new OpenClaudeRuntimeService(adapter as never);
    const launch = service.getTerminalLaunch({
      modelKey: 'gpt-5.6-luna',
      provider: 'openrouter',
      providerModelId: 'gpt-5.6-luna',
    });
    expect(launch.ok).toBe(false);
    expect(launch.error).toContain('openclaude_provider_model_mismatch');
  });

  it('exposes no execution surface — launch metadata only, no headless fallback', () => {
    const service = new OpenClaudeRuntimeService(adapter as never);
    expect((service as unknown as { run?: unknown }).run).toBeUndefined();
  });
});
