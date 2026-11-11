// @vitest-environment jsdom

/**
 * Entity: Trading
 * Relationship: Verifies the Trading workspace mounts read-only charts, switches Portfolio and Journal views, preserves plan evidence, and keeps execution controls disabled.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TradingState } from '../features/trading/tradingState';
import TradingUI from './tradingui';
import type { AgentCardInstance } from '../types/agentgraph';
const trader: AgentCardInstance = { id: 'card_trading_workbench', title: 'Trader', templateId: 'trader', runtime: { kind: 'hermes', mode: 'delegate', profile: 'trading' }, position: { x: 0, y: 0 } };
const execution = { runtime: 'hermes' as const, profile: 'trading', sessionId: 'session-one', turnId: 'turn-one', toolCallId: 'call-one' };

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
    sourceExecution: execution, createdAt: '2026-09-03T00:00:00Z',
    updatedAt: '2026-09-03T00:01:00Z', decisions: [], interventions: [],
    market: {
      status: 'available', provider: 'alpaca', feed: 'iex', timeframe: '5Min',
      fetchedAt: '2026-09-03T00:01:00Z', observedAt: '2026-09-03T00:01:00Z',
      freshness: 'fresh', currentPrice: 11,
      bars: [{ timestamp: '2026-09-03T00:00:00Z', open: 10, high: 12, low: 9, close: 11, volume: 100 }],
      diagnostics: null,
    },
    position: null, orders: [], fills: [], events: [],
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
  researchDecisions: [], backtests: [],
  observedAt: '2026-09-03T00:01:00Z',
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Trading agent UI', () => {
  const visibleChart = () => screen.getAllByTestId('trading-candles').find(frame => !frame.closest('[hidden]'))!;
  const chartOptions = () => JSON.parse(decodeURIComponent(
    new URL(visibleChart().getAttribute('src')!).hash.slice(1),
  ));
  const readResponse = (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes('/forecasts?') ? { forecasts: [] } : String(url).includes('/history?') ? { history: [], status: 'available' } : snapshot), { status: 200 });
  it('mounts visible Portfolio candles using TradingView and opens the selected chart', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => readResponse(url)));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const observers: IntersectionObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { observers.push(callback); }
      observe() {}
      disconnect = disconnect;
    });
    render(<TradingUI symbol="RDW" projectId="project-one" forecastCard={trader} />);
    expect(screen.getByRole('tab', { name: 'Add trade' }).getAttribute('aria-selected')).toBe('true');
    expect(chartOptions()).toMatchObject({ symbol: 'NYSE:RDW', hide_top_toolbar: '0', interval: '5', theme: 'dark', allow_symbol_change: '1' });
    expect(JSON.parse(new URL(visibleChart().getAttribute('src')!).searchParams.get('disabled_features')!)).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Load ticker' })).toBeNull();
    expect(document.querySelector('#tv-script')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    await screen.findByTestId('trade-job-job-one');
    await waitFor(() => expect(observers).toHaveLength(1));
    expect(screen.getByTestId('trading-candles').closest('[hidden]')).toBeTruthy();
    act(() => observers[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(chartOptions()).toMatchObject({ symbol: 'RDW', style: '1', hide_top_toolbar: '1', allow_symbol_change: '0' });
    fireEvent.click(screen.getByRole('button', { name: 'Open RDW chart' }));
    expect(chartOptions()).toMatchObject({ symbol: 'RDW', style: '1', hide_top_toolbar: '0', allow_symbol_change: '0' });
    expect(disconnect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('active-trade-job-grid')).toBeTruthy();
  });

  it('keeps Portfolio charts and combines plans with their journal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => readResponse(url)));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<TradingUI symbol="RDW" projectId="project-one" forecastCard={trader} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    await waitFor(() => expect(screen.getAllByText('$100,000.00').length).toBeGreaterThan(0));
    expect(screen.getByRole('tab', { name: 'Portfolio' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('trading-candles').closest('[hidden]')).toBeTruthy();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Add trade', 'Portfolio', 'Journal', 'Forecast']);
    expect(screen.queryByText('Run local proof')).toBeNull();
    expect(screen.queryByText('Paper only')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enter trade' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Exit trade' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();

    expect(screen.getByTestId('active-trade-job-grid')).toBeTruthy();
    fireEvent.click(screen.getByTestId('trade-job-job-one'));
    expect(screen.getByTestId('selected-trade-job')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PAUSE' }).hasAttribute('disabled')).toBe(true);
    expect(chartOptions()).toMatchObject({ symbol: 'RDW' });
    expect(screen.queryByRole('button', { name: /^Dark$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Fullscreen$/ }));
    expect(screen.queryByRole('complementary', { name: 'Trading controls' })).toBeNull();
    expect(screen.getByTestId('trading-candles')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit Fullscreen' }));
    expect(screen.getByRole('complementary', { name: 'Trading controls' })).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    expect(screen.getByTestId('trading-portfolio')).toBeTruthy();
    expect(screen.getByTestId('trading-candles').closest('[hidden]')).toBeTruthy();
    expect(screen.getByText('Cash')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Journal' }));
    expect(screen.getByText('Stop at the authorized level.')).toBeTruthy();
    expect(screen.getByTestId('trading-journal')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Add trade' }));
    expect(screen.getByTestId('trading-candles')).toBeTruthy();
  });

  it('keeps explicit forecast ticker/timeframe and preserves TradingView controls across tabs without inference', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => readResponse(url)));
    render(<TradingUI symbol="RDW" projectId="project-one" forecastCard={trader} />);
    const chart = visibleChart();
    expect(screen.queryByRole('region', { name: 'Interactive forecast candle chart' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Forecast' }));
    await screen.findByRole('button', { name: 'Forecast' });
    expect(screen.getByRole('region', { name: 'Interactive forecast candle chart' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enter trade' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Exit trade' })).toBeNull();
    expect(chart.closest('[hidden]')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Add trade' }));
    expect(visibleChart()).toBe(chart);
    expect(screen.queryByLabelText('Trading ticker')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Forecast' }));
    fireEvent.change(screen.getByLabelText('Trading ticker'), { target: { value: 'SPY' } });
    expect(screen.getByTestId('trading-candles')).toBe(chart); // Typing does not reload the embed.
    fireEvent.click(screen.getByRole('button', { name: 'Load ticker' }));
    fireEvent.change(screen.getByLabelText('Trading timeframe'), { target: { value: '1Day' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Add trade' }));
    expect(chartOptions()).toMatchObject({ symbol: 'SPY', interval: 'D' });
    expect(screen.queryByRole('region', { name: 'Interactive forecast candle chart' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Forecast' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('symbol=SPY&timeframe=1Day'))).toBe(true));
    expect(screen.getByRole('button', { name: 'Forecast' })).toBeTruthy();
    expect(screen.queryByText(/Forecasts belong to/)).toBeNull();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/forecast')).every(([url]) => String(url).includes('cardId=card_trading_workbench'))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('retries a genuinely blank frame once, then exposes recovery instead of an endless blank or reload loop', () => {
    vi.useFakeTimers();
    const { unmount } = render(<TradingUI symbol="RDW" />);
    const blank = () => vi.spyOn(visibleChart() as HTMLIFrameElement, 'contentWindow', 'get').mockReturnValue({ location: { href: 'about:blank' } } as Window);
    blank();
    const first = visibleChart();
    fireEvent.load(first); // A load event for about:blank must not count as success.
    expect(screen.getByRole('status').textContent).toContain('Opening');
    act(() => vi.advanceTimersByTime(8000));
    expect(visibleChart()).not.toBe(first);
    blank();
    const retried = visibleChart();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole('alert').textContent).toContain('did not open');
    act(() => vi.advanceTimersByTime(60000));
    expect(visibleChart()).toBe(retried);
    fireEvent.click(screen.getByRole('button', { name: 'Reload chart' }));
    expect(visibleChart()).not.toBe(retried);
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows unfunded research and only its exact cited backtest, with a bounded refresh', async () => {
    const result: TradingState['backtests'][number] = {
      backtestId: 'quant-receipt', producerCardId: 'quant-card', cardRevisionId: 'quant-revision',
      sourceExecution: { ...execution, profile: 'quant-analyst', toolCallId: 'quant-call' },
      savedAt: snapshot.observedAt, engine: 'LumiBot', version: '4.6.48+mcp2.1',
      mode: 'historical_simulation_only', bot: 'buy_and_hold', symbols: ['RDW'],
      start: '2026-08-01', endExclusive: '2026-09-01', dataCutoffExclusive: '2026-09-01T00:00:00-04:00',
      initialCapital: 10000, endingPortfolioValue: 10120,
      costs: { feeBpsPerSide: 1, slippagePerSharePerSide: .01 }, parameters: { buy_symbol: 'RDW' },
      metrics: { total_return: .012 }, sources: [{ provider: 'alpaca', feed: 'iex' }], equity: [],
      inputSnapshotSha256: 'fixture-input-hash', limitations: ['Daily-bar fill assumptions'], brokerOrdersSubmitted: false,
    };
    let body: TradingState = { ...snapshot, jobs: [], researchDecisions: [], backtests: [] };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    render(<TradingUI symbol="RDW" projectId="project-one" forecastCard={trader} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    body = { ...body, researchDecisions: [{
      decisionId: 'research-one', jobId: null, kind: 'research', subject: 'RDW investment thesis',
      producerCardId: trader.id, cardRevisionId: 'trader-revision', action: 'WAIT',
      rationale: 'Wait for the next filing before considering a position.', confidence: .5,
      evidence: [{ backtestId: 'quant-receipt' }, { backtestId: 'missing-receipt' }],
      missingTerms: ['Current filing'], executionRequested: false, sourceExecution: execution,
      createdAt: snapshot.observedAt,
    }], backtests: [result, { ...result, backtestId: 'uncited', bot: 'uncited_same_symbol' }] };
    fireEvent.click(screen.getByRole('tab', { name: 'Journal' }));
    await screen.findByText('Wait for the next filing before considering a position.');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/buy_and_hold · RDW · quant-analyst/)).toBeTruthy();
    expect(screen.getByText(/Costs per side: 1 bps/)).toBeTruthy();
    expect(screen.getByText(/Data cutoff: 2026-09-01/)).toBeTruthy();
    expect(screen.getByText('Referenced backtest unavailable: missing-receipt')).toBeTruthy();
    expect(screen.queryByText(/uncited_same_symbol/)).toBeNull();
    expect(screen.queryByText('Maximum loss')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enter trade' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh journal' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(fetcher.mock.calls.every((call: unknown[]) => !((call[1] as RequestInit)?.method))).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    expect(screen.queryByTestId('trade-job-research-one')).toBeNull();
    expect(screen.getByText('$100,000.00')).toBeTruthy();
  });

  it('does not reload a frame that has navigated cross-origin, and clears old timers on ticker change', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TradingUI symbol="RDW" />);
    const chart = visibleChart();
    vi.spyOn(chart as HTMLIFrameElement, 'contentWindow', 'get').mockReturnValue({ get location() { throw new DOMException('Cross-origin', 'SecurityError'); } } as unknown as Window);
    fireEvent.load(chart);
    act(() => vi.advanceTimersByTime(8000));
    expect(visibleChart()).toBe(chart);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<TradingUI symbol="SPY" />);
    expect(visibleChart()).not.toBe(chart);
    expect(vi.getTimerCount()).toBe(1);
  });
});
