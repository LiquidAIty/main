/**
 * Entity: Trading
 * Relationship: Verifies the Trading Card exposes only typed decisions and reads saved parameters under immutable paper-only, execution-disabled safety defaults.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRADING_CONFIGURATION,
  readTradingConfiguration,
  TRADE_ACTIONS,
  tradingForecastCard,
} from './tradingState';
import type { AgentCardInstance } from '../../types/agentgraph';

describe('Trading Card state contracts', () => {
  it('binds the manual chart to its surface Card independently of other specialists grants', () => {
    const trader = { id: 'trader', enabled: true, runtimeOptions: { tools: ['forecast_market_bars'] } } as AgentCardInstance;
    const quant = { ...trader, id: 'quant' };
    expect(tradingForecastCard(trader)).toBe(trader);
    expect(tradingForecastCard(quant)).toBe(quant);
    expect(tradingForecastCard({ ...trader, enabled: false })).toBeNull();
    expect(tradingForecastCard({ ...trader, runtimeOptions: { tools: [] } })).toBeNull();
    expect(tradingForecastCard(null)).toBeNull();
  });
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
