import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRADING_CONFIGURATION,
  readTradingConfiguration,
  TRADE_ACTIONS,
} from './tradingState';

describe('Trading Card state contracts', () => {
  it('exposes only the seven typed decision outcomes', () => {
    expect(TRADE_ACTIONS).toEqual([
      'WAIT', 'ENTER', 'HOLD', 'REDUCE', 'EXIT', 'PAUSE', 'FAIL_SAFE',
    ]);
  });

  it('keeps paper-only and execution-off flags immutable while reading saved sliders', () => {
    expect(readTradingConfiguration({
      schemaVersion: 'wrong',
      trading: {
        paperOnly: false,
        executionApproved: true,
        paperBudgetUsd: 125_000,
        minimumRiskReward: 3.5,
      },
    })).toEqual({
      ...DEFAULT_TRADING_CONFIGURATION,
      trading: {
        ...DEFAULT_TRADING_CONFIGURATION.trading,
        paperBudgetUsd: 125_000,
        minimumRiskReward: 3.5,
      },
    });
  });

  it('uses fail-closed zero allocation defaults for missing saved configuration', () => {
    const configuration = readTradingConfiguration(null);
    expect(configuration.trading.paperBudgetUsd).toBe(0);
    expect(configuration.trading.maxOpenPositions).toBe(0);
    expect(configuration.trading.maxPlanLossPercent).toBe(0);
    expect(configuration.trading.maxDailyLossPercent).toBe(0);
  });
});
