import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeConnectedAgents,
  dispatchConfiguredRuntime,
  projectLiveThinkGraph,
} from './pythonRailsClient';
import type { InputDataFile } from '../../contracts/runtimeContracts';

function testIdf(userText: string): InputDataFile {
  return {
    idfId: 'idf:test-run',
    projectId: 'p1',
    deckId: 'deck_builder',
    conversationId: 'main',
    runId: 'test-run',
    originatingCardId: 'card_magentic',
    version: 1,
    systemText: 'Saved prompt.',
    userText,
    cardContext: { cardId: 'card_magentic' },
    dynamicContextMarkdown: '',
    nativeReferences: [],
    modelInputMarkdown: userText,
    contentMarkdown: userText,
    contentSha256: 'test-sha256',
    createdAt: '2026-08-15T00:00:00.000Z',
  };
}

describe('pythonRailsClient', () => {
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

  it('posts one prepared request to the Python configured-runtime dispatcher', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, finalResponseText: 'from Python rails' }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await dispatchConfiguredRuntime({
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
      idf: testIdf('run this'),
    });

    expect(result.finalResponseText).toBe('from Python rails');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/autogen/dispatch',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('forwards exact Project/Deck identity for the Python-owned Mag One roster', async () => {
    const request = vi.fn(async () => ({
      ok: true,
      projectId: 'project-1',
      deckId: 'deck-1',
      orchestratorCardId: 'card_magentic',
      connectedAgents: [{
        cardId: 'card_worker',
        title: 'Worker',
        model: { modelKey: 'model-1', provider: 'openai' },
        tools: [],
        connected: true,
        executionReady: true,
        readinessState: 'ready',
        readinessReason: null,
      }],
    }));

    const result = await describeConnectedAgents(
      { projectId: 'project-1', deckId: 'deck-1' },
      request as any,
    );

    expect(request).toHaveBeenCalledWith(
      '/domain/mag-one/project-1/deck-1/agents',
      { method: 'GET' },
    );
    expect(result.connectedAgents.map((agent) => agent.cardId)).toEqual(['card_worker']);
  });

  it('rejects missing Mag One roster identity and malformed Python responses', async () => {
    await expect(
      describeConnectedAgents({ projectId: '', deckId: 'deck-1' }, vi.fn() as any),
    ).rejects.toThrow('projectId_and_deckId_required');
    await expect(
      describeConnectedAgents(
        { projectId: 'project-1', deckId: 'deck-1' },
        vi.fn(async () => ({ ok: true, connectedAgents: [] })) as any,
      ),
    ).rejects.toThrow('mag_one_connected_agents_response_invalid');
  });

  it('throws explicit Python rails HTTP error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ detail: 'configured_runtime_unavailable' }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await expect(
      dispatchConfiguredRuntime({
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
        idf: testIdf('run this'),
      }),
    ).rejects.toThrow('autogen_dispatch_http_500:configured_runtime_unavailable');
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
      dispatchConfiguredRuntime({
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
        idf: testIdf('run this'),
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
      dispatchConfiguredRuntime({
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
        idf: testIdf('run this'),
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
