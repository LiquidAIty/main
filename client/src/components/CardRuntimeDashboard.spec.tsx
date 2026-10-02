// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardRuntimeDashboard } from './CardRuntimeDashboard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CardRuntimeDashboard', () => {
  it('leads with the newest failed Run and labels unknown measurements honestly', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          limit: 8,
          latest: {
            runId: 'run-failed', state: 'failed', cardId: 'builder',
            acceptedAt: '2026-10-01T20:00:00Z', startedAt: '2026-10-01T20:00:02Z',
            finishedAt: '2026-10-01T20:00:07Z', preparationMs: 2000,
            elapsedMs: 5000, totalElapsedMs: 7000,
            provider: 'openai', effectiveProvider: 'openai-codex', model: 'gpt-5.6-sol',
            runtimeProfile: 'builder', runtimeKind: 'hermes', runtimeMode: 'delegate',
            inputTokens: null, outputTokens: null, cachedTokens: null,
            reasoningTokens: null, costUsd: null,
            errorCode: 'provider_unavailable', errorSummary: 'Provider unavailable.',
            idf: { sha256: 'a'.repeat(64), bytes: 400 },
            jevDecisions: [{ schemaVersion: 'card-auto-tools.v1', status: 'unavailable' }],
            attemptEvents: [
              { eventId: 'llm-one', attemptId: 'llm-one', kind: 'llm', phase: 'completed',
                model: 'gpt-5.6-sol', durationMs: 900, firstTokenMs: 120, retryCount: 1,
                inputTokens: 80, outputTokens: 20, cachedTokens: 10, reasoningTokens: 4,
                totalTokens: 100, costStatus: 'unknown', observationGap: 2 },
              { eventId: 'tool-one', attemptId: 'tool-one', kind: 'tool', phase: 'failed',
                toolName: 'graphiti.search_nodes', durationMs: 30, errorType: 'Timeout',
                errorMessage: 'Native read timed out.' },
            ],
            toolEvents: [], materializedNativeReferences: [], nativeReferences: [], artifacts: [],
            requestFulfillment: null,
          },
          runs: [
            { runId: 'run-failed', state: 'failed', cardRevisionId: 'revision-one',
              startedAt: '2026-10-01T20:00:02Z', finishedAt: '2026-10-01T20:00:07Z' },
            { runId: 'run-active', state: 'running', cardRevisionId: 'revision-one' },
            { runId: 'run-completed', state: 'completed', cardRevisionId: 'revision-one',
              startedAt: '2026-10-01T19:00:00Z', finishedAt: '2026-10-01T19:00:04Z',
              inputTokens: 100, outputTokens: 20, costUsd: 0.002,
              requestFulfillment: { status: 'scored', normalizedScore100: 75 } },
            { runId: 'run-cancelled', state: 'cancelled', cardRevisionId: 'revision-one' },
          ],
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CardRuntimeDashboard projectId="project-one" deckId="deck-one" cardId="builder" />);

    await waitFor(() => expect(screen.getAllByText('run-failed').length).toBeGreaterThan(0));
    expect(screen.getAllByText('provider_unavailable').length).toBeGreaterThan(0);
    expect(screen.getAllByText('run-completed').length).toBeGreaterThan(0);
    expect(screen.getByText('No comparable baseline')).toBeTruthy();
    expect(screen.getByText(/Card revision alone is not comparability/)).toBeTruthy();
    expect(screen.queryByText(/fastest comparable/)).toBeNull();
    expect(screen.queryByText(/cheapest comparable/)).toBeNull();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(3);
    expect(screen.getByText(/Preparation 2.00 s/)).toBeTruthy();
    expect(screen.getByText(/Native 5.00 s/)).toBeTruthy();
    expect(screen.getByText(/Total 7.00 s/)).toBeTruthy();
    expect(screen.getAllByRole('alert').some((node) => (
      node.textContent?.includes('Observation gap: 2 observer events')
    ))).toBe(true);
    expect(screen.getByText(/input 80 · output 20 · cache 10 · reasoning 4 · total 100/)).toBeTruthy();
    expect(screen.getByText('Timeout · Native read timed out.')).toBeTruthy();
    expect(screen.getAllByText('run-cancelled').length).toBeGreaterThan(0);
    expect([...screen.getByRole('region', { name: 'Recent Card runs' }).querySelectorAll('code')]
      .map((node) => node.textContent)).toEqual([
        'run-failed', 'run-active', 'run-completed', 'run-cancelled',
      ]);
    expect(screen.getByText('No canonical tool event was observed. Generic Hermes tool bodies are not reconstructed from output text.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/cards/run', expect.objectContaining({
      body: JSON.stringify({ action: 'history', projectId: 'project-one', deckId: 'deck-one',
        cardId: 'builder', limit: 8 }),
    }));
  });

  it('shows an honest empty state and loads retained input only on demand', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true,
        result: { limit: 8, latest: null, runs: [] } }) });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CardRuntimeDashboard projectId="project-one" deckId="deck-one" cardId="builder" />);
    await waitFor(() => expect(screen.getByText('No saved Runs exist for this Card.')).toBeTruthy());
    expect(screen.queryByText('Inspect retained input')).toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true,
      result: { limit: 8, latest: {
        runId: 'run-one', state: 'completed', elapsedMs: 1000, totalElapsedMs: null,
        inputTokens: 1, outputTokens: 2, idf: {}, jevDecisions: [], toolEvents: [],
      }, runs: [{ runId: 'run-one', state: 'completed' }] } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true,
      result: { available: true, runId: 'run-one', inputSummary: { idfBytes: 123 } } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getAllByText('run-one').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Run details, calls, and recent history'));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect retained input' }));
    await waitFor(() => expect(screen.getByText('Retained canonical input')).toBeTruthy());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/cards/run', expect.objectContaining({
      body: JSON.stringify({ action: 'inputs', projectId: 'project-one', deckId: 'deck-one',
        cardId: 'builder', runId: 'run-one' }),
    }));
    view.unmount();
  });

  it('shows a failed pre-Run attempt without invented native or provider activity', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true,
      result: { limit: 8, latest: {
        runId: 'prep-failed', state: 'failed', acceptedAt: '2026-10-02T12:00:00Z',
        startedAt: null, finishedAt: '2026-10-02T12:00:01Z', preparationMs: 1000,
        totalElapsedMs: 1000, elapsedMs: null, preparationState: 'failed',
        preparationError: 'configured_tool_unknown:provider.tool', nativeRunId: null,
        provider: null, model: null, inputTokens: null, outputTokens: null,
        cachedTokens: null, reasoningTokens: null, costUsd: null, toolCallCount: null,
        attemptEvents: [], toolEvents: [], jevDecisions: [], idf: {},
        errorCode: 'configured_card_preparation_failed',
        errorSummary: 'configured_tool_unknown:provider.tool',
      }, runs: [{ runId: 'prep-failed', state: 'failed', startedAt: null }] },
    }) }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CardRuntimeDashboard projectId="project-one" deckId="deck-one" cardId="builder" />);
    await waitFor(() => expect(screen.getAllByText('prep-failed').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Run details, calls, and recent history'));
    expect(screen.getAllByText('configured_tool_unknown:provider.tool').length).toBeGreaterThan(0);
    expect(screen.getByText('Native Run ID').parentElement?.textContent).toContain('Unavailable');
    expect(screen.getByText('Provider').parentElement?.textContent).toContain('Unavailable');
    expect(screen.getByText('Model').parentElement?.textContent).toContain('Unavailable');
    expect(screen.getByText(/Native Unavailable/)).toBeTruthy();
    expect(screen.getByText(/No per-call Hermes receipt is available/)).toBeTruthy();
  });
});
