import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeConnectedAgents,
  dispatchConfiguredRuntime,
  fetchThinkGraphNeighborhood,
} from './pythonRailsClient';
import type { CanonicalInputFiles } from '../../contracts/runtimeContracts';

function testInputFiles(): CanonicalInputFiles {
  return {
    workspace: 'C:\\runtime-inputs\\run-one',
    icfPath: 'C:\\runtime-inputs\\run-one\\in.icf',
    igfPath: 'C:\\runtime-inputs\\run-one\\in.igf',
    icfSha256: 'a'.repeat(64),
    igfSha256: 'b'.repeat(64),
    icfBytes: 120,
    igfBytes: 80,
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
        deckId: 'd1',
        cardId: 'card-mag-one',
        turnId: 't1',
        route: 'deck_runtime',
        orchestrator: 'magentic_one',
        startedAt: new Date().toISOString(),
      },
      inputFiles: testInputFiles(),
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
          deckId: 'd1',
          cardId: 'card-mag-one',
          turnId: 't1',
          route: 'deck_runtime',
          orchestrator: 'magentic_one',
          startedAt: new Date().toISOString(),
        },
        inputFiles: testInputFiles(),
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
          deckId: 'd1',
          cardId: 'card-mag-one',
          turnId: 't1',
          route: 'deck_runtime',
          orchestrator: 'magentic_one',
          startedAt: new Date().toISOString(),
        },
        inputFiles: testInputFiles(),
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
          deckId: 'd1',
          cardId: 'card-mag-one',
          turnId: 't1',
          route: 'deck_runtime',
          orchestrator: 'magentic_one',
          startedAt: new Date().toISOString(),
        },
        inputFiles: testInputFiles(),
      }),
    ).rejects.toThrow('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
  });

  it('uses the native ThinkGraph neighborhood endpoint without fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        schemaVersion: 'thinkgraph.engraphis.projection.v1',
        projectId: 'p1',
        nodes: [],
        edges: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as any);
    await fetchThinkGraphNeighborhood('p1', 'mem-1');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://python-rails:8001/thinkgraph/neighborhood?projectId=p1&canonicalId=mem-1',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });
});
