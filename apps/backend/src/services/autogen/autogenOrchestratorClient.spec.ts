import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginAgentAssignmentOnPython,
  orchestrateWithAutoGen,
  projectLiveThinkGraph,
} from './autogenOrchestratorClient';

describe('autogenOrchestratorClient', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    process.env.AUTOGEN_ORCHESTRATOR_URL = 'http://python-rails:8001';
    process.env.PYTHON_MODELS_URL = 'http://python-models:8001';
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
        modelKey: 'gpt-5.6-luna',
        providerModelId: 'gpt-5.6-luna',
        startedAt: new Date().toISOString(),
      },
      userText: 'run this',
    });

    expect(result.finalResponseText).toBe('from Python rails');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/autogen/orchestrate',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('begins a Hermes assignment from the exact existing AgentGraph instruction', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        assignmentId: 'assignment:child',
        instructionId: 'instruction:child',
        correlationId: 'child',
        claimToken: 'claim:child',
        state: 'running',
      }),
    });
    vi.stubGlobal('fetch', fetchMock as any);
    const payload = {
      projectId: 'p1',
      deckId: 'deck_builder',
      conversationId: 'conversation:one',
      correlationId: 'child',
      senderCardId: 'card_magentic',
      receiverCardId: 'card_research',
      instruction: 'Exact instruction.',
      instructionId: 'instruction:child',
      parentRunId: 'assignment:outer',
      runtime: 'hermes',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
    };

    await beginAgentAssignmentOnPython(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/agentgraph/assignments/begin-existing',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) }),
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
          modelKey: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
          startedAt: new Date().toISOString(),
        },
        userText: 'run this',
      }),
    ).rejects.toThrow('autogen_orchestrator_http_500:card_runtime_sidecar_disabled');
  });

  it('preserves an exact Python rails failure instead of rewriting it as missing output', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          ok: false,
          error: 'tool_selection_invalid: unknown_tool',
          finalResponseText: '',
        }),
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
          modelKey: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
          startedAt: new Date().toISOString(),
        },
        userText: 'run this',
      }),
    ).rejects.toThrow('tool_selection_invalid: unknown_tool');
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
          modelKey: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
          startedAt: new Date().toISOString(),
        },
        userText: 'run this',
      }),
    ).rejects.toThrow('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
  });

  it('uses the pure ThinkGraph live projection endpoint without fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        schemaVersion: 'thinkgraph.live.projection.v1',
        projectId: 'p1',
        nodes: [],
        edges: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as any);
    const payload = {
      projectId: 'p1',
      conversationId: 'main',
      runId: 'turn-1',
      observedAt: '2026-08-09T12:00:00.000Z',
      state: 'active' as const,
      streams: [{
        source: 'user' as const,
        sourceId: 'message-1',
        text: 'Fix the build.',
      }],
    };

    await projectLiveThinkGraph(payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/thinkgraph/live-projection',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    );
  });
});
