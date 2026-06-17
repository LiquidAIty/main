import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { orchestrateWithAutoGen } from './autogenOrchestratorClient';

describe('autogenOrchestratorClient', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    process.env.AUTOGEN_ORCHESTRATOR_URL = 'http://autogen-sidecar:8001';
    process.env.PYTHON_MODELS_URL = 'http://python-models:8001';
    process.env.AUTOGEN_ORCHESTRATOR_TIMEOUT_MS = '5000';
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
  });

  it('posts to autogen orchestrate endpoint and returns payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, finalResponseText: 'from Python rails' }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await orchestrateWithAutoGen({
      session: {
        sessionId: 's1',
        projectId: 'p1',
        turnId: 't1',
        route: 'deck_runtime',
        orchestrator: 'magentic_one',
        modelProvider: 'openai',
        modelKey: 'gpt-5.1-chat-latest',
        providerModelId: 'gpt-5.1-chat-latest',
        startedAt: new Date().toISOString(),
      },
      userText: 'run this',
    });

    expect(result.finalResponseText).toBe('from Python rails');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://autogen-sidecar:8001/autogen/orchestrate',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('throws explicit sidecar http error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ detail: 'card_runtime_sidecar_disabled' }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await expect(
      orchestrateWithAutoGen({
        session: {
          sessionId: 's1',
          projectId: 'p1',
          turnId: 't1',
          route: 'deck_runtime',
          orchestrator: 'magentic_one',
          modelProvider: 'openai',
          modelKey: 'gpt-5.1-chat-latest',
          providerModelId: 'gpt-5.1-chat-latest',
          startedAt: new Date().toISOString(),
        },
        userText: 'run this',
      }),
    ).rejects.toThrow('autogen_orchestrator_http_500:card_runtime_sidecar_disabled');
  });

  it('returns the required unavailable code when Python rails cannot be reached', async () => {
    const connectionError = new Error('connect refused') as Error & {
      cause?: { code: string };
    };
    connectionError.cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(connectionError) as any);

    await expect(
      orchestrateWithAutoGen({
        session: {
          sessionId: 's1',
          projectId: 'p1',
          turnId: 't1',
          route: 'deck_runtime',
          orchestrator: 'magentic_one',
          modelProvider: 'openai',
          modelKey: 'gpt-5.1-chat-latest',
          providerModelId: 'gpt-5.1-chat-latest',
          startedAt: new Date().toISOString(),
        },
        userText: 'run this',
      }),
    ).rejects.toThrow('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
  });
});
