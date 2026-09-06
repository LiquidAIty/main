// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TradingState } from '../features/trading/tradingState';
import TradingUI from './tradingui';

const snapshot: TradingState = {
  cardId: 'card_trading_workbench',
  paperOnly: true,
  executionApproved: false,
  timeframe: '5Min',
  jobs: [{
    jobId: 'job-one', symbol: 'RDW', assetClass: 'equity', state: 'monitoring',
    action: 'WAIT', executionState: 'blocked_pending_separate_approval',
    budgetCeilingUsd: 5_000, maxLossUsd: 100, realizedPnlUsd: null,
    plan: {
      allowedDirections: ['long'], expectedRiskReward: 2,
      entryConditions: ['Approved evidence confirms entry.'],
      stopConditions: ['Stop at the authorized level.'],
      exitConditions: ['Exit at the authorized target.'],
      invalidationConditions: ['Evidence is invalidated.'],
      dataRequirements: ['Fresh paper market data.'],
    },
    sourceRunId: 'run-one', createdAt: '2026-09-03T00:00:00Z',
    updatedAt: '2026-09-03T00:01:00Z', decisions: [], interventions: [],
    market: {
      status: 'available', provider: 'alpaca', feed: 'iex', timeframe: '5Min',
      fetchedAt: '2026-09-03T00:01:00Z', observedAt: '2026-09-03T00:01:00Z',
      freshness: 'fresh', currentPrice: 11,
      bars: [{ timestamp: '2026-09-03T00:00:00Z', open: 10, high: 12, low: 9, close: 11, volume: 100 }],
      diagnostics: null,
    },
    position: null, orders: [], fills: [], events: [], artifacts: [],
    lifecycle: { status: 'observed', diagnostics: null },
  }],
  portfolio: {
    portfolioValueUsd: 100_000, cashUsd: 95_000, buyingPowerUsd: null,
    dailyPnlUsd: 250, totalUnrealizedPnlUsd: null, maxDrawdownUsd: -500,
    maxDrawdownPercent: -0.5, unavailableMetrics: ['buyingPowerUsd'],
    realizedPnlUsd: 0, recordedRealizedPnlUsd: 0, wins: 0, losses: 0,
    flat: 0, closedTrades: 0,
    equityCurve: [{
      timestamp: '2026-09-03T00:00:00Z', valueUsd: 100_000,
      drawdownUsd: 0, drawdownPercent: 0,
    }],
  },
  positions: [],
  connection: {
    provider: 'alpaca', status: 'available', mode: 'paper', accountStatus: 'ACTIVE',
    fetchedAt: '2026-09-03T00:01:00Z', diagnostics: null,
  },
  commands: {
    pauseResume: { available: false, reason: 'lifecycle_not_started' },
    exit: { available: false, reason: 'order_submission_blocked' },
    cancel: { available: false, reason: 'order_submission_blocked' },
  },
  engine: { status: 'available', paperOnly: true },
  lifecycleProof: null,
  observedAt: '2026-09-03T00:01:00Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Trading agent UI', () => {
  it('mounts visible Portfolio candles using TradingView and opens the selected chart', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })));
    vi.stubGlobal('EventSource', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const observers: IntersectionObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { observers.push(callback); }
      observe() {}
      disconnect = disconnect;
    });
    const widget = vi.fn(function () { return { remove: vi.fn() }; });
    vi.stubGlobal('TradingView', { widget });
    render(<TradingUI symbol="RDW" projectId="project-one" />);
    expect(screen.getByRole('tab', { name: 'Add trade' }).getAttribute('aria-selected')).toBe('true');
    expect(widget).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'NYSE:RDW', hide_top_toolbar: false }));
    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    widget.mockClear();
    await screen.findByTestId('trade-job-job-one');
    await waitFor(() => expect(observers).toHaveLength(1));
    expect(widget).not.toHaveBeenCalled();
    act(() => observers[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(widget).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'RDW', style: '1', hide_top_toolbar: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Open RDW chart' }));
    expect(widget).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'RDW', style: '1', hide_top_toolbar: false }));
    expect(disconnect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('active-trade-job-grid')).toBeTruthy();
  });

  it('keeps Portfolio charts and combines plans with their journal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    vi.stubGlobal('EventSource', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const remove = vi.fn(() => { throw new Error('detached iframe'); });
    const widget = vi.fn(function () { return { remove }; });
    vi.stubGlobal('TradingView', { widget });
    render(<TradingUI symbol="RDW" projectId="project-one" />);

    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    await waitFor(() => expect(screen.getAllByText('$100,000.00').length).toBeGreaterThan(0));
    expect(screen.getByRole('tab', { name: 'Portfolio' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('trading-candles')).toBeNull();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Add trade', 'Portfolio', 'Journal']);
    expect(screen.queryByText('Run local proof')).toBeNull();
    expect(screen.queryByText('Paper only')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enter trade' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Exit trade' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();

    expect(screen.getByTestId('active-trade-job-grid')).toBeTruthy();
    fireEvent.click(screen.getByTestId('trade-job-job-one'));
    expect(screen.getByTestId('selected-trade-job')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PAUSE' }).hasAttribute('disabled')).toBe(true);
    expect(widget).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'RDW' }));
    expect(screen.queryByRole('button', { name: 'Dark', exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen', exact: true }));
    expect(screen.queryByRole('complementary', { name: 'Trading controls' })).toBeNull();
    expect(screen.getByTestId('trading-candles')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit Fullscreen' }));
    expect(screen.getByRole('complementary', { name: 'Trading controls' })).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    expect(screen.getByTestId('trading-portfolio')).toBeTruthy();
    expect(screen.queryByTestId('trading-candles')).toBeNull();
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(remove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Journal' }));
    expect(screen.getByText('Stop at the authorized level.')).toBeTruthy();
    expect(screen.getByTestId('trading-journal')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Add trade' }));
    expect(screen.getByTestId('trading-candles')).toBeTruthy();
  });
});
