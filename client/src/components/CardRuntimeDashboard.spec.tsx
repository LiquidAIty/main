// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardRuntimeDashboard } from './CardRuntimeDashboard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderDashboard(cardId = 'builder') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<CardRuntimeDashboard projectId="project-one" deckId="deck-one" cardId={cardId} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CardRuntimeDashboard', () => {
  it('shows only the selected Card newest failed Run aggregates', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          cardId: 'builder',
          latest: {
            state: 'failed',
            acceptedAt: '2026-10-03T12:00:00Z',
            model: 'gpt-5.6-sol',
            elapsedMs: 17_490,
            totalTokens: 12_340,
            costUsd: 0.08,
            costStatus: 'estimated',
            toolCallCount: 7,
          },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const view = await renderDashboard();

    expect(view.textContent).toContain('Model: gpt-5.6-sol');
    expect(view.textContent).toContain('Time: 00:17.49');
    expect(view.textContent).toContain('Tokens: 12,340');
    expect(view.textContent).toContain('Cost: ~$0.08 estimated');
    expect(view.textContent).toContain('Tools: 7');
    expect(view.textContent).not.toMatch(/receipt/i);
    expect(view.textContent).not.toMatch(/history|provider|retry|artifact|reference|context|Jev/i);
    expect(fetchMock).toHaveBeenCalledWith('/api/cards/run', expect.objectContaining({
      body: JSON.stringify({ action: 'history', projectId: 'project-one', deckId: 'deck-one',
        cardId: 'builder', limit: 1 }),
    }));
  });

  it('keeps unknown cancelled Run aggregates unavailable instead of zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true,
      result: { cardId: 'builder', latest: {
        state: 'cancelled', acceptedAt: null, model: null, elapsedMs: null,
        totalTokens: null, costUsd: null, costStatus: 'unavailable', toolCallCount: null,
      } },
    }) })));

    const view = await renderDashboard();

    expect(view.textContent).toContain('Model: unavailable');
    expect(view.textContent).toContain('Time: unavailable');
    expect(view.textContent).toContain('Tokens: unavailable');
    expect(view.textContent).toContain('Cost: unavailable');
    expect(view.textContent).toContain('Tools: unavailable');
    expect(view.textContent).not.toMatch(/0/);
  });

  it('rejects a response scoped to a different Card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true,
      result: { cardId: 'another-card', latest: null },
    }) })));

    const view = await renderDashboard();

    expect(view.querySelector('[role="alert"]')?.textContent).toContain(
      'card_run_status_unavailable',
    );
    expect(view.textContent).not.toContain('No runs yet.');
  });

  it('ticks locally, refreshes existing aggregates, freezes terminal values, and replaces them with a newer Run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:01Z'));
    const responses = [
      { state: 'running', acceptedAt: '2026-10-03T12:00:00Z', model: 'gpt-5.6-sol',
        elapsedMs: 1_000, totalTokens: null, costUsd: null, costStatus: 'unavailable',
        toolCallCount: null },
      { state: 'running', acceptedAt: '2026-10-03T12:00:00Z', model: 'gpt-5.6-sol',
        elapsedMs: 3_000, totalTokens: 30, costUsd: 0.01, costStatus: 'estimated',
        toolCallCount: 2 },
      { state: 'failed', acceptedAt: '2026-10-03T12:00:00Z', model: 'gpt-5.6-sol',
        elapsedMs: 3_500, totalTokens: 40, costUsd: 0.02, costStatus: 'estimated',
        toolCallCount: 3 },
      { state: 'cancelled', acceptedAt: '2026-10-03T12:00:05Z', model: null,
        elapsedMs: 250, totalTokens: null, costUsd: null, costStatus: 'unavailable',
        toolCallCount: null },
    ];
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true,
      result: { cardId: 'builder', latest: responses[Math.min(fetchMock.mock.calls.length - 1, 3)] },
    }) }));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<CardRuntimeDashboard projectId="project-one" deckId="deck-one" cardId="builder" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Time: 00:01.00');
    expect(container.textContent).toContain('Tokens: unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(container.textContent).toContain('Time: 00:01.50');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Tokens: 30');
    expect(container.textContent).toContain('Tools: 2');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain('Time: 00:03.50');
    expect(container.textContent).toContain('Tokens: 40');
    expect(container.textContent).toContain('Tools: 3');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(container.textContent).toContain('Time: 00:03.50');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(container.textContent).toContain('Model: unavailable');
    expect(container.textContent).toContain('Time: 00:00.25');
    expect(container.textContent).toContain('Tokens: unavailable');
    expect(container.textContent).toContain('Tools: unavailable');
  });
});
