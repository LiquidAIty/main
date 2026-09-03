// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});

describe('Trading agent UI', () => {
  it('lands on the real portfolio snapshot and opens compact and full job charts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    vi.stubGlobal('EventSource', undefined);
    const onInspectorRequest = vi.fn();
    render(<TradingUI projectId="project-one" onInspectorRequest={onInspectorRequest} />);

    await waitFor(() => expect(screen.getAllByText('$100,000.00').length).toBeGreaterThan(0));
    expect(screen.getByText('Paper portfolio history')).toBeTruthy();
    expect(screen.getByText('Order submission blocked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onInspectorRequest).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /Trade Jobs/ }));
    expect(screen.getByTestId('active-trade-job-grid')).toBeTruthy();
    fireEvent.click(screen.getByTestId('trade-job-job-one'));
    expect(screen.getByTestId('selected-trade-job')).toBeTruthy();
    expect(screen.getByText('Hermes decisions and evidence')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PAUSE' }).hasAttribute('disabled')).toBe(true);
  });
});
